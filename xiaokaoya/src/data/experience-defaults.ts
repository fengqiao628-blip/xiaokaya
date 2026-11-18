import type { Quote } from '../domain/models'
import type { ExperienceSettings, QuoteDetail } from '../domain/experience'
import { quoteLibrary } from './quote-library'
const initialTime = '2026-11-17T00:00:00.000Z'
const stamp = { createdAt: initialTime, updatedAt: initialTime, revision: 1 }
export function defaultExperience(): ExperienceSettings {
  return {
    ...stamp,
    id: 'experience',
    soundEnabled: false,
    volume: 0.35,
    partnerSounds: true,
    dueSound: true,
    motion: 'system',
    quoteCategory: null,
  }
}
/** Deterministic for native migration, old-file preflight and fresh databases. No legacy row edits. */
export function v6Extension(existing: Quote[]) {
  const known = new Map(quoteLibrary.map((q) => [q.id, q]))
  const ids = new Set(existing.map((q) => q.id))
  const added = quoteLibrary
    .filter((q) => !ids.has(q.id))
    .map(({ attribution: _, ...quote }) => quote)
  const all = [...existing, ...added]
  const details: QuoteDetail[] = all.map((q) => {
    const candidate = known.get(q.id)
    const source =
      candidate?.text === q.text
        ? candidate.attribution
        : {
            kind: 'encouragement' as const,
            origin: 'imported' as const,
            author: '',
            work: '',
            sourceTitle: '旧版语句，出处未核实',
            sourceUrl: '',
          }
    return { ...stamp, id: q.id, ...source, archivedAt: null }
  })
  return { added, details, settings: defaultExperience() }
}
