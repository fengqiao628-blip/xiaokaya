import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type Locator,
} from '@playwright/test'
import electronPath from 'electron'
import { resolve, join } from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { actualSeconds } from '../../src/domain/statistics'
import type { StudySession, TimeSegment } from '../../src/domain/models'
import { parseBackup, inspectBackup } from '../../src/shared/backup'
let app: ElectronApplication, page: Page, root: string
async function launch(profile: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined),
  ) as Record<string, string>
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [resolve('.')],
    env: { ...env, XIAOKAOYA_E2E_PROFILE: profile },
  })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  root = (await page.evaluate(() => window.desktop.getInfo())).userData
}
async function seed() {
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2027')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('第五阶段专注测试')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function records(table: string) {
  return page.evaluate(
    (table) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open('XiaokaoyaStudy')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const d = request.result,
            tx = d.transaction(table, 'readonly'),
            get = tx.objectStore(table).getAll()
          get.onsuccess = () => {
            d.close()
            resolve(get.result)
          }
          get.onerror = () => {
            d.close()
            reject(get.error)
          }
        }
      }),
    table,
  )
}
async function actual() {
  return actualSeconds(
    (await records('studySessions')) as unknown as StudySession[],
    (await records('timeSegments')) as unknown as TimeSegment[],
  )
}
async function closePanel() {
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function learningPanel() {
  await page.getByRole('button', { name: '学习记录与计时', exact: true }).click()
  return page.getByRole('dialog', { name: '学习记录与计时', exact: true })
}
async function manual(panel: Locator, start = '2026-02-28T23:50:00', end = '2026-03-01T00:10:00') {
  await panel.getByRole('button', { name: '手动记录学习', exact: true }).click()
  const form = panel.getByRole('form', { name: '手动记录实际学习', exact: true })
  await form.getByLabel('记录关联任务', { exact: true }).selectOption({ label: '第五阶段专注测试' })
  await form.getByLabel('实际开始时间', { exact: true }).fill(start)
  await form.getByLabel('实际结束时间', { exact: true }).fill(end)
  await form.getByLabel('学习记录备注', { exact: true }).fill('跨日实际学习20分钟')
  return form
}
async function begin(seconds: number, fromRecords = false) {
  if (fromRecords) {
    const recordsPanel = await learningPanel()
    await recordsPanel.getByRole('button', { name: '开启陪伴倒计时', exact: true }).click()
  } else await page.getByRole('button', { name: '开始学习：第五阶段专注测试', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '学习陪伴倒计时', exact: true })
  if (fromRecords)
    await panel
      .getByLabel('计时关联任务', { exact: true })
      .selectOption({ label: '第五阶段专注测试' })
  await panel.getByLabel('倒计时分钟', { exact: true }).fill(String(Math.floor(seconds / 60)))
  await panel.getByLabel('倒计时秒数', { exact: true }).fill(String(seconds % 60))
  await panel.getByRole('button', { name: '开始学习', exact: true }).click()
  await expect(panel.getByRole('button', { name: '结束本段', exact: true })).toBeVisible()
  return panel
}
async function saveFocus(panel: Locator) {
  await panel
    .getByRole('checkbox', { name: '我已核对有效学习片段，确认保存实际时长', exact: true })
    .check()
  await panel.getByRole('button', { name: '保存实际时长', exact: true }).click()
  await expect(panel.getByText('已计入学习', { exact: true })).toBeVisible()
}
async function reopenFocus() {
  await page.getByRole('button', { name: '查看本次计时', exact: true }).click()
  return page.getByRole('dialog', { name: '学习陪伴倒计时', exact: true })
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})

