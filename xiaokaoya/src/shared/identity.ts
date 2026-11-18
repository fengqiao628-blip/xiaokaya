/** Persistent compatibility identifiers. Changes require user review. */
import type { BackupBridge } from './backup-bridge'
export const APP_ID = 'cn.xiaokaoya.study'
export const INSTALL_GUID = 'd0a54531-87fa-48d9-94d0-ef98f93ca48c'
export const DATABASE_NAME = 'XiaokaoyaStudy'
export const DATABASE_VERSION = 7
export const APP_ORIGIN = 'app://xiaokaoya'
export const USER_DATA_FOLDER = 'Xiaokaoya'

export interface DesktopInfo {
  version: string
  appId: string
  userData: string
  sessionData: string
  databaseName: string
  environment: 'production' | 'development' | 'test'
  security?: { contextIsolated: boolean; sandboxed: boolean }
}

export interface DesktopBridge {
  speech?: import('./speech').SpeechBridge
  getInfo(): Promise<DesktopInfo>
  openDataFolder(): Promise<void>
  backup: BackupBridge
  lifecycle?: import('./lifecycle').LifecycleBridge
}
