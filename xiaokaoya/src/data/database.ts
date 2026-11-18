import Dexie, { type Table, type Transaction } from 'dexie'
import { DATABASE_NAME, DATABASE_VERSION } from '../shared/identity'
import type {
  AnnualPlan,
  StudyCycle,
  Task,
  Preferences,
  Subject,
  SubjectPart,
  Quote,
  DailyQuote,
  QuoteHistory,
  StudySession,
  TimeSegment,
  CycleExamStatus,
  LearningMaterial,
  Chapter,
  MaterialProgress,
  WeeklyPlan,
  WeeklySubjectTarget,
  TaskScheduleEvent,
  ExamMilestone,
  FocusTimer,
} from '../domain/models'
import { subjects, subjectParts, quotes } from './catalog'
import {
  V1_SCHEMA,
  V2_SCHEMA,
  V3_SCHEMA,
  V4_SCHEMA,
  V5_SCHEMA,
  V6_SCHEMA,
  V7_SCHEMA,
} from './schema'
import type {
  PracticeSet,
  MistakeItem,
  MistakeReview,
  MockExam,
  MockExamQuestion,
  ReportSnapshot,
} from '../domain/practice'
import type { QuoteDetail, QuoteFavorite, ExperienceSettings } from '../domain/experience'
import { v6Extension } from './experience-defaults'
import type { DatasetMeta, MigrationRecord } from '../shared/backup'
import { defaultCycleStatus } from '../shared/migration'

export interface MigrationPermit {
  dataset: DatasetMeta
  record: MigrationRecord
}
async function writeV2Migration(transaction: Transaction, permit: MigrationPermit) {
  await transaction.table('datasetMeta').add(permit.dataset)
  await transaction.table('migrationHistory').add(permit.record)
}
async function writeV3Migration(transaction: Transaction, permit: MigrationPermit) {
  const cycles = await transaction.table('cycles').toArray()
  if (cycles.length)
    await transaction
      .table('cycleStatuses')
      .bulkAdd(cycles.map((cycle) => defaultCycleStatus(cycle.id, permit.record.appliedAt)))
  if (permit.record.fromVersion >= 2) await transaction.table('migrationHistory').add(permit.record)
}
async function writeV4Migration(transaction: Transaction, permit: MigrationPermit) {
  if (permit.record.fromVersion >= 3) await transaction.table('migrationHistory').add(permit.record)
}
async function writeV5Migration(transaction: Transaction, permit: MigrationPermit) {
  if (permit.record.fromVersion >= 4) await transaction.table('migrationHistory').add(permit.record)
}
async function writeV6Migration(transaction: Transaction, permit: MigrationPermit) {
  const extension = v6Extension(await transaction.table('quotes').toArray())
  if (extension.added.length) await transaction.table('quotes').bulkAdd(extension.added)
  await transaction.table('quoteDetails').bulkAdd(extension.details)
  await transaction.table('experienceSettings').add(extension.settings)
  if (permit.record.fromVersion >= 5) await transaction.table('migrationHistory').add(permit.record)
}
async function writeV7Migration(transaction: Transaction, permit: MigrationPermit) {
  if (permit.record.fromVersion >= 6) await transaction.table('migrationHistory').add(permit.record)
}

