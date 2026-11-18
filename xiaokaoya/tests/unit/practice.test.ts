import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { safetyContext } from './safety-helpers'
import { StudyDatabase } from '../../src/data/database'
import { V6_SCHEMA, V6_TABLES } from '../../src/data/schema'
import { readPayload, makeBackup } from '../../src/data/backup/payload'
import { initializeDatabase } from '../../src/data/backup/bootstrap'
import { readNativeDatabase } from '../../src/data/backup/native-reader'
import { PracticeService } from '../../src/services/practice'
import { FocusService } from '../../src/services/focus'
import { LearningService } from '../../src/services/learning'
import { practiceAccuracy } from '../../src/domain/practice'
import { validateData, parseBackup, inspectBackup, fingerprint } from '../../src/shared/backup'
import { DATABASE_VERSION } from '../../src/shared/identity'
let ctx: Awaited<ReturnType<typeof safetyContext>>, service: PracticeService
const extra: StudyDatabase[] = []
beforeEach(async () => {
  ctx = await safetyContext()
  service = new PracticeService(ctx.database)
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const d of [...extra.splice(0), ctx.database]) {
    d.close()
    await d.delete()
  }
})
const practiceValue = () => ({
  cycleId: ctx.cycle.id,
  chapterId: null,
  studySessionId: null,
  date: '2026-11-17',
  source: '章节自测',
  total: 10,
  correct: 6,
  wrong: 2,
  unanswered: 2,
  notes: '',
  status: 'confirmed' as const,
})
const mistakeValue = () => ({
  cycleId: ctx.cycle.id,
  chapterId: null,
  practiceSetId: null as string | null,
  date: '2026-11-17',
  stem: '原来的题目',
  options: 'A.甲\nB.乙',
  answer: 'A',
  explanation: '原解析',
  reason: '概念混淆',
  tags: ['概念'],
  mastery: 'unreviewed' as const,
  archivedAt: null,
})
const examValue = () => ({
  cycleId: ctx.cycle.id,
  title: '第一套模拟',
  date: '2026-11-17',
  targetSeconds: 60,
  maximumScore: 100,
  score: null as number | null,
  status: 'prepared' as const,
  notes: '',
})
async function legacy() {
  const raw = await readPayload(ctx.database),
    data = Object.fromEntries(V6_TABLES.map((t) => [t, structuredClone(raw[t])]))
  data.migrationHistory = data.migrationHistory.map((row) => ({ ...row, toVersion: 6 }))
  validateData(data, 6)
  const name = `Test-V6-${crypto.randomUUID()}`,
    old = new Dexie(name)
  old.version(6).stores(V6_SCHEMA)
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const t of V6_TABLES) if (data[t].length) await old.table(t).bulkAdd(data[t])
  })
  old.close()
  const next = new StudyDatabase(name)
  extra.push(next)
  return { name, data, next }
}
it('upgrades V6 after verified protection, leaves every business row unchanged and initializes exactly six empty tables', async () => {
  const { next, data } = await legacy()
  await initializeDatabase(next, ctx.desktop)
  const current = await readPayload(next)
  for (const name of V6_TABLES)
    if (name !== 'migrationHistory') expect(current[name]).toEqual(data[name])
  expect(current.migrationHistory).toHaveLength(data.migrationHistory.length + 1)
  expect(Object.keys(current).filter((n) => !V6_TABLES.includes(n as never))).toHaveLength(6)
  const snapshot = (await ctx.store.listSnapshots()).snapshots.find(
    (s) => s.purpose === 'pre-migration',
  )!
  expect((await parseBackup(await ctx.store.readSnapshot(snapshot.id))).data).toEqual(data)
  expect(snapshot.schemaVersion).toBe(6)
  const hash = await fingerprint(current, true)
  await initializeDatabase(next, ctx.desktop)
  expect(await fingerprint(await readPayload(next), true)).toBe(hash)
})
it('keeps the exact V6 schema on missing protection, readback failure and a partially written V7 transaction', async () => {
  const { name, data, next } = await legacy()
  await expect(next.open()).rejects.toThrow('快照')
  vi.spyOn(ctx.desktop.backup, 'readSnapshot').mockResolvedValueOnce('{}')
  await expect(initializeDatabase(next, ctx.desktop)).rejects.toThrow()
  const broken = new StudyDatabase(
    name,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (tx) => {
      await tx.table('practiceSets').add({ id: 'partial' })
      throw new Error('V7 injected')
    },
  )
  extra.push(broken)
  await expect(initializeDatabase(broken, ctx.desktop)).rejects.toThrow('V7 injected')
  expect(await readNativeDatabase(name)).toEqual({ schemaVersion: 6, data })
  expect((await ctx.store.status()).journal?.status).toBe('rolled-back')
})
it('uses answered questions for accuracy, allows zero questions and partial mistake collection; retries do not duplicate', async () => {
  const op = crypto.randomUUID(),
    value = practiceValue()
  const id = await service.savePractice(value, undefined, op)
  await service.savePractice(value, undefined, op)
  await service.saveMistake({ ...mistakeValue(), practiceSetId: id })
  expect(await ctx.database.practiceSets.count()).toBe(1)
  expect(practiceAccuracy(await ctx.database.practiceSets.toArray())).toEqual({
    correct: 6,
    answered: 8,
    accuracy: 0.75,
  })
  await expect(service.savePractice({ ...value, total: 9 })).rejects.toThrow('总题数')
  expect(practiceAccuracy([]).accuracy).toBeNull()
  const zero = await service.savePractice({
    ...value,
    total: 0,
    correct: 0,
    wrong: 0,
    unanswered: 0,
  })
  expect(practiceAccuracy([(await ctx.database.practiceSets.get(zero))!]).accuracy).toBeNull()
})
it('preserves append-only review question snapshots and requires a fresh revision for edits', async () => {
  const id = await service.saveMistake(mistakeValue()),
    original = (await ctx.database.mistakeItems.get(id))!
  const op = crypto.randomUUID(),
    review = { date: '2026-11-17', result: 'wrong' as const, notes: '第二次还需复习' }
  await service.review(original, review, op)
  await service.review(original, review, op)
  await service.saveMistake(
    { ...mistakeValue(), stem: '后来修改题干', answer: 'B', mastery: 'mastered' },
    original,
  )
  expect((await ctx.database.mistakeReviews.toArray())[0].question).toMatchObject({
    stem: '原来的题目',
    answer: 'A',
  })
  expect(await ctx.database.mistakeReviews.count()).toBe(1)
  await expect(service.saveMistake(mistakeValue(), original)).rejects.toThrow('变化')
})
it('distinguishes unrecorded and zero scores; prevents scores above max and orphan/cross-cycle references', async () => {
  const id = await service.saveExam(examValue()),
    exam = (await ctx.database.mockExams.get(id))!
  expect(exam.score).toBeNull()
  await service.saveExam({ ...examValue(), score: 0 }, exam)
  expect((await ctx.database.mockExams.get(id))!.score).toBe(0)
  await expect(service.saveExam({ ...examValue(), score: 101 })).rejects.toThrow('满分')
  const data = await readPayload(ctx.database)
  data.mockExams[0].timerId = 'missing'
  expect(() => validateData(data, DATABASE_VERSION)).toThrow('不存在')
})
it('atomically binds the existing timer, blocks a second timer and counts confirmed seconds once', async () => {
  const id = await service.saveExam(examValue()),
    at = Date.parse('2026-11-17T01:00:00Z')
  let elapsed = 0
  const f = new FocusService(ctx.database, { wall: () => at + elapsed, mono: () => elapsed })
  const timer = await f.start({
    cycleId: ctx.cycle.id,
    taskId: null,
    chapterId: null,
    targetSeconds: 60,
    mockExamId: id,
  })
  expect((await ctx.database.mockExams.get(id))!.timerId).toBe(timer.id)
  await expect(
    f.start({ cycleId: ctx.cycle.id, taskId: null, chapterId: null, targetSeconds: 60 }),
  ).rejects.toThrow('已有')
  for (let i = 0; i < 6; i++) {
    elapsed += 10000
    await f.pulse()
  }
  expect((await ctx.database.focusTimers.get(timer.id))!.status).toBe('review')
  expect(await ctx.database.studySessions.count()).toBe(0)
  // Existing save confirmation API remains the sole source of canonical records.
  await f.save((await ctx.database.focusTimers.get(timer.id))!)
  const reportId = await service.generateReport(2027)
  expect((await ctx.database.reportSnapshots.get(reportId))!.metrics).toMatchObject({
    actualSeconds: 60,
    companionSeconds: 60,
  })
})
it('freezes annual cycle history across calendar years and appends a new version after corrections', async () => {
  const learning = new LearningService(ctx.database)
  const [sessionId] = await learning.manual({
    cycleId: ctx.cycle.id,
    taskId: null,
    chapterId: null,
    notes: '',
    mode: 'range',
    date: '2026-11-17',
    seconds: 60,
    startedAt: '2026-11-17T01:00:00Z',
    endedAt: '2026-11-17T01:01:00Z',
    overlapAcknowledged: false,
  })
  await service.savePractice(practiceValue())
  await service.saveExam(examValue())
  const id = await service.generateReport(2027, '首次冻结'),
    old = (await ctx.database.reportSnapshots.get(id))!
  const p = (await ctx.database.practiceSets.toArray())[0]
  await service.savePractice({ ...practiceValue(), status: 'voided' }, p)
  await service.saveMistake(mistakeValue())
  await learning.setStatus(
    (await ctx.database.studySessions.get(sessionId))!,
    'voided',
    '纠正重复记录',
  )
  const second = (await ctx.database.reportSnapshots.get(
    await service.generateReport(2027, '纠正后'),
  ))!
  expect(await ctx.database.reportSnapshots.get(id)).toEqual(old)
  expect(old.metrics.accuracy).toBe(0.75)
  expect(second.metrics.accuracy).toBeNull()
  expect(old.metrics.actualSeconds).toBe(60)
  expect(second.metrics.actualSeconds).toBe(0)
  expect(second.version).toBe(2)
  expect(second.sourceFingerprint).not.toBe(old.sourceFingerprint)
  expect(old.metrics.exams[0].score).toBeNull()
})
it('round-trips all six tables and rolls back interrupted replacement without losing reviews/reports', async () => {
  const p = await service.savePractice(practiceValue())
  const m = await service.saveMistake({ ...mistakeValue(), practiceSetId: p })
  await service.review((await ctx.database.mistakeItems.get(m))!, {
    date: '2026-11-17',
    result: 'correct',
    notes: '',
  })
  const e = await service.saveExam(examValue())
  await service.saveQuestion({
    mockExamId: e,
    chapterId: null,
    stem: '模拟题',
    options: '',
    answer: '答案',
    explanation: '',
    response: '',
    points: 10,
    score: null,
  })
  await service.generateReport(2027)
  const before = await readPayload(ctx.database),
    envelope = await makeBackup(before, '0.8.0', 'export')
  const inspection = await inspectBackup(await parseBackup(JSON.stringify(envelope)))
  expect(inspection.data).toEqual(before)
  const op = await service.saveMistake({ ...mistakeValue(), stem: '备份后新增' })
  const preview = await ctx.service.preview(JSON.stringify(envelope), 'stage8.json')
  const stable = await fingerprint(await readPayload(ctx.database), true)
  const hook = () => {
    throw new Error('review write fault')
  }
  ctx.database.mistakeReviews.hook('creating', hook)
  await expect(ctx.service.restore(preview)).rejects.toThrow('fault')
  ctx.database.mistakeReviews.hook('creating').unsubscribe(hook)
  expect(await fingerprint(await readPayload(ctx.database), true)).toBe(stable)
  await ctx.service.restore(await ctx.service.preview(JSON.stringify(envelope), 'stage8.json'))
  expect(await ctx.database.mistakeItems.get(op)).toBeUndefined()
  expect(
    await ctx.service.restore(await ctx.service.preview(JSON.stringify(envelope), 'stage8.json')),
  ).toMatchObject({ unchanged: true })
})
