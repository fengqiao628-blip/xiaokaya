import { useState, type FormEvent } from 'react'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
import { planning } from '../../services/planning'
import { cycleLabel } from './view'
import { durationText } from '../../domain/dates'

const minutes = (value: string) => {
  const hours = value.trim() ? Number(value) : NaN
  return Number.isFinite(hours) && hours >= 0 && hours <= 168 ? Math.round(hours * 60) : NaN
}
export function WeekGoalEditor({
  data,
  start,
  run,
  busy,
  onDone,
}: {
  data: Snapshot
  start: string
  run: Runner
  busy: boolean
  onDone: () => void
}) {
  const [base] = useState(() => data.weeklyPlans.find((item) => item.weekStart === start))
  const [goal, setGoal] = useState(
    String((base?.goalSeconds ?? data.preferences?.defaultWeeklyGoalSeconds ?? 43200) / 3600),
  )
  const [focus, setFocus] = useState(base?.focus ?? '')
  const existing = data.weeklySubjectTargets.filter((item) => item.weekStart === start)
  const candidates = data.cycles
    .filter((cycle) => !cycle.archivedAt || existing.some((item) => item.cycleId === cycle.id))
    .sort((a, b) => cycleLabel(data, a.id).localeCompare(cycleLabel(data, b.id)))
  const [targets, setTargets] = useState<Record<string, { selected: boolean; hours: string }>>(() =>
    Object.fromEntries(
      candidates.map((cycle) => {
        const old = existing.find((item) => item.cycleId === cycle.id)
        return [
          cycle.id,
          { selected: old?.active ?? false, hours: String((old?.targetSeconds ?? 0) / 3600) },
        ]
      }),
    ),
  )
  const allocated = Object.values(targets)
    .filter((item) => item.selected)
    .reduce(
      (sum, item) => sum + (Number.isFinite(minutes(item.hours)) ? minutes(item.hours) * 60 : 0),
      0,
    )
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      await run(
        () =>
          planning.saveWeek(
            {
              weekStart: start,
              goalMinutes: minutes(goal),
              focus,
              targets: Object.entries(targets)
                .filter(([, item]) => item.selected)
                .map(([cycleId, item]) => ({ cycleId, targetMinutes: minutes(item.hours) })),
            },
            base,
          ),
        '本周目标与科目分配已保存',
      )
    )
      onDone()
  }
  return (
    <form className="planning-editor" aria-label="设置本周学习目标" onSubmit={save} noValidate>
      <h3>一周一个方向，每天灵活安排</h3>
      <p className="planning-note">
        以周一为起点。每天2—4小时只是参考，休息日和周末都可以按自己的节奏安排。
      </p>
      <fieldset disabled={busy}>
        <div className="form-columns">
          <label className="field">
            本周目标（小时）
            <input
              type="number"
              aria-label="本周目标小时"
              min={0}
              max={168}
              step={0.5}
              value={goal}
              autoFocus
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>
          <label className="field">
            本周重点
            <textarea
              aria-label="本周重点"
              maxLength={2000}
              rows={2}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="例如：完成会计第一章，留出一天复习"
            />
          </label>
        </div>
        <h4>选择本周学习科目并分配时间</h4>
        <div className="weekly-target-options">
          {candidates.map((cycle) => {
            const value = targets[cycle.id] ?? { selected: false, hours: '0' }
            return (
              <div
                className={`weekly-target-option ${value.selected ? 'chosen' : ''}`}
                key={cycle.id}
              >
                <label>
                  <input
                    type="checkbox"
                    aria-label={`本周选择：${cycleLabel(data, cycle.id)}`}
                    checked={value.selected}
                    disabled={busy || (!!cycle.archivedAt && !value.selected)}
                    onChange={(e) =>
                      setTargets({
                        ...targets,
                        [cycle.id]: { ...value, selected: e.target.checked },
                      })
                    }
                  />
                  <span>
                    {cycleLabel(data, cycle.id)}
                    {cycle.archivedAt
                      ? '（已归档）'
                      : cycle.learningStatus === 'paused'
                        ? '（暂停）'
                        : ''}
                  </span>
                </label>
                <label className="target-hours">
                  <input
                    type="number"
                    min={0}
                    max={168}
                    step={0.5}
                    aria-label={`科目目标小时：${cycleLabel(data, cycle.id)}`}
                    value={value.hours}
                    disabled={!value.selected || busy || !!cycle.archivedAt}
                    onChange={(e) =>
                      setTargets({ ...targets, [cycle.id]: { ...value, hours: e.target.value } })
                    }
                  />
                  小时
                </label>
              </div>
            )
          })}
          {!candidates.length && (
            <p className="planning-note">先在“我的科目”中选择要备考的科目。</p>
          )}
        </div>
        <p className="planning-note">
          各科已分配：{durationText(allocated)}
          。目标按分钟保存；可以与总目标不同，不会平均分摊到每天。
        </p>
        <div className="planning-editor-actions">
          <button type="button" className="button subtle" onClick={onDone}>
            取消编辑
          </button>
          <button type="submit" className="button primary">
            保存本周目标
          </button>
        </div>
      </fieldset>
    </form>
  )
}
