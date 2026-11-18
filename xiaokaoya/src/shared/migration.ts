import type { CycleExamStatus } from '../domain/models'
import type { BackupData, DatasetMeta, MigrationRecord } from './backup'
import { v6Extension } from '../data/experience-defaults'
import type { Quote } from '../domain/models'

export function defaultCycleStatus(id: string, timestamp: string): CycleExamStatus {
  return {
    id,
    registrationStatus: 'not_planned',
    examResult: 'unrecorded',
    examDate: null,
    notes: '',
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
// Pure transformation shared by the native upgrade and old-file preflight.
export function upgradePayload(
  source: Record<string, Record<string, unknown>[]>,
  fromVersion: number,
  dataset: DatasetMeta,
  record: MigrationRecord,
): BackupData {
  const data = structuredClone(source) as BackupData
  if (fromVersion < 2) {
    data.datasetMeta = [dataset as unknown as Record<string, unknown>]
    data.migrationHistory = []
  }
  if (fromVersion < 3) {
    data.cycleStatuses = data.cycles.map(
      (cycle) =>
        defaultCycleStatus(String(cycle.id), record.appliedAt) as unknown as Record<
          string,
          unknown
        >,
    )
    data.materials = []
    data.chapters = []
    data.materialProgress = []
  }
  if (fromVersion < 4) {
    data.weeklyPlans = []
    data.weeklySubjectTargets = []
    data.taskScheduleHistory = []
    data.examMilestones = []
  }
  if (fromVersion < 5) {
    data.focusTimers = []
  }
  if (fromVersion < 6) {
    const extension = v6Extension(data.quotes as unknown as Quote[])
    data.quotes.push(...(extension.added as unknown as Record<string, unknown>[]))
    data.quoteDetails = extension.details as unknown as Record<string, unknown>[]
    data.quoteFavorites = []
    data.experienceSettings = [extension.settings as unknown as Record<string, unknown>]
  }
  if (fromVersion < 7) {
    data.practiceSets = []
    data.mistakeItems = []
    data.mistakeReviews = []
    data.mockExams = []
    data.mockExamQuestions = []
    data.reportSnapshots = []
    data.migrationHistory.push(record as unknown as Record<string, unknown>)
  }
  return data
}
