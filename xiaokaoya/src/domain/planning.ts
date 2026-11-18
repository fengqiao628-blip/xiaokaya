import { shiftDate, validDate, weekStart } from './dates'
import { actualSecondsBySession } from './statistics'
import type { StudySession, Task, TimeSegment } from './models'

export function unfinished(task: Task) {
  return task.status !== 'completed' && task.status !== 'cancelled'
}
export function inBacklog(task: Task, today: string) {
  return task.plannedDate === null || (task.plannedDate < today && unfinished(task))
}
export function weekDates(date: string) {
  if (!validDate(date)) throw new Error('日期无效')
  return Array.from({ length: 7 }, (_, i) => shiftDate(weekStart(date), i)).filter(validDate)
}
export function monthCells(date: string) {
  if (!validDate(date)) throw new Error('日期无效')
  const first = date.slice(0, 7) + '-01',
    start = weekStart(first)
  return Array.from({ length: 42 }, (_, i) => shiftDate(start, i))
}
export function shiftMonth(date: string, months: number): string | null {
  if (!validDate(date) || !Number.isInteger(months)) return null
  const value = new Date(date + 'T00:00:00Z')
  const day = value.getUTCDate()
  value.setUTCDate(1)
  value.setUTCMonth(value.getUTCMonth() + months)
  const last = new Date(value.getTime())
  last.setUTCMonth(last.getUTCMonth() + 1)
  last.setUTCDate(0)
  value.setUTCDate(Math.min(day, last.getUTCDate()))
  const result = value.toISOString().split('T')[0]
  return validDate(result) ? result : null
}
export function weeklyOverview(
  tasks: Task[],
  sessions: StudySession[],
  segments: TimeSegment[],
  date: string,
) {
  const days = new Set(weekDates(date))
  const planned = tasks.filter(
    (task) =>
      task.plannedDate !== null && days.has(task.plannedDate) && task.status !== 'cancelled',
  )
  const confirmed = sessions.filter((session) => days.has(session.studyDate))
  const durations = actualSecondsBySession(confirmed, segments)
  const actualByCycle = new Map<string, number>()
  for (const session of new Map(confirmed.map((item) => [item.id, item])).values())
    actualByCycle.set(
      session.cycleId,
      (actualByCycle.get(session.cycleId) ?? 0) + (durations.get(session.id) ?? 0),
    )
  return {
    plannedSeconds: planned.reduce((sum, task) => sum + task.estimatedSeconds, 0),
    actualSeconds: [...actualByCycle.values()].reduce((a, b) => a + b, 0),
    completed: planned.filter((task) => task.status === 'completed').length,
    total: planned.length,
    actualByCycle,
  }
}
