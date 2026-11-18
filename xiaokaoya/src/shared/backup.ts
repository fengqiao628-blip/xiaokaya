import { z } from 'zod'
import { validDate, weekStart } from '../domain/dates'
import { TABLES, tablesForVersion, type DataTable } from '../data/schema'
import companions from '../companions/catalog.json'
import { DATABASE_VERSION } from './identity'
import { upgradePayload } from './migration'
import { validateLearningV5 } from './learning-integrity'
import { practiceRows, validatePracticeV7 } from './practice-integrity'

export const MAX_FILE_BYTES = 256 * 1024 * 1024
export const BACKUP_FORMAT_VERSION = 1
export type SnapshotPurpose = 'export' | 'manual' | 'daily' | 'pre-restore' | 'pre-migration'
export interface DatasetMeta {
  id: 'dataset'
  datasetId: string
  createdAt: string
}
export interface MigrationRecord {
  id: string
  fromVersion: number
  toVersion: number
  appliedAt: string
  snapshotId: string | null
}
export type BackupData = Record<DataTable, Record<string, unknown>[]>
export interface BackupEnvelope {
  format: 'xiaokaoya-backup'
  formatVersion: 1
  schemaVersion: number
  appVersion: string
  backupId: string
  datasetId: string
  exportedAt: string
  purpose: SnapshotPurpose
  counts: Record<string, number>
  data: Record<string, Record<string, unknown>[]>
  checksum: { algorithm: 'SHA-256'; value: string }
}
export interface Inspection {
  envelope: BackupEnvelope
  data: BackupData
  warnings: string[]
  migrated: boolean
  fingerprint: string
  fullFingerprint: string
  counts: Record<string, number>
}

const id = z.string().min(1).max(200)
const timestamp = z.iso.datetime({ offset: true })
const date = z.string().refine(validDate)
const nullableTimestamp = timestamp.nullable()
const entity = { id, createdAt: timestamp, updatedAt: timestamp, revision: z.number().int().min(1) }
const integer = z.number().int().nonnegative()
const sourceUrl = z
  .string()
  .max(2000)
  .refine((s) => !s || /^https?:\/\/[^\s]+$/u.test(s))
const attributionSchema = z
  .object({
    kind: z.enum(['encouragement', 'saying', 'poetry']),
    origin: z.enum(['builtin', 'user', 'imported']),
    author: z.string().max(200),
    work: z.string().max(300),
    sourceTitle: z.string().max(500),
    sourceUrl,
  })
  .strict()
