import type { BackupData } from './backup'
import type { StudySession, TimeSegment, FocusTimer } from '../domain/models'
import {
  assertDisjoint,
  checkIntervals,
  intervalMs,
  splitLearningDays,
  unfinishedFocus,
} from '../domain/learning-time'
import { todayKey } from '../domain/dates'
import { actualSecondsBySession } from '../domain/statistics'

export function validateLearningV5(data: BackupData) {
  const runs = data.focusTimers as unknown as FocusTimer[],
    sessions = data.studySessions as unknown as StudySession[],
    segments = data.timeSegments as unknown as TimeSegment[]
  const cycles = new Map(data.cycles.map((r) => [r.id, r])),
    tasks = new Map(data.tasks.map((r) => [r.id, r])),
    chapters = new Map(data.chapters.map((r) => [r.id, r]))
  const runMap = new Map(runs.map((r) => [r.id, r])),
    sessionMap = new Map(sessions.map((r) => [r.id, r]))
  const grouped = new Map<string, TimeSegment[]>()
  for (const segment of segments)
    grouped.set(segment.sessionId, [...(grouped.get(segment.sessionId) ?? []), segment])
  const keys = new Set<string>()
  for (const record of sessions) {
    if (record.source) {
      if (
        !record.entryId ||
        record.chapterId === undefined ||
        record.timerId === undefined ||
        record.notes === undefined ||
        record.overlapAcknowledged === undefined ||
        record.voidReason === undefined
      )
        throw new Error('新版学习记录的来源信息不完整')
      const key = `${record.entryId}/${record.studyDate}`
      if (keys.has(key)) throw new Error('同一录入组在同一天重复记录')
      keys.add(key)
      if (record.chapterId && chapters.get(record.chapterId)?.cycleId !== record.cycleId)
        throw new Error('学习记录与章节科目不一致')
      if (record.source === 'manual' && record.timerId !== null)
        throw new Error('手动记录不能冒充计时记录')
      if (
        record.source === 'timer' &&
        (!record.timerId || runMap.get(record.timerId)?.status !== 'saved')
      )
        throw new Error('计时学习记录缺少已保存的工作计时')
      if (
        record.timeMode === 'duration_only' &&
        (record.source !== 'manual' ||
          !record.overlapAcknowledged ||
          !record.durationOnlySeconds ||
          record.durationOnlySeconds > 86400)
      )
        throw new Error('新版仅时长补录缺少重叠知情确认或时长无效')
      for (const p of grouped.get(record.id) ?? [])
        if (
          !p.endedAt ||
          todayKey(new Date(p.startedAt)) !== record.studyDate ||
          todayKey(new Date(Date.parse(p.endedAt) - 1)) !== record.studyDate
        )
          throw new Error('新版时间片段跨越学习日，必须按日期拆分')
    }
  }
  if (runs.filter(unfinishedFocus).length > 1) throw new Error('存在多个未结束的工作计时')
  const pending: (typeof runs)[number]['intervals'] = []
  for (const run of runs) {
    if (
      !cycles.has(run.cycleId) ||
      (run.taskId && tasks.get(run.taskId)?.cycleId !== run.cycleId) ||
      (run.chapterId && chapters.get(run.chapterId)?.cycleId !== run.cycleId)
    )
      throw new Error('工作计时与科目、任务或章节关联不完整')
    checkIntervals(run.intervals)
    if (
      intervalMs(run.intervals) > run.targetSeconds * 1000 ||
      run.intervals.some((p) => Date.parse(p.endedAt) > Date.parse(run.checkpointAt))
    )
      throw new Error('工作计时超出目标或可靠检查点')
    if (new Set(run.sessionIds).size !== run.sessionIds.length)
      throw new Error('计时保存后的学习记录ID重复')
    if (run.status === 'saved') {
      const expected = splitLearningDays(run.intervals)
      if (intervalMs(run.intervals) < 1000 || expected.size !== run.sessionIds.length)
        throw new Error('已保存计时的学习记录数量不完整')
      for (const [date, pieces] of expected) {
        const id = `focus-${run.id}:${date}`,
          record = sessionMap.get(id)
        if (
          !run.sessionIds.includes(id) ||
          !record ||
          record.source !== 'timer' ||
          record.timerId !== run.id ||
          record.entryId !== `focus-${run.id}` ||
          record.studyDate !== date ||
          record.cycleId !== run.cycleId ||
          record.taskId !== run.taskId ||
          record.chapterId !== run.chapterId ||
          record.timeMode !== 'segments' ||
          record.status === 'draft'
        )
          throw new Error('已保存计时的学习记录关联不一致')
        const actual = (grouped.get(id) ?? [])
          .map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt }))
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        if (JSON.stringify(actual) !== JSON.stringify(pieces))
          throw new Error('计时检查点与保存后的学习片段不一致')
      }
    } else if (run.sessionIds.length) throw new Error('未保存计时不应关联正式学习记录')
    if (unfinishedFocus(run)) pending.push(...run.intervals)
  }
  for (const record of sessions)
    if (record.source === 'timer' && !runMap.get(record.timerId!)?.sessionIds.includes(record.id))
      throw new Error('学习记录未列入对应计时的保存清单')
  const confirmed = new Set(sessions.filter((s) => s.status === 'confirmed').map((s) => s.id))
  assertDisjoint(
    pending.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    segments
      .filter((p) => confirmed.has(p.sessionId) && p.endedAt)
      .map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt! })),
  )
  const durations = actualSecondsBySession(sessions, segments)
  const dayTotals = new Map<string, number>()
  for (const session of sessions)
    dayTotals.set(
      session.studyDate,
      (dayTotals.get(session.studyDate) ?? 0) + (durations.get(session.id) ?? 0),
    )
  for (const date of new Set(sessions.filter((s) => s.source).map((s) => s.studyDate))) {
    if ((dayTotals.get(date) ?? 0) > 86400) throw new Error('同一学习日确认时间超过24小时')
  }
  return runs.some(unfinishedFocus)
    ? ['有未结束的工作计时，重开或恢复后须核对，不会自动继续或累计']
    : []
}
