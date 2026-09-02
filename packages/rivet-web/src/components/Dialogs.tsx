import React, { useState, useMemo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { X, FileCode, Check, Copy, FolderGit2, ShieldAlert, Cpu, Server, Plus, Minus } from 'lucide-react'
import type { Activity, Diff, McpServerInfo, ModelCatalog, Project, SaveAuthPayload } from '../types'
import { useSessionStore, type MotionMode } from '../store/useSessionStore'

export function Aperture({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content aperture" aria-describedby={undefined}>
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">
              {activity.authoritative ? 'Authoritative event' : 'Event inspection'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="dialog-close-btn" aria-label="Close">
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>

          <div className="aperture-title">
            <b id="aperture-title">{activity.kind}</b>
            <p>{activity.body}</p>
          </div>

          <dl className="aperture-details">
            {activity.detail.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
    onClose()
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" style={{ maxWidth: '580px' }} aria-describedby={undefined}>
          <div className="dialog-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderGit2 size={16} className="text-accent" />
              <Dialog.Title className="dialog-title">Project Settings & Switcher</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="dialog-close-btn" aria-label="Close">
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>

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
              <b className={project?.dirty ? 'text-warn' : 'text-good'}>
                {project?.dirty ? 'Changes Present' : 'Clean'}
              </b>
            </div>
            <div>
              <span>Session State</span>
              <b>Persistent</b>
            </div>
          </div>

          <div className="motion-settings-section" style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--line-soft)' }}>
            <div className="panel-label" style={{ marginBottom: '8px' }}>Interface Motion & Transitions</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {(['system', 'full', 'reduced'] as MotionMode[]).map(mode => {
                const isSelected = (useSessionStore.getState().motionMode || 'system') === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    className={`provider-tab-btn ${isSelected ? 'active' : ''}`}
                    onClick={() => useSessionStore.getState().setMotionMode(mode)}
                    style={{ justifyContent: 'center', padding: '7px 8px', textTransform: 'capitalize', fontSize: '12px' }}
                  >
                    <span>{mode === 'system' ? 'System (Auto)' : mode === 'full' ? 'Full Motion' : 'Reduced'}</span>
                  </button>
                )
              })}
            </div>
            <p className="dialog-note" style={{ marginTop: '6px' }}>
              Reduced mode replaces transforms with subtle opacity fades and disables continuous ambient animations.
            </p>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
  const tokenOptional = selectedProvider === 'custom' || selectedProvider === 'ollama' || selectedProvider === 'local'

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim() && !tokenOptional) return
    setSaving(true)
    try {
      await onSaveAuth({
        provider: selectedProvider,
        key: apiKey.trim() || 'none',
        base_url: baseUrl.trim() ? baseUrl.trim() : undefined,
        default_model: defaultModel.trim() ? defaultModel.trim() : undefined,
        models: defaultModel.trim() ? [defaultModel.trim()] : [],
      })
      setApiKey('')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setSaving(true)
    try {
      await onRemoveAuth(selectedProvider)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content dialog-wide" aria-describedby={undefined}>
          <div className="dialog-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={16} className="text-accent" />
              <Dialog.Title className="dialog-title">API Keys & Model Providers</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="dialog-close-btn" aria-label="Close">
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '1.25rem', minHeight: '340px' }}>
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
                    placeholder={activeInfo?.masked_key ? `Configured: ${activeInfo.masked_key}` : tokenOptional ? 'Optional bearer token…' : 'Enter API Key (e.g. sk-…)…'}
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
                  <button type="submit" className="primary-action" disabled={(!apiKey.trim() && !tokenOptional) || saving}>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content dialog-wide" aria-describedby={undefined}>
          <div className="dialog-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Server size={16} className="text-accent" />
              <Dialog.Title className="dialog-title">Model Context Protocol (MCP) Tools</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="dialog-close-btn" aria-label="Close">
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '420px', overflowY: 'auto' }}>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface ParsedFileDiff {
  fileName: string
  additions: number
  deletions: number
  lines: Array<{
    type: 'add' | 'del' | 'hunk' | 'context'
    content: string
    oldLine?: number
    newLine?: number
  }>
}

function parseGitDiff(diffText: string): ParsedFileDiff[] {
  if (!diffText.trim()) return []
  const files: ParsedFileDiff[] = []
  const rawFiles = diffText.split(/^diff --git /m).filter(Boolean)

  for (const raw of rawFiles) {
    const lines = raw.split('\n')
    const firstLine = lines[0] || ''
    const match = /a\/(.+?)\s+b\/(.+)/.exec(firstLine)
    const fileName = match ? match[2] : firstLine.split(' ').pop() || 'unknown'

    let additions = 0
    let deletions = 0
    const parsedLines: ParsedFileDiff['lines'] = []

    let oldLineNum = 0
    let newLineNum = 0

    for (const line of lines.slice(1)) {
      if (line.startsWith('@@')) {
        const hunkMatch = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
        if (hunkMatch) {
          oldLineNum = parseInt(hunkMatch[1], 10)
          newLineNum = parseInt(hunkMatch[2], 10)
        }
        parsedLines.push({ type: 'hunk', content: line })
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
        parsedLines.push({ type: 'add', content: line.slice(1), newLine: newLineNum++ })
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
        parsedLines.push({ type: 'del', content: line.slice(1), oldLine: oldLineNum++ })
      } else if (!line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('new file')) {
        parsedLines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, oldLine: oldLineNum++, newLine: newLineNum++ })
      }
    }

    files.push({ fileName, additions, deletions, lines: parsedLines })
  }

  return files
}

