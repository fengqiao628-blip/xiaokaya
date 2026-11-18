import {
  cloneElement,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type ReactElement,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/database'
import { practice, mockActualSeconds } from '../../services/practice'
import { focus } from '../../services/focus'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
import type {
  PracticeSet,
  MistakeItem,
  MockExam,
  MockExamQuestion,
  QuestionContent,
  ReportSnapshot,
} from '../../domain/practice'
import { MASTERY_LABELS, REVIEW_LABELS, practiceAccuracy } from '../../domain/practice'
import { CHAPTER_LABELS } from '../../domain/models'
import { cycleLabel } from '../planning/view'
import { todayKey, durationText } from '../../domain/dates'
import './practice.css'

type Tab = 'practice' | 'mistakes' | 'exams' | 'reports'
type Props = { data: Snapshot; run: Runner; busy: boolean }
const PAGE_SIZE = 20
const pct = (value: number | null) => (value === null ? '无记录' : `${(value * 100).toFixed(1)}%`)
const field = (f: FormData, key: string) => String(f.get(key) ?? '')
const optional = (f: FormData, key: string) => field(f, key) || null
const number = (f: FormData, key: string) => Number(field(f, key))
const nullableScore = (f: FormData, key: string) => (field(f, key).trim() ? number(f, key) : null)
function form(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  return new FormData(event.currentTarget)
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-label': label })}
    </label>
  )
}
function Actions({ cancel, label = '保存' }: { cancel: () => void; label?: string }) {
  return (
    <div className="learning-actions">
      <button type="submit" className="button primary">
        {label}
      </button>
      <button type="button" className="button ghost" onClick={cancel}>
        返回列表
      </button>
    </div>
  )
}
function QuestionFields({
  previous,
  response = false,
}: {
  previous?: QuestionContent & { response?: string }
  response?: boolean
}) {
  return (
    <>
      <Field label="题干">
        <textarea name="stem" maxLength={20000} defaultValue={previous?.stem} required />
      </Field>
      <Field label="选项（选填）">
        <textarea name="options" maxLength={20000} defaultValue={previous?.options} />
      </Field>
      {response && (
        <Field label="我的作答">
          <textarea name="response" maxLength={20000} defaultValue={previous?.response} />
        </Field>
      )}
      <Field label="参考答案">
        <textarea name="answer" maxLength={20000} defaultValue={previous?.answer} />
      </Field>
      <Field label="解析">
        <textarea name="explanation" maxLength={20000} defaultValue={previous?.explanation} />
      </Field>
    </>
  )
}
function question(f: FormData): QuestionContent {
  return {
    stem: field(f, 'stem'),
    options: field(f, 'options'),
    answer: field(f, 'answer'),
    explanation: field(f, 'explanation'),
  }
}
function ChapterField({
  data,
  cycleId,
  value,
}: {
  data: Snapshot
  cycleId: string
  value?: string | null
}) {
  return (
    <Field label="关联章节（选填）">
      <select name="chapterId" defaultValue={value ?? ''}>
        <option value="">不关联章节</option>
        {data.chapters
          .filter((c) => c.cycleId === cycleId)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.archivedAt ? ' · 已归档' : ''}
            </option>
          ))}
      </select>
    </Field>
  )
}
function SessionField({
  data,
  cycleId,
  value,
}: {
  data: Snapshot
  cycleId: string
  value?: string | null
}) {
  const rows = data.sessions
    .filter((s) => s.cycleId === cycleId && (s.status === 'confirmed' || s.id === value))
    .sort((a, b) => b.studyDate.localeCompare(a.studyDate))
    .slice(0, 100)
  const selected = data.sessions.find((s) => s.id === value && s.cycleId === cycleId)
  if (selected && !rows.some((s) => s.id === selected.id)) rows.push(selected)
  return (
    <Field label="引用已确认学习记录（选填，最近100条）">
      <select name="studySessionId" defaultValue={value ?? ''}>
        <option value="">不引用学习记录</option>
        {rows.map((s) => (
          <option value={s.id} key={s.id}>
            {s.studyDate} · {s.notes || s.id}
            {s.status === 'voided' ? ' · 已作废' : ''}
          </option>
        ))}
      </select>
    </Field>
  )
}
export async function readPracticePage(
  tab: Exclude<Tab, 'reports'>,
  cycleId: string,
  search: string,
  page: number,
  archived: boolean,
) {
  const match = (row: { cycleId: string }) => !cycleId || row.cycleId === cycleId
  if (tab === 'practice') {
    const rows = db.practiceSets
      .orderBy('date')
      .reverse()
      .filter((row) => match(row) && (!search || row.source.includes(search)))
    return {
      count: await rows.count(),
      practices: await rows
        .clone()
        .offset(page * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray(),
      mistakes: [] as MistakeItem[],
      exams: [] as MockExam[],
    }
  }
  if (tab === 'mistakes') {
    const rows = db.mistakeItems
      .orderBy('date')
      .reverse()
      .filter(
        (row) =>
          match(row) &&
          (archived || !row.archivedAt) &&
          (!search || `${row.stem} ${row.reason} ${row.tags.join(' ')}`.includes(search)),
      )
    return {
      count: await rows.count(),
      mistakes: await rows
        .clone()
        .offset(page * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray(),
      practices: [] as PracticeSet[],
      exams: [] as MockExam[],
    }
  }
  const rows = db.mockExams
    .orderBy('date')
    .reverse()
    .filter((row) => match(row) && (!search || row.title.includes(search)))
  return {
    count: await rows.count(),
    exams: await rows
      .clone()
      .offset(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray(),
    practices: [] as PracticeSet[],
    mistakes: [] as MistakeItem[],
  }
}
function PracticeEditor({
  data,
  run,
  busy,
  cycleId,
  previous,
  done,
}: Props & { cycleId: string; previous?: PracticeSet; done: () => void }) {
  const op = useRef(crypto.randomUUID())
  async function save(event: FormEvent<HTMLFormElement>) {
    const f = form(event)
    if (
      await run(
        () =>
          practice.savePractice(
            {
              cycleId,
              chapterId: optional(f, 'chapterId'),
              studySessionId: optional(f, 'studySessionId'),
              date: field(f, 'date'),
              source: field(f, 'source'),
              total: number(f, 'total'),
              correct: number(f, 'correct'),
              wrong: number(f, 'wrong'),
              unanswered: number(f, 'unanswered'),
              notes: field(f, 'notes'),
              status: field(f, 'status') as PracticeSet['status'],
            },
            previous,
            op.current,
          ),
        '练习记录已保存，未增加学习时长',
      )
    )
      done()
  }
  return (
    <form className="practice-editor" aria-label="练习记录表单" onSubmit={save}>
      <h3>{previous ? '编辑练习记录' : '记录一次练习'}</h3>
      <p>总题数须等于答对、答错、未答之和。正确率只统计答对 ÷ 已作答，错题本可以仅收录部分题目。</p>
      <fieldset disabled={busy}>
        <div className="form-columns">
          <Field label="练习日期">
            <input name="date" type="date" defaultValue={previous?.date ?? todayKey()} required />
          </Field>
          <Field label="来源或名称">
            <input name="source" defaultValue={previous?.source} maxLength={300} required />
          </Field>
        </div>
        <ChapterField data={data} cycleId={cycleId} value={previous?.chapterId} />
        <div className="practice-counts">
          {(['total', 'correct', 'wrong', 'unanswered'] as const).map((name, i) => (
            <Field key={name} label={['总题数', '答对', '答错', '未答'][i]}>
              <input
                type="number"
                name={name}
                min={0}
                max={1000000}
                step={1}
                required
                defaultValue={previous?.[name] ?? 0}
              />
            </Field>
          ))}
        </div>
        <SessionField data={data} cycleId={cycleId} value={previous?.studySessionId} />
        <Field label="练习状态">
          <select name="status" defaultValue={previous?.status ?? 'confirmed'}>
            <option value="confirmed">已确认</option>
            <option value="voided">作废（保留原记录）</option>
          </select>
        </Field>
        <Field label="练习备注">
          <textarea name="notes" maxLength={2000} defaultValue={previous?.notes} />
        </Field>
        <Actions cancel={done} label="保存练习记录" />
      </fieldset>
    </form>
  )
}
function MistakeEditor({
  data,
  run,
  busy,
  cycleId,
  previous,
  done,
}: Props & { cycleId: string; previous?: MistakeItem; done: () => void }) {
  const op = useRef(crypto.randomUUID())
  const [practiceSetId, setPracticeSetId] = useState(previous?.practiceSetId ?? '')
  const sets = useLiveQuery(
    () => db.practiceSets.where('cycleId').equals(cycleId).toArray(),
    [cycleId],
  )
  async function save(event: FormEvent<HTMLFormElement>) {
    const f = form(event)
    if (
      await run(
        () =>
          practice.saveMistake(
            {
              ...question(f),
              cycleId,
              chapterId: optional(f, 'chapterId'),
              practiceSetId: optional(f, 'practiceSetId'),
              date: field(f, 'date'),
              reason: field(f, 'reason'),
              tags: field(f, 'tags')
                .split(/[,，]/u)
                .map((t) => t.trim())
                .filter(Boolean),
              mastery: field(f, 'mastery') as MistakeItem['mastery'],
              archivedAt: f.get('archived')
                ? (previous?.archivedAt ?? new Date().toISOString())
                : null,
            },
            previous,
            op.current,
          ),
        '错题已保存，复习历史保持原样',
      )
    )
      done()
  }
  return (
    <form className="practice-editor" aria-label="错题表单" onSubmit={save}>
      <h3>{previous ? '编辑错题' : '收录一道错题'}</h3>
      <fieldset disabled={busy}>
        <Field label="错题日期">
          <input name="date" type="date" required defaultValue={previous?.date ?? todayKey()} />
        </Field>
        <ChapterField data={data} cycleId={cycleId} value={previous?.chapterId} />
        <Field label="关联练习（选填）">
          <select
            name="practiceSetId"
            value={practiceSetId}
            onChange={(e) => setPracticeSetId(e.target.value)}
          >
            <option value="">不关联练习</option>
            {sets?.map((p) => (
              <option value={p.id} key={p.id}>
                {p.date} · {p.source}
              </option>
            ))}
          </select>
        </Field>
        <QuestionFields previous={previous} />
        <Field label="错因">
          <textarea name="reason" maxLength={2000} defaultValue={previous?.reason} />
        </Field>
        <Field label="标签（逗号分隔，最多20个）">
          <input name="tags" defaultValue={previous?.tags.join('，')} />
        </Field>
        <Field label="手动掌握评价">
          <select name="mastery" defaultValue={previous?.mastery ?? 'unreviewed'}>
            {Object.entries(MASTERY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <label>
          <input type="checkbox" name="archived" defaultChecked={!!previous?.archivedAt} />{' '}
          归档此错题，保留复习记录
        </label>
        <p>答对一次不会自动改为已掌握，请按自己的判断评价。</p>
        <Actions cancel={done} label="保存错题" />
      </fieldset>
    </form>
  )
}
function MistakeDetail({
  item,
  run,
  busy,
  done,
}: {
  item: MistakeItem
  run: Runner
  busy: boolean
  done: () => void
}) {
  const reviews = useLiveQuery(
    () => db.mistakeReviews.where('mistakeId').equals(item.id).reverse().toArray(),
    [item.id],
  )
  const op = useRef(crypto.randomUUID()),
    [answerShown, setAnswer] = useState(false)
  const [page, setPage] = useState(0)
  async function save(event: FormEvent<HTMLFormElement>) {
    const f = form(event)
    if (
      await run(
        () =>
          practice.review(
            item,
            {
              date: field(f, 'date'),
              result: field(f, 'result') as 'correct' | 'wrong' | 'uncertain',
              notes: field(f, 'notes'),
            },
            op.current,
          ),
        '复习已记录，已保留本次题目与答案快照',
      )
    )
      op.current = crypto.randomUUID()
  }
  return (
    <section className="practice-editor">
      <button className="text-button" onClick={done}>
        返回列表
      </button>
      <h3>复习错题</h3>
      <p className="question-text">{item.stem}</p>
      <p className="question-text">{item.options}</p>
      <button className="button outline" onClick={() => setAnswer(!answerShown)}>
        {answerShown ? '收起答案' : '查看答案与解析'}
      </button>
      {answerShown && (
        <div className="practice-answer">
          <strong>参考答案</strong>
          <p>{item.answer || '未填写'}</p>
          <strong>解析</strong>
          <p>{item.explanation || '未填写'}</p>
        </div>
      )}
      <form onSubmit={save} aria-label="错题复习表单">
        <fieldset disabled={busy}>
          <div className="form-columns">
            <Field label="复习日期">
              <input name="date" type="date" defaultValue={todayKey()} required />
            </Field>
            <Field label="本次复习结果">
              <select name="result">
                {Object.entries(REVIEW_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="复习备注">
            <textarea name="notes" maxLength={2000} />
          </Field>
          <button className="button primary">记录本次复习</button>
        </fieldset>
      </form>
      <h4>复习历史（保留当时的内容）</h4>
      {!reviews?.length && <p>尚无复习记录</p>}
      {reviews?.slice(page * 20, (page + 1) * 20).map((r) => (
        <details key={r.id} className="practice-history">
          <summary>
            {r.date} · {REVIEW_LABELS[r.result]}
          </summary>
          <p>{r.notes}</p>
          <p className="question-text">当时题干：{r.question.stem}</p>
          <p className="question-text">当时选项：{r.question.options}</p>
          <p className="question-text">当时答案：{r.question.answer}</p>
          <p className="question-text">当时解析：{r.question.explanation}</p>
        </details>
      ))}
      <Pages page={page} count={reviews?.length ?? 0} setPage={setPage} />
    </section>
  )
}
function ExamEditor({
  run,
  busy,
  cycleId,
  previous,
  done,
}: Props & { cycleId: string; previous?: MockExam; done: () => void }) {
  const op = useRef(crypto.randomUUID())
  async function save(event: FormEvent<HTMLFormElement>) {
    const f = form(event)
    if (
      await run(
        () =>
          practice.saveExam(
            {
              cycleId,
              title: field(f, 'title'),
              date: field(f, 'date'),
              targetSeconds: number(f, 'minutes') * 60,
              maximumScore: number(f, 'maximumScore'),
              score: nullableScore(f, 'score'),
              status: field(f, 'status') as MockExam['status'],
              notes: field(f, 'notes'),
            },
            previous,
            op.current,
          ),
        '模拟考试已保存，独立考试结果保持原样',
      )
    )
      done()
  }
  return (
    <form className="practice-editor" aria-label="模拟考试表单" onSubmit={save}>
      <h3>{previous ? '编辑模拟考试' : '新建模拟考试'}</h3>
      <fieldset disabled={busy}>
        <Field label="试卷名称">
          <input name="title" maxLength={160} required defaultValue={previous?.title} />
        </Field>
        <div className="form-columns">
          <Field label="模拟日期">
            <input type="date" name="date" required defaultValue={previous?.date ?? todayKey()} />
          </Field>
          <Field label="时限（分钟，最多480）">
            <input
              type="number"
              name="minutes"
              min={1 / 60}
              max={480}
              step="any"
              required
              defaultValue={(previous?.targetSeconds ?? 7200) / 60}
              readOnly={!!previous?.timerId}
            />
          </Field>
          <Field label="满分">
            <input
              type="number"
              name="maximumScore"
              min={0.01}
              max={1000000}
              step="any"
              required
              defaultValue={previous?.maximumScore ?? 100}
            />
          </Field>
          <Field label="成绩（留空表示未记录）">
            <input
              type="number"
              name="score"
              min={0}
              max={1000000}
              step="any"
              defaultValue={previous?.score ?? ''}
            />
          </Field>
        </div>
        <Field label="模拟状态">
          <select name="status" defaultValue={previous?.status ?? 'prepared'}>
            <option value="prepared">待考试</option>
            <option value="completed">已完成</option>
            <option value="voided">作废</option>
          </select>
        </Field>
        <Field label="模拟备注">
          <textarea name="notes" maxLength={2000} defaultValue={previous?.notes} />
        </Field>
        <p>总成绩由你录入；题目得分另行保存，不自动判断正式考试是否通过。</p>
        <Actions cancel={done} label="保存模拟考试" />
      </fieldset>
    </form>
  )
}
function QuestionEditor({
  data,
  run,
  busy,
  exam,
  previous,
  done,
}: Props & { exam: MockExam; previous?: MockExamQuestion; done: () => void }) {
  const op = useRef(crypto.randomUUID())
  async function save(event: FormEvent<HTMLFormElement>) {
    const f = form(event)
    if (
      await run(
        () =>
          practice.saveQuestion(
            {
              ...question(f),
              mockExamId: exam.id,
              chapterId: optional(f, 'chapterId'),
              response: field(f, 'response'),
              points: number(f, 'points'),
              score: nullableScore(f, 'score'),
            },
            previous,
            op.current,
          ),
        '模拟试题已保存',
      )
    )
      done()
  }
  return (
    <form className="practice-editor" aria-label="模拟试题表单" onSubmit={save}>
      <h3>{previous ? '编辑模拟试题' : '添加模拟试题'}</h3>
      <fieldset disabled={busy}>
        <ChapterField data={data} cycleId={exam.cycleId} value={previous?.chapterId} />
        <QuestionFields previous={previous} response />
        <div className="form-columns">
          <Field label="题目分值">
            <input
              name="points"
              type="number"
              step="any"
              min={0.01}
              max={1000000}
              required
              defaultValue={previous?.points ?? 1}
            />
          </Field>
          <Field label="题目得分（留空表示未记录）">
            <input
              name="score"
              type="number"
              step="any"
              min={0}
              max={1000000}
              defaultValue={previous?.score ?? ''}
            />
          </Field>
        </div>
        <Actions cancel={done} label="保存模拟试题" />
      </fieldset>
    </form>
  )
}
function ExamDetail({
  data,
  run,
  busy,
  item,
  done,
  onFocus,
}: Props & { item: MockExam; done: () => void; onFocus: () => void }) {
  const exam = useLiveQuery(() => db.mockExams.get(item.id), [item.id]) ?? item
  const rows = useLiveQuery(
    () => db.mockExamQuestions.where('mockExamId').equals(item.id).toArray(),
    [item.id],
  )
  const [editor, setEditor] = useState<MockExamQuestion | 'new' | null>(null),
    [page, setPage] = useState(0)
  const op = useRef(crypto.randomUUID())
  const timer = data.focusTimers.find((t) => t.id === exam.timerId)
  async function start() {
    if (
      await run(
        () =>
          focus.start(
            {
              cycleId: exam.cycleId,
              taskId: null,
              chapterId: null,
              targetSeconds: exam.targetSeconds,
              mockExamId: exam.id,
            },
            op.current,
          ),
        '模拟倒计时已开启，到时后请确认实际记录',
      )
    )
      onFocus()
  }
  if (editor)
    return (
      <QuestionEditor
        data={data}
        run={run}
        busy={busy}
        exam={exam}
        previous={editor === 'new' ? undefined : editor}
        done={() => setEditor(null)}
      />
    )
  return (
    <section className="practice-editor">
      <button className="text-button" onClick={done}>
        返回列表
      </button>
      <h3>{exam.title}</h3>
      <p>
        {exam.date} · 时限 {durationText(exam.targetSeconds)} · 成绩{' '}
        {exam.score === null ? '未记录' : exam.score} / {exam.maximumScore}
      </p>
      <p>
        已确认实际学习：
        {durationText(mockActualSeconds(exam, data.focusTimers, data.sessions, data.segments))}
        。此处引用学习记录，统计中只计算一次。
      </p>
      <fieldset disabled={busy}>
        <div className="learning-actions">
          {!exam.timerId && !exam.studySessionId && exam.status === 'prepared' && (
            <button className="button primary" onClick={start}>
              开始模拟倒计时
            </button>
          )}
          {exam.timerId && (
            <button className="button outline" onClick={onFocus}>
              查看陪伴计时
            </button>
          )}
          <button
            className="button outline"
            onClick={() => setEditor('new')}
            disabled={exam.status === 'voided'}
          >
            添加模拟试题
          </button>
        </div>
        {timer && (
          <p>
            计时状态：
            {
              {
                running: '进行中',
                paused: '已暂停',
                review: '待确认',
                saved: '已保存',
                discarded: '已作废',
              }[timer.status]
            }
            。请在计时面板确认保存，模拟成绩可单独录入。
          </p>
        )}
        {!exam.timerId && (
          <form
            onSubmit={async (e) => {
              const f = form(e)
              await run(
                () => practice.linkExamSession(exam, optional(f, 'studySessionId')),
                '学习记录引用已保存',
              )
            }}
          >
            <SessionField data={data} cycleId={exam.cycleId} value={exam.studySessionId} />
            <button className="button outline">保存学习记录引用</button>
          </form>
        )}
      </fieldset>
      <h4>模拟试题</h4>
      <p>
        记录 {rows?.length ?? 0} 道；已录入题目得分{' '}
        {rows?.filter((q) => q.score !== null).reduce((n, q) => n + q.score!, 0) ?? 0}
        （仅汇总已填得分，不替代试卷总成绩）。
      </p>
      {rows?.slice(page * 20, (page + 1) * 20).map((q) => (
        <article className="practice-card" key={q.id}>
          <h4 className="question-text">{q.stem}</h4>
          <p>
            得分 {q.score === null ? '未记录' : q.score} / {q.points}
          </p>
          <button
            className="text-button"
            disabled={busy || exam.status === 'voided'}
            onClick={() => setEditor(q)}
          >
            查看与编辑试题
          </button>
        </article>
      ))}
      {!rows?.length && <p>尚未录入模拟试题</p>}
      <Pages page={page} count={rows?.length ?? 0} setPage={setPage} />
    </section>
  )
}
function Pages({
  page,
  count,
  setPage,
}: {
  page: number
  count: number
  setPage: (page: number) => void
}) {
  const total = Math.max(1, Math.ceil(count / PAGE_SIZE))
  return (
    <div className="practice-pages">
      <span>
        共{count}条 · 第{page + 1}/{total}页
      </span>
      <button className="button ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
        上一页
      </button>
      <button
        className="button ghost"
        disabled={page + 1 >= total}
        onClick={() => setPage(page + 1)}
      >
        下一页
      </button>
      {total > 2 && (
        <button
          className="button ghost"
          disabled={page + 1 >= total}
          onClick={() => setPage(total - 1)}
        >
          末页
        </button>
      )}
    </div>
  )
}
function FrozenReport({ report }: { report: ReportSnapshot }) {
  const m = report.metrics
  return (
    <article className="frozen-report">
      <h3>
        {report.year} 备考年度 · 第{report.version}版
      </h3>
      <p>
        冻结于 {new Date(report.createdAt).toLocaleString('zh-CN')}
        。范围：该备考年度科目，包括跨公历年的学习记录和已归档科目。
      </p>
      <p>{report.notes}</p>
      <div className="practice-summary">
        <p>
          实际学习<strong>{durationText(m.actualSeconds)}</strong>
        </p>
        <p>
          其中陪伴<strong>{durationText(m.companionSeconds)}</strong>
        </p>
        <p>
          已完成任务
          <strong>
            {m.completedTasks} / {m.taskCount}
          </strong>
        </p>
        <p>
          练习正确率<strong>{pct(m.accuracy)}</strong>
          <small>
            答对{m.correct} / 已作答{m.answered}；{m.practiceCount}次有效练习
          </small>
        </p>
        <p>
          错题<strong>{m.mistakeCount}题</strong>
          <small>手动标记已掌握 {m.masteredMistakes}题</small>
        </p>
      </div>
      <h4>模拟成绩快照</h4>
      {!m.exams.length && <p>无模拟记录</p>}
      {m.exams.map((e) => (
        <p key={e.id}>
          {e.date} · {e.title}：{e.score === null ? '未记录' : e.score} / {e.maximumScore}；引用实际{' '}
          {durationText(e.actualSeconds)}
        </p>
      ))}
      <h4>生成时的章节状态与评价</h4>
      <p>仅表示冻结时的当前评价，未重建过去每一天的掌握状态。</p>
      {!m.chapters.length && <p>无章节记录</p>}
      {m.chapters.map((c) => (
        <p key={c.id}>
          {c.title} · {CHAPTER_LABELS[c.status as keyof typeof CHAPTER_LABELS]} ·{' '}
          {c.masteryStars === null ? '未评价' : `${c.masteryStars} / 5星`}
        </p>
      ))}
      <details>
        <summary>来源记录与指纹</summary>
        <p className="practice-fingerprint">SHA-256：{report.sourceFingerprint}</p>
        <ul>
          {m.cycles.map((c) => (
            <li key={c.id}>
              {c.subject}
              {c.archived ? ' · 已归档' : ''}
            </li>
          ))}
        </ul>
        <pre>{JSON.stringify(report.sourceCounts, null, 2)}</pre>
      </details>
    </article>
  )
}
function Reports({ data, run, busy }: Props) {
  const [year, setYear] = useState(
      data.plans.map((p) => p.year).sort((a, b) => b - a)[0] ?? new Date().getFullYear(),
    ),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(''),
    [notes, setNotes] = useState(''),
    [confirmed, setConfirmed] = useState(false)
  const result = useLiveQuery(async () => {
    const q = db.reportSnapshots
      .where('[year+version]')
      .between([year, 1], [year, Number.MAX_SAFE_INTEGER], true, true)
      .reverse()
    return {
      count: await q.count(),
      rows: await q
        .clone()
        .offset(page * 20)
        .limit(20)
        .toArray(),
    }
  }, [year, page])
  const report = useLiveQuery(
    () => (selected ? db.reportSnapshots.get(selected) : undefined),
    [selected],
  )
  const op = useRef(crypto.randomUUID())
  async function generate() {
    let id = ''
    if (
      await run(async () => {
        id = await practice.generateReport(year, notes, op.current)
      }, '已生成新的冻结报告，旧版本保持原样')
    ) {
      op.current = crypto.randomUUID()
      setSelected(id)
      setPage(0)
      setConfirmed(false)
    }
  }
  return (
    <section>
      <p>
        按备考年度生成版本化快照。后续补录、作废和编辑不会改写旧报告；需要更新时再生成一版。完整JSON包含全部报告。
      </p>
      <Field label="报告备考年度">
        <select
          value={year}
          onChange={(e) => {
            setYear(Number(e.target.value))
            setPage(0)
            setSelected('')
            setConfirmed(false)
          }}
        >
          {data.plans.map((p) => (
            <option key={p.id} value={p.year}>
              {p.year}年
            </option>
          ))}
        </select>
      </Field>
      <fieldset disabled={busy}>
        <Field label="本版说明（选填）">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{' '}
          我确认保存当前快照；已有版本不会覆盖
        </label>
        <div className="learning-actions">
          <button className="button primary" disabled={!confirmed} onClick={generate}>
            生成新的冻结报告
          </button>
        </div>
      </fieldset>
      <div className="practice-report-list">
        {result?.rows.map((r) => (
          <button
            className={`button ${selected === r.id ? 'primary' : 'outline'}`}
            key={r.id}
            onClick={() => setSelected(r.id)}
          >
            第{r.version}版 · {new Date(r.createdAt).toLocaleDateString('zh-CN')}
          </button>
        ))}
      </div>
      {result?.count === 0 && <p>尚无该年度冻结报告</p>}
      <Pages page={page} count={result?.count ?? 0} setPage={setPage} />
      {report && <FrozenReport report={report} />}
    </section>
  )
}
export function PracticeWorkspace({ data, run, busy, onFocus }: Props & { onFocus: () => void }) {
  const [tab, setTab] = useState<Tab>('practice'),
    [cycleId, setCycle] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [archived, setArchived] = useState(false)
  const [editor, setEditor] = useState<PracticeSet | MistakeItem | MockExam | 'new' | null>(null),
    [detail, setDetail] = useState<MistakeItem | MockExam | null>(null)
  const result = useLiveQuery(
    () => (tab === 'reports' ? undefined : readPracticePage(tab, cycleId, search, page, archived)),
    [tab, cycleId, search, page, archived],
  )
  const accuracy = useLiveQuery(
    async () =>
      practiceAccuracy(
        await (
          cycleId
            ? db.practiceSets.where('cycleId').equals(cycleId)
            : db.practiceSets.toCollection()
        ).toArray(),
      ),
    [cycleId],
  )
  const selectedCycle = editor && editor !== 'new' ? editor.cycleId : cycleId
  function reset() {
    setEditor(null)
    setDetail(null)
    setPage(0)
  }
  return (
    <div className="practice-workspace">
      <p className="modal-description">
        记录练习与错题、复习和模拟考试。时间引用已有确认记录，掌握评价由你决定。
      </p>
      <div className="view-tabs" role="tablist" aria-label="练习与报告功能">
        {Object.entries({
          practice: '练习记录',
          mistakes: '错题与复习',
          exams: '模拟考试',
          reports: '历年冻结报告',
        }).map(([key, label]) => (
          <button
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            key={key}
            onClick={() => {
              setTab(key as Tab)
              reset()
            }}
            disabled={busy}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'reports' ? (
        <Reports data={data} run={run} busy={busy} />
      ) : (
        <>
          <div className="form-columns">
            <Field label="练习与模拟年度科目">
              <select
                value={cycleId}
                disabled={!!editor || !!detail || busy}
                onChange={(e) => {
                  setCycle(e.target.value)
                  reset()
                }}
              >
                <option value="">全部年度科目</option>
                {data.cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {cycleLabel(data, c.id)}
                    {c.archivedAt ? ' · 已归档' : ''}
                  </option>
                ))}
              </select>
            </Field>
            {!editor && !detail && (
              <Field label="搜索当前列表">
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(0)
                  }}
                />
              </Field>
            )}
          </div>
          {editor ? (
            tab === 'practice' ? (
              <PracticeEditor
                data={data}
                run={run}
                busy={busy}
                cycleId={selectedCycle}
                previous={editor === 'new' ? undefined : (editor as PracticeSet)}
                done={reset}
              />
            ) : tab === 'mistakes' ? (
              <MistakeEditor
                data={data}
                run={run}
                busy={busy}
                cycleId={selectedCycle}
                previous={editor === 'new' ? undefined : (editor as MistakeItem)}
                done={reset}
              />
            ) : (
              <ExamEditor
                data={data}
                run={run}
                busy={busy}
                cycleId={selectedCycle}
                previous={editor === 'new' ? undefined : (editor as MockExam)}
                done={reset}
              />
            )
          ) : detail ? (
            tab === 'mistakes' ? (
              <MistakeDetail item={detail as MistakeItem} run={run} busy={busy} done={reset} />
            ) : (
              <ExamDetail
                data={data}
                run={run}
                busy={busy}
                item={detail as MockExam}
                done={reset}
                onFocus={onFocus}
              />
            )
          ) : (
            <>
              <div className="learning-actions">
                <button
                  className="button primary"
                  disabled={
                    busy || !cycleId || !!data.cycles.find((c) => c.id === cycleId)?.archivedAt
                  }
                  onClick={() => setEditor('new')}
                >
                  {tab === 'practice'
                    ? '记录练习'
                    : tab === 'mistakes'
                      ? '收录错题'
                      : '新建模拟考试'}
                </button>
                {!cycleId && <span>请先选择年度科目，再新增记录。</span>}
                {tab === 'mistakes' && (
                  <label>
                    <input
                      type="checkbox"
                      checked={archived}
                      onChange={(e) => {
                        setArchived(e.target.checked)
                        setPage(0)
                      }}
                    />{' '}
                    显示归档错题
                  </label>
                )}
              </div>
              {tab === 'practice' && (
                <p className="practice-accuracy">
                  本科目范围正确率：{pct(accuracy?.accuracy ?? null)}（答对{accuracy?.correct ?? 0}{' '}
                  / 已作答{accuracy?.answered ?? 0}，仅已确认练习；不随搜索改变）
                </p>
              )}
              <Pages page={page} count={result?.count ?? 0} setPage={setPage} />
              {result?.practices.map((p) => (
                <article className="practice-card" key={p.id}>
                  <small>
                    {p.date} · {cycleLabel(data, p.cycleId)} ·{' '}
                    {p.status === 'confirmed' ? '已确认' : '已作废'}
                  </small>
                  <h3>{p.source}</h3>
                  <p>
                    总计{p.total} · 答对{p.correct} · 答错{p.wrong} · 未答{p.unanswered} · 正确率
                    {pct(p.correct + p.wrong ? p.correct / (p.correct + p.wrong) : null)}
                  </p>
                  <button className="text-button" disabled={busy} onClick={() => setEditor(p)}>
                    编辑练习
                  </button>
                </article>
              ))}
              {result?.mistakes.map((m) => (
                <article className="practice-card" key={m.id}>
                  <small>
                    {m.date} · {cycleLabel(data, m.cycleId)} · {MASTERY_LABELS[m.mastery]}
                    {m.archivedAt ? ' · 已归档' : ''}
                  </small>
                  <h3 className="question-preview">{m.stem}</h3>
                  <p>{m.tags.join(' · ')}</p>
                  <div className="learning-actions">
                    <button className="button outline" disabled={busy} onClick={() => setDetail(m)}>
                      复习与历史
                    </button>
                    <button className="text-button" disabled={busy} onClick={() => setEditor(m)}>
                      编辑错题
                    </button>
                  </div>
                </article>
              ))}
              {result?.exams.map((e) => (
                <article className="practice-card" key={e.id}>
                  <small>
                    {e.date} · {cycleLabel(data, e.cycleId)} ·{' '}
                    {{ prepared: '待考试', completed: '已完成', voided: '已作废' }[e.status]}
                  </small>
                  <h3>{e.title}</h3>
                  <p>
                    成绩 {e.score === null ? '未记录' : e.score} / {e.maximumScore} · 时限
                    {durationText(e.targetSeconds)}
                  </p>
                  <div className="learning-actions">
                    <button className="button outline" disabled={busy} onClick={() => setDetail(e)}>
                      模拟计时与试题
                    </button>
                    <button className="text-button" disabled={busy} onClick={() => setEditor(e)}>
                      编辑考试与成绩
                    </button>
                  </div>
                </article>
              ))}
              {result?.count === 0 && (
                <p className="practice-empty">当前范围暂无记录，可以从一小次练习开始。</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
