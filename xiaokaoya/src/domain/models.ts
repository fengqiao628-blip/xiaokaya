export type ExamSystem = 'cpa' | 'tax'
export type LearningStatus = 'planned' | 'studying' | 'paused'
export type RegistrationStatus = 'not_planned' | 'planned' | 'registered' | 'attended'
export type ExamResult = 'unrecorded' | 'passed' | 'failed'
export type ChapterStatus = 'not_started' | 'learning' | 'completed'
export type TaskStatus =
  'pending' | 'in_progress' | 'completed' | 'partial' | 'deferred' | 'cancelled'
export interface Entity {
  id: string
  createdAt: string
  updatedAt: string
  revision: number
}
export interface Subject {
  id: string
  name: string
  system: ExamSystem
  stage: 'professional' | 'comprehensive' | 'tax'
  order: number
}
export interface SubjectPart {
  id: string
  subjectId: string
  name: string
}
export interface AnnualPlan extends Entity {
  year: number
  goal: string
}
export interface StudyCycle extends Entity {
  subjectId: string
  annualPlanId: string
  learningStatus: LearningStatus
  archivedAt: string | null
}
export interface CycleExamStatus extends Entity {
  registrationStatus: RegistrationStatus
  examResult: ExamResult
  examDate: string | null
  notes: string
}
export interface LearningMaterial extends Entity {
  cycleId: string
  partId: string | null
  title: string
  kind: 'textbook' | 'video'
  edition: string
  order: number
  archivedAt: string | null
}
export interface Chapter extends Entity {
  cycleId: string
  partId: string | null
  title: string
  order: number
  completionStatus: ChapterStatus
  masteryStars: number | null
  notes: string
  archivedAt: string | null
}
export interface MaterialProgress extends Entity {
  materialId: string
  chapterId: string
  progressPercent: number
}
export const LEARNING_LABELS: Record<LearningStatus, string> = {
  planned: '计划学习',
  studying: '正在学习',
  paused: '暂停',
}
export const REGISTRATION_LABELS: Record<RegistrationStatus, string> = {
  not_planned: '未计划报考',
  planned: '计划报考',
  registered: '已报名',
  attended: '已参加考试',
}
export const RESULT_LABELS: Record<ExamResult, string> = {
  unrecorded: '未记录',
  passed: '已通过',
  failed: '未通过',
}
export const CHAPTER_LABELS: Record<ChapterStatus, string> = {
  not_started: '未开始',
  learning: '学习中',
  completed: '已完成',
}
export interface Task extends Entity {
  cycleId: string
  chapterId: string | null
  title: string
  plannedDate: string | null
  kind?: 'study' | 'review'
  estimatedSeconds: number
  status: TaskStatus
  notes: string
}
export interface WeeklyPlan extends Entity {
  weekStart: string
  goalSeconds: number
  focus: string
}
export interface WeeklySubjectTarget extends Entity {
  weekStart: string
  cycleId: string
  targetSeconds: number
  active: boolean
}
export type ScheduleAction = 'created' | 'rescheduled' | 'unscheduled' | 'deferred'
export interface TaskScheduleEvent {
  id: string
  taskId: string
  taskRevision: number
  fromDate: string | null
  toDate: string | null
  action: ScheduleAction
  changedAt: string
  note: string
}
export type MilestoneKind =
  'registration_open' | 'registration_close' | 'payment_due' | 'admission_ticket' | 'results_day'
export interface ExamMilestone extends Entity {
  cycleId: string
  kind: MilestoneKind
  date: string
  notes: string
  archivedAt: string | null
}
export const MILESTONE_LABELS: Record<MilestoneKind | 'exam', string> = {
  registration_open: '报名开始',
  registration_close: '报名截止',
  payment_due: '缴费截止',
  admission_ticket: '准考证打印',
  exam: '考试日期',
  results_day: '成绩公布',
}
export const SCHEDULE_LABELS: Record<ScheduleAction, string> = {
  created: '创建任务',
  rescheduled: '安排/调整日期',
  unscheduled: '移入待安排池',
  deferred: '延期',
}
// Confirmed records alone contribute actual time. Optional V5 metadata preserves legacy rows.
export interface StudySession extends Entity {
  cycleId: string
  taskId: string | null
  studyDate: string
  status: 'draft' | 'confirmed' | 'voided'
  timeMode: 'duration_only' | 'segments'
  durationOnlySeconds: number | null
  source?: 'manual' | 'timer'
  entryId?: string
  timerId?: string | null
  chapterId?: string | null
  notes?: string
  overlapAcknowledged?: boolean
  voidReason?: string
}
export interface TimeSegment extends Entity {
  sessionId: string
  startedAt: string
  endedAt: string | null
}
export interface FocusInterval {
  startedAt: string
  endedAt: string
}
export type FocusStatus = 'running' | 'paused' | 'review' | 'saved' | 'discarded'
export type FocusReason =
  | 'started'
  | 'paused'
  | 'resumed'
  | 'stopped'
  | 'due'
  | 'lock'
  | 'sleep'
  | 'exit'
  | 'interrupted'
  | 'clock'
  | 'restore'
  | 'backup'
  | 'write-failed'
export interface FocusTimer extends Entity {
  cycleId: string
  taskId: string | null
  chapterId: string | null
  targetSeconds: number
  status: FocusStatus
  reason: FocusReason
  checkpointAt: string
  intervals: FocusInterval[]
  sessionIds: string[]
}
export interface Preferences extends Entity {
  companionId: string
  defaultWeeklyGoalSeconds: number
}
export interface Quote {
  id: string
  text: string
  category: string
}
export interface DailyQuote {
  attribution?: import('./experience').Attribution
  date: string
  quoteId: string
  text: string
  rotation: number
  updatedAt: string
}
export interface QuoteHistory {
  attribution?: import('./experience').Attribution
  id: string
  date: string
  quoteId: string
  text: string
  shownAt: string
  reason: 'daily' | 'manual'
}
export const TASK_LABELS: Record<TaskStatus, string> = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  partial: '部分完成',
  deferred: '已延期',
  cancelled: '已取消',
}
