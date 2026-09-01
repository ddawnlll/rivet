import type { Census, Diff, HistoryEntry, State } from '../types'

export type InspectorPanel = 'hard' | 'soft' | 'praxis' | 'history' | 'diff'
type Props = {
  panel: InspectorPanel
  setPanel: (panel: InspectorPanel) => void
  state: State | null
  census: Census | null
  history: HistoryEntry[]
  diff: Diff | null
  onClose: () => void
  onCensus: () => void
  onDiff: () => void
  onOpenArtifact: () => void
}

const phase = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')

export function Inspector({
  panel,
  setPanel,
  state,
  census,
  history,
  diff,
  onClose,
  onCensus,
  onDiff,
  onOpenArtifact,
}: Props) {
  return (
    <aside className="inspector" aria-label="Inspector sidebar">
      <header>
        <span>Inspection Details</span>
        <button onClick={onClose} aria-label="Close inspector">×</button>
      </header>

      <div className="panel-tabs" role="tablist" aria-label="Inspector Panels">
        {(['hard', 'soft', 'praxis', 'history', 'diff'] as InspectorPanel[]).map(item => (
          <button
            key={item}
            role="tab"
            aria-selected={panel === item}
            className={panel === item ? 'active' : ''}
            onClick={() => setPanel(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {panel === 'hard' && (
        <div className="panel-content">
          <Label>Authoritative Hard State</Label>
          <Metric label="Revision" value={String(state?.hard_state.revision ?? '—')} />
          <Metric label="Phase" value={state ? phase(state.phase) : 'Disconnected'} />
          {state?.hard_state.contradictions.length ? (
            <Section
              label="Contradictions"
              items={state.hard_state.contradictions.map(item => `${item.claim_id}: ${item.reason}`)}
              alert
            />
          ) : null}
          <Section
            label="Open Obligations"
            items={state?.hard_state.open_obligations.map(item => `${item.id} · ${item.description}`) ?? []}
          />
          <Section
            label="Closed Obligations"
            items={state?.hard_state.closed_obligations.map(item => `${item.id} · ${item.description}`) ?? []}
          />
          <Section
            label="Claims"
            items={state?.hard_state.claims.map(item => `${item.status} · ${item.proposition}`) ?? []}
          />
          <Section
            label="Evidence"
            items={state?.hard_state.recent_evidence.map(item => `${item.id} · ${item.summary}`) ?? []}
          />
        </div>
      )}

      {panel === 'soft' && (
        <div className="panel-content soft-panel">
          <Label>Provisional Soft Workspace</Label>
          {state ? (
            <>
              <Metric label="Capacity" value={`${state.soft_workspace.item_count}/${state.soft_workspace.max_capacity}`} />
              <Section label="Current Focus" items={state.soft_workspace.active_focus} />
              <Section label="Hypotheses" items={state.soft_workspace.hypotheses} />
              <Section label="Unknowns" items={state.soft_workspace.unknowns} />
              <Section label="Candidate Actions" items={state.soft_workspace.candidate_actions} />
            </>
          ) : (
            <Empty text="Bounded workspace activates after run initialization." />
          )}
        </div>
      )}

      {panel === 'praxis' && (
        <div className="panel-content">
          <Label>Praxis Verifications</Label>
          {state?.hard_state.verification_receipts.length ? (
            state.hard_state.verification_receipts.map(receipt => (
              <div className="praxis-row" key={receipt.receipt_id}>
                <div>
                  <b>{receipt.obligation_id}</b>
                  <span className={receipt.passed ? 'pass' : 'fail'}>
                    {receipt.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <p>{receipt.scope}</p>
                {receipt.diagnostics && <small>{receipt.diagnostics}</small>}
              </div>
            ))
          ) : (
            <Empty text="No verification receipts recorded yet." />
          )}
        </div>
      )}

      {panel === 'history' && (
        <div className="panel-content">
          <Label>Run History</Label>
          {history.length ? (
            history.slice().reverse().map(item => (
              <div className="history-row" key={item.id}>
                <b>{item.status}</b>
                <p>{item.prompt}</p>
                <small>{new Date(item.created_at).toLocaleTimeString()} · rev {item.revision ?? '—'}</small>
              </div>
            ))
          ) : (
            <Empty text="No persisted runs in this session." />
          )}
        </div>
      )}

      {panel === 'diff' && (
        <div className="panel-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <Label>Working Tree Changes</Label>
            <button
              onClick={onDiff}
              className="chip"
              style={{ cursor: 'pointer', padding: '2px 6px' }}
            >
              Refresh
            </button>
          </div>
          {diff ? (
            <>
              <Metric label="Status" value={diff.status} />
              <Metric label="Files Changed" value={String(diff.files.length)} />
              <div className="file-list">
                {diff.files.map(file => (
                  <button key={file} onClick={onOpenArtifact}>
                    {file}
                  </button>
                ))}
              </div>
              <button className="studio-button" onClick={onOpenArtifact} style={{ width: '100%' }}>
                Open Full Diff Viewer
              </button>
            </>
          ) : (
            <Empty text="Git diff loaded on demand." />
          )}
        </div>
      )}

      {panel === 'hard' && (
        <div className="panel-footer">
          <button onClick={() => setPanel('praxis')}>View Praxis Receipts →</button>
        </div>
      )}
      {panel === 'soft' && (
        <div className="panel-footer">
          <button onClick={onCensus}>Refresh Repository Census</button>
        </div>
      )}

      {panel !== 'diff' && panel !== 'history' && census && (
        <div className="census-inline">
          <Label>Census Snapshot</Label>
          <span>
            {census.total_files} files · {Math.round(census.total_bytes / 1024)}&nbsp;KB · {census.deferred_count} deferred
          </span>
        </div>
      )}
    </aside>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="panel-label">{children}</div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function Section({ label, items, alert = false }: { label: string; items: string[]; alert?: boolean }) {
  return (
    <section className={`soft-list ${alert ? 'alert-list' : ''}`}>
      <span>{label}</span>
      {items.length ? (
        items.slice(0, 10).map((item, index) => <p key={`${item}-${index}`}>– {item}</p>)
      ) : (
        <p>– none recorded</p>
      )}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>
}
