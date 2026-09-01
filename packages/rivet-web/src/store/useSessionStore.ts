import { create } from 'zustand'
import { toast } from 'sonner'
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
} from '../api'
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
} from '../types'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const stamp = () => clock.format(new Date())
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const phaseLabel = (phase: string) => phase.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase()

export function parseThoughtAndBody(raw: string): { reasoning?: string; body: string } {
  if (!raw.includes('<think>')) {
    return { body: raw }
  }
  const thoughts: string[] = []
  let body = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_, thought) => {
    if (thought.trim()) thoughts.push(thought.trim())
    return ''
  })
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

export type MotionMode = 'system' | 'full' | 'reduced'

function applyMotionMode(mode: MotionMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.motion = mode
  }
}

const initialMotionMode: MotionMode = (() => {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('rivet:motion_mode')
    if (saved === 'system' || saved === 'full' || saved === 'reduced') {
      return saved
    }
  }
  return 'system'
})()
applyMotionMode(initialMotionMode)

interface SessionStore {
  connection: ConnectionState
  state: State | null
  project: Project | null
  models: ModelCatalog | null
  history: HistoryEntry[]
  census: Census | null
  diff: Diff | null
  messages: Message[]
  activities: Activity[]
  selected: Activity | null
  runActive: boolean
  authority: { requestId: string; capability: string; target: string } | null
  focusObject: { phase: string; title: string; text: string } | null
  runSummary: string | null
  mcpServers: McpServerInfo[]
  motionMode: MotionMode

  setMotionMode: (mode: MotionMode) => void
  setSelected: (activity: Activity | null) => void
  setAuthority: (authority: { requestId: string; capability: string; target: string } | null) => void
  addActivity: (activity: Omit<Activity, 'id' | 'timestamp'>) => void

  initSession: () => () => void
  refreshState: () => Promise<void>
  refreshProject: () => Promise<void>
  refreshModels: () => Promise<void>
  refreshHistory: () => Promise<void>
  loadMcp: () => Promise<void>
  loadCensus: (notify?: boolean) => Promise<void>
  loadDiff: (notify?: boolean) => Promise<void>

  send: (prompt: string, attachments: Attachment[]) => Promise<void>
  compileGoal: (displayPrompt: string, compilerPrompt?: string) => Promise<void>
  cancel: () => Promise<void>
  chooseModel: (provider: string, model: string) => Promise<void>
  saveCredentials: (payload: SaveAuthPayload) => Promise<void>
  removeCredentials: (provider: string) => Promise<void>
  switchProject: (path: string) => Promise<void>
}

let activeSocket: WebSocket | null = null
let reconnectTimeout: number | undefined
let reconnectAttempts = 0
let runStartTime: number | null = null
let rawBuffer = ''
let activeRunId: string | null = null
let activeTurn = 0
let timerInterval: number | undefined

