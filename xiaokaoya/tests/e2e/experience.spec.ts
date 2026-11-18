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
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parseBackup, inspectBackup } from '../../src/shared/backup'
import { actualSeconds } from '../../src/domain/statistics'
import type { StudySession, TimeSegment } from '../../src/domain/models'
let app: ElectronApplication, page: Page, root: string
async function launch(profile: string, appRoot = resolve('.')) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined),
  ) as Record<string, string>
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appRoot, '--mute-audio'],
    env: { ...env, XIAOKAOYA_E2E_PROFILE: profile },
  })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  const info = await page.evaluate(() => window.desktop.getInfo())
  expect(info.environment).toBe('test')
  root = info.userData
}
async function closePanel() {
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
}
async function quotes() {
  await page.getByRole('button', { name: '励志语与诗词', exact: true }).click()
  return page.getByRole('dialog', { name: '励志语与诗词', exact: true })
}
async function partners() {
  await page.getByRole('button', { name: '学习伙伴', exact: true }).click()
  return page.getByRole('dialog', { name: '选一位学习伙伴', exact: true })
}
async function snapshot() {
  return page.evaluate(
    () =>
      new Promise<{ version: number; data: Record<string, Record<string, unknown>[]> }>(
        (resolve, reject) => {
          const request = indexedDB.open('XiaokaoyaStudy')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const d = request.result,
              data: Record<string, Record<string, unknown>[]> = {},
              tx = d.transaction([...d.objectStoreNames], 'readonly')
            for (const name of d.objectStoreNames) {
              const read = tx.objectStore(name).getAll()
              read.onsuccess = () => {
                data[name] = read.result
              }
            }
            tx.oncomplete = () => {
              resolve({ version: d.version / 10, data })
              d.close()
            }
            tx.onerror = () => reject(tx.error)
          }
        },
      ),
  )
}
async function exportJson(file: string) {
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '数据与备份', exact: true })
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await panel.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(panel.locator('.backup-result')).toContainText('已导出')
  await closePanel()
  return parseBackup(await readFile(file, 'utf8'))
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})

test('compiled 0.7.0 upgrades in the same V6 profile without changing any saved row, directory or database version', async () => {
  const require = createRequire(resolve('package.json')),
    builder = createRequire(require.resolve('electron-builder')),
    asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
  const clone = resolve('.runtime', `speech-patch-upgrade-${Date.now()}`)
  await mkdir(clone)
  asar.extractAll(resolve('.runtime/baseline/0.7.0-before-speech/app-0.7.0.asar'), clone)
  await launch('same-v6-profile', clone)
  const info = await page.evaluate(() => window.desktop.getInfo())
  expect(info.version).toBe('0.7.0')
  const panel = await quotes()
  await panel
    .getByRole('article', { name: '语库条目' })
    .first()
    .getByRole('button', { name: /^收藏语句/ })
    .click()
  await closePanel()
  const before = await snapshot()
  expect(before.version).toBe(6)
  expect(before.data.quoteFavorites).toHaveLength(1)
  await app.close()
  await cp(resolve('out'), join(clone, 'out'), { recursive: true, force: true })
  await writeFile(join(clone, 'package.json'), await readFile('package.json', 'utf8'))
  await launch('same-v6-profile', clone)
  await app.context().setOffline(true)
  const upgraded = await snapshot()
  expect(upgraded.version).toBe(7)
  expectV6Preserved(before.data, upgraded.data)
  expect(await page.evaluate(() => window.desktop.getInfo())).toMatchObject({
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    userData: info.userData,
    sessionData: info.sessionData,
    databaseName: info.databaseName,
    appId: info.appId,
  })
  await expect(page.locator('.hero-pet > .companion-art')).toHaveAttribute('data-state', 'idle')
})

