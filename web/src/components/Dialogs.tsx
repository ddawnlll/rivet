import { useState } from 'react'
import type { Activity, Diff, McpServerInfo, ModelCatalog, Project, SaveAuthPayload } from '../types'

export function Aperture({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  return (
    <dialog open className="aperture" aria-labelledby="aperture-title">
      <header>
        <span>{activity.authoritative ? 'Authoritative event' : 'Event inspection'}</span>
        <button type="button" onClick={onClose} aria-label="Close event inspection">×</button>
      </header>
      <div className="aperture-title">
        <b id="aperture-title">{activity.kind}</b>
        <p>{activity.body}</p>
      </div>
      <dl>
        {activity.detail.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  )
}

export function ProjectSettings({
  project,
  onClose,
  onSwitchProject,
}: {
  project: Project | null
  onClose: () => void
  onSwitchProject?: (path: string) => Promise<void>
}) {
  const [newPath, setNewPath] = useState('')
  const [switching, setSwitching] = useState(false)

  const handleSwitch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPath.trim() || !onSwitchProject) return
    setSwitching(true)
    await onSwitchProject(newPath.trim())
    setSwitching(false)
    setNewPath('')
  }

  return (
    <Modal title="Project Settings & Switcher" onClose={onClose}>
      <div className="settings-grid">
        <div>
          <span>Repository</span>
          <b>{project?.name ?? 'unavailable'}</b>
        </div>
        <div>
          <span>Path</span>
          <code>{project?.path ?? 'adapter offline'}</code>
        </div>
        <div>
          <span>Revision</span>
          <code>{project?.revision ? `r${project.revision}` : '—'}</code>
        </div>
        <div>
          <span>Branch</span>
          <code>{project?.branch ?? 'detached'}</code>
        </div>
        <div>
          <span>Working Tree</span>
          <b>{project?.dirty ? 'Changes Present' : 'Clean'}</b>
        </div>
        <div>
          <span>Session State</span>
          <b>Persistent</b>
        </div>
      </div>

      {onSwitchProject && (
        <form onSubmit={handleSwitch} style={{ marginTop: '1.25rem' }}>
          <div className="dialog-form-group">
            <label htmlFor="workspace-path-input" className="dialog-label">
              Open Workspace / Switch Folder
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="workspace-path-input"
                name="workspacePath"
                type="text"
                className="dialog-input"
                placeholder="/absolute/path/to/project…"
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="submit"
                className="primary-action"
                disabled={!newPath.trim() || switching}
                style={{ whiteSpace: 'nowrap', padding: '8px 14px' }}
              >
                {switching ? 'Opening…' : 'Open Folder'}
              </button>
            </div>
          </div>
        </form>
      )}
      <p className="dialog-note">
        Swapping projects re-scans repository census and dynamically loads persistent state.
      </p>
    </Modal>
  )
}

