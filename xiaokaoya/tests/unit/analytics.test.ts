import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  ALL_SCOPE,
  companionSummary,
  continuousDays,
  dateRange,
  longestStreak,
  progressStatistics,
  scopedCycles,
  shiftPeriod,
  timeIndex,
  timeStatistics,
  weeklyReview,
  type AnalyticsData,
} from '../../src/domain/analytics'
import { actualSeconds } from '../../src/domain/statistics'
import { shiftDate } from '../../src/domain/dates'
import {
  analyticsFixture,
  chapter,
  entity,
  material,
  session,
  task,
  segment,
} from '../fixtures/analytics'
import { progressCsv, timeCsv, weeklyCsv } from '../../src/features/statistics/export'
import { serializeCsv } from '../../src/shared/csv'
import { safetyContext } from './safety-helpers'
import { LearningService } from '../../src/services/learning'
import { FocusService } from '../../src/services/focus'
import { makeBackup, readPayload } from '../../src/data/backup/payload'
import { fingerprint } from '../../src/shared/backup'
import { DATABASE_VERSION } from '../../src/shared/identity'

const scope = { ...ALL_SCOPE }
const report = (
  d: AnalyticsData,
  period: Parameters<typeof dateRange>[0] = 'all',
  date = '2024-02-29',
) =>
  timeStatistics(
    timeIndex(d.sessions, d.segments, d.tasks),
    scopedCycles(d, scope),
    dateRange(period, date),
    date,
  )

