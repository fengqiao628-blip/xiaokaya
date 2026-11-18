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
import { expectV6Preserved } from './v6-preservation'
import { createRequire } from 'node:module'
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
let app: ElectronApplication, page: Page
async function launch(profile: string, root = resolve('.')) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined),
  ) as Record<string, string>
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [root, '--mute-audio'],
    env: { ...env, XIAOKAOYA_E2E_PROFILE: profile },
  })
  page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  expect((await page.evaluate(() => window.desktop.getInfo())).environment).toBe('test')
}
const pet = () => page.locator('.hero-pet > .companion-art')
async function partners() {
  await page.getByRole('button', { name: '学习伙伴', exact: true }).click()
  return workspacePanel(page, '选一位学习伙伴')
}
const closePanel = () => returnToOverview(page)
async function seed(title: string) {
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill(title)
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
}
async function rows() {
  return page.evaluate(
    () =>
      new Promise<Record<string, any[]>>((resolve, reject) => {
        const r = indexedDB.open('XiaokaoyaStudy')
        r.onsuccess = () => {
          const d = r.result,
            tables: Record<string, any[]> = {},
            tx = d.transaction([...d.objectStoreNames], 'readonly')
          for (const name of d.objectStoreNames) {
            const get = tx.objectStore(name).getAll()
            get.onsuccess = () => (tables[name] = get.result)
          }
          tx.oncomplete = () => {
            resolve(tables)
            d.close()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
}
async function clapGap(target: Locator, time: number) {
  return target.evaluate((el, time) => {
    for (const part of ['.pet-hand-left', '.pet-hand-right'])
      for (const a of el.querySelector(part)!.getAnimations()) {
        a.pause()
        a.currentTime = time
      }
    const l = el.querySelector('.pet-hand-left ellipse')!.getBoundingClientRect(),
      r = el.querySelector('.pet-hand-right ellipse')!.getBoundingClientRect()
    return (r.left + r.right - l.left - l.right) / 2
  }, time)
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})

test('all five companions hold a book while running, sleep while paused, and bring their two hands together on actual task completion without adding actual time', async () => {
  test.setTimeout(120000)
  for (const [id, name] of [
    ['duck', '小鸭阿鸭'],
    ['cat', '小猫奶糖'],
    ['bear', '小熊栗子'],
    ['rabbit', '小兔糯糯'],
    ['dog', '小狗布丁'],
  ]) {
    const title = `${name}动作测试`
    await launch(`poses-${id}-${Date.now()}`)
    await seed(title)
    const p = await partners()
    await p.getByRole('button', { name: `选择${name}`, exact: true }).click()
    await closePanel()
    await page.getByRole('button', { name: `开始学习：${title}`, exact: true }).click()
    const f = page.getByRole('dialog', { name: '学习陪伴倒计时', exact: true })
    await f.getByLabel('倒计时分钟', { exact: true }).fill('0')
    await f.getByLabel('倒计时秒数', { exact: true }).fill('30')
    await f.getByRole('button', { name: '开始学习', exact: true }).click()
    await expect(pet()).toHaveAttribute('data-state', 'study')
    await expect(pet().getByRole('img', { name: `${name} · 捧书阅读`, exact: true })).toBeVisible()
    expect(
      await pet()
        .locator('.pet-head')
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('pet-reading')
    await f.getByRole('button', { name: '暂停休息', exact: true }).click()
    await expect(pet()).toHaveAttribute('data-state', 'rest')
    await expect(pet().getByRole('img', { name: `${name} · 闭眼睡觉`, exact: true })).toBeVisible()
    await expect(pet().locator('.pet-pillow')).toBeAttached()
    await expect(pet().locator('.pet-eyes-open')).toHaveCount(0)
    await f.getByRole('button', { name: '继续本次', exact: true }).click()
    await expect(pet()).toHaveAttribute('data-state', 'study')
    await f.getByRole('button', { name: '结束本段', exact: true }).click()
    await f
      .getByRole('checkbox', { name: '本次不计入学习，保留工作记录并作废', exact: true })
      .check()
    await f.getByRole('button', { name: '作废本次', exact: true }).click()
    await closePanel()
    await page.getByRole('button', { name: `完成任务：${title}`, exact: true }).click()
    await expect(pet()).toHaveAttribute('data-reaction', 'complete')
    await expect(pet().getByRole('img', { name: `${name} · 鼓掌庆祝`, exact: true })).toBeVisible()
    expect(
      await pet()
        .locator('.pet-hand-left')
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('pet-clap-left')
    const open = await clapGap(pet(), 0),
      contact = await clapGap(pet(), 216)
    expect(open - contact).toBeGreaterThan(12)
    const before = await rows()
    await expect(pet()).toHaveAttribute('data-reaction', '')
    expect(
      await pet()
        .locator('.pet-hand-left')
        .evaluate((el) => el.getAnimations().length),
    ).toBe(0)
    expect(await rows()).toEqual(before)
    expect(before.studySessions).toHaveLength(0)
    expect(before.timeSegments).toHaveLength(0)
    await app.close()
  }
})

test('saved motion off and system reduced motion stop all body, head, blink and hand animation while explicit motion on overrides the system preference', async () => {
  await launch(`poses-motion-${Date.now()}`)
  await seed('减少动态测试')
  let p = await partners()
  await p.getByLabel('伙伴动画偏好').selectOption('off')
  await p.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await closePanel()
  await page.getByRole('button', { name: '完成任务：减少动态测试', exact: true }).click()
  await expect(pet()).toHaveAttribute('data-state', 'celebrate')
  expect(await pet().evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
  p = await partners()
  await p.getByLabel('伙伴动画偏好').selectOption('system')
  await p.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await closePanel()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await pet().click()
  expect(await pet().evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
  p = await partners()
  await p.getByLabel('伙伴动画偏好').selectOption('on')
  await p.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await closePanel()
  await pet().click()
  expect(
    await pet()
      .locator('.pet-motion')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('pet-greet')
  expect((await rows()).studySessions).toHaveLength(0)
})

test('the actual 0.7.3 compiled application upgrades with every V6 row, path, companion and saved animation preference unchanged', async () => {
  const require = createRequire(resolve('package.json')),
    builder = createRequire(require.resolve('electron-builder')),
    asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
  const clone = resolve('.runtime', `poses-upgrade-${Date.now()}`)
  await mkdir(clone)
  asar.extractAll(resolve('.runtime/baseline/0.7.3-before-poses/app-0.7.3.asar'), clone)
  await launch('same-v6', clone)
  await seed('保留旧版动作偏好')
  const p = await partners()
  await p.getByRole('button', { name: '选择小狗布丁', exact: true }).click()
  await p.getByLabel('伙伴动画偏好').selectOption('off')
  await p.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await closePanel()
  const before = await rows(),
    old = await page.evaluate(() => window.desktop.getInfo())
  expect(old.version).toBe('0.7.3')
  await app.close()
  await cp(resolve('out'), join(clone, 'out'), { recursive: true, force: true })
  await writeFile(join(clone, 'package.json'), await readFile('package.json', 'utf8'))
  await launch('same-v6', clone)
  expectV6Preserved(before, await rows())
  expect(await page.evaluate(() => window.desktop.getInfo())).toMatchObject({
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    userData: old.userData,
    sessionData: old.sessionData,
    appId: old.appId,
    databaseName: old.databaseName,
  })
  await expect(pet()).toHaveAttribute('data-motion', 'off')
  await expect(pet().getByRole('img', { name: '小狗布丁 · 睁眼陪伴', exact: true })).toBeVisible()
  expect(await pet().evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
})
