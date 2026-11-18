import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Snapshot } from '../features/dashboard/readDashboard'
import type { ExperienceSettings } from '../domain/experience'
import { SpeechProvider } from './SpeechProvider'
import {
  configurePartnerAudio,
  clearPartnerMuteGuard,
  playPartnerSound,
  unlockPartnerAudio,
  type PartnerEvent,
} from './audio'

interface Event {
  at: number
  key: string
  kind: PartnerEvent
  pet: string
}
const ExperienceContext = createContext<{
  settings?: ExperienceSettings
  event: Event | null
  interact: (id: string) => void
}>({ event: null, interact: () => {} })
export const useCompanionExperience = () => useContext(ExperienceContext)

export function ExperienceProvider({
  data,
  epoch,
  suppressed,
  startupText,
  children,
}: {
  data: Snapshot
  epoch: number
  suppressed: boolean
  startupText?: string
  children: ReactNode
}) {
  const [event, setEvent] = useState<Event | null>(null)
  const previous = useRef<{
    epoch: number
    tasks: Map<string, string>
    timers: Map<string, string>
  } | null>(null)
  const settings = data.experienceSettings,
    pet = data.preferences?.companionId ?? 'duck'
  useLayoutEffect(() => {
    clearPartnerMuteGuard()
    configurePartnerAudio(settings)
  }, [epoch])
  useLayoutEffect(() => configurePartnerAudio(settings), [settings])
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const emit = (kind: PartnerEvent, key: string, animal = pet) => {
    setEvent({ key, kind, pet: animal, at: Date.now() })
    if (settingsRef.current) playPartnerSound(animal, kind, settingsRef.current, key)
  }
  useEffect(() => {
    const unlock = () => {
      void unlockPartnerAudio()
    }
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
    }
  }, [])
  useEffect(() => {
    const before = previous.current
    const sig = (t: Snapshot['focusTimers'][number]) => `${t.status}:${t.reason}`
    previous.current = {
      epoch,
      tasks: new Map(data.tasks.map((t) => [t.id, t.status])),
      timers: new Map(data.focusTimers.map((t) => [t.id, sig(t)])),
    }
    if (!before || epoch !== before.epoch || suppressed) {
      setEvent(null)
      return
    }
    const completed = data.tasks.find(
      (t) =>
        t.status === 'completed' && before.tasks.has(t.id) && before.tasks.get(t.id) !== t.status,
    )
    if (completed) {
      emit('complete', `task:${completed.id}:${completed.revision}`)
      return
    }
    const changed = data.focusTimers.find((t) => before.timers.get(t.id) !== sig(t))
    if (!changed) return
    const kind =
      changed.status === 'running'
        ? 'start'
        : changed.status === 'review' && changed.reason === 'due'
          ? 'due'
          : changed.status === 'paused'
            ? 'pause'
            : changed.status === 'review' && changed.reason === 'stopped'
              ? 'end'
              : null
    if (kind) emit(kind, `focus:${changed.id}:${changed.revision}:${kind}`)
  }, [data.tasks, data.focusTimers, epoch, suppressed])
  useEffect(() => {
    if (!event) return
    const timeout = window.setTimeout(() => setEvent(null), 2600)
    return () => window.clearTimeout(timeout)
  }, [event])
  return (
    <ExperienceContext.Provider
      value={{
        settings,
        event,
        interact: (id) => {
          void unlockPartnerAudio().then(() => emit('click', `click:${crypto.randomUUID()}`, id))
        },
      }}
    >
      <SpeechProvider
        settings={settings}
        epoch={epoch}
        suppressed={suppressed}
        startupText={startupText}
      >
        {children}
      </SpeechProvider>
    </ExperienceContext.Provider>
  )
}
