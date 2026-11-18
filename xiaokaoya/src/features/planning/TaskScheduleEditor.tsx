import { useRef, useState, useEffect, type FormEvent } from 'react'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
import type { Task } from '../../domain/models'
import { SCHEDULE_LABELS } from '../../domain/models'
import { shiftDate, validDate } from '../../domain/dates'
import { planning } from '../../services/planning'

export function TaskScheduleEditor({
  task,
  mode,
  data,
  date,
  today,
  run,
  busy,
  onDone,
}: {
  task: Task
  mode: 'schedule' | 'defer' | 'history'
  data: Snapshot
  date: string
  today: string
  run: Runner
  busy: boolean
  onDone: () => void
}) {
  const anchor = task.plannedDate && task.plannedDate > today ? task.plannedDate : today
  const suggested = mode === 'defer' ? shiftDate(anchor, 1) : (task.plannedDate ?? date)
  const [target, setTarget] = useState(validDate(suggested) ? suggested : '')
  const [note, setNote] = useState(''),
    operationId = useRef(crypto.randomUUID())
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    section.current?.scrollIntoView({ block: 'start' })
  }, [])
  const history = data.taskScheduleHistory
    .filter((item) => item.taskId === task.id)
    .sort((a, b) => b.taskRevision - a.taskRevision)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      await run(
        () =>
          planning.scheduleTask(
            task,
            target,
            mode === 'defer' ? 'defer' : 'schedule',
            note,
            operationId.current,
          ),
        mode === 'defer'
          ? '任务已延期，原日期和变更记录保留'
          : '任务日期已调整，实际学习记录保持不变',
      )
    )
      onDone()
  }
  return (
    <section className="planning-editor" aria-label="任务日期安排" ref={section}>
      <h3>
        {mode === 'history'
          ? '任务安排记录'
          : mode === 'defer'
            ? '为任务留一个新的时间'
            : '安排学习日期'}
      </h3>
      <p className="planning-note">
        {task.title} · 当前{task.plannedDate ?? '未定日期'}
      </p>
      {mode !== 'history' && (
        <form onSubmit={save} aria-label="调整任务日期" noValidate>
          <fieldset disabled={busy}>
            <div className="form-columns">
              <label className="field">
                目标日期
                <input
                  type="date"
                  aria-label="安排目标日期"
                  min="1900-01-01"
                  max="9999-12-31"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              <label className="field">
                调整说明（选填）
                <input
                  aria-label="日期调整说明"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>
            <p className="planning-note">
              移动的是同一条任务，不会复制任务，也不会把预计时长计入实际学习。
            </p>
            <div className="planning-editor-actions">
              <button className="button subtle" type="button" onClick={onDone}>
                取消安排
              </button>
              <button className="button primary" type="submit">
                {mode === 'defer' ? '确认延期' : '确认安排日期'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <div className="schedule-history">
        <h4>日期变更历史</h4>
        {history.length ? (
          <ol>
            {history.map((item) => (
              <li key={item.id}>
                <strong>{SCHEDULE_LABELS[item.action]}</strong>
                <span>
                  {item.fromDate ?? '未定日期'} → {item.toDate ?? '未定日期'}
                </span>
                {item.note && <span>{item.note}</span>}
                <small>
                  {new Date(item.changedAt).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    hour12: false,
                  })}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="planning-note">还没有日期调整记录。</p>
        )}
      </div>
      {mode === 'history' && (
        <button className="button subtle" disabled={busy} onClick={onDone}>
          关闭安排记录
        </button>
      )}
    </section>
  )
}
