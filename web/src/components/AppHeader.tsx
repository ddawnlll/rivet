import React, { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import type { ModelCatalog, Project } from '../types'

type Props = {
  project: Project | null
  models: ModelCatalog | null
  connection: string
  onProjectSettings: () => void
  onOpenAuth: () => void
  onOpenMcp: () => void
  onPickModel: (provider: string, model: string) => void
}

export function AppHeader({
  project,
  models,
  connection,
  onProjectSettings,
  onOpenAuth,
  onOpenMcp,
  onPickModel,
}: Props) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [activeTabProvider, setActiveTabProvider] = useState<string | null>(null)

  const currentProviderId = activeTabProvider ?? models?.active_provider ?? models?.providers[0]?.id ?? 'anthropic'
  const activeProviderObj = models?.providers.find(p => p.id === currentProviderId) ?? models?.providers[0]

  return (
    <header className="topbar">
      <div className="projectCluster">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="projectButton" type="button" aria-label="Project selector">
              <span className="repo">{project?.name ?? 'rivet'}</span>
              <span className="branch">
                {project?.branch ?? 'main'} · rev {project?.revision ?? '—'}
              </span>
              <span>⌄</span>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content className="projectPopover" sideOffset={6} align="start">
              <div className="projectItem" style={{ cursor: 'default' }}>
                {project?.name ?? 'rivet'}
                <small>{project?.path ?? 'local workspace'} · {project?.branch ?? 'main'} · rev {project?.revision ?? '—'}</small>
              </div>
              <DropdownMenu.Item className="projectItem" onSelect={onProjectSettings}>
                Open another project…
                <small>switch folder · local workspace</small>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="projectItem" onSelect={onProjectSettings}>
                Project settings
                <small>permissions · indexing · environment</small>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="productControls">
        <div className="productStatus">
          <span className={`dot ${connection === 'live' ? 'dot-live' : 'dot-offline'}`} />
          <span>{connection === 'live' ? 'live' : connection}</span>
        </div>

        <Popover.Root open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
          <Popover.Trigger asChild>
            <button className="modelButton" type="button" aria-label="Model selector">
              <strong>{models?.active_model ?? 'Select Model'}</strong>
              <span>{models?.active_provider ?? 'provider'}</span>
              <span>⌄</span>
            </button>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content className="modelPopover" sideOffset={6} align="end">
              {models?.providers && models.providers.length > 0 ? (
                <>
                  <div className="modelProviderTabs">
                    {models.providers.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className={`providerTab ${p.id === currentProviderId ? 'active' : ''}`}
                        onClick={() => setActiveTabProvider(p.id)}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>

                  <div className="modelList">
                    {activeProviderObj?.models.map(m => {
                      const isActive = models.active_model === m && models.active_provider === activeProviderObj.id
                      return (
                        <button
                          key={`${activeProviderObj.id}:${m}`}
                          type="button"
                          className={`modelItem ${isActive ? 'active' : ''}`}
                          onClick={() => {
                            onPickModel(activeProviderObj.id, m)
                            setModelPickerOpen(false)
                          }}
                        >
                          {m}
                          <small>{activeProviderObj.name} · {isActive ? 'current model' : 'select'}</small>
                        </button>
                      )
                    })}
                  </div>

                  <div style={{ borderTop: '1px solid var(--line-soft)', marginTop: '6px', paddingTop: '6px' }}>
                    <button
                      type="button"
                      className="modelItem"
                      onClick={() => {
                        setModelPickerOpen(false)
                        onOpenAuth()
                      }}
                    >
                      Manage API Keys…
                      <small>configure provider credentials</small>
                    </button>
                  </div>
                </>
              ) : (
                <div className="modelItem">
                  Connecting to adapter…
                  <small>loading models</small>
                </div>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="iconButton" type="button" aria-label="Settings">
              <svg viewBox="0 0 24 24">
                <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
                <path d="M19 12a7.3 7.3 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a8.3 8.3 0 0 0-1.8-1L14.4 3h-4.8l-.4 3a8.3 8.3 0 0 0-1.8 1L5 6 3 9.4 5.1 11a7.3 7.3 0 0 0 0 2L3 14.6 5 18l2.4-1a8.3 8.3 0 0 0 1.8 1l.4 3h4.8l.4-3a8.3 8.3 0 0 0 1.8-1l2.4 1 2-3.4-2.1-1.6a7.3 7.3 0 0 0 .1-1Z" />
              </svg>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content className="settingsPopover" sideOffset={6} align="end">
              <div className="settingsRow">
                <span>Project trust</span>
                <span>TRUSTED</span>
              </div>
              <div className="settingsRow">
                <span>Workspace writes</span>
                <span>ASK ON RISK</span>
              </div>
              <DropdownMenu.Item className="settingsItemBtn" onSelect={onOpenAuth}>
                <span>Manage API Keys</span>
                <span>CREDENTIALS</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="settingsItemBtn" onSelect={onOpenMcp}>
                <span>MCP Tool Bridges</span>
                <span>INSPECT</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="settingsItemBtn" onSelect={onProjectSettings}>
                <span>Project Settings</span>
                <span>EDIT</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  )
}
