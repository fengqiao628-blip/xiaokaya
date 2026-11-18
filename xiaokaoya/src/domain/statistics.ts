import type { StudySession, TimeSegment, Task } from './models'

/** Derive actual time from canonical records once; never add task estimates. */
export function actualSecondsBySession(
  sessions: StudySession[],
  segments: TimeSegment[],
): Map<string, number> {
  const unique = new Map(sessions.map((session) => [session.id, session]))
  const grouped = new Map<string, TimeSegment[]>()
  for (const segment of new Map(segments.map((item) => [item.id, item])).values()) {
    if (!segment.endedAt) continue
    const list = grouped.get(segment.sessionId) ?? []
    list.push(segment)
    grouped.set(segment.sessionId, list)
  }
  const result = new Map<string, number>()
  for (const session of unique.values()) {
    let total = 0
    if (session.status !== 'confirmed') {
      result.set(session.id, 0)
      continue
    }
    if (session.timeMode === 'duration_only') total = Math.max(0, session.durationOnlySeconds ?? 0)
    else {
      const intervals = (grouped.get(session.id) ?? [])
        .map((s) => [Date.parse(s.startedAt), Date.parse(s.endedAt!)] as const)
        .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
        .sort((a, b) => a[0] - b[0])
      let end = -Infinity
      for (const [a, b] of intervals) {
        total += Math.max(0, b - Math.max(a, end)) / 1000
        end = Math.max(end, b)
      }
    }
    result.set(session.id, total)
  }
  return result
}
export function actualSeconds(sessions: StudySession[], segments: TimeSegment[]): number {
  return Math.floor(
    [...actualSecondsBySession(sessions, segments).values()].reduce((sum, value) => sum + value, 0),
  )
}
export function encouragement(tasks: Task[], date: string) {
  const today = tasks.filter((task) => task.plannedDate === date && task.status !== 'cancelled')
  if (today.length && today.every((task) => task.status === 'completed'))
    return { text: '今天的小目标都完成啦，给认真努力的你一个拥抱！', state: 'celebrate' as const }
  if (today.some((task) => task.status === 'completed' || task.status === 'partial'))
    return { text: '已经有进步发生啦，接下来也按自己的节奏来。', state: 'study' as const }
  if (today.some((task) => task.status === 'in_progress'))
    return { text: '这一刻的专注，就是向前走的一小步。', state: 'study' as const }
  if (today.length)
    return { text: '挑一件小任务开始吧，今天也有伙伴陪着你。', state: 'idle' as const }
  return { text: '留一点时间给自己，想学习的时候，我们就从一小步开始。', state: 'idle' as const }
}
