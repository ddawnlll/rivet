import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelRun,
  getCensus,
  getDiff,
  getHistory,
  getMcp,
  getModels,
  getProject,
  getState,
  openProject,
  openSocket,
  postGoal,
  postRun,
  removeAuth,
  saveAuth,
  selectModel,
} from './api'
import type {
  Activity,
  Attachment,
  Census,
  ConnectionState,
  Diff,
  HistoryEntry,
  McpServerInfo,
  Message,
  ModelCatalog,
  Project,
  SaveAuthPayload,
  State,
  UiEvent,
} from './types'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const stamp = () => clock.format(new Date())
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const phaseLabel = (phase: string) => phase.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase()

function parseThoughtAndBody(raw: string): { reasoning?: string; body: string } {
  if (!raw.includes('<think>')) {
    return { body: raw }
  }
  const thoughts: string[] = []
  // Extract all closed <think>...</think> blocks
  let body = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_, thought) => {
    if (thought.trim()) thoughts.push(thought.trim())
    return ''
  })
  // If there is an unclosed streaming <think> at the end
  if (body.includes('<think>')) {
    const idx = body.indexOf('<think>')
    const trailingThought = body.slice(idx + 7).trim()
    if (trailingThought) thoughts.push(trailingThought)
    body = body.slice(0, idx)
  }
  const reasoning = thoughts.join(' ').trim()
  return {
    reasoning: reasoning || undefined,
    body: body.trim(),
  }
}

