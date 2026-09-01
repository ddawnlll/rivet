import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  MessageSquare,
  Layers,
  Cpu,
  ShieldCheck,
  History,
  Brain,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { ActivitySpine } from './components/ActivitySpine'
import { AppHeader } from './components/AppHeader'
import {
  AuthorityDialog,
  ImplementationStudio,
  McpStudioDialog,
  ProjectSettings,
  ProviderAuthDialog,
} from './components/Dialogs'
import { Composer } from './components/Composer'
import { Inspector, type InspectorPanel } from './components/Inspector'
import { CommandPaletteDialog } from './components/CommandPaletteDialog'
import { useSessionStore } from './store/useSessionStore'
import type { Attachment, Message } from './types'
import { MarkdownView } from './components/MarkdownView'

type WorkspaceTab = 'conversation' | InspectorPanel

export function App() {
  const store = useSessionStore()
  const {
    connection,
    project,
    models,
    state,
    history,
    census,
    diff,
    messages,
    activities,
    selected,
    runActive,
    authority,
    focusObject,
    runSummary,
    mcpServers,
    setSelected,
    setAuthority,
    initSession,
    send,
    compileGoal,
    cancel,
    chooseModel,
    saveCredentials,
    removeCredentials,
    switchProject,
    loadCensus,
    loadDiff,
    loadMcp,
  } = store

  const [tab, setTab] = useState<WorkspaceTab>('conversation')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [search, setSearch] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Initialize store lifecycle & WS connection on mount (run once)
  useEffect(() => {
    const cleanup = initSession()
    return cleanup
  }, [])

  useEffect(() => {
    if (runActive) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages, runActive, activities])

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen(open => !open)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setInspectorOpen(open => !open)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.querySelector<HTMLTextAreaElement>('#composerInput')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const visibleMessages = useMemo(
    () =>
      search.trim()
        ? messages.filter(message => message.body.toLowerCase().includes(search.toLowerCase()))
        : messages,
    [search, messages]
  )

  const handleCommandSelect = (command: string) => {
    if (command.startsWith('/goal ')) {
      setPrompt(command)
      document.querySelector<HTMLTextAreaElement>('#composerInput')?.focus()
      return
    }
    if (command === '/sidebar') {
      setInspectorOpen(open => !open)
      return
    }
    if (command === '/workspace') {
      setTab('soft')
      setInspectorOpen(true)
      return
    }
    if (command === '/obligations') {
      setTab('hard')
      setInspectorOpen(true)
      return
    }
    if (command === '/census') {
      setTab('history')
      setInspectorOpen(true)
      void loadCensus(true)
      return
    }
    if (command === '/diff') {
      setStudioOpen(true)
      void loadDiff(true)
      return
    }
    if (command === '/sessions') {
      setTab('history')
      setInspectorOpen(true)
      return
    }
    if (command === '/auth') {
      setAuthOpen(true)
      return
    }
    if (command === '/mcp') {
      setMcpOpen(true)
      void loadMcp()
      return
    }
    if (command === '/help') {
      toast.info('Shortcuts: ⌘K (Command Menu), ⌘B (Toggle Sidebar), ⌘F (Focus Composer), ESC (Close)')
      return
    }
    setPrompt(command)
  }

  const submit = (files: Attachment[]) => {
    const original = prompt
    if (original.startsWith('/goal ')) void compileGoal(original, original.slice(6))
    else void send(original, files)
    setPrompt('')
    setAttachments([])
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <AppHeader
        project={project}
        models={models}
        connection={connection}
        onProjectSettings={() => setProjectSettingsOpen(true)}
        onOpenAuth={() => setAuthOpen(true)}
        onOpenMcp={() => {
          setMcpOpen(true)
          void loadMcp()
        }}
        onPickModel={(provider, model) => {
          void chooseModel(provider, model)
        }}
      />

      <div className={`workspace ${inspectorOpen ? '' : 'inspector-hidden'}`}>
        <nav className="edge" aria-label="Primary Navigation">
          <NavButton label="Conversation" active={tab === 'conversation'} onClick={() => setTab('conversation')}>
            <MessageSquare size={17} />
          </NavButton>
          <NavButton label="Hard State Obligations" active={tab === 'hard'} onClick={() => { setTab('hard'); setInspectorOpen(true) }}>
            <Layers size={17} />
          </NavButton>
          <NavButton label="Soft Workspace" active={tab === 'soft'} onClick={() => { setTab('soft'); setInspectorOpen(true) }}>
            <Cpu size={17} />
          </NavButton>
          <NavButton label="Praxis Verification" active={tab === 'praxis'} onClick={() => { setTab('praxis'); setInspectorOpen(true) }}>
            <ShieldCheck size={17} />
          </NavButton>
          <NavButton label="Run History" active={tab === 'history'} onClick={() => { setTab('history'); setInspectorOpen(true) }}>
            <History size={17} />
          </NavButton>
        </nav>

        <main className="stage" id="main-content">
          <section className="conversation" aria-label="Rivet conversation stream">
            {tab === 'conversation' ? (
              <>
                {visibleMessages.map(message => <Turn key={message.id} message={message} />)}
                {(runActive || activities.length > 0) && (
                  <ActivitySpine
                    activities={activities}
                    runActive={runActive}
                    selected={selected}
                    onSelect={setSelected}
                    onCancel={() => void cancel()}
                    focusObject={focusObject}
                    summary={runSummary}
                  />
                )}
                <div ref={bottomRef} style={{ height: '1px' }} />
              </>
            ) : (
              <WorkspaceSummary tab={tab} state={state} project={project} />
            )}
          </section>

          <Composer
            value={prompt}
            attachments={attachments}
            runActive={runActive}
            revision={project?.revision}
            census={census}
            diff={diff}
            onChange={text => {
              if (text === '/') {
                setCommandPaletteOpen(true)
                return
              }
              setPrompt(text)
            }}
            onAttachments={setAttachments}
            onSend={submit}
            onCancel={() => void cancel()}
            onRemoveAttachment={name => setAttachments(current => current.filter(file => file.name !== name))}
          />
        </main>

        {inspectorOpen && (
          <Inspector
            panel={tab === 'conversation' ? 'hard' : tab}
            setPanel={next => setTab(next)}
            state={state}
            census={census}
            history={history}
            diff={diff}
            onClose={() => setInspectorOpen(false)}
            onCensus={() => void loadCensus(true)}
            onDiff={() => void loadDiff(true)}
            onOpenArtifact={() => {
              setStudioOpen(true)
              void loadDiff(true)
            }}
          />
        )}
      </div>

      <CommandPaletteDialog
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onSelectCommand={handleCommandSelect}
      />

      {authority && (
        <AuthorityDialog
          capability={authority.capability}
          target={authority.target}
          onClose={() => setAuthority(null)}
          onDecision={decision => {
            setAuthority(null)
            toast.success(`Decision recorded: ${decision}`)
          }}
        />
      )}

      {projectSettingsOpen && (
        <ProjectSettings
          project={project}
          onClose={() => setProjectSettingsOpen(false)}
          onSwitchProject={switchProject}
        />
      )}

      {authOpen && (
        <ProviderAuthDialog
          catalog={models}
          onClose={() => setAuthOpen(false)}
          onSaveAuth={saveCredentials}
          onRemoveAuth={removeCredentials}
          onSelectModel={chooseModel}
        />
      )}

      {mcpOpen && (
        <McpStudioDialog
          servers={mcpServers}
          onClose={() => setMcpOpen(false)}
        />
      )}

      {studioOpen && (
        <ImplementationStudio
          diff={diff}
          onClose={() => setStudioOpen(false)}
        />
      )}

      <Toaster
        theme="dark"
        position="bottom-right"
        closeButton
      />
    </div>
  )
}

