import React, { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Sparkles,
  Layers,
  Cpu,
  RefreshCw,
  GitCompare,
  History,
  Key,
  Server,
  PanelRight,
  HelpCircle,
  Search,
} from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectCommand: (command: string) => void
}

export function CommandPaletteDialog({ open, onOpenChange, onSelectCommand }: Props) {
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open) {
      setSearch('')
    }
  }, [open])

  const runCommand = (command: string) => {
    onSelectCommand(command)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="command-palette-modal" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
          <Command className="cmdk-root" label="Command Menu">
            <div className="cmdk-input-wrapper">
              <Search size={15} className="cmdk-search-icon" />
              <Command.Input
                placeholder="Type a command or search action…"
                className="cmdk-input"
                value={search}
                onValueChange={setSearch}
                autoFocus
              />
              <span className="cmdk-esc-badge">ESC</span>
            </div>

            <Command.List className="cmdk-list">
              <Command.Empty className="cmdk-empty">No matching commands found.</Command.Empty>

              <Command.Group heading="Execution & Synthesis">
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/goal ')}
                >
                  <Sparkles size={14} className="cmdk-item-icon text-accent" />
                  <div className="cmdk-item-content">
                    <b>/goal [description]</b>
                    <span>Compile formal GoalSpec and obligation graph</span>
                  </div>
                </Command.Item>
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/diff')}
                >
                  <GitCompare size={14} className="cmdk-item-icon" />
                  <div className="cmdk-item-content">
                    <b>/diff</b>
                    <span>Inspect Git working tree changes in Implementation Studio</span>
                  </div>
                </Command.Item>
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/census')}
                >
                  <RefreshCw size={14} className="cmdk-item-icon" />
                  <div className="cmdk-item-content">
                    <b>/census</b>
                    <span>Refresh repository census and directory map</span>
                  </div>
                </Command.Item>
              </Command.Group>

              <Command.Group heading="Inspectors & Views">
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/obligations')}
                >
                  <Layers size={14} className="cmdk-item-icon" />
                  <div className="cmdk-item-content">
                    <b>/obligations</b>
                    <span>Open authoritative Hard State obligations & claims</span>
                  </div>
                </Command.Item>
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/workspace')}
                >
                  <Cpu size={14} className="cmdk-item-icon" />
                  <div className="cmdk-item-content">
                    <b>/workspace</b>
                    <span>Inspect provisional Soft Workspace</span>
                  </div>
                </Command.Item>
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/sessions')}
                >
                  <History size={14} className="cmdk-item-icon" />
                  <div className="cmdk-item-content">
                    <b>/sessions</b>
                    <span>View past run session history</span>
                  </div>
                </Command.Item>
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/sidebar')}
                >
                  <PanelRight size={14} className="cmdk-item-icon" />
                  <div className="cmdk-item-content">
                    <b>/sidebar</b>
                    <span>Toggle inspection sidebar</span>
                  </div>
                </Command.Item>
              </Command.Group>

              <Command.Group heading="Configuration & Settings">
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/auth')}
                >
                  <Key size={14} className="cmdk-item-icon" />
                  <div className="cmdk-item-content">
                    <b>/auth</b>
                    <span>Manage Provider API keys & credentials</span>
                  </div>
                </Command.Item>
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/mcp')}
                >
                  <Server size={14} className="cmdk-item-icon" />
                  <div className="cmdk-item-content">
                    <b>/mcp</b>
                    <span>Inspect Model Context Protocol (MCP) bridges</span>
                  </div>
                </Command.Item>
                <Command.Item
                  className="cmdk-item"
                  onSelect={() => runCommand('/help')}
                >
                  <HelpCircle size={14} className="cmdk-item-icon" />
                  <div className="cmdk-item-content">
                    <b>/help</b>
                    <span>Show keyboard shortcuts and command index</span>
                  </div>
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
