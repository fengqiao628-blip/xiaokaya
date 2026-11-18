import { useState, type FormEvent } from 'react'
import { todayKey } from '../../domain/dates'
import { study } from '../../services/study'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
export function SubjectForm({
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
  const [year, setYear] = useState(String(Number(todayKey().slice(0, 4)) + 1))
  function selectionForYear(value: string) {
    const plan = data.plans.find((p) => p.year === Number(value))
    return new Set(
      data.cycles
        .filter(
          (c) => c.annualPlanId === plan?.id && c.learningStatus !== 'paused' && !c.archivedAt,
        )
        .map((c) => c.subjectId),
    )
  }
  // Initialize before the first paint; background reads must not replace a user's draft.
  const [selected, setSelected] = useState<Set<string>>(() => selectionForYear(year))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (
      await run(
        () => study.selectSubjects(Number(year), [...selected]),
        `${year} 年的科目选择已保存`,
      )
    )
      onDone()
  }
  return (
    <form onSubmit={submit} noValidate>
      <p className="modal-description">
        不用一次选完。可以只选一科，也可以跨考试搭配。取消勾选会暂停该年度科目，已有任务和记录继续保留。
      </p>
      <label className="year-field">
        目标考试年份
        <input
          aria-label="目标考试年份"
          type="number"
          min="1900"
          max="9999"
          value={year}
          onChange={(e) => {
            setYear(e.target.value)
            setSelected(selectionForYear(e.target.value))
          }}
        />
        <span>支持不同年度独立备考</span>
      </label>
      {(['cpa', 'tax'] as const).map((system) => (
        <section className="subject-group" key={system}>
          <h3>
            <span className={`system-pill ${system}`}>{system === 'cpa' ? 'CPA' : '税务师'}</span>
            {system === 'cpa' ? '注册会计师' : '税务师职业资格'}
          </h3>
          <div className="subject-options">
            {data.subjects
              .filter((s) => s.system === system)
              .map((subject) => (
                <label
                  className={`subject-option ${selected.has(subject.id) ? 'chosen' : ''}`}
                  key={subject.id}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(subject.id)}
                    aria-label={`${system === 'cpa' ? 'CPA' : '税务师'} · ${subject.name}`}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous)
                        if (next.has(subject.id)) next.delete(subject.id)
                        else next.add(subject.id)
                        return next
                      })
                    }
                  />
                  <span>
                    {subject.name}
                    {subject.stage === 'comprehensive' && <small>综合阶段 · 试卷一、试卷二</small>}
                  </span>
                </label>
              ))}
          </div>
        </section>
      ))}
      <div className="modal-footer">
        <span>
          已选择 <b>{selected.size}</b> 科，由你决定节奏
        </span>
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? '正在保存…' : '保存科目选择'}
        </button>
      </div>
    </form>
  )
}
