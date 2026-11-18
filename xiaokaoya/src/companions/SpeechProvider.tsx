import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ExperienceSettings } from '../domain/experience'
import type { LocalVoice } from '../shared/speech'
import { clearSpeechMute, speechAllowed } from './speech-policy'
import { SERENA_VOICE, SERENA_PREVIEW, SerenaPlayer } from './serena-audio'

type Mode = 'manual' | 'events' | 'all'
interface SpeechContextValue {
  enabled: boolean
  mode: Mode
  setMode: (mode: Mode) => void
  voice: string
  setVoice: (voice: string) => void
  rate: number
  setRate: (rate: number) => void
  voices: LocalVoice[]
  refresh: () => Promise<void>
  error: string
  read: (text: string, key: string, at?: number) => void
  stop: () => void
}
const SpeechContext = createContext<SpeechContextValue>({
  enabled: false,
  mode: 'manual',
  setMode() {},
  voice: '',
  setVoice() {},
  rate: 0,
  setRate() {},
  voices: [],
  async refresh() {},
  error: '',
  read() {},
  stop() {},
})
export const useSpeech = () => useContext(SpeechContext)
export function SpeechProvider({
  settings,
  epoch,
  suppressed,
  startupText,
  children,
}: {
  settings?: ExperienceSettings
  epoch: number
  suppressed: boolean
  startupText?: string
  children: ReactNode
}) {
  const [mode, changeMode] = useState<Mode>('events'),
    [voice, setVoice] = useState(SERENA_VOICE.id),
    [rate, setRate] = useState(0)
  const [voices, setVoices] = useState<LocalVoice[]>([SERENA_VOICE]),
    [error, setError] = useState('')
  const current = useRef({ settings, suppressed, mode, voice, rate })
  current.current = { settings, suppressed, mode, voice, rate }
  const generation = useRef(0),
    cancelledAt = useRef(0),
    since = useRef(Infinity),
    seen = useRef(new Set<string>()),
    timers = useRef(new Set<number>())
  const player = useRef<SerenaPlayer | null>(null)
  if (!player.current)
    player.current = new SerenaPlayer(
      undefined,
      undefined,
      async () =>
        window.desktop.speech?.canPlay ? window.desktop.speech.canPlay() : document.hasFocus(),
      setError,
    )
  function stop() {
    cancelledAt.current = Date.now()
    generation.current++
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current.clear()
    player.current?.stop()
    void window.desktop.speech?.stop().catch(() => {})
  }
  function setMode(value: Mode) {
    stop()
    since.current = Date.now()
    changeMode(value)
  }
  useLayoutEffect(() => {
    clearSpeechMute()
    stop()
    changeMode('events')
    setVoice(SERENA_VOICE.id)
    setRate(0)
    since.current = Date.now()
  }, [epoch])
  useLayoutEffect(() => {
    const enabled = speechAllowed(settings)
    player.current?.configure(enabled, settings?.volume ?? 0)
    if (!enabled) stop()
    void window.desktop.speech
      ?.configure({ enabled, volume: settings?.volume ?? 0 })
      .catch(() => setError('本机语音暂不可用，学习与计时仍可正常使用。'))
  }, [settings?.soundEnabled, settings?.volume, settings?.revision, epoch])
  useEffect(() => {
    if (suppressed) stop()
  }, [suppressed])
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== 'visible') stop()
    }
    window.addEventListener('blur', stop)
    const unsubscribe = window.desktop.speech?.onCancel?.(stop)
    document.addEventListener('visibilitychange', hide)
    return () => {
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', hide)
      unsubscribe?.()
      stop()
    }
  }, [])
  const startupReady = settings !== undefined && Boolean(startupText)
  useEffect(() => {
    if (!startupReady || epoch !== 0) return
    // Capture the initial policy. Enabling sound later must not catch up a muted greeting.
    const initiallyEnabled = speechAllowed(current.current.settings)
    const token = generation.current
    let disposed = false,
      claimed = false
    let playTimer: number | undefined
    const clear = () => {
      if (playTimer !== undefined) window.clearTimeout(playTimer)
      playTimer = undefined
    }
    const tryRead = () => {
      if (
        !claimed ||
        disposed ||
        playTimer !== undefined ||
        token !== generation.current ||
        !document.hasFocus() ||
        document.visibilityState !== 'visible'
      )
        return
      // Allow the first window to finish showing; a newer event or Stop cancels this too.
      playTimer = window.setTimeout(() => {
        playTimer = undefined
        if (!disposed && token === generation.current)
          read(startupText!, 'startup:daily-quote', Date.now())
      }, 600)
    }
    // Defer the claim so StrictMode's setup/cleanup/setup cannot consume it prematurely.
    const claimTimer = window.setTimeout(() => {
      void window.desktop.speech
        ?.claimStartupGreeting()
        .then((allowed) => {
          if (disposed || !allowed || !initiallyEnabled) return
          claimed = true
          tryRead()
        })
        .catch(() => {})
    }, 0)
    const expiry = window.setTimeout(() => {
      disposed = true
      clear()
    }, 10000)
    window.addEventListener('focus', tryRead)
    document.addEventListener('visibilitychange', tryRead)
    return () => {
      disposed = true
      clear()
      window.clearTimeout(claimTimer)
      window.clearTimeout(expiry)
      window.removeEventListener('focus', tryRead)
      document.removeEventListener('visibilitychange', tryRead)
    }
    // Use the first fully loaded daily choice, not later refreshes, edits or date changes.
  }, [startupReady, epoch])
  async function refresh() {
    try {
      const available = (await window.desktop.speech?.voices()) ?? []
      setVoices([SERENA_VOICE, ...available])
      setError('')
    } catch {
      setVoices([SERENA_VOICE])
      setError('Windows 系统声音暂不可用，内置 Serena 仍可朗读已收录语句。')
    }
  }
  function read(text: string, key: string, at?: number) {
    const s = current.current,
      automatic = at !== undefined
    if (
      !text ||
      s.suppressed ||
      !speechAllowed(s.settings) ||
      document.visibilityState !== 'visible'
    )
      return
    if (
      automatic &&
      (s.mode === 'manual' ||
        at < since.current ||
        at <= cancelledAt.current ||
        seen.current.has(key))
    )
      return
    stop()
    if (automatic) {
      seen.current.add(key)
      if (seen.current.size > 500) seen.current.delete(seen.current.values().next().value!)
    }
    const token = generation.current
    const timer = window.setTimeout(
      async () => {
        timers.current.delete(timer)
        if (
          token !== generation.current ||
          current.current.suppressed ||
          !speechAllowed(current.current.settings) ||
          document.visibilityState !== 'visible' ||
          !document.hasFocus()
        )
          return
        try {
          const speechKey = automatic ? key : `manual:${crypto.randomUUID()}`
          const result =
            current.current.voice === SERENA_VOICE.id
              ? await player.current!.speak(text, speechKey, current.current.rate)
              : await window.desktop.speech?.speak({
                  text,
                  key: speechKey,
                  voiceId: current.current.voice,
                  rate: current.current.rate,
                })
          if (token === generation.current)
            setError(result?.message ?? (result ? '' : '当前版本不支持系统语音'))
        } catch {
          setError('本机朗读未能启动，请检查中文声音和系统输出设备；学习与计时不受影响。')
        }
      },
      automatic ? 450 : 0,
    )
    timers.current.add(timer)
  }
  return (
    <SpeechContext.Provider
      value={{
        enabled: speechAllowed(settings),
        mode,
        setMode,
        voice,
        setVoice,
        rate,
        setRate,
        voices,
        refresh,
        error,
        read,
        stop,
      }}
    >
      {children}
    </SpeechContext.Provider>
  )
}
export function ReadButton({ text, label = '朗读这句' }: { text: string; label?: string }) {
  const speech = useSpeech()
  return (
    <button
      type="button"
      className="text-button"
      disabled={!speech.enabled || !text}
      title={speech.enabled ? '使用当前所选离线声音' : '请先到学习伙伴中开启声音总开关'}
      onClick={() => speech.read(text, '')}
    >
      {label}
    </button>
  )
}
export function SpeechControls() {
  const s = useSpeech()
  useEffect(() => {
    void s.refresh()
  }, [])
  return (
    <section className="speech-settings" aria-label="离线语音朗读设置">
      <h3>离线语音朗读</h3>
      <p className="modal-description">
        默认使用 Serena
        内置自然女声，共用上方声音总开关与音量。内置鼓励和每日语句离线播放；自定义或改写的文字可改选
        Windows 系统声音朗读。重开程序或恢复备份后，声音回到
        Serena，方式回到关键状态自动朗读，不补播历史事件。声音开启时，每次启动会自动读一次首页每日一句，读完即停；刷新、切换窗口和恢复备份不会重读。
      </p>
      <div className="form-columns">
        <label className="field">
          朗读方式
          <select
            aria-label="语音朗读方式"
            value={s.mode}
            onChange={(e) => s.setMode(e.target.value as Mode)}
          >
            <option value="manual">只在点击时朗读</option>
            <option value="events">关键状态自动朗读</option>
            <option value="all">关键状态＋学习中每5分钟</option>
          </select>
        </label>
        <label className="field">
          朗读声音
          <select
            aria-label="本机中文声音"
            value={s.voice}
            onChange={(e) => {
              s.stop()
              s.setVoice(e.target.value)
            }}
          >
            <option value="">Windows 系统默认中文声音</option>
            {s.voices.map((v) => (
              <option value={v.id} key={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          语速
          <select
            aria-label="朗读语速"
            value={s.rate}
            onChange={(e) => {
              s.stop()
              s.setRate(Number(e.target.value))
            }}
          >
            <option value="-1">稍慢</option>
            <option value="0">正常</option>
            <option value="1">稍快</option>
          </select>
        </label>
      </div>
      <p className="modal-description">
        关键状态包括开始、继续、暂停、到时、主动结束、完成任务和点击伙伴回应。切换窗口或锁屏会停止朗读。
      </p>
      <div className="quote-actions">
        <ReadButton text={SERENA_PREVIEW} label="试听一句" />
        <button type="button" className="text-button" onClick={s.stop}>
          停止朗读
        </button>
        <button type="button" className="text-button" onClick={() => void s.refresh()}>
          刷新本机声音
        </button>
      </div>
      {s.error && <p role="status">{s.error}</p>}
    </section>
  )
}
