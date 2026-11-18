import Dexie from 'dexie'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { safetyContext, stripV6QuoteSnapshots } from './safety-helpers'
import { V4_SCHEMA, V4_TABLES } from '../../src/data/schema'
import { StudyDatabase } from '../../src/data/database'
import { readPayload } from '../../src/data/backup/payload'
import { initializeDatabase } from '../../src/data/backup/bootstrap'
import { readNativeDatabase } from '../../src/data/backup/native-reader'
import { parseBackup, sealBackup, validateData, fingerprint } from '../../src/shared/backup'
import { FocusService } from '../../src/services/focus'
import { stamp } from '../../src/services/learning'
import { DATABASE_VERSION } from '../../src/shared/identity'
let ctx: Awaited<ReturnType<typeof safetyContext>>
const extra: StudyDatabase[] = []
beforeEach(async () => {
  ctx = await safetyContext()
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const d of extra.splice(0)) {
    d.close()
    await d.delete()
  }
  ctx.database.close()
  await ctx.database.delete()
})
async function legacy() {
  const at = '2027-02-01T01:00:00.000Z'
  await ctx.database.studySessions.add({
    ...stamp('legacy-learning', at),
    cycleId: ctx.cycle.id,
    taskId: ctx.task.id,
    studyDate: '2027-02-01',
    status: 'confirmed',
    timeMode: 'segments',
    durationOnlySeconds: null,
  })
  await ctx.database.timeSegments.add({
    ...stamp('legacy-segment', at),
    sessionId: 'legacy-learning',
    startedAt: at,
    endedAt: '2027-02-01T01:20:00.000Z',
  })
  const raw = await readPayload(ctx.database)
  const data = Object.fromEntries(V4_TABLES.map((name) => [name, structuredClone(raw[name])]))
  stripV6QuoteSnapshots(data)
  data.migrationHistory = data.migrationHistory.map((row) => ({ ...row, toVersion: 4 }))
  validateData(data, 4)
  const name = `Test-V4-${crypto.randomUUID()}`,
    old = new Dexie(name)
  old.version(4).stores(V4_SCHEMA)
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const table of V4_TABLES)
      if (data[table].length) await old.table(table).bulkAdd(data[table])
  })
  old.close()
  const next = new StudyDatabase(name)
  extra.push(next)
  return { data, name, next }
}
it('protects V4 before V5, preserves every original row including actual records, and adds only an empty work table', async () => {
  const { data, name, next } = await legacy()
  await initializeDatabase(next, ctx.desktop)
  expect((await readNativeDatabase(name))?.schemaVersion).toBe(DATABASE_VERSION)
  const actual = await readPayload(next)
  for (const table of V4_TABLES)
    if (table === 'migrationHistory') {
      for (const row of data[table]) expect(actual[table]).toContainEqual(row)
    } else expect(actual[table]).toEqual(data[table])
  expect(actual.focusTimers).toEqual([])
  const file = (await ctx.store.listSnapshots()).snapshots.find(
    (s) => s.purpose === 'pre-migration',
  )!
  expect(file.schemaVersion).toBe(4)
  expect((await parseBackup(await ctx.store.readSnapshot(file.id))).data).toEqual(data)
  expect((await ctx.store.status()).journal?.status).toBe('committed')
})
it('blocks unprotected opens and snapshot failure; failed V5 writer leaves V4 intact', async () => {
  const { data, name, next } = await legacy()
  await expect(next.open()).rejects.toThrow('快照')
  vi.spyOn(ctx.desktop.backup, 'saveSnapshot').mockRejectedValueOnce(new Error('disk full'))
  await expect(initializeDatabase(next, ctx.desktop)).rejects.toThrow('disk full')
  expect((await readNativeDatabase(name))?.data).toEqual(data)
  const broken = new StudyDatabase(name, undefined, undefined, undefined, async (transaction) => {
    await transaction.table('focusTimers').add({ id: 'partial' })
    throw new Error('V5 failed')
  })
  extra.push(broken)
  await expect(initializeDatabase(broken, ctx.desktop)).rejects.toThrow('V5 failed')
  expect((await readNativeDatabase(name))?.schemaVersion).toBe(4)
  expect((await readNativeDatabase(name))?.data).toEqual(data)
})
it('V4 import is an in-memory conversion; restoring clears newer work state with a verified safety copy and repeats are no-ops', async () => {
  const { data } = await legacy()
  const envelope = await sealBackup({
    data,
    schemaVersion: 4,
    appVersion: '0.4.0',
    backupId: crypto.randomUUID(),
    datasetId: String(data.datasetMeta[0].datasetId),
    exportedAt: '2027-02-01T02:00:00.000Z',
    purpose: 'export',
  })
  const original = JSON.stringify(envelope)
  const service = new FocusService(ctx.database)
  await service.start({
    cycleId: ctx.cycle.id,
    taskId: ctx.task.id,
    chapterId: null,
    targetSeconds: 25,
  })
  const preview = await ctx.service.preview(original, 'v4.json')
  expect(preview.inspection.migrated).toBe(true)
  expect(preview.inspection.data.focusTimers).toEqual([])
  await ctx.service.restore(preview)
  expect(await ctx.database.focusTimers.count()).toBe(0)
  expect(
    (await ctx.store.listSnapshots()).snapshots.some(
      (s) => s.purpose === 'pre-restore' && s.counts.focusTimers === 1,
    ),
  ).toBe(true)
  const second = await ctx.service.preview(original, 'v4.json')
  expect(second.identical).toBe(true)
  expect((await ctx.service.restore(second)).unchanged).toBe(true)
  expect(JSON.stringify(envelope)).toBe(original)
})
it('an interrupted V4 restore is resolved before migration using its original schema', async () => {
  const { data, name, next } = await legacy()
  const backup = await sealBackup({
    data,
    schemaVersion: 4,
    appVersion: '0.4.0',
    backupId: crypto.randomUUID(),
    datasetId: String(data.datasetMeta[0].datasetId),
    exportedAt: '2027-02-01T02:00:00.000Z',
    purpose: 'pre-restore',
  })
  const saved = await ctx.store.saveSnapshot(JSON.stringify(backup))
  await ctx.store.writeJournal({
    operationId: crypto.randomUUID(),
    kind: 'restore',
    status: 'prepared',
    snapshotId: saved.id,
    beforeFingerprint: await fingerprint(data, true),
    targetFingerprint: '0'.repeat(64),
    startedAt: backup.exportedAt,
  })
  const old = new Dexie(name)
  old.version(4).stores(V4_SCHEMA)
  await old.open()
  await old.table('tasks').clear()
  old.close()
  await initializeDatabase(next, ctx.desktop)
  expect(await next.tasks.toArray()).toEqual(data.tasks)
  expect((await readNativeDatabase(name))?.schemaVersion).toBe(DATABASE_VERSION)
})