export function useRivetSession() {
  const socket = useRef<WebSocket | null>(null)
  const reconnect = useRef<number | undefined>()
  const runStartTime = useRef<number | null>(null)
  const rawBuffer = useRef<string>('')
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [state, setState] = useState<State | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [models, setModels] = useState<ModelCatalog | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [census, setCensus] = useState<Census | null>(null)
  const [diff, setDiff] = useState<Diff | null>(null)
  const [messages, setMessages] = useState<Message[]>([{ id: 'welcome', role: 'rivet', body: 'Rivet is ready. Give me a bounded outcome and I’ll maintain the acceptance boundary as the run unfolds.' }])
  const [activities, setActivities] = useState<Activity[]>([])
  const [selected, setSelected] = useState<Activity | null>(null)
  const [runActive, setRunActive] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [authority, setAuthority] = useState<{ requestId: string; capability: string; target: string } | null>(null)
  const [focusObject, setFocusObject] = useState<{ phase: string; title: string; text: string } | null>(null)
  const [runSummary, setRunSummary] = useState<string | null>(null)
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([])

  const refreshState = useCallback(async () => { try { setState(await getState()) } catch { /* keep last authoritative snapshot */ } }, [])
  const refreshProject = useCallback(async () => { try { setProject(await getProject()) } catch { /* disconnected state is visible */ } }, [])
  const refreshModels = useCallback(async () => { try { setModels(await getModels()) } catch { /* unavailable until service is live */ } }, [])
  const refreshHistory = useCallback(async () => { try { setHistory(await getHistory()) } catch { /* unavailable until service is live */ } }, [])
  const loadMcp = useCallback(async () => { try { setMcpServers(await getMcp()) } catch { /* MCP optional */ } }, [])

  const addActivity = useCallback((activity: Omit<Activity, 'id' | 'timestamp'>) => {
    const next = { ...activity, id: id('event'), timestamp: stamp() }
    setActivities(current => [...current.map(item => item.status === 'active' ? { ...item, status: 'done' as const } : item), next])
    setSelected(next)
  }, [])

  const receive = useCallback((event: UiEvent) => {
    switch (event.type) {
      case 'run_started': {
        setRunActive(true)
        runStartTime.current = Date.now()
        rawBuffer.current = ''
        setRunSummary(null)
        addActivity({ kind: 'request', body: event.prompt, status: 'active', authoritative: true, detail: [['GOAL', event.goal], ['INPUT', 'raw user turn'], ['SOURCE', 'RivetService']] })
        break
      }
      case 'assistant_reasoning_delta': {
        const elapsed = runStartTime.current ? Math.max(0.1, Math.round((Date.now() - runStartTime.current) / 100) / 10) : undefined
        setMessages(current => {
          const last = current.at(-1)
          if (last?.role === 'rivet' && last.live) {
            return [...current.slice(0, -1), { ...last, reasoning: (last.reasoning || '') + event.delta, elapsedSeconds: elapsed }]
          }
          return [...current, { id: id('assistant'), role: 'rivet', body: '', reasoning: event.delta, elapsedSeconds: elapsed, live: true }]
        })
        break
      }
      case 'assistant_delta': {
        rawBuffer.current += event.delta
        const { reasoning, body } = parseThoughtAndBody(rawBuffer.current)
        const elapsed = runStartTime.current ? Math.max(0.1, Math.round((Date.now() - runStartTime.current) / 100) / 10) : undefined
        setMessages(current => {
          const last = current.at(-1)
          if (last?.role === 'rivet' && last.live) {
            return [...current.slice(0, -1), { ...last, body, reasoning: reasoning || last.reasoning, elapsedSeconds: elapsed }]
          }
          return [...current, { id: id('assistant'), role: 'rivet', body, reasoning, elapsedSeconds: elapsed, live: true }]
        })
        break
      }
      case 'status': { const label = phaseLabel(event.phase); if (label === 'idle') setRunActive(false); addActivity({ kind: label, body: event.message, status: 'active', detail: [['PHASE', event.phase], ['SOURCE', 'Harness lifecycle']] }); break }
      case 'cognitive_state': addActivity({ kind: 'cognitive state', body: event.focus, status: 'neutral', detail: [['HYPOTHESIS', event.hypothesis ?? 'none recorded'], ['STATUS', event.status], ['EVIDENCE', String(event.evidence_count)], ['COUNTER-SIGNAL', event.counter_signal ?? 'none']] }); setFocusObject({ phase: event.status, title: event.focus, text: [event.hypothesis, event.counter_signal].filter(Boolean).join(' · ') || `Evidence count: ${event.evidence_count}` }); break
      case 'tool_activity': addActivity({ kind: event.capability, body: event.target, status: event.status === 'failed' ? 'alert' : event.status === 'completed' ? 'done' : 'active', authoritative: true, detail: [['ACTION', event.action_id], ['SUMMARY', event.summary], ['STATUS', event.status], ['OUTPUT', event.output_summary ?? 'pending']] }); break
      case 'observation': addActivity({ kind: 'observation', body: event.summary, status: 'neutral', authoritative: true, detail: [['SOURCE', event.source], ['EVIDENCE', event.evidence_id ?? 'not promoted']] }); break
      case 'praxis_update': addActivity({ kind: 'Praxis', body: `${event.obligation_id} · ${event.status.toUpperCase()}`, status: event.status === 'fail' ? 'alert' : event.status === 'pass' ? 'done' : 'active', authoritative: true, detail: [['PREDICATE', event.predicate], ['SCOPE', event.scope], ['RECEIPT', event.receipt_id ?? 'running'], ['DIAGNOSTICS', event.diagnostics ?? 'none']] }); void refreshState(); break
      case 'verification_update': addActivity({ kind: 'Praxis', body: `${event.obligation_id} · ${event.passed ? 'PASS' : 'REQUIRES ATTENTION'}`, status: event.passed ? 'done' : 'alert', authoritative: true, detail: [['RESULT', event.passed ? 'PASS' : 'FAIL'], ['DIAGNOSTICS', event.diagnostics ?? 'none']] }); void refreshState(); break
      case 'hard_state_mutation': addActivity({ kind: 'hard state', body: event.to ? `${event.from ?? 'state'} → ${event.to}` : event.mutation, status: 'done', authoritative: true, detail: [['REVISION', String(event.revision)], ['MUTATION', event.mutation], ['ENTITY', event.entity_id ?? 'state ledger'], ['AUTHORITY', 'Noesis / Harness']] }); void refreshState(); break
      case 'steer_accepted': addActivity({ kind: 'steer', body: event.prompt, status: 'active', detail: [['MODE', 'queued against current run'], ['INPUT', 'raw user turn']] }); break
      case 'authority_prompt': setAuthority({ requestId: event.request_id, capability: event.capability, target: event.target }); break
      case 'cancelled': {
        setRunActive(false)
        const finalElapsed = runStartTime.current ? Math.max(0.1, Math.round((Date.now() - runStartTime.current) / 100) / 10) : undefined
        setFocusObject(null)
        setMessages(current => current.map(m => m.live ? { ...m, live: false, elapsedSeconds: finalElapsed ?? m.elapsedSeconds } : m))
        addActivity({ kind: 'cancelled', body: event.message, status: 'alert', authoritative: true, detail: [['RUN', 'cancelled by user']] })
        runStartTime.current = null
        rawBuffer.current = ''
        break
      }
      case 'completed': {
        setRunActive(false)
        const finalElapsed = runStartTime.current ? Math.max(0.1, Math.round((Date.now() - runStartTime.current) / 100) / 10) : undefined
        setFocusObject(null)
        setRunSummary(event.summary)
        setMessages(current => current.map(m => m.live ? { ...m, live: false, elapsedSeconds: finalElapsed ?? m.elapsedSeconds } : m))
        addActivity({ kind: 'receipt', body: event.summary, status: 'done', authoritative: true, detail: [['RUN', 'completed'], ['AUTHORITY', 'RivetService'], ['NEXT', 'inspect state or continue']] })
        runStartTime.current = null
        rawBuffer.current = ''
        void refreshState()
        void refreshHistory()
        break
      }
      case 'error': {
        setRunActive(false)
        const finalElapsed = runStartTime.current ? Math.max(0.1, Math.round((Date.now() - runStartTime.current) / 100) / 10) : undefined
        setNotice(event.message)
        setMessages(current => current.map(m => m.live ? { ...m, live: false, elapsedSeconds: finalElapsed ?? m.elapsedSeconds } : m))
        addActivity({ kind: 'error', body: event.message, status: 'alert', detail: [['STATUS', 'run interrupted']] })
        runStartTime.current = null
        rawBuffer.current = ''
        break
      }
    }
  }, [addActivity, refreshHistory, refreshState])

  useEffect(() => {
    if (!runActive) return
    const interval = window.setInterval(() => {
      if (!runStartTime.current) return
      const elapsed = Math.max(0.1, Math.round((Date.now() - runStartTime.current) / 100) / 10)
      setMessages(current => {
        const last = current.at(-1)
        if (last?.role === 'rivet' && last.live) {
          return [...current.slice(0, -1), { ...last, elapsedSeconds: elapsed }]
        }
        return current
      })
    }, 100)
    return () => window.clearInterval(interval)
  }, [runActive])

  const connect = useCallback(() => {
    setConnection('connecting')
    socket.current = openSocket(receive, next => { setConnection(next); if (next === 'live') { void refreshState(); void refreshProject(); void refreshModels(); void refreshHistory(); void loadMcp() } })
    socket.current.addEventListener('close', () => { if (reconnect.current === undefined) reconnect.current = window.setTimeout(() => { reconnect.current = undefined; connect() }, 2500) }, { once: true })
  }, [receive, refreshHistory, refreshModels, refreshProject, refreshState, loadMcp])

  useEffect(() => { void Promise.all([refreshState(), refreshProject(), refreshModels(), refreshHistory(), loadMcp()]); connect(); return () => { if (reconnect.current) window.clearTimeout(reconnect.current); socket.current?.close() } }, [connect, refreshHistory, refreshModels, refreshProject, refreshState, loadMcp])

  const send = useCallback(async (prompt: string, attachments: Attachment[]) => {
    if (!prompt.trim()) return
    const original = prompt
    setMessages(current => [...current, { id: id('user'), role: 'you', body: original, attachments: attachments.map(file => file.name) }])
    setRunActive(true)
    try { await postRun(original, state?.task_id, attachments, runActive, socket.current) } catch (error) { setRunActive(false); setNotice(error instanceof Error ? error.message : 'RivetService is unavailable') }
  }, [runActive, state?.task_id])
  const compileGoal = useCallback(async (displayPrompt: string, compilerPrompt = displayPrompt) => {
    if (!displayPrompt.trim()) return
    setMessages(current => [...current, { id: id('user'), role: 'you', body: displayPrompt }])
    setRunActive(true)
    try { await postGoal(compilerPrompt, socket.current) } catch (error) { setRunActive(false); setNotice(error instanceof Error ? error.message : 'Goal compiler unavailable') }
  }, [])
  const cancel = useCallback(async () => { try { await cancelRun(socket.current) } catch (error) { setNotice(error instanceof Error ? error.message : 'Cancellation failed') } setRunActive(false) }, [])
  const chooseModel = useCallback(async (provider: string, model: string) => { try { setModels(await selectModel(provider, model)); addActivity({ kind: 'model', body: `${provider} · ${model}`, status: 'done', detail: [['SOURCE', 'Rivet provider registry'], ['ACTIVE', 'yes']] }) } catch (error) { setNotice(error instanceof Error ? error.message : 'Model selection failed') } }, [addActivity])
  const saveCredentials = useCallback(async (payload: SaveAuthPayload) => {
    try {
      const updated = await saveAuth(payload)
      setModels(updated)
      setNotice(`Saved credentials for ${payload.provider}`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Failed to save auth') }
  }, [])
  const removeCredentials = useCallback(async (provider: string) => {
    try {
      const updated = await removeAuth(provider)
      setModels(updated)
      setNotice(`Removed credentials for ${provider}`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Failed to remove auth') }
  }, [])
  const switchProject = useCallback(async (path: string) => {
    try {
      const proj = await openProject(path)
      setProject(proj)
      void refreshState()
      void refreshHistory()
      void loadMcp()
      setNotice(`Switched to project: ${proj.name}`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Failed to open project') }
  }, [loadMcp, refreshHistory, refreshState])
  const loadCensus = useCallback(async () => { try { setCensus(await getCensus()) } catch (error) { setNotice(error instanceof Error ? error.message : 'Census unavailable') } }, [])
  const loadDiff = useCallback(async () => { try { setDiff(await getDiff()) } catch (error) { setNotice(error instanceof Error ? error.message : 'Diff unavailable') } }, [])

  return { connection, state, project, models, history, census, diff, messages, activities, selected, runActive, notice, authority, focusObject, runSummary, mcpServers, setSelected, setNotice, setAuthority, send, compileGoal, cancel, chooseModel, saveCredentials, removeCredentials, switchProject, loadCensus, loadDiff, loadMcp }
}
