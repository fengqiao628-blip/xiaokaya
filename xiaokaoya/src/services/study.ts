import { z } from 'zod'
import { StudyDatabase, db } from '../data/database'
import { todayKey, validDate } from '../domain/dates'
import type { Task, TaskStatus, Entity } from '../domain/models'
import companionCatalog from '../companions/catalog.json'
import { exclusive } from '../data/operation-gate'
import { defaultCycleStatus } from '../shared/migration'
import { scheduleEvent } from './task-scheduling'
import { attribution } from '../domain/experience'

const stamp = (): Entity => {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, revision: 1 }
}
const taskSchema = z.object({
  cycleId: z.string().min(1, '请先选择一门学习科目'),
  title: z.string().trim().min(1, '写下这次想学习的内容吧').max(160, '任务名称最多160字'),
  plannedDate: z.string().refine(validDate, '请选择有效日期').nullable(),
  kind: z.enum(['study', 'review']).optional().default('study'),
  estimatedMinutes: z
    .number()
    .int('时长请填写整数分钟')
    .min(1, '预计时长至少1分钟')
    .max(1440, '预计时长不能超过24小时'),
  notes: z.string().trim().max(2000, '备注最多2000字'),
  chapterId: z.string().min(1).nullable().optional().default(null),
})
export type TaskInput = z.input<typeof taskSchema>
function validateTask(input: TaskInput) {
  const result = taskSchema.safeParse(input)
  if (!result.success) throw new Error(result.error.issues[0].message)
  return result.data
}

