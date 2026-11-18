import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { resolve, join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { parseBackup, inspectBackup } from '../../src/shared/backup'
import { V1_SCHEMA, V2_SCHEMA, V3_SCHEMA, V4_SCHEMA, tablesForVersion } from '../../src/data/schema'
import { DATABASE_VERSION } from '../../src/shared/identity'

let app: ElectronApplication, page: Page, root: string
async function launch(profile: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
    ),
  ) as Record<string, string>
  env.XIAOKAOYA_E2E_PROFILE = profile
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [resolve('.')],
    env,
  })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
  root = (await page.evaluate(() => window.desktop.getInfo())).userData
}
async function saveDialog(file: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
}
async function openDialog(file: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
}
async function addTask(title: string) {
  await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill(title)
  await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function dataPanel() {
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  return page.getByRole('dialog', { name: '数据与备份', exact: true })
}
async function seed() {
  await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
  await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
  await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
  await addTask('备份测试 · 原任务')
}
test.afterEach(async () => {
  await app?.close()
})

for (const oldVersion of [1, 2, 3, 4] as const)
  test(`real Chromium V${oldVersion} profile is snapshotted before migration with every original row retained`, async () => {
    const profile = `legacy-native-${Date.now()}`
    await launch(profile)
    await seed()
    const saved = await page.evaluate(
      async (names) =>
        new Promise<Record<string, Record<string, unknown>[]>>((resolve, reject) => {
          const open = indexedDB.open('XiaokaoyaStudy')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result,
              tx = db.transaction(names, 'readonly'),
              data: Record<string, Record<string, unknown>[]> = {}
            for (const name of names) {
              const request = tx.objectStore(name).getAll()
              request.onsuccess = () => {
                data[name] = request.result
              }
            }
            tx.oncomplete = () => {
              db.close()
              resolve(data)
            }
            tx.onerror = () => reject(tx.error)
          }
        }),
      [...tablesForVersion(oldVersion)],
    )
    if (oldVersion >= 2)
      saved.migrationHistory = saved.migrationHistory.map((row) => ({
        ...row,
        toVersion: oldVersion,
      }))
    saved.tasks = saved.tasks.map(({ kind, ...task }) => task)
    for (const table of ['dailyQuotes', 'quoteHistory'])
      saved[table] = saved[table].map(({ attribution: _, ...row }) => row)
    await app.close()
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
      ),
    ) as Record<string, string>
    env.XIAOKAOYA_E2E_PROFILE = profile
    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [resolve('tests/fixtures/legacy-profile.cjs')],
      env,
    })
    page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '旧版数据库测试夹具' })).toBeVisible()
    await page.evaluate(
      async ({ schema, data, version }) => {
        const moduleUrl = 'app://xiaokaoya/dexie.mjs'
        const Dexie = (await import(moduleUrl)).default
        await Dexie.delete('XiaokaoyaStudy')
        const old = new Dexie('XiaokaoyaStudy')
        old.version(version).stores(schema)
        await old.open()
        await old.transaction('rw', old.tables, async () => {
          for (const [name, records] of Object.entries(data))
            if (records.length) await old.table(name).bulkAdd(records)
        })
        old.close()
      },
      {
        schema: { 1: V1_SCHEMA, 2: V2_SCHEMA, 3: V3_SCHEMA, 4: V4_SCHEMA }[oldVersion],
        data: saved,
        version: oldVersion,
      },
    )
    await app.close()
    await launch(profile)
    const list = await page.evaluate(() => window.desktop.backup.listSnapshots())
    const migration = list.snapshots.find((snapshot) => snapshot.purpose === 'pre-migration')!
    expect(migration.schemaVersion).toBe(oldVersion)
    const oldBackup = await parseBackup(
      await page.evaluate((id) => window.desktop.backup.readSnapshot(id), migration.id),
    )
    expect(oldBackup.data).toEqual(saved)
    expect((await page.evaluate(() => window.desktop.backup.status())).journal?.status).toBe(
      'committed',
    )
    const target = join(root, 'migration-result.json')
    await saveDialog(target)
    const panel = await dataPanel()
    await panel.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
    await expect(panel.locator('.backup-result')).toContainText('已导出')
    const result = await parseBackup(await readFile(target, 'utf8'))
    expect(result.schemaVersion).toBe(DATABASE_VERSION)
    for (const name of tablesForVersion(oldVersion)) {
      if (name === 'migrationHistory')
        for (const row of oldBackup.data[name]) expect(result.data[name]).toContainEqual(row)
      else expect(result.data[name]).toEqual(oldBackup.data[name])
    }
    expect(result.data.datasetMeta[0].datasetId).toBe(oldBackup.datasetId)
  })

