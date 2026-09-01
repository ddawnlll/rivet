import { useEffect, useMemo, useState } from 'react'
import { ActivitySpine } from './components/ActivitySpine'
import { AppHeader } from './components/AppHeader'
import { AuthorityDialog, ImplementationStudio, McpStudioDialog, ProjectSettings, ProviderAuthDialog } from './components/Dialogs'
import { Composer } from './components/Composer'
import { Inspector, type InspectorPanel } from './components/Inspector'
import { useRivetSession } from './useRivetSession'
import type { Attachment, Message } from './types'
import { MarkdownView } from './components/MarkdownView'

type WorkspaceTab = 'conversation' | InspectorPanel
const commands = [
  ['/goal ', 'Compile a formal GoalSpec and obligation graph'],
  ['/obligations', 'Open authoritative Hard State obligations'],
  ['/workspace', 'Open the bounded Soft Workspace'],
  ['/census', 'Refresh repository census'],
  ['/diff', 'Open Git working tree in Implementation Studio'],
  ['/sessions', 'Open run history'],
  ['/auth', 'Manage Provider API keys & credentials'],
  ['/mcp', 'Inspect Model Context Protocol (MCP) servers'],
  ['/search ', 'Search this conversation'],
  ['/sidebar', 'Toggle the inspection sidebar'],
  ['/help', 'Show keyboard shortcuts'],
] as const

/* Clean SVG icons for edge nav */
const IconConversation = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M5 6h6M5 9h4" />
  </svg>
)
const IconHardState = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <circle cx="8" cy="8" r="5" />
    <path d="M8 5v6M5 8h6" />
  </svg>
)
const IconSoftWorkspace = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="3" y="3" width="10" height="10" rx="1.5" strokeDasharray="2 2" />
  </svg>
)
const IconPraxis = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M8 2.5l5 4.5-5 6.5-5-6.5z" />
  </svg>
)
const IconHistory = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3.5l2.5 1.5" />
  </svg>
)

