import { returnToOverview } from './navigation-helpers'
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
    Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined),
  ) as Record<string, string>
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [resolve('.')],
    env: { ...env, XIAOKAOYA_E2E_PROFILE: `encouragement-${Date.now()}` },
  })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  expect((await page.evaluate(() => window.desktop.getInfo())).environment).toBe('test')
}
async function close() {
  await returnToOverview(page)
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})

test('offline encouragement rotates all 12 variants without changing daily quote or database rows', async () => {
  await launch()
  await app.context().setOffline(true)
  const card = page.getByRole('region', { name: '伙伴的小声鼓励', exact: true })
  const text = card.locator('p')
  const originalQuote = await page.locator('.hero-copy blockquote').innerText()
  const before = await page.evaluate(async () => {
    const request = indexedDB.open('XiaokaoyaStudy')
    return new Promise<Record<string, unknown[]>>((resolve) => {
      request.onsuccess = () => {
        const d = request.result,
          rows: Record<string, unknown[]> = {},
          tx = d.transaction([...d.objectStoreNames], 'readonly')
        for (const name of d.objectStoreNames) {
          const get = tx.objectStore(name).getAll()
          get.onsuccess = () => {
            rows[name] = get.result
          }
        }
        tx.oncomplete = () => {
          d.close()
          resolve(rows)
        }
      }
    })
  })
  const versions = [await text.innerText()]
  for (let i = 0; i < 11; i++) {
    await card.getByRole('button', { name: '换句鼓励', exact: true }).click()
    versions.push(await text.innerText())
  }
  expect(new Set(versions).size).toBe(12)
  await card.getByRole('button', { name: '换句鼓励', exact: true }).click()
  await expect(text).toHaveText(versions[0])
  await expect(page.locator('.hero-copy blockquote')).toHaveText(originalQuote)
  await expect(card).toHaveAttribute('data-mood', 'ready')
  await card.getByRole('button', { name: '和小鸭阿鸭打个招呼' }).click()
  await expect(card).toHaveAttribute('data-mood', 'clicked')
  const after = await page.evaluate(async () => {
    const request = indexedDB.open('XiaokaoyaStudy')
    return new Promise<Record<string, unknown[]>>((resolve) => {
      request.onsuccess = () => {
        const d = request.result,
          rows: Record<string, unknown[]> = {},
          tx = d.transaction([...d.objectStoreNames], 'readonly')
        for (const name of d.objectStoreNames) {
          const get = tx.objectStore(name).getAll()
          get.onsuccess = () => {
            rows[name] = get.result
          }
        }
        tx.oncomplete = () => {
          d.close()
          resolve(rows)
        }
      }
    })
  })
  expect(after).toEqual(before)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(430, 900))
  await card.scrollIntoViewIfNeeded()
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await page.screenshot({ path: 'test-results/encouragement-narrow.png' })
})

test('text follows real start/pause/resume/end and task completion while time and daily quote stay separate', async () => {
  await launch()
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2027')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('状态鼓励测试')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  const card = page.getByRole('region', { name: '伙伴的小声鼓励', exact: true })
  const quote = await page.locator('.hero-copy blockquote').innerText()
  await page.getByRole('button', { name: '开始学习：状态鼓励测试', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '学习陪伴倒计时', exact: true })
  await panel.getByLabel('倒计时分钟', { exact: true }).fill('1')
  await panel.getByRole('button', { name: '开始学习', exact: true }).click()
  await expect(card).toHaveAttribute('data-mood', 'start')
  await panel.getByRole('button', { name: '暂停休息', exact: true }).click()
  await expect(card).toHaveAttribute('data-mood', 'paused')
  await panel.getByRole('button', { name: '继续本次', exact: true }).click()
  await expect(card).toHaveAttribute('data-mood', 'resumed')
  await panel.getByRole('button', { name: '结束本段', exact: true }).click()
  await expect(card).toHaveAttribute('data-mood', 'ended')
  const focusCard = panel.getByRole('region', { name: '本次学习的小声鼓励', exact: true })
  await expect(focusCard).toHaveAttribute('data-mood', 'ended')
  await expect(focusCard).toBeVisible()
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await page.screenshot({ path: 'test-results/encouragement-focus.png' })
  await close()
  await page.getByRole('button', { name: '完成任务：状态鼓励测试', exact: true }).click()
  await expect(card).toHaveAttribute('data-mood', 'completed')
  await expect(page.locator('.hero-copy blockquote')).toHaveText(quote)
  await page.screenshot({ path: 'test-results/encouragement-completed.png' })
})