test('offline library, sources, favorites, custom edits/archive and immutable daily/history snapshots round-trip through complete V6 JSON', async () => {
  const profile = `experience-library-${Date.now()}`
  await launch(profile)
  await app.context().setOffline(true)
  let panel = await quotes()
  await expect(panel.getByText('共200条 · 第1/10页', { exact: true })).toBeVisible()
  await expect(panel.getByRole('article', { name: '语库条目' })).toHaveCount(20)
  await panel.getByLabel('语句类型筛选').selectOption('poetry')
  await expect(panel.getByRole('article', { name: '语库条目' })).toHaveCount(18)
  await panel.getByLabel('搜索语句作者作品').fill('李白')
  await expect(panel.getByRole('article', { name: '语库条目' })).toHaveCount(2)
  const classical = panel.getByRole('article').filter({ hasText: '长风破浪' })
  await classical.getByText('查看出处详情', { exact: true }).click()
  await expect(classical).toContainText('李白 · 行路难·其一')
  await expect(classical).toContainText('zh.wikisource.org')
  await classical.getByRole('button', { name: /^收藏语句/ }).click()
  await panel.getByRole('tab', { name: '我的收藏', exact: true }).click()
  await expect(panel.getByRole('article')).toHaveCount(1)
  await panel.getByLabel('搜索语句作者作品').fill('')
  await panel.getByLabel('语句类型筛选').selectOption('')
  await panel.getByRole('button', { name: '添加自定义语句', exact: true }).click()
  await panel.getByLabel('自定义语句正文').fill('我的专属鼓励 · 今天也有一束光')
  await panel.getByLabel('自定义语句作者').fill('旧署名')
  await panel.getByLabel('自定义语句作品').fill('学习小记')
  await panel.getByRole('button', { name: '保存自定义语句', exact: true }).click()
  await panel.getByRole('tab', { name: '自定义', exact: true }).click()
  let custom = panel.getByRole('article').filter({ hasText: '我的专属鼓励' })
  await custom.getByRole('button', { name: /^收藏语句/ }).click()
  await custom.getByRole('button', { name: '设为今日一句', exact: true }).click()
  await expect(page.locator('.hero-copy blockquote')).toHaveText('我的专属鼓励 · 今天也有一束光')
  await custom.getByRole('button', { name: '编辑自定义', exact: true }).click()
  await panel.getByLabel('自定义语句正文').fill('修改后的专属语句')
  await panel.getByLabel('自定义语句作者').fill('新署名')
  await panel.getByRole('button', { name: '保存自定义语句', exact: true }).click()
  await expect(page.locator('.hero-copy blockquote')).toHaveText('我的专属鼓励 · 今天也有一束光')
  await expect(page.locator('.hero-copy .quote-source')).toContainText('旧署名')
  await panel.getByRole('tab', { name: '展示历史', exact: true }).click()
  await expect(panel.getByRole('article').first()).toContainText('旧署名')
  await panel.getByRole('tab', { name: '自定义', exact: true }).click()
  custom = panel.getByRole('article').filter({ hasText: '修改后的专属语句' })
  await custom.getByRole('button', { name: '归档语句', exact: true }).click()
  await expect(panel.getByRole('article')).toHaveCount(0)
  await panel.getByLabel('显示已归档语句').check()
  await expect(custom.getByRole('button', { name: /^收藏语句/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(custom.getByRole('button', { name: '设为今日一句' })).toBeDisabled()
  await closePanel()
  const file = join(root, 'experience-v6.json'),
    backup = await exportJson(file)
  expect(backup.schemaVersion).toBe(7)
  await inspectBackup(backup)
  expect(backup.data.quotes).toHaveLength(201)
  expect(backup.data.quoteFavorites.filter((q) => q.active)).toHaveLength(2)
  panel = await partners()
  await panel.getByLabel('伙伴音量').fill('15')
  await panel.getByLabel('伙伴动画偏好').selectOption('off')
  await panel.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await closePanel()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const restore = page.getByRole('dialog', { name: '数据与备份', exact: true })
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await restore.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await restore.getByRole('checkbox', { name: '确认整体替换当前数据', exact: true }).check()
  await restore.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(restore.locator('.backup-result')).toContainText('完整恢复成功')
  await restore.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await expect(restore).toContainText('内容与本机一致，无需恢复')
  await closePanel()
  await app.close()
  await launch(profile)
  await expect(page.locator('.hero-copy blockquote')).toHaveText('我的专属鼓励 · 今天也有一束光')
  await expect(page.locator('.hero-copy .quote-source')).toContainText('旧署名')
  const after = await snapshot()
  expect(after.data.experienceSettings).toEqual(backup.data.experienceSettings)
  expect(after.data.quoteFavorites).toEqual(backup.data.quoteFavorites)
  panel = await quotes()
  await panel.getByLabel('语句类型筛选').selectOption('poetry')
  await page.screenshot({ path: 'test-results/stage7-library.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(430, 900))
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await page.screenshot({ path: 'test-results/stage7-library-narrow.png' })
})

test('default mute, per-animal sound profiles, one-shot due, saved motion preferences and media failure fallback work without changing task completion', async () => {
  await launch(`experience-sounds-${Date.now()}`)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const pet = page.locator('.hero-pet > .companion-art')
  expect(
    await pet.evaluate((el) => getComputedStyle(el.querySelector('.pet-motion')!).animationName),
  ).toBe('none')
  await page.evaluate(() => {
    const w = window as unknown as { toneCount: number }
    w.toneCount = 0
    const original = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function () {
      w.toneCount++
      return original.call(this)
    }
  })
  await pet.click()
  expect(await page.evaluate(() => (window as unknown as { toneCount: number }).toneCount)).toBe(0)
  let panel = await partners()
  await expect(panel.getByLabel('声音总开关')).not.toBeChecked()
  await expect(panel.getByRole('button', { name: '试听伙伴音效', exact: true })).toBeDisabled()
  await panel.getByLabel('声音总开关').check()
  await panel.getByRole('button', { name: '试听伙伴音效', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { toneCount: number }).toneCount))
    .toBe(2)
  for (const name of ['小猫奶糖', '小熊栗子', '小兔糯糯', '小狗布丁']) {
    await panel.getByRole('button', { name: `选择${name}`, exact: true }).click()
    await panel.getByRole('button', { name: '试听伙伴音效', exact: true }).click()
  }
  expect(await page.evaluate(() => (window as unknown as { toneCount: number }).toneCount)).toBe(10)
  await panel.getByLabel('伙伴动画偏好').selectOption('off')
  await panel.getByLabel('伙伴状态短音效').uncheck()
  await panel.getByRole('button', { name: '保存体验设置', exact: true }).click()
  await expect(panel.getByRole('button', { name: '试听伙伴音效', exact: true })).toBeDisabled()
  expect(
    await panel
      .locator('.companion-art')
      .first()
      .evaluate((el) => getComputedStyle(el.querySelector('.pet-motion')!).animationName),
  ).toBe('none')
  await closePanel()
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('单次提示音测试')
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await page.getByRole('button', { name: '开始学习：单次提示音测试', exact: true }).click()
  const focus = page.getByRole('dialog', { name: '学习陪伴倒计时', exact: true })
  await focus.getByLabel('倒计时分钟', { exact: true }).fill('0')
  await focus.getByLabel('倒计时秒数', { exact: true }).fill('3')
  await focus.getByRole('button', { name: '开始学习', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '本次学习的小声鼓励', exact: true }),
  ).toHaveAttribute('data-mood', 'due')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { toneCount: number }).toneCount))
    .toBe(13)
  await expect(focus.getByLabel('本次有效学习时间', { exact: true })).toHaveText('00:00:03')
  await page.waitForTimeout(1600)
  expect(await page.evaluate(() => (window as unknown as { toneCount: number }).toneCount)).toBe(13)
  expect((await snapshot()).data.tasks[0].status).toBe('pending')
  await closePanel()
  panel = await partners()
  await panel.getByLabel('声音总开关').uncheck()
  await closePanel()
  await pet.click()
  expect(await page.evaluate(() => (window as unknown as { toneCount: number }).toneCount)).toBe(13)
  panel = await partners()
  await panel.getByLabel('声音总开关').check()
  await page.evaluate(() => {
    AudioContext.prototype.createOscillator = () => {
      throw new Error('simulated audio device failure')
    }
  })
  await panel.getByRole('button', { name: '试听到时提示', exact: true }).click()
  await expect(panel).toContainText('当前无法播放')
  await panel.getByRole('button', { name: '选择小鸭阿鸭', exact: true }).click()
  await panel.getByLabel('声音总开关').uncheck()
  await page.screenshot({ path: 'test-results/stage7-settings.png' })
})

