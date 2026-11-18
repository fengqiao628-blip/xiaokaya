import { returnToOverview } from './navigation-helpers'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { resolve, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const root = resolve('.')
let app: ElectronApplication
let page: Page
async function launch(profile: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
    ),
  ) as Record<string, string>
  env.XIAOKAOYA_E2E_PROFILE = profile
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [root],
    env,
  })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
}
test.afterEach(async () => {
  await app?.close()
})
test('real desktop: select, validate, save, edit, complete, reopen and stay offline', async () => {
  const profile = `flow-${Date.now()}`
  await launch(profile)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  expect(await page.evaluate(() => location.origin)).toBe('app://xiaokaoya')
  const info = await page.evaluate(() => window.desktop.getInfo())
  expect(info.environment).toBe('test')
  expect(info.security).toEqual({ contextIsolated: true, sandboxed: true })
  expect(info.sessionData).toBe(join(info.userData, 'profile'))
  expect(info.userData).toBe(resolve('.runtime/e2e', profile))
  const security = await app.evaluate(({ session }) => ({
    storagePath: session.defaultSession.storagePath,
  }))
  expect(security.storagePath).toBe(info.sessionData)
  expect(
    await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require),
  ).toBe('undefined')

  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await expect(page.getByRole('checkbox')).toHaveCount(12)
  await expect(page.getByText('综合阶段 · 试卷一、试卷二')).toBeVisible()
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('checkbox', { name: '税务师 · 税法（一）', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('测试 · 阅读会计基础概念')
  await page.getByLabel('预计时长（分钟）', { exact: true }).fill('0')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('至少1分钟')
  await expect(page.getByLabel('任务内容', { exact: true })).toHaveValue('测试 · 阅读会计基础概念')
  await page.getByLabel('预计时长（分钟）', { exact: true }).fill('90')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(page.getByTestId('task-row')).toHaveCount(1)
  await page.getByRole('button', { name: '编辑任务：测试 · 阅读会计基础概念', exact: true }).click()
  await page.getByLabel('小备注', { exact: true }).fill('只用于第一阶段验收')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByRole('button', { name: '完成任务：测试 · 阅读会计基础概念', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '撤销完成：测试 · 阅读会计基础概念', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('尚未登记实际学习记录', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '学习伙伴', exact: true }).click()
  await page.getByRole('button', { name: '选择小猫奶糖', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择小猫奶糖', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await returnToOverview(page)
  const oldQuote = await page.locator('blockquote').innerText()
  await page.getByRole('button', { name: '换一句励志语', exact: true }).click()
  await expect(page.locator('blockquote')).not.toHaveText(oldQuote)
  const chosenQuote = await page.locator('blockquote').innerText()
  await page.reload()
  await expect(page.locator('blockquote')).toHaveText(chosenQuote)
  await expect(page.getByRole('button', { name: '小猫奶糖陪着你', exact: true })).toBeVisible()

  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true })
  await app.close()
  await launch(profile)
  await app.context().setOffline(true)
  await page.reload()
  await expect(page.getByTestId('task-row')).toHaveCount(1)
  await expect(page.locator('blockquote')).toHaveText(chosenQuote)
  await expect(page.getByRole('button', { name: '小猫奶糖陪着你', exact: true })).toBeVisible()
  expect(
    await page
      .locator('img')
      .evaluateAll((images) =>
        images.every(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        ),
      ),
  ).toBe(true)
  expect(errors).toEqual([])

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(420, 900))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存学习任务', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/task-form.png' })
  await returnToOverview(page)
  await page.screenshot({ path: 'test-results/narrow.png', fullPage: true })
})

test('new academic year and pause preserve earlier tasks', async () => {
  await launch(`years-${Date.now()}`)
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2027')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('2027年度测试任务')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await page.getByRole('button', { name: '管理我的科目', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'CPA · 会计', exact: true })).toBeChecked()
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).uncheck()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await expect(page.getByTestId('task-row')).toHaveCount(1)
  await expect(page.getByText('你的目标，由你选择', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2030')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await expect(page.getByText('CPA · 2030 年备考', { exact: true })).toBeVisible()
  await expect(page.getByTestId('task-row')).toHaveCount(1)
})

test('database write failure preserves the draft and can be retried without duplicates', async () => {
  await launch(`write-failure-${Date.now()}`)
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('保存失败后应保留的测试草稿')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    ;(window as unknown as { restoreAdd: () => void }).restoreAdd = () => {
      IDBObjectStore.prototype.add = original
    }
    IDBObjectStore.prototype.add = function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === 'tasks')
        throw new DOMException('simulated quota failure', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('输入内容已保留')
  await expect(page.getByLabel('任务内容', { exact: true })).toHaveValue(
    '保存失败后应保留的测试草稿',
  )
  await page.evaluate(() => (window as unknown as { restoreAdd: () => void }).restoreAdd())
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(page.getByTestId('task-row')).toHaveCount(1)
})
