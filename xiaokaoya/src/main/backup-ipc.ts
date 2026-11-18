import { ipcMain, dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { basename, join } from 'node:path'
import { SnapshotStore } from './backup-files'
import type { RecoveryJournal } from '../shared/backup-bridge'
import { todayKey } from '../domain/dates'

export function registerBackupIpc(
  userData: string,
  getWindow: () => BrowserWindow,
  validate: (event: IpcMainInvokeEvent) => void,
) {
  const store = new SnapshotStore(userData)
  const handle = (channel: string, action: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      validate(event)
      return action(...args)
    })
  handle('backup:choose', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '选择小考鸭完整 JSON 备份',
      properties: ['openFile'],
      filters: [{ name: '小考鸭 JSON 备份', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    return { name: basename(file), content: await store.readSelectedFile(file) }
  })
  handle('backup:export', async (content: string) => {
    if (typeof content !== 'string') throw new Error('导出内容无效')
    const result = await dialog.showSaveDialog(getWindow(), {
      title: '导出完整备份',
      defaultPath: `小考鸭完整备份-${todayKey()}.json`,
      filters: [{ name: 'JSON 备份', extensions: ['json'] }],
    })
    return result.canceled || !result.filePath
      ? null
      : store.writeExport(result.filePath, content, 'json')
  })
  handle('backup:csv', async (content: string, kind: string) => {
    if (
      typeof content !== 'string' ||
      ![
        'tasks',
        'sessions',
        'cycles',
        'materials',
        'chapters',
        'weekly-plans',
        'weekly-targets',
        'schedule-history',
        'exam-dates',
        'focus-timers',
        'statistics',
      ].includes(kind)
    )
      throw new Error('CSV 导出类型无效')
    const title = {
      tasks: '学习任务',
      sessions: '学习记录',
      cycles: '科目周期',
      materials: '学习资料',
      chapters: '章节与进度',
      'weekly-plans': '每周计划',
      'weekly-targets': '各科周目标',
      'schedule-history': '任务日期历史',
      'exam-dates': '考试日期提醒',
      'focus-timers': '陪伴计时工作记录',
      statistics: '学习统计',
    }[kind as 'tasks']
    const result = await dialog.showSaveDialog(getWindow(), {
      title: '导出 CSV',
      defaultPath: `小考鸭-${title}-${todayKey()}.csv`,
      filters: [{ name: 'CSV 表格', extensions: ['csv'] }],
    })
    return result.canceled || !result.filePath
      ? null
      : store.writeExport(result.filePath, content, 'csv')
  })
  handle('backup:snapshot', (content: string) => {
    if (typeof content !== 'string') throw new Error('快照内容无效')
    return store.saveSnapshot(content)
  })
  handle('backup:list', () => store.listSnapshots())
  handle('backup:read', (id: string) => store.readSnapshot(id))
  handle('backup:status', () => store.status())
  handle('backup:journal', (journal: RecoveryJournal) => store.writeJournal(journal))
  handle('backup:open-folder', async () => {
    await store.initialize()
    const error = await shell.openPath(join(userData, 'backups'))
    if (error) throw new Error(error)
  })
}
