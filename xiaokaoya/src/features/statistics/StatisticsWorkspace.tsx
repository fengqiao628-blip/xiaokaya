import { useMemo, useState, type ReactNode } from 'react'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Leaf,
} from 'lucide-react'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
import {
  ALL_SCOPE,
  dateRange,
  progressStatistics,
  scopedCycles,
  shiftPeriod,
  timeIndex,
  timeStatistics,
  weeklyReview,
  type Period,
  type Scope,
} from '../../domain/analytics'
import { durationText, prettyDate, validDate } from '../../domain/dates'
import { CHAPTER_LABELS, LEARNING_LABELS, TASK_LABELS } from '../../domain/models'
import { progressCsv, timeCsv, weeklyCsv } from './export'
import './statistics.css'

type TimeReport = ReturnType<typeof timeStatistics>
type ProgressReport = ReturnType<typeof progressStatistics>
type Review = ReturnType<typeof weeklyReview>
const percentage = (value: number, total: number) =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : '暂无任务'
const stars = (value: number | null) => (value === null ? '未评分' : `${value.toFixed(1)} / 5星`)
const percent = (value: number | null) =>
  value === null ? '暂无适用章节' : `${Math.round(value)}%`
function Stat({
  label,
  value,
  note,
  tone = '',
}: {
  label: string
  value: string
  note: string
  tone?: string
}) {
  return (
    <article className={`stats-metric ${tone}`} aria-label={label}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}
function ProgressBar({
  value,
  label,
  emptyText = '暂无适用章节',
}: {
  value: number | null
  label: string
  emptyText?: string
}) {
  return (
    <div
      className="stats-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value)}
      aria-valuetext={value === null ? emptyText : percent(value)}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
    </div>
  )
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="stats-empty">{children}</p>
}
function Trend({
  report,
  period,
  onChoose,
}: {
  report: TimeReport
  period: Period
  onChoose: (key: string) => void
}) {
  const max = Math.max(60, ...report.trend.map((p) => Math.max(p.actual, p.planned)))
  return (
    <section className="stats-card" aria-label="学习时间趋势">
      <header>
        <div>
          <h3>一点点积攒的学习时间</h3>
          <p>实际时间按来源分色，虚线柱是预计安排。点击日期可查看明细。</p>
        </div>
        <BarChart3 size={20} />
      </header>
      <div className="stats-legend">
        <span className="timer">陪伴计时</span>
        <span className="manual">手动录入</span>
        <span className="legacy">历史来源</span>
        <span className="planned">预计安排</span>
      </div>
      {report.trend.length ? (
        <div className="stats-chart-scroll">
          <div className="stats-chart" role="group" aria-label="按日期查看学习统计">
            {report.trend.map((p) => (
              <button
                key={p.key}
                className="stats-chart-column"
                onClick={() => onChoose(p.key)}
                aria-label={`查看${p.key}：实际${durationText(p.actual)}，其中陪伴${durationText(p.companion)}，预计${durationText(p.planned)}`}
              >
                <span className="stats-chart-value">
                  {p.actual >= 3600
                    ? `${(p.actual / 3600).toFixed(1)}时`
                    : p.actual >= 60
                      ? `${Math.floor(p.actual / 60)}分`
                      : p.actual > 0
                        ? `${Math.floor(p.actual)}秒`
                        : '—'}
                </span>
                <span className="stats-chart-bars">
                  <span
                    className="stats-actual-stack"
                    style={{ height: `${(p.actual / max) * 145}px` }}
                  >
                    <span
                      className="timer"
                      style={{ height: `${p.actual ? (p.companion / p.actual) * 100 : 0}%` }}
                    />
                    <span
                      className="manual"
                      style={{ height: `${p.actual ? (p.manual / p.actual) * 100 : 0}%` }}
                    />
                    <span
                      className="legacy"
                      style={{ height: `${p.actual ? (p.legacy / p.actual) * 100 : 0}%` }}
                    />
                  </span>
                  <span
                    className="stats-plan-bar"
                    style={{ height: `${(p.planned / max) * 145}px` }}
                  />
                </span>
                <span>
                  {period === 'all'
                    ? `${p.key}年`
                    : period === 'year'
                      ? `${Number(p.key.slice(5))}月`
                      : p.key.slice(5).replace('-', '/')}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Empty>还没有确认的学习记录或已安排任务。愿意的时候，从一小步开始。</Empty>
      )}
      <details className="stats-details">
        <summary>查看趋势数据表</summary>
        <div className="stats-table-scroll">
          <table>
            <caption>趋势明细，时间单位为分钟</caption>
            <thead>
              <tr>
                <th>日期</th>
                <th>实际</th>
                <th>其中陪伴</th>
                <th>预计</th>
              </tr>
            </thead>
            <tbody>
              {report.trend.map((p) => (
                <tr key={p.key}>
                  <th scope="row">{p.key}</th>
                  <td>{(p.actual / 60).toFixed(2)}</td>
                  <td>{(p.companion / 60).toFixed(2)}</td>
                  <td>{(p.planned / 60).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
function TimeView({
  report,
  period,
  onChoose,
  onCycle,
}: {
  report: TimeReport
  period: Period
  onChoose: (key: string) => void
  onCycle: (id: string) => void
}) {
  const total = report.summary
  return (
    <div className="stats-section" aria-label="时间统计内容">
      <div className="stats-metrics">
        <Stat
          label="本范围实际学习"
          value={durationText(total.actual)}
          note="仅已确认学习记录"
          tone="green"
        />
        <Stat
          label="其中伙伴陪伴"
          value={durationText(total.companion)}
          note="已包含在实际学习中"
          tone="lilac"
        />
        <Stat
          label="本范围预计安排"
          value={durationText(total.planned)}
          note="按任务当前安排日期统计"
        />
        <Stat
          label="任务完成率"
          value={percentage(total.completed, total.tasks)}
          note={`已完成 ${total.completed} / ${total.tasks} 项，已取消不计`}
        />
      </div>
      <div className="stats-inline-facts">
        <span>
          手动录入 <b>{durationText(total.manual)}</b>
        </span>
        <span>
          历史来源 <b>{durationText(total.legacy)}</b>
        </span>
        <span>
          学习日 <b>{total.days}天</b>
        </span>
        <span>
          范围内最长连续 <b>{report.longest}天</b>
        </span>
        <span>
          截至今天连续 <b>{report.currentStreak}天</b>
        </span>
      </div>
      <Trend report={report} period={period} onChoose={onChoose} />
      <div className="stats-two-columns">
        <section className="stats-card" aria-label="考试体系时间分布">
          <header>
            <div>
              <h3>CPA与税务师</h3>
              <p>按实际学习时间查看分布。</p>
            </div>
          </header>
          {report.bySystem.map((s) => (
            <div className="stats-distribution" key={s.system}>
              <div>
                <strong>{s.label}</strong>
                <span>{durationText(s.actual)}</span>
              </div>
              <ProgressBar
                value={total.actual ? (s.actual / total.actual) * 100 : null}
                label={`${s.label}实际时间占比`}
                emptyText="暂无实际时间"
              />
              <small>
                其中陪伴 {durationText(s.companion)} · 预计 {durationText(s.planned)}
              </small>
            </div>
          ))}
        </section>
        <section className="stats-card stats-gentle">
          <Leaf size={24} />
          <h3>时长是记录，理解也很重要</h3>
          <p>学习可以有快有慢。可以一起看看章节和掌握星级，找到下一次想照顾的知识点。</p>
          <p>连续学习从有实际记录的日期计算；今天尚未学习时，可以接续昨天的连续天数。</p>
        </section>
      </div>
      <section className="stats-card" aria-label="年度科目时间统计">
        <header>
          <div>
            <h3>每一门科目，都有自己的节奏</h3>
            <p>相同科目的不同备考年度分别保留。点击科目可筛选。</p>
          </div>
        </header>
        <div className="stats-table-scroll">
          <table>
            <caption>年度科目时间，按当前学习日期范围</caption>
            <thead>
              <tr>
                <th>年度科目</th>
                <th>实际学习</th>
                <th>其中陪伴</th>
                <th>预计安排</th>
                <th>完成任务</th>
              </tr>
            </thead>
            <tbody>
              {report.byCycle.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <button className="text-button" onClick={() => onCycle(c.id)}>
                      {c.label}
                    </button>
                    <small>
                      {LEARNING_LABELS[c.learningStatus]}
                      {c.archivedAt ? ' · 已归档' : ''}
                    </small>
                  </th>
                  <td>{durationText(c.actual)}</td>
                  <td>{durationText(c.companion)}</td>
                  <td>{durationText(c.planned)}</td>
                  <td>
                    {c.completed} / {c.tasks}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!report.byCycle.length && (
          <Empty>当前筛选下还没有年度科目。可以调整筛选或在“我的科目”自主添加。</Empty>
        )}
      </section>
    </div>
  )
}
function ProgressView({
  report,
  labels,
  onManage,
}: {
  report: ProgressReport
  labels: Map<string, string>
  onManage: (id?: string) => void
}) {
  const [chapterPage, setChapterPage] = useState(0),
    [materialPage, setMaterialPage] = useState(0)
  const chapterCurrent = Math.min(
    chapterPage,
    Math.max(0, Math.ceil(report.chapters.length / 50) - 1),
  )
  const materialCurrent = Math.min(
    materialPage,
    Math.max(0, Math.ceil(report.materials.length / 20) - 1),
  )
  return (
    <div className="stats-section" aria-label="学习进度内容">
      <p className="stats-notice">
        这里展示当前档案进度，与学习时间范围独立。教材读完、章节完成和知识掌握分别记录。
      </p>
      <div className="stats-metrics">
        <Stat
          label="当前已完成章节"
          value={`${report.completed} / ${report.chapters.length}章`}
          note={
            report.chapters.length
              ? `章节完成率 ${percentage(report.completed, report.chapters.length)}`
              : '添加章节后可统计'
          }
          tone="green"
        />
        <Stat
          label="当前平均掌握"
          value={stars(report.stars)}
          note={`已评分 ${report.rated} / ${report.chapters.length}章`}
          tone="lilac"
        />
        <Stat
          label="当前学习资料"
          value={`${report.materials.length}份`}
          note={`教材 ${report.materials.filter((m) => m.kind === 'textbook').length} · 视频 ${report.materials.filter((m) => m.kind === 'video').length}`}
        />
        <Stat
          label="可以再巩固的章节"
          value={`${report.lowMastery.length}章`}
          note="已评为1—2星；未评分另行保留"
        />
      </div>
      <section className="stats-card" aria-label="教材与视频独立进度">
        <header>
          <div>
            <h3>教材和视频，分别看见进度</h3>
            <p>每份资料按适用章节等权平均，未记录章节按0参与；版本分开展示。</p>
          </div>
          <button className="button outline" onClick={() => onManage()}>
            管理资料与章节
          </button>
        </header>
        <div className="stats-material-grid">
          {report.materials.slice(materialCurrent * 20, (materialCurrent + 1) * 20).map((m) => (
            <article className="stats-material" key={m.id} aria-label={`资料进度：${m.title}`}>
              <span className="stats-eyebrow">
                {labels.get(m.cycleId)}
                {m.partName ? ` · ${m.partName}` : ''}
              </span>
              <h4>
                {m.kind === 'textbook' ? <BookOpen size={17} /> : <CalendarDays size={17} />}{' '}
                {m.title}
              </h4>
              <p>
                {m.kind === 'textbook' ? '教材' : '视频'}
                {m.edition ? ` · ${m.edition}` : ''}
                {m.archivedAt ? ' · 已归档' : ''}
              </p>
              <strong>{percent(m.percent)}</strong>
              <ProgressBar value={m.percent} label={`${m.title}当前资料进度`} />
              <small>
                已记录 {m.recorded} / {m.chapters} 个适用章节
              </small>
              <button className="text-button" onClick={() => onManage(m.cycleId)}>
                到年度档案更新
              </button>
            </article>
          ))}
        </div>
        <StatsPager
          name="资料"
          total={report.materials.length}
          page={materialCurrent}
          size={20}
          onPage={setMaterialPage}
        />
        {!report.materials.length && (
          <Empty>添加教材或视频后，进度会在这里显示。各版本的进度不会相互覆盖。</Empty>
        )}
      </section>
      <section className="stats-card" aria-label="章节掌握明细">
        <header>
          <div>
            <h3>章节完成与掌握程度</h3>
            <p>星级只来自你的评价，不从阅读百分比或学习时长推断。</p>
          </div>
        </header>
        <div className="stats-table-scroll">
          <table>
            <caption>当前章节状态与掌握，不是历史快照</caption>
            <thead>
              <tr>
                <th>章节</th>
                <th>年度科目</th>
                <th>当前状态</th>
                <th>掌握程度</th>
                <th>资料进度</th>
              </tr>
            </thead>
            <tbody>
              {report.chapters.slice(chapterCurrent * 50, (chapterCurrent + 1) * 50).map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    {c.title}
                    <small>
                      {c.partName}
                      {c.archivedAt ? ' · 已归档' : ''}
                    </small>
                  </th>
                  <td>
                    <button className="text-button" onClick={() => onManage(c.cycleId)}>
                      {labels.get(c.cycleId)}
                    </button>
                  </td>
                  <td>{CHAPTER_LABELS[c.completionStatus]}</td>
                  <td>
                    {c.masteryStars === null
                      ? '未评分'
                      : `${'★'.repeat(c.masteryStars)} ${c.masteryStars} / 5`}
                  </td>
                  <td>
                    {c.materials.length
                      ? c.materials.map((m) => (
                          <small key={m.id}>
                            {m.title}：{m.percent === null ? '未记录' : `${m.percent}%`}
                          </small>
                        ))
                      : '未关联适用资料'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <StatsPager
          name="章节"
          total={report.chapters.length}
          page={chapterCurrent}
          size={50}
          onPage={setChapterPage}
        />
        {!report.chapters.length && <Empty>当前范围暂无章节。已有学习记录和时长会继续保留。</Empty>}
      </section>
    </div>
  )
}
function StatsPager({
  name,
  total,
  page,
  size,
  onPage,
}: {
  name: string
  total: number
  page: number
  size: number
  onPage: (page: number) => void
}) {
  if (total <= size) return null
  const pages = Math.ceil(total / size)
  return (
    <div className="stats-pager" role="group" aria-label={`${name}分页`}>
      <span>
        共{total}
        {name === '章节' ? '章' : '份'} · 第{page + 1}/{pages}页，统计与导出包含全部数据
      </span>
      <button className="button ghost" disabled={page === 0} onClick={() => onPage(page - 1)}>
        上一页{name}
      </button>
      <button
        className="button ghost"
        disabled={page + 1 === pages}
        onClick={() => onPage(page + 1)}
      >
        下一页{name}
      </button>
    </div>
  )
}
function WeekView({
  report,
  labels,
  onPlanner,
  onManage,
}: {
  report: Review
  labels: Map<string, string>
  onPlanner: () => void
  onManage: (id?: string) => void
}) {
  const delta = report.previous ? report.summary.actual - report.previous.actual : null
  const suggestions = [
    report.summary.actual === 0
      ? '这一周还没有确认的学习记录。可以先安排一个小任务，或补录已经完成的学习。'
      : `这一周记录了${report.summary.days}个学习日，每一段认真投入都算数。`,
    report.goal !== null && report.goal > 0
      ? report.summary.actual >= report.goal
        ? '已达到本周目标，可以按自己的状态安排巩固和休息。'
        : `距离当前目标还有${durationText(report.goal - report.summary.actual)}，可以按接下来的状态灵活调整。`
      : '本周尚未设置当前范围目标。愿意的话，可以在学习日历里安排一个合适的小目标。',
    report.remaining.length
      ? `还有${report.remaining.length}项已安排任务待完成。可以保留、改期或移入待安排池，由你决定。`
      : '已安排任务可以慢慢回顾，看看有没有需要再巩固的知识点。',
    report.chapters.some((c) => c.masteryStars !== null && c.masteryStars <= 2)
      ? '本周关联章节中有1—2星的知识点，下次可以留一点时间做针对性巩固。'
      : '理解和掌握需要自己的节奏，时长和完成率只是观察学习的几个角度。',
  ]
  return (
    <div className="stats-section" aria-label="每周总结内容">
      <section className="stats-week-banner">
        <span className="stats-eyebrow">
          周一开始 · {report.range.start} — {report.range.end}
        </span>
        <h3>{report.focus || '这一周，也有属于你的进步'}</h3>
        <p>总结随补录、作废和任务改期更新。任务与章节显示当前状态。</p>
        <button className="button outline" onClick={onPlanner}>
          调整本周学习安排
        </button>
      </section>
      <div className="stats-metrics">
        <Stat
          label="本周实际学习"
          value={durationText(report.summary.actual)}
          note={`其中陪伴 ${durationText(report.summary.companion)}`}
          tone="green"
        />
        <Stat
          label={report.goalLabel}
          value={report.goal === null ? '未设置' : durationText(report.goal)}
          note={
            report.goal !== null && report.goal > 0
              ? `目标完成 ${percentage(report.summary.actual, report.goal)}`
              : '由你设置，不补造历史目标'
          }
          tone="lilac"
        />
        <Stat
          label="本周任务完成"
          value={`${report.summary.completed} / ${report.summary.tasks}项`}
          note={`预计安排 ${durationText(report.summary.planned)}`}
        />
        <Stat
          label="与上周实际相比"
          value={
            delta === null
              ? '暂无对比'
              : delta === 0
                ? '保持一致'
                : `${delta > 0 ? '多' : '少'}${durationText(Math.abs(delta))}`
          }
          note={`上周 ${report.previous ? durationText(report.previous.actual) : '超出日期范围'}`}
        />
      </div>
      <section className="stats-card" aria-label="本周各科目标与时间">
        <header>
          <div>
            <h3>目标和投入，放在一起看看</h3>
            <p>
              全科总目标：{report.fullGoal === null ? '未设置' : durationText(report.fullGoal)}
              ，不随科目筛选改变。各科目标取已设置的分配。
            </p>
          </div>
        </header>
        <div className="stats-table-scroll">
          <table>
            <thead>
              <tr>
                <th>年度科目</th>
                <th>已分配目标</th>
                <th>实际学习</th>
                <th>其中陪伴</th>
                <th>预计安排</th>
              </tr>
            </thead>
            <tbody>
              {report.byCycle.map((c) => {
                const target = report.targets.find((t) => t.cycleId === c.id)
                return (
                  <tr key={c.id}>
                    <th scope="row">{c.label}</th>
                    <td>{target ? durationText(target.targetSeconds) : '未设置'}</td>
                    <td>{durationText(c.actual)}</td>
                    <td>{durationText(c.companion)}</td>
                    <td>{durationText(c.planned)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="stats-two-columns">
        <section className="stats-card" aria-label="本周未完成任务">
          <header>
            <div>
              <h3>留给下一步的小任务</h3>
              <p>
                本周尚有{report.remaining.length}项未完成；未定日期的待安排任务另有
                {report.unassigned}项。
              </p>
            </div>
          </header>
          {report.remaining.slice(0, 8).map((t) => (
            <article className="stats-task" key={t.id}>
              <strong>{t.title}</strong>
              <small>
                {labels.get(t.cycleId)} · {t.plannedDate} · {TASK_LABELS[t.status]}
              </small>
            </article>
          ))}
          {report.remaining.length > 8 && <p className="stats-note">其余任务可在学习日历查看。</p>}
          {!report.remaining.length && <Empty>当前范围没有未完成的已安排任务。</Empty>}
          <button className="text-button" onClick={onPlanner}>
            打开日历，自主调整
          </button>
        </section>
        <section className="stats-card" aria-label="本周关联章节当前状态">
          <header>
            <div>
              <h3>本周关联章节（当前状态）</h3>
              <p>
                关联{report.chapters.length}章，当前完成{report.linkedCompleted}
                章；不表示都在本周首次完成。
              </p>
            </div>
          </header>
          {report.chapters.slice(0, 8).map((c) => (
            <article className="stats-task" key={c.id}>
              <button className="text-button" onClick={() => onManage(c.cycleId)}>
                {c.title}
              </button>
              <small>
                {CHAPTER_LABELS[c.completionStatus]} ·{' '}
                {c.masteryStars === null ? '未评分' : `${c.masteryStars} / 5星`}
                {c.archivedAt ? ' · 已归档' : ''}
              </small>
            </article>
          ))}
          {report.chapters.length > 8 && (
            <p className="stats-note">其余关联章节可在年度档案查看。</p>
          )}
          {!report.chapters.length && (
            <Empty>任务或实际学习关联章节后，会在这里汇集当前状态。</Empty>
          )}
        </section>
      </div>
      <section className="stats-card stats-suggestions" aria-label="下周调整参考">
        <header>
          <div>
            <h3>
              <Leaf size={18} /> 给下一周的一点参考
            </h3>
            <p>没有统一的学习节奏，安排始终由你决定。</p>
          </div>
        </header>
        <ul>
          {suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
export function StatisticsWorkspace({
  data,
  run,
  busy,
  today,
  onCurriculum,
  onPlanner,
}: {
  data: Snapshot
  run: Runner
  busy: boolean
  today: string
  onCurriculum: (id?: string) => void
  onPlanner: (date: string) => void
}) {
  const [tab, setTab] = useState<'time' | 'progress' | 'week'>('time')
  const [period, setPeriod] = useState<Period>('week'),
    [date, setDate] = useState(today)
  const [scope, setScope] = useState<Scope>({ ...ALL_SCOPE }),
    [archivedMaterials, setArchivedMaterials] = useState(false)
  const [exportResult, setExportResult] = useState('')
  const index = useMemo(
    () => timeIndex(data.sessions, data.segments, data.tasks),
    [data.sessions, data.segments, data.tasks],
  )
  const cycles = useMemo(
    () => scopedCycles(data, scope),
    [data.cycles, data.subjects, data.plans, scope],
  )
  const choices = useMemo(
    () => scopedCycles(data, { ...scope, cycleId: 'all' }),
    [data.cycles, data.subjects, data.plans, scope],
  )
  const range = useMemo(
    () => dateRange(tab === 'week' ? 'week' : period, date),
    [tab, period, date],
  )
  const report = useMemo(
    () => (tab === 'time' ? timeStatistics(index, cycles, range, today) : null),
    [tab, index, cycles, range, today],
  )
  const progress = useMemo(
    () => (tab === 'progress' ? progressStatistics(data, cycles, archivedMaterials) : null),
    [
      tab,
      data.chapters,
      data.materials,
      data.materialProgress,
      data.subjectParts,
      cycles,
      archivedMaterials,
    ],
  )
  const review = useMemo(
    () => (tab === 'week' ? weeklyReview(data, index, cycles, scope, date, today) : null),
    [
      tab,
      data.weeklyPlans,
      data.weeklySubjectTargets,
      data.chapters,
      index,
      cycles,
      scope,
      date,
      today,
    ],
  )
  const labels = new Map(cycles.map((c) => [c.id, c.label]))
  const periodNow = tab === 'week' ? 'week' : period,
    previous = shiftPeriod(periodNow, date, -1),
    next = shiftPeriod(periodNow, date, 1)
  const rangeLabel =
    periodNow === 'all'
      ? '全部学习日期'
      : periodNow === 'day'
        ? prettyDate(date, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
        : `${range.start} — ${range.end}`
  const years = [...new Set(data.plans.map((p) => p.year))].sort((a, b) => a - b)
  async function exportCurrent() {
    let message = '已取消统计CSV导出'
    setExportResult('')
    const saved = await run(
      async () => {
        const content = report
          ? timeCsv(report, range, scope)
          : progress
            ? progressCsv(progress, labels)
            : weeklyCsv(review!, labels)
        const saved = await window.desktop.backup.exportCsv(content, 'statistics')
        if (saved) message = `已导出：${saved.path}${saved.warning ? ` · ${saved.warning}` : ''}`
        setExportResult(message)
      },
      () => message,
    )
    if (!saved) setExportResult('导出未完成，请检查保存位置后重试。当前筛选与学习数据已保留。')
  }
  return (
    <div className="statistics-workspace">
      <p className="modal-description">
        看见投入，也看见理解。学习时间、伙伴陪伴和掌握程度，各自清楚地记录。
      </p>
      <div className="stats-tabs" role="group" aria-label="统计页面">
        {(
          [
            ['time', '时间统计'],
            ['progress', '学习进度'],
            ['week', '每周总结'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id)
              setExportResult('')
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="stats-scope">
        <label className="field">
          考试分类
          <select
            aria-label="统计考试分类"
            value={scope.system}
            onChange={(e) =>
              setScope({ ...scope, system: e.target.value as Scope['system'], cycleId: 'all' })
            }
          >
            <option value="all">全部考试</option>
            <option value="cpa">CPA</option>
            <option value="tax">税务师</option>
          </select>
        </label>
        <label className="field">
          备考年份
          <select
            aria-label="统计备考年份"
            value={scope.year}
            onChange={(e) => setScope({ ...scope, year: e.target.value, cycleId: 'all' })}
          >
            <option value="all">全部备考年份</option>
            {years.map((y) => (
              <option value={String(y)} key={y}>
                {y}年备考
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          年度科目
          <select
            aria-label="统计年度科目"
            value={scope.cycleId}
            onChange={(e) => setScope({ ...scope, cycleId: e.target.value })}
          >
            <option value="all">全部年度科目</option>
            {choices.map((c) => (
              <option value={c.id} key={c.id}>
                {c.label}
                {c.archivedAt ? ' · 已归档' : ''}
              </option>
            ))}
          </select>
        </label>
        <button className="text-button" onClick={() => setScope({ ...ALL_SCOPE })}>
          重置筛选
        </button>
      </div>
      <div className="stats-scope-note">
        <label>
          <input
            type="checkbox"
            checked={scope.archived}
            onChange={(e) => setScope({ ...scope, archived: e.target.checked, cycleId: 'all' })}
          />
          包含已归档科目
        </label>
        <span>暂停科目保留在统计中。备考年份与学习发生日期分别筛选。</span>
      </div>
      {tab !== 'progress' ? (
        <>
          {tab === 'time' && (
            <div className="stats-periods" role="group" aria-label="学习时间范围">
              {(
                [
                  ['day', '日'],
                  ['week', '周'],
                  ['month', '月'],
                  ['year', '年'],
                  ['all', '全部'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="stats-date-toolbar">
            <div>
              <button
                className="icon-button"
                aria-label="上个统计周期"
                disabled={!previous}
                onClick={() => previous && setDate(previous)}
              >
                <ChevronLeft size={19} />
              </button>
              <strong aria-label="当前统计日期范围">{rangeLabel}</strong>
              <button
                className="icon-button"
                aria-label="下个统计周期"
                disabled={!next}
                onClick={() => next && setDate(next)}
              >
                <ChevronRight size={19} />
              </button>
            </div>
            <label className="field">
              定位学习日期
              <input
                type="date"
                aria-label="统计定位日期"
                min="1900-01-01"
                max="9999-12-31"
                value={date}
                onChange={(e) => {
                  if (validDate(e.target.value)) setDate(e.target.value)
                }}
              />
            </label>
            <button className="button ghost" onClick={() => setDate(today)}>
              今天
            </button>
          </div>
        </>
      ) : (
        <label className="stats-archive-assets">
          <input
            type="checkbox"
            checked={archivedMaterials}
            onChange={(e) => setArchivedMaterials(e.target.checked)}
          />
          包含已归档资料与章节
        </label>
      )}
      {report && (
        <TimeView
          report={report}
          period={period}
          onCycle={(id) => setScope({ ...scope, cycleId: id })}
          onChoose={(key) => {
            if (period === 'all') {
              setDate(`${key}-01-01`)
              setPeriod('year')
            } else if (period === 'year') {
              setDate(`${key}-01`)
              setPeriod('month')
            } else if (validDate(key)) {
              setDate(key)
              setPeriod('day')
            }
          }}
        />
      )}
      {progress && (
        <ProgressView
          key={`${scope.system}/${scope.year}/${scope.cycleId}/${scope.archived}/${archivedMaterials}`}
          report={progress}
          labels={labels}
          onManage={onCurriculum}
        />
      )}
      {review && (
        <WeekView
          report={review}
          labels={labels}
          onManage={onCurriculum}
          onPlanner={() => onPlanner(date)}
        />
      )}
      <footer className="stats-footer">
        <button className="button outline" disabled={busy} onClick={exportCurrent}>
          <Download size={16} />
          导出当前统计CSV
        </button>
        <p>导出保留当前范围，单位明确到秒；完整恢复仍使用JSON备份。</p>
      </footer>
      {exportResult && (
        <p className="stats-export-result" role="status">
          {exportResult}
        </p>
      )}
      <details className="stats-details">
        <summary>查看统计口径</summary>
        <p>
          实际学习仅来自已确认记录；陪伴是其中计时来源的部分，不再额外相加。待确认、作废和暂停时间不累计。历史来源保留原记录的学习日期。预计时间取任务当前安排，未定日期和已取消任务不进入日期范围。
        </p>
        <p>
          进度来自当前档案，未评分不等于低星级。阅读完成率不表示掌握程度。周总结会随补录、作废和改期更新；本周关联章节只展示当前状态，不推测完成日期。
        </p>
      </details>
    </div>
  )
}
