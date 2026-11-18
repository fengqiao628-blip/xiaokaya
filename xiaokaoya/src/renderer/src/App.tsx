import { readDashboard, type Runner } from '../../features/dashboard/readDashboard'
import { SubjectForm } from '../../features/subjects/SubjectForm'
import { SubjectsWorkspace } from '../../features/subjects/SubjectsWorkspace'
import { TaskForm } from '../../features/tasks/TaskForm'
import { Metric, Modal } from '../../components/ui'
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  LayoutDashboard,
  BookOpen,
  PawPrint,
  Settings2,
  Plus,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  RefreshCw,
  Sparkles,
  Clock3,
  CalendarDays,
  CheckCircle2,
  ShieldCheck,
  Pencil,
  Leaf,
  Coffee,
  FolderOpen,
  CircleHelp,
  BarChart3,
} from 'lucide-react'
import { study } from '../../services/study'
import {
  durationText,
  prettyDate,
  shiftDate,
  todayKey,
  weekStart,
  validDate,
} from '../../domain/dates'
import { actualSeconds, encouragement } from '../../domain/statistics'
import { TASK_LABELS, type Task } from '../../domain/models'
import { Companion, companions } from '../../companions/Companion'
import { companionVisualState } from '../../companions/state'
import { EncouragementCard } from '../../companions/EncouragementCard'
import { ExperienceProvider } from '../../companions/ExperienceProvider'
import { ReadButton } from '../../companions/SpeechProvider'
import { ExperienceSettings } from '../../features/quotes/ExperienceSettings'
import { QuotesWorkspace, QuoteSource } from '../../features/quotes/QuotesWorkspace'
import type { DesktopInfo } from '../../shared/identity'
import { db } from '../../data/database'
import { initializeDatabase } from '../../data/backup/bootstrap'
import { backupService } from '../../data/backup/service'
import { BackupPanel } from '../../features/backup/BackupPanel'
import { DatabaseBackup } from 'lucide-react'
import { PlanningWorkspace, type PlannerView } from '../../features/planning/PlanningWorkspace'
import { inBacklog, unfinished } from '../../domain/planning'
import { focus } from '../../services/focus'
import { FocusPanel } from '../../features/learning/FocusPanel'
import { LearningPanel } from '../../features/learning/LearningPanel'
import { StatisticsWorkspace } from '../../features/statistics/StatisticsWorkspace'
import { PracticeWorkspace } from '../../features/practice/PracticeWorkspace'
import { companionSummary } from '../../domain/analytics'
import { clockText, intervalMs, unfinishedFocus } from '../../domain/learning-time'

let startup: Promise<string> | undefined
function StartupGate() {
  const [state, setState] = useState<{ ready: boolean; error: string; warning: string }>({
    ready: false,
    error: '',
    warning: '',
  })
  useEffect(() => {
    let active = true
    startup ??= (async () => {
      await initializeDatabase(db, window.desktop)
      await focus.recover()
      try {
        await backupService().ensureDailySnapshot()
        return ''
      } catch {
        return '自动快照暂未完成，请打开“数据与备份”检查并导出完整备份'
      }
    })()
    startup
      .then((warning) => {
        if (active) setState({ ready: true, error: '', warning })
      })
      .catch((error) => {
        if (active) setState({ ready: false, error: String(error), warning: '' })
      })
    return () => {
      active = false
    }
  }, [])
  if (state.error) return <Failure message={state.error} />
  if (!state.ready)
    return (
      <main className="loading">
        <Companion id="duck" />
        <p>正在检查本机数据与安全快照…</p>
      </main>
    )
  return (
    <>
      {state.warning && (
        <div className="startup-warning" role="alert">
          {state.warning}
        </div>
      )}
      <Dashboard />
    </>
  )
}

class DataBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) return <Failure message={this.state.error.message} />
    return this.props.children
  }
}
function Failure({ message }: { message: string }) {
  return (
    <main className="failure">
      <ShieldCheck size={44} />
      <h1>暂时没能读取学习数据</h1>
      <p>已有数据不会被自动重置。请保留数据目录，再尝试重新打开。</p>
      <pre>{message}</pre>
      <button className="button primary" onClick={() => window.location.reload()}>
        重新读取
      </button>
      <button
        className="button outline"
        onClick={() => window.desktop.backup.openBackupFolder().catch(() => {})}
      >
        打开备份文件夹
      </button>
    </main>
  )
}
export function App() {
  return (
    <DataBoundary>
      <StartupGate />
    </DataBoundary>
  )
}

