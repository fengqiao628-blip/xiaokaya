// Test-only Electron harness. It can only access named legacy E2E profiles under this checkout.
const { app, BrowserWindow, protocol } = require('electron')
const { resolve, join, dirname } = require('node:path')
const { mkdirSync, readFileSync } = require('node:fs')
const profile = process.env.XIAOKAOYA_E2E_PROFILE || ''
if (!/^legacy-native-[0-9]+$/.test(profile))
  throw new Error('Isolated legacy test profile required')
const root = resolve(__dirname, '../..', '.runtime/e2e', profile)
mkdirSync(join(root, 'profile'), { recursive: true })
app.setPath('userData', root)
app.setPath('sessionData', join(root, 'profile'))
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'xiaokaoya') return new Response('not found', { status: 404 })
    if (url.pathname === '/dexie.mjs')
      return new Response(
        readFileSync(join(dirname(require.resolve('dexie')), 'dexie.mjs'), 'utf8'),
        { headers: { 'Content-Type': 'text/javascript' } },
      )
    if (url.pathname === '/')
      return new Response('<!doctype html><meta charset="utf-8"><h1>旧版数据库测试夹具</h1>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    return new Response('not found', { status: 404 })
  })
  const window = new BrowserWindow({
    show: true,
    width: 800,
    height: 650,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  await window.loadURL('app://xiaokaoya/')
})
app.on('window-all-closed', () => app.quit())
