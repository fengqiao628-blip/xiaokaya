import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { StudyDatabase } from '../../src/data/database'
import { StudyService } from '../../src/services/study'
import { SnapshotStore } from '../../src/main/backup-files'
import { BackupService } from '../../src/data/backup/service'
import { readPayload, makeBackup } from '../../src/data/backup/payload'
import type { DesktopBridge } from '../../src/shared/identity'
export function stripV6QuoteSnapshots(data: Record<string, Record<string, unknown>[]>) {
  for (const table of ['dailyQuotes', 'quoteHistory'])
    data[table] = data[table].map(({ attribution: _, ...row }) => row)
}

export async function safetyContext() {
  const name = `Test-Safety-${crypto.randomUUID()}`
  const database = new StudyDatabase(name)
  await database.open()
  const root = resolve('.runtime/unit-safety', crypto.randomUUID())
  await mkdir(join(root, 'profile'), { recursive: true })
  const store = new SnapshotStore(root)
  const desktop: DesktopBridge = {
    getInfo: async () => ({
      version: '0.4.0',
      appId: 'cn.xiaokaoya.study',
      databaseName: name,
      userData: root,
      sessionData: join(root, 'profile'),
      environment: 'test',
    }),
    openDataFolder: async () => {},
    backup: {
      chooseBackupFile: async () => null,
      exportBackup: (content) => store.writeExport(join(root, 'export.json'), content, 'json'),
      exportCsv: (content, kind) => store.writeExport(join(root, `${kind}.csv`), content, 'csv'),
      saveSnapshot: (content) => store.saveSnapshot(content),
      readSnapshot: (id) => store.readSnapshot(id),
      listSnapshots: () => store.listSnapshots(),
      status: () => store.status(),
      writeJournal: (value) => store.writeJournal(value),
      openBackupFolder: async () => {},
    },
  }
  const study = new StudyService(database)
  await study.selectSubjects(2027, ['cpa-1', 'tax-1'])
  const cycle = (await database.cycles.where('subjectId').equals('cpa-1').first())!
  const task = await study.createTask({
    cycleId: cycle.id,
    title: '测试备份原任务',
    plannedDate: '2027-02-01',
    estimatedMinutes: 60,
    notes: '保留中文、逗号, 和换行\n第二行',
  })
  await study.dailyQuote('2027-02-01')
  const service = new BackupService(database, desktop)
  const envelope = await makeBackup(await readPayload(database), '0.4.0', 'export')
  return { database, root, store, desktop, study, cycle, task, service, envelope }
}
