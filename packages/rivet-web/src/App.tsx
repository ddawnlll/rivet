import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MessageSquare,
  Layers,
  Cpu,
  ShieldCheck,
  History,
  Brain,
  ChevronDown,
  ChevronUp,
  Search,
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
    runOutcome,
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
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorMounted, setInspectorMounted] = useState(false)
  const inspectorTimerRef = useRef<number | null>(null)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [search, setSearch] = useState('')
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const conversationRef = useRef<HTMLElement>(null)
  const autoScrollRef = useRef(true)

  const openInspector = useCallback((panel: InspectorPanel) => {
    if (inspectorTimerRef.current !== null) {
      window.clearTimeout(inspectorTimerRef.current)
      inspectorTimerRef.current = null
    }
    setTab(panel)
    setInspectorMounted(true)
    setInspectorOpen(true)
  }, [])

  const closeInspector = useCallback(() => {
    setInspectorOpen(false)
    if (inspectorTimerRef.current !== null) {
      window.clearTimeout(inspectorTimerRef.current)
    }
    inspectorTimerRef.current = window.setTimeout(() => {
      setInspectorMounted(false)
      inspectorTimerRef.current = null
    }, 240)
  }, [])

  const toggleInspector = useCallback(() => {
    if (inspectorOpen) {
      closeInspector()
    } else {
      openInspector(tab === 'conversation' ? 'hard' : tab)
    }
  }, [closeInspector, inspectorOpen, openInspector, tab])

  const showConversation = useCallback(() => {
    setTab('conversation')
    closeInspector()
  }, [closeInspector])

  // Initialize store lifecycle & WS connection on mount (run once)
  useEffect(() => {
    const cleanup = initSession()
    return cleanup
  }, [initSession])

  useEffect(() => {
    const stream = conversationRef.current
    if (!stream || !autoScrollRef.current) return
    const frame = window.requestAnimationFrame(() => {
      stream.scrollTop = stream.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
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
        toggleInspector()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.querySelector<HTMLTextAreaElement>('#composerInput')?.focus()
      }
      if (event.key === 'Escape' && inspectorOpen) {
        closeInspector()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closeInspector, inspectorOpen, toggleInspector])

  const visibleMessages = useMemo(
    () =>
      search.trim()
        ? messages.filter(message => message.body.toLowerCase().includes(search.toLowerCase()))
        : messages,
    [search, messages]
  )
  const showIdleWorkspace = !runActive && activities.length === 0 && visibleMessages.length <= 1

  const handleCommandSelect = (command: string) => {
    if (command.startsWith('/goal ')) {
      setPrompt(command)
      document.querySelector<HTMLTextAreaElement>('#composerInput')?.focus()
      return
    }
    if (command === '/sidebar') {
      toggleInspector()
      return
    }
    if (command === '/workspace') {
      openInspector('soft')
      return
    }
    if (command === '/obligations') {
      openInspector('hard')
      return
    }
    if (command === '/census') {
      openInspector('history')
      void loadCensus(true)
      return
    }
    if (command === '/diff') {
      setStudioOpen(true)
      void loadDiff(true)
      return
    }
    if (command === '/sessions') {
      openInspector('history')
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
    autoScrollRef.current = true
    setShowJumpToLatest(false)
    if (original.startsWith('/goal ')) void compileGoal(original, original.slice(6))
    else void send(original, files)
    setPrompt('')
    setAttachments([])
  }

  const handleConversationScroll = () => {
    const stream = conversationRef.current
    if (!stream) return
    const isNearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 120
    if (autoScrollRef.current !== isNearBottom) {
      autoScrollRef.current = isNearBottom
      setShowJumpToLatest(!isNearBottom)
    }
  }

  const jumpToLatest = () => {
    const stream = conversationRef.current
    if (!stream) return
    autoScrollRef.current = true
    setShowJumpToLatest(false)
    stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className={`app-shell ${runActive ? 'is-running' : 'is-idle'} ${inspectorOpen ? 'has-aperture' : ''}`}>
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
        onOpenCommand={() => setCommandPaletteOpen(true)}
      />

      <div className="workspace">
        <nav className="edge" aria-label="Primary Navigation">
          <div className="edge-mark" aria-hidden="true"><span /></div>
          <NavButton label="Conversation" active={!inspectorOpen} onClick={showConversation}>
            <MessageSquare size={17} />
          </NavButton>
          <NavButton label="Hard State" active={inspectorOpen && tab === 'hard'} onClick={() => openInspector('hard')}>
            <Layers size={17} />
          </NavButton>
          <NavButton label="Soft Workspace" active={inspectorOpen && tab === 'soft'} onClick={() => openInspector('soft')}>
            <Cpu size={17} />
          </NavButton>
          <NavButton label="Praxis" active={inspectorOpen && tab === 'praxis'} onClick={() => openInspector('praxis')}>
            <ShieldCheck size={17} />
          </NavButton>
          <NavButton label="Run History" active={inspectorOpen && tab === 'history'} onClick={() => openInspector('history')}>
            <History size={17} />
          </NavButton>
          <button className="edge-command" type="button" onClick={() => setCommandPaletteOpen(true)} aria-label="Open command menu" data-label="Command menu">
            <Search size={16} />
          </button>
        </nav>

        <main className="stage" id="main-content">
          <section
            ref={conversationRef}
            className="conversation"
            aria-label="Rivet conversation stream"
            onScroll={handleConversationScroll}
          >
            {showIdleWorkspace ? (
              <IdleWorkspace
                projectName={project?.name ?? 'rivet'}
                revision={project?.revision ?? '—'}
                hardRevision={state?.hard_state.revision}
                openObligations={state?.hard_state.open_obligations.length ?? 0}
                onStart={() => document.querySelector<HTMLTextAreaElement>('#composerInput')?.focus()}
                onPrompt={nextPrompt => {
                  setPrompt(nextPrompt)
                  window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('#composerInput')?.focus(), 0)
                }}
                onInspect={() => openInspector('hard')}
              />
            ) : (
              visibleMessages.map(message => <Turn key={message.id} message={message} />)
            )}
            {(runActive || activities.length > 0) && (
              <ActivitySpine
                activities={activities}
                runActive={runActive}
                runOutcome={runOutcome}
                selected={selected}
                onSelect={setSelected}
                onCancel={() => void cancel()}
                focusObject={focusObject}
                summary={runSummary}
              />
            )}
          </section>

          {showJumpToLatest ? (
            <button type="button" className="jumpToLatest" onClick={jumpToLatest} aria-label="Jump to latest message">
              <ChevronDown size={14} />
              <span>Latest</span>
            </button>
          ) : null}

          <Composer
            value={prompt}
            attachments={attachments}
            runActive={runActive}
            connection={connection}
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

      </div>

      {inspectorMounted && (
        <div className={`aperture-layer ${inspectorOpen ? 'open' : 'closing'}`} data-state={inspectorOpen ? 'open' : 'closed'}>
          <button className="aperture-scrim" type="button" aria-label="Close inspection" onClick={closeInspector} />
          <Inspector
            panel={tab === 'conversation' ? 'hard' : tab}
            setPanel={next => setTab(next)}
            state={state}
            census={census}
            history={history}
            diff={diff}
            onClose={closeInspector}
            onCensus={() => void loadCensus(true)}
            onDiff={() => void loadDiff(true)}
            onOpenArtifact={() => {
              setStudioOpen(true)
              void loadDiff(true)
            }}
          />
        </div>
      )}

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
    <button className={active ? 'active' : ''} onClick={onClick} aria-label={label} aria-pressed={active} data-label={label} type="button">
      {children}
    </button>
  )
}

function IdleWorkspace({
  projectName,
  revision,
  hardRevision,
  openObligations,
  onStart,
  onPrompt,
  onInspect,
}: {
  projectName: string
  revision: string
  hardRevision?: number
  openObligations: number
  onStart: () => void
  onPrompt: (prompt: string) => void
  onInspect: () => void
}) {
  return (
    <section className="idleWorkspace" aria-labelledby="idle-title">
      <div className="idleOverline">
        <span className="readySignal" />
        <span>Workspace ready</span>
        <i />
        <span>{projectName} · {revision}</span>
      </div>

      <h1 id="idle-title">What needs to<br /><span>hold true?</span></h1>
      <p>
        Give Rivet a bounded outcome. Scope, evidence, verification, and authoritative changes stay visible while the work unfolds.
      </p>

      <div className="idleActions">
        <button type="button" className="idlePrimary" onClick={onStart}>
          Start with an outcome <kbd>⌘ F</kbd>
        </button>
        <button type="button" className="idleSecondary" onClick={onInspect}>
          <span>Inspect hard state</span>
          <small>r{hardRevision ?? '—'} · {openObligations} open →</small>
        </button>
      </div>

      <div className="idlePrinciples" aria-label="Rivet work principles">
        <span>Scope bounded</span>
        <span>Evidence visible</span>
        <span>Verification explicit</span>
      </div>

      <div className="quickStart" aria-label="Suggested starting points">
        <button type="button" onClick={() => onPrompt('Map this repository and identify the three most relevant areas for the next engineering task.') }>
          <span className="quickStartIndex">01</span>
          <span><b>Map the repository</b><small>Induce structure before acting</small></span>
          <span className="quickStartArrow">↗</span>
        </button>
        <button type="button" onClick={() => onPrompt('Inspect the current working tree and tell me what changed, what is risky, and what should be verified first.') }>
          <span className="quickStartIndex">02</span>
          <span><b>Read the working tree</b><small>Separate observation from claim</small></span>
          <span className="quickStartArrow">↗</span>
        </button>
        <button type="button" onClick={() => onPrompt('Find the current project bottleneck. Explore only what is needed, explain the evidence, and propose the smallest verified next step.') }>
          <span className="quickStartIndex">03</span>
          <span><b>Find the bottleneck</b><small>Let Rivet choose a bounded probe</small></span>
          <span className="quickStartArrow">↗</span>
        </button>
      </div>
    </section>
  )
}

function ThinkingBlock({ reasoning, isLive, elapsedSeconds }: { reasoning: string; isLive?: boolean; elapsedSeconds?: number }) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isLive && open && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [reasoning, isLive, open])

  return (
    <div className="thinking-block">
      <button
        type="button"
        className="thinking-summary-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Brain size={12} />
        <span>{isLive ? 'Thinking' : 'Reasoning summary'}</span>
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
    <article className={`turn ${message.role} turn-animate`}>
      <div className="role-header">
        <div className="role-meta-left">
          <div className="role">{message.role === 'you' ? 'You' : message.role === 'system' ? 'System' : 'Rivet'}</div>
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
          <p className="rivetLead responsePending"><span />Thinking…</p>
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
