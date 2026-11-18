import { useRef, useState, type FormEvent } from 'react'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
import type { CycleExamStatus, ExamMilestone, MilestoneKind } from '../../domain/models'
import { MILESTONE_LABELS } from '../../domain/models'
import { planning } from '../../services/planning'
import { calendarReminders, cycleLabel } from './view'

export function ExamDatesEditor({
  data,
  date,
  run,
  busy,
  onDone,
}: {
  data: Snapshot
  date: string
  run: Runner
  busy: boolean
  onDone: () => void
}) {
  const cycles = [...data.cycles].sort((a, b) =>
    cycleLabel(data, a.id).localeCompare(cycleLabel(data, b.id)),
  )
  const initialCycle = cycles.find((item) => !item.archivedAt)?.id ?? cycles[0]?.id ?? ''
  const [cycleId, setCycleId] = useState(initialCycle),
    [kind, setKind] = useState<MilestoneKind | 'exam'>('registration_open')
  const initial = data.examMilestones.find(
    (item) => item.cycleId === initialCycle && item.kind === 'registration_open',
  )
  const [value, setValue] = useState(initial?.date ?? date),
    [notes, setNotes] = useState(initial?.notes ?? '')
  const [base, setBase] = useState<ExamMilestone | undefined>(initial)
  const [exam, setExam] = useState<CycleExamStatus | undefined>(() =>
    data.cycleStatuses.find((item) => item.id === initialCycle),
  )
  const [showArchived, setShowArchived] = useState(false)
  const operationId = useRef(crypto.randomUUID())
  function select(id: string, type: MilestoneKind | 'exam') {
    setCycleId(id)
    setKind(type)
    operationId.current = crypto.randomUUID()
    const status = data.cycleStatuses.find((item) => item.id === id),
      item = data.examMilestones.find((item) => item.cycleId === id && item.kind === type)
    setExam(status)
    setBase(item)
    setValue(type === 'exam' ? (status?.examDate ?? '') : (item?.date ?? date))
    setNotes(type === 'exam' ? (status?.notes ?? '') : (item?.notes ?? ''))
  }
  const archivedCycle = !!data.cycles.find((item) => item.id === cycleId)?.archivedAt
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      await run(
        async () => {
          if (kind === 'exam') {
            if (!exam) throw new Error('请先选择有效的年度科目')
            await planning.setExamDate(cycleId, value || null, exam)
          } else
            await planning.saveMilestone(
              { cycleId, kind, date: value, notes },
              base,
              operationId.current,
            )
        },
        kind === 'exam' ? '考试日期已与科目档案同步，其他状态保持不变' : '考试日期提醒已保存',
      )
    )
      onDone()
  }
  return (
    <section className="planning-editor" aria-label="管理考试日期">
      <h3>重要日期，由你手动维护</h3>
      <p className="planning-note">
        报名、缴费、准考证、考试和成绩日期分别记录。提醒不计入学习任务或学习时长。
      </p>
      <form onSubmit={save} noValidate aria-label="编辑考试日期">
        <fieldset disabled={busy}>
          <div className="form-columns">
            <label className="field">
              年度科目
              <select
                aria-label="日期所属年度科目"
                value={cycleId}
                onChange={(e) => select(e.target.value, kind)}
              >
                <option value="" disabled>
                  选择科目
                </option>
                {cycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycleLabel(data, cycle.id)}
                    {cycle.archivedAt ? '（已归档）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              日期节点
              <select
                aria-label="考试日期节点"
                value={kind}
                onChange={(e) => select(cycleId, e.target.value as MilestoneKind | 'exam')}
              >
                {Object.entries(MILESTONE_LABELS).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-columns">
            <label className="field">
              日期
              <input
                type="date"
                aria-label="节点日期"
                min="1900-01-01"
                max="9999-12-31"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <label className="field">
              日期说明
              <textarea
                aria-label="日期说明"
                maxLength={2000}
                rows={2}
                value={notes}
                readOnly={kind === 'exam'}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
          {kind === 'exam' && (
            <p className="planning-note">
              考试日期与科目档案共用一份记录，空日期表示清除。考试备注在科目档案中维护，报名及通过状态不会联动。
            </p>
          )}
          {archivedCycle && (
            <p className="planning-note">该周期已归档，查看历史后请先恢复周期再修改日期。</p>
          )}
          <div className="planning-editor-actions">
            <button type="button" className="button subtle" onClick={onDone}>
              关闭日期管理
            </button>
            <button type="submit" className="button primary" disabled={archivedCycle || !cycleId}>
              {base?.archivedAt && kind !== 'exam' ? '保存并启用日期提醒' : '保存日期提醒'}
            </button>
          </div>
        </fieldset>
      </form>
      <label className="archive-toggle">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        显示停用的日期提醒
      </label>
      <div className="exam-reminder-list">
        {calendarReminders(data)
          .filter((item) => item.cycleId === cycleId && (showArchived || !item.archived))
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((item) => (
            <article key={item.id}>
              <div>
                <strong>
                  {MILESTONE_LABELS[item.kind]} · {item.date}
                </strong>
                <small>
                  {item.notes}
                  {item.archived ? ' · 已停用' : ''}
                </small>
              </div>
              <div className="planning-row-actions">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => select(item.cycleId, item.kind)}
                >
                  编辑{MILESTONE_LABELS[item.kind]}
                </button>
                {item.kind !== 'exam' && (
                  <button
                    className="text-button"
                    disabled={busy || archivedCycle}
                    onClick={() => {
                      const record = data.examMilestones.find((event) => event.id === item.id)!
                      run(
                        () => planning.archiveMilestone(record, !item.archived),
                        item.archived ? '日期提醒已恢复' : '日期提醒已停用，历史保留',
                      )
                    }}
                  >
                    {item.archived ? '恢复' : '停用'}
                  </button>
                )}
              </div>
            </article>
          ))}
        {!calendarReminders(data).some(
          (item) => item.cycleId === cycleId && (showArchived || !item.archived),
        ) && <p className="planning-empty">还没有本周期的日期提醒。</p>}
      </div>
    </section>
  )
}
