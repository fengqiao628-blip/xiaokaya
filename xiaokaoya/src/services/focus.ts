import { z } from 'zod'
import { db, type StudyDatabase } from '../data/database'
import { exclusive } from '../data/operation-gate'
import type { FocusTimer, FocusReason, StudySession } from '../domain/models'
import {
  advanceFocus,
  intervalMs,
  splitLearningDays,
  unfinishedFocus,
} from '../domain/learning-time'
import { stamp, learningContext, checkLearningOverlap, checkDayCapacity } from './learning'

export interface FocusClock {
  wall(): number
  mono(): number
}
export class FocusService {
  private marks = new Map<string, { revision: number; at: number }>()
  constructor(
    readonly database: StudyDatabase = db,
    readonly clock: FocusClock = { wall: () => Date.now(), mono: () => performance.now() },
  ) {}
  private stamp(run: FocusTimer) {
    return {
      ...run,
      updatedAt: new Date(this.clock.wall()).toISOString(),
      revision: run.revision + 1,
    }
  }
  private sample(current: FocusTimer, reason?: FocusReason) {
    const mark = this.marks.get(current.id),
      wall = this.clock.wall(),
      mono = this.clock.mono()
    const next =
      mark?.revision === current.revision
        ? advanceFocus(current, wall, mono - mark.at, reason)
        : { ...current, status: 'review' as const, reason: 'interrupted' as const }
    return { next, mono }
  }
  private own(run: FocusTimer, mono: number) {
    if (run.status === 'running') this.marks.set(run.id, { revision: run.revision, at: mono })
    else this.marks.delete(run.id)
  }
  preview(run: FocusTimer) {
    if (run.status !== 'running') return run
    return this.sample(run).next
  }
  start(
    input: {
      cycleId: string
      taskId: string | null
      chapterId: string | null
      targetSeconds: number
      mockExamId?: string
    },
    operationId: string = crypto.randomUUID(),
  ) {
    return exclusive(async () => {
      const { mockExamId, ...value } = z
        .object({
          cycleId: z.string().min(1).max(200),
          taskId: z.string().min(1).max(200).nullable(),
          chapterId: z.string().min(1).max(200).nullable(),
          targetSeconds: z.number().int().min(1).max(28800),
          mockExamId: z.string().min(1).max(200).optional(),
        })
        .parse(input)
      const d = this.database,
        wall = this.clock.wall(),
        mono = this.clock.mono(),
        at = new Date(wall).toISOString()
      const { run, created } = await d.transaction(
        'rw',
        [d.focusTimers, d.cycles, d.tasks, d.chapters, d.mockExams],
        async () => {
          const prior = await d.focusTimers.get(operationId)
          const exam = mockExamId ? await d.mockExams.get(mockExamId) : undefined
          if (
            mockExamId &&
            (!exam ||
              exam.cycleId !== value.cycleId ||
              exam.targetSeconds !== value.targetSeconds ||
              value.taskId ||
              value.chapterId ||
              exam.status !== 'prepared' ||
              exam.studySessionId ||
              (exam.timerId && exam.timerId !== operationId))
          )
            throw new Error('模拟考试已变化或已有时间来源，请重新查看')
          if (prior) {
            if (
              prior.cycleId !== value.cycleId ||
              prior.taskId !== value.taskId ||
              prior.chapterId !== value.chapterId ||
              prior.targetSeconds !== value.targetSeconds
            )
              throw new Error('这次计时已创建，参数发生变化，请重新打开')
            return { run: prior, created: false }
          }
          if ((await d.focusTimers.toArray()).some(unfinishedFocus))
            throw new Error('已有进行中或待确认的计时，请先暂停并保存或作废本次，再切换任务')
          await learningContext(d, value.cycleId, value.taskId, value.chapterId)
          if (value.taskId && (await d.tasks.get(value.taskId))?.status === 'cancelled')
            throw new Error('已取消任务不能开始新计时')
          const run: FocusTimer = {
            ...stamp(operationId, at),
            ...value,
            status: 'running',
            reason: 'started',
            checkpointAt: at,
            intervals: [],
            sessionIds: [],
          }
          await d.focusTimers.add(run)
          if (exam)
            await d.mockExams.update(exam.id, {
              timerId: run.id,
              updatedAt: at,
              revision: exam.revision + 1,
            })
          return { run, created: true }
        },
      )
      if (created) this.own(run, mono)
      return run
    })
  }
  async pulse() {
    return exclusive(async () => {
      const d = this.database
      const current = await d.focusTimers.where('status').equals('running').first()
      if (!current) return null
      try {
        return await d.transaction('rw', d.focusTimers, async () => {
          const row = await d.focusTimers.get(current.id)
          if (!row || row.status !== 'running') return row ?? null
          const { next, mono } = this.sample(row)
          if (next.status === 'running' && this.clock.wall() - Date.parse(row.checkpointAt) < 5000)
            return row
          const saved = this.stamp(next)
          await d.focusTimers.put(saved)
          this.own(saved, mono)
          return saved
        })
      } catch (error) {
        this.marks.delete(current.id)
        throw error
      }
    })
  }
  pause(id: string, reason: FocusReason = 'paused') {
    return exclusive(async () => {
      const d = this.database
      try {
        return await d.transaction('rw', d.focusTimers, async () => {
          const row = await d.focusTimers.get(id)
          if (!row) throw new Error('本次计时不存在')
          if (row.status !== 'running') return row
          const { next, mono } = this.sample(row, reason)
          const saved = this.stamp(next)
          await d.focusTimers.put(saved)
          this.own(saved, mono)
          return saved
        })
      } catch (error) {
        this.marks.delete(id)
        throw error
      }
    })
  }
  suspend(reason: FocusReason) {
    return exclusive(async () => {
      const d = this.database
      const row = await d.focusTimers.where('status').equals('running').first()
      if (!row) return null
      try {
        return await d.transaction('rw', d.focusTimers, async () => {
          const current = await d.focusTimers.get(row.id)
          if (!current || current.status !== 'running') return current ?? null
          const { next, mono } = this.sample(current, reason)
          const saved = this.stamp(next)
          await d.focusTimers.put(saved)
          this.own(saved, mono)
          return saved
        })
      } catch (error) {
        this.marks.delete(row.id)
        throw error
      }
    })
  }
  recover(reason: 'interrupted' | 'restore' = 'interrupted') {
    this.marks.clear()
    return exclusive(async () => {
      const d = this.database
      await d.transaction('rw', d.focusTimers, async () => {
        for (const row of await d.focusTimers.toArray())
          if (['running', 'paused'].includes(row.status))
            await d.focusTimers.put(this.stamp({ ...row, status: 'review', reason }))
      })
    })
  }
  resume(previous: FocusTimer) {
    return exclusive(async () => {
      const d = this.database,
        wall = this.clock.wall(),
        mono = this.clock.mono()
      const saved = await d.transaction(
        'rw',
        [d.focusTimers, d.cycles, d.tasks, d.chapters],
        async () => {
          const row = await d.focusTimers.get(previous.id)
          if (!row || row.revision !== previous.revision) throw new Error('计时已变化，请重新查看')
          if (
            !['paused', 'review'].includes(row.status) ||
            intervalMs(row.intervals) >= row.targetSeconds * 1000
          )
            throw new Error('本段已结束，请先确认保存，再开始下一段')
          if (row.intervals.some((p) => Date.parse(p.endedAt) > wall))
            throw new Error('系统时间早于已保存片段，请核对电脑时间后再继续')
          await learningContext(d, row.cycleId, row.taskId, row.chapterId)
          const next = this.stamp({
            ...row,
            status: 'running',
            reason: 'resumed',
            checkpointAt: new Date(wall).toISOString(),
          })
          await d.focusTimers.put(next)
          return next
        },
      )
      this.own(saved, mono)
      return saved
    })
  }
  save(previous: FocusTimer, notes = '') {
    return exclusive(async () => {
      const d = this.database,
        at = new Date(this.clock.wall()).toISOString()
      if (notes.trim().length > 2000) throw new Error('学习备注最多2000字')
      return d.transaction(
        'rw',
        [d.focusTimers, d.studySessions, d.timeSegments, d.cycles, d.tasks, d.chapters],
        async () => {
          const row = await d.focusTimers.get(previous.id)
          if (!row) throw new Error('本次计时不存在')
          if (row.status === 'saved') return row.sessionIds
          if (row.revision !== previous.revision) throw new Error('计时已变化，请重新查看')
          if (!['paused', 'review'].includes(row.status))
            throw new Error('请先结束或暂停本次计时，再核对保存')
          if (intervalMs(row.intervals) < 1000)
            throw new Error('有效学习不足1秒，可继续本次或作废，未计入实际学习')
          if (row.intervals.some((p) => Date.parse(p.endedAt) > this.clock.wall()))
            throw new Error('片段晚于现在，请先核对电脑时间')
          await learningContext(d, row.cycleId, row.taskId, row.chapterId, true)
          await checkLearningOverlap(d, row.intervals, undefined, row.id)
          const groups = splitLearningDays(row.intervals)
          await checkDayCapacity(d, groups)
          const ids: string[] = [],
            entryId = `focus-${row.id}`
          for (const [day, pieces] of groups) {
            const id = `${entryId}:${day}`
            const session: StudySession = {
              ...stamp(id, at),
              cycleId: row.cycleId,
              taskId: row.taskId,
              chapterId: row.chapterId,
              studyDate: day,
              status: 'confirmed',
              timeMode: 'segments',
              durationOnlySeconds: null,
              source: 'timer',
              entryId,
              timerId: row.id,
              notes: notes.trim(),
              overlapAcknowledged: false,
              voidReason: '',
            }
            await d.studySessions.add(session)
            for (let i = 0; i < pieces.length; i++)
              await d.timeSegments.add({ ...stamp(`${id}:${i}`, at), sessionId: id, ...pieces[i] })
            ids.push(id)
          }
          await d.focusTimers.put(this.stamp({ ...row, status: 'saved', sessionIds: ids }))
          this.marks.delete(row.id)
          return ids
        },
      )
    })
  }
  discard(previous: FocusTimer) {
    return exclusive(async () => {
      const d = this.database
      await d.transaction('rw', d.focusTimers, async () => {
        const row = await d.focusTimers.get(previous.id)
        if (!row) throw new Error('本次计时不存在')
        if (row.status === 'discarded') return
        if (
          row.revision !== previous.revision ||
          row.status === 'running' ||
          row.status === 'saved'
        )
          throw new Error('请先暂停本次；已保存记录请在学习记录中作废')
        await d.focusTimers.put(this.stamp({ ...row, status: 'discarded' }))
        this.marks.delete(row.id)
      })
    })
  }
}
export const focus = new FocusService()
