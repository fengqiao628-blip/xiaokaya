import { serializeCsv } from '../../shared/csv'
import type {
  DateRange,
  Scope,
  TimeTotals,
  progressStatistics,
  timeStatistics,
  weeklyReview,
} from '../../domain/analytics'
import { CHAPTER_LABELS, TASK_LABELS } from '../../domain/models'

export function timeCsv(report: ReturnType<typeof timeStatistics>, range: DateRange, scope: Scope) {
  const metadata = [
    range.start ?? '全部',
    range.end ?? '全部',
    scope.system === 'all' ? '全部' : scope.system === 'cpa' ? 'CPA' : '税务师',
    scope.year,
    scope.cycleId,
    scope.archived ? '包含已归档科目' : '排除已归档科目',
  ]
  const row = (kind: string, name: string, t: TimeTotals) => [
    ...metadata,
    kind,
    name,
    t.actual,
    t.companion,
    t.manual,
    t.legacy,
    t.planned,
    t.completed,
    t.tasks,
    t.days,
  ]
  return serializeCsv([
    [
      '起始学习日期',
      '结束学习日期',
      '考试筛选',
      '备考年份筛选',
      '年度科目筛选ID',
      '归档范围',
      '分组',
      '名称',
      '实际秒',
      '其中陪伴秒',
      '其中手动秒',
      '其中历史来源秒',
      '预计秒',
      '已完成任务',
      '安排任务数',
      '学习天数',
    ],
    row('合计', '当前范围', report.summary),
    ...report.trend.map((t) => row('趋势', t.key, t)),
    ...report.bySystem.map((t) => row('考试体系', t.label, t)),
    ...report.byCycle.map((t) => row('年度科目', t.label, t)),
  ])
}
export function progressCsv(
  report: ReturnType<typeof progressStatistics>,
  labels: Map<string, string>,
) {
  return serializeCsv([
    [
      '数据类型',
      '年度科目',
      '名称',
      '试卷子项',
      '是否归档',
      '资料类型',
      '版本',
      '当前资料平均进度百分比',
      '适用章节数',
      '已记录进度章节数',
      '当前章节状态',
      '当前掌握星级',
      '说明',
    ],
    ...report.materials.map((m) => [
      '资料',
      labels.get(m.cycleId),
      m.title,
      m.partName,
      m.archivedAt ? '是' : '否',
      m.kind === 'textbook' ? '教材' : '视频',
      m.edition,
      m.percent,
      m.chapters,
      m.recorded,
      '',
      '',
      '适用章节等权平均，未记录按0；非历史快照',
    ]),
    ...report.chapters.map((c) => [
      '章节',
      labels.get(c.cycleId),
      c.title,
      c.partName,
      c.archivedAt ? '是' : '否',
      '',
      '',
      '',
      '',
      '',
      CHAPTER_LABELS[c.completionStatus],
      c.masteryStars,
      '当前状态；未评分为空，不以教材进度替代掌握',
    ]),
  ])
}
export function weeklyCsv(report: ReturnType<typeof weeklyReview>, labels: Map<string, string>) {
  const base = [report.range.start, report.range.end]
  const metric = (name: string, value: unknown, unit: string, note = '') => [
    ...base,
    '周汇总',
    name,
    value,
    unit,
    note,
  ]
  return serializeCsv([
    ['周一', '周日', '数据类型', '项目', '值', '单位或状态', '说明'],
    metric('实际学习', report.summary.actual, '秒'),
    metric('其中陪伴', report.summary.companion, '秒'),
    metric('预计安排', report.summary.planned, '秒'),
    metric('当前范围周目标', report.goal, '秒', `${report.goalLabel}；空值为未设置`),
    metric('全科周目标', report.fullGoal, '秒', '不随科目筛选改变'),
    metric('年度科目范围', [...labels.values()].join('；') || '当前筛选无科目', '文字'),
    metric('已完成任务', report.summary.completed, '项'),
    metric('安排任务数', report.summary.tasks, '项'),
    metric('学习天数', report.summary.days, '天'),
    metric('上周实际学习', report.previous?.actual, '秒'),
    metric('本周方向', report.focus, '文字'),
    ...report.remaining.map((t) => [
      ...base,
      '未完成任务',
      t.title,
      t.plannedDate,
      TASK_LABELS[t.status],
      labels.get(t.cycleId),
    ]),
    ...report.chapters.map((c) => [
      ...base,
      '本周关联章节（当前状态）',
      c.title,
      c.masteryStars,
      CHAPTER_LABELS[c.completionStatus],
      labels.get(c.cycleId),
    ]),
  ])
}
