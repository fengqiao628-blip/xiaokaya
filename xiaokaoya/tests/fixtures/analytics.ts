import type { AnalyticsData } from '../../src/domain/analytics'
import type {
  Chapter,
  LearningMaterial,
  StudySession,
  Task,
  TimeSegment,
} from '../../src/domain/models'
import { subjects, subjectParts } from '../../src/data/catalog'
export const entity = {
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  revision: 1,
}
export const chapter = (id: string, override: Partial<Chapter> = {}): Chapter => ({
  ...entity,
  id,
  cycleId: 'a27',
  title: id,
  partId: null,
  order: 0,
  completionStatus: 'not_started',
  masteryStars: null,
  notes: '',
  archivedAt: null,
  ...override,
})
export const material = (
  id: string,
  override: Partial<LearningMaterial> = {},
): LearningMaterial => ({
  ...entity,
  id,
  cycleId: 'a27',
  title: id,
  partId: null,
  kind: 'textbook',
  edition: '2027版',
  order: 0,
  archivedAt: null,
  ...override,
})
export const task = (id: string, override: Partial<Task> = {}): Task => ({
  ...entity,
  id,
  cycleId: 'a27',
  chapterId: null,
  title: id,
  plannedDate: '2024-02-29',
  kind: 'study',
  estimatedSeconds: 3600,
  status: 'pending',
  notes: '',
  ...override,
})
export const session = (id: string, override: Partial<StudySession> = {}): StudySession => ({
  ...entity,
  id,
  cycleId: 'a27',
  taskId: null,
  studyDate: '2024-02-29',
  status: 'confirmed',
  timeMode: 'duration_only',
  durationOnlySeconds: 1200,
  ...override,
})
export const segment = (
  id: string,
  sessionId: string,
  start: string,
  end: string | null,
): TimeSegment => ({ ...entity, id, sessionId, startedAt: start, endedAt: end })
export function analyticsFixture(): AnalyticsData {
  return {
    subjects,
    subjectParts,
    plans: [
      { ...entity, id: 'p27', year: 2027, goal: '' },
      { ...entity, id: 'p28', year: 2028, goal: '' },
    ],
    cycles: [
      {
        ...entity,
        id: 'a27',
        annualPlanId: 'p27',
        subjectId: 'cpa-1',
        learningStatus: 'studying',
        archivedAt: null,
      },
      {
        ...entity,
        id: 't27',
        annualPlanId: 'p27',
        subjectId: 'tax-1',
        learningStatus: 'paused',
        archivedAt: entity.updatedAt,
      },
      {
        ...entity,
        id: 'a28',
        annualPlanId: 'p28',
        subjectId: 'cpa-1',
        learningStatus: 'planned',
        archivedAt: null,
      },
      {
        ...entity,
        id: 'comp',
        annualPlanId: 'p27',
        subjectId: 'cpa-comprehensive',
        learningStatus: 'planned',
        archivedAt: null,
      },
    ],
    tasks: [],
    sessions: [],
    segments: [],
    chapters: [],
    materials: [],
    materialProgress: [],
    weeklyPlans: [],
    weeklySubjectTargets: [],
  }
}
