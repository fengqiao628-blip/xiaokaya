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
import { readFile, writeFile, stat } from 'node:fs/promises'
import { parseBackup, inspectBackup, MAX_FILE_BYTES } from '../../src/shared/backup'
let app: ElectronApplication, page: Page
async function launch(profile: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined),
  ) as Record<string, string>
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [resolve('.'), '--mute-audio'],
    env: { ...env, XIAOKAOYA_E2E_PROFILE: profile },
  })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible({
    timeout: 60000,
  })
  expect((await page.evaluate(() => window.desktop.getInfo())).environment).toBe('test')
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})
test('five synthetic annual cycles, 50k confirmed records and segments, 10k tasks and mistakes retain pagination, exact time, backups and frozen history after reopen', async () => {
  test.setTimeout(300000)
  const profile = `stage8-volume-${Date.now()}`,
    times: Record<string, number> = {}
  let at = Date.now()
  await launch(profile)
  const root = (await page.evaluate(() => window.desktop.getInfo())).userData
  const seed = await page.evaluate(
    () =>
      new Promise<{ ms: number; years: number[] }>((resolve, reject) => {
        const began = performance.now(),
          r = indexedDB.open('XiaokaoyaStudy')
        r.onerror = () => reject(r.error)
        r.onsuccess = () => {
          const d = r.result,
            names = [
              'annualPlans',
              'cycles',
              'cycleStatuses',
              'tasks',
              'studySessions',
              'timeSegments',
              'practiceSets',
              'mistakeItems',
            ],
            tx = d.transaction(names, 'readwrite'),
            now = '2027-12-31T00:00:00.000Z'
          const stamp = (id: string) => ({ id, createdAt: now, updatedAt: now, revision: 1 })
          for (const name of names) tx.objectStore(name).clear()
          const years = [2023, 2024, 2025, 2026, 2027]
          for (const year of years) {
            const cycleId = `volume-cycle-${year}`
            tx.objectStore('annualPlans').add({
              ...stamp(`volume-plan-${year}`),
              year,
              goal: '模拟长期验证数据',
            })
            tx.objectStore('cycles').add({
              ...stamp(cycleId),
              annualPlanId: `volume-plan-${year}`,
              subjectId: 'cpa-1',
              learningStatus: 'studying',
              archivedAt: year < 2025 ? now : null,
            })
            tx.objectStore('cycleStatuses').add({
              ...stamp(cycleId),
              registrationStatus: 'not_planned',
              examResult: 'unrecorded',
              examDate: null,
              notes: '',
            })
            for (let i = 0; i < 10000; i++) {
              const id = `volume-session-${year}-${i}`,
                start = Date.parse(`${year}-01-01T01:00:00Z`) + i * 1200000,
                date = new Date(start + 28800000).toISOString().slice(0, 10)
              tx.objectStore('studySessions').add({
                ...stamp(id),
                cycleId,
                taskId: null,
                studyDate: date,
                status: 'confirmed',
                timeMode: 'segments',
                durationOnlySeconds: null,
                source: 'manual',
                entryId: id,
                timerId: null,
                chapterId: null,
                notes: '合成学习记录，非真实使用历史',
                overlapAcknowledged: false,
                voidReason: '',
              })
              tx.objectStore('timeSegments').add({
                ...stamp(`${id}-segment`),
                sessionId: id,
                startedAt: new Date(start).toISOString(),
                endedAt: new Date(start + 60000).toISOString(),
              })
            }
            for (let i = 0; i < 2000; i++) {
              const date = `${year}-01-01`
              tx.objectStore('tasks').add({
                ...stamp(`volume-task-${year}-${i}`),
                cycleId,
                chapterId: null,
                title: `模拟任务 ${year}-${i}`,
                plannedDate: date,
                estimatedSeconds: 600,
                status: i % 2 ? 'pending' : 'completed',
                notes: '',
              })
              tx.objectStore('mistakeItems').add({
                ...stamp(`volume-mistake-${year}-${i}`),
                cycleId,
                chapterId: null,
                practiceSetId: null,
                date,
                stem: `模拟错题 ${year}-${i}`,
                options: 'A.甲\nB.乙',
                answer: 'A',
                explanation: '合成验证数据',
                reason: '概念混淆',
                tags: ['验证'],
                mastery: 'learning',
                archivedAt: null,
              })
            }
            for (let i = 0; i < 1000; i++)
              tx.objectStore('practiceSets').add({
                ...stamp(`volume-practice-${year}-${i}`),
                cycleId,
                chapterId: null,
                studySessionId: null,
                date: `${year}-01-01`,
                source: `模拟练习${i}`,
                total: 10,
                correct: 6,
                wrong: 2,
                unanswered: 2,
                notes: '',
                status: 'confirmed',
              })
          }
          tx.oncomplete = () => {
            d.close()
            resolve({ ms: performance.now() - began, years })
          }
          tx.onerror = tx.onabort = () => {
            d.close()
            reject(tx.error)
          }
        }
      }),
  )
  times.seedMs = Math.round(seed.ms)
  at = Date.now()
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible({
    timeout: 60000,
  })
  times.reloadMs = Date.now() - at
  await expect(
    page.locator('.metric').filter({ has: page.getByRole('heading', { name: '累计实际学习' }) }),
  ).toContainText('50000分钟')
  at = Date.now()
  await page.getByRole('button', { name: '练习、错题与模拟', exact: true }).click()
  const p = workspacePanel(page, '练习、错题与历年报告')
  await p.getByRole('tab', { name: '错题与复习' }).click()
  await expect(p.locator('.practice-card')).toHaveCount(20)
  await expect(p.locator('.practice-pages')).toContainText('共10000条')
  times.firstMistakePageMs = Date.now() - at
  at = Date.now()
  const first = await p.locator('.question-preview').first().innerText()
  await p.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(p.locator('.practice-pages')).toContainText('第2/500页')
  await expect(p.locator('.question-preview').first()).not.toHaveText(first)
  times.nextPageMs = Date.now() - at
  at = Date.now()
  await p.getByRole('button', { name: '末页', exact: true }).click()
  await expect(p.locator('.practice-pages')).toContainText('第500/500页')
  await expect(p.locator('.practice-card')).toHaveCount(20)
  times.lastPageMs = Date.now() - at
  await p.getByLabel('练习与模拟年度科目').selectOption('volume-cycle-2023')
  await expect(p.locator('.practice-pages')).toContainText('共2000条')
  await p.getByRole('tab', { name: '历年冻结报告' }).click()
  await p.getByLabel('报告备考年度').selectOption('2023')
  await p.getByLabel('我确认保存当前快照；已有版本不会覆盖').check()
  at = Date.now()
  await p.getByRole('button', { name: '生成新的冻结报告' }).click()
  await expect(p.locator('.frozen-report')).toContainText('166小时40分钟', { timeout: 60000 })
  await expect(p.locator('.frozen-report')).toContainText('75.0%')
  times.freezeReportMs = Date.now() - at
  await returnToOverview(page)
  const file = join(root, 'synthetic-5-year-v7.json')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  at = Date.now()
  await page.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(page.locator('.backup-result')).toContainText('已导出', { timeout: 90000 })
  times.exportMs = Date.now() - at
  at = Date.now()
  const bytes = (await stat(file)).size,
    backup = await parseBackup(await readFile(file, 'utf8')),
    inspection = await inspectBackup(backup)
  times.readbackPreflightMs = Date.now() - at
  expect(bytes).toBeLessThan(MAX_FILE_BYTES)
  expect(inspection.counts.studySessions).toBe(50000)
  expect(inspection.counts.timeSegments).toBe(50000)
  expect(inspection.counts.tasks).toBe(10000)
  expect(inspection.counts.mistakeItems).toBe(10000)
  const frozen = inspection.data.reportSnapshots[0]
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await page.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await expect(page.locator('.restore-preview')).toContainText('内容与本机一致', { timeout: 90000 })
  await app.close()
  at = Date.now()
  await launch(profile)
  times.reopenMs = Date.now() - at
  await page.getByRole('button', { name: '练习、错题与模拟', exact: true }).click()
  const reopened = workspacePanel(page, '练习、错题与历年报告')
  await reopened.getByRole('tab', { name: '历年冻结报告' }).click()
  await reopened.getByLabel('报告备考年度').selectOption('2023')
  await reopened.getByRole('button', { name: /第1版/ }).click()
  await expect(reopened.locator('.frozen-report')).toContainText('166小时40分钟')
  const actualFrozen = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const r = indexedDB.open('XiaokaoyaStudy')
        r.onsuccess = () => {
          const d = r.result,
            q = d.transaction('reportSnapshots').objectStore('reportSnapshots').getAll()
          q.onsuccess = () => {
            d.close()
            resolve(q.result[0])
          }
          q.onerror = () => reject(q.error)
        }
      }),
  )
  expect(actualFrozen).toEqual(frozen)
  await writeFile(
    resolve('.runtime/stage8-volume-evidence.json'),
    JSON.stringify(
      {
        synthetic: true,
        realFiveYearUsageClaimed: false,
        profile,
        years: seed.years,
        counts: inspection.counts,
        bytes,
        limitBytes: MAX_FILE_BYTES,
        checksum: backup.checksum.value,
        times,
        assertedActualSeconds: 3000000,
        assertedAnnualSeconds: 600000,
        passed: true,
      },
      null,
      2,
    ),
  )
})
