import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { resolve } from 'node:path'

let app: ElectronApplication, page: Page
async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
    ),
  ) as Record<string, string>
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [resolve('.'), '--mute-audio'],
    env: { ...env, XIAOKAOYA_E2E_PROFILE: `navigation-${Date.now()}` },
  })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  expect((await page.evaluate(() => window.desktop.getInfo())).environment).toBe('test')
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2027')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('checkbox', { name: 'CPA · 审计', exact: true }).check()
  await page.getByRole('checkbox', { name: '税务师 · 税法（一）', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
const pages = [
  ['我的科目', '我的年度科目档案'],
  ['学习日历与周计划', '学习计划与日历'],
  ['学习记录与计时', '学习记录与计时'],
  ['学习统计与进度', '学习统计与进度'],
  ['练习、错题与模拟', '练习、错题与历年报告'],
  ['学习伙伴', '选一位学习伙伴'],
  ['励志语与诗词', '励志语与诗词'],
  ['数据与备份', '数据与备份'],
  ['关于与数据', '关于小考鸭与本地数据'],
]
test.afterEach(async () => {
  await app?.close()
})

test('sidebar switches the main page at desktop, tablet and narrow widths without opening dialogs or horizontal overflow', async () => {
  test.setTimeout(120000)
  await launch()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const width of [1440, 1080, 760, 420]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 960),
      width,
    )
    for (const [label, title] of pages) {
      const button = page.locator('.sidebar').getByRole('button', {
        name: label === '我的科目' ? /^我的科目/ : label,
        exact: label !== '我的科目',
      })
      await button.click()
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(button).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('.sidebar [aria-current="page"]')).toHaveCount(1)
      await expect(page.locator('.hero-card')).toHaveCount(0)
      await expect(page.locator('.breadcrumb')).toContainText(
        label === '学习日历与周计划' ? '学习日历' : label,
      )
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
        .toBeLessThanOrEqual(1)
      if (width >= 760) {
        const main = await page.locator('.workspace-surface').boundingBox()
        const sidebar = await page.locator('.sidebar').boundingBox()
        expect(main!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width)
      }
      if (width === 1440 || width === 420)
        await page.screenshot({
          path: `test-results/navigation-${width}-${pages.findIndex((p) => p[0] === label)}.png`,
          fullPage: true,
        })
    }
    await page.getByRole('button', { name: '学习总览', exact: true }).click()
    await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('short dialogs preserve the underlying page, and Source Han Sans actually renders Chinese offline at normal and bold weights', async () => {
  await launch()
  await app.context().setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: '学习日历与周计划', exact: true }).click()
  const planner = page.getByRole('region', { name: '学习计划与日历', exact: true })
  await planner.getByRole('button', { name: '添加学习任务', exact: true }).click()
  const form = page.getByRole('dialog', { name: '安排一个小任务', exact: true })
  await form.getByLabel('任务内容', { exact: true }).fill('页面布局回归任务')
  await form.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(planner).toBeVisible()
  await expect(planner).toContainText('页面布局回归任务')
  await page.getByRole('button', { name: /^我的科目/ }).click()
  await page.getByRole('button', { name: '调整年度选科', exact: true }).click()
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect(page.getByRole('region', { name: '我的年度科目档案', exact: true })).toBeVisible()
  expect(
    await page.evaluate(async () => {
      await document.fonts.load('400 14px "Source Han Sans SC"', '学习计划 CPA 2027')
      await document.fonts.load('700 24px "Source Han Sans SC"', '学习计划')
      return [...document.fonts].some(
        (f) => f.family === 'Source Han Sans SC' && f.status === 'loaded',
      )
    }),
  ).toBe(true)
  const cdp = await app.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  for (const selector of ['#workspace-title', '.curriculum-toolbar .field']) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    expect(
      fonts.some(
        (f: { familyName: string; isCustomFont: boolean; glyphCount: number }) =>
          /Source Han Sans/.test(f.familyName) && f.isCustomFont && f.glyphCount > 0,
      ),
    ).toBe(true)
  }
})
