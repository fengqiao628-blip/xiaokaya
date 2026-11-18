// Released schemas are append-only contracts. Retain V1 for old profiles and backups.
export const V1_SCHEMA = {
  subjects: 'id, system, order',
  subjectParts: 'id, subjectId',
  annualPlans: 'id, &year',
  cycles: 'id, &[annualPlanId+subjectId], subjectId, annualPlanId, learningStatus',
  tasks: 'id, cycleId, plannedDate, status, [plannedDate+status]',
  preferences: 'id',
  quotes: 'id, category',
  dailyQuotes: 'date',
  quoteHistory: 'id, date, shownAt',
  studySessions: 'id, cycleId, taskId, studyDate, status',
  timeSegments: 'id, sessionId, startedAt',
} as const
export const V2_SCHEMA = {
  ...V1_SCHEMA,
  datasetMeta: 'id, &datasetId',
  migrationHistory: 'id, appliedAt',
} as const
export const V3_SCHEMA = {
  ...V2_SCHEMA,
  cycleStatuses: 'id, registrationStatus, examResult',
  materials: 'id, cycleId, partId, [cycleId+order]',
  chapters: 'id, cycleId, partId, [cycleId+order]',
  materialProgress: 'id, materialId, chapterId, &[materialId+chapterId]',
} as const
export const V1_TABLES = Object.keys(V1_SCHEMA) as (keyof typeof V1_SCHEMA)[]
export const V2_TABLES = Object.keys(V2_SCHEMA) as (keyof typeof V2_SCHEMA)[]
export const V4_SCHEMA = {
  ...V3_SCHEMA,
  weeklyPlans: 'id, &weekStart',
  weeklySubjectTargets: 'id, weekStart, cycleId, &[weekStart+cycleId]',
  taskScheduleHistory: 'id, taskId, changedAt, &[taskId+taskRevision]',
  examMilestones: 'id, cycleId, date, &[cycleId+kind]',
} as const
export const V3_TABLES = Object.keys(V3_SCHEMA) as (keyof typeof V3_SCHEMA)[]
export const V4_TABLES = Object.keys(V4_SCHEMA) as (keyof typeof V4_SCHEMA)[]
export const V5_SCHEMA = {
  ...V4_SCHEMA,
  studySessions: V1_SCHEMA.studySessions + ', source, entryId, timerId',
  focusTimers: 'id, status, cycleId, taskId',
} as const
export const V5_TABLES = Object.keys(V5_SCHEMA) as (keyof typeof V5_SCHEMA)[]
export const V6_SCHEMA = {
  ...V5_SCHEMA,
  quoteDetails: 'id, kind, origin, archivedAt',
  quoteFavorites: 'id',
  experienceSettings: 'id',
} as const
export const V6_TABLES = Object.keys(V6_SCHEMA) as (keyof typeof V6_SCHEMA)[]
export const V7_SCHEMA = {
  ...V6_SCHEMA,
  practiceSets: 'id, cycleId, date, status',
  mistakeItems: 'id, cycleId, date, mastery, practiceSetId',
  mistakeReviews: 'id, mistakeId, date',
  mockExams: 'id, cycleId, date, timerId',
  mockExamQuestions: 'id, mockExamId',
  reportSnapshots: 'id, year, &[year+version]',
} as const
export const TABLES = Object.keys(V7_SCHEMA) as (keyof typeof V7_SCHEMA)[]
export type DataTable = keyof typeof V7_SCHEMA
export function tablesForVersion(version: number): readonly DataTable[] {
  if (version === 1) return V1_TABLES
  if (version === 2) return V2_TABLES
  if (version === 3) return V3_TABLES
  if (version === 4) return V4_TABLES
  if (version === 5) return V5_TABLES
  if (version === 6) return V6_TABLES
  if (version === 7) return TABLES
  throw new Error('数据库版本不受支持，未进行升级或重置')
}
