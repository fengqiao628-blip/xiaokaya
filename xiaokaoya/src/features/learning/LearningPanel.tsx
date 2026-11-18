import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
import { learning } from '../../services/learning'
import { actualSecondsBySession } from '../../domain/statistics'
import { todayKey, durationText } from '../../domain/dates'
import { cycleLabel } from '../planning/view'
import { clockText } from '../../domain/learning-time'
import type { StudySession } from '../../domain/models'
import './learning.css'

const toUtc = (value: string) => {
  const n = Date.parse(value + '+08:00')
  return Number.isFinite(n) ? new Date(n).toISOString() : ''
}
const localInput = (at: number) => new Date(at + 8 * 3600000).toISOString().slice(0, 19)
function ManualForm({
  data,
  run,
  busy,
  onDone,
}: {
  data: Snapshot
  run: Runner
  busy: boolean
  onDone: () => void
}) {
  const choices = data.cycles.filter((c) => !c.archivedAt)
  const [cycleId, setCycle] = useState(choices[0]?.id ?? ''),
    [taskId, setTask] = useState(''),
    [chapterId, setChapter] = useState('')
  const [mode, setMode] = useState<'range' | 'duration'>('range'),
    [ack, setAck] = useState(false)
  const id = useRef(crypto.randomUUID())
  const [rangeStart, setRangeStart] = useState(() => localInput(Date.now() - 20 * 60000)),
    [rangeEnd, setRangeEnd] = useState(() => localInput(Date.now()))
  const [learningDate, setLearningDate] = useState(todayKey()),
    [actualMinutes, setActualMinutes] = useState('20')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (
      await run(
        () =>
          learning.manual(
            {
              cycleId,
              taskId: taskId || null,
              chapterId: chapterId || null,
              notes: String(form.get('notes') ?? ''),
              mode,
              date: String(form.get('date') ?? ''),
              seconds: Math.round(Number(form.get('minutes') ?? 0) * 60),
              startedAt: toUtc(String(form.get('start') ?? '')),
              endedAt: toUtc(String(form.get('end') ?? '')),
              overlapAcknowledged: ack,
            },
            id.current,
          ),
        '实际学习记录已保存，预计时长保持不变',
      )
    )
      onDone()
  }
  return (
    <form className="learning-editor" onSubmit={save} aria-label="手动记录实际学习" noValidate>
      <h3>记录实际学习</h3>
      <fieldset disabled={busy}>
        <div className="form-columns">
          <label className="field">
            学习科目
            <select
              aria-label="记录科目"
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
              aria-label="记录关联任务"
              value={taskId}
              onChange={(e) => {
                setTask(e.target.value)
                setChapter(data.tasks.find((t) => t.id === e.target.value)?.chapterId ?? '')
              }}
            >
              <option value="">不关联任务</option>
              {data.tasks
                .filter((t) => t.cycleId === cycleId)
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
            aria-label="记录关联章节"
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
        <label className="field">
          记录方式
          <select
            aria-label="实际时间记录方式"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'range' | 'duration')}
          >
            <option value="range">填写起止时间 · 可检查重叠</option>
            <option value="duration">仅填写日期和时长 · 需知情确认</option>
          </select>
        </label>
        {mode === 'range' ? (
          <>
            <div className="form-columns">
              <label className="field">
                实际开始
                <input
                  type="datetime-local"
                  step="1"
                  name="start"
                  aria-label="实际开始时间"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                />
              </label>
              <label className="field">
                实际结束
                <input
                  type="datetime-local"
                  step="1"
                  name="end"
                  aria-label="实际结束时间"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                />
              </label>
            </div>
            <p className="learning-hint">
              北京时间，支持跨零点，最多24小时；按实际学习日分开保存。与已有时间重叠会阻止保存。
            </p>
          </>
        ) : (
          <>
            <div className="form-columns">
              <label className="field">
                实际学习日期
                <input
                  type="date"
                  name="date"
                  aria-label="实际学习日期"
                  value={learningDate}
                  onChange={(e) => setLearningDate(e.target.value)}
                  min="1900-01-01"
                  max={todayKey()}
                />
              </label>
              <label className="field">
                实际分钟
                <input
                  type="number"
                  name="minutes"
                  aria-label="实际学习分钟"
                  min="0.1"
                  max="1440"
                  step="0.1"
                  value={actualMinutes}
                  onChange={(e) => setActualMinutes(e.target.value)}
                />
              </label>
            </div>
            <label className="learning-check warning">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              仅时长无法检查重叠，我确认没有重复补录已记录的学习时间
            </label>
          </>
        )}
        <label className="field">
          学习备注
          <textarea aria-label="学习记录备注" name="notes" maxLength={2000} />
        </label>
        <div className="learning-actions">
          <button className="button subtle" type="button" onClick={onDone}>
            取消录入
          </button>
          <button className="button primary" type="submit">
            保存实际学习记录
          </button>
        </div>
      </fieldset>
    </form>
  )
}
export function LearningPanel({
  data,
  run,
  busy,
  onFocus,
}: {
  data: Snapshot
  run: Runner
  busy: boolean
  onFocus: () => void
}) {
  const [adding, setAdding] = useState(false),
    [status, setStatus] = useState('all'),
    [cycle, setCycle] = useState('all'),
    [date, setDate] = useState('')
  const [voiding, setVoiding] = useState<StudySession | null>(null),
    [reason, setReason] = useState('')
  const [recordPage, setRecordPage] = useState(0)
  const durations = useMemo(
    () => actualSecondsBySession(data.sessions, data.segments),
    [data.sessions, data.segments],
  )
  const visible = useMemo(
    () =>
      data.sessions
        .filter(
          (s) =>
            (status === 'all' || s.status === status) &&
            (cycle === 'all' || s.cycleId === cycle) &&
            (!date || s.studyDate === date),
        )
        .sort(
          (a, b) =>
            b.studyDate.localeCompare(a.studyDate) || b.createdAt.localeCompare(a.createdAt),
        ),
    [data.sessions, status, cycle, date],
  )
  const pageCount = Math.max(1, Math.ceil(visible.length / 50)),
    pageNumber = Math.min(recordPage, pageCount - 1)
  useEffect(() => setRecordPage(0), [status, cycle, date])
  return (
    <div className="learning-panel">
      <p className="modal-description">
        预计与实际分别记录。只有已确认记录计入实际学习；改任务日期、勾选完成都不会重复增加。
      </p>
      <div className="learning-actions">
        <button className="button primary" disabled={busy} onClick={() => setAdding(!adding)}>
          手动记录学习
        </button>
        <button className="button outline" disabled={busy} onClick={onFocus}>
          开启陪伴倒计时
        </button>
      </div>
      {adding && <ManualForm data={data} run={run} busy={busy} onDone={() => setAdding(false)} />}
      <div className="learning-filters">
        <label className="field">
          记录状态
          <select
            aria-label="学习记录状态筛选"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="confirmed">已确认</option>
            <option value="draft">待确认</option>
            <option value="voided">已作废</option>
          </select>
        </label>
        <label className="field">
          年度科目
          <select
            aria-label="学习记录科目筛选"
            value={cycle}
            onChange={(e) => setCycle(e.target.value)}
          >
            <option value="all">全部科目</option>
            {data.cycles.map((c) => (
              <option value={c.id} key={c.id}>
                {cycleLabel(data, c.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          学习日期
          <input
            type="date"
            aria-label="学习记录日期筛选"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button
          className="text-button"
          onClick={() => {
            setDate('')
            setCycle('all')
            setStatus('all')
          }}
        >
          清除筛选
        </button>
      </div>
      {voiding && (
        <section className="learning-editor" aria-label="作废学习记录">
          <h3>保留原记录并作废</h3>
          <p>作废后这条记录不计入实际学习；重新确认时会检查时间重叠。</p>
          <label className="field">
            作废说明
            <input
              aria-label="学习记录作废说明"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="learning-actions">
            <button className="button subtle" disabled={busy} onClick={() => setVoiding(null)}>
              取消作废
            </button>
            <button
              className="button outline"
              disabled={busy || !reason.trim()}
              onClick={async () => {
                if (
                  await run(
                    () => learning.setStatus(voiding, 'voided', reason),
                    '原学习记录已保留并作废',
                  )
                )
                  setVoiding(null)
              }}
            >
              确认作废记录
            </button>
          </div>
        </section>
      )}
      <div className="learning-actions" aria-label="学习记录分页">
        <span>
          共{visible.length}条 · 第{pageNumber + 1}/{pageCount}页
        </span>
        <button
          className="button subtle"
          disabled={pageNumber === 0}
          onClick={() => setRecordPage(pageNumber - 1)}
        >
          上一页记录
        </button>
        <button
          className="button subtle"
          disabled={pageNumber >= pageCount - 1}
          onClick={() => setRecordPage(pageNumber + 1)}
        >
          下一页记录
        </button>
      </div>
      <div className="learning-list" aria-label="实际学习记录列表">
        {visible.slice(pageNumber * 50, (pageNumber + 1) * 50).map((record) => {
          const pieces = data.segments
            .filter((p) => p.sessionId === record.id)
            .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          const task = data.tasks.find((t) => t.id === record.taskId),
            chapter = data.chapters.find((c) => c.id === record.chapterId)
          return (
            <article
              className={`learning-record ${record.status}`}
              key={record.id}
              aria-label={`学习记录：${record.id}`}
            >
              <div className="learning-record-heading">
                <strong>
                  {record.studyDate} · {cycleLabel(data, record.cycleId)}
                </strong>
                <span className="learning-state">
                  {{ confirmed: '已确认', draft: '待确认', voided: '已作废' }[record.status]}
                </span>
              </div>
              <p className="learning-record-time">
                {durationText(durations.get(record.id) ?? 0)}{' '}
                <small>({clockText(Math.floor(durations.get(record.id) ?? 0))})</small>
                <span>
                  {record.source === 'timer'
                    ? '陪伴计时'
                    : record.source === 'manual'
                      ? '手动录入'
                      : '历史记录'}
                </span>
              </p>
              {task && <p>关联任务：{task.title}</p>}
              {chapter && <p>章节：{chapter.title}</p>}
              {record.notes && <p>{record.notes}</p>}
              {record.timeMode === 'duration_only' && (
                <p className="learning-hint warning">
                  仅时长补录，无法核验时间重叠；原始填写
                  {durationText(record.durationOnlySeconds ?? 0)}。
                </p>
              )}
              {pieces.length > 0 && (
                <details>
                  <summary>实际时间片段 · {pieces.length}段</summary>
                  {pieces.map((p) => (
                    <p key={p.id}>
                      {new Date(p.startedAt).toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        hour12: false,
                      })}{' '}
                      →{' '}
                      {p.endedAt
                        ? new Date(p.endedAt).toLocaleString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                            hour12: false,
                          })
                        : '尚未结束'}
                    </p>
                  ))}
                </details>
              )}
              {record.voidReason && (
                <p className="learning-hint">最近作废说明：{record.voidReason}</p>
              )}
              <div className="learning-actions">
                {record.status !== 'voided' ? (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setVoiding(record)
                      setReason('')
                    }}
                  >
                    作废记录
                  </button>
                ) : null}
                {record.status !== 'confirmed' && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => learning.setStatus(record, 'confirmed'),
                        '记录已确认，已检查时间重叠',
                      )
                    }
                  >
                    重新确认记录
                  </button>
                )}
              </div>
            </article>
          )
        })}
        {!visible.length && (
          <div className="learning-empty">
            还没有符合条件的学习记录。从一次真实的学习开始，慢慢积累。
          </div>
        )}
      </div>
    </div>
  )
}
