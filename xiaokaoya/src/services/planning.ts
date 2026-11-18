import { z } from 'zod'
import { db, type StudyDatabase } from '../data/database'
import { exclusive } from '../data/operation-gate'
import { validDate, weekStart } from '../domain/dates'
import { unfinished } from '../domain/planning'
import type {
  CycleExamStatus,
  ExamMilestone,
  MilestoneKind,
  Task,
  WeeklyPlan,
  WeeklySubjectTarget,
} from '../domain/models'
import { scheduleEvent } from './task-scheduling'

const stamp = () => {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, revision: 1 }
}
const revision = (value: { revision: number }) => ({
  updatedAt: new Date().toISOString(),
  revision: value.revision + 1,
})
const date = z.string().refine(validDate, '请选择有效日期')
const monday = date.refine(
  (value) => validDate(value) && weekStart(value) === value,
  '每周必须从周一开始',
)
const minutes = z
  .number()
  .int('请填写整数分钟')
  .min(0, '目标不能为负数')
  .max(10080, '一周最多168小时')
const weekInput = z.object({
  weekStart: monday,
  goalMinutes: minutes,
  focus: z.string().trim().max(2000, '周重点最多2000字'),
  targets: z.array(z.object({ cycleId: z.string().min(1), targetMinutes: minutes })),
})
const milestoneInput = z.object({
  cycleId: z.string().min(1),
  kind: z.enum([
    'registration_open',
    'registration_close',
    'payment_due',
    'admission_ticket',
    'results_day',
  ]),
  date,
  notes: z.string().trim().max(2000, '说明最多2000字'),
})
export type WeekInput = z.infer<typeof weekInput>
export type MilestoneInput = z.infer<typeof milestoneInput>
function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new Error(result.error.issues[0].message)
  return result.data
}

