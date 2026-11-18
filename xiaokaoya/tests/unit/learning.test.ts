import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Dexie from 'dexie'
import { safetyContext } from './safety-helpers'
import { LearningService, type ManualInput } from '../../src/services/learning'
import { FocusService } from '../../src/services/focus'
import { actualSeconds } from '../../src/domain/statistics'
import { intervalMs, splitLearningDays } from '../../src/domain/learning-time'
import { readPayload, makeBackup } from '../../src/data/backup/payload'
import { inspectBackup, validateData } from '../../src/shared/backup'
import { DATABASE_VERSION } from '../../src/shared/identity'
import { makeCsv } from '../../src/data/backup/csv'
let ctx: Awaited<ReturnType<typeof safetyContext>>,
  manual: LearningService,
  focus: FocusService,
  wall: number,
  mono: number
beforeEach(async () => {
  ctx = await safetyContext()
  wall = Date.parse('2028-02-29T08:00:00Z')
  mono = 0
  manual = new LearningService(ctx.database, () => wall)
  focus = new FocusService(ctx.database, { wall: () => wall, mono: () => mono })
})
afterEach(async () => {
  vi.restoreAllMocks()
  ctx.database.close()
  await ctx.database.delete()
})
const input = (overrides: Partial<ManualInput> = {}): ManualInput => ({
  cycleId: ctx.cycle.id,
  taskId: ctx.task.id,
  chapterId: null,
  notes: '学习记录测试',
  mode: 'range',
  date: '2028-02-29',
  seconds: 1200,
  startedAt: '2028-02-29T01:00:00.000Z',
  endedAt: '2028-02-29T01:20:00.000Z',
  overlapAcknowledged: false,
  ...overrides,
})
const start = (seconds = 3600, id = crypto.randomUUID()) =>
  focus.start(
    { cycleId: ctx.cycle.id, taskId: ctx.task.id, chapterId: null, targetSeconds: seconds },
    id,
  )
async function step(ms: number) {
  wall += ms
  mono += ms
  return focus.pulse()
}
async function total() {
  return actualSeconds(
    await ctx.database.studySessions.toArray(),
    await ctx.database.timeSegments.toArray(),
  )
}

