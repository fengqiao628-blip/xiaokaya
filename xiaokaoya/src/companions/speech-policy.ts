import type { ExperienceSettings } from '../domain/experience'
let minimumRevision = 0
export function holdSpeechMute(revision: number) {
  minimumRevision = revision + 1
  void window.desktop.speech?.configure({ enabled: false, volume: 0 }).catch(() => {})
}
export function clearSpeechMute() {
  minimumRevision = 0
}
export function speechAllowed(settings?: ExperienceSettings) {
  if (settings && settings.revision >= minimumRevision) minimumRevision = 0
  return settings?.soundEnabled === true && settings.volume > 0 && minimumRevision === 0
}