export function ImplementationStudio({ diff, onClose }: { diff: Diff | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const parsedFiles = useMemo(() => parseGitDiff(diff?.text || ''), [diff?.text])
  const [selectedFileIdx, setSelectedFileIdx] = useState(0)

  const copyDiff = () => {
    if (!diff?.text) return
    void navigator.clipboard.writeText(diff.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const activeFile = parsedFiles[selectedFileIdx] || parsedFiles[0]

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content dialog-wide diff-studio-dialog" style={{ maxWidth: '940px', width: '92vw' }} aria-describedby={undefined}>
          <div className="dialog-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileCode size={16} className="text-accent" />
              <Dialog.Title className="dialog-title">Implementation Studio (Git Diff)</Dialog.Title>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="chip"
                onClick={copyDiff}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}
              >
                {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy Diff'}</span>
              </button>
              <Dialog.Close asChild>
                <button className="dialog-close-btn" aria-label="Close">
                  <X size={15} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="diff-stats-bar">
            <span className="diff-summary-badge">
              {diff?.files.length ?? 0} changed files · {diff?.status ?? 'clean'}
            </span>
          </div>

          {parsedFiles.length === 0 ? (
            <div className="diff-empty-state">
              <p className="empty">Working tree is clean. No local modifications detected.</p>
            </div>
          ) : (
            <div className="diff-viewer-layout">
              <div className="diff-file-sidebar">
                <div className="panel-label" style={{ padding: '8px 10px 4px' }}>Changed Files</div>
                {parsedFiles.map((file, idx) => (
                  <button
                    key={file.fileName}
                    type="button"
                    className={`diff-file-item ${idx === selectedFileIdx ? 'active' : ''}`}
                    onClick={() => setSelectedFileIdx(idx)}
                  >
                    <span className="diff-file-name" title={file.fileName}>{file.fileName}</span>
                    <div className="diff-file-stats">
                      {file.additions > 0 && <span className="diff-stat-add">+{file.additions}</span>}
                      {file.deletions > 0 && <span className="diff-stat-del">-{file.deletions}</span>}
                    </div>
                  </button>
                ))}
              </div>

              <div className="diff-file-content">
                {activeFile && (
                  <div className="diff-table-container">
                    <div className="diff-table-header">
                      <span className="diff-header-filename">{activeFile.fileName}</span>
                      <span className="diff-header-counts">
                        <span className="diff-stat-add">+{activeFile.additions}</span>
                        <span className="diff-stat-del">-{activeFile.deletions}</span>
                      </span>
                    </div>
                    <div className="diff-lines-wrapper">
                      {activeFile.lines.map((line, lineIdx) => (
                        <div key={lineIdx} className={`diff-line diff-line-${line.type}`}>
                          <span className="diff-line-num old-num">{line.oldLine ?? ''}</span>
                          <span className="diff-line-num new-num">{line.newLine ?? ''}</span>
                          <span className="diff-line-marker">
                            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'hunk' ? '@@' : ' '}
                          </span>
                          <span className="diff-line-text">{line.content}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function AuthorityDialog({
  capability,
  target,
  onDecision,
  onClose,
}: {
  capability: string
  target: string
  onDecision: (decision: string) => void
  onClose: () => void
}) {
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content authority-modal" style={{ maxWidth: '440px' }} aria-describedby="authority-desc">
          <div className="dialog-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={16} className="text-warn" />
              <Dialog.Title className="dialog-title">Approval Required</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="dialog-close-btn" aria-label="Close">
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>

          <h2 style={{ fontSize: '16px', margin: '0 0 6px 0', fontFamily: 'var(--font-mono)' }}>{capability}</h2>
          <p id="authority-desc" style={{ fontSize: '13px', color: 'var(--ink-secondary)', margin: '0 0 16px' }}>
            Action target: <code>{target}</code>. Authorize execution before continuing.
          </p>

          <div className="dialog-actions">
            <button type="button" className="primary-action" onClick={() => onDecision('approved')}>
              Approve
            </button>
            <button type="button" onClick={() => onDecision('denied')}>
              Deny
            </button>
            <button type="button" onClick={onClose}>
              Dismiss
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
