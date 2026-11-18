import { useEffect, useMemo, useState } from 'react'
import {
  Download,
  Upload,
  FileSpreadsheet,
  ShieldCheck,
  FolderOpen,
  RefreshCw,
  History,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { backupService, type RestorePreview } from '../../data/backup/service'
import type { BackupStatus, SnapshotListing, DataCsvKind } from '../../shared/backup-bridge'
import type { Runner } from '../dashboard/readDashboard'

const purposeNames = {
  daily: '每日快照',
  manual: '手动快照',
  'pre-restore': '恢复前保护',
  'pre-migration': '升级前保护',
  export: '完整导出',
}
const time = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
export function BackupPanel({
  run,
  busy,
  onRestored,
}: {
  run: Runner
  busy: boolean
  onRestored: () => void | Promise<void>
}) {
  const service = useMemo(() => backupService(), [])
  const [listing, setListing] = useState<SnapshotListing>({ snapshots: [], problems: [] })
  const [status, setStatus] = useState<BackupStatus>({ journal: null, lastExport: null })
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [kind, setKind] = useState<DataCsvKind>('tasks')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  async function refresh() {
    const [list, details] = await Promise.all([
      window.desktop.backup.listSnapshots(),
      window.desktop.backup.status(),
    ])
    setListing(list)
    setStatus(details)
  }
  useEffect(() => {
    refresh().catch((error) => setError(String(error)))
  }, [])
  async function checkFile(content: string, name: string) {
    setPreview(null)
    setConfirmed(false)
    setResult('')
    setError('')
    try {
      setPreview(await service.preview(content, name))
    } catch (error) {
      setError(error instanceof Error ? error.message : '预检失败，原数据未改变')
      throw error
    }
  }
  return (
    <div className="backup-panel">
      <p className="modal-description">
        完整 JSON 可恢复所有数据；CSV 用于表格查看。建议把完整备份另存到其他磁盘或设备。
      </p>
      <div className="backup-status">
        <ShieldCheck size={20} />
        <div>
          <strong>
            {status.lastExport ? '最近一次完整备份导出' : '还没有导出到外部的完整备份'}
          </strong>
          <span>
            {status.lastExport
              ? time(status.lastExport.savedAt)
              : listing.snapshots.length
                ? `本机有 ${listing.snapshots.length} 份已验证快照，仍建议另存一份。`
                : '还没有验证通过的本机快照，请先导出完整备份。'}
          </span>
          {status.lastExport && <code>{status.lastExport.path}</code>}
        </div>
      </div>
      <div className="backup-actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => {
            let message = '已取消导出，学习数据未改变'
            run(
              async () => {
                const saved = await service.exportJson()
                if (saved) {
                  message = saved.warning ?? '完整 JSON 已导出并回读校验'
                  setResult(`已导出：${saved.path}${saved.warning ? `。${saved.warning}` : ''}`)
                }
                await refresh()
              },
              () => message,
            )
          }}
        >
          <Download size={16} />
          导出完整 JSON
        </button>
        <button
          className="button outline"
          disabled={busy}
          onClick={() => {
            setPreview(null)
            setConfirmed(false)
            setError('')
            setResult('')
            run(async () => {
              const selected = await window.desktop.backup.chooseBackupFile()
              if (selected) await checkFile(selected.content, selected.name)
            }, '文件选择与预检已完成')
          }}
        >
          <Upload size={16} />
          选择 JSON 预检
        </button>
        <button
          className="button outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const saved = await service.createSnapshot()
              setResult(`本机快照已验证：${saved.fileName}`)
              await refresh()
            }, '本机快照已保存并验证')
          }
        >
          <ShieldCheck size={16} />
          创建本机快照
        </button>
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => run(() => window.desktop.backup.openBackupFolder(), '已打开备份文件夹')}
        >
          <FolderOpen size={16} />
          打开备份文件夹
        </button>
      </div>
      <div className="csv-export">
        <div>
          <strong>导出 CSV 表格</strong>
          <p>含中文表头，可用 Excel 打开。CSV 不用于完整恢复。</p>
        </div>
        <select
          aria-label="CSV 导出内容"
          value={kind}
          disabled={busy}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value="tasks">学习任务</option>
          <option value="sessions">学习记录</option>
          <option value="cycles">科目周期</option>
          <option value="materials">学习资料</option>
          <option value="chapters">章节与进度</option>
          <option value="weekly-plans">每周计划</option>
          <option value="weekly-targets">各科周目标</option>
          <option value="schedule-history">任务日期历史</option>
          <option value="exam-dates">考试日期提醒</option>
          <option value="focus-timers">陪伴计时工作记录</option>
        </select>
        <button
          className="button outline"
          disabled={busy}
          onClick={() => {
            let message = '已取消 CSV 导出'
            run(
              async () => {
                const saved = await service.exportCsv(kind)
                if (saved) {
                  message = 'CSV 已导出'
                  setResult(`已导出：${saved.path}`)
                }
              },
              () => message,
            )
          }}
        >
          <FileSpreadsheet size={16} />
          导出 CSV
        </button>
      </div>
      {error && (
        <div className="backup-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      {result && (
        <div className="backup-result" role="status">
          <CheckCircle2 size={18} />
          <span>{result}</span>
        </div>
      )}
      {preview && (
        <section className="restore-preview" aria-label="备份预检结果">
          <h3>
            <ShieldCheck size={17} />
            完整性预检通过
          </h3>
          <p className="backup-file-name">{preview.fileName}</p>
          <p>
            备份时间：{time(preview.inspection.envelope.exportedAt)} · 数据版本 V
            {preview.inspection.envelope.schemaVersion}
          </p>
          <table>
            <thead>
              <tr>
                <th>内容</th>
                <th>当前本机</th>
                <th>恢复后</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['annualPlans', '年度计划'],
                ['cycles', '备考周期'],
                ['tasks', '学习任务'],
                ['cycleStatuses', '独立考试状态'],
                ['materials', '学习资料'],
                ['chapters', '学习章节'],
                ['materialProgress', '资料章节进度'],
                ['weeklyPlans', '周计划'],
                ['weeklySubjectTargets', '各科周目标'],
                ['taskScheduleHistory', '任务日期变更历史'],
                ['examMilestones', '考试日期节点'],
                ['studySessions', '学习记录'],
                ['focusTimers', '陪伴计时工作记录'],
                ['quoteHistory', '励志语历史'],
                ['quotes', '完整励志语库'],
                ['quoteDetails', '作者与出处'],
                ['quoteFavorites', '语句收藏状态'],
                ['experienceSettings', '声音与动画设置'],
                ['practiceSets', '练习记录'],
                ['mistakeItems', '错题'],
                ['mistakeReviews', '错题复习历史'],
                ['mockExams', '模拟考试'],
                ['mockExamQuestions', '模拟试题'],
                ['reportSnapshots', '年度冻结报告'],
              ].map(([key, label]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{preview.currentCounts[key]}</td>
                  <td>{preview.inspection.counts[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.differentDataset && (
            <div className="restore-warning">
              这是另一个数据集的备份。恢复会替换本机全部学习数据，不会自动合并。
            </div>
          )}
          {preview.inspection.warnings.map((warning) => (
            <div key={warning} className="restore-warning">
              {warning}
            </div>
          ))}
          {preview.identical ? (
            <div className="backup-result">
              <CheckCircle2 size={17} />
              内容与本机一致，无需恢复；没有新增或重复任何记录。
            </div>
          ) : (
            <>
              <label className="restore-confirm">
                <input
                  type="checkbox"
                  aria-label="确认整体替换当前数据"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>我确认整体替换当前数据。程序会先保存并验证恢复前快照，失败时回滚。</span>
              </label>
              <button
                className="button restore-button"
                disabled={busy || !confirmed}
                onClick={() =>
                  run(async () => {
                    setError('')
                    setResult('')
                    try {
                      const restored = await service.restore(preview)
                      setResult(
                        restored.unchanged
                          ? '内容一致，无需恢复'
                          : '完整恢复成功，所有数据已复核。可按日期查看恢复的任务。',
                      )
                      setPreview(null)
                      setConfirmed(false)
                      await refresh()
                      await onRestored()
                    } catch (error) {
                      setError(error instanceof Error ? error.message : '恢复失败')
                      await refresh().catch(() => {})
                      throw error
                    }
                  }, '恢复处理已完成，数据安全状态已复核')
                }
              >
                {busy ? '正在安全恢复…' : '先备份，再恢复'}
              </button>
            </>
          )}
        </section>
      )}
      <section className="snapshot-section">
        <div className="snapshot-heading">
          <h3>
            <History size={17} />
            本机快照
          </h3>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => run(refresh, '备份列表已刷新')}
          >
            <RefreshCw size={13} />
            刷新列表
          </button>
        </div>
        <p className="snapshot-policy">
          每日首次使用自动保存一份，保留最近14份日常快照。升级前、恢复前和手动快照不自动删除。
        </p>
        {listing.problems.map((problem) => (
          <p className="restore-warning" key={problem}>
            {problem}
          </p>
        ))}
        <div className="snapshot-list">
          {listing.snapshots.length ? (
            listing.snapshots.map((snapshot) => (
              <article className="snapshot-row" key={snapshot.id}>
                <div>
                  <strong>{purposeNames[snapshot.purpose]}</strong>
                  <span>
                    {time(snapshot.createdAt)} · V{snapshot.schemaVersion} ·{' '}
                    {(snapshot.bytes / 1024).toFixed(1)} KB
                  </span>
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  aria-label={`预检快照 ${snapshot.id}`}
                  onClick={() =>
                    run(async () => {
                      await checkFile(
                        await window.desktop.backup.readSnapshot(snapshot.id),
                        snapshot.fileName,
                      )
                    }, '快照预检通过，可查看恢复范围')
                  }
                >
                  预检
                </button>
              </article>
            ))
          ) : (
            <p className="modal-description">暂无快照，可先创建一份本机快照。</p>
          )}
        </div>
      </section>
      {status.journal && (
        <div className="last-operation">
          <strong>最近安全操作</strong>
          <p>
            {status.journal.message ?? status.journal.status} ·{' '}
            {time(status.journal.finishedAt ?? status.journal.startedAt)}
          </p>
        </div>
      )}
    </div>
  )
}
