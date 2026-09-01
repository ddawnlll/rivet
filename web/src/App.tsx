import { useEffect, useMemo, useState } from 'react'
import { ActivitySpine } from './components/ActivitySpine'
import { AppHeader } from './components/AppHeader'
import { AuthorityDialog, ImplementationStudio, ProjectSettings } from './components/Dialogs'
import { Composer } from './components/Composer'
import { Inspector, type InspectorPanel } from './components/Inspector'
import { useRivetSession } from './useRivetSession'
import type { Attachment, Message } from './types'

type WorkspaceTab = 'conversation' | InspectorPanel
const commands = [
  ['/goal ', 'Compile a formal GoalSpec and obligation graph'], ['/obligations', 'Open authoritative Hard State obligations'], ['/workspace', 'Open the bounded Soft Workspace'], ['/census', 'Refresh deterministic repository census'], ['/diff', 'Open Git working tree in Implementation Studio'], ['/sessions', 'Open run history'], ['/search ', 'Search this conversation'], ['/sidebar', 'Toggle the inspection aperture'], ['/help', 'Show keyboard shortcuts'],
] as const

/* SVG icons for edge nav — spec-compliant square markers */
const IconConversation = () => <svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="3" width="10" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
const IconHardState = () => <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
const IconSoftWorkspace = () => <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
const IconPraxis = () => <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3l4 4-4 4-4-4z" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
const IconHistory = () => <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 5h8M4 8h8M4 11h5" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>

export function App() {
  const session = useRivetSession()
  const { setSelected, setAuthority } = session
  const [tab, setTab] = useState<WorkspaceTab>('conversation')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [projectOpen, setProjectOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setProjectOpen(false); setModelOpen(false); setSettingsOpen(false); setProjectSettingsOpen(false); setStudioOpen(false); setSelected(null); setAuthority(null) }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); setInspectorOpen(open => !open) }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); document.querySelector<HTMLTextAreaElement>('#rivet-composer')?.focus() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPrompt('/') ; document.querySelector<HTMLTextAreaElement>('#rivet-composer')?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setAuthority, setSelected])

  const visibleMessages = useMemo(() => search.trim() ? session.messages.filter(message => message.body.toLowerCase().includes(search.toLowerCase())) : session.messages, [search, session.messages])
  const chooseCommand = (command: string) => { setPrompt(command); if (command === '/sidebar') setInspectorOpen(open => !open); if (command === '/workspace') { setTab('soft'); setInspectorOpen(true) } if (command === '/obligations') { setTab('hard'); setInspectorOpen(true) } if (command === '/census') { setTab('history'); setInspectorOpen(true); void session.loadCensus() } if (command === '/diff') { setStudioOpen(true); void session.loadDiff() } if (command === '/sessions') { setTab('history'); setInspectorOpen(true) } }
  const submit = (files: Attachment[]) => { const original = prompt; if (original.startsWith('/goal ')) void session.compileGoal(original, original.slice(6)); else void session.send(original, files); setPrompt(''); setAttachments([]) }

  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to main content</a><div className="ambient ambient-a" /><div className="ambient ambient-b" /><div className="grain" />
    <div onClick={event => event.stopPropagation()}><AppHeader project={session.project} models={session.models} connection={session.connection} onProject={() => setProjectOpen(open => !open)} onModel={() => setModelOpen(open => !open)} onSettings={() => setSettingsOpen(open => !open)} onProjectSettings={() => { setProjectSettingsOpen(true); setProjectOpen(false) }} projectOpen={projectOpen} modelOpen={modelOpen} settingsOpen={settingsOpen} onPickModel={(provider, model) => { void session.chooseModel(provider, model); setModelOpen(false) }} /></div>
    <div className={`workspace ${inspectorOpen ? '' : 'inspector-hidden'}`}>
      <nav className="edge" aria-label="Primary navigation"><NavButton label="Conversation" active={tab === 'conversation'} onClick={() => setTab('conversation')}><IconConversation /></NavButton><NavButton label="Hard State" active={tab === 'hard'} onClick={() => { setTab('hard'); setInspectorOpen(true) }}><IconHardState /></NavButton><NavButton label="Soft Workspace" active={tab === 'soft'} onClick={() => { setTab('soft'); setInspectorOpen(true) }}><IconSoftWorkspace /></NavButton><NavButton label="Praxis" active={tab === 'praxis'} onClick={() => { setTab('praxis'); setInspectorOpen(true) }}><IconPraxis /></NavButton><NavButton label="Run history" active={tab === 'history'} onClick={() => { setTab('history'); setInspectorOpen(true) }}><IconHistory /></NavButton></nav>
      <main className="stage" id="main-content"><section className="conversation" aria-label="Rivet conversation">{tab === 'conversation' ? <>{visibleMessages.map(message => <Turn key={message.id} message={message} />)}{(session.runActive || session.activities.length > 0) && <ActivitySpine activities={session.activities} runActive={session.runActive} selected={session.selected} onSelect={session.setSelected} onCancel={() => void session.cancel()} focusObject={session.focusObject} summary={session.runSummary} />}</> : <WorkspaceSummary tab={tab} state={session.state} project={session.project} />}</section>
        <Composer value={prompt} attachments={attachments} runActive={session.runActive} revision={session.project?.revision} onChange={setPrompt} onAttachments={setAttachments} onSend={submit} onCancel={() => void session.cancel()} onRemoveAttachment={name => setAttachments(current => current.filter(file => file.name !== name))} />
        {prompt.startsWith('/') && <CommandPalette prompt={prompt} onChoose={chooseCommand} />}
      </main>
      {inspectorOpen && <Inspector panel={tab === 'conversation' ? 'hard' : tab} setPanel={next => setTab(next)} state={session.state} census={session.census} history={session.history} diff={session.diff} onClose={() => setInspectorOpen(false)} onCensus={() => void session.loadCensus()} onDiff={() => void session.loadDiff()} onOpenArtifact={() => { setStudioOpen(true); void session.loadDiff() }} />}
    </div>
    {session.authority && <AuthorityDialog capability={session.authority.capability} target={session.authority.target} onClose={() => session.setAuthority(null)} onDecision={decision => { session.setAuthority(null); session.setNotice(`Authority decision recorded by Harness: ${decision}`) }} />}
    {projectSettingsOpen && <ProjectSettings project={session.project} onClose={() => setProjectSettingsOpen(false)} />}
    {studioOpen && <ImplementationStudio diff={session.diff} onClose={() => setStudioOpen(false)} />}
    {session.notice && <div className="notice" role="status"><span>{session.notice}</span><button aria-label="Dismiss notice" onClick={() => session.setNotice(null)}>×</button></div>}
  </div>
}

