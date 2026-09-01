import { useState } from 'react'
import type { Activity } from '../types'

type Props = { activities: Activity[]; runActive: boolean; selected: Activity | null; onSelect: (activity: Activity) => void; onCancel: () => void; focusObject?: { phase: string; title: string; text: string } | null; summary?: string | null }

export function ActivitySpine({ activities, runActive, selected, onSelect, onCancel, focusObject, summary }: Props) {
  const [apertureId, setApertureId] = useState<string | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const toggleAperture = (id: string) => setApertureId(current => current === id ? null : id)

  /* Run receipt — compact, reopenable per spec §4 item 14 */
  if (!runActive && activities.length > 0) {
    const lastActivity = activities.at(-1)
    return <section className="live-run" aria-label="Run receipt"><header><div className="live-name">run complete</div><div className="run-meta"><span>{activities[0]?.id.slice(-5).toUpperCase() ?? '—'}</span><button onClick={() => setReceiptOpen(open => !open)}>{receiptOpen ? 'collapse' : 'reopen'}</button></div></header>
      {receiptOpen && <div className="activity-stream">{activities.slice(-12).map(activity => <button key={activity.id} className={`activity ${activity.kind} ${activity.status} ${selected?.id === activity.id ? 'selected' : ''}`} onClick={() => onSelect(activity)} aria-label={`Inspect ${activity.kind}: ${activity.body}`}><i /><span className="kind">{activity.kind}</span><span className="body" dangerouslySetInnerHTML={{ __html: activity.body }} /><time>{activity.timestamp}</time></button>)}</div>}
      {!receiptOpen && summary && <div className="run-receipt-summary"><p>{summary}</p></div>}
      {!receiptOpen && lastActivity && <div className="run-receipt-meta"><span>{lastActivity.kind} · {lastActivity.status}</span><span>{activities.length} events</span></div>}
    </section>
  }

  return <section className="live-run" aria-label="Live Rivet run"><header><div className="live-name"><i className={runActive ? 'pulse' : ''} />{runActive ? 'live run' : 'run receipt'}</div><div className="run-meta"><span>{activities[0]?.id.slice(-5).toUpperCase() ?? '—'}</span>{runActive && <button onClick={onCancel}>cancel</button>}</div></header><div className="activity-stream">{activities.slice(-32).map(activity => {
    const isSelected = selected?.id === activity.id || apertureId === activity.id
    return <div key={activity.id}>
      <button className={`activity ${activity.kind} ${activity.status} ${isSelected ? 'selected' : ''}`} onClick={() => { onSelect(activity); toggleAperture(activity.id) }} aria-label={`Inspect ${activity.kind}: ${activity.body}`}><i /><span className="kind">{activity.kind}</span><span className="body" dangerouslySetInnerHTML={{ __html: activity.body }} /><time>{activity.timestamp}</time></button>
      {isSelected && apertureId === activity.id && <div className="run-aperture open" role="region" aria-label="Event inspection"><dl>{activity.detail.map(([k, v]) => <div key={k}><dt>{k}</dt><dd dangerouslySetInnerHTML={{ __html: v }} /></div>)}<div key="inspect"><dt>AUTHORITATIVE</dt><dd>{activity.authoritative ? 'yes' : 'provisional'}</dd></div></dl><button type="button" onClick={() => setApertureId(null)}>close inspection</button></div>}
    </div>
  })}</div>
  {focusObject && <div className="focus-object"><div className="focus-phase">{focusObject.phase}</div><div className="focus-title">{focusObject.title}</div><div className="focus-text">{focusObject.text}</div></div>}
  {activities.length > 0 && <p className="inspect-hint">Select an event to inspect its Cognitive Aperture. Older events compress as the run advances.</p>}</section>
}