export class PlanningService {
  constructor(readonly database: StudyDatabase = db) {}
  saveWeek(input: WeekInput, previous?: WeeklyPlan) {
    return exclusive(async () => {
      const value = validate(weekInput, input),
        d = this.database
      if (new Set(value.targets.map((item) => item.cycleId)).size !== value.targets.length)
        throw new Error('同一科目不能重复分配周目标')
      await d.transaction('rw', [d.weeklyPlans, d.weeklySubjectTargets, d.cycles], async () => {
        const current = await d.weeklyPlans.get(value.weekStart)
        if (
          (current &&
            (!previous || previous.id !== current.id || previous.revision !== current.revision)) ||
          (!current && previous)
        )
          throw new Error('本周计划已变化，请重新打开后保存')
        const existing = await d.weeklySubjectTargets
          .where('weekStart')
          .equals(value.weekStart)
          .toArray()
        const requested = new Map(value.targets.map((item) => [item.cycleId, item]))
        for (const target of value.targets) {
          const cycle = await d.cycles.get(target.cycleId),
            old = existing.find((item) => item.cycleId === target.cycleId)
          if (!cycle) throw new Error('本周目标引用的科目不存在')
          if (cycle.archivedAt && (!old?.active || old.targetSeconds !== target.targetMinutes * 60))
            throw new Error('归档周期请先恢复后再分配目标')
        }
        const fields = { goalSeconds: value.goalMinutes * 60, focus: value.focus }
        if (current) await d.weeklyPlans.update(current.id, { ...fields, ...revision(current) })
        else
          await d.weeklyPlans.add({
            ...stamp(),
            id: value.weekStart,
            weekStart: value.weekStart,
            ...fields,
          })
        for (const old of existing) {
          const selected = requested.get(old.cycleId),
            active = !!selected,
            targetSeconds = selected ? selected.targetMinutes * 60 : old.targetSeconds
          if (old.active !== active || old.targetSeconds !== targetSeconds)
            await d.weeklySubjectTargets.update(old.id, { active, targetSeconds, ...revision(old) })
        }
        for (const target of value.targets.filter(
          (item) => !existing.some((old) => old.cycleId === item.cycleId),
        )) {
          const item: WeeklySubjectTarget = {
            ...stamp(),
            weekStart: value.weekStart,
            cycleId: target.cycleId,
            targetSeconds: target.targetMinutes * 60,
            active: true,
          }
          await d.weeklySubjectTargets.add(item)
        }
      })
    })
  }
  scheduleTask(
    task: Task,
    targetDate: string | null,
    mode: 'schedule' | 'unschedule' | 'defer',
    note = '',
    operationId: string = crypto.randomUUID(),
  ) {
    return exclusive(async () => {
      const dateValue = validate(date.nullable(), targetDate),
        reason = validate(z.string().trim().max(500, '调整说明最多500字'), note)
      if (!['schedule', 'unschedule', 'defer'].includes(mode)) throw new Error('安排方式无效')
      if (mode === 'unschedule' ? dateValue !== null : dateValue === null)
        throw new Error('安排方式与目标日期不一致')
      const action =
          mode === 'defer' ? 'deferred' : mode === 'unschedule' ? 'unscheduled' : 'rescheduled',
        d = this.database
      return d.transaction('rw', [d.tasks, d.cycles, d.taskScheduleHistory], async () => {
        const prior = await d.taskScheduleHistory.get(operationId)
        if (prior) {
          if (
            prior.taskId !== task.id ||
            prior.toDate !== dateValue ||
            prior.action !== action ||
            prior.note !== reason
          )
            throw new Error('操作标识已被其他日期变更使用')
          const applied = await d.tasks.get(task.id)
          if (!applied) throw new Error('任务不存在')
          return applied
        }
        const current = await d.tasks.get(task.id)
        if (!current || current.revision !== task.revision || current.cycleId !== task.cycleId)
          throw new Error('任务已变化，请重新打开后安排')
        const cycle = await d.cycles.get(current.cycleId)
        if (!cycle || cycle.archivedAt) throw new Error('年度科目已归档或不存在，请先恢复')
        if (
          mode === 'defer' &&
          (!unfinished(current) ||
            current.plannedDate === null ||
            dateValue === null ||
            dateValue <= current.plannedDate)
        )
          throw new Error('只能把未完成任务延期到晚于原安排的日期')
        if (current.plannedDate === dateValue) return current
        const now = new Date().toISOString(),
          next = {
            ...current,
            plannedDate: dateValue,
            status: mode === 'defer' ? ('deferred' as const) : current.status,
            revision: current.revision + 1,
            updatedAt: now,
          }
        await d.taskScheduleHistory.add(
          scheduleEvent(current, dateValue, action, operationId, next.revision, now, reason),
        )
        await d.tasks.put(next)
        return next
      })
    })
  }
  saveMilestone(
    input: MilestoneInput,
    previous?: ExamMilestone,
    operationId: string = crypto.randomUUID(),
  ) {
    return exclusive(async () => {
      const value = validate(milestoneInput, input),
        d = this.database
      return d.transaction('rw', [d.cycles, d.examMilestones], async () => {
        const cycle = await d.cycles.get(value.cycleId)
        if (!cycle || cycle.archivedAt) throw new Error('年度科目已归档或不存在，请先恢复')
        const current = await d.examMilestones
          .where('[cycleId+kind]')
          .equals([value.cycleId, value.kind])
          .first()
        if (
          !previous &&
          current?.id === operationId &&
          current.date === value.date &&
          current.notes === value.notes
        )
          return current.id
        if (
          (current &&
            (!previous || current.id !== previous.id || current.revision !== previous.revision)) ||
          (!current && previous)
        )
          throw new Error('此日期节点已存在或发生变化，请重新选择后编辑')
        if (current)
          await d.examMilestones.update(current.id, {
            date: value.date,
            notes: value.notes,
            archivedAt: null,
            ...revision(current),
          })
        else await d.examMilestones.add({ ...stamp(), id: operationId, ...value, archivedAt: null })
        return current?.id ?? operationId
      })
    })
  }
  setExamDate(cycleId: string, value: string | null, previous: CycleExamStatus) {
    return exclusive(async () => {
      validate(date.nullable(), value)
      const d = this.database
      await d.transaction('rw', [d.cycles, d.cycleStatuses], async () => {
        const cycle = await d.cycles.get(cycleId),
          current = await d.cycleStatuses.get(cycleId)
        if (!cycle || cycle.archivedAt) throw new Error('年度科目已归档或不存在，请先恢复')
        if (!current || previous.id !== cycleId || current.revision !== previous.revision)
          throw new Error('考试档案已变化，请重新选择后编辑')
        if (current.examDate !== value)
          await d.cycleStatuses.update(cycleId, { examDate: value, ...revision(current) })
      })
    })
  }
  archiveMilestone(previous: ExamMilestone, archived: boolean) {
    return exclusive(async () => {
      const d = this.database
      await d.transaction('rw', [d.cycles, d.examMilestones], async () => {
        const current = await d.examMilestones.get(previous.id),
          cycle = await d.cycles.get(previous.cycleId)
        if (!current || current.revision !== previous.revision)
          throw new Error('日期节点已变化，请重试')
        if (!cycle || cycle.archivedAt) throw new Error('年度科目已归档或不存在，请先恢复')
        await d.examMilestones.update(current.id, {
          archivedAt: archived ? new Date().toISOString() : null,
          ...revision(current),
        })
      })
    })
  }
}
export const planning = new PlanningService()
