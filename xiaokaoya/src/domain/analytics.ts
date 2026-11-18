import { shiftDate, validDate, weekStart } from './dates'
import { shiftMonth, unfinished } from './planning'
import { actualSecondsBySession } from './statistics'
import type {
  AnnualPlan,
  Chapter,
  LearningMaterial,
  MaterialProgress,
  StudyCycle,
  StudySession,
  Subject,
  SubjectPart,
  Task,
  TimeSegment,
  WeeklyPlan,
  WeeklySubjectTarget,
} from './models'

export type Period = 'day' | 'week' | 'month' | 'year' | 'all'
export interface DateRange {
  period: Period
  start: string | null
  end: string | null
}
export interface AnalyticsData {
  subjects: Subject[]
  subjectParts: SubjectPart[]
  plans: AnnualPlan[]
  cycles: StudyCycle[]
  tasks: Task[]
  sessions: StudySession[]
  segments: TimeSegment[]
  chapters: Chapter[]
  materials: LearningMaterial[]
  materialProgress: MaterialProgress[]
  weeklyPlans: WeeklyPlan[]
  weeklySubjectTargets: WeeklySubjectTarget[]
}
export interface Scope {
  system: 'all' | 'cpa' | 'tax'
  year: string
  cycleId: string
  archived: boolean
}
export const ALL_SCOPE: Scope = { system: 'all', year: 'all', cycleId: 'all', archived: true }
export function dateRange(period: Period, date: string): DateRange {
  if (!validDate(date)) throw new Error('请选择有效统计日期')
  if (period === 'all') return { period, start: null, end: null }
  if (period === 'day') return { period, start: date, end: date }
  if (period === 'week') {
    const start = weekStart(date)
    const end = shiftDate(start, 6)
    return { period, start, end: validDate(end) ? end : '9999-12-31' }
  }
  const year = Number(date.slice(0, 4)),
    month = Number(date.slice(5, 7))
  return period === 'year'
    ? { period, start: `${year}-01-01`, end: `${year}-12-31` }
    : {
        period,
        start: date.slice(0, 7) + '-01',
        end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
      }
}
export function shiftPeriod(period: Period, date: string, step: number) {
  if (period === 'all') return null
  if (period === 'month' || period === 'year')
    return shiftMonth(date, step * (period === 'year' ? 12 : 1))
  const result = shiftDate(date, step * (period === 'week' ? 7 : 1))
  return validDate(result) ? result : null
}
export const inRange = (date: string, range: DateRange) =>
  (!range.start || date >= range.start) && (!range.end || date <= range.end)
