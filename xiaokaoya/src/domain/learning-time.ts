import { todayKey, shiftDate, validDate } from './dates'
import type { FocusInterval, FocusTimer, FocusReason } from './models'

export const unfinishedFocus = (run: FocusTimer) => !['saved', 'discarded'].includes(run.status)
export const intervalMs = (list: FocusInterval[]) =>
  list.reduce((n, p) => n + Date.parse(p.endedAt) - Date.parse(p.startedAt), 0)
export function checkIntervals(list: FocusInterval[]) {
  let last = -Infinity
  for (const p of list) {
    const a = Date.parse(p.startedAt),
      b = Date.parse(p.endedAt)
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || a < last)
      throw new Error('时间片段无效或存在重叠')
    last = b
  }
}
export function splitLearningDays(list: FocusInterval[]) {
  checkIntervals(list)
  const groups = new Map<string, FocusInterval[]>()
  for (const p of list) {
    let start = Date.parse(p.startedAt)
    const end = Date.parse(p.endedAt)
    while (start < end) {
      const day = todayKey(new Date(start))
      if (!validDate(day)) throw new Error('学习时间超出支持的日期范围')
      const next = shiftDate(day, 1)
      const midnight = Date.parse(next + 'T00:00:00+08:00')
      const stop = Math.min(end, midnight)
      if (!Number.isFinite(stop) || stop <= start) throw new Error('学习日期边界无效')
      const row = {
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(stop).toISOString(),
      }
      groups.set(day, [...(groups.get(day) ?? []), row])
      start = stop
    }
  }
  return groups
}
export function assertDisjoint(candidate: FocusInterval[], existing: FocusInterval[]) {
  checkIntervals(candidate)
  const list = [
    ...candidate.map((p) => ({ ...p, candidate: true })),
    ...existing.map((p) => ({ ...p, candidate: false })),
  ].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
  let candidateEnd = -Infinity,
    otherEnd = -Infinity
  for (const p of list) {
    const start = Date.parse(p.startedAt),
      end = Date.parse(p.endedAt)
    if (
      (p.candidate && start < Math.max(candidateEnd, otherEnd)) ||
      (!p.candidate && start < candidateEnd)
    )
      throw new Error('这段时间与已有学习记录或待确认计时重叠，请调整起止时间；没有重复累计')
    if (p.candidate) candidateEnd = Math.max(candidateEnd, end)
    else otherEnd = Math.max(otherEnd, end)
  }
}
export function advanceFocus(
  run: FocusTimer,
  wall: number,
  monotonicDelta: number,
  reason?: FocusReason,
): FocusTimer {
  if (run.status !== 'running') return run
  const delta = wall - Date.parse(run.checkpointAt)
  if (
    !Number.isFinite(monotonicDelta) ||
    monotonicDelta < 0 ||
    delta < 0 ||
    Math.abs(delta - monotonicDelta) > 2000 ||
    delta > 15000
  )
    return { ...run, status: 'review', reason: delta > 15000 ? 'interrupted' : 'clock' }
  const available = Math.max(0, run.targetSeconds * 1000 - intervalMs(run.intervals))
  const used = Math.max(0, Math.floor(Math.min(delta, monotonicDelta, available)))
  const intervals = run.intervals.map((p) => ({ ...p }))
  if (used > 0) {
    const last = intervals.at(-1),
      end = new Date(Date.parse(run.checkpointAt) + used).toISOString()
    if (last?.endedAt === run.checkpointAt) last.endedAt = end
    else intervals.push({ startedAt: run.checkpointAt, endedAt: end })
  }
  const due = intervalMs(intervals) >= run.targetSeconds * 1000
  return {
    ...run,
    intervals,
    checkpointAt: new Date(wall).toISOString(),
    status:
      due || (reason && reason !== 'paused')
        ? 'review'
        : reason === 'paused'
          ? 'paused'
          : 'running',
    reason: due ? 'due' : (reason ?? run.reason),
  }
}
export const clockText = (seconds: number) => {
  const n = Math.max(0, Math.ceil(seconds))
  return `${String(Math.floor(n / 3600)).padStart(2, '0')}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
}
