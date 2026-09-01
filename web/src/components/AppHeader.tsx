import { useState } from 'react'
import type { ModelCatalog, Project } from '../types'

type Props = {
  project: Project | null
  models: ModelCatalog | null
  connection: string
  onProject: () => void
  onModel: () => void
  onSettings: () => void
  onProjectSettings: () => void
  onOpenAuth: () => void
  onOpenMcp: () => void
  projectOpen: boolean
  modelOpen: boolean
  settingsOpen: boolean
  onPickModel: (provider: string, model: string) => void
}

export function AppHeader({
  project,
  models,
  connection,
  onProject,
  onModel,
  onSettings,
  onProjectSettings,
  onOpenAuth,
  onOpenMcp,
  projectOpen,
  modelOpen,
  settingsOpen,
  onPickModel,
}: Props) {
  const [activeTabProvider, setActiveTabProvider] = useState<string | null>(null)

  const currentProviderId = activeTabProvider ?? models?.active_provider ?? models?.providers[0]?.id ?? 'anthropic'
  const activeProviderObj = models?.providers.find(p => p.id === currentProviderId) ?? models?.providers[0]

  return (
    <header className="topbar">
      <div className="project-cluster">
        <button
          className="project-button"
          aria-expanded={projectOpen}
          aria-haspopup="dialog"
          onClick={onProject}
          type="button"
        >
          <span className="mark" aria-hidden="true"><i /></span>
          <span className="repo-name">{project?.name ?? 'rivet'}</span>
          <span className="branch">
            {project?.branch ?? 'local workspace'} · {project?.revision ? `r${project.revision}` : 'uncommitted'}
          </span>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {projectOpen && (
          <div className="popover project-menu" role="menu">
            <div className="menu-current">
              <b>{project?.path ?? 'Rivet workspace'}</b>
              <small>{project?.dirty ? 'Working tree has uncommitted changes' : 'Working tree clean'}</small>
            </div>
            <button type="button" onClick={onProjectSettings} role="menuitem">
              <b>Project Settings & Switcher</b>
              <small>Switch folder, re-scan repository census</small>
            </button>
          </div>
        )}
      </div>

      <div className="product-controls">
        <span className={`connection ${connection}`}>
          <i aria-hidden="true" />
          <span>{connection === 'live' ? 'Connected' : connection}</span>
        </span>

        <div className="menu-anchor">
          <button
            type="button"
            className="model-button"
            onClick={onModel}
            aria-label={`Select active model, currently ${models?.active_model ?? 'unavailable'}`}
            aria-expanded={modelOpen}
            aria-haspopup="dialog"
          >
            <b>{models?.active_model ?? 'Select Model'}</b>
            {models?.active_provider && (
              <span className="model-provider-tag">{models.active_provider}</span>
            )}
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>

          {modelOpen && (
            <div className="popover model-picker-popover" role="dialog" aria-label="Model selection">
              <div className="model-picker-header">
                <span className="model-picker-title">Model Catalog</span>
                <button
                  type="button"
                  className="chip"
                  onClick={() => { onOpenAuth(); onModel() }}
                  style={{ cursor: 'pointer', padding: '3px 8px' }}
                >
                  Configure API Keys
                </button>
              </div>

              {models?.providers && models.providers.length > 0 ? (
                <>
                  <div className="model-provider-tabs" role="tablist" aria-label="Model Providers">
                    {models.providers.map(provider => (
                      <button
                        key={provider.id}
                        type="button"
                        role="tab"
                        aria-selected={provider.id === currentProviderId}
                        className={`provider-tab-btn ${provider.id === currentProviderId ? 'active' : ''}`}
                        onClick={() => setActiveTabProvider(provider.id)}
                      >
                        <span
                          className={`provider-status-dot ${provider.configured ? '' : 'unconfigured'}`}
                          title={provider.configured ? 'Configured' : 'No API key set'}
                          aria-hidden="true"
                        />
                        <span>{provider.name}</span>
                      </button>
                    ))}
                  </div>

                  <div className="model-picker-list" role="listbox">
                    {activeProviderObj && activeProviderObj.models.length > 0 ? (
                      activeProviderObj.models.map(model => {
                        const isSelected = models.active_model === model && models.active_provider === activeProviderObj.id
                        return (
                          <button
                            key={`${activeProviderObj.id}:${model}`}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`model-row-btn ${isSelected ? 'active' : ''}`}
                            onClick={() => onPickModel(activeProviderObj.id, model)}
                          >
                            <span className="model-id-label">{model}</span>
                            {isSelected && (
                              <span className="active-check" aria-hidden="true">✓</span>
                            )}
                          </button>
                        )
                      })
                    ) : (
                      <p className="empty" style={{ padding: '12px', margin: 0, textAlign: 'center' }}>
                        No models listed for this provider.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="empty" style={{ padding: '16px', margin: 0, textAlign: 'center' }}>
                  Connecting to adapter to load models…
                </p>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="icon-button"
          aria-label="Open settings and tools"
          aria-expanded={settingsOpen}
          aria-haspopup="menu"
          onClick={onSettings}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {settingsOpen && (
          <div className="popover settings-menu" role="menu">
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => { onOpenAuth(); onSettings() }}
              role="menuitem"
            >
              <span>Manage API Keys</span>
              <small>Credentials</small>
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => { onOpenMcp(); onSettings() }}
              role="menuitem"
            >
              <span>MCP Tool Bridges</span>
              <small>Servers & Tools</small>
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => { onProjectSettings(); onSettings() }}
              role="menuitem"
            >
              <span>Project Settings</span>
              <small>Folder Switcher</small>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