describe('canonical read-only time statistics', () => {
  it('1 minute confirmed timer plus 20 minutes manual is 21 total and only 1 companion, independent of goal or task estimate', () => {
    const d = analyticsFixture()
    d.sessions = [
      session('one', { source: 'timer', durationOnlySeconds: 60 }),
      session('two', { source: 'manual' }),
      session('void', { source: 'manual', status: 'voided', durationOnlySeconds: 7200 }),
      session('draft', { source: 'timer', status: 'draft', durationOnlySeconds: 3600 }),
    ]
    d.tasks = [task('t', { status: 'completed' })]
    expect(report(d).summary).toMatchObject({
      actual: 1260,
      companion: 60,
      manual: 1200,
      legacy: 0,
      planned: 3600,
      completed: 1,
      tasks: 1,
      days: 1,
    })
    expect(companionSummary(d.sessions, d.segments, '2024-02-29')).toEqual({ today: 60, total: 60 })
    expect(companionSummary(d.sessions, d.segments, '2024-03-01').today).toBe(0)
  })
  it('deduplicates IDs, unions same-record segments, ignores open intervals and preserves exact source partitions', () => {
    const d = analyticsFixture(),
      s = session('s', { timeMode: 'segments', durationOnlySeconds: null, source: 'timer' })
    d.sessions = [s, s, session('legacy', { durationOnlySeconds: 30 })]
    const p = segment('p', 's', '2024-02-29T01:00:00.000Z', '2024-02-29T01:00:20.500Z')
    d.segments = [
      p,
      p,
      segment('q', 's', '2024-02-29T01:00:15.000Z', '2024-02-29T01:00:30.500Z'),
      segment('open', 's', '2024-02-29T02:00:00Z', null),
    ]
    const r = report(d).summary
    expect(r.actual).toBe(60.5)
    expect(r.companion).toBe(30.5)
    expect(r.legacy).toBe(30)
    expect(r.actual).toBe(r.companion + r.manual + r.legacy)
    expect(Math.floor(r.actual)).toBe(actualSeconds(d.sessions, d.segments))
  })
  it('filters learning calendar years separately from target examination years, and defaults to keeping archived/paused history', () => {
    const d = analyticsFixture()
    d.sessions = [
      session('one'),
      session('two', { cycleId: 'a28', durationOnlySeconds: 600 }),
      session('three', { cycleId: 't27', durationOnlySeconds: 300 }),
    ]
    const all = timeIndex(d.sessions, [], [])
    expect(report(d, 'year', '2024-02-29').summary.actual).toBe(2100)
    const selected = scopedCycles(d, { ...scope, year: '2027' })
    expect(
      timeStatistics(all, selected, dateRange('year', '2024-02-29'), '2024-02-29').summary.actual,
    ).toBe(1500)
    expect(
      timeStatistics(all, selected, dateRange('year', '2027-02-28'), '2024-02-29').summary.actual,
    ).toBe(0)
    expect(
      timeStatistics(
        all,
        scopedCycles(d, { ...scope, archived: false }),
        dateRange('all', '2024-02-29'),
        '2024-02-29',
      ).summary.actual,
    ).toBe(1800)
    expect(
      timeStatistics(
        all,
        scopedCycles(d, { ...scope, system: 'tax' }),
        dateRange('all', '2024-02-29'),
        '2024-02-29',
      ).summary.actual,
    ).toBe(300)
    expect(
      timeStatistics(
        all,
        scopedCycles(d, { ...scope, cycleId: 'a28' }),
        dateRange('all', '2024-02-29'),
        '2024-02-29',
      ).summary.actual,
    ).toBe(600)
  })
  it('does not mutate source data, count undated/cancelled estimates or treat completion as actual time', () => {
    const d = analyticsFixture()
    d.tasks = [
      task('done', { status: 'completed' }),
      task('cancel', { status: 'cancelled' }),
      task('pool', { plannedDate: null }),
    ]
    const before = structuredClone(d)
    const r = report(d, 'week')
    expect(r.summary).toMatchObject({ actual: 0, planned: 3600, tasks: 1, completed: 1 })
    expect(d).toEqual(before)
  })
  it('keeps Monday-first cross-year weeks and zero-fills all seven actual dates', () => {
    const d = analyticsFixture()
    d.sessions = [
      session('old', { studyDate: '2027-12-31', durationOnlySeconds: 600 }),
      session('new', { studyDate: '2028-01-01', durationOnlySeconds: 600 }),
    ]
    const r = report(d, 'week', '2028-01-01')
    expect(r.trend.map((p) => p.key)).toEqual([
      '2027-12-27',
      '2027-12-28',
      '2027-12-29',
      '2027-12-30',
      '2027-12-31',
      '2028-01-01',
      '2028-01-02',
    ])
    expect(r.summary.actual).toBe(1200)
    expect(r.trend.reduce((n, p) => n + p.actual, 0)).toBe(1200)
    expect(report(d, 'year', '2028-01-01').summary.actual).toBe(600)
  })
  it.each([
    ['2028-02-29', 29],
    ['2100-02-28', 28],
    ['2000-02-29', 29],
  ] as const)('handles month %s without hardcoded years', (date, days) => {
    const d = analyticsFixture(),
      r = report(d, 'month', date)
    expect(r.trend).toHaveLength(days)
    expect(r.trend.at(-1)?.key).toBe(date)
    expect(report(d, 'year', date).trend).toHaveLength(12)
  })
  it('guards date bounds, invalid dates and month-end navigation', () => {
    expect(() => dateRange('week', '2027-02-29')).toThrow('有效')
    expect(shiftPeriod('day', '1900-01-01', -1)).toBeNull()
    expect(shiftPeriod('week', '9999-12-31', 1)).toBeNull()
    expect(dateRange('week', '9999-12-31').end).toBe('9999-12-31')
    expect(dateRange('year', '9999-12-31').end).toBe('9999-12-31')
    expect(shiftPeriod('month', '2028-01-31', 1)).toBe('2028-02-29')
    expect(shiftPeriod('all', '2028-01-01', 1)).toBeNull()
  })
  it('counts actual learning dates, carries yesterday into a current streak and ignores future dates', () => {
    expect(continuousDays(['2024-02-27', '2024-02-28', '2024-03-01'], '2024-02-29')).toBe(2)
    expect(continuousDays(['2024-02-27', '2024-02-28', '2024-02-29'], '2024-02-29')).toBe(3)
    expect(continuousDays(['2024-02-27'], '2024-02-29')).toBe(0)
    expect(
      longestStreak(['2028-02-28', '2028-02-29', '2028-03-01', '2028-03-01', '2028-03-03']),
    ).toBe(3)
  })
  it('includes every historical row beyond UI pagination and groups 20000 records over multiple years', () => {
    const d = analyticsFixture()
    d.sessions = Array.from({ length: 20000 }, (_, i) =>
      session(`large-${i}`, {
        studyDate: shiftDate('2027-01-01', Math.floor(i / 24)),
        source: i % 2 ? 'manual' : 'timer',
        durationOnlySeconds: 60,
      }),
    )
    const r = report(d)
    expect(r.summary.actual).toBe(1200000)
    expect(r.summary.companion).toBe(600000)
    expect(r.summary.days).toBe(834)
    expect(r.trend.map((p) => p.key)).toEqual(['2027', '2028', '2029'])
    expect(r.byCycle.reduce((n, c) => n + c.actual, 0)).toBe(r.summary.actual)
  })
})
describe('independent current progress', () => {
  it('shows completion and mastery independently of 100% textbook progress, excluding unscored stars from averages', () => {
    const d = analyticsFixture()
    d.chapters = [
      chapter('first', { masteryStars: 1 }),
      chapter('second', { completionStatus: 'completed' }),
    ]
    d.materials = [material('book'), material('video', { kind: 'video' })]
    d.materialProgress = [
      { ...entity, id: 'pr1', materialId: 'book', chapterId: 'first', progressPercent: 100 },
      { ...entity, id: 'pr2', materialId: 'video', chapterId: 'first', progressPercent: 20 },
    ]
    const p = progressStatistics(d, scopedCycles(d, scope), false)
    expect(p).toMatchObject({ completed: 1, rated: 1, stars: 1 })
    expect(p.materials.map((m) => m.percent)).toEqual([50, 10])
    expect(p.materials[0]).toMatchObject({ recorded: 1, chapters: 2 })
    expect(p.chapters[0].completionStatus).toBe('not_started')
    expect(p.lowMastery.map((c) => c.id)).toEqual(['first'])
    expect(p.chapters[1].materials[0].percent).toBeNull()
  })
  it('separates editions, shows unavailable percentages for zero chapters and honors archived item choices', () => {
    const d = analyticsFixture()
    d.chapters = [chapter('archived', { archivedAt: entity.updatedAt })]
    d.materials = [
      material('old', { archivedAt: entity.updatedAt }),
      material('new', { edition: '2028版' }),
    ]
    d.materialProgress = [
      { ...entity, id: 'pr', materialId: 'old', chapterId: 'archived', progressPercent: 100 },
    ]
    const a = progressStatistics(d, scopedCycles(d, scope), false)
    expect(a.materials).toHaveLength(1)
    expect(a.materials[0].percent).toBeNull()
    expect(a.stars).toBeNull()
    const b = progressStatistics(d, scopedCycles(d, scope), true)
    expect(b.materials.map((m) => m.percent)).toEqual([100, 0])
    expect(b.chapters).toHaveLength(1)
  })
  it('keeps comprehensive paper items internal and uses compatible chapter denominators', () => {
    const d = analyticsFixture()
    d.chapters = [
      chapter('one', { cycleId: 'comp', partId: 'cpa-comprehensive-1' }),
      chapter('two', { cycleId: 'comp', partId: 'cpa-comprehensive-2' }),
      chapter('common', { cycleId: 'comp' }),
    ]
    d.materials = [material('paper1', { cycleId: 'comp', partId: 'cpa-comprehensive-1' })]
    d.materialProgress = [
      { ...entity, id: 'pr', materialId: 'paper1', chapterId: 'one', progressPercent: 100 },
    ]
    const p = progressStatistics(d, scopedCycles(d, scope), false)
    expect(p.materials[0]).toMatchObject({ chapters: 2, percent: 50, partName: '试卷一' })
    expect(p.chapters.find((c) => c.id === 'two')?.materials).toHaveLength(0)
    expect(p.cycles.filter((c) => c.subject.stage === 'comprehensive')).toHaveLength(1)
  })
})
describe('weekly review and derived exports', () => {
  it('uses explicit all-subject targets or filtered allocations, never spreads a total goal across each subject', () => {
    const d = analyticsFixture()
    d.weeklyPlans = [
      { ...entity, id: 'week', weekStart: '2024-02-26', goalSeconds: 7200, focus: '先做一点复习' },
    ]
    d.weeklySubjectTargets = [
      {
        ...entity,
        id: 'target',
        weekStart: '2024-02-26',
        cycleId: 'a27',
        targetSeconds: 1800,
        active: true,
      },
    ]
    d.sessions = [session('s')]
    d.tasks = [
      task('one', { chapterId: 'chapter' }),
      task('pool', { plannedDate: null }),
      task('cancel', { status: 'cancelled' }),
    ]
    d.chapters = [
      chapter('chapter', { completionStatus: 'completed', updatedAt: '2020-01-01T00:00:00Z' }),
    ]
    const index = timeIndex(d.sessions, [], d.tasks),
      a = weeklyReview(d, index, scopedCycles(d, scope), scope, '2024-02-29', '2024-02-29')
    expect(a).toMatchObject({ goal: 7200, fullGoal: 7200, unassigned: 1, linkedCompleted: 1 })
    expect(a.remaining).toHaveLength(1)
    const filtered = { ...scope, cycleId: 'a27' }
    const b = weeklyReview(
      d,
      index,
      scopedCycles(d, filtered),
      filtered,
      '2024-02-29',
      '2024-02-29',
    )
    expect(b).toMatchObject({ goal: 1800, fullGoal: 7200, goalLabel: '筛选科目目标' })
    const other = { ...scope, cycleId: 'a28' }
    expect(
      weeklyReview(d, index, scopedCycles(d, other), other, '2024-02-29', '2024-02-29').goal,
    ).toBeNull()
    d.weeklyPlans = []
    expect(
      weeklyReview(d, index, scopedCycles(d, scope), scope, '2024-02-29', '2024-02-29').goal,
    ).toBeNull()
  })
  it('recomputes summaries after voids and task rescheduling, retaining missing goals and previous-week comparisons', () => {
    const d = analyticsFixture()
    d.sessions = [
      session('previous', { studyDate: '2024-02-20', durationOnlySeconds: 60 }),
      session('current'),
    ]
    d.tasks = [task('one')]
    const review = () =>
      weeklyReview(
        d,
        timeIndex(d.sessions, [], d.tasks),
        scopedCycles(d, scope),
        scope,
        '2024-02-29',
        '2024-02-29',
      )
    expect(review().previous?.actual).toBe(60)
    expect(review().summary.actual).toBe(1200)
    d.sessions[1].status = 'voided'
    d.tasks[0].plannedDate = '2024-03-04'
    expect(review().summary).toMatchObject({ actual: 0, planned: 0, tasks: 0 })
  })
  it('exports exact seconds and the current scope; quotes, newlines and formula-like titles remain safe', () => {
    const d = analyticsFixture()
    d.sessions = [session('s', { source: 'manual', chapterId: '=SUM(1,2)' })]
    d.chapters = [chapter('=SUM(1,2)', { title: '=SUM(1,2)' })]
    d.materials = [material('book', { title: '资料,"换行\n第二行' })]
    const cycles = scopedCycles(d, scope),
      r = report(d),
      p = progressStatistics(d, cycles, false),
      labels = new Map(cycles.map((c) => [c.id, c.label]))
    expect(timeCsv(r, dateRange('all', '2024-02-29'), scope)).toContain('"1200"')
    expect(timeCsv(r, dateRange('all', '2024-02-29'), scope)).toContain('其中陪伴秒')
    expect(progressCsv(p, labels)).toContain("'=SUM(1,2)")
    expect(progressCsv(p, labels)).toContain('资料,""换行\n第二行')
    const review = weeklyReview(
      d,
      timeIndex(d.sessions, [], []),
      cycles,
      scope,
      '2024-02-29',
      '2024-02-29',
    )
    expect(weeklyCsv(review, labels)).toContain('本周关联章节（当前状态）')
    expect(serializeCsv([['=1', ' +CMD', '@SUM', '-1', -1, null]])).toBe(
      '\uFEFF"\'=1","\' +CMD","\'@SUM","\'-1","-1",""\r\n',
    )
  })
})

