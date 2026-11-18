import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { expectV6Preserved } from './v6-preservation'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises'
let app: ElectronApplication, page: Page
async function launch(profile = `serena-${Date.now()}`, root = resolve('.')) {
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
    const state = ((window as any).serenaProbe = {
      calls: [] as any[],
      last: null as HTMLMediaElement | null,
    })
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      this.muted = true
      state.calls.push({ src: this.src, rate: this.playbackRate, volume: this.volume })
      state.last = this
      return play.call(this)
    }
  })
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ;(globalThis as any).systemReads = []
    ipcMain.removeHandler('speech:speak')
    ipcMain.handle('speech:speak', (_e, input) => {
      ;(globalThis as any).systemReads.push(input)
      return { started: true }
    })
    BrowserWindow.getAllWindows()[0].focus()
  })
}
async function count() {
  return page.evaluate(() => (window as any).serenaProbe.calls.length)
}
async function rows() {
  return page.evaluate(
    () =>
      new Promise<{ version: number; tables: Record<string, unknown[]> }>((resolve, reject) => {
        const r = indexedDB.open('XiaokaoyaStudy')
        r.onsuccess = () => {
          const d = r.result,
            tables: Record<string, unknown[]> = {},
            tx = d.transaction([...d.objectStoreNames], 'readonly')
          for (const name of d.objectStoreNames) {
            const get = tx.objectStore(name).getAll()
            get.onsuccess = () => (tables[name] = get.result)
          }
          tx.oncomplete = () => {
            resolve({ version: d.version / 10, tables })
            d.close()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
}
async function closePanel() {
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
}
async function partners() {
  await page.getByRole('button', { name: '学习伙伴', exact: true }).click()
  return page.getByRole('dialog', { name: '选一位学习伙伴', exact: true })
}
async function seed() {
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('Serena自然女声测试')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})

test('bundled Serena decodes offline, uses the approved audition, changes rate without pitch shift, and stops immediately on master mute without changing any data through playback', async () => {
  await launch()
  await observe()
  await app.context().setOffline(true)
  const p = await partners()
  await expect(p.getByLabel('本机中文声音')).toHaveValue('serena-v1')
  await expect(p.getByLabel('语音朗读方式')).toHaveValue('events')
  await expect(p.getByRole('button', { name: '试听一句', exact: true })).toBeDisabled()
  await p.getByLabel('声音总开关').check()
  const before = await rows()
  await p.getByRole('button', { name: '试听一句', exact: true }).click()
  await expect.poll(count).toBe(1)
  await expect
    .poll(() => page.evaluate(() => (window as any).serenaProbe.last.currentTime))
    .toBeGreaterThan(0.05)
  expect(
    await page.evaluate(() => {
      const a = (window as any).serenaProbe.last
      return { duration: a.duration, volume: a.volume, pitch: a.preservesPitch, src: a.src }
    }),
  ).toMatchObject({
    duration: 5.44,
    volume: 0.35,
    pitch: true,
    src: expect.stringMatching(/^app:\/\/xiaokaoya\/voices\/serena\/[a-f0-9]{64}\.wav$/),
  })
  await p.getByLabel('朗读语速').selectOption('-1')
  await p.getByRole('button', { name: '试听一句', exact: true }).click()
  await expect.poll(count).toBe(2)
  expect(await page.evaluate(() => (window as any).serenaProbe.last.playbackRate)).toBe(0.9)
  expect(await rows()).toEqual(before)
  await p.getByRole('button', { name: '停止朗读', exact: true }).click()
  expect(await page.evaluate(() => (window as any).serenaProbe.last.paused)).toBe(true)
  await p.getByRole('button', { name: '试听一句', exact: true }).click()
  await expect.poll(count).toBe(3)
  await p.getByLabel('声音总开关').uncheck()
  expect(await page.evaluate(() => (window as any).serenaProbe.last.paused)).toBe(true)
  expect(await app.evaluate(() => (globalThis as any).systemReads)).toHaveLength(0)
  // The settings editor remounts after its revision changes; reopen before capturing it.
  await closePanel()
  const saved = await partners()
  await expect(saved.getByLabel('声音总开关')).not.toBeChecked()
  await saved
    .getByRole('region', { name: '离线语音朗读设置', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/stage7-2-serena-settings.png' })
})
test('start, pause, resume, end and completion use one Serena clip per event; native lock and blur cancel media and never add study time', async () => {
  await launch()
  await observe()
  await seed()
  let p = await partners()
  await p.getByLabel('声音总开关').check()
  await closePanel()
  await page.getByRole('button', { name: '开始学习：Serena自然女声测试', exact: true }).click()
  const f = page.getByRole('dialog', { name: '学习陪伴倒计时', exact: true })
  await f.getByLabel('倒计时分钟', { exact: true }).fill('0')
  await f.getByLabel('倒计时秒数', { exact: true }).fill('25')
  await f.getByRole('button', { name: '开始学习', exact: true }).click()
  await expect.poll(count).toBe(1)
  await f.getByRole('button', { name: '暂停休息', exact: true }).click()
  await expect.poll(count).toBe(2)
  await f.getByRole('button', { name: '继续本次', exact: true }).click()
  await expect.poll(count).toBe(3)
  await f.getByRole('button', { name: '结束本段', exact: true }).click()
  await expect.poll(count).toBe(4)
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
  await expect.poll(() => page.evaluate(() => (window as any).serenaProbe.last.paused)).toBe(true)
  await f.getByRole('button', { name: '朗读这句', exact: true }).click()
  await page.waitForTimeout(650)
  expect(await count()).toBe(4)
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'))
  await f.getByRole('button', { name: '朗读这句', exact: true }).click()
  await expect.poll(count).toBe(5)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('blur'))
  await expect.poll(() => page.evaluate(() => (window as any).serenaProbe.last.paused)).toBe(true)
  await closePanel()
  await page.getByRole('button', { name: '完成任务：Serena自然女声测试', exact: true }).click()
  await expect.poll(count).toBe(6)
  expect((await rows()).tables.studySessions).toHaveLength(0)
  expect(await app.evaluate(() => (globalThis as any).systemReads)).toHaveLength(0)
})
test('unrecorded custom text gives a clear choice, only explicit system-voice selection invokes SAPI, and reopen restores Serena without reading history', async () => {
  const profile = `serena-custom-${Date.now()}`
  await launch(profile)
  await observe()
  let p = await partners()
  await p.getByLabel('声音总开关').check()
  await closePanel()
  await page.getByRole('button', { name: '励志语与诗词', exact: true }).click()
  const q = page.getByRole('dialog', { name: '励志语与诗词', exact: true })
  await q.getByRole('button', { name: '添加自定义语句', exact: true }).click()
  const custom = '我的专属Serena验收文字，保留原来的学习记录。'
  await q.getByLabel('自定义语句正文').fill(custom)
  await q.getByRole('button', { name: '保存自定义语句', exact: true }).click()
  await q.getByRole('tab', { name: '自定义', exact: true }).click()
  await q
    .getByRole('article')
    .filter({ hasText: custom })
    .getByRole('button', { name: '设为今日一句', exact: true })
    .click()
  await closePanel()
  const before = await rows()
  await page.getByRole('button', { name: '朗读每日一句', exact: true }).click()
  await expect(page.getByRole('region', { name: '伙伴的小声鼓励', exact: true })).toContainText(
    '这句没有对应的 Serena 音频',
  )
  expect(await count()).toBe(0)
  expect(await app.evaluate(() => (globalThis as any).systemReads)).toHaveLength(0)
  p = await partners()
  await p.getByLabel('本机中文声音').selectOption('')
  await closePanel()
  await page.getByRole('button', { name: '朗读每日一句', exact: true }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).systemReads.length)).toBe(1)
  expect(await app.evaluate(() => (globalThis as any).systemReads[0].text)).toBe(custom)
  expect(await rows()).toEqual(before)
  await app.close()
  await launch(profile)
  await observe()
  p = await partners()
  await expect(p.getByLabel('本机中文声音')).toHaveValue('serena-v1')
  await expect(p.getByLabel('语音朗读方式')).toHaveValue('events')
  await closePanel()
  await page.waitForTimeout(650)
  expect(await count()).toBe(0)
  expect((await rows()).tables.dailyQuotes).toEqual(before.tables.dailyQuotes)
})
test('real compiled 0.7.1 upgrades the identical V6 profile with every business row, data path and daily choice unchanged', async () => {
  const require = createRequire(resolve('package.json')),
    builder = createRequire(require.resolve('electron-builder')),
    asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
  const clone = resolve('.runtime', `serena-upgrade-${Date.now()}`)
  await mkdir(clone)
  asar.extractAll(resolve('.runtime/baseline/0.7.1-before-serena/app-0.7.1.asar'), clone)
  await launch('same-v6', clone)
  await seed()
  const old = await page.evaluate(() => window.desktop.getInfo())
  expect(old.version).toBe('0.7.1')
  const before = await rows()
  await app.close()
  await cp(resolve('out'), join(clone, 'out'), { recursive: true, force: true })
  await writeFile(join(clone, 'package.json'), await readFile('package.json', 'utf8'))
  await launch('same-v6', clone)
  await app.context().setOffline(true)
  expectV6Preserved(before.tables, (await rows()).tables)
  expect(await page.evaluate(() => window.desktop.getInfo())).toMatchObject({
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    userData: old.userData,
    sessionData: old.sessionData,
    databaseName: old.databaseName,
    appId: old.appId,
  })
  const p = await partners()
  await expect(p.getByLabel('本机中文声音')).toHaveValue('serena-v1')
})
