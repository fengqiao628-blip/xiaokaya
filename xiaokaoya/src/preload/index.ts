import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../shared/identity'

const bridge: DesktopBridge = Object.freeze({
  getInfo: async () => ({
    ...(await ipcRenderer.invoke('desktop:info')),
    security: { contextIsolated: process.contextIsolated, sandboxed: process.sandboxed },
  }),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data'),
  speech: Object.freeze({
    claimStartupGreeting: () => ipcRenderer.invoke('speech:startup-greeting'),
    canPlay: () => ipcRenderer.invoke('speech:can-play'),
    onCancel: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on('speech:cancel', handler)
      return () => ipcRenderer.removeListener('speech:cancel', handler)
    },
    voices: () => ipcRenderer.invoke('speech:voices'),
    configure: (input: { enabled: boolean; volume: number }) =>
      ipcRenderer.invoke('speech:configure', input),
    speak: (input: import('../shared/speech').SpeechRequest) =>
      ipcRenderer.invoke('speech:speak', input),
    stop: () => ipcRenderer.invoke('speech:stop'),
  }),
  lifecycle: Object.freeze({
    listen: (listener: (event: import('../shared/lifecycle').LifecycleEvent) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: import('../shared/lifecycle').LifecycleEvent,
      ) => listener(value)
      ipcRenderer.on('desktop:lifecycle', handler)
      return () => {
        ipcRenderer.removeListener('desktop:lifecycle', handler)
      }
    },
    arm: () => ipcRenderer.invoke('desktop:lifecycle-arm'),
    finishClose: (token: string) => ipcRenderer.invoke('desktop:finish-close', token),
    cancelClose: (token: string) => ipcRenderer.invoke('desktop:cancel-close', token),
  }),
  backup: Object.freeze({
    chooseBackupFile: () => ipcRenderer.invoke('backup:choose'),
    exportBackup: (content: string) => ipcRenderer.invoke('backup:export', content),
    exportCsv: (content: string, kind: import('../shared/backup-bridge').CsvKind) =>
      ipcRenderer.invoke('backup:csv', content, kind),
    saveSnapshot: (content: string) => ipcRenderer.invoke('backup:snapshot', content),
    listSnapshots: () => ipcRenderer.invoke('backup:list'),
    readSnapshot: (id: string) => ipcRenderer.invoke('backup:read', id),
    status: () => ipcRenderer.invoke('backup:status'),
    writeJournal: (journal: import('../shared/backup-bridge').RecoveryJournal) =>
      ipcRenderer.invoke('backup:journal', journal),
    openBackupFolder: () => ipcRenderer.invoke('backup:open-folder'),
  }),
})
contextBridge.exposeInMainWorld('desktop', bridge)
