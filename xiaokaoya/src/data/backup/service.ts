import { db, type StudyDatabase } from '../database'
import { blockWrites, exclusive } from '../operation-gate'
import { todayKey } from '../../domain/dates'
import { DATABASE_VERSION, type DesktopBridge } from '../../shared/identity'
import type { RecoveryJournal } from '../../shared/backup-bridge'
import {
  fingerprint,
  inspectBackup,
  parseBackup,
  validateData,
  type Inspection,
  type SnapshotPurpose,
} from '../../shared/backup'
import { makeBackup, readPayload, replacePayload } from './payload'
import { makeCsv } from './csv'
import type { DataCsvKind } from '../../shared/backup-bridge'

export interface RestorePreview {
  inspection: Inspection
  currentCounts: Record<string, number>
  currentFingerprint: string
  identical: boolean
  differentDataset: boolean
  fileName: string
}
export class BackupService {
  constructor(
    readonly database: StudyDatabase,
    readonly desktop: DesktopBridge,
  ) {}
  private async snapshot(purpose: SnapshotPurpose) {
    const data = await readPayload(this.database)
    validateData(data, DATABASE_VERSION)
    const backup = await makeBackup(data, (await this.desktop.getInfo()).version, purpose)
    return { data, backup }
  }
  async exportJson() {
    return exclusive(async () => {
      const { backup } = await this.snapshot('export')
      return this.desktop.backup.exportBackup(JSON.stringify(backup, null, 2))
    })
  }
  async exportCsv(kind: DataCsvKind) {
    return exclusive(async () => {
      const data = await readPayload(this.database)
      validateData(data, DATABASE_VERSION)
      return this.desktop.backup.exportCsv(makeCsv(data, kind), kind)
    })
  }
  async createSnapshot(purpose: 'manual' | 'daily' = 'manual') {
    return exclusive(async () => {
      const { backup } = await this.snapshot(purpose)
      return this.desktop.backup.saveSnapshot(JSON.stringify(backup))
    })
  }
  async ensureDailySnapshot() {
    return exclusive(async () => {
      const listing = await this.desktop.backup.listSnapshots()
      const meta = await this.database.datasetMeta.get('dataset')
      if (
        listing.snapshots.some(
          (item) =>
            item.purpose === 'daily' &&
            item.datasetId === meta?.datasetId &&
            todayKey(new Date(item.createdAt)) === todayKey(),
        )
      )
        return null
      const { backup } = await this.snapshot('daily')
      return this.desktop.backup.saveSnapshot(JSON.stringify(backup))
    })
  }
  async preview(content: string, fileName: string): Promise<RestorePreview> {
    const inspection = await inspectBackup(await parseBackup(content))
    return exclusive(async () => {
      const current = await readPayload(this.database)
      validateData(current, DATABASE_VERSION)
      const currentFingerprint = await fingerprint(current)
      return {
        inspection,
        fileName,
        currentFingerprint,
        currentCounts: Object.fromEntries(
          Object.entries(current).map(([name, list]) => [name, list.length]),
        ),
        identical: inspection.fingerprint === currentFingerprint,
        differentDataset: inspection.envelope.datasetId !== current.datasetMeta[0].datasetId,
      }
    })
  }
  async restore(preview: RestorePreview) {
    return exclusive(async () => {
      const inspection = await inspectBackup(
        await parseBackup(JSON.stringify(preview.inspection.envelope)),
      )
      const before = await readPayload(this.database)
      validateData(before, DATABASE_VERSION)
      const currentHash = await fingerprint(before)
      if (currentHash === inspection.fingerprint) return { unchanged: true, snapshotId: null }
      if (currentHash !== preview.currentFingerprint)
        throw new Error('预检后当前数据已变化，请重新预检再恢复')
      const backup = await makeBackup(before, (await this.desktop.getInfo()).version, 'pre-restore')
      const saved = await this.desktop.backup.saveSnapshot(JSON.stringify(backup))
      const verified = await parseBackup(await this.desktop.backup.readSnapshot(saved.id))
      if (verified.checksum.value !== backup.checksum.value)
        throw new Error('恢复前快照回读失败，原数据未改变')
      const journal: RecoveryJournal = {
        operationId: crypto.randomUUID(),
        kind: 'restore',
        status: 'prepared',
        snapshotId: saved.id,
        targetFingerprint: inspection.fullFingerprint,
        beforeFingerprint: await fingerprint(before, true),
        startedAt: new Date().toISOString(),
      }
      await this.desktop.backup.writeJournal(journal)
      try {
        await replacePayload(this.database, inspection.data)
        if (
          (await fingerprint(await readPayload(this.database), true)) !== inspection.fullFingerprint
        )
          throw new Error('恢复后内容复核失败')
        await this.desktop.backup.writeJournal({
          ...journal,
          status: 'committed',
          finishedAt: new Date().toISOString(),
          message: '恢复完成，全部数据表及关联复核通过',
        })
        return { unchanged: false, snapshotId: saved.id }
      } catch (error) {
        try {
          if (
            (await fingerprint(await readPayload(this.database), true)) !==
            journal.beforeFingerprint
          )
            await replacePayload(this.database, before)
          if (
            (await fingerprint(await readPayload(this.database), true)) !==
            journal.beforeFingerprint
          )
            throw new Error('回滚复核失败')
          await this.desktop.backup.writeJournal({
            ...journal,
            status: 'rolled-back',
            finishedAt: new Date().toISOString(),
            message: '恢复失败，原数据已完整保留或回滚',
          })
        } catch {
          blockWrites('安全操作尚未完成，写入已暂停。请重新打开小考鸭执行恢复检查；快照已保留')
          throw new Error(
            '恢复遇到异常且尚不能确认回滚，已停止后续写入。请保留数据目录，重新打开执行安全检查',
          )
        }
        throw new Error(
          `恢复未完成，原数据已完整保留或回滚。${error instanceof Error ? error.message : ''}`,
        )
      }
    })
  }
}
export function backupService() {
  return new BackupService(db, window.desktop)
}
