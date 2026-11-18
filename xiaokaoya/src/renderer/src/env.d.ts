import type { DesktopBridge } from '../../shared/identity'
declare global {
  interface Window {
    desktop: DesktopBridge
  }
}
export {}
