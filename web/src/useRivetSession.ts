import { useCallback, useEffect, useRef, useState } from 'react'
import { api, cancelRun, getCensus, getDiff, getHistory, getModels, getProject, getState, openSocket, postGoal, postRun, selectModel } from './api'
import type { Activity, Attachment, Census, ConnectionState, Diff, HistoryEntry, Message, ModelCatalog, Project, State, UiEvent } from './types'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const stamp = () => clock.format(new Date())
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const phaseLabel = (phase: string) => phase.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase()

export function useRivetSession() {
  const socket = useRef<WebSocket | null>(null)
  const reconnect = useRef<number | undefined>()
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

  const refreshState = useCallback(async () => { try { setState(await getState()) } catch { /* keep last authoritative snapshot */ } }, [])
  const refreshProject = useCallback(async () => { try { setProject(await getProject()) } catch { /* disconnected state is visible */ } }, [])
  const refreshModels = useCallback(async () => { try { setModels(await getModels()) } catch { /* unavailable until service is live */ } }, [])
  const refreshHistory = useCallback(async () => { try { setHistory(await getHistory()) } catch { /* unavailable until service is live */ } }, [])
  const addActivity = useCallback((activity: Omit<Activity, 'id' | 'timestamp'>) => {
    const next = { ...activity, id: id('event'), timestamp: stamp() }
    setActivities(current => [...current.map(item => item.status === 'active' ? { ...item, status: 'done' as const } : item), next])
    setSelected(next)
  }, [])

  const receive = useCallback((event: UiEvent) => {
    switch (event.type) {
      case 'run_started': setRunActive(true); setRunSummary(null); addActivity({ kind: 'request', body: event.prompt, status: 'active', authoritative: true, detail: [['GOAL', event.goal], ['INPUT', 'raw user turn'], ['SOURCE', 'RivetService']] }); break
      case 'assistant_delta':
        setMessages(current => { const last = current.at(-1); if (last?.role === 'rivet' && last.live) return [...current.slice(0, -1), { ...last, body: last.body + event.delta }]; return [...current, { id: id('assistant'), role: 'rivet', body: event.delta, live: true }] })
        break
      case 'assistant_reasoning_delta': addActivity({ kind: 'reasoning', body: event.delta, status: 'neutral', detail: [['SURFACE', 'typed summary'], ['STATUS', 'provisional']] }); break
      case 'status': { const label = phaseLabel(event.phase); if (label === 'idle') setRunActive(false); addActivity({ kind: label, body: event.message, status: 'active', detail: [['PHASE', event.phase], ['SOURCE', 'Harness lifecycle']] }); break }
      case 'cognitive_state': addActivity({ kind: 'cognitive state', body: event.focus, status: 'neutral', detail: [['HYPOTHESIS', event.hypothesis ?? 'none recorded'], ['STATUS', event.status], ['EVIDENCE', String(event.evidence_count)], ['COUNTER-SIGNAL', event.counter_signal ?? 'none']] }); setFocusObject({ phase: event.status, title: event.focus, text: [event.hypothesis, event.counter_signal].filter(Boolean).join(' · ') || `Evidence count: ${event.evidence_count}` }); break
      case 'tool_activity': addActivity({ kind: event.capability, body: event.target, status: event.status === 'failed' ? 'alert' : event.status === 'completed' ? 'done' : 'active', authoritative: true, detail: [['ACTION', event.action_id], ['SUMMARY', event.summary], ['STATUS', event.status], ['OUTPUT', event.output_summary ?? 'pending']] }); break
      case 'observation': addActivity({ kind: 'observation', body: event.summary, status: 'neutral', authoritative: true, detail: [['SOURCE', event.source], ['EVIDENCE', event.evidence_id ?? 'not promoted']] }); break
      case 'praxis_update': addActivity({ kind: 'Praxis', body: `${event.obligation_id} · ${event.status.toUpperCase()}`, status: event.status === 'fail' ? 'alert' : event.status === 'pass' ? 'done' : 'active', authoritative: true, detail: [['PREDICATE', event.predicate], ['SCOPE', event.scope], ['RECEIPT', event.receipt_id ?? 'running'], ['DIAGNOSTICS', event.diagnostics ?? 'none']] }); void refreshState(); break
      case 'verification_update': addActivity({ kind: 'Praxis', body: `${event.obligation_id} · ${event.passed ? 'PASS' : 'REQUIRES ATTENTION'}`, status: event.passed ? 'done' : 'alert', authoritative: true, detail: [['RESULT', event.passed ? 'PASS' : 'FAIL'], ['DIAGNOSTICS', event.diagnostics ?? 'none']] }); void refreshState(); break
      case 'hard_state_mutation': addActivity({ kind: 'hard state', body: event.to ? `${event.from ?? 'state'} → ${event.to}` : event.mutation, status: 'done', authoritative: true, detail: [['REVISION', String(event.revision)], ['MUTATION', event.mutation], ['ENTITY', event.entity_id ?? 'state ledger'], ['AUTHORITY', 'Noesis / Harness']] }); void refreshState(); break
      case 'steer_accepted': addActivity({ kind: 'steer', body: event.prompt, status: 'active', detail: [['MODE', 'queued against current run'], ['INPUT', 'raw user turn']] }); break
      case 'authority_prompt': setAuthority({ requestId: event.request_id, capability: event.capability, target: event.target }); break
      case 'cancelled': setRunActive(false); setFocusObject(null); addActivity({ kind: 'cancelled', body: event.message, status: 'alert', authoritative: true, detail: [['RUN', 'cancelled by user']] }); break
      case 'completed': setRunActive(false); setFocusObject(null); setRunSummary(event.summary); setMessages(current => current.map(message => message.live ? { ...message, live: false } : message)); addActivity({ kind: 'receipt', body: event.summary, status: 'done', authoritative: true, detail: [['RUN', 'completed'], ['AUTHORITY', 'RivetService'], ['NEXT', 'inspect state or continue']] }); void refreshState(); void refreshHistory(); break
      case 'error': setRunActive(false); setNotice(event.message); addActivity({ kind: 'error', body: event.message, status: 'alert', detail: [['STATUS', 'run interrupted']] }); break
    }
  }, [addActivity, refreshHistory, refreshState])

  const connect = useCallback(() => {
    setConnection('connecting')
    socket.current = openSocket(receive, next => { setConnection(next); if (next === 'live') { void refreshState(); void refreshProject(); void refreshModels(); void refreshHistory() } })
    socket.current.addEventListener('close', () => { if (reconnect.current === undefined) reconnect.current = window.setTimeout(() => { reconnect.current = undefined; connect() }, 2500) }, { once: true })
  }, [receive, refreshHistory, refreshModels, refreshProject, refreshState])

  useEffect(() => { void Promise.all([refreshState(), refreshProject(), refreshModels(), refreshHistory()]); connect(); return () => { if (reconnect.current) window.clearTimeout(reconnect.current); socket.current?.close() } }, [connect, refreshHistory, refreshModels, refreshProject, refreshState])

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
  const loadCensus = useCallback(async () => { try { setCensus(await getCensus()) } catch (error) { setNotice(error instanceof Error ? error.message : 'Census unavailable') } }, [])
  const loadDiff = useCallback(async () => { try { setDiff(await getDiff()) } catch (error) { setNotice(error instanceof Error ? error.message : 'Diff unavailable') } }, [])

  return { connection, state, project, models, history, census, diff, messages, activities, selected, runActive, notice, authority, focusObject, runSummary, setSelected, setNotice, setAuthority, send, compileGoal, cancel, chooseModel, loadCensus, loadDiff }
}
