import { useRef, useState, type FormEvent } from 'react'
import { Clock3 } from 'lucide-react'
import { study } from '../../services/study'
import { TASK_LABELS, type Task, type TaskStatus } from '../../domain/models'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
export function TaskForm({
  data,
  task,
  date,
  run,
  busy,
  onDone,
  initialUnscheduled = false,
}: {
  data: Snapshot
  task?: Task
  date: string
  run: Runner
  busy: boolean
  onDone: () => void
  initialUnscheduled?: boolean
}) {
  const operationId = useRef(crypto.randomUUID())
  const options = data.cycles
    .filter((c) => (!c.archivedAt && c.learningStatus !== 'paused') || c.id === task?.cycleId)
    .sort(
      (a, b) =>
        (data.plans.find((plan) => plan.id === b.annualPlanId)?.year ?? 0) -
          (data.plans.find((plan) => plan.id === a.annualPlanId)?.year ?? 0) ||
        (data.subjects.find((subject) => subject.id === a.subjectId)?.order ?? 0) -
          (data.subjects.find((subject) => subject.id === b.subjectId)?.order ?? 0),
    )
  const [cycleId, setCycleId] = useState(task?.cycleId ?? options[0]?.id ?? '')
  const [unscheduled, setUnscheduled] = useState(
    task ? task.plannedDate === null : initialUnscheduled,
  )
  const chapters = data.chapters.filter(
    (chapter) =>
      chapter.cycleId === cycleId && (!chapter.archivedAt || chapter.id === task?.chapterId),
  )
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = {
      cycleId: String(form.get('cycleId') ?? ''),
      title: String(form.get('title') ?? ''),
      plannedDate: unscheduled ? null : String(form.get('plannedDate') ?? ''),
      kind: String(form.get('kind') ?? 'study') as 'study' | 'review',
      estimatedMinutes: Number(form.get('estimatedMinutes')),
      notes: String(form.get('notes') ?? ''),
      chapterId: String(form.get('chapterId') ?? '') || null,
    }
    const okay = await run(
      () => (task ? study.updateTask(task, value) : study.createTask(value, operationId.current)),
      task ? '任务修改已保存' : '小任务安排好啦，慢慢来就很好',
    )
    if (okay) onDone()
  }
  return (
    <form onSubmit={submit} noValidate>
      <p className="modal-description">读几页、看一节、做几道题。计划可以很小，也可以灵活调整。</p>
      <label className="field">
        学习科目
        <select
          name="cycleId"
          aria-label="学习科目"
          value={cycleId}
          onChange={(e) => setCycleId(e.target.value)}
        >
          {options.map((cycle) => {
            const s = data.subjects.find((s) => s.id === cycle.subjectId)!
            const y = data.plans.find((p) => p.id === cycle.annualPlanId)?.year
            return (
              <option
                value={cycle.id}
                key={cycle.id}
                disabled={!!task && cycle.id !== task.cycleId}
              >
                {s.system === 'cpa' ? 'CPA' : '税务师'} · {s.name} · {y}
              </option>
            )
          })}
        </select>
      </label>
      <label className="field">
        关联章节 <span className="optional">选填</span>
        <select
          name="chapterId"
          aria-label="关联章节"
          key={cycleId}
          defaultValue={task?.chapterId ?? ''}
        >
          <option value="">不关联章节</option>
          {chapters.map((chapter) => (
            <option
              key={chapter.id}
              value={chapter.id}
              disabled={!!chapter.archivedAt && chapter.id !== task?.chapterId}
            >
              {chapter.title}
              {chapter.partId
                ? ` · ${data.subjectParts.find((part) => part.id === chapter.partId)?.name ?? ''}`
                : ''}
              {chapter.archivedAt ? '（已归档）' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        想学些什么
        <input
          name="title"
          aria-label="任务内容"
          placeholder="例如：学习会计第一章，整理基础概念"
          defaultValue={task?.title}
          maxLength={160}
          autoFocus
        />
      </label>
      <label className="field">
        任务类型
        <select name="kind" aria-label="任务类型" defaultValue={task?.kind ?? 'study'}>
          <option value="study">普通学习</option>
          <option value="review">复习任务</option>
        </select>
      </label>
      <label className="archive-toggle">
        <input
          type="checkbox"
          aria-label="暂不安排日期，放入待安排池"
          checked={unscheduled}
          onChange={(e) => setUnscheduled(e.target.checked)}
          disabled={busy}
        />
        暂不安排日期，放入待安排池
      </label>
      <div className="form-columns">
        <label className="field">
          安排日期
          <input
            type="date"
            name="plannedDate"
            aria-label="安排日期"
            min="1900-01-01"
            max="9999-12-31"
            defaultValue={task?.plannedDate ?? date}
            disabled={unscheduled || busy}
          />
        </label>
        <label className="field">
          预计时长（分钟）
          <input
            type="number"
            name="estimatedMinutes"
            aria-label="预计时长（分钟）"
            min="1"
            max="1440"
            step="1"
            defaultValue={task ? task.estimatedSeconds / 60 : 60}
          />
        </label>
      </div>
      <label className="field">
        小备注 <span className="optional">选填</span>
        <textarea
          name="notes"
          aria-label="小备注"
          placeholder="给自己留一点提示…"
          defaultValue={task?.notes}
          maxLength={2000}
          rows={3}
        />
      </label>
      <div className="form-hint">
        <Clock3 size={14} />
        这里记录预计时长。完成任务不会自动增加实际学习时长。
      </div>
      {task && (
        <label className="field">
          任务状态
          <select
            aria-label="任务状态"
            value={task.status}
            disabled={busy}
            onChange={(e) =>
              run(
                () => study.setTaskStatus(task, e.target.value as TaskStatus),
                '任务状态已保存，请重新打开编辑窗口继续修改',
              ).then((okay) => {
                if (okay) onDone()
              })
            }
          >
            {Object.entries(TASK_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="modal-footer">
        <button className="button subtle" type="button" onClick={onDone} disabled={busy}>
          再想一想
        </button>
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? '正在保存…' : task ? '保存修改' : '保存学习任务'}
        </button>
      </div>
    </form>
  )
}
