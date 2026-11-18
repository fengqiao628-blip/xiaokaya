import { z } from 'zod'
import { validDate } from '../domain/dates'

const id = z.string().min(1).max(200)
const timestamp = z.iso.datetime({ offset: true })
const date = z.string().refine(validDate, '日期无效')
const count = z.number().int().min(0).max(1000000)
const score = z.number().finite().min(0).max(1000000)
const entity = { id, createdAt: timestamp, updatedAt: timestamp, revision: z.number().int().min(1) }
const notes = z.string().max(2000)
const context = { cycleId: id, chapterId: id.nullable() }
export const questionSchema = z
  .object({
    stem: z.string().trim().min(1).max(20000),
    options: z.string().max(20000),
    answer: z.string().max(20000),
    explanation: z.string().max(20000),
  })
  .strict()
export const practiceInput = z
  .object({
    ...context,
    studySessionId: id.nullable(),
    date,
    source: z.string().trim().min(1).max(300),
    total: count,
    correct: count,
    wrong: count,
    unanswered: count,
    notes,
    status: z.enum(['confirmed', 'voided']),
  })
  .strict()
  .refine(
    (row) => row.total === row.correct + row.wrong + row.unanswered,
    '总题数须等于答对、答错与未答之和',
  )
export const mistakeInput = questionSchema
  .extend({
    ...context,
    practiceSetId: id.nullable(),
    date,
    reason: notes,
    tags: z
      .array(z.string().trim().min(1).max(40))
      .max(20)
      .refine((items) => new Set(items).size === items.length, '标签不能重复'),
    mastery: z.enum(['unreviewed', 'learning', 'mastered']),
    archivedAt: timestamp.nullable(),
  })
  .strict()
export const reviewInput = z
  .object({ date, result: z.enum(['correct', 'wrong', 'uncertain']), notes })
  .strict()
export const examInput = z
  .object({
    cycleId: id,
    title: z.string().trim().min(1).max(160),
    date,
    targetSeconds: z.number().int().min(1).max(28800),
    maximumScore: score.positive(),
    score: score.nullable(),
    status: z.enum(['prepared', 'completed', 'voided']),
    notes,
  })
  .strict()
  .refine((row) => row.score === null || row.score <= row.maximumScore, '成绩不能超过满分')
export const examQuestionInput = questionSchema
  .extend({
    mockExamId: id,
    chapterId: id.nullable(),
    response: z.string().max(20000),
    points: score.positive(),
    score: score.nullable(),
  })
  .strict()
  .refine((row) => row.score === null || row.score <= row.points, '题目得分不能超过分值')
export const practiceRows = {
  practiceSets: practiceInput.safeExtend(entity).strict(),
  mistakeItems: mistakeInput.extend(entity).strict(),
  mistakeReviews: reviewInput
    .extend({ ...entity, mistakeId: id, question: questionSchema })
    .strict(),
  mockExams: examInput
    .safeExtend({ ...entity, timerId: id.nullable(), studySessionId: id.nullable() })
    .strict()
    .refine((row) => !(row.timerId && row.studySessionId), '模拟考试只能引用一种时间来源'),
  mockExamQuestions: examQuestionInput.safeExtend(entity).strict(),
  reportSnapshots: z
    .object({
      ...entity,
      year: z.number().int().min(1900).max(9999),
      version: z.number().int().min(1),
      sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      sourceCounts: z.record(z.string(), count),
      notes,
      metrics: z
        .object({
          actualSeconds: z.number().int().nonnegative(),
          companionSeconds: z.number().int().nonnegative(),
          confirmedSessions: count,
          taskCount: count,
          completedTasks: count,
          practiceCount: count,
          correct: count,
          answered: count,
          accuracy: z.number().finite().min(0).max(1).nullable(),
          mistakeCount: count,
          masteredMistakes: count,
          chapters: z.array(
            z
              .object({
                id,
                title: z.string().max(160),
                status: z.enum(['not_started', 'learning', 'completed']),
                masteryStars: z.number().int().min(1).max(5).nullable(),
              })
              .strict(),
          ),
          exams: z.array(
            z
              .object({
                id,
                title: z.string().max(160),
                date,
                score: score.nullable(),
                maximumScore: score.positive(),
                actualSeconds: z.number().int().nonnegative(),
              })
              .strict(),
          ),
          cycles: z.array(
            z.object({ id, subject: z.string().max(200), archived: z.boolean() }).strict(),
          ),
        })
        .strict()
        .refine(
          (m) =>
            m.companionSeconds <= m.actualSeconds &&
            m.completedTasks <= m.taskCount &&
            m.masteredMistakes <= m.mistakeCount &&
            m.correct <= m.answered &&
            m.accuracy === (m.answered ? m.correct / m.answered : null),
          '报告汇总不一致',
        ),
    })
    .strict(),
}

// Historical references remain valid after archiving or voiding a learning record.
export function validatePracticeV7(data: Record<string, Record<string, unknown>[]>) {
  const maps = Object.fromEntries(
    Object.entries(data).map(([name, rows]) => [
      name,
      new Map(rows.map((row) => [String(row.id), row])),
    ]),
  )
  const ref = (name: string, key: unknown) => {
    const row = maps[name]?.get(String(key))
    if (!row) throw new Error(`练习或报告引用的 ${name} 记录不存在`)
    return row
  }
  for (const name of Object.keys(practiceRows))
    for (const row of data[name]) {
      if ('cycleId' in row) ref('cycles', row.cycleId)
      if (
        row.chapterId &&
        ref('chapters', row.chapterId).cycleId !==
          (row.cycleId ?? ref('mockExams', row.mockExamId).cycleId)
      )
        throw new Error('题目章节与年度科目不一致')
      if (row.studySessionId && ref('studySessions', row.studySessionId).cycleId !== row.cycleId)
        throw new Error('引用的学习记录与年度科目不一致')
      if (row.practiceSetId && ref('practiceSets', row.practiceSetId).cycleId !== row.cycleId)
        throw new Error('错题与练习年度科目不一致')
      if (name === 'mistakeReviews') ref('mistakeItems', row.mistakeId)
      if (name === 'mockExamQuestions') ref('mockExams', row.mockExamId)
      if (name === 'mockExams' && row.timerId) {
        const timer = ref('focusTimers', row.timerId)
        if (timer.cycleId !== row.cycleId || timer.targetSeconds !== row.targetSeconds)
          throw new Error('模拟计时与年度科目或时限不一致')
      }
    }
  const examTimers = data.mockExams.filter((row) => row.timerId).map((row) => row.timerId)
  if (new Set(examTimers).size !== examTimers.length)
    throw new Error('一次计时不能属于两场模拟考试')
  const versions = data.reportSnapshots.map((row) => `${row.year}/${row.version}`)
  if (new Set(versions).size !== versions.length) throw new Error('冻结报告年度版本重复')
}