export class StudyService {
  constructor(public database: StudyDatabase = db) {}
  selectSubjects(year: number, subjectIds: string[]) {
    return exclusive(() => this.selectSubjectsUnlocked(year, subjectIds))
  }
  createTask(input: TaskInput, operationId = crypto.randomUUID()) {
    return exclusive(() => this.createTaskUnlocked(input, operationId))
  }
  updateTask(task: Task, input: TaskInput) {
    return exclusive(() => this.updateTaskUnlocked(task, input))
  }
  setTaskStatus(task: Task, status: TaskStatus) {
    return exclusive(() => this.setTaskStatusUnlocked(task, status))
  }
  setCompanion(id: string) {
    return exclusive(() => this.setCompanionUnlocked(id))
  }
  dailyQuote(date = todayKey(), next = false) {
    return exclusive(() => this.dailyQuoteUnlocked(date, next))
  }
  chooseQuote(date: string, id: string) {
    return exclusive(() => this.dailyQuoteUnlocked(date, true, id))
  }
  private async selectSubjectsUnlocked(year: number, subjectIds: string[]) {
    if (!Number.isInteger(year) || year < 1900 || year > 9999)
      throw new Error('年份须为1900—9999之间的整数')
    const ids = [...new Set(subjectIds)]
    const d = this.database
    await d.transaction('rw', [d.subjects, d.annualPlans, d.cycles, d.cycleStatuses], async () => {
      const records = await d.subjects.bulkGet(ids)
      if (records.some((record) => !record)) throw new Error('选择中包含不存在的科目')
      let plan = await d.annualPlans.where('year').equals(year).first()
      if (!plan) {
        plan = { ...stamp(), year, goal: '' }
        await d.annualPlans.add(plan)
      }
      const existing = await d.cycles.where('annualPlanId').equals(plan.id).toArray()
      for (const cycle of existing) {
        const selected = ids.includes(cycle.subjectId)
        if (cycle.archivedAt) {
          if (selected) throw new Error('该备考周期已归档，请先在科目档案中恢复')
          continue
        }
        const next = selected
          ? cycle.learningStatus === 'paused'
            ? 'planned'
            : cycle.learningStatus
          : 'paused'
        if (next !== cycle.learningStatus)
          await d.cycles.update(cycle.id, {
            learningStatus: next,
            updatedAt: new Date().toISOString(),
            revision: cycle.revision + 1,
          })
      }
      for (const subjectId of ids)
        if (!existing.some((cycle) => cycle.subjectId === subjectId)) {
          const cycle = {
            ...stamp(),
            subjectId,
            annualPlanId: plan.id,
            learningStatus: 'planned' as const,
            archivedAt: null,
          }
          await d.cycles.add(cycle)
          await d.cycleStatuses.add(defaultCycleStatus(cycle.id, cycle.createdAt))
        }
    })
  }
  private async createTaskUnlocked(input: TaskInput, operationId: string) {
    const value = validateTask(input)
    const d = this.database
    return d.transaction(
      'rw',
      [d.cycles, d.subjects, d.tasks, d.chapters, d.taskScheduleHistory],
      async () => {
        const existing = await d.tasks.get(operationId)
        if (existing) {
          if (
            existing.cycleId !== value.cycleId ||
            existing.title !== value.title ||
            existing.plannedDate !== value.plannedDate ||
            existing.estimatedSeconds !== value.estimatedMinutes * 60 ||
            existing.notes !== value.notes ||
            existing.chapterId !== value.chapterId ||
            (existing.kind ?? 'study') !== value.kind
          )
            throw new Error('操作标识已被其他任务使用，请重新打开新建窗口')
          return existing
        }
        const cycle = await d.cycles.get(value.cycleId)
        if (
          !cycle ||
          cycle.learningStatus === 'paused' ||
          cycle.archivedAt ||
          !(await d.subjects.get(cycle.subjectId))
        )
          throw new Error('这门科目已暂停或不存在，请重新选择')
        if (value.chapterId) {
          const chapter = await d.chapters.get(value.chapterId)
          if (!chapter || chapter.cycleId !== cycle.id || chapter.archivedAt)
            throw new Error('章节不存在、已归档或属于其他年度科目')
        }
        const task: Task = {
          ...stamp(),
          id: operationId,
          cycleId: value.cycleId,
          title: value.title,
          plannedDate: value.plannedDate,
          estimatedSeconds: value.estimatedMinutes * 60,
          notes: value.notes,
          chapterId: value.chapterId,
          status: 'pending',
          kind: value.kind,
        }
        await d.tasks.add(task)
        await d.taskScheduleHistory.add(
          scheduleEvent(task, task.plannedDate, 'created', `create-${task.id}`, 1, task.createdAt),
        )
        return task
      },
    )
  }
  private async updateTaskUnlocked(task: Task, input: TaskInput) {
    const value = validateTask(input)
    const d = this.database
    if (value.cycleId !== task.cycleId) throw new Error('请保留任务原有科目，避免影响历史关联')
    await d.transaction(
      'rw',
      [d.tasks, d.chapters, d.studySessions, d.cycles, d.taskScheduleHistory],
      async () => {
        const current = await d.tasks.get(task.id)
        if (!current || current.revision !== task.revision)
          throw new Error('任务已发生变化，请关闭窗口后重试')
        if (value.chapterId !== current.chapterId) {
          if (await d.studySessions.where('taskId').equals(task.id).count())
            throw new Error('任务已有学习记录，请保留原章节关联')
          if (value.chapterId) {
            const chapter = await d.chapters.get(value.chapterId)
            if (!chapter || chapter.cycleId !== current.cycleId || chapter.archivedAt)
              throw new Error('章节不存在、已归档或属于其他年度科目')
          }
        }
        const now = new Date().toISOString()
        if (current.plannedDate !== value.plannedDate) {
          if ((await d.cycles.get(current.cycleId))?.archivedAt)
            throw new Error('该年度科目已归档，请先恢复后再调整日期')
          await d.taskScheduleHistory.add(
            scheduleEvent(
              current,
              value.plannedDate,
              value.plannedDate === null ? 'unscheduled' : 'rescheduled',
              crypto.randomUUID(),
              current.revision + 1,
              now,
            ),
          )
        }
        await d.tasks.update(task.id, {
          title: value.title,
          plannedDate: value.plannedDate,
          estimatedSeconds: value.estimatedMinutes * 60,
          notes: value.notes,
          chapterId: value.chapterId,
          kind: value.kind,
          revision: current.revision + 1,
          updatedAt: now,
        })
      },
    )
  }
  private async setTaskStatusUnlocked(task: Task, status: TaskStatus) {
    if (
      !['pending', 'in_progress', 'completed', 'partial', 'deferred', 'cancelled'].includes(status)
    )
      throw new Error('任务状态无效')
    const d = this.database
    await d.transaction('rw', d.tasks, async () => {
      const current = await d.tasks.get(task.id)
      if (!current || current.revision !== task.revision) throw new Error('任务已更新，请重试')
      await d.tasks.update(task.id, {
        status,
        updatedAt: new Date().toISOString(),
        revision: current.revision + 1,
      })
    })
  }
  private async setCompanionUnlocked(id: string) {
    if (!companionCatalog.some((item) => item.id === id)) throw new Error('学习伙伴不存在')
    const d = this.database
    await d.transaction('rw', d.preferences, async () => {
      const pref = await d.preferences.get('preferences')
      if (!pref) throw new Error('偏好设置缺失，请保留数据并联系开发者')
      await d.preferences.update(pref.id, {
        companionId: id,
        updatedAt: new Date().toISOString(),
        revision: pref.revision + 1,
      })
    })
  }
  private async dailyQuoteUnlocked(date: string, next: boolean, selectedId?: string) {
    if (!validDate(date)) throw new Error('日期无效')
    const d = this.database
    return d.transaction(
      'rw',
      [d.quotes, d.quoteDetails, d.experienceSettings, d.dailyQuotes, d.quoteHistory],
      async () => {
        const previous = await d.dailyQuotes.get(date)
        if (previous && !next) return previous
        const details = new Map((await d.quoteDetails.toArray()).map((row) => [row.id, row]))
        const settings = await d.experienceSettings.get('experience')
        const all = (await d.quotes.orderBy('id').toArray()).filter(
          (q) => details.get(q.id)?.archivedAt === null,
        )
        const list = selectedId
          ? all.filter((q) => q.id === selectedId)
          : all.filter((q) => !settings?.quoteCategory || q.category === settings.quoteCategory)
        if (!list.length) throw new Error('当前分类暂无可用语句，请到语库调整分类或恢复归档语句')
        const rotation = previous ? previous.rotation + 1 : 0
        const day = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 86400000)
        const oldIndex = previous ? list.findIndex((q) => q.id === previous.quoteId) : -1
        const quote =
          list[
            oldIndex >= 0
              ? (oldIndex + 1) % list.length
              : (((day + rotation) % list.length) + list.length) % list.length
          ]
        const now = new Date().toISOString()
        const source = { attribution: attribution(details.get(quote.id)!) }
        const assignment = {
          date,
          quoteId: quote.id,
          text: quote.text,
          rotation,
          updatedAt: now,
          ...source,
        }
        await d.dailyQuotes.put(assignment)
        await d.quoteHistory.add({
          id: crypto.randomUUID(),
          date,
          quoteId: quote.id,
          text: quote.text,
          shownAt: now,
          reason: previous ? 'manual' : 'daily',
          ...source,
        })
        return assignment
      },
    )
  }
}
export const study = new StudyService()
