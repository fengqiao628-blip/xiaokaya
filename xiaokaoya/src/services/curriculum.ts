import { z } from 'zod'
import { db, type StudyDatabase } from '../data/database'
import { exclusive } from '../data/operation-gate'
import { validDate } from '../domain/dates'
import type {
  Chapter,
  CycleExamStatus,
  LearningMaterial,
  MaterialProgress,
  StudyCycle,
} from '../domain/models'

const stamp = () => {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }
}
const revision = (record: { revision: number }) => ({
  revision: record.revision + 1,
  updatedAt: new Date().toISOString(),
})
const title = z.string().trim().min(1, '请填写名称').max(160, '名称最多160字')
const notes = z.string().trim().max(2000, '备注最多2000字')
const partId = z.string().min(1).nullable()
const statusInput = z.object({
  learningStatus: z.enum(['planned', 'studying', 'paused']),
  registrationStatus: z.enum(['not_planned', 'planned', 'registered', 'attended']),
  examResult: z.enum(['unrecorded', 'passed', 'failed']),
  examDate: z.string().refine(validDate, '考试日期无效').nullable(),
  notes,
})
const materialInput = z.object({
  title,
  kind: z.enum(['textbook', 'video']),
  edition: z.string().trim().max(200, '版本说明最多200字'),
  partId,
})
const chapterInput = z.object({
  title,
  partId,
  completionStatus: z.enum(['not_started', 'learning', 'completed']),
  masteryStars: z.number().int().min(1).max(5).nullable(),
  notes,
})
export type CycleInput = z.infer<typeof statusInput>
export type MaterialInput = z.infer<typeof materialInput>
export type ChapterInput = z.infer<typeof chapterInput>
function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new Error(result.error.issues[0].message)
  return result.data
}

