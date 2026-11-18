import { workspacePanel, returnToOverview } from './navigation-helpers'
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
import { todayKey, shiftDate } from '../../src/domain/dates'
import { parseBackup, inspectBackup } from '../../src/shared/backup'

let app: ElectronApplication, page: Page, root: string
async function launch(profile: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
    ),
  ) as Record<string, string>
  env.XIAOKAOYA_E2E_PROFILE = profile
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [resolve('.')],
    env,
  })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  root = (await page.evaluate(() => window.desktop.getInfo())).userData
}
async function seed() {
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2027')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('checkbox', { name: '税务师 · 税法（一）', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function planner() {
  await page.getByRole('button', { name: '学习日历与周计划', exact: true }).click()
  return workspacePanel(page, '学习计划与日历')
}
async function close() {
  await returnToOverview(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function records(table: string) {
  return page.evaluate(
    (table) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open('XiaokaoyaStudy')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result,
            read = db.transaction(table, 'readonly').objectStore(table).getAll()
          read.onerror = () => {
            db.close()
            reject(read.error)
          }
          read.onsuccess = () => {
            db.close()
            resolve(read.result)
          }
        }
      }),
    table,
  )
}
async function addTask(
  panel: Locator,
  title: string,
  {
    date,
    review = false,
    minutes = 60,
    tax = false,
  }: { date?: string; review?: boolean; minutes?: number; tax?: boolean } = {},
) {
  const pool =
    (await panel.getByRole('button', { name: '添加待安排任务', exact: true }).count()) > 0
  await panel
    .getByRole('button', { name: pool ? '添加待安排任务' : '添加学习任务', exact: true })
    .click()
  const form = page.getByRole('dialog', { name: '安排一个小任务', exact: true })
  await form
    .getByLabel('学习科目', { exact: true })
    .selectOption({ label: tax ? '税务师 · 税法（一） · 2027' : 'CPA · 会计 · 2027' })
  await form.getByLabel('任务内容', { exact: true }).fill(title)
  await form.getByLabel('预计时长（分钟）', { exact: true }).fill(String(minutes))
  if (review) await form.getByLabel('任务类型', { exact: true }).selectOption('review')
  if (date) {
    await form.getByRole('checkbox', { name: '暂不安排日期，放入待安排池', exact: true }).uncheck()
    await form.getByLabel('安排日期', { exact: true }).fill(date)
  }
  await form.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(form).toHaveCount(0)
  const result = workspacePanel(page, '学习计划与日历')
  await expect(result).toBeVisible()
  return result
}
async function saveGoal(panel: Locator, hours: string, allocation: string) {
  await panel.getByRole('button', { name: '设置本周目标', exact: true }).click()
  const form = panel.getByRole('form', { name: '设置本周学习目标', exact: true })
  await form.getByLabel('本周目标小时', { exact: true }).fill(hours)
  await form.getByRole('checkbox', { name: '本周选择：CPA · 会计 · 2027', exact: true }).check()
  await form.getByLabel('科目目标小时：CPA · 会计 · 2027', { exact: true }).fill(allocation)
  await form.getByLabel('本周重点', { exact: true }).fill('按自己的节奏安排，留出复习时间')
  await form.getByRole('button', { name: '保存本周目标', exact: true }).click()
  await expect(form).toHaveCount(0)
}
async function saveDialog(file: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
}
async function saveDeadline(panel: Locator, kind: string, date: string) {
  await panel.getByRole('button', { name: '管理考试日期', exact: true }).click()
  const form = panel.getByRole('form', { name: '编辑考试日期', exact: true })
  await form
    .getByLabel('日期所属年度科目', { exact: true })
    .selectOption({ label: 'CPA · 会计 · 2027' })
  await form.getByLabel('考试日期节点', { exact: true }).selectOption(kind)
  await form.getByLabel('节点日期', { exact: true }).fill(date)
  await form.getByRole('button', { name: '保存日期提醒', exact: true }).click()
  await expect(form).toHaveCount(0)
}
const row = (panel: Locator, title: string) =>
  panel.getByRole('article', { name: `计划任务：${title}`, exact: true })
test.afterEach(async () => {
  await app?.close()
})

