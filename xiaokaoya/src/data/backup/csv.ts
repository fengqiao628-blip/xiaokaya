import type { BackupData } from '../../shared/backup'
import {
  TASK_LABELS,
  type StudySession,
  type TimeSegment,
  type TaskStatus,
  CHAPTER_LABELS,
  LEARNING_LABELS,
  REGISTRATION_LABELS,
  RESULT_LABELS,
  type ChapterStatus,
  type LearningStatus,
  type RegistrationStatus,
  type ExamResult,
} from '../../domain/models'
import { actualSecondsBySession } from '../../domain/statistics'
import type { DataCsvKind } from '../../shared/backup-bridge'
import { serializeCsv } from '../../shared/csv'
import { planningCsvRows } from './planning-csv'
import { intervalMs } from '../../domain/learning-time'

export function makeCsv(data: BackupData, kind: DataCsvKind): string {
  const cycleMap = new Map(data.cycles.map((record) => [record.id, record]))
  const subjectMap = new Map(data.subjects.map((record) => [record.id, record]))
  const planMap = new Map(data.annualPlans.map((record) => [record.id, record]))
  const statusMap = new Map(data.cycleStatuses.map((record) => [record.id, record]))
  const parts = new Map(data.subjectParts.map((record) => [record.id, record.name]))
  const materials = new Map(data.materials.map((record) => [record.id, record]))
  const progressByChapter = new Map<unknown, Record<string, unknown>[]>()
  for (const progress of data.materialProgress) {
    const items = progressByChapter.get(progress.chapterId) ?? []
    items.push(progress)
    progressByChapter.set(progress.chapterId, items)
  }
  const name = (cycleId: unknown) => {
    const cycle = cycleMap.get(cycleId),
      subject = subjectMap.get(cycle?.subjectId)
    return [
      subject?.system === 'cpa' ? 'CPA' : '税务师',
      subject?.name ?? '',
      planMap.get(cycle?.annualPlanId)?.year ?? '',
    ]
  }
  const durations = actualSecondsBySession(
    data.studySessions as unknown as StudySession[],
    data.timeSegments as unknown as TimeSegment[],
  )
  const byTask = new Map<unknown, number>(),
    byCycle = new Map<unknown, number>()
  for (const record of data.studySessions) {
    const value = durations.get(String(record.id)) ?? 0
    if (record.taskId) byTask.set(record.taskId, (byTask.get(record.taskId) ?? 0) + value)
    byCycle.set(record.cycleId, (byCycle.get(record.cycleId) ?? 0) + value)
  }
  let rows: unknown[][]
  if (kind === 'focus-timers')
    rows = [
      [
        '计时ID',
        '考试体系',
        '科目',
        '目标年份',
        '关联任务ID',
        '倒计时目标秒',
        '工作状态',
        '最后原因',
        '已观察有效秒',
        '已保存记录数',
      ],
      ...data.focusTimers.map((run) => [
        run.id,
        ...name(run.cycleId),
        run.taskId,
        run.targetSeconds,
        run.status,
        run.reason,
        intervalMs(run.intervals as import('../../domain/models').FocusInterval[]) / 1000,
        (run.sessionIds as string[]).length,
      ]),
    ]
  else if (kind === 'tasks')
    rows = [
      [
        '任务ID',
        '安排日期',
        '考试体系',
        '科目',
        '目标年份',
        '学习内容',
        '任务状态',
        '预计分钟',
        '关联实际分钟',
        '备注',
        '任务类型',
      ],
      ...data.tasks.map((task) => [
        task.id,
        task.plannedDate,
        ...name(task.cycleId),
        task.title,
        TASK_LABELS[task.status as TaskStatus],
        Number(task.estimatedSeconds) / 60,
        Math.floor(byTask.get(task.id) ?? 0) / 60,
        task.notes,
        task.kind === 'review' ? '复习任务' : '普通学习',
      ]),
    ]
  else if (kind === 'sessions')
    rows = [
      [
        '记录ID',
        '学习日期',
        '考试体系',
        '科目',
        '目标年份',
        '关联任务ID',
        '确认状态',
        '时间来源',
        '实际分钟',
        '录入来源',
        '关联章节ID',
        '学习备注',
        '录入组ID',
        '计时ID',
        '仅时长已知情',
        '最近作废说明',
      ],
      ...data.studySessions.map((record) => [
        record.id,
        record.studyDate,
        ...name(record.cycleId),
        record.taskId,
        record.status,
        record.timeMode === 'duration_only' ? '仅时长补录' : '分段计时',
        Math.floor(durations.get(String(record.id)) ?? 0) / 60,
        record.source === 'timer'
          ? '陪伴计时'
          : record.source === 'manual'
            ? '手动录入'
            : '历史记录',
        record.chapterId,
        record.notes,
        record.entryId,
        record.timerId,
        record.overlapAcknowledged ? '是' : '否',
        record.voidReason,
      ]),
    ]
  else if (kind === 'materials')
    rows = [
      [
        '资料ID',
        '考试体系',
        '科目',
        '目标年份',
        '试卷子项',
        '资料名称',
        '类型',
        '版本说明',
        '是否归档',
      ],
      ...data.materials.map((item) => [
        item.id,
        ...name(item.cycleId),
        parts.get(item.partId) ?? '',
        item.title,
        item.kind === 'textbook' ? '教材' : '视频',
        item.edition,
        item.archivedAt ? '已归档' : '否',
      ]),
    ]
  else if (kind === 'chapters')
    rows = [
      [
        '章节ID',
        '考试体系',
        '科目',
        '目标年份',
        '试卷子项',
        '章节名称',
        '章节完成情况',
        '掌握星级',
        '是否归档',
        '关联资料',
        '资料类型',
        '版本',
        '资料进度百分比',
        '备注',
      ],
      ...data.chapters.flatMap((chapter) => {
        const progress = progressByChapter.get(chapter.id) ?? [null]
        return progress.map((item) => {
          const material = item ? materials.get(item.materialId) : null
          return [
            chapter.id,
            ...name(chapter.cycleId),
            parts.get(chapter.partId) ?? '',
            chapter.title,
            CHAPTER_LABELS[chapter.completionStatus as ChapterStatus],
            chapter.masteryStars ?? '未评',
            chapter.archivedAt ? '已归档' : '否',
            material?.title ?? '',
            material ? (material.kind === 'textbook' ? '教材' : '视频') : '',
            material?.edition ?? '',
            item?.progressPercent ?? '未记录',
            chapter.notes,
          ]
        })
      }),
    ]
  else if (
    kind === 'weekly-plans' ||
    kind === 'weekly-targets' ||
    kind === 'schedule-history' ||
    kind === 'exam-dates'
  )
    rows = planningCsvRows(data, kind)
  else
    rows = [
      [
        '周期ID',
        '考试体系',
        '科目',
        '目标年份',
        '学习状态',
        '报名与参考状态',
        '考试结果',
        '考试日期',
        '考试备注',
        '是否归档',
        '累计实际分钟',
      ],
      ...data.cycles.map((cycle) => [
        cycle.id,
        ...name(cycle.id),
        LEARNING_LABELS[cycle.learningStatus as LearningStatus],
        REGISTRATION_LABELS[statusMap.get(cycle.id)?.registrationStatus as RegistrationStatus] ??
          '',
        RESULT_LABELS[statusMap.get(cycle.id)?.examResult as ExamResult] ?? '',
        statusMap.get(cycle.id)?.examDate ?? '',
        statusMap.get(cycle.id)?.notes ?? '',
        cycle.archivedAt ? '已归档' : '否',
        Math.floor(byCycle.get(cycle.id) ?? 0) / 60,
      ]),
    ]
  return serializeCsv(rows)
}
