import Dexie from 'dexie'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { safetyContext, stripV6QuoteSnapshots } from './safety-helpers'
import { V3_SCHEMA, V3_TABLES } from '../../src/data/schema'
import { StudyDatabase } from '../../src/data/database'
import { CurriculumService } from '../../src/services/curriculum'
import { PlanningService } from '../../src/services/planning'
import { initializeDatabase } from '../../src/data/backup/bootstrap'
import { readNativeDatabase } from '../../src/data/backup/native-reader'
import { readPayload } from '../../src/data/backup/payload'
import { fingerprint, parseBackup, sealBackup, validateData } from '../../src/shared/backup'
import { DATABASE_VERSION } from '../../src/shared/identity'

let ctx: Awaited<ReturnType<typeof safetyContext>>
const extra: Dexie[] = []
beforeEach(async () => {
  ctx = await safetyContext()
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const db of extra.splice(0)) {
    db.close()
    await db.delete()
  }
  ctx.database.close()
  await ctx.database.delete()
})
async function legacyV3() {
  const curriculum = new CurriculumService(ctx.database)
  const book = await curriculum.saveMaterial(ctx.cycle.id, {
    title: '2027旧版教材',
    kind: 'textbook',
    edition: '2027版',
    partId: null,
  })
  const chapter = await curriculum.saveChapter(ctx.cycle.id, {
    title: '旧章节',
    partId: null,
    completionStatus: 'completed',
    masteryStars: 1,
    notes: '保留星级',
  })
  await curriculum.setProgress(book, chapter, 100)
  const state = (await ctx.database.cycleStatuses.get(ctx.cycle.id))!
  await curriculum.saveCycle((await ctx.database.cycles.get(ctx.cycle.id))!, state, {
    learningStatus: 'studying',
    registrationStatus: 'registered',
    examResult: 'passed',
    examDate: '2027-08-28',
    notes: '保留考试结果',
  })
  const raw = await readPayload(ctx.database)
  const data = Object.fromEntries(V3_TABLES.map((table) => [table, structuredClone(raw[table])]))
  data.tasks = data.tasks.map(({ kind, ...task }) => task)
  stripV6QuoteSnapshots(data)
  data.migrationHistory = data.migrationHistory.map((row) => ({ ...row, toVersion: 3 }))
  validateData(data, 3)
  const name = `Test-V3-${crypto.randomUUID()}`,
    old = new Dexie(name)
  old.version(3).stores(V3_SCHEMA)
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const table of V3_TABLES)
      if (data[table].length) await old.table(table).bulkAdd(data[table])
  })
  old.close()
  const next = new StudyDatabase(name)
  extra.push(next)
  return { name, data, next }
}
describe('V3 to V4 safety contract', () => {
  it('verifies a full V3 snapshot before opening V4 and keeps all original rows plus a migration record', async () => {
    const { name, data, next } = await legacyV3()
    await initializeDatabase(next, ctx.desktop)
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(DATABASE_VERSION)
    const actual = await readPayload(next)
    for (const table of V3_TABLES) {
      if (table === 'migrationHistory')
        for (const row of data[table]) expect(actual[table]).toContainEqual(row)
      else expect(actual[table]).toEqual(data[table])
    }
    for (const table of [
      'weeklyPlans',
      'weeklySubjectTargets',
      'taskScheduleHistory',
      'examMilestones',
    ] as const)
      expect(actual[table]).toEqual([])
    const saved = (await ctx.store.listSnapshots()).snapshots.find(
      (item) => item.purpose === 'pre-migration',
    )!
    expect(saved.schemaVersion).toBe(3)
    expect((await parseBackup(await ctx.store.readSnapshot(saved.id))).data).toEqual(data)
    expect((await ctx.store.status()).journal?.status).toBe('committed')
  })
  it('blocks a direct V3 open and a failed upgrade snapshot without changing the old version', async () => {
    const { name, data, next } = await legacyV3()
    await expect(next.open()).rejects.toThrow('快照')
    expect((await readNativeDatabase(name))?.data).toEqual(data)
    vi.spyOn(ctx.desktop.backup, 'saveSnapshot').mockRejectedValueOnce(new Error('disk full'))
    await expect(initializeDatabase(next, ctx.desktop)).rejects.toThrow('disk full')
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(3)
    expect((await readNativeDatabase(name))?.data).toEqual(data)
  })
  it('rolls native version and tables back to V3 after a partial V4 migration write', async () => {
    const { name, data } = await legacyV3()
    const broken = new StudyDatabase(name, undefined, undefined, async (transaction, permit) => {
      await transaction.table('migrationHistory').add(permit.record)
      await transaction
        .table('weeklyPlans')
        .add({ id: '2027-02-01', weekStart: '2027-02-01', goalSeconds: 0, focus: '' })
      throw new Error('simulated V4 failure')
    })
    extra.push(broken)
    await expect(initializeDatabase(broken, ctx.desktop)).rejects.toThrow('simulated V4 failure')
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(3)
    expect((await readNativeDatabase(name))?.data).toEqual(data)
    expect((await ctx.store.status()).journal?.status).toBe('rolled-back')
  })
  it('converts V3 files in memory and repeated restore does not append any new data', async () => {
    const { data } = await legacyV3()
    const envelope = await sealBackup({
      data,
      schemaVersion: 3,
      appVersion: '0.3.0',
      datasetId: String(data.datasetMeta[0].datasetId),
      backupId: crypto.randomUUID(),
      purpose: 'export',
      exportedAt: new Date().toISOString(),
    })
    const source = JSON.stringify(envelope),
      planner = new PlanningService(ctx.database)
    await planner.saveWeek({
      weekStart: '2027-02-01',
      goalMinutes: 600,
      focus: '新版周计划',
      targets: [{ cycleId: ctx.cycle.id, targetMinutes: 300 }],
    })
    const preview = await ctx.service.preview(source, 'v3.json')
    expect(preview.inspection.migrated).toBe(true)
    expect(preview.inspection.data.taskScheduleHistory).toEqual([])
    expect(preview.currentCounts.weeklyPlans).toBe(1)
    expect(preview.inspection.counts.weeklyPlans).toBe(0)
    await ctx.service.restore(preview)
    expect(await ctx.database.weeklyPlans.count()).toBe(0)
    expect((await ctx.service.preview(source, 'v3-again.json')).identical).toBe(true)
    expect(JSON.stringify(envelope)).toBe(source)
    const actual = await readPayload(ctx.database)
    for (const table of V3_TABLES.filter((name) => name !== 'migrationHistory'))
      expect(actual[table]).toEqual(data[table])
  })
  it('resolves an interrupted V3 restore before generating the V4 migration snapshot', async () => {
    const { name, data, next } = await legacyV3()
    const before = await sealBackup({
      data,
      schemaVersion: 3,
      appVersion: '0.3.0',
      datasetId: String(data.datasetMeta[0].datasetId),
      backupId: crypto.randomUUID(),
      purpose: 'pre-restore',
      exportedAt: new Date().toISOString(),
    })
    const saved = await ctx.store.saveSnapshot(JSON.stringify(before)),
      target = structuredClone(data)
    target.tasks[0].title = 'unfinished target'
    await ctx.store.writeJournal({
      operationId: crypto.randomUUID(),
      kind: 'restore',
      status: 'prepared',
      snapshotId: saved.id,
      beforeFingerprint: await fingerprint(data, true),
      targetFingerprint: await fingerprint(target, true),
      startedAt: new Date().toISOString(),
    })
    const old = new Dexie(name)
    old.version(3).stores(V3_SCHEMA)
    await old.open()
    await old
      .table('tasks')
      .update(String(data.tasks[0].id), { title: 'unrecognized partial state' })
    old.close()
    await initializeDatabase(next, ctx.desktop)
    expect((await readPayload(next)).tasks).toEqual(data.tasks)
    const preMigration = (await ctx.store.listSnapshots()).snapshots.find(
      (item) => item.purpose === 'pre-migration',
    )!
    expect((await parseBackup(await ctx.store.readSnapshot(preMigration.id))).data).toEqual(data)
  })
})
