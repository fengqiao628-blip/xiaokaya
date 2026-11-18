import { ipcMain, powerMonitor, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import type { LifecycleEvent } from '../shared/lifecycle'

export function registerLifecycle(
  window: BrowserWindow,
  validate: (event: IpcMainInvokeEvent) => void,
) {
  let armed = false,
    approved = false,
    pending: string | null = null
  const send = (event: LifecycleEvent) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send('desktop:lifecycle', event)
  }
  ipcMain.handle('desktop:lifecycle-arm', (event) => {
    validate(event)
    armed = true
  })
  ipcMain.handle('desktop:finish-close', (event, token: unknown) => {
    validate(event)
    if (typeof token !== 'string' || token !== pending) throw new Error('关闭请求已失效')
    approved = true
    pending = null
    window.close()
  })
  ipcMain.handle('desktop:cancel-close', (event, token: unknown) => {
    validate(event)
    if (token === pending) pending = null
  })
  window.webContents.on('did-start-loading', () => {
    armed = false
    pending = null
  })
  window.webContents.on('render-process-gone', () => {
    armed = false
    pending = null
  })
  window.on('close', (event) => {
    if (!armed || approved) return
    event.preventDefault()
    pending ??= randomUUID()
    send({ kind: 'close', token: pending })
  })
  powerMonitor.on('lock-screen', () => send({ kind: 'lock' }))
  powerMonitor.on('suspend', () => send({ kind: 'sleep' }))
  powerMonitor.on('resume', () => send({ kind: 'resume' }))
}