test('manual records split across midnight; real overlap is refused, drafts survive and void/reconfirm preserves data', async () => {
  await launch(`learning-manual-${Date.now()}`)
  await seed()
  const panel = await learningPanel()
  let form = await manual(panel)
  await form.getByRole('button', { name: '保存实际学习记录', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(await actual()).toBe(1200)
  expect(await records('studySessions')).toHaveLength(2)
  expect((await records('tasks'))[0].estimatedSeconds).toBe(3600)
  expect((await records('tasks'))[0].status).toBe('pending')
  form = await manual(panel, '2026-03-01T00:00:00', '2026-03-01T00:20:00')
  await form.getByRole('button', { name: '保存实际学习记录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('重叠')
  // A DOM-visible toast can still be covered by the native dialog's top layer.
  await expect
    .poll(() =>
      page.getByRole('alert').evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return el.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        )
      }),
    )
    .toBe(true)
  await expect(panel.getByRole('alert')).toContainText('重叠')
  await page.screenshot({ path: 'test-results/learning-overlap-desktop.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(430, 900))
  await form.getByRole('button', { name: '保存实际学习记录', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('重叠')
  await expect
    .poll(() =>
      panel.getByRole('alert').evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return el.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        )
      }),
    )
    .toBe(true)
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await page.screenshot({ path: 'test-results/learning-overlap-narrow.png' })
  await panel.getByRole('button', { name: '关闭提示', exact: true }).click()
  await expect(form.getByLabel('学习记录备注', { exact: true })).toHaveValue('跨日实际学习20分钟')
  expect(await records('studySessions')).toHaveLength(2)
  await form.getByRole('button', { name: '取消录入', exact: true }).click()
  const first = panel.getByRole('article').first()
  await first.getByRole('button', { name: '作废记录', exact: true }).click()
  await panel.getByLabel('学习记录作废说明', { exact: true }).fill('测试作废保留')
  await panel.getByRole('button', { name: '确认作废记录', exact: true }).click()
  expect(await actual()).toBe(600)
  await first.getByRole('button', { name: '重新确认记录', exact: true }).click()
  expect(await actual()).toBe(1200)
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/learning-records.png' })
})

test('duration-only requires consent and task completion does not add estimated minutes to actual time', async () => {
  await launch(`learning-duration-${Date.now()}`)
  await seed()
  let panel = await learningPanel()
  await panel.getByRole('button', { name: '手动记录学习', exact: true }).click()
  const form = panel.getByRole('form', { name: '手动记录实际学习', exact: true })
  await form.getByLabel('实际时间记录方式', { exact: true }).selectOption('duration')
  await form.getByLabel('实际学习日期', { exact: true }).fill('2026-02-28')
  await form.getByRole('button', { name: '保存实际学习记录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('知情')
  await form
    .getByRole('checkbox', {
      name: '仅时长无法检查重叠，我确认没有重复补录已记录的学习时间',
      exact: true,
    })
    .check()
  await form.getByRole('button', { name: '保存实际学习记录', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(await actual()).toBe(1200)
  await closePanel()
  await page.getByRole('button', { name: '完成任务：第五阶段专注测试', exact: true }).click()
  expect(await actual()).toBe(1200)
  await expect(
    page.getByRole('heading', { name: '累计实际学习', exact: true }).locator('..'),
  ).toContainText('20')
})

test('record pagination limits rendering while total actual time and full JSON keep all historical rows', async () => {
  await launch(`learning-pages-${Date.now()}`)
  await seed()
  const cycleId = String((await records('cycles'))[0].id)
  await page.evaluate(
    (cycleId) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('XiaokaoyaStudy')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result,
            tx = database.transaction('studySessions', 'readwrite'),
            store = tx.objectStore('studySessions'),
            now = new Date().toISOString()
          for (let i = 0; i < 60; i++)
            store.add({
              id: `legacy-page-${i}`,
              createdAt: now,
              updatedAt: now,
              revision: 1,
              cycleId,
              taskId: null,
              studyDate: '2026-02-28',
              status: 'confirmed',
              timeMode: 'duration_only',
              durationOnlySeconds: 60,
            })
          tx.oncomplete = () => {
            database.close()
            resolve()
          }
          tx.onerror = () => {
            database.close()
            reject(tx.error)
          }
        }
      }),
    cycleId,
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  expect(await actual()).toBe(3600)
  const panel = await learningPanel()
  await expect(panel.getByRole('article')).toHaveCount(50)
  await panel.getByRole('button', { name: '下一页记录', exact: true }).click()
  await expect(panel.getByRole('article')).toHaveCount(10)
  await panel.getByLabel('学习记录日期筛选', { exact: true }).fill('2026-03-01')
  await expect(panel.getByRole('article')).toHaveCount(0)
  await panel.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(panel.getByRole('article')).toHaveCount(50)
  await closePanel()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const file = join(root, 'all-60.json')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  const backup = page.getByRole('dialog', { name: '数据与备份', exact: true })
  await backup.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(backup.getByText(`已导出：${file}`, { exact: true })).toBeVisible()
  expect((await parseBackup(await readFile(file, 'utf8'))).data.studySessions).toHaveLength(60)
})

test('countdown pause, companion switch, due, confirmation and task checkbox count actual time once', async () => {
  test.setTimeout(90000)
  await launch(`learning-countdown-${Date.now()}`)
  await seed()
  let panel = await begin(10, true)
  await expect(panel.getByLabel('本次有效学习时间')).not.toHaveText('00:00:00')
  await panel.getByRole('button', { name: '暂停休息', exact: true }).click()
  const value = await panel.getByLabel('本次有效学习时间').textContent()
  await expect
    .poll(async () => {
      await page.waitForTimeout(1200)
      return panel.getByLabel('本次有效学习时间').textContent()
    })
    .toBe(value)
  expect(await actual()).toBe(0)
  await closePanel()
  await page.getByRole('button', { name: '学习伙伴', exact: true }).click()
  await page.getByRole('button', { name: '选择小猫奶糖', exact: true }).click()
  await closePanel()
  panel = await reopenFocus()
  await expect(panel.getByLabel('本次有效学习时间')).toHaveText(value!)
  await panel.getByRole('button', { name: '继续本次', exact: true }).click()
  await expect(panel.locator('.focus-face').getByRole('status')).toContainText('倒计时结束', {
    timeout: 20000,
  })
  expect(await actual()).toBe(0)
  expect((await records('tasks'))[0].status).toBe('pending')
  await saveFocus(panel)
  expect(await actual()).toBe(10)
  expect(await records('studySessions')).toHaveLength(1)
  await panel.getByRole('checkbox', { name: '关联任务已完成', exact: true }).check()
  expect(await actual()).toBe(10)
  expect((await records('tasks'))[0].status).toBe('completed')
  await page.screenshot({ path: 'test-results/learning-focus.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(430, 900))
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await page.screenshot({ path: 'test-results/learning-focus-narrow.png' })
  await panel.getByRole('button', { name: '再学一段', exact: true }).click()
  await expect(panel.getByLabel('计时关联任务', { exact: true })).toHaveValue(
    String((await records('tasks'))[0].id),
  )
  expect(await actual()).toBe(10)
})

test('native close saves the last interval; offline desktop reopen requires review and never catches up', async () => {
  const profile = `learning-close-${Date.now()}`
  await launch(profile)
  await seed()
  let panel = await begin(30)
  await expect(panel.getByLabel('本次有效学习时间')).not.toHaveText('00:00:00')
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  await launch(profile)
  await app.context().setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  panel = await reopenFocus()
  expect((await records('focusTimers'))[0].status).toBe('review')
  expect(await actual()).toBe(0)
  await expect(panel.getByRole('button', { name: '结束本段', exact: true })).toHaveCount(0)
  const intervals = JSON.stringify((await records('focusTimers'))[0].intervals)
  await page.waitForTimeout(1300)
  expect(JSON.stringify((await records('focusTimers'))[0].intervals)).toBe(intervals)
  await saveFocus(panel)
  expect(await actual()).toBeGreaterThan(0)
  expect(await actual()).toBeLessThan(30)
})

test('lock/suspend interrupts timer; abrupt process exit recovers a persisted checkpoint without auto-resume', async () => {
  test.setTimeout(90000)
  const profile = `learning-interrupt-${Date.now()}`
  await launch(profile)
  await seed()
  let panel = await begin(60)
  await expect(panel.getByLabel('本次有效学习时间')).not.toHaveText('00:00:00')
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('lock-screen')
  })
  await expect(panel.locator('.focus-face').getByRole('status')).toContainText('锁屏已暂停')
  await panel.getByRole('button', { name: '继续本次', exact: true }).click()
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('suspend')
  })
  await expect(panel.locator('.focus-face').getByRole('status')).toContainText('休眠已暂停')
  await panel.getByRole('button', { name: '继续本次', exact: true }).click()
  await expect
    .poll(async () => (await records('focusTimers'))[0].revision, { timeout: 12000 })
    .toBeGreaterThan(5)
  const checkpoint = (await records('focusTimers'))[0]
  const killed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await killed
  await launch(profile)
  panel = await reopenFocus()
  const recovered = (await records('focusTimers'))[0]
  expect(recovered.status).toBe('review')
  expect(recovered.reason).toBe('interrupted')
  expect(recovered.intervals).toEqual(checkpoint.intervals)
  expect(await actual()).toBe(0)
  await saveFocus(panel)
  expect(await records('studySessions')).toHaveLength(1)
})

test('failed native close checkpoint keeps the application open; retry closes safely without counting the gap', async () => {
  const profile = `learning-close-failure-${Date.now()}`
  await launch(profile)
  await seed()
  const panel = await begin(60)
  await expect(panel.getByLabel('本次有效学习时间')).not.toHaveText('00:00:00')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    let failed = false
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'focusTimers' && !failed) {
        failed = true
        throw new DOMException('模拟退出保存失败', 'QuotaExceededError')
      }
      return original.apply(this, args)
    }
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect(page.locator('.timer-error')).toContainText('保留窗口')
  expect(app.windows()).toHaveLength(1)
  expect(await actual()).toBe(0)
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  await launch(profile)
  expect((await records('focusTimers'))[0].status).toBe('review')
  expect(await actual()).toBe(0)
})

