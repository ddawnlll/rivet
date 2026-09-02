import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ModelCatalog, Project } from '../types'
import { ModelPicker } from './ModelPicker'

type Props = {
  project: Project | null
  models: ModelCatalog | null
  connection: string
  onProjectSettings: () => void
  onOpenAuth: () => void
  onOpenMcp: () => void
  onPickModel: (provider: string, model: string) => void
  onOpenCommand: () => void
}

export function AppHeader({
  project,
  models,
  connection,
  onProjectSettings,
  onOpenAuth,
  onOpenMcp,
  onPickModel,
  onOpenCommand,
}: Props) {
  return (
    <header className="topbar">
      <div className="projectCluster">
        <div className="brandLockup" aria-label="Rivet epistemic agent">
          <span className="brandGlyph" aria-hidden="true"><i /><i /><i /></span>
          <span className="brandName">Rivet</span>
          <span className="brandDescriptor">persistent agent</span>
        </div>
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

      <button className="commandTrigger" type="button" onClick={onOpenCommand} aria-label="Open command menu">
        <span>Search Rivet</span>
        <kbd>⌘ K</kbd>
      </button>

      <div className="productControls">
        <div className="productStatus">
          <span className={`dot ${connection === 'live' ? 'dot-live' : 'dot-offline'}`} />
          <span>{connection === 'live' ? 'live' : connection}</span>
        </div>

        <ModelPicker models={models} onOpenAuth={onOpenAuth} onPickModel={onPickModel} />

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
