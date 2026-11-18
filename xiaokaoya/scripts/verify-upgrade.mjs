import { _electron as electron } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
// A child launched by an MSIX-packaged tool may inherit AppData redirection.
// Matching path strings then does not prove it is the user's desktop profile.
if (process.env.CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY) {
  throw new Error(
    '当前工具运行在 Windows 应用隔离环境中，不能据此验收桌面正式数据。请从 Windows 桌面启动小考鸭，再通过界面导出和重开核对；自动化只使用隔离测试profile。',
  )
}
const target = resolve('.runtime/installed/Xiaokaoya.exe')
const output = resolve('.runtime/upgrade-checks')
await mkdir(output, { recursive: true })
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
  ),
)
env.Path = join(process.env.SystemRoot, 'System32')
env.PATH = env.Path
const app = await electron.launch({ executablePath: target, args: [], env })
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: '今天，也向前一小步。' }).waitFor({ timeout: 45000 })
  const info = await page.evaluate(() => window.desktop.getInfo())
  assert.equal(info.version, '0.2.0')
  assert.equal(info.userData, join(process.env.APPDATA, 'Xiaokaoya'))
  assert.equal(info.sessionData, join(info.userData, 'profile'))
  assert.equal(await page.evaluate(() => location.origin), 'app://xiaokaoya')
  const listing = await page.evaluate(() => window.desktop.backup.listSnapshots())
  const legacy = listing.snapshots.find(
    (item) => item.purpose === 'pre-migration' && item.schemaVersion === 1,
  )
  assert.ok(legacy, 'Verified pre-upgrade V1 snapshot must exist')
  const before = JSON.parse(
    await page.evaluate((id) => window.desktop.backup.readSnapshot(id), legacy.id),
  )
  const exported = join(output, 'full-after-upgrade.json')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, exported)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '数据与备份', exact: true })
  await panel.getByRole('button', { name: '导出完整 JSON', exact: true }).click()
  await panel.locator('.backup-result').filter({ hasText: '已导出' }).waitFor()
  const after = JSON.parse(await readFile(exported, 'utf8'))
  assert.equal(after.schemaVersion, 2)
  assert.equal(after.datasetId, before.datasetId)
  let compared = 0
  for (const [name, records] of Object.entries(before.data)) {
    const byId = new Map(after.data[name].map((row) => [row.id ?? row.date, row]))
    for (const row of records) {
      assert.deepEqual(byId.get(row.id ?? row.date), row, `Original row changed: ${name}`)
      compared++
    }
  }
  assert.ok(
    after.data.migrationHistory.some(
      (record) =>
        record.fromVersion === 1 && record.toVersion === 2 && record.snapshotId === legacy.id,
    ),
  )
  await app.context().setOffline(true)
  await page.screenshot({ path: join(output, 'installed-backup-panel.png') })
  const journal = (await page.evaluate(() => window.desktop.backup.status())).journal
  assert.equal(journal.status, 'committed')
  const result = {
    version: info.version,
    legacySnapshotId: legacy.id,
    oldSchemaVersion: 1,
    newSchemaVersion: 2,
    comparedLegacyRows: compared,
    preservedCounts: before.counts,
    currentCounts: after.counts,
    userData: info.userData,
    sessionData: info.sessionData,
    origin: 'app://xiaokaoya',
    journal: journal.status,
    completeExportVerified: true,
    externalBackup: exported,
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await app.close()
}