test('timer confirmation write failure leaves no partial actual records and retains the confirmation draft for retry', async () => {
  await launch(`learning-failure-${Date.now()}`)
  await seed()
  const panel = await begin(1)
  await expect(panel.locator('.focus-face').getByRole('status')).toContainText('倒计时结束')
  await panel.getByLabel('本次学习备注', { exact: true }).fill('保存失败后保留的输入')
  await panel
    .getByRole('checkbox', { name: '我已核对有效学习片段，确认保存实际时长', exact: true })
    .check()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    let failed = false
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'focusTimers' && !failed) {
        failed = true
        throw new DOMException('模拟计时写入失败', 'QuotaExceededError')
      }
      return original.apply(this, args)
    }
  })
  await panel.getByRole('button', { name: '保存实际时长', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await records('studySessions')).toHaveLength(0)
  expect(await records('timeSegments')).toHaveLength(0)
  await expect(panel.getByLabel('本次学习备注', { exact: true })).toHaveValue(
    '保存失败后保留的输入',
  )
  await panel.getByRole('button', { name: '保存实际时长', exact: true }).click()
  await expect(panel.getByText('已计入学习', { exact: true })).toBeVisible()
  expect(await records('studySessions')).toHaveLength(1)
  expect(await actual()).toBe(1)
})