test('complete JSON export, failed preflight, confirmed restore, repeat import, CSV and snapshot recovery', async () => {
  const profile = `backup-flow-${Date.now()}`
  await launch(profile)
  await seed()
  const json = join(root, 'external-complete.json'),
    csv = join(root, 'external-tasks.csv'),
    bad = join(root, 'damaged.json')
  let panel = await dataPanel()
  await saveDialog(json)
  await panel.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(panel.locator('.backup-result')).toContainText('已导出')
  const envelope = await parseBackup(await readFile(json, 'utf8'))
  await inspectBackup(envelope)
  expect(envelope.data.tasks).toHaveLength(1)
  const broken = JSON.parse(JSON.stringify(envelope))
  broken.appVersion = 'tampered'
  await writeFile(bad, JSON.stringify(broken), 'utf8')
  await openDialog(bad)
  await panel.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await expect(panel.locator('.backup-error')).toContainText('校验失败')
  await expect(panel.getByRole('button', { name: '先备份，再恢复', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await addTask('备份测试 · 导出后新增')
  await expect(page.getByTestId('task-row')).toHaveCount(2)
  panel = await dataPanel()
  await saveDialog(csv)
  await panel.getByRole('button', { name: '导出 CSV', exact: true }).click()
  await expect(panel.locator('.backup-result')).toContainText('external-tasks.csv')
  expect((await readFile(csv, 'utf8')).startsWith('\uFEFF')).toBe(true)
  expect(await readFile(csv, 'utf8')).toContain('导出后新增')
  await openDialog(json)
  await panel.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await expect(panel.getByRole('region', { name: '备份预检结果' })).toBeVisible()
  const restore = panel.getByRole('button', { name: '先备份，再恢复', exact: true })
  await expect(restore).toBeDisabled()
  await panel.getByRole('checkbox', { name: '确认整体替换当前数据', exact: true }).check()
  await restore.click()
  await expect(panel.locator('.backup-result')).toContainText('完整恢复成功')
  await expect(page.getByTestId('task-row')).toHaveCount(1)
  const list = await page.evaluate(() => window.desktop.backup.listSnapshots())
  const before = list.snapshots.find((snapshot) => snapshot.purpose === 'pre-restore')!
  expect(before.counts.tasks).toBe(2)
  await panel.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await expect(
    panel.getByText('内容与本机一致，无需恢复；没有新增或重复任何记录。', { exact: true }),
  ).toBeVisible()
  expect((await page.evaluate(() => window.desktop.backup.listSnapshots())).snapshots.length).toBe(
    list.snapshots.length,
  )
  await panel.getByRole('button', { name: `预检快照 ${before.id}`, exact: true }).click()
  await panel.getByRole('checkbox', { name: '确认整体替换当前数据', exact: true }).check()
  await panel.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(panel.locator('.backup-result')).toContainText('完整恢复成功')
  await expect(page.getByTestId('task-row')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/backup-panel.png' })
  await app.close()
  await launch(profile)
  await app.context().setOffline(true)
  await page.reload()
  await expect(page.getByTestId('task-row')).toHaveCount(2)
})

test('native file cancellation is harmless and a failed database restore leaves both tasks intact', async () => {
  await launch(`backup-failure-${Date.now()}`)
  await seed()
  const json = join(root, 'safe-original.json')
  let panel = await dataPanel()
  await saveDialog(json)
  await panel.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(panel.locator('.backup-result')).toContainText('已导出')
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  })
  await panel.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已取消')
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await addTask('失败恢复时需要保留的新增任务')
  panel = await dataPanel()
  await openDialog(json)
  await panel.getByRole('button', { name: '选择 JSON 预检', exact: true }).click()
  await panel.getByRole('checkbox', { name: '确认整体替换当前数据', exact: true }).check()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    ;(window as unknown as { restoreAdd: () => void }).restoreAdd = () => {
      IDBObjectStore.prototype.add = original
    }
    IDBObjectStore.prototype.add = function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === 'tasks')
        throw new DOMException('restore failure injected', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await panel.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(panel.locator('.backup-error')).toContainText('回滚')
  await expect(page.getByTestId('task-row')).toHaveCount(2)
  expect((await page.evaluate(() => window.desktop.backup.status())).journal?.status).toBe(
    'rolled-back',
  )
  await page.evaluate(() => (window as unknown as { restoreAdd: () => void }).restoreAdd())
  await panel.getByRole('button', { name: '先备份，再恢复', exact: true }).click()
  await expect(panel.locator('.backup-result')).toContainText('完整恢复成功')
  await expect(page.getByTestId('task-row')).toHaveCount(1)
})
