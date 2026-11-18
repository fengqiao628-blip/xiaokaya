import { _electron as electron } from '@playwright/test'
import { resolve, join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'

const mode = process.argv[2] || 'verify'
if (!['initial', 'verify'].includes(mode)) throw new Error('Use initial or verify')
const executable = resolve('.runtime/installed/Xiaokaoya.exe')
const marker = resolve('.runtime/installed-verification.json')
if (mode === 'initial' && existsSync(marker))
  throw new Error('Initial test already recorded; refusing to create more test data')
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
  ),
)
env.Path = join(process.env.SystemRoot, 'System32')
env.PATH = env.Path
env.XIAOKAOYA_E2E_PROFILE = 'must-be-ignored-in-packaged-app'
const app = await electron.launch({ executablePath: executable, args: [], env })
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: '今天，也向前一小步。' }).waitFor()
  await app.context().setOffline(true)
  await page.reload()
  await page.getByRole('heading', { name: '今天，也向前一小步。' }).waitFor()
  const info = await page.evaluate(() => window.desktop.getInfo())
  assert.equal(info.environment, 'production')
  assert.equal(info.userData, join(process.env.APPDATA, 'Xiaokaoya'))
  assert.equal(info.sessionData, join(info.userData, 'profile'))
  assert.equal(info.appId, 'cn.xiaokaoya.study')
  assert.equal(info.databaseName, 'XiaokaoyaStudy')
  assert.equal(await page.evaluate(() => location.origin), 'app://xiaokaoya')
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  const storagePath = await app.evaluate(({ session }) => session.defaultSession.storagePath)
  assert.equal(storagePath, info.sessionData)
  if (mode === 'initial') {
    await page.getByRole('button', { name: '选择我的科目', exact: true }).click()
    await page.getByLabel('目标考试年份', { exact: true }).fill('2027')
    await page.getByRole('checkbox', { name: 'CPA · 会计', exact: true }).check()
    await page.getByRole('button', { name: '保存科目选择', exact: true }).click()
    await page.getByRole('button', { name: '新建学习任务', exact: true }).click()
    await page.getByLabel('任务内容', { exact: true }).fill('安装验收 · 仅测试数据')
    await page.getByRole('button', { name: '保存学习任务', exact: true }).click()
    await page.getByRole('button', { name: '学习伙伴', exact: true }).click()
    await page.getByRole('button', { name: '选择小狗布丁', exact: true }).click()
    await page
      .getByRole('button', { name: '选择小狗布丁', exact: true })
      .getAttribute('aria-pressed')
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  }
  await page.getByText('安装验收 · 仅测试数据', { exact: true }).waitFor()
  await page.getByRole('button', { name: '小狗布丁陪着你', exact: true }).waitFor()
  const records = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('XiaokaoyaStudy')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const names = ['annualPlans', 'cycles', 'tasks', 'preferences']
        const tx = db.transaction(names, 'readonly')
        const result = {}
        for (const name of names) {
          const request = tx.objectStore(name).getAll()
          request.onsuccess = () => {
            result[name] = request.result.sort((a, b) => a.id.localeCompare(b.id))
          }
        }
        tx.oncomplete = () => {
          db.close()
          resolve(result)
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  })
  if (mode === 'initial') writeFileSync(marker, JSON.stringify({ info, records }, null, 2))
  else assert.deepEqual(records, JSON.parse(readFileSync(marker, 'utf8')).records)
  assert.equal(
    await page
      .locator('img')
      .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
    true,
  )
  await page.screenshot({ path: '.runtime/installed-desktop.png' })
  console.log(
    JSON.stringify(
      {
        mode,
        version: info.version,
        origin: 'app://xiaokaoya',
        userData: info.userData,
        sessionData: storagePath,
        testTasks: records.tasks.length,
        offline: 'passed',
        developerToolsPathRemoved: true,
        persistence: 'passed',
      },
      null,
      2,
    ),
  )
} finally {
  await app.close()
}
