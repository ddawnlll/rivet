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

export function ActivitySpine({ activities, runActive, selected, onSelect, onCancel, summary }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  // Filter out internal noisy events
  const meaningfulActivities = activities.filter(
    a => a.kind !== 'request' && !a.body.startsWith('task_') && a.kind !== 'preparing view'
  )

  const activeActivity = meaningfulActivities.find(a => a.status === 'active') ?? meaningfulActivities.at(-1)

  if (!runActive) {
    if (!summary && meaningfulActivities.length === 0) return null
    return (
      <div className="run-status-compact completed" aria-label="Run summary">
        {summary && <div className="summary-pill">{summary}</div>}
        {meaningfulActivities.length > 0 && (
          <div className="activity-toggle">
            <button
              type="button"
              className="ghost-toggle"
              onClick={() => setDetailsOpen(open => !open)}
            >
              <span>{detailsOpen ? '▾ Hide execution steps' : `▸ View ${meaningfulActivities.length} step${meaningfulActivities.length > 1 ? 's' : ''}`}</span>
            </button>
            {detailsOpen && (
              <div className="activity-stream-compact">
                {meaningfulActivities.map(activity => (
                  <button
                    key={activity.id}
                    type="button"
                    className={`activity-mini ${activity.kind} ${activity.status} ${selected?.id === activity.id ? 'selected' : ''}`}
                    onClick={() => onSelect(activity)}
                  >
                    <span className="kind">{activity.kind}</span>
                    <span className="body" dangerouslySetInnerHTML={{ __html: activity.body }} />
                    <time>{activity.timestamp}</time>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="run-status-compact active" aria-label="Live run progress">
      <div className="status-indicator-bar">
        <div className="status-dot-pulse" aria-hidden="true" />
        <span className="status-current-label">
          {activeActivity ? `${activeActivity.kind}: ${activeActivity.body}` : 'Rivet is thinking…'}
        </span>
        <button type="button" className="mini-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {meaningfulActivities.length > 1 && (
        <details className="status-details-accordion" open={detailsOpen} onToggle={e => setDetailsOpen(e.currentTarget.open)}>
          <summary>
            {meaningfulActivities.length} step{meaningfulActivities.length > 1 ? 's' : ''} in progress
          </summary>
          <div className="activity-stream-compact">
            {meaningfulActivities.slice(-6).map(activity => (
              <div key={activity.id} className="activity-mini-item">
                <span className="kind">{activity.kind}</span>
                <span className="body" dangerouslySetInnerHTML={{ __html: activity.body }} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
