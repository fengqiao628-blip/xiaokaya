import {
  app,
  BrowserWindow,
  protocol,
  net,
  ipcMain,
  shell,
  session,
  dialog,
  powerMonitor,
} from 'electron'
import { mkdirSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_ID, APP_ORIGIN, DATABASE_NAME, type DesktopInfo } from '../shared/identity'
import { storagePaths } from './storage'
import { resolveAppFile } from './protocol'
import { registerBackupIpc } from './backup-ipc'
import { registerLifecycle } from './lifecycle'
import { WindowsSpeech } from './speech'
import { serveWave } from './audio'
const speech = new WindowsSpeech()
let speechBlocked = false
// Process lifetime only: renderer reloads and backup restores cannot replay the greeting.
let startupGreetingClaimed = false
app.on('before-quit', () => speech.dispose())

const projectRoot = resolve(__dirname, '../..')
const paths = storagePaths(
  app.getPath('appData'),
  projectRoot,
  app.isPackaged,
  process.env.XIAOKAOYA_E2E_PROFILE,
)
mkdirSync(paths.sessionData, { recursive: true })
mkdirSync(join(paths.userData, 'logs'), { recursive: true })
// Both must be set before ready / any Session or BrowserWindow is created.
app.setPath('userData', paths.userData)
app.setPath('sessionData', paths.sessionData)
app.setAppUserModelId(APP_ID)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

function report(error: unknown) {
  appendFileSync(
    join(paths.userData, 'logs', 'desktop.log'),
    `${new Date().toISOString()} ${error instanceof Error ? error.stack : String(error)}\n`,
  )
}

const gotLock = app.requestSingleInstanceLock()
let mainWindow: BrowserWindow | null = null
function cancelSpeech() {
  void speech.stop()
  if (mainWindow && !mainWindow.webContents.isDestroyed())
    mainWindow.webContents.send('speech:cancel')
}
if (!gotLock) app.quit()
else {
  app.on('second-instance', () => {
    mainWindow?.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
  app
    .whenReady()
    .then(async () => {
      const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
      const root = join(__dirname, '../renderer')
      protocol.handle('app', async (request) => {
        const file = resolveAppFile(root, request.url)
        if (!file || !['GET', 'HEAD'].includes(request.method))
          return new Response('Not found', { status: 404 })
        try {
          if (file.toLowerCase().endsWith('.wav')) return await serveWave(file, request)
          const original = await net.fetch(pathToFileURL(file).toString())
          const headers = new Headers(original.headers)
          headers.set('Cache-Control', 'no-store')
          headers.set(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'",
          )
          return new Response(original.body, { status: original.status, headers })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      })
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      )
      session.defaultSession.setPermissionCheckHandler(() => false)
      if (!devUrl)
        session.defaultSession.webRequest.onBeforeRequest(
          { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
          (_details, callback) => callback({ cancel: true }),
        )

      function validateSender(event: Electron.IpcMainInvokeEvent) {
        const url = event.senderFrame?.url ?? ''
        if (
          event.sender !== mainWindow?.webContents ||
          (devUrl
            ? new URL(url).origin !== new URL(devUrl).origin
            : !url.startsWith(APP_ORIGIN + '/'))
        )
          throw new Error('IPC sender rejected')
      }
      ipcMain.handle('desktop:info', (event) => {
        validateSender(event)
        return {
          version: app.getVersion(),
          appId: APP_ID,
          ...paths,
          databaseName: DATABASE_NAME,
        } satisfies DesktopInfo
      })
      ipcMain.handle('speech:voices', (event) => {
        validateSender(event)
        return speech.voices()
      })
      ipcMain.handle('speech:startup-greeting', (event) => {
        validateSender(event)
        if (startupGreetingClaimed) return false
        startupGreetingClaimed = true
        return true
      })
      ipcMain.handle('speech:can-play', (event) => {
        validateSender(event)
        return !speechBlocked && Boolean(mainWindow?.isFocused())
      })
      ipcMain.handle('speech:configure', (event, policy) => {
        validateSender(event)
        return speech.configure(policy)
      })
      ipcMain.handle('speech:speak', (event, input) => {
        validateSender(event)
        if (speechBlocked || !mainWindow?.isFocused()) return { started: false }
        return speech.speak(input)
      })
      ipcMain.handle('speech:stop', (event) => {
        validateSender(event)
        return speech.stop()
      })
      powerMonitor.on('lock-screen', () => {
        speechBlocked = true
        cancelSpeech()
      })
      powerMonitor.on('suspend', () => {
        speechBlocked = true
        cancelSpeech()
      })
      powerMonitor.on('unlock-screen', () => {
        speechBlocked = false
      })
      powerMonitor.on('resume', () => {
        speechBlocked = false
      })
      registerBackupIpc(
        paths.userData,
        () => {
          if (!mainWindow) throw new Error('程序窗口尚未就绪')
          return mainWindow
        },
        validateSender,
      )
      ipcMain.handle('desktop:open-data', async (event) => {
        validateSender(event)
        const result = await shell.openPath(paths.userData)
        if (result) throw new Error(result)
      })

      mainWindow = new BrowserWindow({
        width: 1360,
        height: 940,
        minWidth: 390,
        minHeight: 640,
        backgroundColor: '#f8f9f6',
        title: '小考鸭 · 双证学习助手',
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
        },
      })
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      registerLifecycle(mainWindow, validateSender)
      mainWindow.on('blur', cancelSpeech)
      mainWindow.on('close', cancelSpeech)
      mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
      mainWindow.webContents.on('render-process-gone', (_event, details) =>
        report(`Renderer stopped: ${details.reason}`),
      )
      mainWindow.on('ready-to-show', () => mainWindow?.show())
      mainWindow.on('closed', () => {
        mainWindow = null
      })
      await mainWindow.loadURL(devUrl || APP_ORIGIN + '/')
    })
    .catch((error) => {
      report(error)
      dialog.showErrorBox(
        '小考鸭未能启动',
        '程序未能正常打开。已有数据不会被重置，请保留数据目录并查看日志。',
      )
      app.quit()
    })
}
app.on('window-all-closed', () => app.quit())
process.on('uncaughtException', report)
