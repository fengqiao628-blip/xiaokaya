import type { z } from 'zod'
import type { Entity } from '../domain/models'
import type { Table } from 'dexie'
import { db, type StudyDatabase } from '../data/database'
import { exclusive } from '../data/operation-gate'
import { readPayload } from '../data/backup/payload'
import { fingerprint } from '../shared/backup'
import {
  practiceInput,
  mistakeInput,
  reviewInput,
  examInput,
  examQuestionInput,
  practiceRows,
} from '../shared/practice-integrity'
import type {
  PracticeSet,
  MistakeItem,
  MistakeReview,
  MockExam,
  MockExamQuestion,
  ReportSnapshot,
  FrozenAnnualMetrics,
} from '../domain/practice'
import { practiceAccuracy } from '../domain/practice'
import { actualSecondsBySession } from '../domain/statistics'
import { learningContext, stamp } from './learning'
import type { StudySession, TimeSegment, FocusTimer } from '../domain/models'

export type PracticeInput = z.infer<typeof practiceInput>
export type MistakeInput = z.infer<typeof mistakeInput>
export type ReviewInput = z.infer<typeof reviewInput>
export type ExamInput = z.infer<typeof examInput>
export type ExamQuestionInput = z.infer<typeof examQuestionInput>
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(result.error.issues[0].message)
  return result.data
}
export function mockActualSeconds(
  exam: MockExam,
  timers: FocusTimer[],
  sessions: StudySession[],
  segments: TimeSegment[],
) {
  const ids = new Set(
    exam.timerId
      ? (timers.find((t) => t.id === exam.timerId)?.sessionIds ?? [])
      : exam.studySessionId
        ? [exam.studySessionId]
        : [],
  )
  return Math.floor(
    [
      ...actualSecondsBySession(
        sessions.filter((s) => ids.has(s.id)),
        segments,
      ).values(),
    ].reduce((a, b) => a + b, 0),
  )
}
export class PracticeService {
  constructor(readonly database: StudyDatabase = db) {}
  private async save<T extends Entity>(
    table: Table<T, string>,
    value: Omit<T, keyof Entity>,
    previous: T | undefined,
    operationId: string,
  ) {
    const id = previous?.id ?? operationId,
      current = await table.get(id)
    if (previous && (!current || current.revision !== previous.revision))
      throw new Error('记录已变化，请重新打开后编辑')
    if (!previous && current) {
      if (
        Object.entries(value).some(
          ([key, v]) => JSON.stringify(current[key as keyof T]) !== JSON.stringify(v),
        )
      )
        throw new Error('操作标识已使用，请重新打开')
      return current.id
    }
    const now = new Date().toISOString()
    await table.put({
      ...(current ?? stamp(id, now)),
      ...value,
      updatedAt: now,
      revision: current ? current.revision + 1 : 1,
    } as T)
    return id
  }
  savePractice(input: PracticeInput, previous?: PracticeSet, operationId = crypto.randomUUID()) {
    return exclusive(() =>
      this.database.transaction('rw', this.database.tables, async () => {
        const value = parse(practiceInput, input),
          d = this.database
        await learningContext(d, value.cycleId, null, value.chapterId)
        if (previous && previous.cycleId !== value.cycleId)
          throw new Error('已有记录不能变更年度科目')
        if (value.studySessionId) await this.session(value.cycleId, value.studySessionId)
        return this.save<PracticeSet>(d.practiceSets, value, previous, operationId)
      }),
    )
  }
  saveMistake(input: MistakeInput, previous?: MistakeItem, operationId = crypto.randomUUID()) {
    return exclusive(() =>
      this.database.transaction('rw', this.database.tables, async () => {
        const value = parse(mistakeInput, input),
          d = this.database
        await learningContext(d, value.cycleId, null, value.chapterId)
        if (previous && previous.cycleId !== value.cycleId)
          throw new Error('已有错题不能变更年度科目')
        if (
          value.practiceSetId &&
          (await d.practiceSets.get(value.practiceSetId))?.cycleId !== value.cycleId
        )
          throw new Error('练习与错题科目不一致')
        return this.save<MistakeItem>(d.mistakeItems, value, previous, operationId)
      }),
    )
  }
  review(previous: MistakeItem, input: ReviewInput, operationId = crypto.randomUUID()) {
    return exclusive(() =>
      this.database.transaction(
        'rw',
        [this.database.mistakeItems, this.database.mistakeReviews],
        async () => {
          const value = parse(reviewInput, input),
            d = this.database
          const current = await d.mistakeItems.get(previous.id)
          if (!current || current.revision !== previous.revision)
            throw new Error('题目已变化，请重新打开后复习')
          const question = {
            stem: current.stem,
            options: current.options,
            answer: current.answer,
            explanation: current.explanation,
          }
          // Append-only; no review-edit method. Retry with the same operation id is idempotent.
          return this.save<MistakeReview>(
            d.mistakeReviews,
            { ...value, mistakeId: current.id, question },
            undefined,
            operationId,
          )
        },
      ),
    )
  }
  saveExam(input: ExamInput, previous?: MockExam, operationId = crypto.randomUUID()) {
    return exclusive(() =>
      this.database.transaction('rw', this.database.tables, async () => {
        const value = parse(examInput, input),
          d = this.database
        await learningContext(d, value.cycleId, null, null)
        if (previous && previous.cycleId !== value.cycleId)
          throw new Error('已有模拟考试不能变更年度科目')
        const current = previous ? await d.mockExams.get(previous.id) : undefined
        if (current?.timerId && value.targetSeconds !== current.targetSeconds)
          throw new Error('已开始的考试请保留原时限')
        return this.save<MockExam>(
          d.mockExams,
          {
            ...value,
            timerId: current?.timerId ?? null,
            studySessionId: current?.studySessionId ?? null,
          },
          previous,
          operationId,
        )
      }),
    )
  }
  private async session(cycleId: string, id: string) {
    const row = await this.database.studySessions.get(id)
    if (!row || row.cycleId !== cycleId || row.status !== 'confirmed')
      throw new Error('请选择本科目已确认的学习记录')
  }
  linkExamSession(previous: MockExam, sessionId: string | null) {
    return exclusive(() =>
      this.database.transaction(
        'rw',
        [this.database.mockExams, this.database.studySessions],
        async () => {
          const current = await this.database.mockExams.get(previous.id)
          if (!current || current.revision !== previous.revision)
            throw new Error('考试已变化，请重试')
          if (current.timerId)
            throw new Error('考试已有计时来源，请在学习记录中确认或作废；不能再关联补录')
          if (sessionId) await this.session(current.cycleId, sessionId)
          return this.save<MockExam>(
            this.database.mockExams,
            { ...current, studySessionId: sessionId },
            current,
            current.id,
          )
        },
      ),
    )
  }
  saveQuestion(
    input: ExamQuestionInput,
    previous?: MockExamQuestion,
    operationId = crypto.randomUUID(),
  ) {
    return exclusive(() =>
      this.database.transaction('rw', this.database.tables, async () => {
        const value = parse(examQuestionInput, input),
          d = this.database,
          exam = await d.mockExams.get(value.mockExamId)
        if (!exam || exam.status === 'voided') throw new Error('考试不存在或已作废')
        await learningContext(d, exam.cycleId, null, value.chapterId)
        if (previous && previous.mockExamId !== value.mockExamId)
          throw new Error('题目不能移动到其他考试')
        return this.save<MockExamQuestion>(d.mockExamQuestions, value, previous, operationId)
      }),
    )
  }
  generateReport(year: number, notes = '', operationId = crypto.randomUUID()) {
    return exclusive(async () => {
      if (!Number.isInteger(year) || year < 1900 || year > 9999 || notes.length > 2000)
        throw new Error('报告年份或说明无效')
      const d = this.database,
        prior = await d.reportSnapshots.get(operationId)
      if (prior) {
        if (prior.year !== year || prior.notes !== notes) throw new Error('报告操作标识已使用')
        return prior.id
      }
      const source = await readPayload(d)
      const plans = new Set(source.annualPlans.filter((p) => p.year === year).map((p) => p.id))
      const cycles = source.cycles.filter((c) => plans.has(c.annualPlanId)),
        ids = new Set(cycles.map((c) => c.id))
      if (!cycles.length) throw new Error('该备考年度没有科目档案')
      const sessions = (source.studySessions as unknown as StudySession[]).filter((s) =>
          ids.has(s.cycleId),
        ),
        segments = source.timeSegments as unknown as TimeSegment[]
      const actual = actualSecondsBySession(sessions, segments)
      const sum = (selected: StudySession[]) =>
        Math.floor(selected.reduce((n, s) => n + (actual.get(s.id) ?? 0), 0))
      const practices = (source.practiceSets as unknown as PracticeSet[]).filter(
        (p) => ids.has(p.cycleId) && p.status === 'confirmed',
      )
      const mistakes = (source.mistakeItems as unknown as MistakeItem[]).filter((m) =>
        ids.has(m.cycleId),
      )
      const tasks = source.tasks.filter((t) => ids.has(t.cycleId) && t.status !== 'cancelled')
      const metrics: FrozenAnnualMetrics = {
        actualSeconds: sum(sessions),
        companionSeconds: sum(sessions.filter((s) => s.source === 'timer')),
        confirmedSessions: sessions.filter((s) => s.status === 'confirmed').length,
        taskCount: tasks.length,
        completedTasks: tasks.filter((t) => t.status === 'completed').length,
        practiceCount: practices.length,
        ...practiceAccuracy(practices),
        mistakeCount: mistakes.length,
        masteredMistakes: mistakes.filter((m) => m.mastery === 'mastered').length,
        chapters: source.chapters
          .filter((c) => ids.has(c.cycleId))
          .map((c) => ({
            id: String(c.id),
            title: String(c.title),
            status: String(c.completionStatus),
            masteryStars: c.masteryStars as number | null,
          })),
        exams: (source.mockExams as unknown as MockExam[])
          .filter((e) => ids.has(e.cycleId) && e.status !== 'voided')
          .map((e) => ({
            id: e.id,
            title: e.title,
            date: e.date,
            score: e.score,
            maximumScore: e.maximumScore,
            actualSeconds: mockActualSeconds(
              e,
              source.focusTimers as unknown as FocusTimer[],
              sessions,
              segments,
            ),
          })),
        cycles: cycles.map((c) => ({
          id: String(c.id),
          subject: String(source.subjects.find((s) => s.id === c.subjectId)?.name ?? ''),
          archived: c.archivedAt !== null,
        })),
      }
      const sources = Object.fromEntries(
        Object.entries(source).filter(([name]) => name !== 'reportSnapshots'),
      )
      const record: ReportSnapshot = {
        ...stamp(operationId, new Date().toISOString()),
        year,
        version:
          (await d.reportSnapshots.where('year').equals(year).toArray()).reduce(
            (v, r) => Math.max(v, r.version),
            0,
          ) + 1,
        sourceFingerprint: await fingerprint(sources, true),
        sourceCounts: Object.fromEntries(
          Object.entries(sources).map(([name, rows]) => [name, rows.length]),
        ),
        notes,
        metrics,
      }
      parse(practiceRows.reportSnapshots, record)
      await d.reportSnapshots.add(record)
      return record.id
    })
  }
}
export const practice = new PracticeService()
