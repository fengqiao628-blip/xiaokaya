import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Runner, Snapshot } from '../dashboard/readDashboard'
import type { Attribution, QuoteDetail } from '../../domain/experience'
import { experience, type CustomQuoteInput } from '../../services/experience'
import { study } from '../../services/study'
import { todayKey } from '../../domain/dates'
import './quotes.css'

export function QuoteSource({ source }: { source?: Attribution }) {
  return source ? (
    <span className="quote-source">
      {[source.author || '未填写作者', source.work].filter(Boolean).join(' · ')}
      {source.origin === 'user'
        ? ' · 用户填写'
        : source.origin === 'imported'
          ? ' · 出处未核实'
          : ''}
    </span>
  ) : null
}
const empty: CustomQuoteInput = {
  text: '',
  category: '我的鼓励',
  author: '',
  work: '',
  sourceTitle: '',
  sourceUrl: '',
}
function CustomForm({
  current,
  data,
  run,
  busy,
  onDone,
}: {
  current?: QuoteDetail
  data: Snapshot
  run: Runner
  busy: boolean
  onDone: () => void
}) {
  const quote = data.quotes.find((q) => q.id === current?.id)
  const [input, setInput] = useState<CustomQuoteInput>(
    current && quote
      ? {
          text: quote.text,
          category: quote.category,
          author: current.author,
          work: current.work,
          sourceTitle: current.sourceTitle,
          sourceUrl: current.sourceUrl,
        }
      : empty,
  )
  const id = useRef(current?.id ?? `user-${crypto.randomUUID()}`)
  async function save(event: FormEvent) {
    event.preventDefault()
    if (
      await run(
        () => experience.saveCustom(input, id.current, current?.revision),
        '自定义语句已保存，历史展示内容保持原样',
      )
    )
      onDone()
  }
  return (
    <form onSubmit={save} aria-label="自定义鼓励语" className="quote-editor">
      <h3>{current ? '编辑自定义语句' : '留下一句自己的鼓励'}</h3>
      <fieldset disabled={busy}>
        <label className="field">
          语句正文
          <textarea
            aria-label="自定义语句正文"
            rows={3}
            maxLength={1000}
            value={input.text}
            onChange={(e) => setInput({ ...input, text: e.target.value })}
          />
        </label>
        <div className="form-columns">
          <label className="field">
            分类
            <input
              aria-label="自定义语句分类"
              maxLength={40}
              value={input.category}
              onChange={(e) => setInput({ ...input, category: e.target.value })}
            />
          </label>
          <label className="field">
            作者（选填）
            <input
              aria-label="自定义语句作者"
              maxLength={200}
              value={input.author}
              onChange={(e) => setInput({ ...input, author: e.target.value })}
            />
          </label>
        </div>
        <label className="field">
          作品（选填）
          <input
            aria-label="自定义语句作品"
            maxLength={300}
            value={input.work}
            onChange={(e) => setInput({ ...input, work: e.target.value })}
          />
        </label>
        <label className="field">
          出处说明（选填）
          <input
            aria-label="自定义语句出处"
            maxLength={500}
            value={input.sourceTitle}
            onChange={(e) => setInput({ ...input, sourceTitle: e.target.value })}
          />
        </label>
        <label className="field">
          出处链接（选填，仅保存文字）
          <input
            aria-label="自定义语句链接"
            type="text"
            maxLength={2000}
            value={input.sourceUrl}
            onChange={(e) => setInput({ ...input, sourceUrl: e.target.value })}
          />
        </label>
        <p className="modal-description">
          作者与出处按你的填写保存。修改正文不会改写以前的每日一句；归档后仍保留历史和收藏。
        </p>
        <div className="quote-actions">
          <button type="submit" className="button primary">
            保存自定义语句
          </button>
          <button type="button" className="button ghost" onClick={onDone}>
            取消编辑
          </button>
        </div>
      </fieldset>
    </form>
  )
}

