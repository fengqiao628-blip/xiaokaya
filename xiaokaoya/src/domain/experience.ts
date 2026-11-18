import type { Entity } from './models'
export type QuoteKind = 'encouragement' | 'saying' | 'poetry'
export interface Attribution {
  kind: QuoteKind
  origin: 'builtin' | 'user' | 'imported'
  author: string
  work: string
  sourceTitle: string
  sourceUrl: string
}
export interface QuoteDetail extends Entity, Attribution {
  archivedAt: string | null
}
export interface QuoteFavorite extends Entity {
  active: boolean
}
export interface ExperienceSettings extends Entity {
  id: 'experience'
  soundEnabled: boolean
  volume: number
  partnerSounds: boolean
  dueSound: boolean
  motion: 'system' | 'on' | 'off'
  quoteCategory: string | null
}
export function attribution(detail: QuoteDetail): Attribution {
  const { kind, origin, author, work, sourceTitle, sourceUrl } = detail
  return { kind, origin, author, work, sourceTitle, sourceUrl }
}