export class CurriculumService {
  constructor(readonly database: StudyDatabase = db) {}
  private async cycle(id: string) {
    const cycle = await this.database.cycles.get(id)
    if (!cycle) throw new Error('备考周期不存在')
    if (cycle.archivedAt) throw new Error('该周期已归档，请先恢复后再编辑')
    return cycle
  }
  private async part(cycle: StudyCycle, id: string | null) {
    if (id && (await this.database.subjectParts.get(id))?.subjectId !== cycle.subjectId)
      throw new Error('试卷子项与本年度科目不一致')
  }
  saveCycle(cycle: StudyCycle, status: CycleExamStatus, input: CycleInput) {
    return exclusive(async () => {
      const value = validate(statusInput, input),
        d = this.database
      await d.transaction('rw', [d.cycles, d.cycleStatuses], async () => {
        const current = await this.cycle(cycle.id),
          exam = await d.cycleStatuses.get(cycle.id)
        if (
          status.id !== cycle.id ||
          current.revision !== cycle.revision ||
          exam?.revision !== status.revision
        )
          throw new Error('档案已发生变化，请重新打开后编辑')
        await d.cycles.update(cycle.id, {
          learningStatus: value.learningStatus,
          ...revision(current),
        })
        const { learningStatus: _, ...examValue } = value
        await d.cycleStatuses.update(cycle.id, { ...examValue, ...revision(exam) })
      })
    })
  }
  archiveCycle(cycle: StudyCycle, archived: boolean) {
    return exclusive(() =>
      this.database.transaction('rw', this.database.cycles, async () => {
        const current = await this.database.cycles.get(cycle.id)
        if (!current || current.revision !== cycle.revision) throw new Error('周期已变化，请重试')
        await this.database.cycles.update(cycle.id, {
          archivedAt: archived ? new Date().toISOString() : null,
          ...revision(current),
        })
      }),
    )
  }
  saveMaterial(
    cycleId: string,
    input: MaterialInput,
    previous?: LearningMaterial,
    operationId: string = crypto.randomUUID(),
  ) {
    return exclusive(async () => {
      const value = validate(materialInput, input),
        d = this.database
      return d.transaction(
        'rw',
        [d.cycles, d.subjectParts, d.materials, d.materialProgress],
        async () => {
          const cycle = await this.cycle(cycleId)
          await this.part(cycle, value.partId)
          if (previous) {
            const current = await d.materials.get(previous.id)
            if (
              !current ||
              current.cycleId !== cycleId ||
              current.revision !== previous.revision ||
              current.archivedAt
            )
              throw new Error('资料已变化或已归档，请重新打开后编辑')
            if (
              (current.kind !== value.kind ||
                current.partId !== value.partId ||
                current.edition !== value.edition) &&
              (await d.materialProgress.where('materialId').equals(current.id).count())
            )
              throw new Error('已有进度的资料请保留类型、试卷和版本；新版本请新增资料')
            await d.materials.update(current.id, { ...value, ...revision(current) })
            return current.id
          }
          const existing = await d.materials.get(operationId)
          if (existing) {
            if (
              existing.cycleId !== cycleId ||
              Object.entries(value).some(
                ([key, v]) => existing[key as keyof LearningMaterial] !== v,
              )
            )
              throw new Error('操作标识已被其他资料使用')
            return existing.id
          }
          const list = await d.materials.where('cycleId').equals(cycleId).toArray()
          const item: LearningMaterial = {
            ...stamp(),
            id: operationId,
            cycleId,
            ...value,
            order: list.reduce((max, item) => Math.max(max, item.order), -1) + 1,
            archivedAt: null,
          }
          await d.materials.add(item)
          return item.id
        },
      )
    })
  }
  saveChapter(
    cycleId: string,
    input: ChapterInput,
    previous?: Chapter,
    operationId: string = crypto.randomUUID(),
  ) {
    return exclusive(async () => {
      const value = validate(chapterInput, input),
        d = this.database
      return d.transaction(
        'rw',
        [d.cycles, d.subjectParts, d.chapters, d.materialProgress, d.tasks],
        async () => {
          const cycle = await this.cycle(cycleId)
          await this.part(cycle, value.partId)
          if (previous) {
            const current = await d.chapters.get(previous.id)
            if (
              !current ||
              current.cycleId !== cycleId ||
              current.revision !== previous.revision ||
              current.archivedAt
            )
              throw new Error('章节已变化或已归档，请重新打开后编辑')
            if (
              value.partId !== current.partId &&
              ((await d.materialProgress.where('chapterId').equals(current.id).count()) ||
                (await d.tasks.filter((task) => task.chapterId === current.id).count()))
            )
              throw new Error('章节已有任务或进度，请保留原试卷关联')
            await d.chapters.update(current.id, { ...value, ...revision(current) })
            return current.id
          }
          const existing = await d.chapters.get(operationId)
          if (existing) {
            if (
              existing.cycleId !== cycleId ||
              Object.entries(value).some(([key, v]) => existing[key as keyof Chapter] !== v)
            )
              throw new Error('操作标识已被其他章节使用')
            return existing.id
          }
          const list = await d.chapters.where('cycleId').equals(cycleId).toArray()
          const item: Chapter = {
            ...stamp(),
            id: operationId,
            cycleId,
            ...value,
            order: list.reduce((max, item) => Math.max(max, item.order), -1) + 1,
            archivedAt: null,
          }
          await d.chapters.add(item)
          return item.id
        },
      )
    })
  }
  setProgress(
    materialId: string,
    chapterId: string,
    progressPercent: number,
    previous?: MaterialProgress,
    operationId: string = crypto.randomUUID(),
  ) {
    return exclusive(async () => {
      validate(z.number().int().min(0, '进度须为0—100').max(100, '进度须为0—100'), progressPercent)
      const d = this.database
      return d.transaction(
        'rw',
        [d.cycles, d.materials, d.chapters, d.materialProgress],
        async () => {
          const material = await d.materials.get(materialId),
            chapter = await d.chapters.get(chapterId)
          if (!material || !chapter || material.cycleId !== chapter.cycleId)
            throw new Error('资料与章节必须属于同一年度科目')
          await this.cycle(chapter.cycleId)
          if (material.archivedAt || chapter.archivedAt)
            throw new Error('资料或章节已归档，请先恢复')
          if (material.partId && chapter.partId && material.partId !== chapter.partId)
            throw new Error('资料与章节的试卷子项不一致')
          const current = await d.materialProgress
            .where('[materialId+chapterId]')
            .equals([materialId, chapterId])
            .first()
          if (
            !previous &&
            current?.id === operationId &&
            current.progressPercent === progressPercent
          )
            return current.id
          if (
            (previous &&
              (!current || current.id !== previous.id || current.revision !== previous.revision)) ||
            (!previous && current)
          )
            throw new Error('进度已变化，请重新打开后编辑')
          if (current)
            await d.materialProgress.update(current.id, { progressPercent, ...revision(current) })
          else
            await d.materialProgress.add({
              ...stamp(),
              id: operationId,
              materialId,
              chapterId,
              progressPercent,
            })
          return current?.id ?? operationId
        },
      )
    })
  }
  archiveItem(
    kind: 'materials' | 'chapters',
    previous: LearningMaterial | Chapter,
    archived: boolean,
  ) {
    return exclusive(async () => {
      const d = this.database
      await d.transaction('rw', [d.cycles, d.table(kind)], async () => {
        const current = (await d.table(kind).get(previous.id)) as
          LearningMaterial | Chapter | undefined
        if (!current || current.revision !== previous.revision)
          throw new Error('记录已变化，请重试')
        await this.cycle(current.cycleId)
        await d.table(kind).update(current.id, {
          archivedAt: archived ? new Date().toISOString() : null,
          ...revision(current),
        })
      })
    })
  }
}
export const curriculum = new CurriculumService()