export function QuotesWorkspace({
  data,
  run,
  busy,
}: {
  data: Snapshot
  run: Runner
  busy: boolean
}) {
  const [tab, setTab] = useState<'library' | 'favorites' | 'history' | 'custom'>('library')
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [kind, setKind] = useState('')
  const [showArchived, setShowArchived] = useState(false),
    [page, setPage] = useState(0)
  const [editing, setEditing] = useState<QuoteDetail | undefined>(),
    [creating, setCreating] = useState(false)
  const details = new Map(data.quoteDetails.map((d) => [d.id, d]))
  const favorites = new Set(data.quoteFavorites.filter((q) => q.active).map((q) => q.id))
  const categories = [...new Set(data.quotes.map((q) => q.category))].sort()
  useEffect(() => setPage(0), [tab, search, category, kind, showArchived])
  const filtered = data.quotes.filter((q) => {
    const detail = details.get(q.id)
    return (
      detail &&
      (showArchived || !detail.archivedAt) &&
      (!category || q.category === category) &&
      (!kind || detail.kind === kind) &&
      (tab !== 'favorites' || favorites.has(q.id)) &&
      (tab !== 'custom' || detail.origin === 'user') &&
      (!search || `${q.text} ${detail.author} ${detail.work}`.includes(search.trim()))
    )
  })
  const history = [...data.quoteHistory].sort(
    (a, b) => b.shownAt.localeCompare(a.shownAt) || b.id.localeCompare(a.id),
  )
  const count = tab === 'history' ? history.length : filtered.length
  const maxPage = Math.max(0, Math.ceil(count / 20) - 1),
    currentPage = Math.min(page, maxPage)
  return (
    <div className="quotes-workspace">
      <p className="modal-description">
        读一句喜欢的话，留一点温柔给自己。每日一句与伙伴的状态鼓励分别展示，全部离线可读。
      </p>
      <div className="quote-tabs" role="tablist" aria-label="语库内容">
        {(
          [
            ['library', '完整语库'],
            ['favorites', '我的收藏'],
            ['history', '展示历史'],
            ['custom', '自定义'],
          ] as const
        ).map(([id, title]) => (
          <button
            className={`button ${tab === id ? 'primary' : 'ghost'}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id)
              setCreating(false)
              setEditing(undefined)
            }}
            key={id}
          >
            {title}
          </button>
        ))}
      </div>
      {tab !== 'history' && (
        <div className="quote-filters">
          <label className="field">
            搜索
            <input
              aria-label="搜索语句作者作品"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="语句、作者或作品"
            />
          </label>
          <label className="field">
            分类
            <select
              aria-label="语句分类筛选"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">全部分类</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            类型
            <select
              aria-label="语句类型筛选"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">全部类型</option>
              <option value="encouragement">鼓励语</option>
              <option value="saying">古典名言</option>
              <option value="poetry">诗词</option>
            </select>
          </label>
        </div>
      )}
      <div className="quote-actions">
        {tab !== 'history' && (
          <label>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />{' '}
            显示已归档语句
          </label>
        )}
        <button
          className="button outline"
          disabled={busy}
          onClick={() => {
            setCreating(true)
            setEditing(undefined)
          }}
        >
          添加自定义语句
        </button>
      </div>
      {(creating || editing) && (
        <CustomForm
          key={editing?.id ?? 'new'}
          current={editing}
          data={data}
          run={run}
          busy={busy}
          onDone={() => {
            setCreating(false)
            setEditing(undefined)
          }}
        />
      )}
      <div className="quote-pagination">
        <span>
          共{count}条 · 第{currentPage + 1}/{maxPage + 1}页
        </span>
        <button
          className="button ghost"
          disabled={!currentPage}
          onClick={() => setPage(currentPage - 1)}
        >
          上一页语句
        </button>
        <button
          className="button ghost"
          disabled={currentPage >= maxPage}
          onClick={() => setPage(currentPage + 1)}
        >
          下一页语句
        </button>
      </div>
      <div className="quote-list">
        {tab === 'history'
          ? history.slice(currentPage * 20, currentPage * 20 + 20).map((row) => (
              <article key={row.id} aria-label="历史语句">
                <small>
                  {new Date(row.shownAt).toLocaleString('zh-CN')} ·{' '}
                  {row.reason === 'daily' ? '每日一句' : '主动选择'}
                </small>
                <blockquote>{row.text}</blockquote>
                <QuoteSource source={row.attribution} />
                {!row.attribution && <small>这条旧记录未保存作者出处。</small>}
              </article>
            ))
          : filtered.slice(currentPage * 20, currentPage * 20 + 20).map((q) => {
              const detail = details.get(q.id)!
              return (
                <article key={q.id} aria-label="语库条目">
                  <small>
                    {q.category}
                    {detail.archivedAt ? ' · 已归档' : ''}
                  </small>
                  <blockquote>{q.text}</blockquote>
                  <QuoteSource source={detail} />
                  <details>
                    <summary>查看出处详情</summary>
                    <p>{detail.sourceTitle || '未填写出处'}</p>
                    {detail.sourceUrl && <p className="quote-url">{detail.sourceUrl}</p>}
                    <small>
                      {detail.kind === 'poetry'
                        ? '诗词节选，标点与简体转换不改变原意。'
                        : detail.origin === 'builtin'
                          ? '内置文案随程序保存，可离线查看。'
                          : '用户提供内容，未自动验证署名。'}
                    </small>
                  </details>
                  <div className="quote-actions">
                    <button
                      className="button outline"
                      disabled={busy}
                      aria-label={`收藏语句：${q.id}`}
                      aria-pressed={favorites.has(q.id)}
                      onClick={() =>
                        run(
                          () => experience.favorite(q.id, !favorites.has(q.id)),
                          favorites.has(q.id) ? '已取消收藏' : '已收藏',
                        )
                      }
                    >
                      {favorites.has(q.id) ? '已收藏' : '收藏'}
                    </button>
                    <button
                      className="button ghost"
                      disabled={busy || !!detail.archivedAt}
                      onClick={() =>
                        run(() => study.chooseQuote(todayKey(), q.id), '今日一句已保存')
                      }
                    >
                      设为今日一句
                    </button>
                    {detail.origin === 'user' && (
                      <button
                        className="button ghost"
                        disabled={busy}
                        onClick={() => {
                          setEditing(detail)
                          setCreating(false)
                        }}
                      >
                        编辑自定义
                      </button>
                    )}
                    <button
                      className="button ghost"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => experience.archive(detail, !detail.archivedAt),
                          detail.archivedAt ? '语句已恢复使用' : '语句已归档，收藏及历史保留',
                        )
                      }
                    >
                      {detail.archivedAt ? '恢复使用' : '归档语句'}
                    </button>
                  </div>
                </article>
              )
            })}
        {!count && (
          <p className="notice">这里还没有符合条件的语句，可以调整筛选或添加自己的鼓励。</p>
        )}
      </div>
    </div>
  )
}
