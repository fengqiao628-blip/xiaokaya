import catalog from './serena-catalog.json'
import type { LocalVoice } from '../shared/speech'

export const SERENA_VOICE: LocalVoice = {
  id: 'serena-v1',
  name: 'Serena · 温暖清亮女声（内置离线）',
  language: 'zh-CN',
}
export const SERENA_PREVIEW = '准备好了吗？我们一起开始吧！慢慢来，坚持一下，你一定可以的。'
export interface SerenaAsset {
  text: string
  file: string
}
export const serenaAssets = catalog.files as SerenaAsset[]
const normalize = (text: string) => text.trim().normalize('NFC')
const unavailable =
  '这句没有对应的 Serena 音频。可在学习伙伴中改选 Windows 系统声音朗读自定义内容。'
const failed = 'Serena 音频暂时无法播放，请检查系统输出设备；学习与计时不受影响。'

/** Bundled assets only: no synthesis service, downloads, database writes or arbitrary URLs. */
export class SerenaPlayer {
  private readonly files: Map<string, string>
  private enabled = false
  private volume = 0.35
  private generation = 0
  private audio?: HTMLAudioElement
  private seen = new Set<string>()
  constructor(
    assets: readonly SerenaAsset[] = serenaAssets,
    private createAudio: () => HTMLAudioElement = () => new Audio(),
    private canPlay: () => Promise<boolean> = async () => document.hasFocus(),
    private reportError: (message: string) => void = () => {},
  ) {
    this.files = new Map(
      assets
        .filter((a) => typeof a.text === 'string' && /^[a-f0-9]{64}\.wav$/.test(a.file))
        .map((a) => [normalize(a.text), a.file]),
    )
  }
  supports(text: string) {
    return this.files.has(normalize(text))
  }
  configure(enabled: boolean, volume: number) {
    this.enabled = enabled
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0
    if (!enabled || this.volume === 0) this.stop()
    else if (this.audio) this.audio.volume = this.volume
  }
  private clearAudio() {
    const audio = this.audio
    this.audio = undefined
    if (!audio) return
    audio.onended = null
    audio.onerror = null
    try {
      audio.pause()
    } catch {}
    try {
      audio.removeAttribute('src')
      audio.load()
    } catch {}
  }
  stop() {
    this.generation++
    this.clearAudio()
  }
  async speak(
    text: string,
    key: string,
    rate = 0,
  ): Promise<{ started: boolean; message?: string }> {
    if (!this.enabled || this.volume <= 0) return { started: false }
    if (this.seen.has(key)) return { started: false }
    const file = this.files.get(normalize(text))
    if (!file) {
      this.stop()
      return { started: false, message: unavailable }
    }
    const generation = ++this.generation
    this.clearAudio()
    try {
      if (
        !(await this.canPlay()) ||
        generation !== this.generation ||
        !this.enabled ||
        this.volume <= 0
      )
        return { started: false }
      const audio = this.createAudio()
      audio.preload = 'auto'
      audio.src = `./voices/serena/${file}`
      audio.volume = this.volume
      audio.playbackRate = rate < 0 ? 0.9 : rate > 0 ? 1.1 : 1
      audio.preservesPitch = true
      audio.onended = () => {
        if (this.audio === audio) this.audio = undefined
      }
      audio.onerror = () => {
        if (generation === this.generation) {
          this.clearAudio()
          this.reportError(failed)
        }
      }
      this.audio = audio
      await audio.play()
      if (generation !== this.generation || !this.enabled) {
        audio.pause()
        return { started: false }
      }
      this.seen.add(key)
      if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value!)
      return { started: true }
    } catch {
      if (generation !== this.generation) return { started: false }
      this.stop()
      return { started: false, message: failed }
    }
  }
}
