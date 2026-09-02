import { create } from 'zustand'
import { toast } from 'sonner'
import {
  abortSession,
  createSession,
  getCensus,
  getClient,
  getDiff,
  getHistory,
  getMcp,
  getModels,
  getProject,
  openEventStream,
  openProject,
  removeAuth,
  saveAuth,
  selectModel,
  sendPrompt,
} from '../api'
import {
  createInitialState,
  parseThoughtAndBody,
  updateHardStateFromTool,
} from '../rivet-adapter'
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
import type { Event, Part } from '@opencode-ai/sdk/v2/client'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const stamp = () => clock.format(new Date())
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export type MotionMode = 'system' | 'full' | 'reduced'
export type RunOutcome = 'running' | 'completed' | 'failed' | 'cancelled'

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
  activeSessionId: string | null
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
  runOutcome: RunOutcome | null
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

let activeEventStream: EventSource | null = null
let reconnectTimeout: number | undefined
let reconnectAttempts = 0
let runStartTime: number | null = null
let rawBuffer = ''
let timerInterval: number | undefined

export const useSessionStore = create<SessionStore>((set, get) => {
  const ensureSessionId = async (): Promise<string> => {
    let currentId = get().activeSessionId
    if (!currentId) {
      const activeModel = get().models?.active_model
      const activeProvider = get().models?.active_provider
      const created = await createSession(
        'Rivet Workspace',
        activeModel && activeProvider ? { id: activeModel, providerID: activeProvider } : undefined,
      )
      currentId = created.id
      set({
        activeSessionId: currentId,
        state: createInitialState(currentId),
      })
      void get().refreshHistory()
    }
    return currentId
  }

  const receiveEvent = (event: Event) => {
    const currentSessionId = get().activeSessionId
    const eventSessionId = 'sessionID' in event.properties ? (event.properties as any).sessionID : undefined

    if (eventSessionId && currentSessionId && eventSessionId !== currentSessionId) {
      return
    }

    switch (event.type) {
      case 'session.created': {
        if (!get().activeSessionId) {
          set({
            activeSessionId: event.properties.sessionID,
            state: createInitialState(event.properties.sessionID),
          })
        }
        void get().refreshHistory()
        break
      }

      case 'session.status': {
        const statusObj = (event.properties as any).status
        const isIdle = statusObj?.type === 'idle'
        if (isIdle && get().runActive) {
          const finalElapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined
          set(state => ({
            runActive: false,
            runOutcome: 'completed',
            messages: state.messages.map(m => (m.live ? { ...m, live: false, elapsedSeconds: finalElapsed ?? m.elapsedSeconds, statusMessage: undefined } : m)),
          }))
          runStartTime = null
          rawBuffer = ''
          void get().refreshHistory()
          void get().loadDiff(false)
        }
        break
      }

      case 'session.next.step.started': {
        set(state => ({
          runActive: true,
          runOutcome: 'running',
          messages: state.messages.map((m, idx) =>
            idx === state.messages.length - 1 && m.role === 'rivet' && m.live
              ? { ...m, statusMessage: 'Synthesizing cognitive step…' }
              : m,
          ),
        }))
        get().addActivity({
          kind: 'step',
          body: 'Step execution started',
          status: 'active',
          authoritative: true,
          detail: [['STATUS', 'running'], ['SOURCE', 'SessionRunner']],
        })
        break
      }

      case 'session.next.text.delta': {
        const delta = (event.properties as any).delta ?? ''
        rawBuffer += delta
        const { reasoning, body } = parseThoughtAndBody(rawBuffer)
        const elapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined

        set(state => ({
          messages: state.messages.map((m, idx) => {
            if (idx === state.messages.length - 1 && m.role === 'rivet' && m.live) {
              return {
                ...m,
                body,
                reasoning: reasoning || m.reasoning,
                elapsedSeconds: elapsed,
                statusMessage: undefined,
              }
            }
            return m
          }),
        }))
        break
      }

      case 'session.next.reasoning.delta': {
        const delta = (event.properties as any).delta ?? ''
        const elapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined

        set(state => ({
          messages: state.messages.map((m, idx) => {
            if (idx === state.messages.length - 1 && m.role === 'rivet' && m.live) {
              return {
                ...m,
                reasoning: (m.reasoning || '') + delta,
                elapsedSeconds: elapsed,
                statusMessage: 'Reasoning…',
              }
            }
            return m
          }),
        }))
        break
      }

      case 'session.next.tool.called': {
        const tool = (event.properties as any).tool ?? 'tool'
        const input = (event.properties as any).input ?? {}
        const target = (input.path ?? input.command ?? input.proposition ?? input.obligation_id ?? tool) as string

        set(state => ({
          messages: state.messages.map((m, idx) => {
            if (idx === state.messages.length - 1 && m.role === 'rivet' && m.live) {
              return { ...m, statusMessage: `Tool: ${tool} → ${target}` }
            }
            return m
          }),
        }))

        get().addActivity({
          kind: tool,
          body: String(target),
          status: 'active',
          authoritative: true,
          detail: [
            ['TOOL', tool],
            ['CALL_ID', String((event.properties as any).callID ?? '')],
            ['INPUT', JSON.stringify(input).slice(0, 100)],
          ],
        })
        break
      }

      case 'session.next.tool.success': {
        const tool = (event.properties as any).tool ?? 'tool'
        const callID = (event.properties as any).callID
        const result = (event.properties as any).result
        const structured = (event.properties as any).structured ?? {}

        const currentState = get().state ?? createInitialState(get().activeSessionId ?? '')
        const { next: nextHardState, mutated } = updateHardStateFromTool(currentState.hard_state, tool, {
          status: 'completed',
          input: structured,
          metadata: structured,
          output: result,
        })

        if (mutated) {
          set({
            state: {
              ...currentState,
              hard_state: nextHardState,
              revision: nextHardState.revision,
            },
          })
        }

        get().addActivity({
          kind: tool,
          body: `Completed: ${tool}`,
          status: 'done',
          authoritative: true,
          detail: [
            ['STATUS', 'success'],
            ['OUTPUT', JSON.stringify(result ?? structured).slice(0, 120)],
          ],
        })
        break
      }

      case 'session.next.tool.failed': {
        const tool = (event.properties as any).tool ?? 'tool'
        get().addActivity({
          kind: tool,
          body: `Failed: ${tool}`,
          status: 'alert',
          authoritative: true,
          detail: [['STATUS', 'failed']],
        })
        break
      }

      case 'message.part.delta': {
        const delta = (event.properties as any).delta
        if (typeof delta === 'string') {
          rawBuffer += delta
          const { reasoning, body } = parseThoughtAndBody(rawBuffer)
          const elapsed = runStartTime ? Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10) : undefined

          set(state => ({
            messages: state.messages.map((m, idx) => {
              if (idx === state.messages.length - 1 && m.role === 'rivet' && m.live) {
                return {
                  ...m,
                  body,
                  reasoning: reasoning || m.reasoning,
                  elapsedSeconds: elapsed,
                  statusMessage: undefined,
                }
              }
              return m
            }),
          }))
        }
        break
      }

      case 'message.part.updated': {
        const part = (event.properties as any).part as Part
        if (part && part.type === 'tool') {
          const currentState = get().state ?? createInitialState(get().activeSessionId ?? '')
          const { next: nextHardState, mutated } = updateHardStateFromTool(
            currentState.hard_state,
            part.tool,
            part.state as any,
          )
          if (mutated) {
            set({
              state: {
                ...currentState,
                hard_state: nextHardState,
                revision: nextHardState.revision,
              },
            })
          }
        }
        break
      }

      case 'permission.v2.asked': {
        const props = event.properties as any
        set({
          authority: {
            requestId: props.id,
            capability: props.permission ?? 'permission',
            target: props.target ?? props.pattern ?? 'action',
          },
        })
        break
      }

      case 'permission.v2.replied': {
        set({ authority: null })
        break
      }
    }
  }

  const establishEventStream = () => {
    if (activeEventStream) {
      activeEventStream.close()
      activeEventStream = null
    }

    if (reconnectTimeout !== undefined) {
      window.clearTimeout(reconnectTimeout)
      reconnectTimeout = undefined
    }

    set({ connection: 'connecting' })

    const stream = openEventStream(
      receiveEvent,
      nextState => {
        set({ connection: nextState })
        if (nextState === 'live') {
          reconnectAttempts = 0
          void get().refreshProject()
          void get().refreshModels()
          void get().refreshHistory()
          void get().loadMcp()
          void get().loadCensus(false)
          void get().loadDiff(false)
        }
      },
    )

    activeEventStream = stream

    stream.onerror = () => {
      set({ connection: 'offline' })
      if (reconnectTimeout === undefined) {
        const delay = Math.min(10000, 1500 * Math.pow(1.5, reconnectAttempts) + Math.random() * 500)
        reconnectAttempts++
        reconnectTimeout = window.setTimeout(() => {
          reconnectTimeout = undefined
          establishEventStream()
        }, delay)
      }
    }
  }

  return {
    activeSessionId: null,
    connection: 'connecting',
    state: createInitialState(),
    project: null,
    models: null,
    history: [],
    census: null,
    diff: null,
    messages: [
      {
        id: 'welcome',
        role: 'rivet',
        body: 'Rivet is ready. Give me a bounded outcome and I’ll maintain the acceptance boundary as the run unfolds.',
      },
    ],
    activities: [],
    selected: null,
    runActive: false,
    runOutcome: null,
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
      const next: Activity = { ...activity, id: id('event'), timestamp: stamp() }
      set(current => ({
        activities: [
          ...current.activities.map(item => (item.status === 'active' ? { ...item, status: 'done' as const } : item)),
          next,
        ],
        selected: next,
      }))
    },

    initSession: () => {
      void (async () => {
        await Promise.all([
          get().refreshProject(),
          get().refreshModels(),
          get().refreshHistory(),
          get().loadMcp(),
          get().loadCensus(false),
          get().loadDiff(false),
        ])

        const history = get().history
        if (history.length > 0 && !get().activeSessionId) {
          const first = history[0]
          set({
            activeSessionId: first.id,
            state: createInitialState(first.id),
          })
        }
      })()

      establishEventStream()

      timerInterval = window.setInterval(() => {
        if (!runStartTime) return
        const elapsed = Math.max(0.1, Math.round((Date.now() - runStartTime) / 100) / 10)
        set(state => {
          if (!state.runActive) return state
          const last = state.messages.at(-1)
          if (last?.role === 'rivet' && last.live) {
            return {
              messages: [...state.messages.slice(0, -1), { ...last, elapsedSeconds: elapsed }],
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
        if (activeEventStream) {
          activeEventStream.close()
          activeEventStream = null
        }
      }
    },

    refreshState: async () => {
      // state is updated reactively via events
    },

    refreshProject: async () => {
      try {
        const project = await getProject()
        set({ project })
      } catch {
        /* keep current */
      }
    },

    refreshModels: async () => {
      try {
        const models = await getModels()
        set({ models })
      } catch {
        /* keep current */
      }
    },

    refreshHistory: async () => {
      try {
        const history = await getHistory()
        set({ history })
      } catch {
        /* keep current */
      }
    },

    loadMcp: async () => {
      try {
        const mcpServers = await getMcp()
        set({ mcpServers })
      } catch {
        /* keep current */
      }
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
      const sessionId = await ensureSessionId()

      set(current => ({
        messages: [
          ...current.messages,
          { id: id('user'), role: 'you', body: prompt, attachments: attachments.map(f => f.name) },
          {
            id: id('assistant'),
            role: 'rivet',
            body: '',
            live: true,
            statusMessage: 'Connecting & executing prompt…',
            livePhase: 'preparing_view',
          },
        ],
        runActive: true,
        runOutcome: 'running',
      }))

      runStartTime = Date.now()
      rawBuffer = ''

      try {
        const activeModel = get().models?.active_model
        const activeProvider = get().models?.active_provider
        await sendPrompt(
          sessionId,
          prompt,
          attachments,
          activeModel && activeProvider ? { id: activeModel, providerID: activeProvider } : undefined,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Prompt execution failed'
        const lastMessage = get().messages.at(-1)
        if (lastMessage?.role === 'rivet' && lastMessage.live) {
          set(current => ({
            runActive: false,
            runOutcome: 'failed',
            messages: current.messages.map((item, index) =>
              index === current.messages.length - 1 && item.role === 'rivet' && item.live
                ? { ...item, body: message, live: false, statusMessage: undefined }
                : item,
            ),
          }))
          get().addActivity({ kind: 'error', body: message, status: 'alert', detail: [['STATUS', 'request failed']] })
        } else {
          set({ runActive: false, runOutcome: 'failed' })
        }
        toast.error(message)
      }
    },

    compileGoal: async (displayPrompt, compilerPrompt = displayPrompt) => {
      if (!displayPrompt.trim()) return
      const sessionId = await ensureSessionId()

      set(current => ({
        messages: [
          ...current.messages,
          { id: id('user'), role: 'you', body: displayPrompt },
          {
            id: id('assistant'),
            role: 'rivet',
            body: '',
            live: true,
            statusMessage: 'Compiling GoalSpec & obligations…',
            livePhase: 'preparing_view',
          },
        ],
        runActive: true,
        runOutcome: 'running',
      }))

      runStartTime = Date.now()
      rawBuffer = ''

      try {
        const goalPrompt = `/goal ${compilerPrompt}`
        const activeModel = get().models?.active_model
        const activeProvider = get().models?.active_provider
        await sendPrompt(
          sessionId,
          goalPrompt,
          [],
          activeModel && activeProvider ? { id: activeModel, providerID: activeProvider } : undefined,
        )
        get().addActivity({
          kind: 'goal compiled',
          body: displayPrompt,
          status: 'done',
          authoritative: true,
          detail: [
            ['GOAL', displayPrompt],
            ['STATUS', 'admitted to session'],
          ],
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Goal compilation failed'
        const lastMessage = get().messages.at(-1)
        if (lastMessage?.role === 'rivet' && lastMessage.live) {
          set(current => ({
            runActive: false,
            runOutcome: 'failed',
            messages: current.messages.map((item, index) =>
              index === current.messages.length - 1 && item.role === 'rivet' && item.live
                ? { ...item, body: message, live: false, statusMessage: undefined }
                : item,
            ),
          }))
          get().addActivity({ kind: 'error', body: message, status: 'alert', detail: [['STATUS', 'failed']] })
        } else {
          set({ runActive: false, runOutcome: 'failed' })
        }
        toast.error(message)
      }
    },

    cancel: async () => {
      const sessionId = get().activeSessionId
      if (sessionId) {
        try {
          await abortSession(sessionId)
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Cancellation failed')
        }
      }
      set(current => ({
        runActive: false,
        runOutcome: 'cancelled',
        messages: current.messages.map(message =>
          message.live
            ? { ...message, live: false, statusMessage: undefined, body: message.body || 'Cancelled by user' }
            : message,
        ),
      }))
    },

    chooseModel: async (provider, model) => {
      try {
        const updated = await selectModel(provider, model)
        set({ models: updated })
        get().addActivity({
          kind: 'model',
          body: `${provider} · ${model}`,
          status: 'done',
          detail: [
            ['PROVIDER', provider],
            ['MODEL', model],
          ],
        })
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
        set({
          project: proj,
          activeSessionId: null,
          state: createInitialState(),
        })
        void get().refreshHistory()
        void get().loadMcp()
        void get().loadCensus(false)
        void get().loadDiff(false)
        toast.success(`Switched to project: ${proj.name}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to open project')
      }
    },
  }
})
