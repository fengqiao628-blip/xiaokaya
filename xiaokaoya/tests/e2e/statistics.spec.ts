import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type Locator,
} from '@playwright/test'
import electronPath from 'electron'
import { resolve, join } from 'node:path'
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import {
  analyticsFixture,
  chapter,
  entity,
  material,
  session,
  segment,
  task,
} from '../fixtures/analytics'
import { defaultCycleStatus } from '../../src/shared/migration'
import { inspectBackup, parseBackup } from '../../src/shared/backup'
let app: ElectronApplication, page: Page, root: string
async function launch(profile: string, appRoot = resolve('.')) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined),
  ) as Record<string, string>
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appRoot],
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
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function stats() {
  await page.getByRole('button', { name: '学习统计与进度', exact: true }).click()
  return page.getByRole('dialog', { name: '学习统计与进度', exact: true })
}
async function pastWeek(panel: Locator) {
  await panel.getByLabel('统计定位日期', { exact: true }).fill('2024-02-29')
}
const metric = (panel: Locator, label: string) =>
  panel.getByRole('article', { name: label, exact: true })
async function snapshot() {
  return page.evaluate(
    () =>
      new Promise<{ version: number; tables: Record<string, unknown[]> }>((resolve, reject) => {
        const request = indexedDB.open('XiaokaoyaStudy')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result,
            tables: Record<string, unknown[]> = {},
            names = [
              'annualPlans',
              'cycles',
              'cycleStatuses',
              'tasks',
              'studySessions',
              'timeSegments',
              'focusTimers',
              'chapters',
              'materials',
              'materialProgress',
              'weeklyPlans',
              'weeklySubjectTargets',
              'migrationHistory',
            ]
          const tx = db.transaction(names, 'readonly')
          for (const name of names) {
            const get = tx.objectStore(name).getAll()
            get.onsuccess = () => {
              tables[name] = get.result
            }
          }
          tx.oncomplete = () => {
            resolve({ version: db.version / 10, tables })
            db.close()
          }
          tx.onerror = () => {
            reject(tx.error)
            db.close()
          }
        }
      }),
  )
}
async function seed() {
  const d = analyticsFixture()
  d.tasks = [
    task('focus-task', { title: '统计测试任务', chapterId: 'chapter1' }),
    task('finished', {
      title: '已完成小任务',
      chapterId: 'chapter2',
      plannedDate: '2024-02-28',
      estimatedSeconds: 1800,
      status: 'completed',
    }),
    task('cancel', { title: '已取消小任务', status: 'cancelled' }),
    task('pool', { title: '未定日期任务', plannedDate: null }),
    task('tax-task', { title: '税务师历史任务', cycleId: 't27', estimatedSeconds: 1200 }),
    task('target28', { title: '2028年度任务', cycleId: 'a28', estimatedSeconds: 600 }),
  ]
  d.chapters = [
    chapter('chapter1', { title: '第一章 · 阅读完成仍需巩固', masteryStars: 1 }),
    chapter('chapter2', { title: '第二章 · 未评分', completionStatus: 'completed' }),
    chapter('archived-chapter', { title: '旧版本章节', archivedAt: entity.updatedAt }),
    chapter('new-chapter', { cycleId: 'a28', title: '新年度章节' }),
    chapter('paper1-chapter', {
      cycleId: 'comp',
      partId: 'cpa-comprehensive-1',
      title: '综合试卷一章节',
      masteryStars: 4,
    }),
    chapter('paper2-chapter', {
      cycleId: 'comp',
      partId: 'cpa-comprehensive-2',
      title: '综合试卷二章节',
    }),
  ]
  d.materials = [
    material('book', { title: '2027教材' }),
    material('video', { title: '2027视频', kind: 'video' }),
    material('old-book', { title: '归档教材', archivedAt: entity.updatedAt }),
    material('new-book', { cycleId: 'a28', title: '2028教材', edition: '2028版' }),
    material('paper1-book', {
      cycleId: 'comp',
      title: '综合试卷一教材',
      partId: 'cpa-comprehensive-1',
    }),
  ]
  d.materialProgress = [
    {
      ...entity,
      id: 'progress-book',
      materialId: 'book',
      chapterId: 'chapter1',
      progressPercent: 100,
    },
    {
      ...entity,
      id: 'progress-video',
      materialId: 'video',
      chapterId: 'chapter1',
      progressPercent: 20,
    },
    {
      ...entity,
      id: 'old-progress',
      materialId: 'old-book',
      chapterId: 'archived-chapter',
      progressPercent: 100,
    },
    {
      ...entity,
      id: 'paper1-progress',
      materialId: 'paper1-book',
      chapterId: 'paper1-chapter',
      progressPercent: 100,
    },
  ]
  const metadata = {
    chapterId: 'chapter1',
    notes: '统计验证',
    overlapAcknowledged: false,
    voidReason: '',
  }
  d.sessions = [
    session('focus-saved:2024-02-29', {
      ...metadata,
      taskId: 'focus-task',
      source: 'timer',
      entryId: 'focus-saved',
      timerId: 'saved',
      timeMode: 'segments',
      durationOnlySeconds: null,
    }),
    session('manual-one:2024-02-29', {
      ...metadata,
      taskId: 'focus-task',
      source: 'manual',
      entryId: 'manual-one',
      timerId: null,
      timeMode: 'segments',
      durationOnlySeconds: null,
    }),
    session('void-one:2024-02-29', {
      ...metadata,
      taskId: 'focus-task',
      source: 'manual',
      entryId: 'void-one',
      timerId: null,
      status: 'voided',
      timeMode: 'segments',
      durationOnlySeconds: null,
      voidReason: '重复补录作废',
    }),
    session('tax-legacy', { cycleId: 't27', durationOnlySeconds: 300 }),
    session('year28-legacy', { cycleId: 'a28', durationOnlySeconds: 600 }),
  ]
  d.segments = [
    segment(
      'timer-piece',
      'focus-saved:2024-02-29',
      '2024-02-29T01:30:00.000Z',
      '2024-02-29T01:31:00.000Z',
    ),
    segment(
      'manual-piece',
      'manual-one:2024-02-29',
      '2024-02-29T01:00:00.000Z',
      '2024-02-29T01:20:00.000Z',
    ),
    segment(
      'void-piece',
      'void-one:2024-02-29',
      '2024-02-29T01:00:00.000Z',
      '2024-02-29T01:20:00.000Z',
    ),
  ]
  d.weeklyPlans = [
    {
      ...entity,
      id: '2024-02-26',
      weekStart: '2024-02-26',
      goalSeconds: 10800,
      focus: '慢慢学，留一点时间复习',
    },
  ]
  d.weeklySubjectTargets = [
    {
      ...entity,
      id: 'a-target',
      weekStart: '2024-02-26',
      cycleId: 'a27',
      targetSeconds: 7200,
      active: true,
    },
    {
      ...entity,
      id: 'tax-target',
      weekStart: '2024-02-26',
      cycleId: 't27',
      targetSeconds: 1800,
      active: true,
    },
  ]
  const runBase = {
    ...entity,
    cycleId: 'a27',
    taskId: 'focus-task',
    chapterId: 'chapter1',
    targetSeconds: 60,
    checkpointAt: '2024-02-29T03:01:00.000Z',
  }
  const tables = {
    annualPlans: d.plans,
    cycles: d.cycles,
    cycleStatuses: d.cycles.map((c) => defaultCycleStatus(c.id, entity.createdAt)),
    tasks: d.tasks,
    studySessions: d.sessions,
    timeSegments: d.segments,
    materials: d.materials,
    chapters: d.chapters,
    materialProgress: d.materialProgress,
    weeklyPlans: d.weeklyPlans,
    weeklySubjectTargets: d.weeklySubjectTargets,
    focusTimers: [
      {
        ...runBase,
        id: 'saved',
        status: 'saved',
        reason: 'due',
        intervals: [{ startedAt: '2024-02-29T01:30:00.000Z', endedAt: '2024-02-29T01:31:00.000Z' }],
        sessionIds: ['focus-saved:2024-02-29'],
      },
      {
        ...runBase,
        id: 'pending',
        status: 'review',
        reason: 'exit',
        intervals: [{ startedAt: '2024-02-29T03:00:00.000Z', endedAt: '2024-02-29T03:00:30.000Z' }],
        sessionIds: [],
      },
      {
        ...runBase,
        id: 'discarded',
        status: 'discarded',
        reason: 'exit',
        intervals: [{ startedAt: '2024-02-29T02:00:00.000Z', endedAt: '2024-02-29T02:00:46.000Z' }],
        sessionIds: [],
      },
    ],
  }
  await page.evaluate(
    (tables) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('XiaokaoyaStudy')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction(Object.keys(tables), 'readwrite')
          for (const [name, rows] of Object.entries(tables))
            for (const row of rows) tx.objectStore(name).put(row)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      }),
    tables,
  )
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '累计实际学习', exact: true }).locator('..'),
  ).toContainText('36')
}
async function saveDialog(file: string | null) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: !file, filePath: file ?? '' })
  }, file)
}
async function chooseDialog(file: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
}
async function exportJson(file: string) {
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '数据与备份', exact: true })
  await saveDialog(file)
  await panel.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(panel.locator('.backup-result')).toContainText('已导出')
  const backup = await parseBackup(await readFile(file, 'utf8'))
  await inspectBackup(backup)
  return backup
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
})