export class StudyDatabase extends Dexie {
  subjects!: Table<Subject, string>
  subjectParts!: Table<SubjectPart, string>
  annualPlans!: Table<AnnualPlan, string>
  cycles!: Table<StudyCycle, string>
  tasks!: Table<Task, string>
  preferences!: Table<Preferences, string>
  quotes!: Table<Quote, string>
  dailyQuotes!: Table<DailyQuote, string>
  quoteHistory!: Table<QuoteHistory, string>
  studySessions!: Table<StudySession, string>
  timeSegments!: Table<TimeSegment, string>
  datasetMeta!: Table<DatasetMeta, string>
  migrationHistory!: Table<MigrationRecord, string>
  cycleStatuses!: Table<CycleExamStatus, string>
  materials!: Table<LearningMaterial, string>
  chapters!: Table<Chapter, string>
  materialProgress!: Table<MaterialProgress, string>
  weeklyPlans!: Table<WeeklyPlan, string>
  weeklySubjectTargets!: Table<WeeklySubjectTarget, string>
  taskScheduleHistory!: Table<TaskScheduleEvent, string>
  examMilestones!: Table<ExamMilestone, string>
  focusTimers!: Table<FocusTimer, string>
  quoteDetails!: Table<QuoteDetail, string>
  quoteFavorites!: Table<QuoteFavorite, string>
  experienceSettings!: Table<ExperienceSettings, string>
  practiceSets!: Table<PracticeSet, string>
  mistakeItems!: Table<MistakeItem, string>
  mistakeReviews!: Table<MistakeReview, string>
  mockExams!: Table<MockExam, string>
  mockExamQuestions!: Table<MockExamQuestion, string>
  reportSnapshots!: Table<ReportSnapshot, string>
  private migrationPermit?: MigrationPermit
  authorizeMigration(permit: MigrationPermit) {
    this.migrationPermit = permit
  }
  constructor(
    name = DATABASE_NAME,
    migrationWriter = writeV2Migration,
    v3Writer = writeV3Migration,
    v4Writer = writeV4Migration,
    v5Writer = writeV5Migration,
    v6Writer = writeV6Migration,
    v7Writer = writeV7Migration,
  ) {
    super(name)
    this.version(1).stores(V1_SCHEMA)
    this.version(2)
      .stores(V2_SCHEMA)
      .upgrade(async (transaction) => {
        const permit = this.migrationPermit
        if (!permit) throw new Error('升级前安全快照尚未验证，数据库升级已停止，原数据保持不变')
        await migrationWriter(transaction, permit)
      })
    this.version(3)
      .stores(V3_SCHEMA)
      .upgrade(async (transaction) => {
        const permit = this.migrationPermit
        if (!permit) throw new Error('升级前安全快照尚未验证，数据库升级已停止，原数据保持不变')
        await v3Writer(transaction, permit)
      })
    this.version(4)
      .stores(V4_SCHEMA)
      .upgrade(async (transaction) => {
        const permit = this.migrationPermit
        if (!permit) throw new Error('升级前安全快照尚未验证，数据库升级已停止，原数据保持不变')
        await v4Writer(transaction, permit)
      })
    this.version(5)
      .stores(V5_SCHEMA)
      .upgrade(async (transaction) => {
        const permit = this.migrationPermit
        if (!permit) throw new Error('升级前安全快照尚未验证，数据库升级已停止，原数据保持不变')
        await v5Writer(transaction, permit)
      })
    this.version(6)
      .stores(V6_SCHEMA)
      .upgrade(async (transaction) => {
        const permit = this.migrationPermit
        if (!permit) throw new Error('升级前安全快照尚未验证，数据库升级已停止，原数据保持不变')
        await v6Writer(transaction, permit)
      })
    this.version(7)
      .stores(V7_SCHEMA)
      .upgrade(async (transaction) => {
        const permit = this.migrationPermit
        if (!permit) throw new Error('升级前安全快照尚未验证，数据库升级已停止，原数据保持不变')
        await v7Writer(transaction, permit)
      })
    this.on('populate', async () => {
      await this.subjects.bulkAdd(subjects)
      await this.subjectParts.bulkAdd(subjectParts)
      await this.quotes.bulkAdd(quotes)
      const extension = v6Extension(quotes)
      await this.quotes.bulkAdd(extension.added)
      await this.quoteDetails.bulkAdd(extension.details)
      await this.experienceSettings.add(extension.settings)
      const now = new Date().toISOString()
      await this.datasetMeta.add({ id: 'dataset', datasetId: crypto.randomUUID(), createdAt: now })
      await this.migrationHistory.add({
        id: crypto.randomUUID(),
        fromVersion: 0,
        toVersion: DATABASE_VERSION,
        appliedAt: now,
        snapshotId: null,
      })
      await this.preferences.add({
        id: 'preferences',
        companionId: 'duck',
        defaultWeeklyGoalSeconds: 43200,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      })
    })
    this.on('versionchange', () => this.close())
  }
}
export const db = new StudyDatabase()
