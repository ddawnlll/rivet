import React, { useState } from 'react'
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
  const [apertureOpen, setApertureOpen] = useState(false)

  const meaningfulActivities = activities.filter(
    a => a.kind !== 'request' && !a.body.startsWith('task_') && a.kind !== 'preparing view'
  )

  const activeActivity = selected ?? meaningfulActivities.find(a => a.status === 'active') ?? meaningfulActivities.at(-1)

  if (!runActive && !summary && meaningfulActivities.length === 0) {
    return null
  }

  return (
    <div className="liveRun" aria-live="polite">
      <div className="liveRunHeader">
        <div className="name">
          <span className={`liveDot ${runActive ? 'pulse' : ''}`} />
          <span>{runActive ? 'live run' : 'run complete'}</span>
        </div>
        <div className="runMeta">
          {runActive && (
            <button
              type="button"
              onClick={onCancel}
              className="stopBtn"
              title="Stop active run"
            >
              stop
            </button>
          )}
          <span>{meaningfulActivities.length} events</span>
        </div>
      </div>

      <div className="activityStream">
        {meaningfulActivities.slice(-12).map((activity, idx) => {
          const isLatestActive = runActive && idx === Math.min(11, meaningfulActivities.length - 1)
          const isSelected = selected?.id === activity.id
          const cls = isLatestActive ? 'active' : isSelected ? 'selected' : 'done'

          return (
            <div
              key={activity.id}
              className={`activityRow ${activity.kind.replace(/\s+/g, '-').toLowerCase()} ${cls}`}
              onClick={() => {
                onSelect(activity)
                setApertureOpen(true)
              }}
              style={{ cursor: 'pointer' }}
            >
              <span className="eventDot" />
              <span className="kind">{activity.kind}</span>
              <span className="eventBody" dangerouslySetInnerHTML={{ __html: activity.body }} />
              <span className="eventMeta">{activity.timestamp}</span>
            </div>
          )
        })}
      </div>

      {activeActivity && activeActivity.detail.length > 0 && (
        <>
          <button
            className="activityInspect"
            type="button"
            onClick={() => setApertureOpen(open => !open)}
          >
            {apertureOpen ? 'close inspection' : `inspect ${activeActivity.kind} event`}
          </button>

          <div className={`runAperture ${apertureOpen ? 'open' : ''}`}>
            <dl className="apertureInner">
              {activeActivity.detail.map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        </>
      )}

      {summary && (
        <div className="runReceipt show">
          <div className="runReceiptTitle">{summary}</div>
          <div className="runReceiptMeta">
            Praxis verified · authoritative state updated · inspect diff for details
          </div>
        </div>
      )}
    </div>
  )
}
