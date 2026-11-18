import type { StudyDatabase } from '../database'
import { TABLES } from '../schema'
import { DATABASE_VERSION } from '../../shared/identity'
import {
  type BackupData,
  type BackupEnvelope,
  type SnapshotPurpose,
  sealBackup,
} from '../../shared/backup'
export async function readPayload(database: StudyDatabase): Promise<BackupData> {
  const names = database.tables.map((table) => table.name).sort()
  if (names.join('|') !== [...TABLES].sort().join('|'))
    throw new Error('备份清单与数据库不一致，操作已停止')
  return database.transaction('r', database.tables, async () =>
    Object.fromEntries(
      await Promise.all(TABLES.map(async (name) => [name, await database.table(name).toArray()])),
    ),
  ) as Promise<BackupData>
}
export async function makeBackup(
  data: BackupData,
  appVersion: string,
  purpose: SnapshotPurpose,
): Promise<BackupEnvelope> {
  const dataset = data.datasetMeta[0]
  if (!dataset?.datasetId) throw new Error('数据集标识缺失，不能生成完整备份')
  return sealBackup({
    data,
    appVersion,
    schemaVersion: DATABASE_VERSION,
    purpose,
    backupId: crypto.randomUUID(),
    datasetId: String(dataset.datasetId),
    exportedAt: new Date().toISOString(),
  })
}
export async function replacePayload(database: StudyDatabase, data: BackupData) {
  await database.transaction('rw', database.tables, async () => {
    for (const name of TABLES) await database.table(name).clear()
    for (const name of TABLES) if (data[name].length) await database.table(name).bulkAdd(data[name])
  })
}
