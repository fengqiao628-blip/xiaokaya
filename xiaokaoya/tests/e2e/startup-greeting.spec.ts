import { workspacePanel, returnToOverview } from './navigation-helpers'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { expectV6Preserved } from './v6-preservation'
import { createHash } from 'node:crypto'
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
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  expect((await page.evaluate(() => window.desktop.getInfo())).environment).toBe('test')
}
async function observe() {
  await page.evaluate(() => {
    const state = ((window as any).greetingProbe = {
      calls: [] as string[],
      last: null as HTMLMediaElement | null,
    })
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      this.muted = true
      state.calls.push(this.src)
      state.last = this
      return play.call(this)
    }
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
}
const count = () => page.evaluate(() => (window as any).greetingProbe.calls.length)
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
async function partners() {
  await page.getByRole('button', { name: '学习伙伴', exact: true }).click()
  return workspacePanel(page, '选一位学习伙伴')
}
const closePanel = () => returnToOverview(page)
async function prepare(profile: string, root = resolve('.')) {
  await launch(profile, root)
  const p = await partners()
  await p.getByLabel('声音总开关').check()
  await closePanel()
  await app.close()
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})

test('opening alone reads the exact daily choice offline once, finishes, never adds learning time, and reads again on a new process', async () => {
  const profile = `greeting-on-${Date.now()}`
  await prepare(profile)
  await launch(profile)
  await observe()
  await app.context().setOffline(true)
  const before = await rows()
  const text = await page.locator('.hero-copy blockquote').innerText()
  const file = createHash('sha256').update(text.trim().normalize('NFC')).digest('hex') + '.wav'
  await expect.poll(count).toBe(1)
  expect(await page.evaluate(() => (window as any).greetingProbe.calls[0])).toBe(
    `app://xiaokaoya/voices/serena/${file}`,
  )
  await expect
    .poll(() => page.evaluate(() => (window as any).greetingProbe.last.currentTime))
    .toBeGreaterThan(0.05)
  await expect
    .poll(() => page.evaluate(() => (window as any).greetingProbe.last.ended), { timeout: 25000 })
    .toBe(true)
  await page.waitForTimeout(1300)
  expect(await count()).toBe(1)
  expect(await rows()).toEqual(before)
  expect(before.studySessions).toHaveLength(0)
  expect(before.focusTimers).toHaveLength(0)
  await app.close()
  await launch(profile)
  await observe()
  await expect.poll(count).toBe(1)
  expect(await rows()).toEqual(before)
})

test('renderer reload, focus and an actual JSON restore never repeat this process startup greeting', async () => {
  const profile = `greeting-restore-${Date.now()}`
  await prepare(profile)
  await launch(profile)
  await observe()
  await expect.poll(count).toBe(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  await observe()
  await page.waitForTimeout(1500)
  expect(await count()).toBe(0)
  const info = await page.evaluate(() => window.desktop.getInfo()),
    file = join(info.userData, 'greeting-restore.json')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(page.locator('.backup-result')).toContainText('已导出')
  await closePanel()
  const before = await rows(),
    p = await partners()
  await p.getByLabel('伙伴音量').fill('20')
  await p.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await closePanel()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await page.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await page.getByRole('checkbox', { name: '确认整体替换当前数据', exact: true }).check()
  await page.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(page.locator('.backup-result')).toContainText('完整恢复成功')
  await closePanel()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(1500)
  expect(await count()).toBe(0)
  expect(await rows()).toEqual(before)
  expect(await page.evaluate(() => window.desktop.speech!.claimStartupGreeting())).toBe(false)
})

test('a muted or zero-volume opening stays silent and enabling sound later does not catch it up', async () => {
  const profile = `greeting-muted-${Date.now()}`
  await launch(profile)
  await observe()
  await page.waitForTimeout(1200)
  expect(await count()).toBe(0)
  let p = await partners()
  await p.getByLabel('声音总开关').check()
  await closePanel()
  await page.waitForTimeout(1200)
  expect(await count()).toBe(0)
  p = await partners()
  await p.getByLabel('伙伴音量').fill('0')
  await p.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await closePanel()
  await app.close()
  await launch(profile)
  await observe()
  await page.waitForTimeout(1200)
  expect(await count()).toBe(0)
  p = await partners()
  await p.getByLabel('伙伴音量').fill('35')
  await p.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await closePanel()
  await page.waitForTimeout(1200)
  expect(await count()).toBe(0)
})

test('lock and mute stop the startup clip immediately without a replay on unlock or focus', async () => {
  const profile = `greeting-cancel-${Date.now()}`
  await prepare(profile)
  await launch(profile)
  await observe()
  await expect.poll(count).toBe(1)
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
  await expect.poll(() => page.evaluate(() => (window as any).greetingProbe.last.paused)).toBe(true)
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(1300)
  expect(await count()).toBe(1)
  await app.close()
  await launch(profile)
  await observe()
  await expect.poll(count).toBe(1)
  const p = await partners()
  await p.getByLabel('声音总开关').uncheck()
  expect(await page.evaluate(() => (window as any).greetingProbe.last.paused)).toBe(true)
  await p.getByLabel('声音总开关').check()
  await page.waitForTimeout(1300)
  expect(await count()).toBe(1)
})

test('the real 0.7.2 compiled application upgrades to this patch with identical V6 rows and paths; daily startup uses the old choice', async () => {
  const require = createRequire(resolve('package.json')),
    builder = createRequire(require.resolve('electron-builder')),
    asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
  const clone = resolve('.runtime', `greeting-upgrade-${Date.now()}`)
  await mkdir(clone)
  asar.extractAll(resolve('.runtime/baseline/0.7.2-before-startup/app-0.7.2.asar'), clone)
  await prepare('same-v6', clone)
  await launch('same-v6', clone)
  const old = await page.evaluate(() => window.desktop.getInfo()),
    before = await rows(),
    text = await page.locator('.hero-copy blockquote').innerText()
  expect(old.version).toBe('0.7.2')
  await app.close()
  await cp(resolve('out'), join(clone, 'out'), { recursive: true, force: true })
  await writeFile(join(clone, 'package.json'), await readFile('package.json', 'utf8'))
  await launch('same-v6', clone)
  await observe()
  await expect.poll(count).toBe(1)
  expect(await page.locator('.hero-copy blockquote').innerText()).toBe(text)
  expectV6Preserved(before, await rows())
  expect(await page.evaluate(() => window.desktop.getInfo())).toMatchObject({
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    userData: old.userData,
    sessionData: old.sessionData,
    databaseName: old.databaseName,
    appId: old.appId,
  })
})
