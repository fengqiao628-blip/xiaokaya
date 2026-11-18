import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { resolve, join } from 'node:path'
let app: ElectronApplication, page: Page
async function launch(profile = `speech-${Date.now()}`) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined),
  ) as Record<string, string>
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [resolve('.'), '--mute-audio'],
    env: { ...env, XIAOKAOYA_E2E_PROFILE: profile },
  })
  page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  expect((await page.evaluate(() => window.desktop.getInfo())).environment).toBe('test')
}
async function mockSpeech() {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const state = ((globalThis as any).speechProbe = {
      calls: [] as unknown[],
      stops: 0,
      enabled: false,
      fail: false,
    })
    for (const key of ['voices', 'configure', 'speak', 'stop'])
      ipcMain.removeHandler(`speech:${key}`)
    ipcMain.handle('speech:voices', () => [
      { id: 'local-test', name: '测试本机中文声音', language: '804' },
    ])
    ipcMain.handle('speech:configure', (_e, p) => {
      state.enabled = p.enabled
      if (!p.enabled) state.stops++
    })
    ipcMain.handle('speech:stop', () => {
      state.stops++
    })
    ipcMain.handle('speech:speak', (_e, p) => {
      if (state.fail) throw new Error('simulated voice failure')
      if (!state.enabled) return { started: false }
      state.calls.push(p)
      return { started: true }
    })
    BrowserWindow.getAllWindows()[0].focus()
  })
}
async function count() {
  return app.evaluate(() => (globalThis as any).speechProbe.calls.length)
}
async function closePanel() {
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
}
async function partners() {
  await page.getByRole('button', { name: '学习伙伴', exact: true }).click()
  return page.getByRole('dialog', { name: '选一位学习伙伴', exact: true })
}
async function enable(mode = 'events') {
  const p = await partners()
  await p.getByLabel('声音总开关').check()
  await p.getByLabel('本机中文声音').selectOption('local-test')
  await p.getByLabel('语音朗读方式').selectOption(mode)
  await closePanel()
}
async function seed() {
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('语音与动态测试')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
}
async function start(seconds = 20) {
  await page.getByRole('button', { name: '开始学习：语音与动态测试', exact: true }).click()
  const f = page.getByRole('dialog', { name: '学习陪伴倒计时', exact: true })
  await f.getByLabel('倒计时分钟', { exact: true }).fill('0')
  await f.getByLabel('倒计时秒数', { exact: true }).fill(String(seconds))
  await f.getByRole('button', { name: '开始学习', exact: true }).click()
  return f
}
async function rows() {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const r = indexedDB.open('XiaokaoyaStudy')
        r.onsuccess = () => {
          const d = r.result,
            data: Record<string, unknown[]> = {},
            tx = d.transaction([...d.objectStoreNames], 'readonly')
          for (const name of d.objectStoreNames) {
            const get = tx.objectStore(name).getAll()
            get.onsuccess = () => (data[name] = get.result)
          }
          tx.oncomplete = () => {
            d.close()
            resolve(data)
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})

test('optional periodic encouragement reads only in the learning state and switching back to manual cancels it without writing study records', async () => {
  await launch()
  await seed()
  // Accelerate presentation-only rotation, leaving Date and actual learning clocks untouched.
  await page.addInitScript(() => {
    const original = window.setInterval.bind(window)
    window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      original(handler, delay === 300000 ? 300 : delay, ...args)) as typeof window.setInterval
  })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open('XiaokaoyaStudy')
        request.onsuccess = () => {
          const d = request.result,
            tx = d.transaction('tasks', 'readwrite'),
            store = tx.objectStore('tasks'),
            get = store.getAll()
          get.onsuccess = () => store.put({ ...get.result[0], status: 'in_progress' })
          tx.oncomplete = () => {
            d.close()
            resolve()
          }
        }
      }),
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  await mockSpeech()
  await enable('all')
  const before = await rows()
  await expect.poll(count).toBe(1)
  expect(await app.evaluate(() => (globalThis as any).speechProbe.calls[0].key)).toMatch(
    /^periodic:/,
  )
  const p = await partners()
  await p.getByLabel('语音朗读方式').selectOption('manual')
  await closePanel()
  await page.waitForTimeout(1100)
  expect(await count()).toBe(1)
  expect(await rows()).toEqual(before)
})