test('flexible weekly allocations, undated review task, scheduling and cross-year postponement keep one task and real time separate', async () => {
  test.setTimeout(90000)
  await launch(`planning-flow-${Date.now()}`)
  await seed()
  let panel = await planner()
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2027-12-29')
  await saveGoal(panel, '18', '6')
  await panel.getByRole('button', { name: '设置本周目标', exact: true }).click()
  const goal = panel.getByRole('form', { name: '设置本周学习目标', exact: true })
  await goal
    .getByRole('checkbox', { name: '本周选择：税务师 · 税法（一） · 2027', exact: true })
    .check()
  await goal.getByLabel('科目目标小时：税务师 · 税法（一） · 2027', { exact: true }).fill('8')
  await goal.getByRole('button', { name: '保存本周目标', exact: true }).click()
  await expect(goal).toHaveCount(0)
  panel = await addTask(panel, '周三两小时学习', { minutes: 120 })
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2027-12-30')
  panel = await addTask(panel, '周四三小时复习', { minutes: 180, review: true, tax: true })
  await expect(panel.getByRole('region', { name: '2027-12-29安排', exact: true })).toContainText(
    '预计 2小时',
  )
  await expect(panel.getByRole('region', { name: '2027-12-30安排', exact: true })).toContainText(
    '预计 3小时',
  )
  await expect(panel.locator('.planner-metrics > div').nth(0)).toContainText('18小时')
  await expect(panel.locator('.planner-metrics > div').nth(1)).toContainText('5小时')
  await panel.getByRole('button', { name: /^待安排池/ }).click()
  panel = await addTask(panel, '待安排会计复习', { review: true, minutes: 45 })
  await expect(row(panel, '待安排会计复习')).toContainText('尚未安排日期')
  const original = (await records('tasks')).find((task) => task.title === '待安排会计复习')!
  expect(original.plannedDate).toBeNull()
  await expect(panel.locator('.planner-metrics > div').nth(1)).toContainText('5小时')
  await row(panel, '待安排会计复习')
    .getByRole('button', { name: '调整日期：待安排会计复习', exact: true })
    .click()
  let form = panel.getByRole('form', { name: '调整任务日期', exact: true })
  await form.getByLabel('安排目标日期', { exact: true }).fill('2027-12-31')
  await form.getByLabel('日期调整说明', { exact: true }).fill('年底重新安排')
  await form.getByRole('button', { name: '确认安排日期', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(row(panel, '待安排会计复习')).toHaveCount(0)
  await panel.getByRole('button', { name: '周', exact: true }).click()
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2027-12-31')
  await row(panel, '待安排会计复习')
    .getByRole('button', { name: '延期任务：待安排会计复习', exact: true })
    .click()
  form = panel.getByRole('form', { name: '调整任务日期', exact: true })
  await expect(form.getByLabel('安排目标日期', { exact: true })).toHaveValue('2028-01-01')
  await form.getByRole('button', { name: '确认延期', exact: true }).click()
  await expect(form).toHaveCount(0)
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2028-01-01')
  await expect(row(panel, '待安排会计复习')).toContainText('已延期')
  const after = (await records('tasks')).find((task) => task.title === '待安排会计复习')!
  expect(after.id).toBe(original.id)
  expect(after.plannedDate).toBe('2028-01-01')
  expect((await records('tasks')).length).toBe(3)
  await row(panel, '待安排会计复习')
    .getByRole('button', { name: '安排记录：待安排会计复习', exact: true })
    .click()
  await expect(panel.locator('.schedule-history')).toContainText('2027-12-31 → 2028-01-01')
  await panel.getByRole('button', { name: '关闭安排记录', exact: true }).click()
  await row(panel, '待安排会计复习')
    .getByRole('button', { name: '完成计划任务：待安排会计复习', exact: true })
    .click()
  await expect(row(panel, '待安排会计复习')).toContainText('已完成')
  await expect(panel.locator('.planner-metrics > div').nth(2)).toContainText('0分钟')
  await mkdir('test-results', { recursive: true })
  await panel.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: 'test-results/planning-week.png' })
})

