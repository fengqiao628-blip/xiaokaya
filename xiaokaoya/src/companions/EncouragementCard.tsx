import { useEffect, useRef, useState } from 'react'
import { PawPrint, RefreshCw } from 'lucide-react'
import type { FocusTimer, Task } from '../domain/models'
import { learningMood, pickEncouragement, type EncouragementMood } from './encouragement'
import { useCompanionExperience } from './ExperienceProvider'
import { ReadButton, useSpeech } from './SpeechProvider'

interface Props {
  tasks: Task[]
  timers: FocusTimer[]
  today: string
  companion: { id: string; name: string; color: string }
  restoreEpoch: number
  label?: string
}

/** Presentation only: no database writes, timer operations or daily-quote mutations. */
export function EncouragementCard({
  tasks,
  timers,
  today,
  companion,
  restoreEpoch,
  label = '伙伴的小声鼓励',
}: Props) {
  const [event, setEvent] = useState<EncouragementMood | null>(null)
  const { interact, event: liveEvent } = useCompanionExperience()
  const speech = useSpeech()
  const [rotations, setRotations] = useState<Record<string, number>>({})
  const before = useRef<{ epoch: number; timer: string; tasks: Map<string, string> } | null>(null)
  const working = timers.find((timer) => ['running', 'paused', 'review'].includes(timer.status))
  const signature = working ? `${working.id}:${working.status}:${working.reason}` : ''

  useEffect(() => {
    const previous = before.current
    before.current = {
      epoch: restoreEpoch,
      timer: signature,
      tasks: new Map(tasks.map((task) => [task.id, task.status])),
    }
    // Reading old data or restoring a backup establishes a baseline, never a new completion.
    if (!previous || previous.epoch !== restoreEpoch) {
      setEvent(null)
      return
    }
    if (previous.timer !== signature) {
      setEvent(
        working?.status === 'running' ? (working.reason === 'resumed' ? 'resumed' : 'start') : null,
      )
    }
    if (
      tasks.some(
        (task) =>
          task.status === 'completed' &&
          previous.tasks.has(task.id) &&
          previous.tasks.get(task.id) !== 'completed',
      )
    )
      setEvent('completed')
  }, [signature, tasks, restoreEpoch])

  useEffect(() => {
    if (!event) return
    const timeout = window.setTimeout(() => setEvent(null), 12000)
    return () => window.clearTimeout(timeout)
  }, [event])

  const base = learningMood(tasks, timers, today)
  // Pause/end/due always replace transient text immediately.
  const mood =
    liveEvent?.kind === 'click' && liveEvent.pet === companion.id
      ? 'clicked'
      : event === 'completed' || event === 'clicked'
        ? event
        : working?.status === 'running' && event
          ? event
          : base
  const key = `${today}:${companion.id}:${mood}`
  useEffect(() => {
    setRotations((current) => ({
      ...current,
      [key]: key in current ? current[key] + 1 : 0,
    }))
  }, [key])
  const next = () => setRotations((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }))
  const text = pickEncouragement(mood, key, rotations[key] ?? 0)
  useEffect(() => {
    if (!liveEvent || liveEvent.pet !== companion.id) return
    const expected = {
      start: ['start', 'resumed'],
      pause: ['paused'],
      due: ['due'],
      end: ['ended'],
      complete: ['completed', 'allDone'],
      click: ['clicked'],
    }
    if (!expected[liveEvent.kind].includes(mood)) return
    // Let the text rotation settle before reserving the one-shot speech event.
    const timer = window.setTimeout(
      () => speech.read(text, `event:${liveEvent.key}`, liveEvent.at),
      50,
    )
    return () => window.clearTimeout(timer)
  }, [liveEvent, mood, text])
  useEffect(() => {
    if (mood !== 'studying') return
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') {
          const nextRotation = (rotations[key] ?? 0) + 1
          setRotations((current) => ({ ...current, [key]: nextRotation }))
          if (speech.mode === 'all')
            speech.read(
              pickEncouragement(mood, key, nextRotation),
              `periodic:${today}:${companion.id}:${Math.floor(Date.now() / 300000)}`,
              Date.now(),
            )
        }
      },
      5 * 60 * 1000,
    )
    return () => window.clearInterval(timer)
  }, [mood, key, speech.mode, rotations[key]])

  return (
    <section className="companion-card" aria-label={label} data-mood={mood}>
      <div className="section-kicker">
        <PawPrint size={15} />
        伙伴的小声鼓励
      </div>
      <p aria-live="polite" aria-atomic="true">
        {text}
      </p>
      <div className="companion-sign">
        <button
          type="button"
          className="avatar-paw"
          style={{ background: companion.color, border: 0, cursor: 'pointer' }}
          aria-label={`和${companion.name}打个招呼`}
          onClick={() => {
            if (event === 'clicked') next()
            setEvent('clicked')
            interact(companion.id)
          }}
        >
          <PawPrint size={16} />
        </button>
        <span>来自{companion.name}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="换句鼓励"
          title="换句鼓励"
          onClick={next}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="quote-actions">
        <ReadButton text={text} />
        <button type="button" className="text-button" onClick={speech.stop}>
          停止朗读
        </button>
      </div>
      {speech.error && <p role="status">{speech.error}</p>}
    </section>
  )
}