export const useSessionStore = create<SessionStore>((set, get) => {
  const receiveEvent = (event: UiEvent) => {
    if (event.type !== 'run_started' && event.run_id && event.run_id !== activeRunId) {
      return
    }
    switch (event.type) {
      case 'run_started': {
        activeRunId = event.run_id ?? null
        activeTurn = 0
        runStartTime = Date.now()
        rawBuffer = ''
        set(state => ({
          runActive: true,
          runSummary: null,
          messages: (() => {
            const last = state.messages.at(-1)
            if (last?.role === 'rivet' && last.live) {
              return [...state.messages.slice(0, -1), { ...last, statusMessage: 'Compiling cognitive view…', livePhase: 'preparing_view' }]
            }
            return [...state.messages, { id: id('assistant'), role: 'rivet', body: '', live: true, statusMessage: 'Compiling cognitive view…', livePhase: 'preparing_view' }]
          })()
        }))
        get().addActivity({ kind: 'request', body: event.prompt, status: 'active', authoritative: true, detail: [['GOAL', event.goal], ['INPUT', 'raw user turn'], ['SOURCE', 'RivetService']] })
        break
      }
      case 'assistant_turn_started': {
        if (event.turn && event.turn <= activeTurn) break
        activeTurn = event.turn ?? activeTurn + 1
        rawBuffer = ''
        set(state => ({
          messages: state.messages.map((message, index) => {
            if (index === state.messages.length - 1 && message.role === 'rivet' && message.live) {
              return { ...message, body: '', reasoning: undefined, statusMessage: `Model turn ${activeTurn}…` }
            }
            return message
          })
        }))
        break
      }
      case 'assistant_reasoning_delta': {
        if (event.turn && event.turn !== activeTurn) break
        const elapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined
        set(state => ({
          messages: state.messages.map((m, idx) => {
            if (idx === state.messages.length - 1 && m.role === 'rivet' && m.live) {
              return { ...m, reasoning: (m.reasoning || '') + event.delta, elapsedSeconds: elapsed, statusMessage: 'Reasoning…' }
            }
            return m
          })
        }))
        break
      }
      case 'assistant_delta': {
        if (event.turn && event.turn !== activeTurn) break
        rawBuffer += event.delta
        const { reasoning, body } = parseThoughtAndBody(rawBuffer)
        const elapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined
        set(state => ({
          messages: state.messages.map((m, idx) => {
            if (idx === state.messages.length - 1 && m.role === 'rivet' && m.live) {
              return { ...m, body, reasoning: reasoning || m.reasoning, elapsedSeconds: elapsed, statusMessage: undefined }
            }
            return m
          })
        }))
        break
      }
      case 'status': {
        const label = phaseLabel(event.phase)
        set(state => ({
          messages: state.messages.map((message, index) => {
            if (index === state.messages.length - 1 && message.role === 'rivet' && message.live) {
              return {
                ...message,
                statusMessage: label === 'idle' ? 'Finalizing response…' : event.message,
                livePhase: event.phase,
              }
            }
            return message
          })
        }))
        get().addActivity({ kind: label, body: event.message, status: label === 'idle' ? 'done' : 'active', detail: [['PHASE', event.phase], ['SOURCE', 'Harness lifecycle']] })
        break
      }
      case 'cognitive_state': {
        set(state => ({
          messages: state.messages.map((m, idx) => {
            if (idx === state.messages.length - 1 && m.role === 'rivet' && m.live) {
              return { ...m, statusMessage: `Cognition: ${event.focus}` }
            }
            return m
          }),
          focusObject: { phase: event.status, title: event.focus, text: [event.hypothesis, event.counter_signal].filter(Boolean).join(' · ') || `Evidence count: ${event.evidence_count}` }
        }))
        get().addActivity({ kind: 'cognitive state', body: event.focus, status: 'neutral', detail: [['HYPOTHESIS', event.hypothesis ?? 'none recorded'], ['STATUS', event.status], ['EVIDENCE', String(event.evidence_count)], ['COUNTER-SIGNAL', event.counter_signal ?? 'none']] })
        break
      }
      case 'tool_activity': {
        set(state => ({
          messages: state.messages.map((m, idx) => {
            if (idx === state.messages.length - 1 && m.role === 'rivet' && m.live) {
              return { ...m, statusMessage: `Tool: ${event.capability} → ${event.target}` }
            }
            return m
          })
        }))
        get().addActivity({ kind: event.capability, body: event.target, status: event.status === 'failed' ? 'alert' : event.status === 'completed' ? 'done' : 'active', authoritative: true, detail: [['ACTION', event.action_id], ['SUMMARY', event.summary], ['STATUS', event.status], ['OUTPUT', event.output_summary ?? 'pending']] })
        break
      }
      case 'observation': {
        get().addActivity({ kind: 'observation', body: event.summary, status: 'neutral', authoritative: true, detail: [['SOURCE', event.source], ['EVIDENCE', event.evidence_id ?? 'not promoted']] })
        break
      }
      case 'praxis_update': {
        set(state => ({
          messages: state.messages.map((m, idx) => {
            if (idx === state.messages.length - 1 && m.role === 'rivet' && m.live) {
              return { ...m, statusMessage: `Praxis verification: ${event.obligation_id}` }
            }
            return m
          })
        }))
        get().addActivity({ kind: 'Praxis', body: `${event.obligation_id} · ${event.status.toUpperCase()}`, status: event.status === 'fail' ? 'alert' : event.status === 'pass' ? 'done' : 'active', authoritative: true, detail: [['PREDICATE', event.predicate], ['SCOPE', event.scope], ['RECEIPT', event.receipt_id ?? 'running'], ['DIAGNOSTICS', event.diagnostics ?? 'none']] })
        void get().refreshState()
        break
      }
      case 'verification_update': {
        get().addActivity({ kind: 'Praxis', body: `${event.obligation_id} · ${event.passed ? 'PASS' : 'REQUIRES ATTENTION'}`, status: event.passed ? 'done' : 'alert', authoritative: true, detail: [['RESULT', event.passed ? 'PASS' : 'FAIL'], ['DIAGNOSTICS', event.diagnostics ?? 'none']] })
        void get().refreshState()
        break
      }
      case 'hard_state_mutation': {
        get().addActivity({ kind: 'hard state', body: event.to ? `${event.from ?? 'state'} → ${event.to}` : event.mutation, status: 'done', authoritative: true, detail: [['REVISION', String(event.revision)], ['MUTATION', event.mutation], ['ENTITY', event.entity_id ?? 'state ledger'], ['AUTHORITY', 'Noesis / Harness']] })
        void get().refreshState()
        break
      }
      case 'steer_accepted': {
        get().addActivity({ kind: 'steer', body: event.prompt, status: 'active', detail: [['MODE', 'queued against current run'], ['INPUT', 'raw user turn']] })
        break
      }
      case 'authority_prompt': {
        set({ authority: { requestId: event.request_id, capability: event.capability, target: event.target } })
        break
      }
      case 'cancelled': {
        const finalElapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined
        set(state => ({
          runActive: false,
          focusObject: null,
          messages: state.messages.map(m => m.live ? { ...m, live: false, elapsedSeconds: finalElapsed ?? m.elapsedSeconds, statusMessage: undefined } : m)
        }))
        get().addActivity({ kind: 'cancelled', body: event.message, status: 'alert', authoritative: true, detail: [['RUN', 'cancelled by user']] })
        runStartTime = null
        rawBuffer = ''
        activeRunId = null
        activeTurn = 0
        break
      }
      case 'completed': {
        const finalElapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined
        set(state => ({
          runActive: false,
          focusObject: null,
          runSummary: event.summary,
          messages: state.messages.map((message, index) => index === state.messages.length - 1 && message.role === 'rivet'
            ? { ...message, body: event.summary, live: false, elapsedSeconds: finalElapsed ?? message.elapsedSeconds, statusMessage: undefined, livePhase: event.phase }
            : message)
        }))
        get().addActivity({ kind: 'receipt', body: event.summary, status: 'done', authoritative: true, detail: [['RUN', phaseLabel(event.phase)], ['AUTHORITY', 'RivetService'], ['NEXT', 'inspect state or continue']] })
        runStartTime = null
        rawBuffer = ''
        activeRunId = null
        activeTurn = 0
        void get().refreshState()
        void get().refreshHistory()
        break
      }
      case 'error': {
        const finalElapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined
        set(state => ({
          runActive: false,
          messages: state.messages.map(m => m.live ? { ...m, live: false, elapsedSeconds: finalElapsed ?? m.elapsedSeconds, statusMessage: undefined } : m)
        }))
        get().addActivity({ kind: 'error', body: event.message, status: 'alert', detail: [['STATUS', 'run interrupted']] })
        runStartTime = null
        rawBuffer = ''
        activeRunId = null
        activeTurn = 0
        break
      }
    }
  }

  const establishSocket = () => {
    // If socket is already OPEN or CONNECTING, do not create another one!
    if (activeSocket && (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING)) {
      return
    }

    if (reconnectTimeout !== undefined) {
      window.clearTimeout(reconnectTimeout)
      reconnectTimeout = undefined
    }

    if (activeSocket) {
      activeSocket.onopen = null
      activeSocket.onclose = null
      activeSocket.onerror = null
      activeSocket.onmessage = null
      try { activeSocket.close() } catch { /* ignore */ }
      activeSocket = null
    }

    set({ connection: 'connecting' })
    const socket = openSocket(
      receiveEvent,
      nextState => {
        set({ connection: nextState })
        if (nextState === 'live') {
          reconnectAttempts = 0
          void get().refreshState()
          void get().refreshProject()
          void get().refreshModels()
          void get().refreshHistory()
          void get().loadMcp()
          void get().loadCensus(false)
          void get().loadDiff(false)
        }
      }
    )
    activeSocket = socket

    socket.addEventListener('close', () => {
      if (activeSocket === socket) {
        activeSocket = null
        if (reconnectTimeout === undefined) {
          const delay = Math.min(10000, 1500 * Math.pow(1.5, reconnectAttempts) + Math.random() * 500)
          reconnectAttempts++
          reconnectTimeout = window.setTimeout(() => {
            reconnectTimeout = undefined
            establishSocket()
          }, delay)
        }
      }
    }, { once: true })
  }

  return {
    connection: 'connecting',
    state: null,
    project: null,
    models: null,
    history: [],
    census: null,
    diff: null,
    messages: [{ id: 'welcome', role: 'rivet', body: 'Rivet is ready. Give me a bounded outcome and I’ll maintain the acceptance boundary as the run unfolds.' }],
    activities: [],
    selected: null,
    runActive: false,
    authority: null,
    focusObject: null,
    runSummary: null,
    mcpServers: [],
    motionMode: initialMotionMode,

    setMotionMode: (mode: MotionMode) => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rivet:motion_mode', mode)
      }
      applyMotionMode(mode)
      set({ motionMode: mode })
    },

    setSelected: activity => set({ selected: activity }),
    setAuthority: authority => set({ authority }),

    addActivity: activity => {
      const next = { ...activity, id: id('event'), timestamp: stamp() }
      set(current => ({
        activities: [...current.activities.map(item => item.status === 'active' ? { ...item, status: 'done' as const } : item), next],
        selected: next
      }))
    },

    initSession: () => {
      void Promise.all([
        get().refreshState(),
        get().refreshProject(),
        get().refreshModels(),
        get().refreshHistory(),
        get().loadMcp(),
        get().loadCensus(false),
        get().loadDiff(false),
      ])

      establishSocket()

      timerInterval = window.setInterval(() => {
        if (!runStartTime) return
        const elapsed = Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10)
        set(state => {
          if (!state.runActive) return state
          const last = state.messages.at(-1)
          if (last?.role === 'rivet' && last.live) {
            return {
              messages: [...state.messages.slice(0, -1), { ...last, elapsedSeconds: elapsed }]
            }
          }
          return state
        })
      }, 100)

      return () => {
        if (timerInterval) {
          window.clearInterval(timerInterval)
          timerInterval = undefined
        }
        if (reconnectTimeout) {
          window.clearTimeout(reconnectTimeout)
          reconnectTimeout = undefined
        }
        if (activeSocket) {
          activeSocket.onopen = null
          activeSocket.onclose = null
          activeSocket.onerror = null
          activeSocket.onmessage = null
          try { activeSocket.close() } catch { /* ignore */ }
          activeSocket = null
        }
      }
    },

    refreshState: async () => {
      try { set({ state: await getState() }) } catch { /* keep authoritative */ }
    },
    refreshProject: async () => {
      try { set({ project: await getProject() }) } catch { /* keep current */ }
    },
    refreshModels: async () => {
      try { set({ models: await getModels() }) } catch { /* keep current */ }
    },
    refreshHistory: async () => {
      try { set({ history: await getHistory() }) } catch { /* keep current */ }
    },
    loadMcp: async () => {
      try { set({ mcpServers: await getMcp() }) } catch { /* MCP optional */ }
    },
    loadCensus: async (notify = true) => {
      try {
        const census = await getCensus()
        set({ census })
        if (notify) toast.success(`Census refreshed (${census.total_files} files)`)
      } catch (error) {
        if (notify) toast.error(error instanceof Error ? error.message : 'Census unavailable')
      }
    },
    loadDiff: async (notify = false) => {
      try {
        const diff = await getDiff()
        set({ diff })
      } catch (error) {
        if (notify) toast.error(error instanceof Error ? error.message : 'Diff unavailable')
      }
    },

    send: async (prompt, attachments) => {
      if (!prompt.trim()) return
      const state = get()
      set(current => ({
        messages: [
          ...current.messages,
          { id: id('user'), role: 'you', body: prompt, attachments: attachments.map(f => f.name) },
          { id: id('assistant'), role: 'rivet', body: '', live: true, statusMessage: 'Connecting & preparing cognitive view…', livePhase: 'preparing_view' }
        ],
        runActive: true
      }))
      runStartTime = Date.now()
      rawBuffer = ''
      try {
        const response = await postRun(prompt, state.state?.task_id, attachments, state.runActive, activeSocket)
        if (response) {
          const finalElapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined
          set(current => ({
            runActive: false,
            runSummary: response.text,
            messages: current.messages.map((message, index) => index === current.messages.length - 1 && message.role === 'rivet'
              ? { ...message, body: response.text, live: false, statusMessage: undefined, livePhase: response.phase, elapsedSeconds: finalElapsed }
              : message)
          }))
          runStartTime = null
          rawBuffer = ''
          activeRunId = null
          activeTurn = 0
          void get().refreshState()
          void get().refreshHistory()
        }
      } catch (error) {
        set({ runActive: false })
        toast.error(error instanceof Error ? error.message : 'RivetService is unavailable')
      }
    },

    compileGoal: async (displayPrompt, compilerPrompt = displayPrompt) => {
      if (!displayPrompt.trim()) return
      set(current => ({
        messages: [
          ...current.messages,
          { id: id('user'), role: 'you', body: displayPrompt },
          { id: id('assistant'), role: 'rivet', body: '', live: true, statusMessage: 'Compiling GoalSpec & obligations…', livePhase: 'preparing_view' }
        ],
        runActive: true
      }))
      runStartTime = Date.now()
      rawBuffer = ''
      try {
        await postGoal(compilerPrompt, activeSocket)
      } catch (error) {
        set({ runActive: false })
        toast.error(error instanceof Error ? error.message : 'Goal compiler unavailable')
      }
    },

    cancel: async () => {
      try {
        await cancelRun(activeSocket)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Cancellation failed')
      }
      set({ runActive: false })
    },

    chooseModel: async (provider, model) => {
      try {
        const updated = await selectModel(provider, model)
        set({ models: updated })
        get().addActivity({ kind: 'model', body: `${provider} · ${model}`, status: 'done', detail: [['SOURCE', 'Rivet provider registry'], ['ACTIVE', 'yes']] })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Model selection failed')
      }
    },

    saveCredentials: async payload => {
      try {
        const updated = await saveAuth(payload)
        set({ models: updated })
        toast.success(`Saved credentials for ${payload.provider}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save credentials')
      }
    },

    removeCredentials: async provider => {
      try {
        const updated = await removeAuth(provider)
        set({ models: updated })
        toast.success(`Removed credentials for ${provider}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to remove credentials')
      }
    },

    switchProject: async path => {
      try {
        const proj = await openProject(path)
        set({ project: proj })
        void get().refreshState()
        void get().refreshHistory()
        void get().loadMcp()
        void get().loadCensus(false)
        void get().loadDiff(false)
        toast.success(`Switched to project: ${proj.name}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to open project')
      }
    }
  }
})
