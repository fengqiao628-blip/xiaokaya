import { promises as fs } from 'node:fs'
import { join, resolve, basename, dirname, extname, relative, isAbsolute } from 'node:path'
import { z } from 'zod'
import {
  fingerprint,
  inspectBackup,
  parseBackup,
  MAX_FILE_BYTES,
  type BackupEnvelope,
} from '../shared/backup'
import type {
  BackupStatus,
  RecoveryJournal,
  SavedFile,
  SnapshotInfo,
  SnapshotListing,
} from '../shared/backup-bridge'

export async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = join(dirname(file), `.${basename(file)}.${crypto.randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(temp, 'wx')
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    if ((await fs.readFile(temp, 'utf8')) !== content)
      throw new Error('文件回读不一致，原文件未替换')
    await fs.rename(temp, file)
  } finally {
    await handle?.close().catch(() => {})
    await fs.unlink(temp).catch(() => {})
  }
}
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const time = z.iso.datetime({ offset: true })
const journalSchema = z
  .object({
    operationId: z.uuid(),
    kind: z.enum(['restore', 'migration']),
    status: z.enum(['prepared', 'committed', 'rolled-back']),
    snapshotId: z.uuid(),
    targetFingerprint: hash,
    beforeFingerprint: hash,
    startedAt: time,
    finishedAt: time.optional(),
    message: z.string().max(1000).optional(),
  })
  .strict()
const receiptSchema = z.object({ path: z.string(), savedAt: time }).strict()

export class SnapshotStore {
  readonly root: string
  private writes = Promise.resolve()
  constructor(
    readonly userData: string,
    private write = atomicWrite,
  ) {
    this.root = join(userData, 'backups')
  }
  async initialize() {
    await fs.mkdir(this.root, { recursive: true })
  }
  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    const prior = this.writes
    let release!: () => void
    this.writes = new Promise<void>((resolve) => {
      release = resolve
    })
    await prior
    try {
      return await fn()
    } finally {
      release()
    }
  }
  private snapshotPath(id: string) {
    if (!z.uuid().safeParse(id).success) throw new Error('快照标识无效')
    return join(this.root, `snapshot-${id}.json`)
  }
  private async readFile(file: string): Promise<string> {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('备份不是普通文件')
    if (stat.size > MAX_FILE_BYTES) throw new Error('文件超过当前支持的256MB，操作已停止')
    const root = await fs.realpath(dirname(file))
    const actual = await fs.realpath(file)
    const rel = relative(root, actual)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('备份路径异常')
    return fs.readFile(file, 'utf8')
  }
  async readSnapshot(id: string) {
    const content = await this.readFile(this.snapshotPath(id))
    const envelope = await parseBackup(content)
    await inspectBackup(envelope)
    if (envelope.backupId !== id) throw new Error('快照文件与标识不一致')
    return content
  }
  private info(envelope: BackupEnvelope, bytes: number): SnapshotInfo {
    return {
      id: envelope.backupId,
      fileName: basename(this.snapshotPath(envelope.backupId)),
      createdAt: envelope.exportedAt,
      purpose: envelope.purpose,
      schemaVersion: envelope.schemaVersion,
      datasetId: envelope.datasetId,
      bytes,
      counts: envelope.counts,
    }
  }
  async listSnapshots(): Promise<SnapshotListing> {
    await this.initialize()
    const snapshots: SnapshotInfo[] = [],
      problems: string[] = []
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      const match = /^snapshot-([a-f0-9-]+)\.json$/.exec(entry.name)
      if (!match) continue
      try {
        const content = await this.readSnapshot(match[1])
        const envelope = await parseBackup(content)
        snapshots.push(this.info(envelope, Buffer.byteLength(content, 'utf8')))
      } catch {
        problems.push(`${entry.name} 无法通过完整性校验，文件已保留`)
      }
    }
    return { snapshots: snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), problems }
  }
  async saveSnapshot(content: string): Promise<SnapshotInfo> {
    return this.serial(async () => {
      await this.initialize()
      const envelope = await parseBackup(content)
      await inspectBackup(envelope)
      if (envelope.purpose === 'export') throw new Error('外部导出文件不能作为自动快照写入')
      const target = this.snapshotPath(envelope.backupId)
      try {
        const existing = await this.readFile(target)
        if ((await parseBackup(existing)).checksum.value !== envelope.checksum.value)
          throw new Error('快照标识已被其他内容使用，原文件未覆盖')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await this.write(target, content)
      }
      const verified = await parseBackup(await this.readSnapshot(envelope.backupId))
      if (verified.checksum.value !== envelope.checksum.value) throw new Error('快照写入复核失败')
      if (envelope.purpose === 'daily') {
        const daily = (await this.listSnapshots()).snapshots.filter(
          (item) => item.purpose === 'daily',
        )
        for (const old of daily.slice(14)) {
          // Delete only verified daily files, after the new snapshot is durable. Critical snapshots stay.
          await fs.unlink(this.snapshotPath(old.id)).catch(() => {})
        }
      }
      return this.info(envelope, Buffer.byteLength(content, 'utf8'))
    })
  }
  async status(): Promise<BackupStatus> {
    await this.initialize()
    let journal: RecoveryJournal | null = null,
      lastExport: SavedFile | null = null
    try {
      journal = journalSchema.parse(
        JSON.parse(await this.readFile(join(this.root, 'recovery-journal.json'))),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('安全操作日志损坏，已停止写入；请保留数据和备份目录')
    }
    try {
      lastExport = receiptSchema.parse(
        JSON.parse(await this.readFile(join(this.root, 'last-export.json'))),
      )
    } catch {
      /* A lost receipt must not block access to business data. */
    }
    return { journal, lastExport }
  }
  async writeJournal(input: RecoveryJournal) {
    await this.serial(async () => {
      await this.initialize()
      const value = journalSchema.parse(input)
      const old = (await this.status()).journal
      if (value.status === 'prepared') {
        if (old?.status === 'prepared') throw new Error('上次安全操作尚未完成，请重新打开检查')
        const original = await parseBackup(await this.readSnapshot(value.snapshotId))
        if ((await fingerprint(original.data, true)) !== value.beforeFingerprint)
          throw new Error('操作日志与恢复前快照不一致')
      } else {
        if (
          !old ||
          old.status !== 'prepared' ||
          old.operationId !== value.operationId ||
          old.snapshotId !== value.snapshotId ||
          old.targetFingerprint !== value.targetFingerprint ||
          old.beforeFingerprint !== value.beforeFingerprint ||
          !value.finishedAt
        )
          throw new Error('安全操作日志转换无效')
      }
      await this.write(join(this.root, 'recovery-journal.json'), JSON.stringify(value, null, 2))
    })
  }
  async readSelectedFile(file: string) {
    if (extname(file).toLowerCase() !== '.json') throw new Error('请选择 JSON 完整备份')
    return this.readFile(file)
  }
  async writeExport(file: string, content: string, kind: 'json' | 'csv'): Promise<SavedFile> {
    if (extname(file).toLowerCase() !== `.${kind}`) throw new Error(`请选择 .${kind} 文件名`)
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES)
      throw new Error('导出超过256MB，请保留数据并联系开发者')
    const parent = await fs.realpath(dirname(file))
    const candidate = join(parent, basename(file))
    const profile = await fs
      .realpath(join(this.userData, 'profile'))
      .catch(() => resolve(this.userData, 'profile'))
    const rel = relative(profile, candidate)
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel)))
      throw new Error('请将导出文件保存在数据库 profile 目录之外')
    if (kind === 'json') await inspectBackup(await parseBackup(content))
    await this.write(candidate, content)
    if ((await this.readFile(candidate)) !== content)
      throw new Error('导出文件复核失败，请勿将该文件当作有效备份')
    const receipt = { path: candidate, savedAt: new Date().toISOString() }
    if (kind === 'json') {
      try {
        await this.initialize()
        await this.write(join(this.root, 'last-export.json'), JSON.stringify(receipt))
      } catch {
        return {
          ...receipt,
          warning: '完整文件已导出并校验，但本机导出记录未能更新，请保留导出的文件',
        }
      }
    }
    return receipt
  }
}
