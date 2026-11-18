import Dexie from 'dexie'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { safetyContext, stripV6QuoteSnapshots } from './safety-helpers'
import { V1_SCHEMA, V1_TABLES } from '../../src/data/schema'
import { StudyDatabase } from '../../src/data/database'
import { initializeDatabase } from '../../src/data/backup/bootstrap'
import { readNativeDatabase } from '../../src/data/backup/native-reader'
import { readPayload, replacePayload, makeBackup } from '../../src/data/backup/payload'
import { fingerprint, parseBackup, sealBackup, inspectBackup } from '../../src/shared/backup'
import type { RecoveryJournal } from '../../src/shared/backup-bridge'
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
async function legacy() {
  const oldData = Object.fromEntries(
    V1_TABLES.map((name) => [name, structuredClone(ctx.envelope.data[name])]),
  )
  oldData.tasks = oldData.tasks.map(({ kind, ...task }) => task)
  stripV6QuoteSnapshots(oldData)
  const name = `Test-Legacy-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(1).stores(V1_SCHEMA)
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const table of V1_TABLES)
      if (oldData[table].length) await old.table(table).bulkAdd(oldData[table])
  })
  old.close()
  const next = new StudyDatabase(name)
  extra.push(next)
  return { name, next, oldData }
}

describe('versioned migration with pre-upgrade files', () => {
  it('creates a durable V1 snapshot before upgrading and preserves every old row', async () => {
    const { name, next, oldData } = await legacy()
    await initializeDatabase(next, ctx.desktop)
    const result = await readPayload(next)
    for (const table of V1_TABLES)
      expect(await fingerprint({ [table]: result[table] }, true)).toBe(
        await fingerprint({ [table]: oldData[table] }, true),
      )
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(DATABASE_VERSION)
    const list = (await ctx.store.listSnapshots()).snapshots
    expect(list).toHaveLength(1)
    expect(list[0].purpose).toBe('pre-migration')
    expect(list[0].schemaVersion).toBe(1)
    const saved = await parseBackup(await ctx.store.readSnapshot(list[0].id))
    expect(saved.data).toEqual(oldData)
    expect((await ctx.store.status()).journal?.status).toBe('committed')
  })
  it('blocks a direct unprotected V1 open', async () => {
    const { name, next, oldData } = await legacy()
    await expect(next.open()).rejects.toThrow('快照')
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(1)
    expect((await readNativeDatabase(name))?.data).toEqual(oldData)
  })
  it('does not upgrade if the snapshot file cannot be saved', async () => {
    const { name, next, oldData } = await legacy()
    vi.spyOn(ctx.desktop.backup, 'saveSnapshot').mockRejectedValueOnce(new Error('disk full'))
    await expect(initializeDatabase(next, ctx.desktop)).rejects.toThrow('disk full')
    expect((await readNativeDatabase(name))?.schemaVersion).toBe(1)
    expect((await readNativeDatabase(name))?.data).toEqual(oldData)
  })
  it('rolls the native upgrade transaction back after a migration writer fails', async () => {
    const { name, next, oldData } = await legacy()
    next.close()
    const broken = new StudyDatabase(name, async (transaction, permit) => {
      await transaction.table('datasetMeta').add(permit.dataset)
      throw new Error('simulated migration failure')
    })
    extra.push(broken)
    await expect(initializeDatabase(broken, ctx.desktop)).rejects.toThrow('migration failure')
    const retained = await readNativeDatabase(name)
    expect(retained?.schemaVersion).toBe(1)
    expect(retained?.data).toEqual(oldData)
    expect((await ctx.store.status()).journal?.status).toBe('rolled-back')
  })
  it('can restore a V1 backup into the current version without changing the input file', async () => {
    const data = Object.fromEntries(V1_TABLES.map((name) => [name, ctx.envelope.data[name]]))
    data.tasks = data.tasks.map(({ kind, ...task }) => task)
    stripV6QuoteSnapshots(data)
    const file = await sealBackup({
      data,
      schemaVersion: 1,
      appVersion: '0.1.0',
      purpose: 'export',
      backupId: crypto.randomUUID(),
      datasetId: crypto.randomUUID(),
      exportedAt: new Date().toISOString(),
    })
    const original = JSON.stringify(file)
    const preview = await ctx.service.preview(original, 'legacy.json')
    expect(preview.inspection.migrated).toBe(true)
    await ctx.service.restore(preview)
    expect(await ctx.database.tasks.count()).toBe(1)
    expect((await ctx.database.datasetMeta.get('dataset'))?.datasetId).toBe(file.datasetId)
    expect(JSON.stringify(file)).toBe(original)
    const repeat = await ctx.service.preview(original, 'legacy-again.json')
    expect(repeat.identical).toBe(true)
  })
})

describe('restart after interrupted restores', () => {
  async function pending() {
    await ctx.study.setCompanion('cat')
    const before = await readPayload(ctx.database)
    const pre = await makeBackup(before, '0.2.0', 'pre-restore')
    const saved = await ctx.store.saveSnapshot(JSON.stringify(pre))
    const target = (await inspectBackup(ctx.envelope)).data
    const journal: RecoveryJournal = {
      operationId: crypto.randomUUID(),
      kind: 'restore',
      status: 'prepared',
      snapshotId: saved.id,
      targetFingerprint: await fingerprint(target, true),
      beforeFingerprint: await fingerprint(before, true),
      startedAt: new Date().toISOString(),
    }
    await ctx.store.writeJournal(journal)
    return { before, target, journal }
  }
  async function restart() {
    const name = ctx.database.name
    ctx.database.close()
    const reopened = new StudyDatabase(name)
    extra.push(reopened)
    await initializeDatabase(reopened, ctx.desktop)
    return reopened
  }
  it('recognizes a full commit even if the process stopped before journal completion', async () => {
    const { target } = await pending()
    await replacePayload(ctx.database, target)
    const reopened = await restart()
    expect(await fingerprint(await readPayload(reopened), true)).toBe(
      await fingerprint(target, true),
    )
    expect((await ctx.store.status()).journal?.status).toBe('committed')
  })
  it('recognizes an aborted transaction that left the original data intact', async () => {
    const { before } = await pending()
    const reopened = await restart()
    expect(await fingerprint(await readPayload(reopened), true)).toBe(
      await fingerprint(before, true),
    )
    expect((await ctx.store.status()).journal?.status).toBe('rolled-back')
  })
  it('restores the pre-operation snapshot if persisted contents match neither complete state', async () => {
    const { before } = await pending()
    await ctx.database.tasks.update(ctx.task.id, {
      title: 'simulated incomplete external contents',
    })
    const reopened = await restart()
    expect(await fingerprint(await readPayload(reopened), true)).toBe(
      await fingerprint(before, true),
    )
    expect((await ctx.store.status()).journal?.status).toBe('rolled-back')
  })
})