test('full V5 JSON/CSV restore preserves confirmed records, quarantines pending work and reopens offline', async () => {
  const profile = `learning-backup-${Date.now()}`
  await launch(profile)
  await seed()
  let panel = await learningPanel(),
    form = await manual(panel, '2026-02-28T09:00:00', '2026-02-28T09:20:00')
  await form.getByRole('button', { name: '保存实际学习记录', exact: true }).click()
  await expect(form).toHaveCount(0)
  await closePanel()
  panel = await begin(30)
  await expect(panel.getByLabel('本次有效学习时间')).not.toHaveText('00:00:00')
  await closePanel()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  let backup = page.getByRole('dialog', { name: '数据与备份', exact: true })
  const file = join(root, 'v5.json')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await backup.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(backup.getByText(`已导出：${file}`, { exact: true })).toBeVisible()
  const original = await inspectBackup(await parseBackup(await readFile(file, 'utf8')))
  expect(original.envelope.schemaVersion).toBe(7)
  expect(original.data.focusTimers[0].status).toBe('review')
  expect(original.data.studySessions).toHaveLength(1)
  for (const kind of ['sessions', 'focus-timers']) {
    const csv = join(root, `${kind}.csv`)
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, csv)
    await backup.getByLabel('CSV 导出内容', { exact: true }).selectOption(kind)
    await backup.getByRole('button', { name: '导出 CSV', exact: true }).click()
    await expect(backup.getByText(`已导出：${csv}`, { exact: true })).toBeVisible()
    expect(await readFile(csv, 'utf8')).toContain(kind === 'sessions' ? '手动录入' : '工作状态')
  }
  await closePanel()
  panel = await reopenFocus()
  await saveFocus(panel)
  expect(await actual()).toBeGreaterThan(1200)
  await closePanel()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  backup = page.getByRole('dialog', { name: '数据与备份', exact: true })
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await backup.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await expect(backup.getByText('完整性预检通过', { exact: true })).toBeVisible()
  await backup.getByRole('checkbox', { name: '确认整体替换当前数据', exact: true }).check()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    let failed = false
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'timeSegments' && !failed) {
        failed = true
        throw new DOMException('模拟V5恢复失败', 'QuotaExceededError')
      }
      return original.apply(this, args)
    }
  })
  const beforeFailure = await actual()
  await backup.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(backup.getByText(/恢复未完成，原数据已完整保留或回滚/).first()).toBeVisible()
  expect(await actual()).toBe(beforeFailure)
  expect((await records('focusTimers'))[0].status).toBe('saved')
  await backup.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(backup.getByText(/完整恢复成功/).first()).toBeVisible()
  expect(await actual()).toBe(1200)
  expect((await records('focusTimers'))[0].status).toBe('review')
  await app.close()
  await launch(profile)
  await app.context().setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  expect(await actual()).toBe(1200)
  expect((await records('focusTimers'))[0].intervals).toEqual(
    original.data.focusTimers[0].intervals,
  )
})