test('real Windows bridge enumerates only local Chinese voices; all five companions idle with open-eye assets and stable clickable animation targets', async () => {
  await launch()
  await app.context().setOffline(true)
  const voices = await page.evaluate(() => window.desktop.speech!.voices())
  expect(voices.length).toBeGreaterThan(0)
  expect(voices.every((v) => v.id.includes('TTS_MS_ZH'))).toBe(true)
  expect(
    (
      await page.evaluate(() =>
        window.desktop.speech!.speak({
          text: '未开启声音不应朗读',
          voiceId: '',
          rate: 0,
          key: 'muted',
        }),
      )
    ).started,
  ).toBe(false)
  const p = await partners()
  await p.getByLabel('伙伴动画偏好').selectOption('on')
  await p.getByRole('button', { name: '保存体验设置', exact: true }).click()
  for (const [id, name] of [
    ['duck', '小鸭阿鸭'],
    ['cat', '小猫奶糖'],
    ['bear', '小熊栗子'],
    ['rabbit', '小兔糯糯'],
    ['dog', '小狗布丁'],
  ]) {
    await p.getByRole('button', { name: `选择${name}`, exact: true }).click()
    await closePanel()
    const pet = page.locator('.hero-pet > .companion-art')
    await expect(pet).toHaveAttribute('data-state', 'idle')
    await expect(pet.locator('.pet-picture')).toHaveAttribute(
      'data-asset',
      `./companions/${id}/idle.svg`,
    )
    expect(
      await pet.locator('.pet-motion').evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('pet-breathe')
    expect(await pet.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
    await pet.click()
    await expect(pet).toHaveAttribute('data-reaction', 'click')
    expect(
      await pet.locator('.pet-motion').evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('pet-greet')
    await partners()
  }
  await p.getByLabel('伙伴动画偏好').selectOption('off')
  await p.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await closePanel()
  expect(
    await page
      .locator('.hero-pet .pet-motion')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none')
  await page.screenshot({ path: 'test-results/stage7-1-idle.png' })
})
test('manual reads and voice options do not write data; auto mode resets on reopen and restore without replaying history', async () => {
  const profile = `speech-reopen-${Date.now()}`
  await launch(profile)
  await mockSpeech()
  await app.context().setOffline(true)
  await enable('manual')
  const before = await rows()
  await page.getByRole('button', { name: '朗读每日一句', exact: true }).click()
  await expect.poll(count).toBe(1)
  const card = page.getByRole('region', { name: '伙伴的小声鼓励', exact: true })
  await card.getByRole('button', { name: '朗读这句', exact: true }).click()
  await expect.poll(count).toBe(2)
  let p = await partners()
  await p.getByLabel('语音朗读方式').selectOption('events')
  await p.getByLabel('朗读语速').selectOption('-1')
  await p.getByLabel('本机中文声音').selectOption('local-test')
  await p.getByRole('region', { name: '离线语音朗读设置', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/stage7-1-speech-settings.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(430, 900))
  expect(await p.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await page.screenshot({ path: 'test-results/stage7-1-speech-narrow.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 940))
  await closePanel()
  expect(await rows()).toEqual(before)
  await page.locator('.hero-pet > .companion-art').click()
  await expect.poll(count).toBe(3)
  const read = await app.evaluate(() => (globalThis as any).speechProbe.calls.at(-1))
  expect(read).toMatchObject({ rate: -1, voiceId: 'local-test' })
  const info = await page.evaluate(() => window.desktop.getInfo()),
    file = join(info.userData, 'speech-backup.json')
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(page.locator('.backup-result')).toContainText('已导出')
  await closePanel()
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
  p = await partners()
  await expect(p.getByLabel('语音朗读方式')).toHaveValue('events')
  await p.getByLabel('语音朗读方式').selectOption('events')
  await closePanel()
  await app.close()
  await launch(profile)
  await mockSpeech()
  p = await partners()
  await expect(p.getByLabel('语音朗读方式')).toHaveValue('events')
  await closePanel()
  expect(await count()).toBe(0)
})
test('live start, pause, resume, end and task completion read once across both cards, with matching poses and immediate mute', async () => {
  await launch()
  await mockSpeech()
  await seed()
  await enable()
  const pet = page.locator('.hero-pet > .companion-art')
  const f = await start()
  await expect.poll(count).toBe(1)
  await expect(pet).toHaveAttribute('data-state', 'study')
  expect(
    await pet.locator('.pet-motion').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('pet-study')
  await f.getByRole('button', { name: '暂停休息', exact: true }).click()
  await expect.poll(count).toBe(2)
  await expect(pet).toHaveAttribute('data-state', 'rest')
  await f.getByRole('button', { name: '继续本次', exact: true }).click()
  await expect.poll(count).toBe(3)
  await expect(pet).toHaveAttribute('data-state', 'study')
  await f.getByRole('button', { name: '结束本段', exact: true }).click()
  await expect.poll(count).toBe(4)
  await expect(pet).toHaveAttribute('data-state', 'idle')
  await closePanel()
  await page.getByRole('button', { name: '完成任务：语音与动态测试', exact: true }).click()
  await expect.poll(count).toBe(5)
  const p = await partners()
  const stopsBefore = await app.evaluate(() => (globalThis as any).speechProbe.stops)
  await p.getByLabel('声音总开关').uncheck()
  expect(await app.evaluate(() => (globalThis as any).speechProbe.stops)).toBeGreaterThan(
    stopsBefore,
  )
  await closePanel()
  await pet.click()
  await page.waitForTimeout(700)
  expect(await count()).toBe(5)
  expect((await rows()).studySessions).toHaveLength(0)
})
test('due reads once, speech failure leaves timer and task intact, and backup/blur cancel pending reads', async () => {
  await launch()
  await mockSpeech()
  await seed()
  await enable()
  const f = await start(3)
  await expect.poll(count).toBe(1)
  await expect.poll(count).toBe(2)
  await page.waitForTimeout(1000)
  expect(await count()).toBe(2)
  await expect(f.getByLabel('本次有效学习时间', { exact: true })).toHaveText('00:00:03')
  await app.evaluate(() => ((globalThis as any).speechProbe.fail = true))
  await f.getByRole('button', { name: '朗读这句', exact: true }).click()
  await expect(f).toContainText('本机朗读未能启动')
  await expect(f.getByLabel('本次有效学习时间', { exact: true })).toHaveText('00:00:03')
  await closePanel()
  const before = await rows()
  expect(before.tasks[0]).toMatchObject({ status: 'pending' })
  expect(before.studySessions).toHaveLength(0)
  await app.evaluate(() => ((globalThis as any).speechProbe.fail = false))
  await page.locator('.hero-pet > .companion-art').click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.waitForTimeout(700)
  expect(await count()).toBe(2)
  await closePanel()
  await page.locator('.hero-pet > .companion-art').click()
  // Deterministic renderer lifecycle event; physical Windows focus changes are a manual check.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForTimeout(700)
  expect(await count()).toBe(2)
})
