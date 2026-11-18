import catalog from './catalog.json'
import type { ExperienceSettings } from '../domain/experience'
export type PartnerEvent = 'start' | 'pause' | 'complete' | 'due' | 'click' | 'end'
let context: AudioContext | undefined, master: GainNode | undefined
let enabled = false
let muteBeforeRevision = 0
export function mutePartnerAudioUntilSaved(revision: number) {
  muteBeforeRevision = revision + 1
  enabled = false
  try {
    if (master && context) master.gain.setValueAtTime(0, context.currentTime)
  } catch {}
  stopPartnerAudio()
}
export function clearPartnerMuteGuard() {
  muteBeforeRevision = 0
}
const nodes = new Set<OscillatorNode>(),
  seen = new Set<string>()
export function stopPartnerAudio() {
  for (const node of nodes) {
    try {
      node.stop()
    } catch {}
  }
  nodes.clear()
}
export function configurePartnerAudio(settings?: ExperienceSettings) {
  if (settings && settings.revision >= muteBeforeRevision) muteBeforeRevision = 0
  enabled = settings?.soundEnabled === true && muteBeforeRevision === 0
  try {
    if (master && context)
      master.gain.setValueAtTime(enabled ? (settings?.volume ?? 0) * 0.13 : 0, context.currentTime)
  } catch {
    enabled = false
  }
  if (!enabled) stopPartnerAudio()
}
export async function unlockPartnerAudio() {
  if (!enabled) return false
  try {
    context ??= new AudioContext()
    if (!master) {
      master = context.createGain()
      master.gain.value = 0
      master.connect(context.destination)
    }
    if (context.state === 'suspended') await context.resume()
    return context.state === 'running' && enabled
  } catch {
    return false
  }
}
/** All tones are synthesized locally; default mute always wins, including previews. */
export function playPartnerSound(
  id: string,
  event: PartnerEvent,
  settings: ExperienceSettings,
  key: string,
) {
  if (
    !enabled ||
    !settings.soundEnabled ||
    settings.volume <= 0 ||
    (event === 'due' ? !settings.dueSound : !settings.partnerSounds) ||
    seen.has(key)
  )
    return false
  if (!context || !master || context.state !== 'running') return false
  const animal = catalog.find((p) => p.id === id) ?? catalog[0]
  const tones: Record<PartnerEvent, number[]> = {
    start: [1, 1.25],
    pause: [1, 0.8],
    complete: [1, 1.25, 1.5],
    due: [1.5, 1, 1.5],
    click: [1.25, 1],
    end: [1, 0.75],
  }
  try {
    seen.add(key)
    if (seen.size > 500) seen.delete(seen.values().next().value!)
    master.gain.setValueAtTime(settings.volume * 0.13, context.currentTime)
    tones[event].forEach((ratio, index) => {
      const node = context!.createOscillator(),
        gain = context!.createGain(),
        start = context!.currentTime + index * 0.11
      node.type = animal.sound.wave as OscillatorType
      node.frequency.setValueAtTime(animal.sound.baseFrequency * ratio, start)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.65, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.13)
      node.connect(gain)
      gain.connect(master!)
      nodes.add(node)
      node.onended = () => {
        nodes.delete(node)
        node.disconnect()
        gain.disconnect()
      }
      node.start(start)
      node.stop(start + 0.15)
    })
    return true
  } catch {
    stopPartnerAudio()
    return false
  }
}
