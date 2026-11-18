import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
import { focus } from '../../services/focus'
import { study } from '../../services/study'
import { clockText, intervalMs, unfinishedFocus } from '../../domain/learning-time'
import { Companion, companions } from '../../companions/Companion'
import { companionVisualState } from '../../companions/state'
import { EncouragementCard } from '../../companions/EncouragementCard'
import { cycleLabel } from '../planning/view'
import { durationText, todayKey } from '../../domain/dates'
import './learning.css'
import type { FocusTimer } from '../../domain/models'

export function StartFocusForm({
  data,
  run,
  busy,
  initialTaskId,
  initialTimer,
  onStarted,
}: {
  data: Snapshot
  run: Runner
  busy: boolean
  initialTaskId?: string
  initialTimer?: FocusTimer
  onStarted: (id: string) => void
}) {
  const initial = data.tasks.find(
    (t) => t.id === (initialTimer ? initialTimer.taskId : initialTaskId),
  )
  const choices = data.cycles.filter((c) => !c.archivedAt)
  const [cycleId, setCycle] = useState(
    initialTimer?.cycleId ?? initial?.cycleId ?? choices[0]?.id ?? '',
  )
  const [taskId, setTask] = useState(
    initialTimer ? (initialTimer.taskId ?? '') : (initial?.id ?? ''),
  )
  const [chapterId, setChapter] = useState(
    initialTimer ? (initialTimer.chapterId ?? '') : (initial?.chapterId ?? ''),
  )
  const [minutes, setMinutes] = useState('25'),
    [seconds, setSeconds] = useState('0')
  const operationId = useRef(crypto.randomUUID())
  const task = data.tasks.find((t) => t.id === taskId)
  async function start(event: FormEvent) {
    event.preventDefault()
    let id = ''
    if (
      await run(async () => {
        if (
          !Number.isInteger(Number(minutes)) ||
          Number(minutes) < 0 ||
          !Number.isInteger(Number(seconds)) ||
          Number(seconds) < 0 ||
          Number(seconds) > 59
        )
          throw new Error('请填写有效的整数分钟，以及0—59秒')
        id = (
          await focus.start(
            {
              cycleId,
              taskId: taskId || null,
              chapterId: chapterId || null,
              targetSeconds: Number(minutes) * 60 + Number(seconds),
            },
            operationId.current,
          )
        ).id
      }, '倒计时已开始，按自己的节奏学习')
    )
      onStarted(id)
  }
  return (
    <form onSubmit={start} aria-label="开始任务倒计时" noValidate>
      <p className="modal-description">
        选一个小目标，让伙伴陪你专注一段时间。暂停不计时，到时等你确认。
      </p>
      <fieldset disabled={busy}>
        <div className="form-columns">
          <label className="field">
            学习科目
            <select
              aria-label="计时科目"
              value={cycleId}
              onChange={(e) => {
                setCycle(e.target.value)
                setTask('')
                setChapter('')
              }}
            >
              <option value="">选择科目</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {cycleLabel(data, c.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            关联任务（选填）
            <select
              aria-label="计时关联任务"
              value={taskId}
              onChange={(e) => {
                setTask(e.target.value)
                setChapter(data.tasks.find((t) => t.id === e.target.value)?.chapterId ?? '')
              }}
            >
              <option value="">不关联任务</option>
              {data.tasks
                .filter((t) => t.cycleId === cycleId && t.status !== 'cancelled')
                .map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <label className="field">
          关联章节（选填）
          <select
            aria-label="计时关联章节"
            value={chapterId}
            onChange={(e) => setChapter(e.target.value)}
          >
            <option value="">不关联章节</option>
            {data.chapters
              .filter((c) => c.cycleId === cycleId && !c.archivedAt)
              .map((c) => (
                <option value={c.id} key={c.id}>
                  {c.title}
                </option>
              ))}
          </select>
        </label>
        <div className="focus-presets" role="group" aria-label="倒计时预设">
          {[25, 45, 60].map((m) => (
            <button
              className="button outline"
              type="button"
              key={m}
              onClick={() => {
                setMinutes(String(m))
                setSeconds('0')
              }}
            >
              {m}分钟
            </button>
          ))}
        </div>
        <div className="form-columns">
          <label className="field">
            自定义分钟
            <input
              type="number"
              min="0"
              max="480"
              step="1"
              aria-label="倒计时分钟"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label className="field">
            加上秒数
            <input
              type="number"
              min="0"
              max="59"
              step="1"
              aria-label="倒计时秒数"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
            />
          </label>
        </div>
        <p className="learning-hint">
          本次目标可设1秒—8小时。
          {task ? `任务预计${durationText(task.estimatedSeconds)}，预计值保持独立。` : ''}
          只有核对保存的实际片段才计入学习。
        </p>
        <button className="button primary" type="submit" disabled={!choices.length}>
          开始学习
        </button>
        {!choices.length && <p className="learning-hint">请先选择一个年度科目。</p>}
      </fieldset>
    </form>
  )
}
const reasons: Record<string, string> = {
  started: '正在专注，慢慢来就很好',
  resumed: '从这一刻继续，休息时间不计入',
  paused: '暂停休息中，等待你继续',
  stopped: '本段已结束，请核对有效时长',
  due: '倒计时结束啦！核对后保存，任务由你勾选完成',
  lock: '锁屏已暂停，请核对后继续或保存',
  sleep: '电脑休眠已暂停，请核对后继续或保存',
  exit: '退出前已保存检查点，请核对',
  interrupted: '检测到中断，只保留可靠检查点，请核对',
  clock: '系统时间发生变化，只保留可靠检查点，请核对',
  restore: '备份中的计时已隔离，请核对后继续或保存',
  backup: '打开备份前已暂停，请核对后继续或保存',
  'write-failed': '保存检查点遇到问题，请核对',
}
export function FocusPanel({
  data,
  run,
  busy,
  initialTaskId,
}: {
  data: Snapshot
  run: Runner
  busy: boolean
  initialTaskId?: string
}) {
  const active = data.focusTimers.find(unfinishedFocus)
  const [selected, setSelected] = useState(active?.id ?? '')
  const [newRun, setNewRun] = useState(!active)
  const [lastRun, setLastRun] = useState<FocusTimer | undefined>()
  const [notes, setNotes] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [discard, setDiscard] = useState(false)
  const current = active ?? data.focusTimers.find((t) => t.id === selected)
  const timer = current ? focus.preview(current) : null
  const total = timer ? intervalMs(timer.intervals) / 1000 : 0
  const task = data.tasks.find((t) => t.id === current?.taskId)
  const [taskCompleted, setTaskCompleted] = useState<boolean | null>(null)
  useEffect(() => setTaskCompleted(null), [task?.revision, task?.id])
  if ((newRun && !active) || !current || !timer)
    return (
      <StartFocusForm
        data={data}
        run={run}
        busy={busy}
        initialTaskId={initialTaskId}
        initialTimer={lastRun}
        onStarted={(id) => {
          setSelected(id)
          setNewRun(false)
          setNotes('')
          setConfirmed(false)
          setDiscard(false)
        }}
      />
    )
  const state = companionVisualState(timer, task?.status === 'completed' ? 'celebrate' : 'idle')
  return (
    <div className="focus-panel">
      <div className={`focus-face ${timer.status}`}>
        <Companion id={data.preferences?.companionId ?? 'duck'} state={state} interactive />
        <div>
          <span className="learning-eyebrow">{cycleLabel(data, timer.cycleId)}</span>
          <h3>{task?.title ?? '我的专注时光'}</h3>
          <p role="status">
            {timer.status === 'saved'
              ? '本次实际时长已保存。任务由你单独勾选，也可以再学一段。'
              : timer.status === 'discarded'
                ? '本次工作记录已保留为作废，未计入实际学习。'
                : reasons[timer.reason]}
          </p>
        </div>
      </div>
      <EncouragementCard
        tasks={data.tasks}
        timers={data.focusTimers}
        today={todayKey()}
        companion={
          companions.find((pet) => pet.id === data.preferences?.companionId) ?? companions[0]
        }
        restoreEpoch={0}
        label="本次学习的小声鼓励"
      />
      <div className="focus-clock" aria-label="倒计时剩余时间">
        {clockText(timer.targetSeconds - total)}
      </div>
      <div className="focus-numbers">
        <span>
          本次目标<strong>{clockText(timer.targetSeconds)}</strong>
        </span>
        <span>
          本次有效陪伴<strong aria-label="本次有效学习时间">{clockText(Math.floor(total))}</strong>
        </span>
        <span>
          保存状态
          <strong>
            {timer.status === 'saved'
              ? '已计入学习'
              : timer.status === 'discarded'
                ? '已作废'
                : '尚未计入学习'}
          </strong>
        </span>
      </div>
      {timer.status === 'running' ? (
        <div className="learning-actions">
          <button
            className="button outline"
            disabled={busy}
            onClick={() => run(() => focus.pause(timer.id), '已暂停，休息不计时')}
          >
            暂停休息
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => run(() => focus.pause(timer.id, 'stopped'), '本段已结束，请核对保存')}
          >
            结束本段
          </button>
        </div>
      ) : null}
      {['paused', 'review'].includes(timer.status) && (
        <>
          <p className="learning-hint">
            暂停与等待时间未计入。异常中断保留最后可靠检查点；倒计时结束不会自动完成任务。
          </p>
          <div className="learning-actions">
            <button
              className="button outline"
              disabled={busy || total >= timer.targetSeconds}
              onClick={() => run(() => focus.resume(current), '已继续本次学习')}
            >
              继续本次
            </button>
          </div>
          <label className="field">
            学习备注（选填）
            <textarea
              aria-label="本次学习备注"
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label className="learning-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我已核对有效学习片段，确认保存实际时长
          </label>
          <button
            className="button primary"
            disabled={busy || !confirmed || total < 1}
            onClick={() =>
              run(() => focus.save(current, notes), '实际学习已保存；任务完成情况由你单独设置')
            }
          >
            保存实际时长
          </button>
          <div className="focus-discard">
            <label className="learning-check">
              <input
                type="checkbox"
                checked={discard}
                onChange={(e) => setDiscard(e.target.checked)}
              />
              本次不计入学习，保留工作记录并作废
            </label>
            <button
              className="text-button"
              disabled={busy || !discard}
              onClick={() => run(() => focus.discard(current), '本次已作废，没有增加实际时长')}
            >
              作废本次
            </button>
          </div>
        </>
      )}
      {['saved', 'discarded'].includes(timer.status) && (
        <>
          {timer.status === 'saved' && task && (
            <label className="learning-check">
              <input
                type="checkbox"
                aria-label="关联任务已完成"
                checked={taskCompleted ?? task.status === 'completed'}
                disabled={busy || task.status === 'cancelled'}
                onChange={async (e) => {
                  const checked = e.target.checked
                  setTaskCompleted(checked)
                  if (
                    !(await run(
                      () => study.setTaskStatus(task, checked ? 'completed' : 'pending'),
                      '任务状态已保存，实际学习不重复增加',
                    ))
                  )
                    setTaskCompleted(null)
                }}
              />
              关联任务已完成（单独勾选）
            </label>
          )}
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              setLastRun(current)
              setNewRun(true)
              setSelected('')
            }}
          >
            再学一段
          </button>
        </>
      )}
      <details className="focus-intervals">
        <summary>查看有效学习片段 · {timer.intervals.length}段</summary>
        {timer.intervals.length ? (
          timer.intervals.map((p, i) => (
            <p key={i}>
              {new Date(p.startedAt).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })}{' '}
              →{' '}
              {new Date(p.endedAt).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })}
            </p>
          ))
        ) : (
          <p>尚无有效片段。</p>
        )}
      </details>
    </div>
  )
}
