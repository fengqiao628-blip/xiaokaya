import { useState } from 'react'
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
} from 'lucide-react'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
import { durationText, prettyDate, shiftDate, validDate, weekStart } from '../../domain/dates'
import { inBacklog, shiftMonth, unfinished, weekDates, weeklyOverview } from '../../domain/planning'
import { actualSecondsBySession } from '../../domain/statistics'
import { MILESTONE_LABELS, TASK_LABELS, type Task } from '../../domain/models'
import { study } from '../../services/study'
import { planning } from '../../services/planning'
import { calendarReminders, cycleLabel, type CalendarReminder, type PlannerView } from './view'
import { MonthCalendar, WeekCalendar, YearCalendar } from './CalendarViews'
import { WeekGoalEditor } from './WeekGoalEditor'
import { ExamDatesEditor } from './ExamDatesEditor'
import { TaskScheduleEditor } from './TaskScheduleEditor'
import './planning.css'
export type { PlannerView } from './view'

export function PlanningWorkspace({
  data,
  run,
  busy,
  today,
  date,
  onDate,
  view,
  onView,
  onCreate,
  onEdit,
  onFocus,
}: {
  data: Snapshot
  run: Runner
  busy: boolean
  today: string
  date: string
  onDate: (value: string) => void
  view: PlannerView
  onView: (value: PlannerView) => void
  onCreate: (date: string | null) => void
  onEdit: (task: Task) => void
  onFocus: (task: Task) => void
}) {
  const [system, setSystem] = useState('all'),
    [cycleFilter, setCycleFilter] = useState('all'),
    [kindFilter, setKindFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all'),
    [poolFilter, setPoolFilter] = useState('unfinished')
  const [poolShowArchived, setPoolShowArchived] = useState(false)
  const [goalEditor, setGoalEditor] = useState(false),
    [examEditor, setExamEditor] = useState(false)
  const [schedule, setSchedule] = useState<{
    task: Task
    mode: 'schedule' | 'defer' | 'history'
  } | null>(null)
  const start = weekStart(date),
    days = weekDates(date),
    weekPlan = data.weeklyPlans.find((item) => item.weekStart === start)
  const overview = weeklyOverview(data.tasks, data.sessions, data.segments, date)
  const targets = data.weeklySubjectTargets.filter(
    (item) => item.weekStart === start && item.active,
  )
  const allocated = targets.reduce((sum, item) => sum + item.targetSeconds, 0)
  const cycles = data.cycles
    .filter(
      (cycle) =>
        system === 'all' ||
        data.subjects.find((item) => item.id === cycle.subjectId)?.system === system,
    )
    .sort((a, b) => cycleLabel(data, a.id).localeCompare(cycleLabel(data, b.id)))
  const matchesCycle = (id: string) => {
    const cycle = data.cycles.find((item) => item.id === id),
      subject = data.subjects.find((item) => item.id === cycle?.subjectId)
    return (
      (system === 'all' || subject?.system === system) &&
      (cycleFilter === 'all' || id === cycleFilter)
    )
  }
  const taskFilter = view === 'backlog' ? poolFilter : statusFilter
  const filtered = data.tasks.filter(
    (task) =>
      matchesCycle(task.cycleId) &&
      (kindFilter === 'all' || (task.kind ?? 'study') === kindFilter) &&
      (taskFilter === 'all' ||
        (taskFilter === 'unfinished' ? unfinished(task) : task.status === taskFilter)),
  )
  const tasksByDate = new Map<string, Task[]>()
  for (const task of filtered)
    if (task.plannedDate !== null) {
      const list = tasksByDate.get(task.plannedDate) ?? []
      list.push(task)
      tasksByDate.set(task.plannedDate, list)
    }
  const reminders = calendarReminders(data).filter(
      (item) => !item.archived && matchesCycle(item.cycleId),
    ),
    remindersByDate = new Map<string, CalendarReminder[]>()
  for (const item of reminders) {
    const list = remindersByDate.get(item.date) ?? []
    list.push(item)
    remindersByDate.set(item.date, list)
  }
  const backlogCount = data.tasks.filter(
    (task) =>
      inBacklog(task, today) &&
      unfinished(task) &&
      !data.cycles.find((cycle) => cycle.id === task.cycleId)?.archivedAt,
  ).length
  const visible =
    view === 'backlog'
      ? filtered.filter(
          (task) =>
            inBacklog(task, today) &&
            (poolShowArchived ||
              !data.cycles.find((cycle) => cycle.id === task.cycleId)?.archivedAt),
        )
      : (tasksByDate.get(date) ?? [])
  visible.sort(
    (a, b) =>
      (a.plannedDate ?? '9999-12-31').localeCompare(b.plannedDate ?? '9999-12-31') ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )
  const durations = actualSecondsBySession(data.sessions, data.segments),
    taskSeconds = new Map<string, number>()
  for (const session of new Map(data.sessions.map((item) => [item.id, item])).values())
    if (session.taskId)
      taskSeconds.set(
        session.taskId,
        (taskSeconds.get(session.taskId) ?? 0) + (durations.get(session.id) ?? 0),
      )
  const shifted = (step: number) =>
    view === 'year'
      ? shiftMonth(date, step * 12)
      : view === 'month'
        ? shiftMonth(date, step)
        : (() => {
            const key = shiftDate(date, step * (view === 'week' ? 7 : 1))
            return validDate(key) ? key : null
          })()
  const previous = shifted(-1),
    next = shifted(1)
  const period =
    view === 'year'
      ? `${date.slice(0, 4)}年`
      : view === 'month'
        ? prettyDate(date, { year: 'numeric', month: 'long' })
        : view === 'week'
          ? `${days[0]} — ${days.at(-1)}`
          : prettyDate(date, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  const calendarProps = { date, today, tasksByDate, remindersByDate, busy, onDate }
  function openSchedule(task: Task, mode: 'schedule' | 'defer' | 'history') {
    setSchedule({ task, mode })
    setGoalEditor(false)
    setExamEditor(false)
  }
  return (
    <div className="planning-workspace">
      <p className="modal-description">
        周一开始，一周一个方向。任务可以先留在待安排池，再按每天的状态慢慢安排。
      </p>
      <div className="planner-view-tabs" role="group" aria-label="日历视图">
        {(
          [
            ['year', '年'],
            ['month', '月'],
            ['week', '周'],
            ['day', '日'],
            ['backlog', `待安排池${backlogCount ? ` · ${backlogCount}` : ''}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            disabled={busy}
            aria-pressed={view === key}
            onClick={() => {
              onView(key)
              setSchedule(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="planner-navigation">
        <div className="planner-period">
          <button
            className="icon-button"
            aria-label="上一个日历周期"
            disabled={busy || !previous || view === 'backlog'}
            onClick={() => previous && onDate(previous)}
          >
            <ChevronLeft size={18} />
          </button>
          <h3>{view === 'backlog' ? '留给下一步的学习任务' : period}</h3>
          <button
            className="icon-button"
            aria-label="下一个日历周期"
            disabled={busy || !next || view === 'backlog'}
            onClick={() => next && onDate(next)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="planner-jump">
          <label>
            定位日期
            <input
              type="date"
              aria-label="日历定位日期"
              min="1900-01-01"
              max="9999-12-31"
              value={date}
              disabled={busy}
              onChange={(e) => {
                if (validDate(e.target.value)) onDate(e.target.value)
              }}
            />
          </label>
          <button className="button subtle" disabled={busy} onClick={() => onDate(today)}>
            今天
          </button>
        </div>
      </div>
      <section className="planner-week-summary" aria-label="所选周总览">
        <div className="planner-summary-heading">
          <div>
            <span className="section-kicker">所选周 · {start}起</span>
            <h3>这一周，按自己的节奏来</h3>
          </div>
          <button
            className="button outline"
            disabled={busy}
            onClick={() => {
              setGoalEditor(!goalEditor)
              setExamEditor(false)
              setSchedule(null)
            }}
          >
            设置本周目标
          </button>
        </div>
        <div className="planner-metrics">
          <div>
            <span>本周总目标</span>
            <strong>{weekPlan ? durationText(weekPlan.goalSeconds) : '尚未设置'}</strong>
          </div>
          <div>
            <span>预计已安排</span>
            <strong>{durationText(overview.plannedSeconds)}</strong>
          </div>
          <div>
            <span>实际学习</span>
            <strong>{durationText(overview.actualSeconds)}</strong>
          </div>
          <div>
            <span>任务完成</span>
            <strong>
              {overview.completed}
              <small> / {overview.total}</small>
            </strong>
          </div>
        </div>
        {weekPlan?.focus && (
          <p className="planner-focus">
            <BookOpen size={14} />
            {weekPlan.focus}
          </p>
        )}
        {targets.length > 0 && (
          <div className="weekly-target-tags">
            {targets.map((item) => (
              <span key={item.id}>
                {cycleLabel(data, item.cycleId)} · {durationText(item.targetSeconds)}
              </span>
            ))}
          </div>
        )}
        <p className="planning-note">
          总览包含全部科目，不随下方筛选改变。
          {weekPlan
            ? `各科已分配${durationText(allocated)}，总目标可独立调整。`
            : '每天可以安排不同时间，也可以留出休息日。'}
          完成任务不会自动增加实际时长。
        </p>
      </section>
      {goalEditor && (
        <WeekGoalEditor
          key={start}
          data={data}
          start={start}
          run={run}
          busy={busy}
          onDone={() => setGoalEditor(false)}
        />
      )}
      <div className="planner-filters">
        <label className="field">
          考试分类
          <select
            aria-label="日历考试分类"
            disabled={busy}
            value={system}
            onChange={(e) => {
              setSystem(e.target.value)
              setCycleFilter('all')
            }}
          >
            <option value="all">全部考试</option>
            <option value="cpa">CPA</option>
            <option value="tax">税务师</option>
          </select>
        </label>
        <label className="field">
          年度科目
          <select
            aria-label="日历年度科目"
            disabled={busy}
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value)}
          >
            <option value="all">全部科目</option>
            {cycles.map((cycle) => (
              <option value={cycle.id} key={cycle.id}>
                {cycleLabel(data, cycle.id)}
                {cycle.archivedAt
                  ? '（归档）'
                  : cycle.learningStatus === 'paused'
                    ? '（暂停）'
                    : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          任务状态
          <select
            aria-label="筛选任务状态"
            disabled={busy}
            value={taskFilter}
            onChange={(e) =>
              view === 'backlog' ? setPoolFilter(e.target.value) : setStatusFilter(e.target.value)
            }
          >
            <option value="all">全部状态</option>
            <option value="unfinished">待完成</option>
            {Object.entries(TASK_LABELS).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          任务类型
          <select
            aria-label="筛选任务类型"
            disabled={busy}
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
          >
            <option value="all">全部类型</option>
            <option value="study">普通学习</option>
            <option value="review">复习任务</option>
          </select>
        </label>
      </div>
      <div className="planner-calendar-actions">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setExamEditor(!examEditor)
            setGoalEditor(false)
            setSchedule(null)
          }}
        >
          <CalendarDays size={15} />
          管理考试日期
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => onCreate(view === 'backlog' ? null : date)}
        >
          <Plus size={15} />
          {view === 'backlog' ? '添加待安排任务' : '添加学习任务'}
        </button>
      </div>
      {examEditor && (
        <ExamDatesEditor
          data={data}
          date={date}
          run={run}
          busy={busy}
          onDone={() => setExamEditor(false)}
        />
      )}
      {view === 'year' && (
        <YearCalendar
          {...calendarProps}
          onDate={(value) => {
            onDate(value)
            onView('day')
          }}
          onMonth={(value) => {
            onDate(value)
            onView('month')
          }}
        />
      )}
      {view === 'month' && <MonthCalendar {...calendarProps} />}
      {view === 'week' && (
        <WeekCalendar
          {...calendarProps}
          onDay={(value) => {
            onDate(value)
            onView('day')
          }}
          onCreate={onCreate}
        />
      )}
      {schedule && (
        <TaskScheduleEditor
          key={`${schedule.task.id}-${schedule.mode}`}
          task={schedule.task}
          mode={schedule.mode}
          data={data}
          date={date}
          today={today}
          run={run}
          busy={busy}
          onDone={() => setSchedule(null)}
        />
      )}
      <section
        className="planner-day-detail"
        aria-label={view === 'backlog' ? '待安排任务列表' : '所选日期任务列表'}
      >
        <div className="planner-day-title">
          <h3>
            {view === 'backlog'
              ? '待安排任务'
              : `${prettyDate(date, { month: 'long', day: 'numeric', weekday: 'short' })}的安排`}
          </h3>
          <span>
            {visible.length}项
            {view === 'backlog'
              ? ''
              : ' · 预计' +
                durationText(
                  visible
                    .filter((task) => task.status !== 'cancelled')
                    .reduce((sum, task) => sum + task.estimatedSeconds, 0),
                )}
          </span>
        </div>
        {view === 'backlog' && (
          <p className="planning-note">
            过期未完成任务保留原日期，等你重新安排，不会自动顺延。默认显示待完成任务，可切换状态查看未定日期的历史任务。
          </p>
        )}
        {view === 'backlog' && (
          <label className="archive-toggle">
            <input
              type="checkbox"
              checked={poolShowArchived}
              onChange={(e) => setPoolShowArchived(e.target.checked)}
            />
            显示归档周期中的待安排任务
          </label>
        )}
        {view !== 'backlog' &&
          (remindersByDate.get(date) ?? []).map((item) => (
            <div className="day-exam-reminder" key={item.id}>
              <CalendarDays size={17} />
              <div>
                <strong>{MILESTONE_LABELS[item.kind]}</strong>
                <span>
                  {cycleLabel(data, item.cycleId)}
                  {item.notes ? ` · ${item.notes}` : ''}
                </span>
              </div>
            </div>
          ))}
        <div className="planner-task-list">
          {visible.map((task) => {
            const cycle = data.cycles.find((item) => item.id === task.cycleId)!,
              chapter = data.chapters.find((item) => item.id === task.chapterId),
              archived = !!cycle.archivedAt
            const canDefer =
              unfinished(task) &&
              task.plannedDate !== null &&
              validDate(shiftDate(task.plannedDate, 1))
            return (
              <article
                className={`planner-task ${task.status === 'completed' ? 'done' : ''}`}
                key={task.id}
                aria-label={`计划任务：${task.title}`}
              >
                <button
                  className={`task-check ${task.status === 'completed' ? 'checked' : ''}`}
                  aria-label={`完成计划任务：${task.title}`}
                  aria-pressed={task.status === 'completed'}
                  disabled={busy || task.status === 'cancelled'}
                  onClick={() =>
                    run(
                      () =>
                        study.setTaskStatus(
                          task,
                          task.status === 'completed' ? 'pending' : 'completed',
                        ),
                      task.status === 'completed'
                        ? '任务已恢复为待开始'
                        : '任务已完成，实际时长保持独立',
                    )
                  }
                >
                  {task.status === 'completed' && <Check size={14} />}
                </button>
                <div className="planner-task-content">
                  <div className="planner-task-heading">
                    <strong>{task.title}</strong>
                    <span className={`planner-task-status ${task.status}`}>
                      {TASK_LABELS[task.status]}
                    </span>
                    {task.kind === 'review' && <span className="review-pill">复习</span>}
                  </div>
                  <div className="planner-task-meta">
                    <span>{cycleLabel(data, task.cycleId)}</span>
                    {chapter && (
                      <span>
                        {chapter.title}
                        {chapter.archivedAt ? '（归档）' : ''}
                      </span>
                    )}
                    <span>
                      <Clock3 size={12} />
                      预计 {durationText(task.estimatedSeconds)}
                    </span>
                    <span>实际 {durationText(taskSeconds.get(task.id) ?? 0)}</span>
                  </div>
                  {view === 'backlog' && (
                    <p className="task-original-date">
                      {task.plannedDate
                        ? `原安排：${task.plannedDate} · 待重新安排`
                        : '尚未安排日期'}
                      {archived
                        ? ' · 科目已归档'
                        : cycle.learningStatus === 'paused'
                          ? ' · 科目暂停'
                          : ''}
                    </p>
                  )}
                  <div className="planning-row-actions">
                    <button
                      className="text-button"
                      disabled={busy || archived || task.status === 'cancelled'}
                      aria-label={`开始学习：${task.title}`}
                      onClick={() => onFocus(task)}
                    >
                      开始学习
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      aria-label={`编辑计划任务：${task.title}`}
                      onClick={() => onEdit(task)}
                    >
                      编辑
                    </button>
                    <button
                      className="text-button"
                      disabled={busy || archived}
                      aria-label={`调整日期：${task.title}`}
                      onClick={() => openSchedule(task, 'schedule')}
                    >
                      {task.plannedDate ? '调整日期' : '安排日期'}
                    </button>
                    {task.plannedDate !== null && (
                      <button
                        className="text-button"
                        disabled={busy || archived}
                        aria-label={`移入待安排：${task.title}`}
                        onClick={() =>
                          run(
                            () => planning.scheduleTask(task, null, 'unschedule'),
                            '任务已移入待安排池，原日期已留档',
                          )
                        }
                      >
                        移入待安排
                      </button>
                    )}
                    {canDefer && (
                      <button
                        className="text-button"
                        disabled={busy || archived}
                        aria-label={`延期任务：${task.title}`}
                        onClick={() => openSchedule(task, 'defer')}
                      >
                        延期
                      </button>
                    )}
                    <button
                      className="text-button"
                      disabled={busy}
                      aria-label={`安排记录：${task.title}`}
                      onClick={() => openSchedule(task, 'history')}
                    >
                      安排记录
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
        {!visible.length && (
          <div className="planning-empty">
            <BookOpen size={28} />
            <h4>{view === 'backlog' ? '暂时没有待安排任务' : '这一天可以慢慢安排'}</h4>
            <p>计划可以灵活，进步一直算数。</p>
          </div>
        )}
      </section>
    </div>
  )
}