export function ProviderAuthDialog({
  catalog,
  onClose,
  onSaveAuth,
  onRemoveAuth,
  onSelectModel,
}: {
  catalog: ModelCatalog | null
  onClose: () => void
  onSaveAuth: (payload: SaveAuthPayload) => Promise<void>
  onRemoveAuth: (provider: string) => Promise<void>
  onSelectModel: (provider: string, model: string) => Promise<void>
}) {
  const [selectedProvider, setSelectedProvider] = useState(catalog?.active_provider ?? 'anthropic')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [saving, setSaving] = useState(false)

  const activeInfo = catalog?.providers.find(p => p.id === selectedProvider)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim()) return
    setSaving(true)
    await onSaveAuth({
      provider: selectedProvider,
      key: apiKey.trim(),
      base_url: baseUrl.trim() ? baseUrl.trim() : undefined,
      default_model: defaultModel.trim() ? defaultModel.trim() : undefined,
      models: defaultModel.trim() ? [defaultModel.trim()] : [],
    })
    setSaving(false)
    setApiKey('')
  }

  const handleRemove = async () => {
    setSaving(true)
    await onRemoveAuth(selectedProvider)
    setSaving(false)
  }

  return (
    <Modal title="API Keys & Model Providers" onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: '1.25rem', minHeight: '320px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRight: '1px solid var(--line-subtle)', paddingRight: '1rem' }}>
          <div className="panel-label">Providers</div>
          {catalog?.providers.map(p => (
            <button
              key={p.id}
              type="button"
              className={`provider-tab-btn ${p.id === selectedProvider ? 'active' : ''}`}
              onClick={() => {
                setSelectedProvider(p.id)
                setBaseUrl(p.base_url ?? '')
                setDefaultModel(p.models[0] ?? '')
              }}
              style={{ width: '100%', justifyContent: 'space-between', padding: '8px 10px' }}
            >
              <span>{p.name}</span>
              <span
                className={`provider-status-dot ${p.configured ? '' : 'unconfigured'}`}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{activeInfo?.name ?? selectedProvider}</h3>
              <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                {activeInfo?.configured ? `Configured (${activeInfo.masked_key ?? 'active'})` : 'Not Configured'}
              </span>
            </div>
            {activeInfo?.configured && (
              <button
                type="button"
                onClick={handleRemove}
                className="mini-cancel-btn"
              >
                Remove Key
              </button>
            )}
          </div>

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="dialog-form-group">
              <label htmlFor="api-key-input" className="dialog-label">
                API Key / Token
              </label>
              <input
                id="api-key-input"
                name="apiKey"
                type="password"
                className="dialog-input"
                placeholder={activeInfo?.masked_key ? `Configured: ${activeInfo.masked_key}` : 'Enter API Key (e.g. sk-…)…'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="dialog-form-group">
              <label htmlFor="base-url-input" className="dialog-label">
                Custom Endpoint / Base URL (Optional)
              </label>
              <input
                id="base-url-input"
                name="baseUrl"
                type="url"
                inputMode="url"
                className="dialog-input"
                placeholder="https://api.openai.com/v1 or http://localhost:8000/v1…"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="dialog-form-group">
              <label htmlFor="default-model-input" className="dialog-label">
                Default Model Name
              </label>
              <input
                id="default-model-input"
                name="defaultModel"
                type="text"
                className="dialog-input"
                placeholder="claude-3-5-sonnet-20241022, gpt-4o…"
                value={defaultModel}
                onChange={e => setDefaultModel(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="dialog-actions" style={{ marginTop: '0.5rem' }}>
              <button type="submit" className="primary-action" disabled={!apiKey.trim() || saving}>
                {saving ? 'Saving…' : 'Save & Connect'}
              </button>
              {activeInfo?.configured && activeInfo.models.length > 0 && (
                <button
                  type="button"
                  onClick={() => void onSelectModel(selectedProvider, activeInfo.models[0])}
                >
                  Set as Active Model
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </Modal>
  )
}

export function McpStudioDialog({
  servers,
  onClose,
}: {
  servers: McpServerInfo[]
  onClose: () => void
}) {
  return (
    <Modal title="Model Context Protocol (MCP) Tools" onClose={onClose} wide>
      <div style={{ marginBottom: '1rem' }}>
        <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', margin: '0 0 0.5rem 0' }}>
          MCP bridges connect external databases, browsers, and terminal tools to Rivet. Configured in <code>.rivet/mcp.json</code>.
        </p>
      </div>

      {servers.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--surface-inset)', borderRadius: 'var(--r-md)' }}>
          <p className="empty">No MCP servers configured in <code>.rivet/mcp.json</code>.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '400px', overflowY: 'auto' }}>
          {servers.map(s => (
            <div key={s.name} style={{ background: 'var(--surface-inset)', border: '1px solid var(--line-subtle)', borderRadius: 'var(--r-sm)', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <b style={{ fontSize: '13px' }}>{s.name}</b>
                  <code style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--ink-muted)' }}>{s.command} {s.args.join(' ')}</code>
                </div>
                <span className={`chip ${s.status === 'connected' ? 'pass' : 'fail'}`}>
                  {s.status}
                </span>
              </div>

              {s.tools.length > 0 ? (
                <div style={{ marginTop: '8px', borderTop: '1px solid var(--line-subtle)', paddingTop: '8px' }}>
                  <div className="panel-label" style={{ fontSize: '10px', marginBottom: '6px' }}>Available Tools ({s.tools.length})</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px' }}>
                    {s.tools.map(t => (
                      <div key={t.capability_id} style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: 'var(--r-xs)' }}>
                        <code style={{ fontSize: '11px', color: 'var(--accent)' }}>{t.capability_id}</code>
                        <p style={{ fontSize: '11px', margin: '2px 0 0 0', color: 'var(--ink-muted)' }}>{t.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: '11px', color: 'var(--ink-muted)', margin: '4px 0 0 0' }}>No capabilities exported.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function ImplementationStudio({ diff, onClose }: { diff: Diff | null; onClose: () => void }) {
  return (
    <Modal title="Implementation Studio (Git Diff)" onClose={onClose} wide>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
        <span>{diff?.files.length ?? 0} changed files · {diff?.status ?? 'loading'}</span>
        <span>Working Tree Diff</span>
      </div>
      <pre className="markdown-body pre" style={{ maxHeight: '55vh', overflow: 'auto', padding: '12px', background: 'var(--surface-inset)', border: '1px solid var(--line-subtle)', borderRadius: 'var(--r-sm)', fontSize: '12px', lineHeight: '1.5', color: 'var(--ink-secondary)' }}>
        {diff?.text || 'No working tree diff.'}
      </pre>
    </Modal>
  )
}

export function AuthorityDialog({ capability, target, onDecision, onClose }: { capability: string; target: string; onDecision: (decision: string) => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <dialog open className="authority-modal" aria-labelledby="authority-title" onClick={e => e.stopPropagation()}>
        <div className="panel-label">Approval Requested</div>
        <h2 id="authority-title">{capability}</h2>
        <p style={{ fontSize: '14px', color: 'var(--ink-secondary)', margin: '8px 0 16px' }}>
          Action target: <code>{target}</code>. Review and authorize before proceeding.
        </p>
        <div className="dialog-actions">
          <button type="button" className="primary-action" onClick={() => onDecision('approved')}>Approve</button>
          <button type="button" onClick={() => onDecision('denied')}>Deny</button>
          <button type="button" onClick={onClose}>Dismiss</button>
        </div>
      </dialog>
    </div>
  )
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <dialog
        open
        className={`dialog ${wide ? 'dialog-wide' : ''}`}
        aria-labelledby={`${title.replaceAll(' ', '-').toLowerCase()}-title`}
        onClick={e => e.stopPropagation()}
      >
        <header>
          <div>
            <h2 id={`${title.replaceAll(' ', '-').toLowerCase()}-title`}>{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button>
        </header>
        {children}
      </dialog>
    </div>
  )
}