function NavButton({ children, label, active, onClick }: { children: React.ReactNode; label: string; active: boolean; onClick: () => void }) { return <button className={active ? 'active' : ''} onClick={onClick} aria-label={label} title={label}>{children}</button> }
function Turn({ message }: { message: Message }) { return <article className={`turn ${message.role}`}><div className="role">{message.role === 'you' ? 'You' : message.role === 'system' ? 'System' : 'Rivet'}</div><div className={`message ${message.live ? 'streaming' : ''}`}>{message.body || <span className="cursor">▍</span>}</div>{message.attachments?.length ? <div className="turn-attachments">context · {message.attachments.join(' · ')}</div> : null}</article> }
function WorkspaceSummary({ tab, state, project }: { tab: WorkspaceTab; state: ReturnType<typeof useRivetSession>['state']; project: ReturnType<typeof useRivetSession>['project'] }) { if (tab === 'hard') return <div className="workspace-summary"><div className="eyebrow">authoritative / hard state</div><h1>Obligations, claims, and receipts.</h1><p>Revision {state?.hard_state.revision ?? '—'} · {state?.hard_state.open_obligations.length ?? 0} obligations remain open.</p></div>; if (tab === 'soft') return <div className="workspace-summary"><div className="eyebrow">provisional / soft workspace</div><h1>Bounded cognition.</h1><p>{state?.soft_workspace.active_focus.join(' · ') || 'No active focus is exposed yet.'}</p></div>; if (tab === 'praxis') return <div className="workspace-summary"><div className="eyebrow">verification / praxis</div><h1>Predicates before done.</h1><p>{state?.hard_state.verification_receipts.length ?? 0} receipts recorded against the current project.</p></div>; if (tab === 'history') return <div className="workspace-summary"><div className="eyebrow">session / repository</div><h1>{project?.name ?? 'Rivet'} history.</h1><p>Run history and implementation surfaces stay tied to this adapter session.</p></div>; return null }
function CommandPalette({ prompt, onChoose }: { prompt: string; onChoose: (command: string) => void }) { const matches = commands.filter(([name]) => name.startsWith(prompt.toLowerCase())); return <div className="command-palette">{matches.length ? matches.map(([name, description]) => <button key={name} type="button" onMouseDown={event => { event.preventDefault(); onChoose(name) }}><b>{name}</b><span>{description}</span></button>) : <span>No matching command</span>}</div> }