test('time filters separate actual and companion, preserve archived and target-year history, and drill into leap-month dates', async () => {
  await launch(`statistics-time-${Date.now()}`)
  await seed()
  const before = await snapshot()
  await expect(page.getByTestId('today-companion-time')).toHaveText('0分钟')
  await expect(page.getByTestId('total-companion-time')).toHaveText('1分钟')
  const panel = await stats()
  await pastWeek(panel)
  await expect(metric(panel, '本范围实际学习')).toContainText('36分钟')
  await expect(metric(panel, '其中伙伴陪伴')).toContainText('1分钟')
  await expect(metric(panel, '本范围预计安排')).toContainText('2小时')
  await panel.getByLabel('统计备考年份', { exact: true }).selectOption('2027')
  await expect(metric(panel, '本范围实际学习')).toContainText('26分钟')
  await panel.getByLabel('统计年度科目', { exact: true }).selectOption('a27')
  await expect(metric(panel, '本范围实际学习')).toContainText('21分钟')
  await panel.getByRole('button', { name: '重置筛选', exact: true }).click()
  await panel.getByRole('checkbox', { name: '包含已归档科目', exact: true }).uncheck()
  await expect(metric(panel, '本范围实际学习')).toContainText('31分钟')
  await panel.getByRole('button', { name: '重置筛选', exact: true }).click()
  await panel.getByLabel('统计考试分类', { exact: true }).selectOption('tax')
  await expect(metric(panel, '本范围实际学习')).toContainText('5分钟')
  await panel.getByRole('button', { name: '重置筛选', exact: true }).click()
  await panel
    .getByRole('group', { name: '学习时间范围' })
    .getByRole('button', { name: '年', exact: true })
    .click()
  await panel.getByLabel('统计定位日期', { exact: true }).fill('2027-01-01')
  await expect(metric(panel, '本范围实际学习')).toContainText('0分钟')
  await panel.getByLabel('统计定位日期', { exact: true }).fill('2024-02-29')
  await panel.getByRole('button', { name: /^查看2024-02：实际/ }).click()
  await expect(panel.getByLabel('当前统计日期范围')).toHaveText('2024-02-01 — 2024-02-29')
  await panel.getByRole('button', { name: /^查看2024-02-29：实际/ }).click()
  await expect(metric(panel, '本范围实际学习')).toContainText('36分钟')
  expect(await snapshot()).toEqual(before)
  await mkdir('test-results', { recursive: true })
  await panel
    .getByRole('group', { name: '学习时间范围' })
    .getByRole('button', { name: '周', exact: true })
    .click()
  await page.screenshot({ path: 'test-results/statistics-time.png' })
  await panel.getByRole('region', { name: '学习时间趋势', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/statistics-trend.png' })
})
test('current textbook and video progress stays independent of chapter completion and stars, with exact annual dossier navigation', async () => {
  await launch(`statistics-progress-${Date.now()}`)
  await seed()
  const before = await snapshot(),
    panel = await stats()
  await panel.getByLabel('统计年度科目', { exact: true }).selectOption('a27')
  await panel.getByRole('button', { name: '学习进度', exact: true }).click()
  await expect(metric(panel, '当前已完成章节')).toContainText('1 / 2章')
  await expect(metric(panel, '当前平均掌握')).toContainText('1.0 / 5星')
  await expect(
    panel.getByRole('article', { name: '资料进度：2027教材', exact: true }),
  ).toContainText('50%')
  await expect(
    panel.getByRole('article', { name: '资料进度：2027视频', exact: true }),
  ).toContainText('10%')
  const chapterRow = panel.getByRole('row').filter({ hasText: '第一章 · 阅读完成仍需巩固' })
  await expect(chapterRow).toContainText('未开始')
  await expect(chapterRow).toContainText('1 / 5')
  await expect(chapterRow).toContainText('100%')
  await page.screenshot({ path: 'test-results/statistics-progress.png' })
  await panel
    .getByRole('article', { name: '资料进度：2027教材', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/statistics-progress-details.png' })
  await panel.getByRole('checkbox', { name: '包含已归档资料与章节', exact: true }).check()
  await expect(metric(panel, '当前已完成章节')).toContainText('1 / 3章')
  await expect(panel.getByRole('article', { name: '资料进度：归档教材' })).toBeVisible()
  await panel.getByRole('checkbox', { name: '包含已归档资料与章节', exact: true }).uncheck()
  expect(await snapshot()).toEqual(before)
  await panel
    .getByRole('article', { name: '资料进度：2027教材', exact: true })
    .getByRole('button', { name: '到年度档案更新', exact: true })
    .click()
  const dossier = page.getByRole('dialog', { name: '我的年度科目档案', exact: true })
  await expect(dossier.getByLabel('查看备考年份')).toHaveValue('2027')
  await expect(
    dossier.getByRole('button', { name: '查看CPA · 会计 · 2027', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await dossier
    .getByRole('button', { name: '编辑章节：第一章 · 阅读完成仍需巩固', exact: true })
    .click()
  const editor = dossier.getByRole('form', { name: '编辑学习章节', exact: true })
  await editor.getByLabel('章节完成情况', { exact: true }).selectOption('completed')
  await editor.getByLabel('知识掌握星级', { exact: true }).selectOption('4')
  await editor.getByRole('button', { name: '保存学习章节', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await closePanel()
  const refreshed = await stats()
  await refreshed.getByLabel('统计年度科目', { exact: true }).selectOption('a27')
  await refreshed.getByRole('button', { name: '学习进度', exact: true }).click()
  await expect(metric(refreshed, '当前已完成章节')).toContainText('2 / 2章')
  await expect(metric(refreshed, '当前平均掌握')).toContainText('4.0 / 5星')
  await expect(
    refreshed.getByRole('article', { name: '资料进度：2027教材', exact: true }),
  ).toContainText('50%')
})
test('weekly review keeps all-subject goals separate, uses scoped allocations and shows related chapter current state without rescheduling', async () => {
  await launch(`statistics-week-${Date.now()}`)
  await seed()
  const before = await snapshot(),
    panel = await stats()
  await pastWeek(panel)
  await panel.getByRole('button', { name: '每周总结', exact: true }).click()
  await expect(metric(panel, '全科周目标')).toContainText('3小时')
  await expect(metric(panel, '本周实际学习')).toContainText('36分钟')
  await panel.getByLabel('统计年度科目', { exact: true }).selectOption('a27')
  await expect(metric(panel, '筛选科目目标')).toContainText('2小时')
  await expect(metric(panel, '本周实际学习')).toContainText('21分钟')
  await expect(metric(panel, '本周任务完成')).toContainText('1 / 2项')
  await expect(panel.getByRole('region', { name: '本周未完成任务' })).toContainText(
    '未定日期的待安排任务另有1项',
  )
  await expect(panel.getByRole('region', { name: '本周关联章节当前状态' })).toContainText(
    '当前完成1章',
  )
  await expect(panel.getByRole('region', { name: '本周各科目标与时间' })).toContainText(
    '全科总目标：3小时',
  )
  await page.screenshot({ path: 'test-results/statistics-week.png' })
  await panel.getByLabel('统计年度科目', { exact: true }).selectOption('a28')
  await expect(metric(panel, '筛选科目目标')).toContainText('未设置')
  expect(await snapshot()).toEqual(before)
  await panel.getByRole('button', { name: '调整本周学习安排', exact: true }).click()
  const planner = page.getByRole('dialog', { name: '学习计划与日历', exact: true })
  await expect(planner).toContainText('2024-02-26 — 2024-03-03')
  expect(await snapshot()).toEqual(before)
})
test('time, progress and weekly CSV exports include exact seconds; cancellation and filesystem failure leave filters and data untouched', async () => {
  await launch(`statistics-exports-${Date.now()}`)
  await seed()
  const before = await snapshot(),
    panel = await stats()
  await pastWeek(panel)
  const file = join(root, 'time-statistics.csv')
  await saveDialog(file)
  await panel.getByRole('button', { name: '导出当前统计CSV', exact: true }).click()
  await expect(panel.locator('.stats-export-result')).toContainText(file)
  const csv = await readFile(file, 'utf8')
  expect(csv.startsWith('\uFEFF')).toBe(true)
  expect(csv).toContain('其中陪伴秒')
  expect(csv).toContain('"2160","60","1200","900","7200"')
  await panel.getByRole('button', { name: '学习进度', exact: true }).click()
  const progress = join(root, 'progress.csv')
  await saveDialog(progress)
  await panel.getByRole('button', { name: '导出当前统计CSV', exact: true }).click()
  await expect(panel.locator('.stats-export-result')).toContainText(progress)
  expect(await readFile(progress, 'utf8')).toContain('未评分为空')
  await panel.getByRole('button', { name: '每周总结', exact: true }).click()
  const weekly = join(root, 'week.csv')
  await saveDialog(weekly)
  await panel.getByRole('button', { name: '导出当前统计CSV', exact: true }).click()
  await expect(panel.locator('.stats-export-result')).toContainText(weekly)
  expect(await readFile(weekly, 'utf8')).toContain('本周关联章节（当前状态）')
  await saveDialog(null)
  await panel.getByRole('button', { name: '导出当前统计CSV', exact: true }).click()
  await expect(panel.locator('.stats-export-result')).toContainText('已取消')
  const invalid = join(root, 'existing-directory.csv')
  await mkdir(invalid)
  await saveDialog(invalid)
  await panel.getByRole('button', { name: '导出当前统计CSV', exact: true }).click()
  await expect(panel.locator('.toast.error')).toBeVisible()
  await expect(panel.getByLabel('统计定位日期')).toHaveValue('2024-02-29')
  expect(await snapshot()).toEqual(before)
})
test('full V5 JSON restore and failed restore recompute every statistic; offline close and reopen retain the same totals', async () => {
  test.setTimeout(90000)
  const profile = `statistics-restore-${Date.now()}`
  await launch(profile)
  await seed()
  const file = join(root, 'complete-v5.json'),
    backup = await exportJson(file)
  expect(backup.schemaVersion).toBe(7)
  await closePanel()
  await page.getByRole('button', { name: '学习记录与计时', exact: true }).click()
  let learning = page.getByRole('dialog', { name: '学习记录与计时', exact: true })
  await learning
    .getByRole('article', { name: '学习记录：manual-one:2024-02-29', exact: true })
    .getByRole('button', { name: '作废记录', exact: true })
    .click()
  await learning.getByLabel('学习记录作废说明', { exact: true }).fill('恢复重算测试')
  await learning.getByRole('button', { name: '确认作废记录', exact: true }).click()
  await closePanel()
  let panel = await stats()
  await pastWeek(panel)
  await expect(metric(panel, '本范围实际学习')).toContainText('16分钟')
  await expect(metric(panel, '其中伙伴陪伴')).toContainText('1分钟')
  await closePanel()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const restore = page.getByRole('dialog', { name: '数据与备份', exact: true })
  await chooseDialog(file)
  await restore.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await restore.getByRole('checkbox', { name: '确认整体替换当前数据', exact: true }).check()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    ;(window as unknown as { undo: () => void }).undo = () => {
      IDBObjectStore.prototype.add = original
    }
    IDBObjectStore.prototype.add = function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === 'tasks')
        throw new DOMException('statistics restore failure', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await restore.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(restore.locator('.backup-error')).toContainText('回滚')
  await page.evaluate(() => (window as unknown as { undo: () => void }).undo())
  await closePanel()
  panel = await stats()
  await pastWeek(panel)
  await expect(metric(panel, '本范围实际学习')).toContainText('16分钟')
  await closePanel()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await chooseDialog(file)
  await restore.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await restore.getByRole('checkbox', { name: '确认整体替换当前数据', exact: true }).check()
  await restore.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(restore.locator('.backup-result')).toContainText('完整恢复成功')
  await closePanel()
  panel = await stats()
  await pastWeek(panel)
  await expect(metric(panel, '本范围实际学习')).toContainText('36分钟')
  await closePanel()
  await app.close()
  await launch(profile)
  await app.context().setOffline(true)
  await page.reload()
  await expect(page.getByTestId('total-companion-time')).toHaveText('1分钟')
  panel = await stats()
  await pastWeek(panel)
  await expect(metric(panel, '本范围实际学习')).toContainText('36分钟')
  expect((await snapshot()).version).toBe(7)
})
test('real 0.5.1 compiled app upgrades the identical isolated profile to V6 and preserves every original business row', async () => {
  test.setTimeout(90000)
  const require = createRequire(resolve('package.json')),
    builder = createRequire(require.resolve('electron-builder')),
    asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
  const clone = resolve('.runtime', `upgrade-stage6-${Date.now()}`)
  await mkdir(clone)
  asar.extractAll(resolve('.runtime/baseline/stage-5/app-0.5.1.asar'), clone)
  const profile = 'same-v5-profile'
  await launch(profile, clone)
  expect((await page.evaluate(() => window.desktop.getInfo())).version).toBe('0.5.1')
  await seed()
  const oldRoot = root,
    before = await snapshot()
  const oldBackup = await exportJson(join(root, 'old-v5.json'))
  expect(oldBackup.appVersion).toBe('0.5.1')
  await app.close()
  await cp(resolve('out'), join(clone, 'out'), { recursive: true, force: true })
  await writeFile(join(clone, 'package.json'), await readFile('package.json', 'utf8'), 'utf8')
  await launch(profile, clone)
  expect(root).toBe(oldRoot)
  expect((await page.evaluate(() => window.desktop.getInfo())).version).toBe(
    JSON.parse(await readFile('package.json', 'utf8')).version,
  )
  const after = await snapshot()
  expect(after.version).toBe(7)
  for (const [name, rows] of Object.entries(before.tables))
    if (name === 'migrationHistory') {
      for (const row of rows) expect(after.tables[name]).toContainEqual(row)
    } else expect(after.tables[name]).toEqual(rows)
  const panel = await stats()
  await pastWeek(panel)
  await expect(metric(panel, '本范围实际学习')).toContainText('36分钟')
  await expect(metric(panel, '其中伙伴陪伴')).toContainText('1分钟')
  expect((await snapshot()).tables.migrationHistory).toHaveLength(
    before.tables.migrationHistory.length + 1,
  )
})
test('empty and populated statistics are readable offline on narrow screens without clipping inputs or losing navigation', async () => {
  await launch(`statistics-narrow-${Date.now()}`)
  await app.context().setOffline(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(430, 900))
  let panel = await stats()
  await expect(metric(panel, '本范围实际学习')).toContainText('0分钟')
  await expect(metric(panel, '任务完成率')).toContainText('暂无任务')
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await panel.getByRole('button', { name: '学习进度', exact: true }).click()
  await expect(metric(panel, '当前平均掌握')).toContainText('未评分')
  await panel.getByRole('button', { name: '每周总结', exact: true }).click()
  await expect(metric(panel, '全科周目标')).toContainText('未设置')
  await closePanel()
  await seed()
  panel = await stats()
  await pastWeek(panel)
  await expect(metric(panel, '本范围实际学习')).toContainText('36分钟')
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await page.screenshot({ path: 'test-results/statistics-narrow.png' })
  await panel.getByRole('button', { name: '学习进度', exact: true }).click()
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
  await panel.getByRole('button', { name: '每周总结', exact: true }).click()
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true)
})

test('large chapter lists paginate while progress totals and exported CSV retain every chapter', async () => {
  await launch(`statistics-pages-${Date.now()}`)
  await seed()
  const chapters = Array.from({ length: 65 }, (_, i) =>
    chapter(`long-${String(i).padStart(3, '0')}`, {
      title: `长期学习章节${i + 1}`,
      order: i + 10,
      completionStatus: 'completed',
      masteryStars: 3,
    }),
  )
  await page.evaluate(
    (chapters) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('XiaokaoyaStudy')
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction('chapters', 'readwrite')
          for (const row of chapters) tx.objectStore('chapters').add(row)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
        req.onerror = () => reject(req.error)
      }),
    chapters,
  )
  // Raw fixture writes do not emit Dexie's mutation notifications.
  await page.reload()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  const panel = await stats()
  await panel.getByLabel('统计年度科目', { exact: true }).selectOption('a27')
  await panel.getByRole('button', { name: '学习进度', exact: true }).click()
  await expect(metric(panel, '当前已完成章节')).toContainText('66 / 67章')
  const table = panel.getByRole('region', { name: '章节掌握明细' }).getByRole('table')
  await expect(table.getByRole('row')).toHaveCount(51)
  await panel.getByRole('button', { name: '下一页章节', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(18)
  await expect(metric(panel, '当前已完成章节')).toContainText('66 / 67章')
  const file = join(root, 'all-chapters.csv')
  await saveDialog(file)
  await panel.getByRole('button', { name: '导出当前统计CSV', exact: true }).click()
  await expect(panel.locator('.stats-export-result')).toContainText(file)
  const csv = await readFile(file, 'utf8')
  expect(csv).toContain('长期学习章节1')
  expect(csv).toContain('长期学习章节65')
  expect(csv.match(/"章节"/g)).toHaveLength(67)
})
