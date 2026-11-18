import type { Entity } from './models'

export interface PracticeSet extends Entity {
  cycleId: string
  chapterId: string | null
  studySessionId: string | null
  date: string
  source: string
  total: number
  correct: number
  wrong: number
  unanswered: number
  notes: string
  status: 'confirmed' | 'voided'
}
export interface QuestionContent {
  stem: string
  options: string
  answer: string
  explanation: string
}
export interface MistakeItem extends Entity, QuestionContent {
  cycleId: string
  chapterId: string | null
  practiceSetId: string | null
  date: string
  reason: string
  tags: string[]
  mastery: 'unreviewed' | 'learning' | 'mastered'
  archivedAt: string | null
}
export interface MistakeReview extends Entity {
  mistakeId: string
  date: string
  result: 'correct' | 'wrong' | 'uncertain'
  notes: string
  question: QuestionContent
}
export interface MockExam extends Entity {
  cycleId: string
  title: string
  date: string
  targetSeconds: number
  maximumScore: number
  score: number | null
  status: 'prepared' | 'completed' | 'voided'
  notes: string
  timerId: string | null
  studySessionId: string | null
}
export interface MockExamQuestion extends Entity, QuestionContent {
  mockExamId: string
  chapterId: string | null
  response: string
  points: number
  score: number | null
}
export interface FrozenAnnualMetrics {
  actualSeconds: number
  companionSeconds: number
  confirmedSessions: number
  taskCount: number
  completedTasks: number
  practiceCount: number
  correct: number
  answered: number
  accuracy: number | null
  mistakeCount: number
  masteredMistakes: number
  chapters: { id: string; title: string; status: string; masteryStars: number | null }[]
  exams: {
    id: string
    title: string
    date: string
    score: number | null
    maximumScore: number
    actualSeconds: number
  }[]
  cycles: { id: string; subject: string; archived: boolean }[]
}
export interface ReportSnapshot extends Entity {
  year: number
  version: number
  sourceFingerprint: string
  sourceCounts: Record<string, number>
  notes: string
  metrics: FrozenAnnualMetrics
}
export const MASTERY_LABELS = { unreviewed: '未评价', learning: '待巩固', mastered: '已掌握' }
export const REVIEW_LABELS = { correct: '答对', wrong: '答错', uncertain: '不确定' }
export function practiceAccuracy(rows: PracticeSet[]) {
  const confirmed = rows.filter((row) => row.status === 'confirmed')
  const correct = confirmed.reduce((sum, row) => sum + row.correct, 0)
  const answered = confirmed.reduce((sum, row) => sum + row.correct + row.wrong, 0)
  return { correct, answered, accuracy: answered ? correct / answered : null }
}