function Dashboard() {
  const data = useLiveQuery(readDashboard, [])
  const [today, setToday] = useState(todayKey())
  const [date, setDate] = useState(todayKey())
  const [modal, setModal] = useState<
    | 'subjects'
    | 'curriculum'
    | 'planner'
    | 'task'
    | 'companions'
    | 'about'
    | 'backup'
    | 'learning'
    | 'focus'
    | 'statistics'
    | 'quotes'
    | 'practice'
    | null
  >(null)
  const [restoreEpoch, setRestoreEpoch] = useState(0)
  const [curriculumCycleId, setCurriculumCycleId] = useState<string>()
  const [editing, setEditing] = useState<Task | undefined>()
  const [plannerView, setPlannerView] = useState<PlannerView>('week')
  const [taskFromPlanner, setTaskFromPlanner] = useState(false)
  const [newTaskUnscheduled, setNewTaskUnscheduled] = useState(false)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const mutationLock = useRef(false)
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)
  const [desktop, setDesktop] = useState<DesktopInfo>()
  const [fatal, setFatal] = useState('')
  const [focusTask, setFocusTask] = useState<string | undefined>()
  const [timerError, setTimerError] = useState('')
  const [, renderClock] = useState(0)
  const pulseBusy = useRef(false),
    closing = useRef(false),
    backupMode = useRef(false)
  backupMode.current = modal === 'backup'
  const runningFocus = useRef(false)
  runningFocus.current = data?.focusTimers.some((timer) => timer.status === 'running') ?? false
  const confirmedActual = useMemo(
    () => (data ? actualSeconds(data.sessions, data.segments) : 0),
    [data?.sessions, data?.segments],
  )
  const companionTime = useMemo(
    () => (data ? companionSummary(data.sessions, data.segments, today) : { today: 0, total: 0 }),
    [data?.sessions, data?.segments, today],
  )
  useEffect(() => {
    const lifecycle = window.desktop.lifecycle
    const unsubscribe = lifecycle?.listen(async (event) => {
      if (event.kind === 'close' && closing.current) return
      if (event.kind === 'close') closing.current = true
      try {
        await focus.suspend(
          event.kind === 'close' ? 'exit' : event.kind === 'resume' ? 'interrupted' : event.kind,
        )
        if (event.kind === 'close' && event.token) await lifecycle.finishClose(event.token)
      } catch (error) {
        setTimerError(
          `计时保存遇到问题，已停止补算；请保留窗口并处理后重试。${error instanceof Error ? error.message : ''}`,
        )
        if (event.kind === 'close' && event.token)
          await lifecycle.cancelClose(event.token).catch(() => {})
      } finally {
        if (event.kind === 'close') closing.current = false
      }
    })
    lifecycle?.arm().catch((error) => setTimerError(String(error)))
    const interval = window.setInterval(() => {
      if (!runningFocus.current) return
      renderClock((value) => value + 1)
      if (pulseBusy.current || backupMode.current || closing.current) return
      pulseBusy.current = true
      focus
        .pulse()
        .catch((error) =>
          setTimerError(
            `计时检查点未保存，当前计时已停止补算，请核对。${error instanceof Error ? error.message : ''}`,
          ),
        )
        .finally(() => {
          pulseBusy.current = false
        })
    }, 1000)
    return () => {
      window.clearInterval(interval)
      unsubscribe?.()
    }
  }, [])
  useEffect(() => {
    window.desktop
      .getInfo()
      .then(setDesktop)
      .catch((error) => setFatal(String(error)))
    const update = () => setToday(todayKey())
    const timer = window.setInterval(update, 30000)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [])
  useEffect(() => {
    study
      .dailyQuote(today)
      .then(() =>
        backupService()
          .ensureDailySnapshot()
          .catch(() =>
            setToast({ message: '自动快照暂未完成，请打开数据与备份检查', error: true }),
          ),
      )
      .catch((error) => setFatal(String(error)))
  }, [today, restoreEpoch])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 6500)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (mutationLock.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [])
  const run: Runner = async (operation, message) => {
    if (mutationLock.current) return false
    mutationLock.current = true
    setBusy(true)
    try {
      await operation()
      setToast({ message: typeof message === 'function' ? message() : message, error: false })
      return true
    } catch (error) {
      setToast({
        message:
          error instanceof Error && error.name === 'QuotaExceededError'
            ? '本机存储空间不足，输入内容已保留，请处理后重试'
            : error instanceof Error
              ? error.message
              : '保存失败，请保留输入后重试',
        error: true,
      })
      return false
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
  }
  if (fatal) return <Failure message={fatal} />
  if (!data || !data.preferences || !desktop)
    return (
      <main className="loading">
        <Companion id="duck" />
        <p>正在打开你的学习小天地…</p>
      </main>
    )
  const { subjects, cycles, tasks, plans, preferences } = data
  const active = cycles.filter((cycle) => cycle.learningStatus !== 'paused' && !cycle.archivedAt)
  const quote = data.dailyQuotes.find((item) => item.date === today)
  const feedback = encouragement(tasks, today)
  const workingFocus = data.focusTimers.find(unfinishedFocus)
  const focusPreview = workingFocus ? focus.preview(workingFocus) : null
  const companionState = companionVisualState(focusPreview, feedback.state)
  const currentPet = companions.find((item) => item.id === preferences.companionId) ?? companions[0]
  const dayTasks = tasks
    .filter((task) => task.plannedDate === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const visibleTasks = dayTasks.filter(
    (task) =>
      filter === 'all' ||
      (filter === 'done'
        ? task.status === 'completed'
        : !['completed', 'cancelled'].includes(task.status)),
  )
  const done = dayTasks.filter((task) => task.status === 'completed').length
  const estimated = dayTasks
    .filter((task) => task.status !== 'cancelled')
    .reduce((sum, task) => sum + task.estimatedSeconds, 0)
  const week = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart(date), i))
  const actual = confirmedActual
  const newTask = () => {
    setTaskFromPlanner(false)
    setNewTaskUnscheduled(false)
    setEditing(undefined)
    setModal(active.length ? 'task' : 'subjects')
  }
  const openFocus = (task?: Task) => {
    setFocusTask(task?.id)
    setModal('focus')
  }
  const openBackup = () => {
    run(async () => {
      await focus.suspend('backup')
      setModal('backup')
    }, '已打开数据与备份，进行中的计时先保留为待确认')
  }
  function taskSubject(task: Task) {
    return subjects.find((s) => s.id === cycles.find((c) => c.id === task.cycleId)?.subjectId)
  }
  const close = () => {
    if (!busy) {
      setModal(modal === 'task' && taskFromPlanner ? 'planner' : null)
      setEditing(undefined)
    }
  }
  const openCurriculum = (cycleId?: string) => {
    setCurriculumCycleId(cycleId)
    setModal('curriculum')
  }
  const toastView = toast && (
    <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>
      {toast.error ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}
      <span>{toast.message}</span>
      <button aria-label="关闭提示" onClick={() => setToast(null)}>
        <X size={14} />
      </button>
    </div>
  )

  return (
    <ExperienceProvider
      data={data}
      epoch={restoreEpoch}
      suppressed={modal === 'backup'}
      startupText={quote?.text}
    >
      <div className="app-shell">
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(event) => {
              event.preventDefault()
              setModal(null)
            }}
            aria-label="小考鸭首页"
          >
            <img src="./brand.svg" alt="" />
            <span>
              小考鸭<small>双证学习助手</small>
            </span>
          </a>
          <div className="sidebar-caption">我的学习空间</div>
          <nav aria-label="主导航">
            <button className="nav-item active" onClick={() => setModal(null)}>
              <LayoutDashboard size={19} />
              学习总览
              <span className="nav-dot" />
            </button>
            <button className="nav-item" onClick={() => openCurriculum()}>
              <BookOpen size={19} />
              我的科目<span className="nav-count">{active.length}</span>
            </button>
            <button
              className="nav-item"
              aria-label="学习日历与周计划"
              onClick={() => setModal('planner')}
            >
              <CalendarDays size={19} />
              学习日历
              {tasks.some(
                (task) =>
                  inBacklog(task, today) &&
                  unfinished(task) &&
                  !cycles.find((cycle) => cycle.id === task.cycleId)?.archivedAt,
              ) && (
                <span className="nav-count">
                  {
                    tasks.filter(
                      (task) =>
                        inBacklog(task, today) &&
                        unfinished(task) &&
                        !cycles.find((cycle) => cycle.id === task.cycleId)?.archivedAt,
                    ).length
                  }
                </span>
              )}
            </button>
            <button className="nav-item" onClick={() => setModal('learning')}>
              <Clock3 size={19} />
              学习记录与计时
            </button>
            <button className="nav-item" onClick={() => setModal('statistics')}>
              <BarChart3 size={19} />
              学习统计与进度
            </button>
            <button className="nav-item" onClick={() => setModal('practice')}>
              <Pencil size={21} />
              练习、错题与模拟
            </button>
            <button className="nav-item" onClick={() => setModal('companions')}>
              <PawPrint size={19} />
              学习伙伴
            </button>
            <button className="nav-item" onClick={() => setModal('quotes')}>
              <Sparkles size={19} />
              励志语与诗词
            </button>
            <button className="nav-item" onClick={openBackup}>
              <DatabaseBackup size={19} />
              数据与备份
            </button>
          </nav>
          <div className="sidebar-note">
            <Leaf size={21} />
            <strong>按照自己的节奏来</strong>
            <p>
              今天的一点点，
              <br />
              也是很棒的进步。
            </p>
            <span className="note-spark">✧</span>
          </div>
          <div className="sidebar-bottom">
            <button className="nav-item" onClick={() => setModal('about')}>
              <Settings2 size={18} />
              关于与数据
            </button>
            <div className="local-label">
              <span />
              本机保存 · 离线可用
            </div>
          </div>
        </aside>

        <main className="main-content">
          <header className="topbar">
            <div className="breadcrumb">
              我的学习空间 <span>/</span> <b>学习总览</b>
            </div>
            <div className="saved-state" role="status">
              <ShieldCheck size={15} />
              {busy ? '正在保存…' : '已保存在本机'}
              <span className="version-tag">阶段 8 · 验收版</span>
            </div>
          </header>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="sun-dot" />
                {prettyDate(today, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long',
                })}
              </div>
              <h1>
                今天，也向前一小步<span>。</span>
              </h1>
              <p>不着急，把大大的目标交给小小的日常。</p>
            </div>
            <button className="button primary" onClick={newTask} disabled={busy}>
              <Plus size={18} />
              新建学习任务
            </button>
          </section>

          {timerError && !modal && (
            <div className="timer-error" role="alert">
              {timerError}
              <button
                className="text-button"
                onClick={() => {
                  setTimerError('')
                  setModal('focus')
                }}
              >
                核对本次计时
              </button>
            </div>
          )}
          {focusPreview && (
            <section className="focus-banner" aria-label="当前陪伴计时">
              <div>
                <strong>
                  {focusPreview.status === 'running' ? '学习中' : '本次等待核对'} ·{' '}
                  {clockText(
                    focusPreview.targetSeconds - intervalMs(focusPreview.intervals) / 1000,
                  )}
                </strong>
                <p>
                  有效陪伴 {clockText(Math.floor(intervalMs(focusPreview.intervals) / 1000))} ·
                  核对保存后才进入实际学习
                </p>
              </div>
              <button className="button outline" onClick={() => openFocus()}>
                查看本次计时
              </button>
            </section>
          )}
          <section className="hero-card" aria-label="每日陪伴">
            <div className="hero-copy">
              <div className="section-kicker">
                <Sparkles size={15} />
                给今天的你
              </div>
              <blockquote>{quote?.text ?? '正在为今天挑选一句温柔的话…'}</blockquote>
              <QuoteSource source={quote?.attribution} />
              <div className="hero-actions">
                <span className="daily-tag">每日一句</span>
                <ReadButton text={quote?.text ?? ''} label="朗读每日一句" />
                <span className="quote-date">每天一句，慢慢积攒力量</span>
                <button
                  className="icon-button"
                  title="换一句，当天会保存选择"
                  aria-label="换一句励志语"
                  disabled={busy || !quote}
                  onClick={() =>
                    run(() => study.dailyQuote(today, true), '换好啦，今天的这句话已保存')
                  }
                >
                  <RefreshCw size={15} />
                </button>
                <button className="text-button" onClick={() => setModal('quotes')}>
                  打开励志语库
                </button>
              </div>
            </div>
            <div className="hero-pet">
              <span className="pet-spark s1">✦</span>
              <span className="pet-spark s2">✧</span>
              <Companion id={preferences.companionId} state={companionState} interactive />
              <button className="pet-name" onClick={() => setModal('companions')}>
                {currentPet.name}陪着你 <ChevronRight size={13} />
              </button>
            </div>
          </section>

          <section className="metrics" aria-label="学习概况">
            <Metric
              icon={<BookOpen size={20} />}
              color="mint"
              title="今日学习任务"
              value={String(
                tasks.filter((t) => t.plannedDate === today && t.status !== 'cancelled').length,
              )}
              unit="项"
              note="小任务，慢慢完成"
            />
            <Metric
              icon={<CheckCircle2 size={20} />}
              color="purple"
              title="今日已完成"
              value={String(
                tasks.filter((t) => t.plannedDate === today && t.status === 'completed').length,
              )}
              unit="项"
              note="每一份进步都算数"
            />
            <Metric
              icon={<Clock3 size={20} />}
              color="peach"
              title="累计实际学习"
              value={String(actual > 0 && actual < 60 ? actual : Math.floor(actual / 60))}
              unit={actual > 0 && actual < 60 ? '秒' : '分钟'}
              note={data.sessions.length ? '来自实际学习记录' : '尚未登记实际学习记录'}
            />
            <Metric
              icon={<CalendarDays size={20} />}
              color="blue"
              title="正在准备的科目"
              value={String(active.length)}
              unit="科"
              note="由你自由选择与安排"
            />
          </section>

          <section className="home-companion-totals" aria-label="已确认伙伴陪伴时间">
            <PawPrint size={23} />
            <div>
              今日陪伴
              <strong data-testid="today-companion-time">
                {durationText(companionTime.today)}
              </strong>
            </div>
            <div>
              累计陪伴
              <strong data-testid="total-companion-time">
                {durationText(companionTime.total)}
              </strong>
            </div>
            <small>已包含在实际学习中，手动记录单独统计。</small>
            <button className="text-button" onClick={() => setModal('statistics')}>
              查看学习统计 <ArrowUpRight size={14} />
            </button>
          </section>

          <div className="content-grid">
            <div className="left-column">
              <section className="card task-card">
                <div className="card-heading">
                  <div>
                    <h2>
                      我的学习安排 <span className="subtle-count">{dayTasks.length}</span>
                    </h2>
                    <p>给今天留一点成长的时间</p>
                  </div>
                  <button className="text-button" onClick={newTask}>
                    添加任务 <Plus size={15} />
                  </button>
                </div>
                <div className="week-toolbar">
                  <div className="week-label">
                    <CalendarDays size={15} />
                    {prettyDate(week[0], { month: 'long', day: 'numeric' })} —{' '}
                    {prettyDate(week[6], { month: 'long', day: 'numeric' })}
                  </div>
                  <div className="week-actions">
                    <button className="text-button small" onClick={() => setDate(today)}>
                      今天
                    </button>
                    <button
                      className="icon-button"
                      aria-label="上一周"
                      disabled={!validDate(shiftDate(date, -7))}
                      onClick={() => setDate(shiftDate(date, -7))}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="下一周"
                      disabled={!validDate(shiftDate(date, 7))}
                      onClick={() => setDate(shiftDate(date, 7))}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="week-strip">
                  {week.map((key, i) => (
                    <button
                      key={key}
                      aria-label={`选择 ${key}`}
                      disabled={!validDate(key)}
                      aria-pressed={key === date}
                      className={`day-button ${key === date ? 'selected' : ''} ${key === today ? 'today' : ''}`}
                      onClick={() => setDate(key)}
                    >
                      <span>{['一', '二', '三', '四', '五', '六', '日'][i]}</span>
                      <strong>{Number(key.slice(-2))}</strong>
                      <i
                        className={
                          tasks.some((t) => t.plannedDate === key && t.status !== 'cancelled')
                            ? 'has-tasks'
                            : ''
                        }
                      />
                    </button>
                  ))}
                </div>
                <div className="task-controls">
                  <div className="segmented" aria-label="任务筛选">
                    {[
                      ['all', '全部'],
                      ['todo', '待完成'],
                      ['done', '已完成'],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        aria-pressed={filter === key}
                        className={filter === key ? 'selected' : ''}
                        onClick={() => setFilter(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <input
                    className="date-picker"
                    aria-label="查看任务日期"
                    type="date"
                    min="1900-01-01"
                    max="9999-12-31"
                    value={date}
                    onChange={(event) => {
                      if (event.target.value && event.target.validity.valid)
                        setDate(event.target.value)
                    }}
                  />
                </div>
                <div className="task-list">
                  {visibleTasks.length ? (
                    visibleTasks.map((task) => {
                      const subject = taskSubject(task)
                      return (
                        <article
                          className={`task-row ${task.status === 'completed' ? 'task-done' : ''}`}
                          key={task.id}
                          data-testid="task-row"
                        >
                          <button
                            className={`task-check ${task.status === 'completed' ? 'checked' : ''}`}
                            aria-label={`${task.status === 'completed' ? '撤销完成' : '完成任务'}：${task.title}`}
                            disabled={busy || task.status === 'cancelled'}
                            onClick={() =>
                              run(
                                () =>
                                  study.setTaskStatus(
                                    task,
                                    task.status === 'completed' ? 'pending' : 'completed',
                                  ),
                                task.status === 'completed'
                                  ? '已放回待开始列表'
                                  : '小目标完成啦！任务状态已保存，实际时长单独记录。',
                              )
                            }
                          >
                            {task.status === 'completed' && <Check size={15} />}
                          </button>
                          <div className="task-copy">
                            <div className="task-title">{task.title}</div>
                            <div className="task-meta">
                              <span className={`subject-tag ${subject?.system ?? ''}`}>
                                {subject?.system === 'cpa' ? 'CPA' : '税务师'} ·{' '}
                                {subject?.name ?? '历史科目'}
                              </span>
                              <span>
                                <Clock3 size={12} />
                                {durationText(task.estimatedSeconds)}
                                <span className="estimate-label">预计</span>
                              </span>
                              {task.status !== 'pending' && (
                                <span className="status-tag">{TASK_LABELS[task.status]}</span>
                              )}
                            </div>
                            <button
                              className="text-button task-focus"
                              disabled={
                                busy ||
                                task.status === 'cancelled' ||
                                !!cycles.find((c) => c.id === task.cycleId)?.archivedAt
                              }
                              aria-label={`开始学习：${task.title}`}
                              onClick={() => openFocus(task)}
                            >
                              <Clock3 size={12} />
                              开始学习
                            </button>
                          </div>
                          <button
                            className="icon-button edit-task"
                            aria-label={`编辑任务：${task.title}`}
                            onClick={() => {
                              setEditing(task)
                              setTaskFromPlanner(false)
                              setModal('task')
                            }}
                          >
                            <Pencil size={15} />
                          </button>
                        </article>
                      )
                    })
                  ) : (
                    <div className="empty-tasks">
                      <div className="empty-icon">
                        <BookOpen size={27} />
                        <span>✧</span>
                      </div>
                      <h3>
                        {dayTasks.length ? '这里暂时没有符合条件的任务' : '留一小步，给今天的自己'}
                      </h3>
                      <p>
                        {dayTasks.length
                          ? '试试切换筛选，看看其他安排。'
                          : '可以读几页书，也可以学一节课。按你的节奏就好。'}
                      </p>
                      {!dayTasks.length && (
                        <button className="button outline" onClick={newTask}>
                          <Plus size={15} />
                          安排一个小任务
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="task-summary">
                  <span>
                    <span className="tiny-dot" />
                    {prettyDate(date, { month: 'numeric', day: 'numeric' })} · 已完成 {done}/
                    {dayTasks.filter((t) => t.status !== 'cancelled').length} 项
                  </span>
                  <span>预计 {durationText(estimated)}</span>
                </div>
              </section>
              <div className="gentle-reminder">
                <Coffee size={19} />
                <div>
                  <strong>学习可以灵活，进步一直算数。</strong>
                  <span>普通学习日可以安排 2–4 小时，周末按自己的状态调整。</span>
                </div>
              </div>
            </div>
            <aside className="right-column">
              <section className="card subjects-card">
                <div className="card-heading">
                  <h2>正在准备</h2>
                  <button
                    className="icon-button"
                    aria-label="管理我的科目"
                    onClick={() => setModal('subjects')}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
                {active.length ? (
                  <div className="subject-list">
                    {active.slice(0, 4).map((cycle) => {
                      const subject = subjects.find((s) => s.id === cycle.subjectId)!
                      const year = plans.find((p) => p.id === cycle.annualPlanId)?.year
                      return (
                        <div className="subject-overview" key={cycle.id}>
                          <div className={`subject-symbol ${subject.system}`}>
                            <BookOpen size={18} />
                          </div>
                          <div>
                            <strong>{subject.name}</strong>
                            <span>
                              {subject.system === 'cpa' ? 'CPA' : '税务师'} · {year} 年备考
                            </span>
                          </div>
                          <span className="learning-state">
                            {cycle.learningStatus === 'studying' ? '学习中' : '计划学习'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="empty-subjects">
                    <div className="books-decoration">
                      <BookOpen size={28} />
                    </div>
                    <strong>你的目标，由你选择</strong>
                    <p>
                      CPA 和税务师，自由搭配。
                      <br />
                      先从一门感兴趣的科目开始。
                    </p>
                  </div>
                )}
                <button className="subject-manage" onClick={() => setModal('subjects')}>
                  <Plus size={15} />
                  {active.length
                    ? `管理学习科目${active.length > 4 ? ` · 共${active.length}科` : ''}`
                    : '选择我的科目'}
                </button>
                {active.length > 0 && (
                  <button className="subject-manage" onClick={() => openCurriculum()}>
                    <BookOpen size={15} />
                    查看年度科目档案
                  </button>
                )}
              </section>
              <EncouragementCard
                tasks={tasks}
                timers={data.focusTimers}
                today={today}
                companion={currentPet}
                restoreEpoch={restoreEpoch}
              />
              <section className="test-note">
                <ShieldCheck size={17} />
                <div>
                  <strong>安心使用，从备份开始</strong>
                  <p>伙伴和语句都在本机陪着你。请定期导出完整备份，保存到其他磁盘或设备。</p>
                  <button className="text-button" onClick={openBackup}>
                    打开数据与备份 <ArrowUpRight size={13} />
                  </button>
                </div>
              </section>
            </aside>
          </div>
          <footer className="page-footer">
            <span>一点点学习，一点点靠近。</span>
            <span>
              小考鸭 · 陪你慢慢成长 <Leaf size={12} />
            </span>
          </footer>
        </main>

        {modal && (
          <Modal
            title={
              {
                subjects: '选择你的学习科目',
                curriculum: '我的年度科目档案',
                planner: '学习计划与日历',
                task: editing ? '编辑学习任务' : '安排一个小任务',
                companions: '选一位学习伙伴',
                about: '关于小考鸭与本地数据',
                backup: '数据与备份',
                learning: '学习记录与计时',
                focus: '学习陪伴倒计时',
                statistics: '学习统计与进度',
                quotes: '励志语与诗词',
                practice: '练习、错题与历年报告',
              }[modal]
            }
            onClose={close}
            busy={busy}
          >
            {timerError && (
              <div className="timer-error" role="alert">
                {timerError}
                <button className="text-button" onClick={() => setTimerError('')}>
                  已知晓
                </button>
              </div>
            )}
            {modal === 'subjects' && (
              <SubjectForm data={data} run={run} busy={busy} onDone={close} />
            )}
            {modal === 'quotes' && <QuotesWorkspace data={data} run={run} busy={busy} />}
            {modal === 'practice' && (
              <PracticeWorkspace
                key={restoreEpoch}
                data={data}
                run={run}
                busy={busy}
                onFocus={() => openFocus()}
              />
            )}
            {modal === 'curriculum' && (
              <SubjectsWorkspace
                initialCycleId={curriculumCycleId}
                data={data}
                run={run}
                busy={busy}
                onSelectSubjects={() => setModal('subjects')}
              />
            )}
            {modal === 'planner' && (
              <PlanningWorkspace
                data={data}
                run={run}
                busy={busy}
                onFocus={openFocus}
                today={today}
                date={date}
                onDate={setDate}
                view={plannerView}
                onView={setPlannerView}
                onCreate={(target) => {
                  setEditing(undefined)
                  setTaskFromPlanner(true)
                  setNewTaskUnscheduled(target === null)
                  if (target) setDate(target)
                  setModal(active.length ? 'task' : 'subjects')
                }}
                onEdit={(task) => {
                  setEditing(task)
                  setTaskFromPlanner(true)
                  setNewTaskUnscheduled(task.plannedDate === null)
                  setModal('task')
                }}
              />
            )}
            {modal === 'backup' && (
              <BackupPanel
                run={run}
                busy={busy}
                onRestored={async () => {
                  await focus.recover('restore')
                  setRestoreEpoch((value) => value + 1)
                }}
              />
            )}
            {modal === 'focus' && (
              <FocusPanel
                key={restoreEpoch}
                data={data}
                run={run}
                busy={busy}
                initialTaskId={focusTask}
              />
            )}
            {modal === 'learning' && (
              <LearningPanel data={data} run={run} busy={busy} onFocus={() => openFocus()} />
            )}
            {modal === 'statistics' && (
              <StatisticsWorkspace
                data={data}
                run={run}
                busy={busy}
                today={today}
                onCurriculum={openCurriculum}
                onPlanner={(target) => {
                  setDate(target)
                  setPlannerView('week')
                  setModal('planner')
                }}
              />
            )}
            {modal === 'task' && (
              <TaskForm
                data={data}
                task={editing}
                date={date}
                run={run}
                busy={busy}
                onDone={close}
                initialUnscheduled={newTaskUnscheduled}
              />
            )}
            {modal === 'companions' && (
              <>
                <p className="modal-description">
                  每一位都愿意陪你慢慢学。更换伙伴不会改变学习数据。
                </p>
                <div className="companion-grid">
                  {companions.map((animal) => (
                    <button
                      key={animal.id}
                      aria-label={`选择${animal.name}`}
                      aria-pressed={preferences.companionId === animal.id}
                      disabled={busy}
                      className={`companion-option ${preferences.companionId === animal.id ? 'chosen' : ''}`}
                      onClick={() =>
                        run(() => study.setCompanion(animal.id), `${animal.name}来陪你学习啦`)
                      }
                    >
                      <Companion id={animal.id} />
                      <strong>{animal.name}</strong>
                      <small>{animal.description}</small>
                      {preferences.companionId === animal.id && (
                        <span className="chosen-mark">
                          <Check size={13} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <ExperienceSettings data={data} run={run} busy={busy} />
              </>
            )}
            {modal === 'about' && (
              <div className="about-content">
                <div className="about-brand">
                  <img src="./brand.svg" alt="" />
                  <div>
                    <h3>小考鸭 · 双证学习助手</h3>
                    <p>v{desktop.version} · 第八阶段验收版</p>
                  </div>
                </div>
                <div className="notice">
                  <ShieldCheck size={18} />
                  <p>
                    新增练习记录、错题复习、模拟考试与版本化年度冻结报告。模拟计时复用原有确认学习记录，成绩与掌握程度由你记录。保留Serena自然女声、200条每日语句、120条状态鼓励，以及伙伴阅读、小憩和鼓掌动作。数据库V7新增六张表，完整JSON包含所有新旧记录；升级前保留并验证V6保护备份。旧0.7.4不能直接读取V7，回退需要保留的V6备份。请定期导出完整备份。
                  </p>
                </div>
                <dl>
                  <dt>当前环境</dt>
                  <dd>
                    {desktop.environment === 'production'
                      ? '已安装桌面版（测试数据验收）'
                      : desktop.environment === 'test'
                        ? '自动化测试 · 隔离数据'
                        : '开发预览 · 隔离数据'}
                  </dd>
                  <dt>用户数据目录（userData）</dt>
                  <dd>
                    <code>{desktop.userData}</code>
                  </dd>
                  <dt>会话数据目录（sessionData）</dt>
                  <dd>
                    <code>{desktop.sessionData}</code>
                  </dd>
                </dl>
                <button
                  className="button outline"
                  disabled={busy}
                  onClick={() => run(() => window.desktop.openDataFolder(), '已打开本机数据目录')}
                >
                  <FolderOpen size={16} />
                  打开数据文件夹
                </button>
                <details>
                  <summary>
                    <CircleHelp size={14} />
                    技术与数据说明
                  </summary>
                  <p>
                    正式版本使用固定应用身份、页面来源和默认持久会话。程序与数据分离，普通卸载保留数据。请勿手动删除
                    profile 文件夹。
                  </p>
                  <p>
                    appId：{desktop.appId}
                    <br />
                    数据库：{desktop.databaseName}
                    <br />
                    页面来源：app://xiaokaoya
                  </p>
                  <p>
                    阶段 1—7 为已验收第一期；阶段 8
                    加入错题、模拟考试、冻结报告与模拟长期数据验证。云同步与多设备冲突处理暂不提供。
                  </p>
                </details>
              </div>
            )}
            {/* Native modal dialogs cover every sibling regardless of z-index. */}
            {toastView}
          </Modal>
        )}
        {!modal && toastView}
      </div>
    </ExperienceProvider>
  )
}
