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
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})
test('live completion celebrates once; reopening historical completion keeps the pose without replaying celebration, and click reaction remains available', async () => {
  const profile = `experience-reopen-${Date.now()}`
  await launch(profile)
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('只庆祝一次的任务')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await page.getByRole('button', { name: '完成任务：只庆祝一次的任务', exact: true }).click()
  const pet = page.locator('.hero-pet > .companion-art')
  await expect(pet).toHaveAttribute('data-reaction', 'complete')
  expect(
    await pet.evaluate((el) => getComputedStyle(el.querySelector('.pet-motion')!).animationName),
  ).toBe('pet-cheer')
  await expect(pet).toHaveAttribute('data-reaction', '')
  expect(
    await pet.evaluate((el) => getComputedStyle(el.querySelector('.pet-motion')!).animationName),
  ).not.toBe('pet-cheer')
  await app.close()
  await launch(profile)
  const reopened = page.locator('.hero-pet > .companion-art')
  await expect(reopened).toHaveAttribute('data-state', 'celebrate')
  await expect(reopened).toHaveAttribute('data-reaction', '')
  expect(
    await reopened.evaluate(
      (el) => getComputedStyle(el.querySelector('.pet-motion')!).animationName,
    ),
  ).toBe('pet-breathe')
  await reopened.focus()
  await reopened.press('Enter')
  await expect(reopened).toHaveAttribute('data-reaction', 'click')
  expect(
    await reopened.evaluate(
      (el) => getComputedStyle(el.querySelector('.pet-motion')!).animationName,
    ),
  ).toBe('pet-greet')
})
