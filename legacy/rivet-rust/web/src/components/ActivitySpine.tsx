import { useState } from 'react'
import type { Activity } from '../types'

type Props = {
  activities: Activity[]
  runActive: boolean
  selected: Activity | null
  onSelect: (activity: Activity) => void
  onCancel: () => void
  focusObject?: { phase: string; title: string; text: string } | null
  summary?: string | null
}

const HIDDEN_LIFECYCLE_PHASES = new Set([
  'preparing view',
  'invoking model',
  'decoding actions',
  'responding',
  'idle',
])

const plainText = (value: string) => value
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const normalizedKind = (activity: Activity) => activity.kind
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replaceAll('_', ' ')
  .toLowerCase()

const isLifecycleNoise = (activity: Activity) => {
  const kind = normalizedKind(activity)
  const source = activity.detail.find(([key]) => key.toLowerCase() === 'source')?.[1]?.toLowerCase()
  return source === 'harness lifecycle' || HIDDEN_LIFECYCLE_PHASES.has(kind)
}

const stepLabel = (activity: Activity) => {
  const value = `${normalizedKind(activity)} ${plainText(activity.body)}`.toLowerCase()
  if (/\b(read|open|view|inspect)\b/.test(value)) return 'Read'
  if (/\b(write|wrote|edit|patch|modify|create)\b/.test(value)) return 'Wrote'
  if (/\b(search|find|grep|glob|rg|list)\b/.test(value)) return 'Searched'
  if (/\b(test|verify|praxis|check|lint|build)\b/.test(value)) return 'Verified'
  if (/\b(exec|shell|bash|command|cargo|npm)\b/.test(value)) return 'Ran'
  if (value.includes('hard state')) return 'Updated'
  if (value.includes('observation')) return 'Observed'
  if (value.includes('cognitive state')) return 'Considered'
  if (/\b(error|blocked|authority|cancelled)\b/.test(value)) return 'Attention'
  if (/\b(receipt|complete|completed)\b/.test(value)) return 'Completed'
  return normalizedKind(activity).replace(/\b\w/g, letter => letter.toUpperCase())
}

export function ActivitySpine({
  activities,
  runActive,
  selected,
  onSelect,
  onCancel,
  focusObject,
  summary,
}: Props) {
  const [showAll, setShowAll] = useState(false)

  const steps = activities.filter(activity => (
    activity.kind !== 'request' &&
    !activity.body.startsWith('task_') &&
    !isLifecycleNoise(activity)
  ))

  if (!runActive && !summary && steps.length === 0) return null

  const visibleSteps = showAll ? steps.slice(-12) : steps.slice(-4)
  const hiddenCount = Math.max(0, steps.length - visibleSteps.length)
  const currentText = focusObject?.title || plainText(steps.at(-1)?.body ?? '')

  return (
    <section className={`runProgress ${runActive ? 'active' : 'complete'}`} aria-live="polite" aria-label="Run progress">
      <header className="progressHeader">
        <div className="progressTitle">
          <span className={`progressOrb ${runActive ? 'spinning' : ''}`} aria-hidden="true" />
          <strong>{runActive ? 'Thinking' : 'Run complete'}</strong>
          <span className="progressCurrent">
            {runActive ? (currentText || 'Working through the request…') : (summary || 'Work settled')}
          </span>
        </div>

        <div className="progressActions">
          {steps.length > 4 ? (
            <button type="button" className="progressToggle" onClick={() => setShowAll(value => !value)}>
              {showAll ? 'Show less' : `${hiddenCount} previous`}
            </button>
          ) : null}
          {runActive ? (
            <button type="button" onClick={onCancel} className="stopBtn" title="Stop active run">
              Stop
            </button>
          ) : null}
        </div>
      </header>

      {visibleSteps.length > 0 ? (
        <div className="progressSteps">
          {visibleSteps.map(activity => {
            const isSelected = selected?.id === activity.id
            const text = plainText(activity.body)
            return (
              <button
                type="button"
                key={activity.id}
                className={`progressStep ${activity.status} ${isSelected ? 'selected' : ''} progressStep-enter`}
                onClick={() => onSelect(activity)}
                aria-pressed={isSelected}
                title={text}
              >
                <span className="stepMark" aria-hidden="true" />
                <span className="stepKind">{stepLabel(activity)}</span>
                <span className="stepBody">{text}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
