import { z } from 'zod'
import { db, type StudyDatabase } from '../data/database'
import { exclusive } from '../data/operation-gate'
import type { FocusInterval, StudySession } from '../domain/models'
import {
  assertDisjoint,
  intervalMs,
  splitLearningDays,
  unfinishedFocus,
} from '../domain/learning-time'
import { todayKey, validDate } from '../domain/dates'
import { actualSecondsBySession } from '../domain/statistics'

export type ManualInput = {
  cycleId: string
  taskId: string | null
  chapterId: string | null
  notes: string
  mode: 'duration' | 'range'
  date: string
  seconds: number
  startedAt: string
  endedAt: string
  overlapAcknowledged: boolean
}
export const stamp = (id: string, now: string) => ({
  id,
  createdAt: now,
  updatedAt: now,
  revision: 1,
})
export async function learningContext(
  d: StudyDatabase,
  cycleId: string,
  taskId: string | null,
  chapterId: string | null,
  historical = false,
) {
  const cycle = await d.cycles.get(cycleId)
  if (!cycle || (!historical && cycle.archivedAt))
    throw new Error('科目不存在或已归档，请先恢复科目')
  if (taskId && (await d.tasks.get(taskId))?.cycleId !== cycleId)
    throw new Error('任务与学习科目不一致')
  if (chapterId) {
    const chapter = await d.chapters.get(chapterId)
    if (chapter?.cycleId !== cycleId || (!historical && chapter.archivedAt))
      throw new Error('章节不存在、已归档或属于其他科目')
  }
}
export async function checkLearningOverlap(
  d: StudyDatabase,
  list: FocusInterval[],
  skipSession?: string,
  skipTimer?: string,
) {
  const sessions = (await d.studySessions.toArray()).filter(
    (s) => s.status === 'confirmed' && s.id !== skipSession,
  )
  const ids = new Set(sessions.map((s) => s.id))
  const prior = (await d.timeSegments.toArray())
    .filter((s) => ids.has(s.sessionId) && s.endedAt)
    .map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt! }))
  for (const run of await d.focusTimers.toArray())
    if (unfinishedFocus(run) && run.id !== skipTimer) prior.push(...run.intervals)
  assertDisjoint(list, prior)
}
export async function checkDayCapacity(
  d: StudyDatabase,
  groups: Map<string, FocusInterval[]>,
  duration?: { date: string; seconds: number },
  skipSession?: string,
) {
  const records = (await d.studySessions.toArray()).filter((s) => s.id !== skipSession)
  const durations = actualSecondsBySession(records, await d.timeSegments.toArray())
  const days = new Set([...groups.keys(), ...(duration ? [duration.date] : [])])
  for (const day of days) {
    const old = records
      .filter((s) => s.studyDate === day)
      .reduce((n, s) => n + (durations.get(s.id) ?? 0), 0)
    const added =
      intervalMs(groups.get(day) ?? []) / 1000 + (duration?.date === day ? duration.seconds : 0)
    if (old + added > 86400) throw new Error('同一天确认的学习时间不能超过24小时，请核对原记录')
  }
}
export class LearningService {
  constructor(
    readonly database: StudyDatabase = db,
    readonly now = () => Date.now(),
  ) {}
  manual(input: ManualInput, operationId: string = crypto.randomUUID()) {
    return exclusive(async () => {
      const text = z.string().trim().min(1).max(200)
      const value = z
        .object({
          cycleId: text,
          taskId: text.nullable(),
          chapterId: text.nullable(),
          notes: z.string().trim().max(2000),
          mode: z.enum(['duration', 'range']),
          date: z.string(),
          seconds: z.number(),
          startedAt: z.string(),
          endedAt: z.string(),
          overlapAcknowledged: z.boolean(),
        })
        .parse(input)
      const d = this.database,
        at = this.now(),
        timestamp = new Date(at).toISOString()
      const entryId = `manual-${operationId}`
      return d.transaction(
        'rw',
        [d.studySessions, d.timeSegments, d.focusTimers, d.cycles, d.tasks, d.chapters],
        async () => {
          const prior = await d.studySessions.where('entryId').equals(entryId).toArray()
          if (prior.length) {
            const expected =
              value.mode === 'duration'
                ? new Map([[value.date, [] as FocusInterval[]]])
                : splitLearningDays([{ startedAt: value.startedAt, endedAt: value.endedAt }])
            if (
              prior.length !== expected.size ||
              prior.some(
                (s) =>
                  s.cycleId !== value.cycleId ||
                  s.taskId !== value.taskId ||
                  s.chapterId !== value.chapterId ||
                  s.notes !== value.notes ||
                  s.timeMode !== (value.mode === 'duration' ? 'duration_only' : 'segments') ||
                  !expected.has(s.studyDate) ||
                  (value.mode === 'duration' && s.durationOnlySeconds !== value.seconds),
              )
            )
              throw new Error('这次录入已保存，内容发生变化，请重新新建记录')
            if (value.mode === 'range')
              for (const s of prior) {
                const pieces = await d.timeSegments.where('sessionId').equals(s.id).toArray()
                if (
                  JSON.stringify(
                    pieces.map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt })),
                  ) !== JSON.stringify(expected.get(s.studyDate))
                )
                  throw new Error('这次录入已保存，起止时间发生变化')
              }
            return prior.map((s) => s.id)
          }
          await learningContext(d, value.cycleId, value.taskId, value.chapterId)
          let groups = new Map<string, FocusInterval[]>()
          if (value.mode === 'duration') {
            if (!validDate(value.date) || value.date > todayKey(new Date(at)))
              throw new Error('请选择今天或过去的有效学习日期')
            if (!Number.isInteger(value.seconds) || value.seconds < 1 || value.seconds > 86400)
              throw new Error('实际时长应在1秒至24小时之间')
            if (!value.overlapAcknowledged)
              throw new Error('仅时长无法检查重叠，请勾选知情确认；也可改填起止时间')
            groups.set(value.date, [])
          } else {
            const a = Date.parse(value.startedAt),
              b = Date.parse(value.endedAt)
            if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 86400000 || b > at)
              throw new Error('请填写有效的实际起止时间，最长24小时且不能晚于现在')
            if ((await d.focusTimers.where('status').equals('running').count()) > 0)
              throw new Error('请先暂停当前计时，再补录起止时间')
            groups = splitLearningDays([
              { startedAt: new Date(a).toISOString(), endedAt: new Date(b).toISOString() },
            ])
            await checkLearningOverlap(d, [...groups.values()].flat())
          }
          await checkDayCapacity(
            d,
            groups,
            value.mode === 'duration' ? { date: value.date, seconds: value.seconds } : undefined,
          )
          const ids: string[] = []
          for (const [day, pieces] of groups) {
            const id = `${entryId}:${day}`
            const session: StudySession = {
              ...stamp(id, timestamp),
              cycleId: value.cycleId,
              taskId: value.taskId,
              chapterId: value.chapterId,
              studyDate: day,
              status: 'confirmed',
              timeMode: value.mode === 'duration' ? 'duration_only' : 'segments',
              durationOnlySeconds: value.mode === 'duration' ? value.seconds : null,
              source: 'manual',
              entryId,
              timerId: null,
              notes: value.notes,
              overlapAcknowledged: value.mode === 'duration' && value.overlapAcknowledged,
              voidReason: '',
            }
            await d.studySessions.add(session)
            for (let i = 0; i < pieces.length; i++)
              await d.timeSegments.add({
                ...stamp(`${id}:${i}`, timestamp),
                sessionId: id,
                ...pieces[i],
              })
            ids.push(id)
          }
          return ids
        },
      )
    })
  }
  setStatus(previous: StudySession, status: 'confirmed' | 'voided', reason = '') {
    return exclusive(async () => {
      const d = this.database
      return d.transaction('rw', [d.studySessions, d.timeSegments, d.focusTimers], async () => {
        const current = await d.studySessions.get(previous.id)
        if (!current) throw new Error('学习记录不存在')
        if (current.status === status) return current
        if (current.revision !== previous.revision) throw new Error('记录已变化，请重新打开后操作')
        if (status === 'voided' && (!reason.trim() || reason.length > 500))
          throw new Error('请填写1—500字作废说明，原记录将保留')
        if (status === 'confirmed') {
          const pieces = await d.timeSegments.where('sessionId').equals(current.id).toArray()
          if (current.timeMode === 'segments') {
            if (
              !pieces.length ||
              pieces.some((p) => !p.endedAt || Date.parse(p.endedAt) > this.now())
            )
              throw new Error('时间片段尚未结束或无效，请保留原记录并重新补录')
            const intervals = pieces
              .map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt! }))
              .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
            await checkLearningOverlap(d, intervals, current.id, current.timerId ?? undefined)
            await checkDayCapacity(d, splitLearningDays(intervals), undefined, current.id)
          } else {
            if (!current.durationOnlySeconds || current.durationOnlySeconds > 86400)
              throw new Error('请先核对补录的实际时长')
            await checkDayCapacity(
              d,
              new Map(),
              { date: current.studyDate, seconds: current.durationOnlySeconds },
              current.id,
            )
          }
        }
        const result = {
          ...current,
          status,
          voidReason: status === 'voided' ? reason.trim() : (current.voidReason ?? ''),
          updatedAt: new Date(this.now()).toISOString(),
          revision: current.revision + 1,
        }
        await d.studySessions.put(result)
        return result
      })
    })
  }
}
export const learning = new LearningService()