const rows = {
  ...practiceRows,
  quoteDetails: attributionSchema.extend({ ...entity, archivedAt: nullableTimestamp }).strict(),
  quoteFavorites: z.object({ ...entity, active: z.boolean() }).strict(),
  experienceSettings: z
    .object({
      ...entity,
      id: z.literal('experience'),
      soundEnabled: z.boolean(),
      volume: z.number().finite().min(0).max(1),
      partnerSounds: z.boolean(),
      dueSound: z.boolean(),
      motion: z.enum(['system', 'on', 'off']),
      quoteCategory: z.string().max(200).nullable(),
    })
    .strict(),
  subjects: z
    .object({
      id,
      name: z.string().min(1).max(200),
      system: z.enum(['cpa', 'tax']),
      stage: z.enum(['professional', 'comprehensive', 'tax']),
      order: integer,
    })
    .strict(),
  subjectParts: z.object({ id, subjectId: id, name: z.string().min(1).max(200) }).strict(),
  annualPlans: z
    .object({ ...entity, year: z.number().int().min(1900).max(9999), goal: z.string().max(10000) })
    .strict(),
  cycles: z
    .object({
      ...entity,
      subjectId: id,
      annualPlanId: id,
      learningStatus: z.enum(['planned', 'studying', 'paused']),
      archivedAt: nullableTimestamp,
    })
    .strict(),
  tasks: z
    .object({
      ...entity,
      cycleId: id,
      chapterId: id.nullable(),
      title: z.string().trim().min(1).max(160),
      plannedDate: date.nullable(),
      kind: z.enum(['study', 'review']).optional(),
      estimatedSeconds: z.number().int().min(1).max(86400),
      status: z.enum(['pending', 'in_progress', 'completed', 'partial', 'deferred', 'cancelled']),
      notes: z.string().max(2000),
    })
    .strict(),
  preferences: z
    .object({
      ...entity,
      id: z.literal('preferences'),
      companionId: id,
      defaultWeeklyGoalSeconds: z.number().int().min(1),
    })
    .strict(),
  quotes: z
    .object({ id, text: z.string().min(1).max(10000), category: z.string().max(200) })
    .strict(),
  dailyQuotes: z
    .object({
      attribution: attributionSchema.optional(),
      date,
      quoteId: id,
      text: z.string().min(1).max(10000),
      rotation: integer,
      updatedAt: timestamp,
    })
    .strict(),
  quoteHistory: z
    .object({
      attribution: attributionSchema.optional(),
      id,
      date,
      quoteId: id,
      text: z.string().min(1).max(10000),
      shownAt: timestamp,
      reason: z.enum(['daily', 'manual']),
    })
    .strict(),
  studySessions: z
    .object({
      ...entity,
      cycleId: id,
      taskId: id.nullable(),
      studyDate: date,
      status: z.enum(['draft', 'confirmed', 'voided']),
      timeMode: z.enum(['duration_only', 'segments']),
      durationOnlySeconds: integer.nullable(),
      source: z.enum(['manual', 'timer']).optional(),
      entryId: id.optional(),
      timerId: id.nullable().optional(),
      chapterId: id.nullable().optional(),
      notes: z.string().max(2000).optional(),
      overlapAcknowledged: z.boolean().optional(),
      voidReason: z.string().max(500).optional(),
    })
    .strict(),
  focusTimers: z
    .object({
      ...entity,
      cycleId: id,
      taskId: id.nullable(),
      chapterId: id.nullable(),
      targetSeconds: z.number().int().min(1).max(28800),
      status: z.enum(['running', 'paused', 'review', 'saved', 'discarded']),
      reason: z.enum([
        'started',
        'paused',
        'resumed',
        'stopped',
        'due',
        'lock',
        'sleep',
        'exit',
        'interrupted',
        'clock',
        'restore',
        'backup',
        'write-failed',
      ]),
      checkpointAt: timestamp,
      intervals: z
        .array(z.object({ startedAt: timestamp, endedAt: timestamp }).strict())
        .max(100000),
      sessionIds: z.array(id),
    })
    .strict(),
  timeSegments: z
    .object({ ...entity, sessionId: id, startedAt: timestamp, endedAt: nullableTimestamp })
    .strict(),
  datasetMeta: z
    .object({ id: z.literal('dataset'), datasetId: z.uuid(), createdAt: timestamp })
    .strict(),
  migrationHistory: z
    .object({
      id,
      fromVersion: integer,
      toVersion: z.number().int().min(1),
      appliedAt: timestamp,
      snapshotId: z.uuid().nullable(),
    })
    .strict(),
  cycleStatuses: z
    .object({
      ...entity,
      registrationStatus: z.enum(['not_planned', 'planned', 'registered', 'attended']),
      examResult: z.enum(['unrecorded', 'passed', 'failed']),
      examDate: date.nullable(),
      notes: z.string().max(2000),
    })
    .strict(),
  materials: z
    .object({
      ...entity,
      cycleId: id,
      partId: id.nullable(),
      title: z.string().trim().min(1).max(160),
      kind: z.enum(['textbook', 'video']),
      edition: z.string().max(200),
      order: integer,
      archivedAt: nullableTimestamp,
    })
    .strict(),
  chapters: z
    .object({
      ...entity,
      cycleId: id,
      partId: id.nullable(),
      title: z.string().trim().min(1).max(160),
      order: integer,
      completionStatus: z.enum(['not_started', 'learning', 'completed']),
      masteryStars: z.number().int().min(1).max(5).nullable(),
      notes: z.string().max(2000),
      archivedAt: nullableTimestamp,
    })
    .strict(),
  materialProgress: z
    .object({
      ...entity,
      materialId: id,
      chapterId: id,
      progressPercent: z.number().int().min(0).max(100),
    })
    .strict(),
  weeklyPlans: z
    .object({
      ...entity,
      weekStart: date,
      goalSeconds: z.number().int().min(0).max(604800).multipleOf(60),
      focus: z.string().max(2000),
    })
    .strict(),
  weeklySubjectTargets: z
    .object({
      ...entity,
      weekStart: date,
      cycleId: id,
      targetSeconds: z.number().int().min(0).max(604800).multipleOf(60),
      active: z.boolean(),
    })
    .strict(),
  taskScheduleHistory: z
    .object({
      id,
      taskId: id,
      taskRevision: z.number().int().min(1),
      fromDate: date.nullable(),
      toDate: date.nullable(),
      action: z.enum(['created', 'rescheduled', 'unscheduled', 'deferred']),
      changedAt: timestamp,
      note: z.string().max(500),
    })
    .strict(),
  examMilestones: z
    .object({
      ...entity,
      cycleId: id,
      kind: z.enum([
        'registration_open',
        'registration_close',
        'payment_due',
        'admission_ticket',
        'results_day',
      ]),
      date,
      notes: z.string().max(2000),
      archivedAt: nullableTimestamp,
    })
    .strict(),
}
const envelopeSchema = z
  .object({
    format: z.literal('xiaokaoya-backup'),
    formatVersion: z.literal(1),
    schemaVersion: z.number().int(),
    appVersion: z.string().min(1).max(100),
    backupId: z.uuid(),
    datasetId: z.uuid(),
    exportedAt: timestamp,
    purpose: z.enum(['export', 'manual', 'daily', 'pre-restore', 'pre-migration']),
    counts: z.record(z.string(), integer),
    data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
    checksum: z
      .object({ algorithm: z.literal('SHA-256'), value: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict(),
  })
  .strict()

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const object = value as Record<string, unknown>
  return (
    '{' +
    Object.keys(object)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonical(object[key]))
      .join(',') +
    '}'
  )
}
export async function sha256(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export function normalizeData(data: Record<string, Record<string, unknown>[]>): typeof data {
  return Object.fromEntries(
    Object.entries(data).map(([name, records]) => [
      name,
      [...records].sort((a, b) => {
        const x = String(a.id ?? a.date),
          y = String(b.id ?? b.date)
        return x < y ? -1 : x > y ? 1 : 0
      }),
    ]),
  )
}
export async function fingerprint(
  data: Record<string, Record<string, unknown>[]>,
  full = false,
): Promise<string> {
  const comparable = Object.fromEntries(
    Object.entries(data).filter(([name]) => full || name !== 'migrationHistory'),
  )
  return sha256(canonical(normalizeData(comparable)))
}
export async function sealBackup(
  input: Omit<BackupEnvelope, 'checksum' | 'counts' | 'format' | 'formatVersion'>,
): Promise<BackupEnvelope> {
  const data = normalizeData(input.data)
  const value = {
    ...input,
    data,
    format: 'xiaokaoya-backup' as const,
    formatVersion: 1 as const,
    counts: Object.fromEntries(
      Object.entries(data).map(([name, records]) => [name, records.length]),
    ),
  }
  return { ...value, checksum: { algorithm: 'SHA-256', value: await sha256(canonical(value)) } }
}
export async function parseBackup(content: string): Promise<BackupEnvelope> {
  if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES)
    throw new Error('文件超过256MB，未进行导入；请保留原文件并联系开发者')
  let raw: unknown
  try {
    raw = JSON.parse(content.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('JSON 文件损坏或未完整下载，原数据未改变')
  }
  const result = envelopeSchema.safeParse(raw)
  if (!result.success) throw new Error('不是受支持的小考鸭完整备份，或文件字段/格式版本不正确')
  const { checksum, ...payload } = result.data
  if ((await sha256(canonical(payload))) !== checksum.value)
    throw new Error('备份校验失败，文件内容可能损坏或被修改')
  return result.data
}

export function validateData(
  data: Record<string, Record<string, unknown>[]>,
  schemaVersion: number,
): string[] {
  if (![1, 2, 3, 4, 5, 6, 7].includes(schemaVersion))
    throw new Error('备份数据库版本高于当前支持范围，请使用兼容版本，原数据未改变')
  const expected = tablesForVersion(schemaVersion)
  if (
    Object.keys(data).length !== expected.length ||
    expected.some((name) => !Array.isArray(data[name]))
  )
    throw new Error('备份数据表缺失或包含当前版本不支持的数据表')
  const warnings: string[] = []
  for (const name of expected) {
    const seen = new Set<string>()
    for (const record of data[name]) {
      if (
        schemaVersion < 6 &&
        (name === 'dailyQuotes' || name === 'quoteHistory') &&
        'attribution' in record
      )
        throw new Error('旧版励志语历史不能包含V6出处快照')
      const valid = rows[name].safeParse(record)
      if (!valid.success)
        throw new Error(
          `${name} 数据字段无效：${valid.error.issues[0].path.join('.')}，未恢复任何数据`,
        )
      if (
        name === 'tasks' &&
        schemaVersion < 4 &&
        (record.plannedDate === null || 'kind' in record)
      )
        throw new Error('旧版任务必须有有效日期，且不能包含新版任务类型字段')
      if (
        name === 'studySessions' &&
        schemaVersion < 5 &&
        [
          'source',
          'entryId',
          'timerId',
          'chapterId',
          'notes',
          'overlapAcknowledged',
          'voidReason',
        ].some((key) => key in record)
      )
        throw new Error('旧版学习记录不能包含V5来源字段')
      const key = String(name === 'dailyQuotes' ? record.date : record.id)
      if (seen.has(key)) throw new Error(`${name} 存在重复记录 ID：${key}`)
      seen.add(key)
    }
  }
  if (schemaVersion >= 7) validatePracticeV7(data)
  const maps = Object.fromEntries(
    Object.entries(data).map(([name, list]) => [
      name,
      new Map(list.map((record) => [String(record.id ?? record.date), record])),
    ]),
  )
  const requireRef = (table: string, key: unknown, context: string) => {
    const record = maps[table]?.get(String(key))
    if (!record) throw new Error(`${context} 引用的 ${table} 记录不存在`)
    return record
  }
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`${label} 重复，不能恢复`)
  }
  unique(
    data.annualPlans.map((record) => String(record.year)),
    '年度计划年份',
  )
  unique(
    data.cycles.map((record) => `${record.annualPlanId}/${record.subjectId}`),
    '年度科目周期',
  )
  if (data.preferences.length !== 1) throw new Error('用户偏好必须包含唯一 preferences 记录')
  if (!companions.some((item) => item.id === data.preferences[0].companionId))
    warnings.push('备份中的伙伴素材暂不可用，将显示默认伙伴，原偏好和学习数据仍保留')
  if (!data.quotes.length) throw new Error('励志语库为空，无法正常使用，请检查备份')
  if (schemaVersion >= 6) {
    if (data.experienceSettings.length !== 1) throw new Error('体验设置缺失或重复')
    for (const row of [...data.quoteDetails, ...data.quoteFavorites])
      requireRef('quotes', row.id, '励志语详情或收藏')
    if (data.quoteDetails.length !== data.quotes.length)
      throw new Error('每条励志语必须有唯一出处详情')
    if (!data.quotes.some((q) => maps.quoteDetails.get(String(q.id))?.archivedAt === null))
      throw new Error('至少保留一条可用励志语')
  }
  for (const subject of data.subjects)
    if ((subject.system === 'tax') !== (subject.stage === 'tax'))
      throw new Error('科目的考试体系与阶段不一致')
  for (const part of data.subjectParts)
    if (requireRef('subjects', part.subjectId, '综合子项').stage !== 'comprehensive')
      throw new Error('试卷子项必须属于综合阶段')
  for (const cycle of data.cycles) {
    requireRef('subjects', cycle.subjectId, '备考周期')
    requireRef('annualPlans', cycle.annualPlanId, '备考周期')
  }
  for (const task of data.tasks) {
    requireRef('cycles', task.cycleId, '学习任务')
    if (task.chapterId !== null) {
      if (schemaVersion < 3) throw new Error('备份包含章节引用，但当前数据库没有对应章节表')
      if (requireRef('chapters', task.chapterId, '学习任务').cycleId !== task.cycleId)
        throw new Error('任务与章节的备考周期不一致')
    }
  }
  if (schemaVersion >= 3) {
    if (data.cycleStatuses.length !== data.cycles.length)
      throw new Error('每个备考周期必须有独立考试状态')
    for (const status of data.cycleStatuses) requireRef('cycles', status.id, '考试状态')
    for (const item of [...data.materials, ...data.chapters]) {
      const cycle = requireRef('cycles', item.cycleId, '资料或章节')
      if (
        item.partId !== null &&
        requireRef('subjectParts', item.partId, '资料或章节').subjectId !== cycle.subjectId
      )
        throw new Error('资料或章节的试卷子项与科目不一致')
    }
    unique(
      data.materialProgress.map((item) => `${item.materialId}/${item.chapterId}`),
      '资料章节进度',
    )
    for (const progress of data.materialProgress) {
      const material = requireRef('materials', progress.materialId, '资料进度')
      const chapter = requireRef('chapters', progress.chapterId, '资料进度')
      if (material.cycleId !== chapter.cycleId) throw new Error('资料与章节的备考周期不一致')
      if (material.partId !== null && chapter.partId !== null && material.partId !== chapter.partId)
        throw new Error('资料与章节的试卷子项不一致')
    }
  }
  if (schemaVersion >= 4) {
    unique(
      data.weeklyPlans.map((item) => String(item.weekStart)),
      '周计划',
    )
    unique(
      data.weeklySubjectTargets.map((item) => `${item.weekStart}/${item.cycleId}`),
      '科目周目标',
    )
    unique(
      data.examMilestones.map((item) => `${item.cycleId}/${item.kind}`),
      '考试日期节点',
    )
    unique(
      data.taskScheduleHistory.map((item) => `${item.taskId}/${item.taskRevision}`),
      '任务日期变更修订号',
    )
    for (const plan of data.weeklyPlans)
      if (plan.id !== plan.weekStart || weekStart(String(plan.weekStart)) !== plan.weekStart)
        throw new Error('周计划必须以周一日期为唯一标识')
    for (const target of data.weeklySubjectTargets) {
      requireRef('weeklyPlans', target.weekStart, '科目周目标')
      requireRef('cycles', target.cycleId, '科目周目标')
    }
    for (const event of data.examMilestones) requireRef('cycles', event.cycleId, '考试日期节点')
    const historyByTask = new Map<unknown, Record<string, unknown>[]>()
    for (const event of data.taskScheduleHistory) {
      const task = requireRef('tasks', event.taskId, '日期变更历史')
      if (Number(event.taskRevision) > Number(task.revision))
        throw new Error('日期历史的修订号晚于任务')
      if (event.action === 'created') {
        if (event.taskRevision !== 1 || event.fromDate !== null)
          throw new Error('任务创建日期历史无效')
      } else {
        if (event.fromDate === event.toDate) throw new Error('日期变更历史没有实际日期变化')
        if (event.action === 'unscheduled' && event.toDate !== null)
          throw new Error('待安排历史的目标日期必须为空')
        if (event.action === 'rescheduled' && event.toDate === null)
          throw new Error('重新安排历史缺少日期')
        if (
          event.action === 'deferred' &&
          (event.fromDate === null ||
            event.toDate === null ||
            String(event.toDate) <= String(event.fromDate))
        )
          throw new Error('延期历史的目标日期必须晚于原日期')
      }
      const list = historyByTask.get(event.taskId) ?? []
      list.push(event)
      historyByTask.set(event.taskId, list)
    }
    for (const [taskId, events] of historyByTask) {
      events.sort((a, b) => Number(a.taskRevision) - Number(b.taskRevision))
      for (let i = 1; i < events.length; i++)
        if (events[i].fromDate !== events[i - 1].toDate) throw new Error('任务日期变更历史不连续')
      if (events.at(-1)!.toDate !== maps.tasks.get(String(taskId))!.plannedDate)
        throw new Error('任务当前日期与最新日期历史不一致')
    }
  }
  for (const quote of [...data.dailyQuotes, ...data.quoteHistory])
    requireRef('quotes', quote.quoteId, '励志语历史')
  let durationOnly = 0,
    openSegments = 0
  const segmentCounts = new Map<unknown, number>()
  const intervals: { start: number; end: number; id: string }[] = []
  for (const record of data.studySessions) {
    requireRef('cycles', record.cycleId, '学习记录')
    if (
      record.taskId !== null &&
      requireRef('tasks', record.taskId, '学习记录').cycleId !== record.cycleId
    )
      throw new Error('学习记录与关联任务的备考周期不一致')
    if (record.timeMode === 'duration_only') {
      if (record.status === 'confirmed' && record.durationOnlySeconds === null)
        throw new Error('已确认的补录缺少实际时长')
      durationOnly++
    } else if (record.durationOnlySeconds !== null)
      throw new Error('同一学习记录不能同时保存分段计时和手动时长')
  }
  for (const segment of data.timeSegments) {
    segmentCounts.set(segment.sessionId, (segmentCounts.get(segment.sessionId) ?? 0) + 1)
    const record = requireRef('studySessions', segment.sessionId, '时间明细')
    if (record.timeMode !== 'segments') throw new Error('手动时长记录不能同时关联计时明细')
    const start = Date.parse(String(segment.startedAt))
    if (segment.endedAt === null) {
      if (record.status !== 'draft') throw new Error('已确认或已作废的记录包含未结束计时')
      openSegments++
      continue
    }
    const end = Date.parse(String(segment.endedAt))
    if (end <= start) throw new Error('计时结束时间必须晚于开始时间')
    if (record.status === 'confirmed') intervals.push({ start, end, id: String(segment.id) })
  }
  if (openSegments > 1) throw new Error('备份包含多个未结束计时，需要先检查原数据')
  if (openSegments) warnings.push('有未结束计时，将保留为待确认记录，不会自动继续计时或累计时长')
  if (durationOnly) warnings.push(`有 ${durationOnly} 条仅时长补录，无法核验时间重叠`)
  for (const record of data.studySessions)
    if (
      record.status === 'confirmed' &&
      record.timeMode === 'segments' &&
      !segmentCounts.has(record.id)
    )
      throw new Error('已确认的计时记录缺少时间明细')
  intervals.sort((a, b) => a.start - b.start)
  let end = -Infinity
  for (const interval of intervals) {
    if (interval.start < end) throw new Error('学习时间存在重叠，不能重复累计，请先检查原数据')
    end = interval.end
  }
  if (schemaVersion >= 2) {
    if (data.datasetMeta.length !== 1) throw new Error('数据集标识缺失或重复')
    for (const migration of data.migrationHistory)
      if (
        Number(migration.toVersion) <= Number(migration.fromVersion) ||
        Number(migration.toVersion) > schemaVersion
      )
        throw new Error('数据库迁移记录无效')
  }
  if (schemaVersion >= 5) warnings.push(...validateLearningV5(data as BackupData))
  return warnings
}