test('real compiled 0.6.0 upgrades the same isolated V5 profile to V6, preserving all rows, daily choice and the 21/1 minute totals offline', async () => {
  test.setTimeout(90000)
  const require = createRequire(resolve('package.json')),
    builder = createRequire(require.resolve('electron-builder')),
    asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
  const clone = resolve('.runtime', `upgrade-stage7-${Date.now()}`)
  await mkdir(clone)
  asar.extractAll(resolve('.runtime/baseline/stage-6/app-0.6.0.asar'), clone)
  const profile = 'same-v5-profile'
  await launch(profile, clone)
  expect((await page.evaluate(() => window.desktop.getInfo())).version).toBe('0.6.0')
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2027')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  const original = await snapshot(),
    cycle = original.data.cycles[0]
  const stamp = {
    createdAt: '2026-11-16T01:00:00.000Z',
    updatedAt: '2026-11-16T01:01:00.000Z',
    revision: 1,
  }
  const pieces = [{ startedAt: stamp.createdAt, endedAt: stamp.updatedAt }]
  await page.evaluate(
    async ({ cycle, stamp, pieces }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('XiaokaoyaStudy')
        req.onsuccess = () => {
          const d = req.result,
            tx = d.transaction(['studySessions', 'timeSegments', 'focusTimers'], 'readwrite')
          const base = {
            ...stamp,
            cycleId: cycle.id,
            taskId: null,
            studyDate: '2026-11-16',
            status: 'confirmed',
          }
          tx.objectStore('studySessions').add({
            ...base,
            id: 'manual-legacy',
            timeMode: 'duration_only',
            durationOnlySeconds: 1200,
          })
          tx.objectStore('studySessions').add({
            ...base,
            id: 'focus-run:2026-11-16',
            timeMode: 'segments',
            durationOnlySeconds: null,
            source: 'timer',
            entryId: 'focus-run',
            timerId: 'run',
            chapterId: null,
            notes: '',
            overlapAcknowledged: false,
            voidReason: '',
          })
          tx.objectStore('timeSegments').add({
            ...stamp,
            id: 'segment',
            sessionId: 'focus-run:2026-11-16',
            ...pieces[0],
          })
          tx.objectStore('focusTimers').add({
            ...stamp,
            id: 'run',
            cycleId: cycle.id,
            taskId: null,
            chapterId: null,
            targetSeconds: 60,
            status: 'saved',
            reason: 'due',
            checkpointAt: stamp.updatedAt,
            intervals: pieces,
            sessionIds: ['focus-run:2026-11-16'],
          })
          tx.oncomplete = () => {
            d.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    { cycle, stamp, pieces },
  )
  await page.reload()
  await expect(page.getByTestId('total-companion-time')).toHaveText('1分钟')
  const oldBackup = await exportJson(join(root, 'before-v5.json')),
    before = await snapshot(),
    oldRoot = root
  expect(oldBackup.schemaVersion).toBe(5)
  expect(before.data.quotes).toHaveLength(8)
  await app.close()
  await cp(resolve('out'), join(clone, 'out'), { recursive: true, force: true })
  await writeFile(join(clone, 'package.json'), await readFile('package.json', 'utf8'))
  await launch(profile, clone)
  await app.context().setOffline(true)
  expect(root).toBe(oldRoot)
  const after = await snapshot()
  expect(after.version).toBe(7)
  for (const [table, rows] of Object.entries(before.data)) {
    if (table === 'quotes' || table === 'migrationHistory')
      for (const row of rows) expect(after.data[table]).toContainEqual(row)
    else expect(after.data[table]).toEqual(rows)
  }
  expect(after.data.quotes).toHaveLength(200)
  expect(after.data.experienceSettings[0].soundEnabled).toBe(false)
  expect(
    actualSeconds(
      after.data.studySessions as unknown as StudySession[],
      after.data.timeSegments as unknown as TimeSegment[],
    ),
  ).toBe(1260)
  await expect(page.getByTestId('total-companion-time')).toHaveText('1分钟')
  const safety = (await page.evaluate(() => window.desktop.backup.listSnapshots())).snapshots.find(
    (s) => s.purpose === 'pre-migration',
  )!
  const protectedData = await parseBackup(
    await page.evaluate((id) => window.desktop.backup.readSnapshot(id), safety.id),
  )
  expect(protectedData.data).toEqual(oldBackup.data)
  await page.screenshot({ path: 'test-results/stage7-upgraded-home.png' })
  const copied = await exportJson(join(root, 'after-v6.json'))
  await inspectBackup(copied)
})
