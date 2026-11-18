import type { FocusTimer } from '../domain/models'
import type { CompanionState } from './Companion'
/** Only an explicit paused run rests; idle/review/saved must not look permanently asleep. */
export function companionVisualState(
  timer?: Pick<FocusTimer, 'status'> | null,
  fallback: CompanionState = 'idle',
): CompanionState {
  if (timer?.status === 'running') return 'study'
  if (timer?.status === 'paused') return 'rest'
  if (timer?.status === 'review') return 'idle'
  return fallback
}
