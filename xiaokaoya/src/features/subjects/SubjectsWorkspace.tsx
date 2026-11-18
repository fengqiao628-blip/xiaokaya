import { useRef, useState, type FormEvent } from 'react'
import { Archive, BookOpen, ChevronRight, Plus, RotateCcw, Video } from 'lucide-react'
import type { Snapshot, Runner } from '../dashboard/readDashboard'
import { curriculum, type ChapterInput, type MaterialInput } from '../../services/curriculum'
import {
  CHAPTER_LABELS,
  LEARNING_LABELS,
  REGISTRATION_LABELS,
  RESULT_LABELS,
  type Chapter,
  type ChapterStatus,
  type CycleExamStatus,
  type ExamResult,
  type LearningMaterial,
  type LearningStatus,
  type MaterialProgress,
  type RegistrationStatus,
  type StudyCycle,
  type SubjectPart,
} from '../../domain/models'
import { todayKey } from '../../domain/dates'
import './curriculum.css'

type Context = { data: Snapshot; run: Runner; busy: boolean }
const submit = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault()
  return new FormData(event.currentTarget)
}
const field = (form: FormData, key: string) => String(form.get(key) ?? '')
const partsCompatible = (a: string | null, b: string | null) => !a || !b || a === b

export function SubjectsWorkspace({
  data,
  run,
  busy,
  onSelectSubjects,
  initialCycleId,
}: Context & { onSelectSubjects: () => void; initialCycleId?: string }) {
  const years = [...data.plans].sort((a, b) => b.year - a.year)
  const initialPlan = data.cycles.find((c) => c.id === initialCycleId)?.annualPlanId
  const [year, setYear] = useState(
    String(
      data.plans.find((p) => p.id === initialPlan)?.year ??
        years[0]?.year ??
        Number(todayKey().slice(0, 4)) + 1,
    ),
  )
  const [system, setSystem] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [selected, setSelected] = useState(initialCycleId ?? '')
  const plan = data.plans.find((item) => String(item.year) === year)
  const cycles = data.cycles
    .filter(
      (cycle) =>
        cycle.annualPlanId === plan?.id &&
        (showArchived || !cycle.archivedAt) &&
        (system === 'all' ||
          data.subjects.find((subject) => subject.id === cycle.subjectId)?.system === system),
    )
    .sort(
      (a, b) =>
        (data.subjects.find((s) => s.id === a.subjectId)?.order ?? 0) -
        (data.subjects.find((s) => s.id === b.subjectId)?.order ?? 0),
    )
  const current = cycles.find((cycle) => cycle.id === selected) ?? cycles[0]
  return (
    <div className="curriculum-workspace">
      <p className="modal-description">
        每一年都有自己的备考档案。暂停和归档会保留任务、资料与学习记录。
      </p>
      <div className="curriculum-toolbar">
        <label className="field">
          备考年份
          <select aria-label="查看备考年份" value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((plan) => (
              <option value={plan.year} key={plan.id}>
                {plan.year}年
              </option>
            ))}
            {!years.length && <option value={year}>{year}年</option>}
          </select>
        </label>
        <label className="field">
          考试分类
          <select
            aria-label="档案考试分类"
            value={system}
            onChange={(e) => setSystem(e.target.value)}
          >
            <option value="all">全部考试</option>
            <option value="cpa">CPA</option>
            <option value="tax">税务师</option>
          </select>
        </label>
        <button className="button outline" onClick={onSelectSubjects} disabled={busy}>
          <Plus size={15} />
          调整年度选科
        </button>
      </div>
      <label className="archive-toggle">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        显示已归档周期
      </label>
      <div className="curriculum-layout">
        <nav className="cycle-navigation" aria-label="本年度科目档案">
          {cycles.map((cycle) => {
            const subject = data.subjects.find((s) => s.id === cycle.subjectId)!
            const status = data.cycleStatuses.find((s) => s.id === cycle.id)
            return (
              <button
                key={cycle.id}
                className={`cycle-choice ${current?.id === cycle.id ? 'selected' : ''}`}
                aria-label={`查看${subject.system === 'cpa' ? 'CPA' : '税务师'} · ${subject.name} · ${year}`}
                aria-pressed={current?.id === cycle.id}
                onClick={() => setSelected(cycle.id)}
              >
                <span className={`system-pill ${subject.system}`}>
                  {subject.system === 'cpa' ? 'CPA' : '税务师'}
                </span>
                <strong>{subject.name}</strong>
                <span>
                  {LEARNING_LABELS[cycle.learningStatus]} ·{' '}
                  {status ? RESULT_LABELS[status.examResult] : '未记录'}
                </span>
                {cycle.archivedAt && <small>已归档</small>}
                <ChevronRight size={15} />
              </button>
            )
          })}
          {!cycles.length && (
            <p className="workspace-empty">
              本年度尚无符合条件的科目。可调整年度选科，或查看已归档周期。
            </p>
          )}
        </nav>
        <div className="cycle-detail">
          {current ? (
            <CycleDetail key={current.id} cycle={current} data={data} run={run} busy={busy} />
          ) : (
            <div className="workspace-empty">
              <BookOpen size={30} />
              <h3>从一门科目开始</h3>
              <p>CPA与税务师可以自由搭配，新年度不会覆盖以前的记录。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CycleDetail({ cycle, data, run, busy }: Context & { cycle: StudyCycle }) {
  const subject = data.subjects.find((s) => s.id === cycle.subjectId)!
  const year = data.plans.find((p) => p.id === cycle.annualPlanId)?.year
  const status = data.cycleStatuses.find((s) => s.id === cycle.id)!
  const parts = data.subjectParts.filter((part) => part.subjectId === cycle.subjectId)
  const [showArchived, setShowArchived] = useState(false)
  const [editor, setEditor] = useState<{
    kind: 'material' | 'chapter'
    item?: LearningMaterial | Chapter
  } | null>(null)
  const [progressChapter, setProgressChapter] = useState<string | null>(null)
  const materials = data.materials
    .filter((item) => item.cycleId === cycle.id)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const chapters = data.chapters
    .filter((item) => item.cycleId === cycle.id)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const partName = (id: string | null) => parts.find((part) => part.id === id)?.name ?? ''
  return (
    <>
      <header className="cycle-heading">
        <span className={`system-pill ${subject.system}`}>
          {subject.system === 'cpa' ? 'CPA' : '税务师'}
        </span>
        <h3>
          {subject.name}
          <span>{year}年备考</span>
        </h3>
      </header>
      {cycle.archivedAt && (
        <div className="notice">
          <Archive size={18} />
          <p>本周期已归档，全部历史记录保留。恢复后可以继续编辑。</p>
          <button
            className="button outline"
            disabled={busy}
            onClick={() =>
              run(() => curriculum.archiveCycle(cycle, false), '周期已恢复，原有状态保持不变')
            }
          >
            <RotateCcw size={14} />
            恢复周期
          </button>
        </div>
      )}
      <CycleStatusForm
        key={`${cycle.id}-${cycle.revision}-${status.revision}`}
        cycle={cycle}
        status={status}
        run={run}
        busy={busy}
      />
      <label className="archive-toggle">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        显示归档的资料和章节
      </label>
      <section className="curriculum-section" aria-label="学习资料">
        <div className="card-heading">
          <h3>教材与视频</h3>
          <button
            className="text-button"
            disabled={busy || !!cycle.archivedAt}
            onClick={() => setEditor({ kind: 'material' })}
          >
            <Plus size={15} />
            添加资料
          </button>
        </div>
        <p className="section-note">版本分别保存；教材与视频的学习进度独立记录。</p>
        <div className="material-list">
          {materials
            .filter((item) => showArchived || !item.archivedAt)
            .map((material) => (
              <article
                className={`material-row ${material.archivedAt ? 'archived' : ''}`}
                key={material.id}
              >
                {material.kind === 'textbook' ? <BookOpen size={19} /> : <Video size={19} />}
                <div>
                  <strong>{material.title}</strong>
                  <small>
                    {material.kind === 'textbook' ? '教材' : '视频'}
                    {material.edition ? ` · ${material.edition}` : ''}
                    {material.partId ? ` · ${partName(material.partId)}` : ''}
                    {material.archivedAt ? ' · 已归档' : ''}
                  </small>
                </div>
                <div className="row-actions">
                  <button
                    className="text-button"
                    disabled={busy || !!cycle.archivedAt || !!material.archivedAt}
                    aria-label={`编辑资料：${material.title}`}
                    onClick={() => setEditor({ kind: 'material', item: material })}
                  >
                    编辑
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || !!cycle.archivedAt}
                    aria-label={`${material.archivedAt ? '恢复' : '归档'}资料：${material.title}`}
                    onClick={() =>
                      run(
                        () => curriculum.archiveItem('materials', material, !material.archivedAt),
                        material.archivedAt ? '资料已恢复' : '资料已归档，已有进度保留',
                      )
                    }
                  >
                    {material.archivedAt ? '恢复' : '归档'}
                  </button>
                </div>
              </article>
            ))}
          {!materials.some((item) => showArchived || !item.archivedAt) && (
            <p className="workspace-empty compact">添加正在使用的教材或视频课程。</p>
          )}
        </div>
      </section>
      {editor?.kind === 'material' && (
        <MaterialEditor
          key={editor.item?.id ?? 'new-material'}
          parts={parts}
          previous={editor.item as LearningMaterial | undefined}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSave={async (value, operationId) => {
            if (
              await run(
                () =>
                  curriculum.saveMaterial(
                    cycle.id,
                    value,
                    editor.item as LearningMaterial | undefined,
                    operationId,
                  ),
                '学习资料已保存',
              )
            )
              setEditor(null)
          }}
        />
      )}
      <section className="curriculum-section" aria-label="学习章节">
        <div className="card-heading">
          <h3>章节与掌握程度</h3>
          <button
            className="text-button"
            disabled={busy || !!cycle.archivedAt}
            onClick={() => setEditor({ kind: 'chapter' })}
          >
            <Plus size={15} />
            添加章节
          </button>
        </div>
        <p className="section-note">学完不代表掌握。章节完成情况、资料进度和星级分别由你记录。</p>
        {chapters
          .filter((item) => showArchived || !item.archivedAt)
          .map((chapter) => {
            const progress = data.materialProgress.filter((item) => item.chapterId === chapter.id)
            const choices = materials.filter(
              (item) => !item.archivedAt && partsCompatible(item.partId, chapter.partId),
            )
            return (
              <article
                className={`chapter-card ${chapter.archivedAt ? 'archived' : ''}`}
                key={chapter.id}
              >
                <div className="chapter-heading">
                  <div>
                    <h4>{chapter.title}</h4>
                    <small>
                      {partName(chapter.partId)}
                      {chapter.archivedAt ? ' · 已归档' : ''}
                    </small>
                  </div>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      aria-label={`编辑章节：${chapter.title}`}
                      disabled={busy || !!cycle.archivedAt || !!chapter.archivedAt}
                      onClick={() => setEditor({ kind: 'chapter', item: chapter })}
                    >
                      编辑
                    </button>
                    <button
                      className="text-button"
                      aria-label={`${chapter.archivedAt ? '恢复' : '归档'}章节：${chapter.title}`}
                      disabled={busy || !!cycle.archivedAt}
                      onClick={() =>
                        run(
                          () => curriculum.archiveItem('chapters', chapter, !chapter.archivedAt),
                          chapter.archivedAt ? '章节已恢复' : '章节已归档，任务和进度保留',
                        )
                      }
                    >
                      {chapter.archivedAt ? '恢复' : '归档'}
                    </button>
                  </div>
                </div>
                <div className="chapter-independent">
                  <span>
                    章节完成：<b>{CHAPTER_LABELS[chapter.completionStatus]}</b>
                  </span>
                  <span>
                    知识掌握：
                    <b className="mastery-stars">
                      {chapter.masteryStars
                        ? '★'.repeat(chapter.masteryStars) + '☆'.repeat(5 - chapter.masteryStars)
                        : '尚未评估'}
                    </b>
                  </span>
                </div>
                <div className="chapter-progress-list">
                  {progress.map((item) => {
                    const material = materials.find((m) => m.id === item.materialId)!
                    return (
                      <div className="resource-progress" key={item.id}>
                        <span>
                          {material.kind === 'textbook' ? '教材' : '视频'} · {material.title}
                          {material.archivedAt ? '（已归档）' : ''}
                        </span>
                        <progress
                          max={100}
                          value={item.progressPercent}
                          aria-label={`${chapter.title} · ${material.title}进度`}
                        />
                        <b>{item.progressPercent}%</b>
                      </div>
                    )
                  })}
                  {!progress.length && <small>教材/视频进度尚未记录</small>}
                </div>
                {chapter.notes && <p className="chapter-notes">{chapter.notes}</p>}
                <button
                  className="text-button"
                  disabled={busy || !!cycle.archivedAt || !!chapter.archivedAt || !choices.length}
                  aria-label={`记录资料进度：${chapter.title}`}
                  onClick={() =>
                    setProgressChapter(progressChapter === chapter.id ? null : chapter.id)
                  }
                >
                  记录资料进度
                </button>
                {!choices.length && !chapter.archivedAt && (
                  <small className="section-note">先添加适用于本章节的教材或视频。</small>
                )}
                {progressChapter === chapter.id && (
                  <ProgressEditor
                    chapter={chapter}
                    materials={choices}
                    progress={progress}
                    busy={busy}
                    onCancel={() => setProgressChapter(null)}
                    onSave={async (materialId, percent, previous, id) => {
                      if (
                        await run(
                          () =>
                            curriculum.setProgress(materialId, chapter.id, percent, previous, id),
                          '资料进度已保存，星级与章节状态保持独立',
                        )
                      )
                        setProgressChapter(null)
                    }}
                  />
                )}
              </article>
            )
          })}
        {!chapters.some((item) => showArchived || !item.archivedAt) && (
          <p className="workspace-empty compact">
            还没有章节。按本年度教材或大纲添加，历史年度的章节会独立保留。
          </p>
        )}
      </section>
      {editor?.kind === 'chapter' && (
        <ChapterEditor
          key={editor.item?.id ?? 'new-chapter'}
          parts={parts}
          previous={editor.item as Chapter | undefined}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSave={async (value, id) => {
            if (
              await run(
                () =>
                  curriculum.saveChapter(cycle.id, value, editor.item as Chapter | undefined, id),
                '章节已保存',
              )
            )
              setEditor(null)
          }}
        />
      )}
    </>
  )
}

function CycleStatusForm({
  cycle,
  status,
  run,
  busy,
}: {
  cycle: StudyCycle
  status: CycleExamStatus
  run: Runner
  busy: boolean
}) {
  const [confirmArchive, setConfirmArchive] = useState(false)
  return (
    <form
      className="cycle-status-form"
      noValidate
      onSubmit={(event) => {
        const form = submit(event)
        run(
          () =>
            curriculum.saveCycle(cycle, status, {
              learningStatus: field(form, 'learningStatus') as LearningStatus,
              registrationStatus: field(form, 'registrationStatus') as RegistrationStatus,
              examResult: field(form, 'examResult') as ExamResult,
              examDate: field(form, 'examDate') || null,
              notes: field(form, 'notes'),
            }),
          '独立状态已保存',
        )
      }}
    >
      <h4>三个状态，分别记录</h4>
      <fieldset disabled={busy || !!cycle.archivedAt}>
        <div className="status-columns">
          <label className="field">
            学习状态
            <select name="learningStatus" aria-label="学习状态" defaultValue={cycle.learningStatus}>
              {Object.entries(LEARNING_LABELS).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            报名与参考状态
            <select
              name="registrationStatus"
              aria-label="报名与参考状态"
              defaultValue={status.registrationStatus}
            >
              {Object.entries(REGISTRATION_LABELS).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            考试结果
            <select name="examResult" aria-label="考试结果" defaultValue={status.examResult}>
              {Object.entries(RESULT_LABELS).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-columns">
          <label className="field">
            考试日期（选填）
            <input
              type="date"
              name="examDate"
              aria-label="考试日期"
              min="1900-01-01"
              max="9999-12-31"
              defaultValue={status.examDate ?? ''}
            />
          </label>
          <label className="field">
            考试备注
            <input
              name="notes"
              aria-label="考试备注"
              maxLength={2000}
              defaultValue={status.notes}
            />
          </label>
        </div>
        <p className="section-note">
          通过、报名或参加考试都不会自动修改学习状态，年份也不会自动滚动。
        </p>
        <button type="submit" className="button primary">
          保存独立状态
        </button>
      </fieldset>
      {!cycle.archivedAt && (
        <div className="cycle-archive-area">
          <label className="archive-toggle">
            <input
              type="checkbox"
              checked={confirmArchive}
              onChange={(e) => setConfirmArchive(e.target.checked)}
              disabled={busy}
            />
            确认归档本周期，保留全部历史数据
          </label>
          <button
            type="button"
            className="text-button"
            disabled={busy || !confirmArchive}
            onClick={() =>
              run(() => curriculum.archiveCycle(cycle, true), '周期已归档，全部历史数据保留')
            }
          >
            <Archive size={14} />
            归档周期
          </button>
        </div>
      )}
    </form>
  )
}

function PartField({ parts, value }: { parts: SubjectPart[]; value: string | null }) {
  return parts.length ? (
    <label className="field">
      综合试卷子项
      <select name="partId" aria-label="综合试卷子项" defaultValue={value ?? ''}>
        <option value="">全科通用</option>
        {parts.map((part) => (
          <option key={part.id} value={part.id}>
            {part.name}
          </option>
        ))}
      </select>
    </label>
  ) : (
    <input type="hidden" name="partId" value="" />
  )
}
function EditorActions({
  busy,
  onCancel,
  label,
}: {
  busy: boolean
  onCancel: () => void
  label: string
}) {
  return (
    <div className="editor-actions">
      <button type="button" className="button subtle" disabled={busy} onClick={onCancel}>
        取消编辑
      </button>
      <button type="submit" className="button primary" disabled={busy}>
        {busy ? '正在保存…' : label}
      </button>
    </div>
  )
}
function MaterialEditor({
  parts,
  previous,
  busy,
  onCancel,
  onSave,
}: {
  parts: SubjectPart[]
  previous?: LearningMaterial
  busy: boolean
  onCancel: () => void
  onSave: (input: MaterialInput, id: string) => Promise<void>
}) {
  const operationId = useRef(crypto.randomUUID())
  return (
    <form
      className="curriculum-editor"
      aria-label={previous ? '编辑学习资料' : '添加学习资料'}
      noValidate
      onSubmit={(event) => {
        const form = submit(event)
        onSave(
          {
            title: field(form, 'title'),
            kind: field(form, 'kind') as 'textbook' | 'video',
            edition: field(form, 'edition'),
            partId: field(form, 'partId') || null,
          },
          operationId.current,
        )
      }}
    >
      <h4>{previous ? '编辑学习资料' : '添加学习资料'}</h4>
      <fieldset disabled={busy}>
        <label className="field">
          资料名称
          <input
            name="title"
            aria-label="资料名称"
            maxLength={160}
            defaultValue={previous?.title}
            autoFocus
          />
        </label>
        <div className="form-columns">
          <label className="field">
            资料类型
            <select name="kind" aria-label="资料类型" defaultValue={previous?.kind ?? 'textbook'}>
              <option value="textbook">教材</option>
              <option value="video">视频</option>
            </select>
          </label>
          <label className="field">
            版本说明
            <input
              name="edition"
              aria-label="版本说明"
              maxLength={200}
              defaultValue={previous?.edition}
              placeholder="例如：2027年版 / 基础班"
            />
          </label>
        </div>
        <PartField parts={parts} value={previous?.partId ?? null} />
        <p className="section-note">
          已有进度的资料保留原类型、版本和试卷关联；更换版本时新增一份资料。
        </p>
        <EditorActions busy={busy} onCancel={onCancel} label="保存学习资料" />
      </fieldset>
    </form>
  )
}
function ChapterEditor({
  parts,
  previous,
  busy,
  onCancel,
  onSave,
}: {
  parts: SubjectPart[]
  previous?: Chapter
  busy: boolean
  onCancel: () => void
  onSave: (input: ChapterInput, id: string) => Promise<void>
}) {
  const operationId = useRef(crypto.randomUUID())
  return (
    <form
      className="curriculum-editor"
      aria-label={previous ? '编辑学习章节' : '添加学习章节'}
      noValidate
      onSubmit={(event) => {
        const form = submit(event),
          stars = field(form, 'masteryStars')
        onSave(
          {
            title: field(form, 'title'),
            partId: field(form, 'partId') || null,
            completionStatus: field(form, 'completionStatus') as ChapterStatus,
            masteryStars: stars ? Number(stars) : null,
            notes: field(form, 'notes'),
          },
          operationId.current,
        )
      }}
    >
      <h4>{previous ? '编辑学习章节' : '添加学习章节'}</h4>
      <fieldset disabled={busy}>
        <label className="field">
          章节名称
          <input
            name="title"
            aria-label="章节名称"
            maxLength={160}
            defaultValue={previous?.title}
            autoFocus
          />
        </label>
        <PartField parts={parts} value={previous?.partId ?? null} />
        <div className="form-columns">
          <label className="field">
            章节完成情况
            <select
              name="completionStatus"
              aria-label="章节完成情况"
              defaultValue={previous?.completionStatus ?? 'not_started'}
            >
              {Object.entries(CHAPTER_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            知识掌握星级
            <select
              name="masteryStars"
              aria-label="知识掌握星级"
              defaultValue={previous?.masteryStars ?? ''}
            >
              <option value="">尚未评估</option>
              {[1, 2, 3, 4, 5].map((stars) => (
                <option key={stars} value={stars}>
                  {'★'.repeat(stars)} · {stars}星
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          章节备注
          <textarea
            name="notes"
            aria-label="章节备注"
            maxLength={2000}
            rows={2}
            defaultValue={previous?.notes}
          />
        </label>
        <p className="section-note">星级只表示自己的掌握评估，教材或视频学到100%也不会自动加星。</p>
        <EditorActions busy={busy} onCancel={onCancel} label="保存学习章节" />
      </fieldset>
    </form>
  )
}
function ProgressEditor({
  chapter,
  materials,
  progress,
  busy,
  onCancel,
  onSave,
}: {
  chapter: Chapter
  materials: LearningMaterial[]
  progress: MaterialProgress[]
  busy: boolean
  onCancel: () => void
  onSave: (
    materialId: string,
    percent: number,
    previous: MaterialProgress | undefined,
    id: string,
  ) => Promise<void>
}) {
  const initial = materials[0]?.id ?? ''
  const [materialId, setMaterialId] = useState(initial)
  const [base, setBase] = useState(() => progress.find((item) => item.materialId === initial))
  const [percent, setPercent] = useState(String(base?.progressPercent ?? 0))
  const operationId = useRef(crypto.randomUUID())
  return (
    <form
      className="progress-editor"
      aria-label={`${chapter.title}资料进度`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        onSave(materialId, percent.trim() ? Number(percent) : NaN, base, operationId.current)
      }}
    >
      <label className="field">
        学习资料
        <select
          aria-label="进度对应资料"
          value={materialId}
          disabled={busy}
          onChange={(e) => {
            setMaterialId(e.target.value)
            const previous = progress.find((item) => item.materialId === e.target.value)
            setBase(previous)
            setPercent(String(previous?.progressPercent ?? 0))
            operationId.current = crypto.randomUUID()
          }}
        >
          {materials.map((material) => (
            <option key={material.id} value={material.id}>
              {material.kind === 'textbook' ? '教材' : '视频'} · {material.title}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        学习进度（%）
        <input
          type="number"
          aria-label="学习进度百分比"
          min={0}
          max={100}
          step={1}
          value={percent}
          disabled={busy}
          onChange={(e) => setPercent(e.target.value)}
        />
      </label>
      <EditorActions busy={busy} onCancel={onCancel} label="保存资料进度" />
    </form>
  )
}
