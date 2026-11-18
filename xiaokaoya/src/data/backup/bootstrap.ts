import type { DesktopBridge } from '../../shared/identity'
import type { StudyDatabase, MigrationPermit } from '../database'
import { readNativeDatabase, replaceNativePayload } from './native-reader'
import { exclusive } from '../operation-gate'
import {
  fingerprint,
  inspectBackup,
  parseBackup,
  sealBackup,
  validateData,
} from '../../shared/backup'
import { DATABASE_VERSION } from '../../shared/identity'
import { upgradePayload } from '../../shared/migration'
import { readPayload, replacePayload } from './payload'

export async function initializeDatabase(database: StudyDatabase, desktop: DesktopBridge) {
  return exclusive(async () => {
    const info = await desktop.getInfo()
    const journal = (await desktop.backup.status()).journal
    if (journal?.status === 'prepared') {
      const current = await readNativeDatabase(database.name)
      if (!current) throw new Error('上次安全操作未完成且数据库缺失，请保留备份目录')
      const actual = await fingerprint(current.data, true)
      if (actual === journal.targetFingerprint)
        await desktop.backup.writeJournal({
          ...journal,
          status: 'committed',
          finishedAt: new Date().toISOString(),
          message: '重启后确认上次操作已完整提交',
        })
      else if (actual === journal.beforeFingerprint)
        await desktop.backup.writeJournal({
          ...journal,
          status: 'rolled-back',
          finishedAt: new Date().toISOString(),
          message: '上次操作未提交，原数据保持完整',
        })
      else if (journal.kind === 'restore') {
        const before = await parseBackup(await desktop.backup.readSnapshot(journal.snapshotId))
        await inspectBackup(before)
        if (
          before.schemaVersion !== current.schemaVersion ||
          (await fingerprint(before.data, true)) !== journal.beforeFingerprint
        )
          throw new Error('恢复日志与快照不一致，自动处理已停止')
        await replaceNativePayload(database.name, current.schemaVersion, before.data)
        if (
          (await fingerprint((await readNativeDatabase(database.name))!.data, true)) !==
          journal.beforeFingerprint
        )
          throw new Error('自动回滚复核失败，请保留数据和快照')
        await desktop.backup.writeJournal({
          ...journal,
          status: 'rolled-back',
          finishedAt: new Date().toISOString(),
          message: '异常中断后已从恢复前快照回滚',
        })
      } else throw new Error('升级状态与安全日志不一致，请保留原数据和升级前快照')
    }
    const previous = await readNativeDatabase(database.name)
    if (previous && previous.schemaVersion < DATABASE_VERSION) {
      validateData(previous.data, previous.schemaVersion)
      const now = new Date().toISOString()
      const backup = await sealBackup({
        data: previous.data,
        appVersion: info.version,
        schemaVersion: previous.schemaVersion,
        purpose: 'pre-migration',
        backupId: crypto.randomUUID(),
        datasetId:
          previous.schemaVersion === 1
            ? crypto.randomUUID()
            : String(previous.data.datasetMeta[0].datasetId),
        exportedAt: now,
      })
      const saved = await desktop.backup.saveSnapshot(JSON.stringify(backup))
      const verified = await parseBackup(await desktop.backup.readSnapshot(saved.id))
      if (verified.checksum.value !== backup.checksum.value)
        throw new Error('升级前快照回读不一致，升级已停止')
      const permit: MigrationPermit = {
        dataset: { id: 'dataset', datasetId: backup.datasetId, createdAt: now },
        record: {
          id: crypto.randomUUID(),
          fromVersion: previous.schemaVersion,
          toVersion: DATABASE_VERSION,
          appliedAt: now,
          snapshotId: saved.id,
        },
      }
      const expected = upgradePayload(
        previous.data,
        previous.schemaVersion,
        permit.dataset,
        permit.record,
      )
      validateData(expected, DATABASE_VERSION)
      const operation = {
        operationId: crypto.randomUUID(),
        kind: 'migration' as const,
        status: 'prepared' as const,
        snapshotId: saved.id,
        targetFingerprint: await fingerprint(expected, true),
        beforeFingerprint: await fingerprint(previous.data, true),
        startedAt: now,
      }
      await desktop.backup.writeJournal(operation)
      database.authorizeMigration(permit)
      try {
        await database.open()
      } catch (error) {
        await desktop.backup.writeJournal({
          ...operation,
          status: 'rolled-back',
          finishedAt: new Date().toISOString(),
          message: `迁移事务失败，V${previous.schemaVersion} 数据未改变`,
        })
        throw error
      }
      const current = await readPayload(database)
      if ((await fingerprint(current, true)) !== operation.targetFingerprint)
        throw new Error('迁移后复核不一致，已保留升级前快照，请重新检查')
      await desktop.backup.writeJournal({
        ...operation,
        status: 'committed',
        finishedAt: new Date().toISOString(),
        message: `V${previous.schemaVersion} → V${DATABASE_VERSION} 校验通过，原业务记录完整保留`,
      })
    } else {
      if (previous) validateData(previous.data, previous.schemaVersion)
      await database.open()
    }
    validateData(await readPayload(database), DATABASE_VERSION)
  })
}