export async function inspectBackup(envelope: BackupEnvelope): Promise<Inspection> {
  const warnings = validateData(envelope.data, envelope.schemaVersion)
  const names = tablesForVersion(envelope.schemaVersion)
  if (
    Object.keys(envelope.counts).length !== names.length ||
    names.some((name) => envelope.counts[name] !== envelope.data[name].length)
  )
    throw new Error('备份记录数量与清单不一致')
  if (envelope.schemaVersion >= 2 && envelope.data.datasetMeta[0].datasetId !== envelope.datasetId)
    throw new Error('备份头部与数据集标识不一致')
  const migrated = envelope.schemaVersion < DATABASE_VERSION
  const data = upgradePayload(
    envelope.data,
    envelope.schemaVersion,
    { id: 'dataset', datasetId: envelope.datasetId, createdAt: envelope.exportedAt },
    {
      id: `import-${envelope.backupId}`,
      fromVersion: envelope.schemaVersion,
      toVersion: DATABASE_VERSION,
      appliedAt: envelope.exportedAt,
      snapshotId: envelope.backupId,
    },
  )
  if (migrated)
    warnings.push(
      `此备份为数据库 V${envelope.schemaVersion}，将在暂存区转换为 V${DATABASE_VERSION}，原文件不会修改；新增结构按版本补齐${envelope.schemaVersion < 6 ? '，收藏和声音设置使用默认值（默认静音）' : '，保留原有收藏、声音与动画设置'}，当前数据将按预检结果整体替换`,
    )
  validateData(data, DATABASE_VERSION)
  return {
    envelope,
    data,
    warnings,
    migrated,
    fingerprint: await fingerprint(data),
    fullFingerprint: await fingerprint(data, true),
    counts: Object.fromEntries(TABLES.map((name) => [name, data[name].length])),
  }
}