describe('V5 preservation and backup recomputation', () => {
  let ctx: Awaited<ReturnType<typeof safetyContext>> | undefined
  afterEach(async () => {
    vi.restoreAllMocks()
    if (ctx) {
      ctx.database.close()
      await ctx.database.delete()
      ctx = undefined
    }
  })
  it('does not upgrade or write existing V5 rows; old 0.5.1 JSON restores statistics and a failed restore rolls back the current report', async () => {
    ctx = await safetyContext()
    const d = ctx.database,
      clock = Date.parse('2024-02-29T08:00:00Z')
    let wall = clock,
      mono = 0
    const learning = new LearningService(d, () => wall),
      focus = new FocusService(d, { wall: () => wall, mono: () => mono })
    const run = await focus.start({
      cycleId: ctx.cycle.id,
      taskId: ctx.task.id,
      chapterId: null,
      targetSeconds: 60,
    })
    for (let i = 0; i < 6; i++) {
      wall += 10000
      mono += 10000
      await focus.pulse()
    }
    await focus.save((await d.focusTimers.get(run.id))!, '统计测试')
    const [manualId] = await learning.manual({
      cycleId: ctx.cycle.id,
      taskId: ctx.task.id,
      chapterId: null,
      notes: '手动20分钟',
      mode: 'range',
      date: '',
      seconds: 0,
      startedAt: '2024-02-29T01:00:00Z',
      endedAt: '2024-02-29T01:20:00Z',
      overlapAcknowledged: false,
    })
    const payload = await readPayload(d),
      before = await fingerprint(payload, true)
    const getData = async () => {
      const p = await readPayload(d)
      return {
        ...p,
        plans: p.annualPlans,
        sessions: p.studySessions,
        segments: p.timeSegments,
      } as unknown as AnalyticsData
    }
    expect(report(await getData()).summary).toMatchObject({
      actual: 1260,
      companion: 60,
      manual: 1200,
    })
    expect(await fingerprint(await readPayload(d), true)).toBe(before)
    expect(d.verno).toBe(DATABASE_VERSION)
    expect(DATABASE_VERSION).toBe(7)
    const backup = JSON.stringify(await makeBackup(payload, '0.7.0', 'export'))
    await learning.setStatus((await d.studySessions.get(manualId))!, 'voided', '统计回滚测试')
    expect(report(await getData()).summary.actual).toBe(60)
    let preview = await ctx.service.preview(backup, 'stage5-v5.json')
    const failure = () => {
      throw new Error('injected statistics restore failure')
    }
    d.tasks.hook('creating', failure)
    await expect(ctx.service.restore(preview)).rejects.toThrow('回滚')
    d.tasks.hook('creating').unsubscribe(failure)
    expect(report(await getData()).summary.actual).toBe(60)
    preview = await ctx.service.preview(backup, 'stage5-v5.json')
    await ctx.service.restore(preview)
    expect(report(await getData()).summary).toMatchObject({ actual: 1260, companion: 60 })
    expect((await ctx.service.preview(backup, 'same.json')).identical).toBe(true)
  })
})