test('year/month/week/day calendars include leap days and manually maintained dates sync with exam dossiers', async () => {
  test.setTimeout(90000)
  await launch(`planning-calendar-${Date.now()}`)
  await seed()
  const panel = await planner()
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2028-02-29')
  await panel.getByRole('button', { name: '月', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看2028-02-29', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '年', exact: true }).click()
  await expect(panel.locator('.year-calendar .month-calendar')).toHaveCount(12)
  await panel.getByRole('button', { name: '查看2028-02-29', exact: true }).click()
  await expect(panel.getByRole('button', { name: '日', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2028-01-02')
  await panel.getByRole('button', { name: '周', exact: true }).click()
  await expect(panel.locator('.week-day-card').first()).toHaveAttribute(
    'aria-label',
    '2027-12-27安排',
  )
  for (const [kind, date] of [
    ['registration_open', '2028-02-01'],
    ['registration_close', '2028-02-20'],
    ['payment_due', '2028-02-21'],
    ['admission_ticket', '2028-02-28'],
    ['exam', '2028-02-29'],
    ['results_day', '2028-03-10'],
  ])
    await saveDeadline(panel, kind, date)
  expect(await records('tasks')).toHaveLength(0)
  expect(await records('examMilestones')).toHaveLength(5)
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2028-02-29')
  await panel.getByRole('button', { name: '月', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看2028-02-29', exact: true })).toContainText(
    '1项日期提醒',
  )
  await expect(panel.locator('.day-exam-reminder')).toContainText('考试日期')
  await panel.getByLabel('日历考试分类', { exact: true }).selectOption('tax')
  await expect(panel.locator('.day-exam-reminder')).toHaveCount(0)
  await panel.getByLabel('日历考试分类', { exact: true }).selectOption('all')
  await expect(panel.locator('.day-exam-reminder')).toHaveCount(1)
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2029-12-31')
  await panel.getByRole('button', { name: '下一个日历周期', exact: true }).click()
  await expect(panel.getByLabel('日历定位日期', { exact: true })).toHaveValue('2030-01-31')
  await close()
  await page.getByRole('button', { name: /^我的科目/ }).click()
  const dossier = workspacePanel(page, '我的年度科目档案')
  await dossier.getByLabel('查看备考年份', { exact: true }).selectOption('2027')
  await dossier.getByRole('button', { name: '查看CPA · 会计 · 2027', exact: true }).click()
  await expect(dossier.getByLabel('考试日期', { exact: true })).toHaveValue('2028-02-29')
  await expect(dossier.getByLabel('学习状态', { exact: true })).toHaveValue('planned')
  await expect(dossier.getByLabel('报名与参考状态', { exact: true })).toHaveValue('not_planned')
  await expect(dossier.getByLabel('考试结果', { exact: true })).toHaveValue('unrecorded')
})

test('V4 JSON restore, planning CSV types, offline reopen and narrow calendars preserve undated tasks and weekly targets', async () => {
  test.setTimeout(90000)
  const profile = `planning-backup-${Date.now()}`
  await launch(profile)
  await seed()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let panel = await planner()
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2028-02-29')
  await saveGoal(panel, '8', '8')
  panel = await addTask(panel, '闰日章节安排', { minutes: 90 })
  await saveDeadline(panel, 'registration_close', '2028-02-29')
  await panel.getByRole('button', { name: /^待安排池/ }).click()
  panel = await addTask(panel, '离线待安排复习', { review: true, minutes: 30 })
  await close()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  let backup = workspacePanel(page, '数据与备份')
  const file = join(root, 'complete-v4.json')
  await saveDialog(file)
  await backup.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(backup.locator('.backup-result')).toContainText('complete-v4.json')
  const original = await inspectBackup(await parseBackup(await readFile(file, 'utf8')))
  expect(original.envelope.schemaVersion).toBe(7)
  expect(original.counts.weeklyPlans).toBe(1)
  expect(original.counts.weeklySubjectTargets).toBe(1)
  expect(original.counts.taskScheduleHistory).toBe(2)
  expect(original.counts.examMilestones).toBe(1)
  for (const kind of ['weekly-plans', 'weekly-targets', 'schedule-history', 'exam-dates']) {
    const csv = join(root, `${kind}.csv`)
    await saveDialog(csv)
    await backup.getByLabel('CSV 导出内容', { exact: true }).selectOption(kind)
    await backup.getByRole('button', { name: '导出 CSV', exact: true }).click()
    await expect(backup.locator('.backup-result')).toContainText(`${kind}.csv`)
    expect((await readFile(csv, 'utf8')).trim().split('\r\n').length).toBeGreaterThan(1)
  }
  await close()
  panel = await planner()
  await saveGoal(panel, '10', '6')
  await row(panel, '离线待安排复习')
    .getByRole('button', { name: '调整日期：离线待安排复习', exact: true })
    .click()
  let form = panel.getByRole('form', { name: '调整任务日期', exact: true })
  await form.getByLabel('安排目标日期', { exact: true }).fill('2028-02-29')
  await form.getByRole('button', { name: '确认安排日期', exact: true }).click()
  await expect(form).toHaveCount(0)
  await close()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  backup = workspacePanel(page, '数据与备份')
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await backup.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await expect(backup.locator('.restore-preview')).toContainText('各科周目标')
  await backup.getByRole('checkbox').check()
  await backup.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(backup.locator('.backup-result')).toContainText('完整恢复成功')
  await app.close()
  await launch(profile)
  page.on('pageerror', (error) => errors.push(error.message))
  await app.context().setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  panel = await planner()
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2028-02-29')
  await expect(panel.locator('.planner-metrics > div').nth(0)).toContainText('8小时')
  await panel.getByRole('button', { name: /^待安排池/ }).click()
  await expect(row(panel, '离线待安排复习')).toContainText('尚未安排日期')
  await expect(row(panel, '离线待安排复习')).toContainText('复习')
  await panel.getByRole('button', { name: '月', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看2028-02-29', exact: true })).toContainText(
    '1项任务',
  )
  await panel.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: 'test-results/planning-month.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(430, 900))
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(
    true,
  )
  await page.screenshot({ path: 'test-results/planning-narrow.png' })
  await panel.getByRole('button', { name: '周', exact: true }).click()
  await expect(panel.locator('.week-day-card')).toHaveCount(7)
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(
    true,
  )
  expect(errors).toEqual([])
})

test('failed date and weekly-target writes retain drafts and roll back before a single successful retry', async () => {
  await launch(`planning-failure-${Date.now()}`)
  await seed()
  let panel = await planner()
  await panel.getByRole('button', { name: /^待安排池/ }).click()
  panel = await addTask(panel, '计划写入失败重试', { review: true })
  await row(panel, '计划写入失败重试')
    .getByRole('button', { name: '调整日期：计划写入失败重试', exact: true })
    .click()
  let form = panel.getByRole('form', { name: '调整任务日期', exact: true })
  await form.getByLabel('安排目标日期', { exact: true }).fill('2027-01-04')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    let failed = false
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'tasks' && !failed) {
        failed = true
        throw new DOMException('模拟日期写入失败', 'QuotaExceededError')
      }
      return original.apply(this, args)
    }
  })
  await form.getByRole('button', { name: '确认安排日期', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(form.getByLabel('安排目标日期', { exact: true })).toHaveValue('2027-01-04')
  expect((await records('tasks'))[0].plannedDate).toBeNull()
  expect(await records('taskScheduleHistory')).toHaveLength(1)
  await form.getByRole('button', { name: '确认安排日期', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(await records('tasks')).toHaveLength(1)
  expect(await records('taskScheduleHistory')).toHaveLength(2)
  await panel.getByLabel('日历定位日期', { exact: true }).fill('2027-01-04')
  await panel.getByRole('button', { name: '设置本周目标', exact: true }).click()
  form = panel.getByRole('form', { name: '设置本周学习目标', exact: true })
  await form.getByLabel('本周目标小时', { exact: true }).fill('14')
  await form.getByRole('checkbox', { name: '本周选择：CPA · 会计 · 2027', exact: true }).check()
  await form.getByLabel('科目目标小时：CPA · 会计 · 2027', { exact: true }).fill('3')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    let failed = false
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'weeklySubjectTargets' && !failed) {
        failed = true
        throw new DOMException('模拟科目目标写入失败', 'QuotaExceededError')
      }
      return original.apply(this, args)
    }
  })
  await form.getByRole('button', { name: '保存本周目标', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(form.getByLabel('本周目标小时', { exact: true })).toHaveValue('14')
  expect(await records('weeklyPlans')).toHaveLength(0)
  expect(await records('weeklySubjectTargets')).toHaveLength(0)
  await form.getByRole('button', { name: '保存本周目标', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(await records('weeklyPlans')).toHaveLength(1)
  expect(await records('weeklySubjectTargets')).toHaveLength(1)
})

test('overdue tasks appear in pending without losing the old calendar date or silently rolling forward', async () => {
  await launch(`planning-overdue-${Date.now()}`)
  await seed()
  let panel = await planner()
  const yesterday = shiftDate(todayKey(), -1)
  panel = await addTask(panel, '过期任务不自动顺延', { date: yesterday })
  await panel.getByRole('button', { name: /^待安排池/ }).click()
  await expect(row(panel, '过期任务不自动顺延')).toContainText(`原安排：${yesterday}`)
  expect((await records('tasks'))[0].plannedDate).toBe(yesterday)
  await close()
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  panel = await planner()
  await panel.getByLabel('日历定位日期', { exact: true }).fill(yesterday)
  await panel.getByRole('button', { name: '日', exact: true }).click()
  await expect(row(panel, '过期任务不自动顺延')).toBeVisible()
  await row(panel, '过期任务不自动顺延')
    .getByRole('button', { name: '完成计划任务：过期任务不自动顺延', exact: true })
    .click()
  await panel.getByRole('button', { name: /^待安排池/ }).click()
  await expect(row(panel, '过期任务不自动顺延')).toHaveCount(0)
  expect((await records('tasks'))[0].plannedDate).toBe(yesterday)
  expect(await records('taskScheduleHistory')).toHaveLength(1)
})
