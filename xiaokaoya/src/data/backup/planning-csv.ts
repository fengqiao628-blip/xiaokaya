import type { BackupData } from '../../shared/backup'
import {
  MILESTONE_LABELS,
  SCHEDULE_LABELS,
  type MilestoneKind,
  type ScheduleAction,
  type Task,
  type StudySession,
  type TimeSegment,
} from '../../domain/models'
import { weekDates, weeklyOverview } from '../../domain/planning'

export function planningCsvRows(
  data: BackupData,
  kind: 'weekly-plans' | 'weekly-targets' | 'schedule-history' | 'exam-dates',
): unknown[][] {
  const cycles = new Map(data.cycles.map((row) => [row.id, row])),
    subjects = new Map(data.subjects.map((row) => [row.id, row])),
    plans = new Map(data.annualPlans.map((row) => [row.id, row]))
  const name = (id: unknown) => {
    const cycle = cycles.get(id),
      subject = subjects.get(cycle?.subjectId)
    return [
      subject?.system === 'cpa' ? 'CPA' : '税务师',
      subject?.name ?? '',
      plans.get(cycle?.annualPlanId)?.year ?? '',
    ]
  }
  const tasks = data.tasks as unknown as Task[],
    sessions = data.studySessions as unknown as StudySession[],
    segments = data.timeSegments as unknown as TimeSegment[]
  if (kind === 'weekly-plans')
    return [
      [
        '周一日期',
        '本周最后有效日期',
        '总目标分钟',
        '预计安排分钟',
        '实际学习分钟',
        '已完成任务数',
        '有效任务数',
        '本周重点',
      ],
      ...data.weeklyPlans.map((plan) => {
        const summary = weeklyOverview(tasks, sessions, segments, String(plan.weekStart))
        return [
          plan.weekStart,
          weekDates(String(plan.weekStart)).at(-1),
          Number(plan.goalSeconds) / 60,
          summary.plannedSeconds / 60,
          summary.actualSeconds / 60,
          summary.completed,
          summary.total,
          plan.focus,
        ]
      }),
    ]
  if (kind === 'weekly-targets')
    return [
      [
        '周一日期',
        '考试体系',
        '科目',
        '目标年份',
        '是否选入本周',
        '科目目标分钟',
        '该科本周实际分钟',
      ],
      ...data.weeklySubjectTargets.map((target) => {
        const summary = weeklyOverview(tasks, sessions, segments, String(target.weekStart))
        return [
          target.weekStart,
          ...name(target.cycleId),
          target.active ? '是' : '否',
          Number(target.targetSeconds) / 60,
          (summary.actualByCycle.get(String(target.cycleId)) ?? 0) / 60,
        ]
      }),
    ]
  if (kind === 'schedule-history') {
    const taskMap = new Map(data.tasks.map((row) => [row.id, row]))
    return [
      [
        '变更ID',
        '任务ID',
        '任务内容',
        '考试体系',
        '科目',
        '目标年份',
        '任务修订号',
        '原安排日期',
        '新安排日期',
        '操作',
        '变更时间UTC',
        '说明',
      ],
      ...data.taskScheduleHistory.map((event) => [
        event.id,
        event.taskId,
        taskMap.get(event.taskId)?.title ?? '',
        ...name(taskMap.get(event.taskId)?.cycleId),
        event.taskRevision,
        event.fromDate ?? '未定日期',
        event.toDate ?? '未定日期',
        SCHEDULE_LABELS[event.action as ScheduleAction],
        event.changedAt,
        event.note,
      ]),
    ]
  }
  return [
    [
      '记录ID',
      '考试体系',
      '科目',
      '目标年份',
      '日期节点',
      '日期',
      '说明',
      '是否停用',
      '科目是否归档',
      '来源',
    ],
    ...data.examMilestones.map((event) => [
      event.id,
      ...name(event.cycleId),
      MILESTONE_LABELS[event.kind as MilestoneKind],
      event.date,
      event.notes,
      event.archivedAt ? '是' : '否',
      cycles.get(event.cycleId)?.archivedAt ? '是' : '否',
      '考试日期节点',
    ]),
    ...data.cycleStatuses
      .filter((status) => status.examDate !== null)
      .map((status) => [
        status.id,
        ...name(status.id),
        MILESTONE_LABELS.exam,
        status.examDate,
        status.notes,
        '否',
        cycles.get(status.id)?.archivedAt ? '是' : '否',
        '科目考试档案',
      ]),
  ]
}