it('manual ranges are actual time, duplicate submit is one record and estimates/status remain independent', async () => {
  const id = crypto.randomUUID(),
    a = await manual.manual(input(), id),
    b = await manual.manual(input(), id)
  expect(a).toEqual(b)
  expect(await total()).toBe(1200)
  expect(await ctx.database.studySessions.count()).toBe(1)
  expect((await ctx.database.tasks.get(ctx.task.id))?.estimatedSeconds).toBe(3600)
  expect((await ctx.database.tasks.get(ctx.task.id))?.status).toBe('pending')
  validateData(await readPayload(ctx.database), DATABASE_VERSION)
  await expect(manual.manual(input({ endedAt: '2028-02-29T01:30:00.000Z' }), id)).rejects.toThrow(
    '时间',
  )
})
it('cross-midnight leap-day records split by Shanghai date, and adjacent ranges are allowed', async () => {
  await manual.manual(
    input({ startedAt: '2028-02-28T15:50:00.000Z', endedAt: '2028-02-28T16:10:00.000Z' }),
  )
  const rows = await ctx.database.studySessions.orderBy('studyDate').toArray()
  expect(rows.map((r) => r.studyDate)).toEqual(['2028-02-28', '2028-02-29'])
  expect(await total()).toBe(1200)
  await manual.manual(
    input({ startedAt: '2028-02-28T16:10:00.000Z', endedAt: '2028-02-28T16:15:00.000Z' }),
  )
  expect(await total()).toBe(1500)
  validateData(await readPayload(ctx.database), DATABASE_VERSION)
  expect([
    ...splitLearningDays([
      { startedAt: '2027-12-31T15:59:30.000Z', endedAt: '2027-12-31T16:00:30.000Z' },
    ]).keys(),
  ]).toEqual(['2027-12-31', '2028-01-01'])
})
it('rejects actual overlap, containment, future/invalid timestamps and missing foreign keys without changing original records', async () => {
  await manual.manual(input())
  const before = await readPayload(ctx.database)
  for (const bad of [
    input({ startedAt: '2028-02-29T01:10:00.000Z' }),
    input({ startedAt: '2028-02-29T00:50:00.000Z', endedAt: '2028-02-29T01:30:00.000Z' }),
    input({ endedAt: '2029-01-01T00:00:00.000Z' }),
    input({ endedAt: input().startedAt }),
    input({ cycleId: 'missing' }),
    input({ chapterId: 'missing' }),
  ])
    await expect(manual.manual(bad)).rejects.toThrow()
  expect(await readPayload(ctx.database)).toEqual(before)
})
it('duration-only entry requires acknowledgment, rejects future dates and day totals above 24 hours', async () => {
  await expect(manual.manual(input({ mode: 'duration' }))).rejects.toThrow('知情')
  await expect(
    manual.manual(input({ mode: 'duration', date: '2028-03-01', overlapAcknowledged: true })),
  ).rejects.toThrow('日期')
  await manual.manual(input({ mode: 'duration', overlapAcknowledged: true, seconds: 86000 }))
  await expect(
    manual.manual(input({ mode: 'duration', overlapAcknowledged: true, seconds: 1000 })),
  ).rejects.toThrow('24小时')
  const data = await readPayload(ctx.database)
  expect(validateData(data, DATABASE_VERSION).some((s) => s.includes('无法核验'))).toBe(true)
  expect(makeCsv(data, 'sessions')).toContain('仅时长补录')
  expect(await total()).toBe(86000)
})
it('voiding retains the record and intervals; re-confirmation refuses conflicting replacement time', async () => {
  const [id] = await manual.manual(input())
  let row = (await ctx.database.studySessions.get(id))!
  await manual.setStatus(row, 'voided', '重复补录')
  expect(await total()).toBe(0)
  expect(await ctx.database.timeSegments.count()).toBe(1)
  await manual.manual(input())
  row = (await ctx.database.studySessions.get(id))!
  await expect(manual.setStatus(row, 'confirmed')).rejects.toThrow('重叠')
  expect((await ctx.database.studySessions.get(id))?.status).toBe('voided')
  validateData(await readPayload(ctx.database), DATABASE_VERSION)
})
it('multi-date manual write failure rolls back every table and a retry creates only the intended two records', async () => {
  const before = await readPayload(ctx.database),
    method = ctx.database.timeSegments.add.bind(ctx.database.timeSegments)
  let n = 0
  vi.spyOn(ctx.database.timeSegments, 'add').mockImplementation((...args) =>
    ++n === 2 ? Dexie.Promise.reject(new Error('disk full')) : method(...args),
  )
  const value = input({
      startedAt: '2028-02-28T15:50:00.000Z',
      endedAt: '2028-02-28T16:10:00.000Z',
    }),
    id = crypto.randomUUID()
  await expect(manual.manual(value, id)).rejects.toThrow('disk full')
  expect(await readPayload(ctx.database)).toEqual(before)
  vi.restoreAllMocks()
  await manual.manual(value, id)
  await manual.manual(value, id)
  expect(await ctx.database.studySessions.count()).toBe(2)
})
it('a 60 minute target with 20 minutes actual records only 20; pause and task completion add nothing', async () => {
  let run = await start(3600)
  for (let i = 0; i < 240; i++) await step(5000)
  run = await focus.pause(run.id)
  expect(intervalMs(run.intervals)).toBe(1200000)
  expect(await total()).toBe(0)
  wall += 600000
  mono += 600000
  await ctx.study.setTaskStatus((await ctx.database.tasks.get(ctx.task.id))!, 'completed')
  const ids = await focus.save(run)
  expect(await focus.save(run)).toEqual(ids)
  expect(await total()).toBe(1200)
  validateData(await readPayload(ctx.database), DATABASE_VERSION)
})
it('only one unfinished timer is permitted; duplicate starts are idempotent and stale resume is blocked', async () => {
  const id = crypto.randomUUID()
  let run = await start(60, id)
  expect((await start(60, id)).id).toBe(id)
  await expect(start(30)).rejects.toThrow('已有')
  run = await focus.pause(run.id)
  await expect(start()).rejects.toThrow('已有')
  const next = await focus.resume(run)
  await expect(focus.resume(run)).rejects.toThrow('变化')
  await focus.pause(next.id, 'stopped')
  expect(await ctx.database.focusTimers.count()).toBe(1)
})
it('pause/continue excludes the gap, due stops exactly at target and never completes the task', async () => {
  let run = await start(10)
  await step(5000)
  run = await focus.pause(run.id)
  wall += 60000
  mono += 60000
  run = await focus.resume(run)
  await step(8000)
  run = (await ctx.database.focusTimers.get(run.id))!
  expect(run.status).toBe('review')
  expect(run.reason).toBe('due')
  expect(intervalMs(run.intervals)).toBe(10000)
  wall += 60000
  mono += 60000
  await focus.pulse()
  expect(intervalMs((await ctx.database.focusTimers.get(run.id))!.intervals)).toBe(10000)
  expect((await ctx.database.tasks.get(ctx.task.id))?.status).toBe('pending')
  expect(await total()).toBe(0)
  await focus.save(run)
  expect(await total()).toBe(10)
})
it('short countdown at zero requires confirmation; subsecond abandoned timer is retained without learning time', async () => {
  let run = await start(1)
  await step(1200)
  run = (await ctx.database.focusTimers.get(run.id))!
  expect(run.reason).toBe('due')
  await focus.save(run)
  expect(await total()).toBe(1)
  run = await start(25)
  wall += 100
  mono += 100
  run = await focus.pause(run.id, 'stopped')
  await expect(focus.save(run)).rejects.toThrow('不足1秒')
  await focus.discard(run)
  expect(await total()).toBe(1)
})
it('cross-midnight focus generates two records and globally saves every effective second once', async () => {
  wall = Date.parse('2028-02-28T15:59:55.000Z')
  let run = await start(10)
  await step(5000)
  await step(5000)
  run = (await ctx.database.focusTimers.get(run.id))!
  await focus.save(run)
  expect(
    (await ctx.database.studySessions.orderBy('studyDate').toArray()).map((r) => r.studyDate),
  ).toEqual(['2028-02-28', '2028-02-29'])
  expect(await total()).toBe(10)
  validateData(await readPayload(ctx.database), DATABASE_VERSION)
})
it('lock, sleep, normal exit and backup pause without later catch-up', async () => {
  for (const reason of ['lock', 'sleep', 'exit', 'backup'] as const) {
    let run = await start(60)
    await step(5000)
    await focus.suspend(reason)
    run = (await ctx.database.focusTimers.get(run.id))!
    expect(run.reason).toBe(reason)
    expect(run.status).toBe('review')
    wall += 3600000
    mono += 3600000
    await focus.pulse()
    expect(intervalMs((await ctx.database.focusTimers.get(run.id))!.intervals)).toBe(5000)
    await focus.save(run)
  }
  expect(await total()).toBe(20)
})
it('backward clock and long heartbeat gaps preserve the last reliable checkpoint', async () => {
  let run = await start()
  await step(5000)
  wall -= 30000
  mono += 5000
  await focus.pulse()
  run = (await ctx.database.focusTimers.get(run.id))!
  expect(run.reason).toBe('clock')
  expect(intervalMs(run.intervals)).toBe(5000)
  await expect(focus.resume(run)).rejects.toThrow('系统时间')
  await focus.discard(run)
  wall += 60000
  run = await start()
  await step(5000)
  await step(60000)
  run = (await ctx.database.focusTimers.get(run.id))!
  expect(run.reason).toBe('interrupted')
  expect(intervalMs(run.intervals)).toBe(5000)
})
it('fresh process or restored backup recovers unfinished timer to review without creating sessions', async () => {
  let run = await start()
  await step(5000)
  const second = new FocusService(ctx.database, { wall: () => wall, mono: () => mono })
  wall += 3600000
  mono += 3600000
  await second.recover('restore')
  run = (await ctx.database.focusTimers.get(run.id))!
  expect(run.status).toBe('review')
  expect(run.reason).toBe('restore')
  expect(intervalMs(run.intervals)).toBe(5000)
  await second.pulse()
  expect(await total()).toBe(0)
  await second.save(run)
  expect(await total()).toBe(5)
})
it('failed heartbeat stops the in-memory clock; retry quarantines instead of making up missing time', async () => {
  let run = await start()
  await step(5000)
  wall += 5000
  mono += 5000
  vi.spyOn(ctx.database.focusTimers, 'put').mockRejectedValueOnce(new Error('quota'))
  await expect(focus.pulse()).rejects.toThrow('quota')
  expect(focus.preview((await ctx.database.focusTimers.get(run.id))!).status).toBe('review')
  wall += 5000
  mono += 5000
  await focus.pulse()
  run = (await ctx.database.focusTimers.get(run.id))!
  expect(run.status).toBe('review')
  expect(intervalMs(run.intervals)).toBe(5000)
})
it('timer confirmation failure rolls back generated sessions and retry saves exactly once', async () => {
  let run = await start(5)
  await step(5000)
  run = (await ctx.database.focusTimers.get(run.id))!
  vi.spyOn(ctx.database.focusTimers, 'put').mockRejectedValueOnce(new Error('write failed'))
  await expect(focus.save(run)).rejects.toThrow('write failed')
  expect(await ctx.database.studySessions.count()).toBe(0)
  expect(await ctx.database.timeSegments.count()).toBe(0)
  await focus.save(run)
  await focus.save(run)
  expect(await ctx.database.studySessions.count()).toBe(1)
  expect(await total()).toBe(5)
})
it('manual timestamp cannot overlap pending timer; duration-only still requires explicit acknowledgment', async () => {
  let run = await start(60)
  await step(5000)
  run = await focus.pause(run.id)
  await expect(
    manual.manual(
      input({ startedAt: run.intervals[0].startedAt, endedAt: run.intervals[0].endedAt }),
    ),
  ).rejects.toThrow('重叠')
  await manual.manual(input({ mode: 'duration', overlapAcknowledged: true, seconds: 20 }))
  expect(await total()).toBe(20)
  await focus.save(run)
  expect(await total()).toBe(25)
})
it('saved timer can be voided and re-confirmed without changing its original effective intervals', async () => {
  let run = await start(5)
  await step(5000)
  run = (await ctx.database.focusTimers.get(run.id))!
  const [id] = await focus.save(run)
  let row = (await ctx.database.studySessions.get(id))!
  await manual.setStatus(row, 'voided', '确认有误')
  expect(await total()).toBe(0)
  validateData(await readPayload(ctx.database), DATABASE_VERSION)
  row = (await ctx.database.studySessions.get(id))!
  await manual.setStatus(row, 'confirmed')
  expect(await total()).toBe(5)
  validateData(await readPayload(ctx.database), DATABASE_VERSION)
})
it('V5 full backup round-trip includes working timers, rejects mismatched saved links and spoofed legacy metadata', async () => {
  let run = await start(5)
  await step(5000)
  run = (await ctx.database.focusTimers.get(run.id))!
  await focus.save(run)
  const data = await readPayload(ctx.database),
    parsed = await inspectBackup(await makeBackup(data, '0.5.0', 'export'))
  expect(parsed.data).toEqual(data)
  expect(makeCsv(data, 'focus-timers')).toContain('工作状态')
  expect(makeCsv(data, 'sessions')).toContain('陪伴计时')
  for (const corrupt of [
    () => {
      const v = structuredClone(data)
      v.focusTimers[0].sessionIds = []
      return v
    },
    () => {
      const v = structuredClone(data)
      v.timeSegments[0].endedAt = '2028-02-29T08:00:06.000Z'
      return v
    },
  ])
    expect(() => validateData(corrupt(), DATABASE_VERSION)).toThrow()
  const old = structuredClone(data)
  delete (old as Record<string, unknown>).focusTimers
  delete (old as Record<string, unknown>).quoteDetails
  delete (old as Record<string, unknown>).quoteFavorites
  delete (old as Record<string, unknown>).experienceSettings
  for (const name of [
    'practiceSets',
    'mistakeItems',
    'mistakeReviews',
    'mockExams',
    'mockExamQuestions',
    'reportSnapshots',
  ])
    delete (old as Record<string, unknown>)[name]
  for (const table of ['dailyQuotes', 'quoteHistory'] as const)
    old[table] = old[table].map(({ attribution: _, ...row }) => row)
  expect(() => validateData(old, 4)).toThrow('V5')
})
