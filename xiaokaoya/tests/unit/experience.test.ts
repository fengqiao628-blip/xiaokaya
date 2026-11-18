import Dexie from 'dexie'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { safetyContext, stripV6QuoteSnapshots } from './safety-helpers'
import { StudyDatabase } from '../../src/data/database'
import { V5_SCHEMA, V5_TABLES } from '../../src/data/schema'
import { quotes as legacyQuotes } from '../../src/data/catalog'
import { quoteLibrary } from '../../src/data/quote-library'
import { v6Extension, defaultExperience } from '../../src/data/experience-defaults'
import { initializeDatabase } from '../../src/data/backup/bootstrap'
import { readNativeDatabase } from '../../src/data/backup/native-reader'
import { readPayload, makeBackup } from '../../src/data/backup/payload'
import {
  validateData,
  inspectBackup,
  fingerprint,
  sealBackup,
  parseBackup,
} from '../../src/shared/backup'
import { ExperienceService } from '../../src/services/experience'
import { StudyService } from '../../src/services/study'
import { encouragementLibrary } from '../../src/companions/encouragement'
import {
  configurePartnerAudio,
  mutePartnerAudioUntilSaved,
  playPartnerSound,
  unlockPartnerAudio,
} from '../../src/companions/audio'
let ctx: Awaited<ReturnType<typeof safetyContext>>, service: ExperienceService
const extra: StudyDatabase[] = []
beforeEach(async () => {
  ctx = await safetyContext()
  service = new ExperienceService(ctx.database)
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const d of extra.splice(0)) {
    d.close()
    await d.delete()
  }
  ctx.database.close()
  await ctx.database.delete()
})
const input = {
  text: '今天的小小投入，值得好好记住。',
  category: '我的鼓励',
  author: '自己',
  work: '学习日记',
  sourceTitle: '个人记录',
  sourceUrl: '',
}
async function legacy() {
  const payload = await readPayload(ctx.database)
  const data = Object.fromEntries(V5_TABLES.map((t) => [t, structuredClone(payload[t])]))
  stripV6QuoteSnapshots(data)
  data.quotes = structuredClone(legacyQuotes) as unknown as Record<string, unknown>[]
  for (const table of ['dailyQuotes', 'quoteHistory'])
    data[table] = data[table].map((q) => ({ ...q, quoteId: 'q4', text: legacyQuotes[3].text }))
  data.migrationHistory = data.migrationHistory.map((row) => ({ ...row, toVersion: 5 }))
  validateData(data, 5)
  const name = `Test-V5-${crypto.randomUUID()}`,
    old = new Dexie(name)
  old.version(5).stores(V5_SCHEMA)
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const table of V5_TABLES)
      if (data[table].length) await old.table(table).bulkAdd(data[table])
  })
  old.close()
  const next = new StudyDatabase(name)
  extra.push(next)
  return { data, name, next }
}
it('ships 200 stable, distinct daily entries, independent of the 120 state messages, with accurate attribution records', () => {
  expect(quoteLibrary).toHaveLength(200)
  expect(new Set(quoteLibrary.map((q) => q.id)).size).toBe(200)
  expect(new Set(quoteLibrary.map((q) => q.text)).size).toBe(200)
  const dynamic = new Set<string>(Object.values(encouragementLibrary).flat())
  expect(quoteLibrary.some((q) => dynamic.has(q.text))).toBe(false)
  expect(quoteLibrary.filter((q) => q.attribution.kind === 'poetry')).toHaveLength(18)
  expect(quoteLibrary.filter((q) => q.attribution.kind === 'saying')).toHaveLength(14)
  for (const q of quoteLibrary.filter((q) => q.attribution.kind !== 'encouragement')) {
    expect(q.attribution.sourceUrl).toMatch(/^https:/)
    expect(q.attribution.author).toBeTruthy()
    expect(q.attribution.work).toBeTruthy()
  }
  expect(quoteLibrary.slice(0, 8).map(({ attribution: _, ...q }) => q)).toEqual(legacyQuotes)
})
it('protects V5 before migration, adds 192 entries and defaults while preserving every original row and daily choice', async () => {
  const { data, next } = await legacy()
  await initializeDatabase(next, ctx.desktop)
  const current = await readPayload(next)
  for (const table of V5_TABLES) {
    if (table === 'migrationHistory' || table === 'quotes')
      for (const row of data[table]) expect(current[table]).toContainEqual(row)
    else expect(current[table]).toEqual(data[table])
  }
  expect(current.quotes).toHaveLength(200)
  expect(current.quoteDetails).toHaveLength(200)
  expect(current.quoteFavorites).toEqual([])
  expect(current.experienceSettings).toEqual([defaultExperience()])
  const snapshot = (await ctx.store.listSnapshots()).snapshots.find(
    (s) => s.purpose === 'pre-migration',
  )!
  expect(snapshot.schemaVersion).toBe(5)
  expect((await parseBackup(await ctx.store.readSnapshot(snapshot.id))).data).toEqual(data)
  const before = await fingerprint(current, true)
  await initializeDatabase(next, ctx.desktop)
  expect(await fingerprint(await readPayload(next), true)).toBe(before)
})
it('never assigns a built-in author to an ID collision or overwrites imported text', () => {
  const old = [
    { ...legacyQuotes[0], text: '自己改过的旧语句' },
    { id: 'external', text: '原文件内容', category: '旧分类' },
  ]
  const extension = v6Extension(old)
  expect(extension.added.some((q) => q.id === 'q1')).toBe(false)
  expect(extension.details.find((q) => q.id === 'q1')).toMatchObject({
    origin: 'imported',
    author: '',
  })
  expect(old[0].text).toBe('自己改过的旧语句')
})
it('blocks V5 changes on snapshot save/readback failure or an unprotected open', async () => {
  const { name, data, next } = await legacy()
  await expect(next.open()).rejects.toThrow('快照')
  vi.spyOn(ctx.desktop.backup, 'saveSnapshot').mockRejectedValueOnce(new Error('disk full'))
  await expect(initializeDatabase(next, ctx.desktop)).rejects.toThrow('disk full')
  vi.spyOn(ctx.desktop.backup, 'readSnapshot').mockResolvedValueOnce('{}')
  await expect(initializeDatabase(next, ctx.desktop)).rejects.toThrow()
  expect(await readNativeDatabase(name)).toEqual({ schemaVersion: 5, data })
})
it('atomically rolls back a partially written V6 migration to the exact original V5 schema and rows', async () => {
  const { name, data } = await legacy()
  const broken = new StudyDatabase(name, undefined, undefined, undefined, undefined, async (tx) => {
    await tx.table('quotes').add({ id: 'partial', text: '半条数据', category: '测试' })
    await tx.table('experienceSettings').add(defaultExperience())
    throw new Error('V6 injected failure')
  })
  extra.push(broken)
  await expect(initializeDatabase(broken, ctx.desktop)).rejects.toThrow('injected')
  expect(await readNativeDatabase(name)).toEqual({ schemaVersion: 5, data })
  expect((await ctx.store.status()).journal?.status).toBe('rolled-back')
})
it('recognizes a committed migration after interruption of the journal write without applying it twice', async () => {
  const { name, data, next } = await legacy()
  const write = ctx.desktop.backup.writeJournal,
    spy = vi.spyOn(ctx.desktop.backup, 'writeJournal')
  spy.mockImplementationOnce(write).mockRejectedValueOnce(new Error('journal interrupted'))
  await expect(initializeDatabase(next, ctx.desktop)).rejects.toThrow('interrupted')
  next.close()
  spy.mockRestore()
  const reopened = new StudyDatabase(name)
  extra.push(reopened)
  await initializeDatabase(reopened, ctx.desktop)
  expect((await ctx.store.status()).journal?.status).toBe('committed')
  expect(await reopened.migrationHistory.count()).toBe(data.migrationHistory.length + 1)
  expect(await reopened.tasks.toArray()).toEqual(data.tasks)
})
it('migrates a V5 JSON in staging deterministically, keeps the source unchanged, and repeated restore is a no-op', async () => {
  const { data } = await legacy()
  const envelope = await sealBackup({
    data,
    schemaVersion: 5,
    appVersion: '0.6.0',
    backupId: crypto.randomUUID(),
    datasetId: String(data.datasetMeta[0].datasetId),
    exportedAt: '2026-11-17T01:00:00.000Z',
    purpose: 'export',
  })
  const source = JSON.stringify(envelope),
    preview = await ctx.service.preview(source, 'v5.json')
  expect(preview.inspection.migrated).toBe(true)
  await ctx.service.restore(preview)
  expect((await ctx.service.preview(source, 'v5.json')).identical).toBe(true)
  expect(JSON.stringify(envelope)).toBe(source)
  expect((await inspectBackup(envelope)).data).toEqual(preview.inspection.data)
})
it('keeps favorite operations idempotent and retains daily/history snapshots when custom text is edited or archived', async () => {
  const id = `user-${crypto.randomUUID()}`,
    study = new StudyService(ctx.database)
  await service.saveCustom(input, id)
  await service.favorite(id, true)
  await service.favorite(id, true)
  expect(await ctx.database.quoteFavorites.count()).toBe(1)
  await study.chooseQuote('2027-02-01', id)
  const before = await ctx.database.dailyQuotes.get('2027-02-01'),
    history = await ctx.database.quoteHistory.toArray()
  await service.saveCustom({ ...input, text: '修改后的正文', author: '新署名' }, id, 1)
  await service.archive((await ctx.database.quoteDetails.get(id))!, true)
  expect(await ctx.database.dailyQuotes.get('2027-02-01')).toEqual(before)
  expect(await ctx.database.quoteHistory.toArray()).toEqual(history)
  expect(before?.attribution?.author).toBe('自己')
  expect((await ctx.database.quoteFavorites.get(id))?.active).toBe(true)
  await expect(study.chooseQuote('2027-02-01', id)).rejects.toThrow('暂无')
})
it('saves settings safely; category changes preserve today until an explicit new choice', async () => {
  const current = (await ctx.database.experienceSettings.get('experience'))!,
    d = ctx.database
  const { id: _, createdAt: __, updatedAt: ___, revision: ____, ...values } = current
  const old = await d.dailyQuotes.get('2027-02-01')
  await service.saveSettings(current, {
    ...values,
    quoteCategory: '古典诗词',
    motion: 'off',
    volume: 0.2,
  })
  await ctx.study.dailyQuote('2027-02-01')
  expect(await d.dailyQuotes.get('2027-02-01')).toEqual(old)
  const selected = await ctx.study.dailyQuote('2027-02-01', true)
  expect(selected.attribution?.kind).toBe('poetry')
  await expect(service.saveSettings(current, { ...values, volume: 4 })).rejects.toThrow('无效')
  await expect(service.saveSettings(current, values)).rejects.toThrow('已更新')
})
it('round-trips all V6 data, including preferences/favorites/custom snapshots; a restore failure retains the complete current dataset', async () => {
  const id = `user-${crypto.randomUUID()}`
  await service.saveCustom(input, id)
  await service.favorite(id, true)
  await ctx.study.chooseQuote('2027-02-01', id)
  const before = await readPayload(ctx.database),
    backup = await makeBackup(before, '0.7.0', 'export')
  expect((await inspectBackup(backup)).data).toEqual(backup.data)
  await service.favorite(id, false)
  const changed = await readPayload(ctx.database),
    preview = await ctx.service.preview(JSON.stringify(backup), 'v6.json')
  const fail = () => {
    throw new Error('V6 favorite write failed')
  }
  ctx.database.quoteFavorites.hook('creating', fail)
  await expect(ctx.service.restore(preview)).rejects.toThrow('回滚')
  ctx.database.quoteFavorites.hook('creating').unsubscribe(fail)
  expect(await fingerprint(await readPayload(ctx.database), true)).toBe(
    await fingerprint(changed, true),
  )
  await ctx.service.restore(await ctx.service.preview(JSON.stringify(backup), 'v6.json'))
  expect(await fingerprint(await readPayload(ctx.database), true)).toBe(
    await fingerprint(before, true),
  )
})
it('rejects orphan metadata, missing settings, spoofed legacy snapshots and unsafe source URLs', async () => {
  const data = await readPayload(ctx.database)
  for (const mutate of [
    (d: typeof data) => {
      d.quoteFavorites.push({ ...d.quoteDetails[0], active: true, id: 'missing' })
    },
    (d: typeof data) => {
      d.experienceSettings = []
    },
    (d: typeof data) => {
      d.quoteDetails[0].sourceUrl = 'javascript:alert(1)'
    },
  ]) {
    const broken = structuredClone(data)
    mutate(broken)
    expect(() => validateData(broken, 6)).toThrow()
  }
  await expect(
    service.saveCustom({ ...input, sourceUrl: 'javascript:alert(1)' }, 'user-invalid'),
  ).rejects.toThrow('https')
  const { data: old } = await legacy()
  old.dailyQuotes[0].attribution = data.dailyQuotes[0].attribution
  expect(() => validateData(old, 5)).toThrow('V6')
})
it('mutes by default, plays each eligible event once, honors both sound switches and stops all active tones', async () => {
  const start = vi.fn(),
    stop = vi.fn(),
    gain = {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      value: 0,
    }
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      currentTime = 0
      destination = {}
      createGain() {
        return { gain, connect() {}, disconnect() {} }
      }
      createOscillator() {
        return {
          frequency: gain,
          type: 'sine',
          start,
          stop,
          connect() {},
          disconnect() {},
          onended: null,
        }
      }
    },
  )
  const settings = defaultExperience()
  configurePartnerAudio(settings)
  expect(await unlockPartnerAudio()).toBe(false)
  expect(playPartnerSound('duck', 'start', settings, 'start')).toBe(false)
  settings.soundEnabled = true
  configurePartnerAudio(settings)
  expect(await unlockPartnerAudio()).toBe(true)
  expect(playPartnerSound('duck', 'start', settings, 'start')).toBe(true)
  expect(playPartnerSound('duck', 'start', settings, 'start')).toBe(false)
  expect(start).toHaveBeenCalledTimes(2)
  mutePartnerAudioUntilSaved(settings.revision)
  configurePartnerAudio(settings)
  expect(playPartnerSound('duck', 'click', settings, 'stale-while-saving')).toBe(false)
  configurePartnerAudio({ ...settings, revision: settings.revision + 1, soundEnabled: false })
  configurePartnerAudio(settings)
  expect(playPartnerSound('duck', 'due', { ...settings, dueSound: false }, 'due-off')).toBe(false)
  expect(
    playPartnerSound('duck', 'click', { ...settings, partnerSounds: false }, 'partner-off'),
  ).toBe(false)
  configurePartnerAudio({ ...settings, soundEnabled: false })
  expect(stop.mock.calls.length).toBeGreaterThanOrEqual(4)
  expect(playPartnerSound('duck', 'complete', settings, 'off')).toBe(false)
})