function NavButton({ children, label, active, onClick }: { children: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick} aria-label={label} title={label} type="button">
      {children}
    </button>
  )
}

function ThinkingBlock({ reasoning, isLive, elapsedSeconds }: { reasoning: string; isLive?: boolean; elapsedSeconds?: number }) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isLive) {
      setOpen(true)
      if (contentRef.current) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight
      }
    }
  }, [reasoning, isLive])

  return (
    <div className="thinking-block">
      <button
        type="button"
        className="thinking-summary-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Brain size={12} />
        <span>{isLive ? 'reasoning process…' : 'reasoning summary'}</span>
        {elapsedSeconds !== undefined && (
          <span>({elapsedSeconds.toFixed(1)}s)</span>
        )}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div ref={contentRef} className="thinking-content-scroll">
          <div>{reasoning}</div>
        </div>
      )}
    </div>
  )
}

function Turn({ message }: { message: Message }) {
  return (
    <article className={`turn ${message.role}`}>
      <div className="role-header">
        <div className="role-meta-left">
          <div className="role">{message.role === 'you' ? 'You' : message.role === 'system' ? 'System' : 'Rivet'}</div>
          {message.live && message.statusMessage && (
            <span className="live-status-pill">{message.statusMessage}</span>
          )}
        </div>
      </div>

      {message.reasoning ? (
        <ThinkingBlock
          reasoning={message.reasoning}
          isLive={message.live}
          elapsedSeconds={message.elapsedSeconds}
        />
      ) : null}

      <div className="message">
        {message.body ? (
          message.role === 'you' ? (
            <div className="user-prompt">{message.body}</div>
          ) : (
            <MarkdownView content={message.body} isLive={message.live} />
          )
        ) : message.live && !message.reasoning ? (
          <p className="rivetLead">{message.statusMessage || 'Preparing cognitive view…'}</p>
        ) : null}
      </div>
      {message.attachments?.length ? (
        <div className="turn-attachments" style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Attached: {message.attachments.join(' · ')}
        </div>
      ) : null}
    </article>
  )
}

function WorkspaceSummary({ tab, state, project }: { tab: WorkspaceTab; state: ReturnType<typeof useSessionStore.getState>['state']; project: ReturnType<typeof useSessionStore.getState>['project'] }) {
  if (tab === 'hard') {
    return (
      <div className="workspace-summary">
        <div className="eyebrow">Authoritative Hard State</div>
        <h1>Obligations and claims.</h1>
        <p>Revision {state?.hard_state.revision ? `r${state.hard_state.revision}` : '—'} · {state?.hard_state.open_obligations.length ?? 0} open obligations.</p>
      </div>
    )
  }
  if (tab === 'soft') {
    return (
      <div className="workspace-summary">
        <div className="eyebrow">Provisional Workspace</div>
        <h1>Bounded Cognition</h1>
        <p>{state?.soft_workspace.active_focus.join(' · ') || 'No active focus items recorded.'}</p>
      </div>
    )
  }
  if (tab === 'praxis') {
    return (
      <div className="workspace-summary">
        <div className="eyebrow">Praxis Verification</div>
        <h1>Verification receipts.</h1>
        <p>{state?.hard_state.verification_receipts.length ?? 0} receipts recorded against the current project.</p>
      </div>
    )
  }
  if (tab === 'history') {
    return (
      <div className="workspace-summary">
        <div className="eyebrow">Repository History</div>
        <h1>{project?.name ?? 'Rivet'} history.</h1>
        <p>Session run history and audit logs.</p>
      </div>
    )
  }
  return null
}