export function App() {
  const session = useRivetSession()
  const { setSelected, setAuthority } = session
  const [tab, setTab] = useState<WorkspaceTab>('conversation')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [projectOpen, setProjectOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectOpen(false)
        setModelOpen(false)
        setSettingsOpen(false)
        setProjectSettingsOpen(false)
        setAuthOpen(false)
        setMcpOpen(false)
        setStudioOpen(false)
        setSelected(null)
        setAuthority(null)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setInspectorOpen(open => !open)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.querySelector<HTMLTextAreaElement>('#rivet-composer')?.focus()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPrompt('/')
        document.querySelector<HTMLTextAreaElement>('#rivet-composer')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setAuthority, setSelected])

  const visibleMessages = useMemo(
    () =>
      search.trim()
        ? session.messages.filter(message => message.body.toLowerCase().includes(search.toLowerCase()))
        : session.messages,
    [search, session.messages]
  )

  const chooseCommand = (command: string) => {
    setPrompt(command)
    if (command === '/sidebar') setInspectorOpen(open => !open)
    if (command === '/workspace') { setTab('soft'); setInspectorOpen(true) }
    if (command === '/obligations') { setTab('hard'); setInspectorOpen(true) }
    if (command === '/census') { setTab('history'); setInspectorOpen(true); void session.loadCensus() }
    if (command === '/diff') { setStudioOpen(true); void session.loadDiff() }
    if (command === '/sessions') { setTab('history'); setInspectorOpen(true) }
    if (command === '/auth') { setAuthOpen(true) }
    if (command === '/mcp') { setMcpOpen(true); void session.loadMcp() }
  }

  const submit = (files: Attachment[]) => {
    const original = prompt
    if (original.startsWith('/goal ')) void session.compileGoal(original, original.slice(6))
    else void session.send(original, files)
    setPrompt('')
    setAttachments([])
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="grain" aria-hidden="true" />

      <div onClick={event => event.stopPropagation()}>
        <AppHeader
          project={session.project}
          models={session.models}
          connection={session.connection}
          onProject={() => setProjectOpen(open => !open)}
          onModel={() => setModelOpen(open => !open)}
          onSettings={() => setSettingsOpen(open => !open)}
          onProjectSettings={() => { setProjectSettingsOpen(true); setProjectOpen(false) }}
          onOpenAuth={() => setAuthOpen(true)}
          onOpenMcp={() => { setMcpOpen(true); void session.loadMcp() }}
          projectOpen={projectOpen}
          modelOpen={modelOpen}
          settingsOpen={settingsOpen}
          onPickModel={(provider, model) => { void session.chooseModel(provider, model); setModelOpen(false) }}
        />
      </div>

      <div className={`workspace ${inspectorOpen ? '' : 'inspector-hidden'}`}>
        <nav className="edge" aria-label="Primary Navigation">
          <NavButton label="Conversation" active={tab === 'conversation'} onClick={() => setTab('conversation')}>
            <IconConversation />
          </NavButton>
          <NavButton label="Hard State" active={tab === 'hard'} onClick={() => { setTab('hard'); setInspectorOpen(true) }}>
            <IconHardState />
          </NavButton>
          <NavButton label="Soft Workspace" active={tab === 'soft'} onClick={() => { setTab('soft'); setInspectorOpen(true) }}>
            <IconSoftWorkspace />
          </NavButton>
          <NavButton label="Praxis" active={tab === 'praxis'} onClick={() => { setTab('praxis'); setInspectorOpen(true) }}>
            <IconPraxis />
          </NavButton>
          <NavButton label="Run History" active={tab === 'history'} onClick={() => { setTab('history'); setInspectorOpen(true) }}>
            <IconHistory />
          </NavButton>
        </nav>

        <main className="stage" id="main-content">
          {session.runActive && <div className="live-progress-bar" />}
          <section className="conversation" aria-label="Rivet conversation stream">
            {tab === 'conversation' ? (
              <>
                {visibleMessages.map(message => <Turn key={message.id} message={message} />)}
                {(session.runActive || session.activities.length > 0) && (
                  <ActivitySpine
                    activities={session.activities}
                    runActive={session.runActive}
                    selected={session.selected}
                    onSelect={session.setSelected}
                    onCancel={() => void session.cancel()}
                    focusObject={session.focusObject}
                    summary={session.runSummary}
                  />
                )}
              </>
            ) : (
              <WorkspaceSummary tab={tab} state={session.state} project={session.project} />
            )}
          </section>

          <Composer
            value={prompt}
            attachments={attachments}
            runActive={session.runActive}
            revision={session.project?.revision}
            census={session.census}
            onChange={setPrompt}
            onAttachments={setAttachments}
            onSend={submit}
            onCancel={() => void session.cancel()}
            onRemoveAttachment={name => setAttachments(current => current.filter(file => file.name !== name))}
          />

          {prompt.startsWith('/') && <CommandPalette prompt={prompt} onChoose={chooseCommand} />}
        </main>

        {inspectorOpen && (
          <Inspector
            panel={tab === 'conversation' ? 'hard' : tab}
            setPanel={next => setTab(next)}
            state={session.state}
            census={session.census}
            history={session.history}
            diff={session.diff}
            onClose={() => setInspectorOpen(false)}
            onCensus={() => void session.loadCensus()}
            onDiff={() => void session.loadDiff()}
            onOpenArtifact={() => { setStudioOpen(true); void session.loadDiff() }}
          />
        )}
      </div>

      {session.authority && (
        <AuthorityDialog
          capability={session.authority.capability}
          target={session.authority.target}
          onClose={() => session.setAuthority(null)}
          onDecision={decision => {
            session.setAuthority(null)
            session.setNotice(`Decision recorded: ${decision}`)
          }}
        />
      )}
      {projectSettingsOpen && (
        <ProjectSettings
          project={session.project}
          onClose={() => setProjectSettingsOpen(false)}
          onSwitchProject={session.switchProject}
        />
      )}
      {authOpen && (
        <ProviderAuthDialog
          catalog={session.models}
          onClose={() => setAuthOpen(false)}
          onSaveAuth={session.saveCredentials}
          onRemoveAuth={session.removeCredentials}
          onSelectModel={session.chooseModel}
        />
      )}
      {mcpOpen && <McpStudioDialog servers={session.mcpServers} onClose={() => setMcpOpen(false)} />}
      {studioOpen && <ImplementationStudio diff={session.diff} onClose={() => setStudioOpen(false)} />}

      {session.notice && (
        <div className="notice" role="status" aria-live="polite">
          <span>{session.notice}</span>
          <button aria-label="Dismiss notice" onClick={() => session.setNotice(null)}>×</button>
        </div>
      )}
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

function Turn({ message }: { message: Message }) {
  const [thinkingOpen, setThinkingOpen] = useState(Boolean(message.live))

  return (
    <article className={`turn ${message.role}`}>
      <div className="role-header">
        <div className="role">{message.role === 'you' ? 'You' : message.role === 'system' ? 'System' : 'Rivet'}</div>
        {message.elapsedSeconds !== undefined && message.role === 'rivet' && (
          <span className={`turn-timer ${message.live ? 'live' : ''}`}>
            {message.live ? `${message.elapsedSeconds.toFixed(1)}\u00A0s` : `${message.elapsedSeconds.toFixed(1)}\u00A0s`}
          </span>
        )}
      </div>

      {message.reasoning && (
        <details
          className={`thinking-block ${message.live ? 'live-thinking' : ''}`}
          open={thinkingOpen}
          onToggle={e => setThinkingOpen(e.currentTarget.open)}
        >
          <summary className="thinking-summary">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5v3l2 2" />
            </svg>
            <span className="thinking-label">
              {message.live ? 'Thinking…' : 'Thought process'}
            </span>
            {message.elapsedSeconds !== undefined && (
              <span className="thinking-time">({message.elapsedSeconds.toFixed(1)}&nbsp;s)</span>
            )}
            <span className="thinking-toggle-arrow" aria-hidden="true">{thinkingOpen ? '▴' : '▾'}</span>
          </summary>
          <div className="thinking-content">
            <div className="thinking-text">{message.reasoning}</div>
          </div>
        </details>
      )}

      <div className={`message ${message.live ? 'streaming' : ''}`}>
        {message.body ? (
          message.role === 'you' ? (
            <div className="user-prompt">{message.body}</div>
          ) : (
            <MarkdownView content={message.body} />
          )
        ) : message.live && !message.reasoning ? (
          <div className="message-thinking-placeholder">
            <span className="pulsing-dot" aria-hidden="true" />
            <span>Thinking…</span>
          </div>
        ) : null}
      </div>
      {message.attachments?.length ? (
        <div className="turn-attachments">Attached files · {message.attachments.join(' · ')}</div>
      ) : null}
    </article>
  )
}

function WorkspaceSummary({ tab, state, project }: { tab: WorkspaceTab; state: ReturnType<typeof useRivetSession>['state']; project: ReturnType<typeof useRivetSession>['project'] }) {
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

function CommandPalette({ prompt, onChoose }: { prompt: string; onChoose: (command: string) => void }) {
  const matches = commands.filter(([name]) => name.startsWith(prompt.toLowerCase()))
  return (
    <div className="command-palette" role="listbox" aria-label="Command palette">
      {matches.length ? (
        matches.map(([name, description]) => (
          <button
            key={name}
            type="button"
            role="option"
            onMouseDown={event => {
              event.preventDefault()
              onChoose(name)
            }}
          >
            <b>{name}</b>
            <span>{description}</span>
          </button>
        ))
      ) : (
        <span style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--ink-muted)' }}>No matching command</span>
      )}
    </div>
  )
}