export function scopedCycles(
  data: Pick<AnalyticsData, 'subjects' | 'plans' | 'cycles'>,
  scope: Scope,
) {
  const subjects = new Map(data.subjects.map((s) => [s.id, s]))
  const years = new Map(data.plans.map((p) => [p.id, p.year]))
  return data.cycles
    .filter((c) => {
      const subject = subjects.get(c.subjectId)
      return (
        subject &&
        (scope.archived || !c.archivedAt) &&
        (scope.system === 'all' || subject.system === scope.system) &&
        (scope.year === 'all' || String(years.get(c.annualPlanId)) === scope.year) &&
        (scope.cycleId === 'all' || c.id === scope.cycleId)
      )
    })
    .map((c) => {
      const subject = subjects.get(c.subjectId)!,
        year = years.get(c.annualPlanId)!
      return {
        ...c,
        subject,
        year,
        label: `${subject.system === 'cpa' ? 'CPA' : '税务师'} · ${subject.name} · ${year}`,
      }
    })
    .sort(
      (a, b) => a.year - b.year || a.subject.order - b.subject.order || a.id.localeCompare(b.id),
    )
}
export interface TimeRow {
  id: string
  cycleId: string
  date: string
  seconds: number
  source: 'timer' | 'manual' | 'legacy'
  chapterId: string | null
}
export interface TimeIndex {
  rows: TimeRow[]
  tasks: Task[]
}
export function timeIndex(
  sessions: StudySession[],
  segments: TimeSegment[],
  tasks: Task[],
): TimeIndex {
  const durations = actualSecondsBySession(sessions, segments)
  return {
    rows: [...new Map(sessions.map((s) => [s.id, s])).values()]
      .filter(
        (s) => s.status === 'confirmed' && validDate(s.studyDate) && (durations.get(s.id) ?? 0) > 0,
      )
      .map((s) => ({
        id: s.id,
        cycleId: s.cycleId,
        date: s.studyDate,
        seconds: durations.get(s.id)!,
        source: s.source ?? 'legacy',
        chapterId: s.chapterId ?? null,
      })),
    tasks: [...new Map(tasks.map((t) => [t.id, t])).values()],
  }
}
export interface TimeTotals {
  actual: number
  companion: number
  manual: number
  legacy: number
  planned: number
  completed: number
  tasks: number
  days: number
}
function totals(rows: TimeRow[], tasks: Task[]): TimeTotals {
  return {
    actual: rows.reduce((n, r) => n + r.seconds, 0),
    companion: rows.filter((r) => r.source === 'timer').reduce((n, r) => n + r.seconds, 0),
    manual: rows.filter((r) => r.source === 'manual').reduce((n, r) => n + r.seconds, 0),
    legacy: rows.filter((r) => r.source === 'legacy').reduce((n, r) => n + r.seconds, 0),
    planned: tasks.reduce((n, t) => n + t.estimatedSeconds, 0),
    completed: tasks.filter((t) => t.status === 'completed').length,
    tasks: tasks.length,
    days: new Set(rows.map((r) => r.date)).size,
  }
}
export function continuousDays(dates: string[], today: string) {
  const all = new Set(dates.filter((d) => validDate(d) && d <= today))
  let end = all.has(today) ? today : shiftDate(today, -1),
    current = 0
  while (all.has(end)) {
    current++
    end = shiftDate(end, -1)
  }
  return current
}
export function longestStreak(dates: string[]) {
  let longest = 0,
    run = 0,
    previous = ''
  for (const date of [...new Set(dates)].filter(validDate).sort()) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = date
  }
  return longest
}
export function timeStatistics(
  index: TimeIndex,
  cycles: ReturnType<typeof scopedCycles>,
  range: DateRange,
  today: string,
) {
  const allowed = new Set(cycles.map((c) => c.id))
  const scoped = index.rows.filter((r) => allowed.has(r.cycleId))
  const rows = scoped.filter((r) => inRange(r.date, range))
  const tasks = index.tasks.filter(
    (t) =>
      allowed.has(t.cycleId) &&
      t.status !== 'cancelled' &&
      t.plannedDate !== null &&
      inRange(t.plannedDate, range),
  )
  const summary = totals(rows, tasks)
  const byCycle = cycles.map((c) => ({
    ...c,
    ...totals(
      rows.filter((r) => r.cycleId === c.id),
      tasks.filter((t) => t.cycleId === c.id),
    ),
  }))
  const bySystem = (['cpa', 'tax'] as const).map((system) => {
    const ids = new Set(cycles.filter((c) => c.subject.system === system).map((c) => c.id))
    return {
      system,
      label: system === 'cpa' ? 'CPA' : '税务师',
      ...totals(
        rows.filter((r) => ids.has(r.cycleId)),
        tasks.filter((t) => ids.has(t.cycleId)),
      ),
    }
  })
  const bucket =
    range.period === 'all'
      ? (date: string) => date.slice(0, 4)
      : range.period === 'year'
        ? (date: string) => date.slice(0, 7)
        : (date: string) => date
  let keys: string[]
  if (range.period === 'all')
    keys = [
      ...new Set([...rows.map((r) => bucket(r.date)), ...tasks.map((t) => bucket(t.plannedDate!))]),
    ].sort()
  else if (range.period === 'year')
    keys = Array.from(
      { length: 12 },
      (_, i) => range.start!.slice(0, 4) + '-' + String(i + 1).padStart(2, '0'),
    )
  else {
    keys = []
    for (let day = range.start!; day <= range.end! && validDate(day); day = shiftDate(day, 1))
      keys.push(day)
  }
  const trend = keys.map((key) => ({
    key,
    ...totals(
      rows.filter((r) => bucket(r.date) === key),
      tasks.filter((t) => bucket(t.plannedDate!) === key),
    ),
  }))
  return {
    summary,
    byCycle,
    bySystem,
    trend,
    rows,
    tasks,
    longest: longestStreak(rows.map((r) => r.date)),
    currentStreak: continuousDays(
      scoped.map((r) => r.date),
      today,
    ),
  }
}
export function companionSummary(sessions: StudySession[], segments: TimeSegment[], today: string) {
  const rows = timeIndex(sessions, segments, []).rows.filter((r) => r.source === 'timer')
  return {
    today: rows.filter((r) => r.date === today).reduce((n, r) => n + r.seconds, 0),
    total: rows.reduce((n, r) => n + r.seconds, 0),
  }
}
const compatible = (a: string | null, b: string | null) => !a || !b || a === b
export function progressStatistics(
  data: AnalyticsData,
  cycles: ReturnType<typeof scopedCycles>,
  includeArchived: boolean,
) {
  const ids = new Set(cycles.map((c) => c.id))
  const cycleOrder = new Map(cycles.map((c, i) => [c.id, i]))
  const parts = new Map(data.subjectParts.map((p) => [p.id, p.name]))
  const chapters = data.chapters
    .filter((c) => ids.has(c.cycleId) && (includeArchived || !c.archivedAt))
    .sort((a, b) => cycleOrder.get(a.cycleId)! - cycleOrder.get(b.cycleId)! || a.order - b.order)
  const materials = data.materials
    .filter((m) => ids.has(m.cycleId) && (includeArchived || !m.archivedAt))
    .sort((a, b) => cycleOrder.get(a.cycleId)! - cycleOrder.get(b.cycleId)! || a.order - b.order)
  const progress = new Map(
    data.materialProgress.map((p) => [p.materialId + '\0' + p.chapterId, p.progressPercent]),
  )
  const rated = chapters.filter((c) => c.masteryStars !== null)
  const materialRows = materials.map((m) => {
    const eligible = chapters.filter(
      (c) => c.cycleId === m.cycleId && compatible(c.partId, m.partId),
    )
    const recorded = eligible.filter((c) => progress.has(m.id + '\0' + c.id)).length
    return {
      ...m,
      partName: parts.get(m.partId ?? '') ?? '',
      chapters: eligible.length,
      recorded,
      percent: eligible.length
        ? eligible.reduce((n, c) => n + (progress.get(m.id + '\0' + c.id) ?? 0), 0) /
          eligible.length
        : null,
    }
  })
  const chapterRows = chapters.map((c) => ({
    ...c,
    partName: parts.get(c.partId ?? '') ?? '',
    materials: materials
      .filter((m) => m.cycleId === c.cycleId && compatible(c.partId, m.partId))
      .map((m) => ({
        id: m.id,
        title: m.title,
        kind: m.kind,
        percent: progress.get(m.id + '\0' + c.id) ?? null,
      })),
  }))
  return {
    chapters: chapterRows,
    materials: materialRows,
    completed: chapters.filter((c) => c.completionStatus === 'completed').length,
    rated: rated.length,
    stars: rated.length ? rated.reduce((n, c) => n + c.masteryStars!, 0) / rated.length : null,
    lowMastery: chapters.filter((c) => c.masteryStars !== null && c.masteryStars <= 2),
    cycles: cycles.map((c) => ({
      ...c,
      chapters: chapters.filter((ch) => ch.cycleId === c.id).length,
      completed: chapters.filter((ch) => ch.cycleId === c.id && ch.completionStatus === 'completed')
        .length,
      rated: rated.filter((ch) => ch.cycleId === c.id).length,
      stars: (() => {
        const list = rated.filter((ch) => ch.cycleId === c.id)
        return list.length ? list.reduce((n, ch) => n + ch.masteryStars!, 0) / list.length : null
      })(),
    })),
  }
}
export function weeklyReview(
  data: AnalyticsData,
  index: TimeIndex,
  cycles: ReturnType<typeof scopedCycles>,
  scope: Scope,
  date: string,
  today: string,
) {
  const range = dateRange('week', date),
    current = timeStatistics(index, cycles, range, today)
  const previousDate = shiftDate(range.start!, -7)
  const previous = validDate(previousDate)
    ? timeStatistics(index, cycles, dateRange('week', previousDate), today).summary
    : null
  const plan = data.weeklyPlans.find((p) => p.weekStart === range.start)
  const ids = new Set(cycles.map((c) => c.id))
  const targets = data.weeklySubjectTargets.filter(
    (t) => t.weekStart === range.start && t.active && ids.has(t.cycleId),
  )
  const unfiltered =
    scope.system === 'all' && scope.year === 'all' && scope.cycleId === 'all' && scope.archived
  const goal = unfiltered
    ? (plan?.goalSeconds ?? null)
    : targets.length
      ? targets.reduce((n, t) => n + t.targetSeconds, 0)
      : null
  const relatedIds = new Set(
    [...current.tasks.map((t) => t.chapterId), ...current.rows.map((r) => r.chapterId)].filter(
      (id): id is string => !!id,
    ),
  )
  const chapters = data.chapters.filter((c) => ids.has(c.cycleId) && relatedIds.has(c.id))
  return {
    ...current,
    range,
    previous,
    goal,
    fullGoal: plan?.goalSeconds ?? null,
    focus: plan?.focus ?? '',
    targets,
    goalLabel: unfiltered ? '全科周目标' : '筛选科目目标',
    remaining: current.tasks.filter(unfinished),
    chapters,
    linkedCompleted: chapters.filter((c) => c.completionStatus === 'completed').length,
    unassigned: index.tasks.filter(
      (t) => ids.has(t.cycleId) && t.plannedDate === null && unfinished(t),
    ).length,
  }
}
