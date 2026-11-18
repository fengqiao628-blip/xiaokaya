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
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parseBackup, inspectBackup } from '../../src/shared/backup'
import { expectV6Preserved } from './v6-preservation'
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
async function seed() {
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByLabel('目标考试年份', { exact: true }).fill('2027')
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
}
const close = () => returnToOverview(page)
async function workspace() {
  await page.getByRole('button', { name: '练习、错题与模拟', exact: true }).click()
  return workspacePanel(page, '练习、错题与历年报告')
}
async function rows() {
  return page.evaluate(
    () =>
      new Promise<Record<string, any[]>>((resolve, reject) => {
        const r = indexedDB.open('XiaokaoyaStudy')
        r.onsuccess = () => {
          const d = r.result,
            out: Record<string, any[]> = {},
            tx = d.transaction([...d.objectStoreNames], 'readonly')
          for (const name of d.objectStoreNames) {
            const get = tx.objectStore(name).getAll()
            get.onsuccess = () => (out[name] = get.result)
          }
          tx.oncomplete = () => {
            d.close()
            resolve(out)
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})
test('practice counts, partial mistakes, immutable review snapshots, frozen report versions, full JSON and offline reopen', async () => {
  const profile = `practice-${Date.now()}`
  await launch(profile)
  await seed()
  await app.context().setOffline(true)
  let p = await workspace()
  await p.getByLabel('练习与模拟年度科目').selectOption({ label: 'CPA · 会计 · 2027' })
  await p.getByRole('button', { name: '记录练习', exact: true }).click()
  await p.getByLabel('来源或名称').fill('第一轮自测')
  for (const [label, value] of [
    ['总题数', '10'],
    ['答对', '6'],
    ['答错', '2'],
    ['未答', '2'],
  ])
    await p.getByLabel(label, { exact: true }).fill(value)
  await p.getByRole('button', { name: '保存练习记录' }).click()
  await expect(p.locator('.practice-accuracy')).toContainText('75.0%')
  await p.getByRole('tab', { name: '错题与复习' }).click()
  await p.getByRole('button', { name: '收录错题' }).click()
  await p.getByLabel('题干', { exact: true }).fill('原始题干：资产确认条件？')
  await p.getByLabel('参考答案', { exact: true }).fill('原始答案A')
  await p.getByLabel('解析', { exact: true }).fill('原始解析')
  await p.getByLabel('关联练习（选填）').selectOption({ index: 1 })
  await p.getByRole('button', { name: '保存错题', exact: true }).click()
  await p.getByRole('button', { name: '复习与历史' }).click()
  await p.getByRole('button', { name: '查看答案与解析' }).click()
  await expect(p.locator('.practice-answer')).toContainText('原始答案A')
  await p.getByRole('button', { name: '记录本次复习' }).click()
  await expect(p.locator('.practice-history')).toHaveCount(1)
  await p.getByRole('button', { name: '返回列表' }).click()
  await p.getByRole('button', { name: '编辑错题' }).click()
  await p.getByLabel('题干', { exact: true }).fill('修改后的题干')
  await p.getByLabel('参考答案', { exact: true }).fill('修改后的答案B')
  await p.getByLabel('手动掌握评价').selectOption('mastered')
  await p.getByRole('button', { name: '保存错题', exact: true }).click()
  await p.getByRole('button', { name: '复习与历史' }).click()
  await p.locator('.practice-history summary').click()
  await expect(p.locator('.practice-history')).toContainText('原始答案A')
  await expect(p.locator('.practice-history')).not.toContainText('修改后的答案B')
  await p.getByRole('tab', { name: '历年冻结报告' }).click()
  await p.getByLabel('我确认保存当前快照；已有版本不会覆盖').check()
  await p.getByRole('button', { name: '生成新的冻结报告' }).click()
  await expect(p.locator('.frozen-report')).toContainText('75.0%')
  const frozen = (await rows()).reportSnapshots[0]
  await p.getByRole('tab', { name: '练习记录', exact: true }).click()
  await p.getByRole('button', { name: '编辑练习' }).click()
  await p.getByLabel('练习状态').selectOption('voided')
  await p.getByRole('button', { name: '保存练习记录' }).click()
  await p.getByRole('tab', { name: '历年冻结报告' }).click()
  await p.getByLabel('我确认保存当前快照；已有版本不会覆盖').check()
  await p.getByRole('button', { name: '生成新的冻结报告' }).click()
  await expect(p.locator('.frozen-report')).toContainText('第2版')
  await expect(p.locator('.frozen-report')).toContainText('无记录')
  expect((await rows()).reportSnapshots.find((r) => r.id === frozen.id)).toEqual(frozen)
  await p.getByRole('button', { name: /第1版/ }).click()
  await expect(p.locator('.frozen-report')).toContainText('75.0%')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(580, 900))
  expect(await p.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await p.screenshot({ path: '.runtime/stage8-practice-report.png' })
  await close()
  const root = (await page.evaluate(() => window.desktop.getInfo())).userData,
    file = join(root, 'stage8-complete.json')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(page.locator('.backup-result')).toContainText('已导出')
  const inspection = await inspectBackup(await parseBackup(await readFile(file, 'utf8')))
  expect(inspection.envelope.schemaVersion).toBe(7)
  expect(inspection.counts.mistakeReviews).toBe(1)
  expect(inspection.counts.reportSnapshots).toBe(2)
  await close()
  p = await workspace()
  await p.getByRole('tab', { name: '错题与复习' }).click()
  await p.getByRole('button', { name: '编辑错题' }).click()
  await p.getByLabel('题干', { exact: true }).fill('恢复前的临时改动')
  await p.getByRole('button', { name: '保存错题', exact: true }).click()
  await close()
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await page.getByLabel('确认整体替换当前数据', { exact: true }).check()
  await page.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(page.locator('.backup-result')).toContainText('完整恢复成功')
  expect((await rows()).mistakeItems[0].stem).toBe('修改后的题干')
  expect((await rows()).mistakeReviews).toEqual(inspection.data.mistakeReviews)
  await app.close()
  await launch(profile)
  p = await workspace()
  await p.getByRole('tab', { name: '历年冻结报告' }).click()
  await expect(p.getByRole('button', { name: /第1版/ })).toBeVisible()
  expect((await rows()).reportSnapshots.find((r) => r.id === frozen.id)).toEqual(frozen)
})
test('mock exam uses one existing timer, requires time confirmation and preserves missing versus zero scores and manual question scores', async () => {
  await launch(`mock-${Date.now()}`)
  await seed()
  let p = await workspace()
  await p.getByRole('tab', { name: '模拟考试', exact: true }).click()
  await p.getByLabel('练习与模拟年度科目').selectOption({ label: 'CPA · 会计 · 2027' })
  await p.getByRole('button', { name: '新建模拟考试' }).click()
  await p.getByLabel('试卷名称').fill('三秒模拟流程')
  await p.getByLabel('时限（分钟，最多480）').fill('0.05')
  await p.getByRole('button', { name: '保存模拟考试', exact: true }).click()
  await expect(p.locator('.practice-card')).toContainText('未记录')
  await p.getByRole('button', { name: '模拟计时与试题' }).click()
  await p.getByRole('button', { name: '添加模拟试题' }).click()
  await p.getByLabel('题干', { exact: true }).fill('模拟题内容')
  await p.getByLabel('题目分值').fill('10')
  await p.getByLabel('题目得分（留空表示未记录）').fill('0')
  await p.getByRole('button', { name: '保存模拟试题' }).click()
  await expect(p.locator('.practice-card')).toContainText('得分 0 / 10')
  await p.getByRole('button', { name: '开始模拟倒计时' }).click()
  const f = page.getByRole('dialog', { name: '学习陪伴倒计时' })
  await expect(f).toContainText('倒计时结束啦！')
  let data = await rows()
  expect(data.studySessions).toHaveLength(0)
  expect(data.focusTimers).toHaveLength(1)
  expect(data.mockExams[0].timerId).toBe(data.focusTimers[0].id)
  await f.getByLabel('我已核对有效学习片段，确认保存实际时长').check()
  await f.getByRole('button', { name: '保存实际时长', exact: true }).click()
  await close()
  p = await workspace()
  await p.getByRole('tab', { name: '模拟考试', exact: true }).click()
  await p.getByRole('button', { name: '模拟计时与试题' }).click()
  await expect(p).toContainText('已确认实际学习：3秒')
  await p.getByRole('button', { name: '返回列表' }).click()
  await p.getByRole('button', { name: '编辑考试与成绩' }).click()
  await p.getByLabel('成绩（留空表示未记录）').fill('0')
  await p.getByRole('button', { name: '保存模拟考试', exact: true }).click()
  data = await rows()
  expect(data.mockExams[0].score).toBe(0)
  expect(data.studySessions).toHaveLength(1)
  expect(data.cycleStatuses[0].examResult).toBe('unrecorded')
})
test('authentic accepted 0.7.4 compiled app upgrades to V7 preserving every V6 row, paths and verified V6 protection', async () => {
  const require = createRequire(resolve('package.json')),
    builder = createRequire(require.resolve('electron-builder')),
    asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
  const clone = resolve('.runtime', `stage8-authentic-upgrade-${Date.now()}`)
  await mkdir(clone)
  asar.extractAll(resolve('.runtime/baseline/stage-7-0.7.4-candidate/app-0.7.4.asar'), clone)
  await launch('same-v6', clone)
  await seed()
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('XiaokaoyaStudy')
        r.onsuccess = () => {
          const d = r.result,
            tx = d.transaction(['cycles', 'focusTimers'], 'readwrite'),
            get = tx.objectStore('cycles').getAll()
          get.onsuccess = () => {
            const at = '2026-11-17T00:00:17.000Z'
            tx.objectStore('focusTimers').add({
              id: 'preserve-pending-17s',
              cycleId: get.result[0].id,
              taskId: null,
              chapterId: null,
              targetSeconds: 1500,
              status: 'review',
              reason: 'stopped',
              checkpointAt: at,
              intervals: [{ startedAt: '2026-11-17T00:00:00.000Z', endedAt: at }],
              sessionIds: [],
              createdAt: at,
              updatedAt: at,
              revision: 1,
            })
          }
          tx.oncomplete = () => {
            d.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  const before = await rows(),
    old = await page.evaluate(() => window.desktop.getInfo())
  expect(old.version).toBe('0.7.4')
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
  const listing = await page.evaluate(() => window.desktop.backup.listSnapshots()),
    snapshot = listing.snapshots.find((s) => s.purpose === 'pre-migration')!
  expect(snapshot.schemaVersion).toBe(6)
  const protectedData = await parseBackup(
    await page.evaluate((id) => window.desktop.backup.readSnapshot(id), snapshot.id),
  )
  expect(protectedData.data).toEqual(before)
  expect((await rows()).focusTimers[0].status).toBe('review')
  expect((await rows()).studySessions).toHaveLength(0)
  // A successful upgrade is not reversed by installing an old executable. Verify the
  // protected V6 file using the authentic old app in a separate clean profile.
  const rollbackRoot = join(clone, 'rollback-old-application')
  await mkdir(rollbackRoot)
  asar.extractAll(resolve('.runtime/baseline/stage-7-0.7.4-candidate/app-0.7.4.asar'), rollbackRoot)
  const v6File = join(clone, 'verified-v6-protection.json')
  await writeFile(v6File, JSON.stringify(protectedData))
  await app.close()
  await launch('clean-v6-recovery', rollbackRoot)
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, v6File)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await page.getByLabel('确认整体替换当前数据', { exact: true }).check()
  await page.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(page.locator('.backup-result')).toContainText('完整恢复成功')
  expect(await rows()).toEqual(before)
})
