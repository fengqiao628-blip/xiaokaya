import { workspacePanel, returnToOverview } from './navigation-helpers'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { resolve, join } from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { inspectBackup, parseBackup } from '../../src/shared/backup'
import { DATABASE_VERSION } from '../../src/shared/identity'

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
async function closePanel() {
  await returnToOverview(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function openWorkspace() {
  await page.getByRole('button', { name: /^我的科目/ }).click()
  return workspacePanel(page, '我的年度科目档案')
}
async function seed(comprehensive = false) {
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2027')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  if (comprehensive)
    await page.getByRole('checkbox', { name: 'CPA · 职业能力综合测试', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function addMaterial(title: string, kind: 'textbook' | 'video') {
  await page.getByRole('button', { name: '添加资料', exact: true }).click()
  const form = page.getByRole('form', { name: '添加学习资料', exact: true })
  await form.getByLabel('资料名称', { exact: true }).fill(title)
  await form.getByLabel('资料类型', { exact: true }).selectOption(kind)
  await form.getByLabel('版本说明', { exact: true }).fill('2027版')
  await form.getByRole('button', { name: '保存学习资料', exact: true }).click()
  await expect(form).toHaveCount(0)
}
async function addChapter(title: string) {
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  const form = page.getByRole('form', { name: '添加学习章节', exact: true })
  await form.getByLabel('章节名称', { exact: true }).fill(title)
  await form.getByLabel('知识掌握星级', { exact: true }).selectOption('1')
  await form.getByRole('button', { name: '保存学习章节', exact: true }).click()
  await expect(form).toHaveCount(0)
}
async function progress(title: string, materialLabel: string, percent: number) {
  await page.getByRole('button', { name: `记录资料进度：${title}`, exact: true }).click()
  const form = page.getByRole('form', { name: `${title}资料进度`, exact: true })
  await form.getByLabel('进度对应资料', { exact: true }).selectOption({ label: materialLabel })
  await form.getByLabel('学习进度百分比', { exact: true }).fill(String(percent))
  await form.getByRole('button', { name: '保存资料进度', exact: true }).click()
  await expect(form).toHaveCount(0)
}
async function saveDialog(file: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
}
test.afterEach(async () => {
  await app?.close()
})

test('yearly dossiers, independent statuses, separate resource progress, archive, task links, JSON restore and offline reopen', async () => {
  test.setTimeout(90000)
  const profile = `curriculum-${Date.now()}`,
    title = '第一章 · 进度与掌握独立'
  await launch(profile)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seed(true)
  let workspace = await openWorkspace()
  await workspace.getByLabel('查看备考年份', { exact: true }).selectOption('2027')
  await workspace.getByRole('button', { name: '查看CPA · 会计 · 2027', exact: true }).click()
  await workspace.getByLabel('学习状态', { exact: true }).selectOption('studying')
  await workspace.getByLabel('报名与参考状态', { exact: true }).selectOption('registered')
  await workspace.getByLabel('考试结果', { exact: true }).selectOption('passed')
  await workspace.getByRole('button', { name: '保存独立状态', exact: true }).click()
  await expect(workspace.getByLabel('学习状态', { exact: true })).toHaveValue('studying')
  await expect(workspace.getByLabel('报名与参考状态', { exact: true })).toHaveValue('registered')
  await expect(workspace.getByLabel('考试结果', { exact: true })).toHaveValue('passed')
  await addMaterial('会计基础教材', 'textbook')
  await addMaterial('会计基础课程', 'video')
  await addChapter(title)
  await progress(title, '教材 · 会计基础教材', 100)
  await progress(title, '视频 · 会计基础课程', 25)
  let chapter = workspace
    .locator('.chapter-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  await expect(chapter).toContainText('章节完成：未开始')
  await expect(chapter).toContainText('★☆☆☆☆')
  await expect(chapter).toContainText('100%')
  await expect(chapter).toContainText('25%')
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/curriculum-desktop.png' })
  await closePanel()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('学习科目', { exact: true }).selectOption({ label: 'CPA · 会计 · 2027' })
  await page.getByLabel('关联章节', { exact: true }).selectOption({ label: title })
  await page.getByLabel('任务内容', { exact: true }).fill('关联年度章节的任务')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  workspace = await openWorkspace()
  await workspace.getByRole('button', { name: '调整年度选科', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2028')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  workspace = await openWorkspace()
  await workspace.getByLabel('查看备考年份', { exact: true }).selectOption('2028')
  await expect(workspace.getByLabel('考试结果', { exact: true })).toHaveValue('unrecorded')
  await expect(workspace.locator('.chapter-card')).toHaveCount(0)
  await workspace.getByLabel('查看备考年份', { exact: true }).selectOption('2027')
  await workspace.getByRole('button', { name: '查看CPA · 会计 · 2027', exact: true }).click()
  await expect(workspace.getByLabel('考试结果', { exact: true })).toHaveValue('passed')
  await workspace
    .getByRole('checkbox', { name: '确认归档本周期，保留全部历史数据', exact: true })
    .check()
  await workspace.getByRole('button', { name: '归档周期', exact: true }).click()
  await expect(
    workspace.getByRole('button', { name: '查看CPA · 会计 · 2027', exact: true }),
  ).toHaveCount(0)
  await workspace.getByRole('checkbox', { name: '显示已归档周期', exact: true }).check()
  await workspace.getByRole('button', { name: '查看CPA · 会计 · 2027', exact: true }).click()
  await workspace.getByRole('button', { name: '恢复周期', exact: true }).click()
  await expect(workspace.getByLabel('学习状态', { exact: true })).toHaveValue('studying')
  await expect(workspace.getByLabel('报名与参考状态', { exact: true })).toHaveValue('registered')
  await expect(workspace.getByLabel('考试结果', { exact: true })).toHaveValue('passed')
  await expect(workspace.locator('.chapter-card')).toContainText('100%')
  await closePanel()
  const file = join(root, 'complete-v3.json'),
    csv = join(root, 'chapters-v3.csv')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  let backup = workspacePanel(page, '数据与备份')
  await saveDialog(file)
  await backup.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(backup.locator('.backup-result')).toContainText('已导出')
  const checked = await inspectBackup(await parseBackup(await readFile(file, 'utf8')))
  expect(checked.envelope.schemaVersion).toBe(DATABASE_VERSION)
  expect(checked.data.materials).toHaveLength(2)
  expect(checked.data.chapters).toHaveLength(1)
  expect(checked.data.materialProgress).toHaveLength(2)
  expect(checked.data.tasks[0].chapterId).toBe(checked.data.chapters[0].id)
  await saveDialog(csv)
  await backup.getByLabel('CSV 导出内容', { exact: true }).selectOption('chapters')
  await backup.getByRole('button', { name: '导出 CSV', exact: true }).click()
  await expect(backup.locator('.backup-result')).toContainText('chapters-v3.csv')
  expect(await readFile(csv, 'utf8')).toContain('会计基础课程')
  await closePanel()
  workspace = await openWorkspace()
  await workspace.getByLabel('查看备考年份', { exact: true }).selectOption('2027')
  await workspace.getByRole('button', { name: '查看CPA · 会计 · 2027', exact: true }).click()
  await workspace.getByRole('button', { name: `编辑章节：${title}`, exact: true }).click()
  await workspace.getByLabel('知识掌握星级', { exact: true }).selectOption('5')
  await workspace.getByRole('button', { name: '保存学习章节', exact: true }).click()
  await expect(workspace.locator('.chapter-card')).toContainText('★★★★★')
  await closePanel()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  backup = workspacePanel(page, '数据与备份')
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await backup.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await expect(backup.locator('.restore-preview')).toContainText('资料章节进度')
  await backup.getByRole('checkbox').check()
  await backup.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(backup.locator('.backup-result')).toContainText('完整恢复成功')
  await closePanel()
  await app.close()
  await launch(profile)
  await app.context().setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  await expect(page.getByText('关联年度章节的任务', { exact: true })).toBeVisible()
  workspace = await openWorkspace()
  await workspace.getByLabel('查看备考年份', { exact: true }).selectOption('2027')
  await workspace.getByRole('button', { name: '查看CPA · 会计 · 2027', exact: true }).click()
  chapter = workspace.locator('.chapter-card')
  await expect(chapter).toContainText('★☆☆☆☆')
  await expect(chapter).toContainText('100%')
  await expect(chapter).toContainText('25%')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(430, 900))
  await expect(workspace.getByRole('button', { name: '添加章节', exact: true })).toBeVisible()
  expect(
    await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth + 2),
  ).toBe(true)
  await page.screenshot({ path: 'test-results/curriculum-narrow.png' })
  expect(errors).toEqual([])
})

test('a chapter save failure keeps the draft and retry creates exactly one chapter', async () => {
  await launch(`curriculum-failure-${Date.now()}`)
  await seed()
  const workspace = await openWorkspace()
  await workspace.getByRole('button', { name: '添加章节', exact: true }).click()
  const form = workspace.getByRole('form', { name: '添加学习章节', exact: true })
  await form.getByLabel('章节名称', { exact: true }).fill('失败后重试的章节')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    let failed = false
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'chapters' && !failed) {
        failed = true
        throw new DOMException('模拟章节写入失败', 'QuotaExceededError')
      }
      return original.apply(this, args)
    }
  })
  await form.getByRole('button', { name: '保存学习章节', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(form.getByLabel('章节名称', { exact: true })).toHaveValue('失败后重试的章节')
  await expect(workspace.locator('.chapter-card')).toHaveCount(0)
  await form.getByRole('button', { name: '保存学习章节', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(workspace.locator('.chapter-card')).toHaveCount(1)
})

test('comprehensive paper subitems remain internal and resource choices respect the chapter paper', async () => {
  await launch(`curriculum-papers-${Date.now()}`)
  await seed(true)
  const workspace = await openWorkspace()
  await workspace
    .getByRole('button', { name: '查看CPA · 职业能力综合测试 · 2027', exact: true })
    .click()
  await workspace.getByRole('button', { name: '添加资料', exact: true }).click()
  let form = workspace.getByRole('form', { name: '添加学习资料', exact: true })
  await form.getByLabel('资料名称', { exact: true }).fill('试卷二专用教材')
  await form.getByLabel('综合试卷子项', { exact: true }).selectOption({ label: '试卷二' })
  await form.getByRole('button', { name: '保存学习资料', exact: true }).click()
  await expect(form).toHaveCount(0)
  await workspace.getByRole('button', { name: '添加章节', exact: true }).click()
  form = workspace.getByRole('form', { name: '添加学习章节', exact: true })
  await form.getByLabel('章节名称', { exact: true }).fill('试卷一案例')
  await form.getByLabel('综合试卷子项', { exact: true }).selectOption({ label: '试卷一' })
  await form.getByRole('button', { name: '保存学习章节', exact: true }).click()
  await expect(form).toHaveCount(0)
  const button = workspace.getByRole('button', { name: '记录资料进度：试卷一案例', exact: true })
  await expect(button).toBeDisabled()
  await addMaterial('综合通用视频', 'video')
  await progress('试卷一案例', '视频 · 综合通用视频', 40)
  await expect(workspace.locator('.chapter-card')).toContainText('40%')
  await closePanel()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page
    .getByLabel('学习科目', { exact: true })
    .selectOption({ label: 'CPA · 职业能力综合测试 · 2027' })
  await page.getByLabel('关联章节', { exact: true }).selectOption({ label: '试卷一案例 · 试卷一' })
  await page.getByLabel('任务内容', { exact: true }).fill('综合试卷一任务')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('综合试卷一任务', { exact: true })).toBeVisible()
})
