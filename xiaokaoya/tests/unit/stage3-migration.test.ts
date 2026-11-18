import Dexie from 'dexie'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { safetyContext, stripV6QuoteSnapshots } from './safety-helpers'
import { V2_SCHEMA, V2_TABLES } from '../../src/data/schema'
import { StudyDatabase } from '../../src/data/database'
import { initializeDatabase } from '../../src/data/backup/bootstrap'
import { readNativeDatabase } from '../../src/data/backup/native-reader'
import { readPayload } from '../../src/data/backup/payload'
import { fingerprint, parseBackup, sealBackup } from '../../src/shared/backup'
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
async function legacyV2() {
  const data = Object.fromEntries(
    V2_TABLES.map((table) => [table, structuredClone(ctx.envelope.data[table])]),
  )
  data.migrationHistory = data.migrationHistory.map((row) => ({ ...row, toVersion: 2 }))
  data.tasks = data.tasks.map(({ kind, ...task }) => task)
  stripV6QuoteSnapshots(data)
  const name = `Test-V2-${crypto.randomUUID()}`,
    old = new Dexie(name)
  old.version(2).stores(V2_SCHEMA)
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const table of V2_TABLES)
      if (data[table].length) await old.table(table).bulkAdd(data[table])
  })
  old.close()
  const next = new StudyDatabase(name)
  extra.push(next)
  return { name, data, next }
}

describe('V2 to V3 and old-file compatibility', () => {
  it('snapshots V2 before upgrade, retains every original row and assigns no inferred exam results', async () => {
    const { name, data, next } = await legacyV2()
    await initializeDatabase(next, ctx.desktop)
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(DATABASE_VERSION)
    const actual = await readPayload(next)
    for (const table of V2_TABLES) {
      if (table === 'migrationHistory')
        for (const old of data[table]) expect(actual[table]).toContainEqual(old)
      else expect(actual[table]).toEqual(data[table])
    }
    expect(actual.cycleStatuses).toHaveLength(data.cycles.length)
    for (const status of actual.cycleStatuses)
      expect(status).toMatchObject({
        registrationStatus: 'not_planned',
        examResult: 'unrecorded',
        examDate: null,
      })
    expect(actual.materials).toEqual([])
    expect(actual.chapters).toEqual([])
    const snapshots = (await ctx.store.listSnapshots()).snapshots
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].schemaVersion).toBe(2)
    expect((await parseBackup(await ctx.store.readSnapshot(snapshots[0].id))).data).toEqual(data)
    expect((await ctx.store.status()).journal?.status).toBe('committed')
  })
  it('blocks direct V2 upgrade without a verified snapshot', async () => {
    const { name, data, next } = await legacyV2()
    await expect(next.open()).rejects.toThrow('快照')
    expect((await readNativeDatabase(name))?.data).toEqual(data)
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(2)
  })
  it('retains V2 if snapshot readback fails', async () => {
    const { name, data, next } = await legacyV2()
    vi.spyOn(ctx.desktop.backup, 'readSnapshot').mockResolvedValueOnce('{}')
    await expect(initializeDatabase(next, ctx.desktop)).rejects.toThrow()
    expect((await readNativeDatabase(name))?.data).toEqual(data)
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(2)
  })
  it('rolls the native V3 version transaction back if adding new rows fails', async () => {
    const { name, data } = await legacyV2()
    const broken = new StudyDatabase(name, undefined, async (transaction, permit) => {
      await transaction
        .table('cycleStatuses')
        .add({ id: data.cycles[0].id, createdAt: permit.record.appliedAt })
      throw new Error('V3 simulated failure')
    })
    extra.push(broken)
    await expect(initializeDatabase(broken, ctx.desktop)).rejects.toThrow('V3 simulated failure')
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(2)
    expect((await readNativeDatabase(name))?.data).toEqual(data)
    expect((await ctx.store.status()).journal?.status).toBe('rolled-back')
  })
  it('imports a V2 file deterministically, preserves dataset ID and makes repeated restore a no-op', async () => {
    const { data } = await legacyV2()
    const envelope = await sealBackup({
      data,
      schemaVersion: 2,
      appVersion: '0.2.0',
      datasetId: String(data.datasetMeta[0].datasetId),
      backupId: crypto.randomUUID(),
      purpose: 'export',
      exportedAt: new Date().toISOString(),
    })
    const source = JSON.stringify(envelope),
      first = await ctx.service.preview(source, 'v2.json')
    expect(first.inspection.migrated).toBe(true)
    expect(first.inspection.data.cycleStatuses).toHaveLength(data.cycles.length)
    await ctx.service.restore(first)
    expect((await ctx.database.datasetMeta.get('dataset'))?.datasetId).toBe(envelope.datasetId)
    expect((await ctx.service.preview(source, 'v2.json')).identical).toBe(true)
    expect(JSON.stringify(envelope)).toBe(source)
    const rows = await readPayload(ctx.database)
    for (const table of V2_TABLES.filter((table) => table !== 'migrationHistory'))
      expect(rows[table]).toEqual(data[table])
  })
  it('recovers an interrupted V2 restore using its original schema before snapshotting for V3', async () => {
    const { name, data, next } = await legacyV2()
    const pre = await sealBackup({
      data,
      schemaVersion: 2,
      appVersion: '0.2.0',
      datasetId: String(data.datasetMeta[0].datasetId),
      backupId: crypto.randomUUID(),
      purpose: 'pre-restore',
      exportedAt: new Date().toISOString(),
    })
    const saved = await ctx.store.saveSnapshot(JSON.stringify(pre))
    const target = structuredClone(data)
    target.tasks[0].title = 'target that was never committed'
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
    old.version(2).stores(V2_SCHEMA)
    await old.open()
    await old
      .table('tasks')
      .update(String(data.tasks[0].id), { title: 'unknown interrupted contents' })
    old.close()
    await initializeDatabase(next, ctx.desktop)
    const actual = await readPayload(next)
    expect(actual.tasks).toEqual(data.tasks)
    const migration = (await ctx.store.listSnapshots()).snapshots.find(
      (item) => item.purpose === 'pre-migration',
    )!
    expect((await parseBackup(await ctx.store.readSnapshot(migration.id))).data).toEqual(data)
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(DATABASE_VERSION)
  })
})
