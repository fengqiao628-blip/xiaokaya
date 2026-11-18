import type { CSSProperties } from 'react'
import catalog from './catalog.json'
import artwork from './artwork.generated.json'
import { useCompanionExperience } from './ExperienceProvider'
import './motion.css'
export { catalog as companions }
export type CompanionState = 'idle' | 'study' | 'rest' | 'celebrate'
const drawings: Record<string, string> = artwork
export function Companion({
  id,
  state = 'idle',
  className = '',
  interactive = false,
}: {
  id: string
  state?: CompanionState
  className?: string
  interactive?: boolean
}) {
  const animal = catalog.find((item) => item.id === id) ?? catalog[0]
  const { settings, event, interact } = useCompanionExperience()
  const reaction = event?.pet === animal.id ? event : null
  const visibleState = reaction?.kind === 'complete' ? 'celebrate' : state
  const src = animal.assets[visibleState] || animal.assets.rest
  const drawing = drawings[src] ?? drawings[catalog[0].assets.idle]
  return (
    <span
      className={`companion-art ${className} ${reaction ? 'pet-reaction' : ''}`}
      data-motion={settings?.motion ?? 'system'}
      data-state={visibleState}
      data-reaction={reaction?.kind ?? ''}
      style={{ '--pet-duration': `${animal.motionDuration}s` } as CSSProperties}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `和${animal.name}互动` : undefined}
      onClick={interactive ? () => interact(animal.id) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                interact(animal.id)
              }
            }
          : undefined
      }
    >
      <span className="pet-motion" key={reaction?.key ?? visibleState}>
        {/* Only generated, bundled SVG is accepted here; never user text or imported content. */}
        <span
          className="pet-picture pet-vector"
          data-asset={`./${src}`}
          role="img"
          aria-label={`${animal.name} · ${{ idle: '睁眼陪伴', study: '捧书阅读', rest: '闭眼睡觉', celebrate: '鼓掌庆祝' }[visibleState]}`}
          dangerouslySetInnerHTML={{ __html: drawing }}
        />
      </span>
    </span>
  )
}
