import type {
  Message,
  UserMessage,
  AssistantMessage,
  TextPart,
  ReasoningPart,
  ToolPart,
  ToolState,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  SnapshotFileDiff,
  ConsoleState,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, createEffect, onMount } from "solid-js"
import path from "path"
import { useKV } from "./kv"
import { usePermission } from "./permission"

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

function search<T>(items: T[], target: string, key: (item: T) => string) {
  let left = 0
  let right = items.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const value = key(items[middle])
    if (value === target) return { found: true, index: middle }
    if (value < target) left = middle + 1
    else right = middle - 1
  }
  return { found: false, index: left }
}

function compareMessage(a: Message, b: Message) {
  return a.time.created - b.time.created || a.id.localeCompare(b.id)
}

function toMillis(t: unknown): number {
  if (typeof t === "number") return t
  if (typeof t === "string") {
    const parsed = Date.parse(t)
    return Number.isFinite(parsed) ? parsed : Date.now()
  }
  return Date.now()
}

const messageKey = (message: Message) => message.time.created + message.id

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: () => {
    const startup = useTuiStartup()
    const kv = useKV()
    const permission = usePermission()
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      capabilities: {
        experimentalBackgroundSubagents: boolean
      }
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: SnapshotFileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      capabilities: {
        experimentalBackgroundSubagents: false,
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    const fullSyncedSessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()
    const hydratingSessions = new Map<string, { messages: Set<string>; parts: Set<string> }>()
    const touchMessage = (sessionID: string, messageID: string) => {
      hydratingSessions.get(sessionID)?.messages.add(messageID)
    }
    const touchPart = (sessionID: string, partID: string) => {
      hydratingSessions.get(sessionID)?.parts.add(partID)
    }

    const trimMessages = (sessionID: string) => {
      const updated = store.message[sessionID]
      if (updated && updated.length > 100) {
        const oldest = updated[0]
        batch(() => {
          setStore(
            "message",
            sessionID,
            produce((draft) => {
              draft.shift()
            }),
          )
          setStore(
            "part",
            produce((draft) => {
              delete draft[oldest.id]
            }),
          )
        })
      }
    }

    const putMessage = (sessionID: string, msg: Message) => {
      touchMessage(sessionID, msg.id)
      const messages = store.message[sessionID]
      if (!messages) {
        setStore("message", sessionID, [msg])
        return
      }
      const result = search(messages, messageKey(msg), messageKey)
      if (result.found) {
        setStore("message", sessionID, result.index, reconcile(msg))
        return
      }
      setStore(
        "message",
        sessionID,
        produce((draft) => {
          draft.splice(result.index, 0, msg)
        }),
      )
      trimMessages(sessionID)
    }

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions() {
      return sdk.client.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    event.subscribe((event, { directory, workspace }) => {
      switch (event.type) {
        case "server.instance.disposed":
          void bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          if (permission.mode === "auto") {
            void sdk.client.permission.reply({
              requestID: request.id,
              reply: "once",
              directory,
              workspace,
            })
            break
          }
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.v2.replied":
        case "question.replied":
        case "question.v2.rejected":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.v2.asked":
        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.next.moved": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.directory = event.properties.location.directory
              session.path = event.properties.subdirectory
              session.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
          break
        }

        case "session.next.agent.switched": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.agent = event.properties.agent
              session.time.updated = toMillis(event.properties.timestamp)
            }),
          )
          break
        }

        case "session.next.model.switched": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.model = event.properties.model
              session.time.updated = toMillis(event.properties.timestamp)
            }),
          )
          break
        }

        case "session.next.prompted": {
          const { sessionID, messageID, prompt, timestamp } = event.properties
          const timeCreated = toMillis(timestamp)
          const userMsg: UserMessage = {
            id: messageID,
            sessionID,
            role: "user",
            time: { created: timeCreated },
            agent: prompt.agents?.[0]?.name ?? "build",
            model: { providerID: "", modelID: "" },
          }
          putMessage(sessionID, userMsg)
          const parts: Part[] = []
          if (prompt.text) {
            parts.push({
              id: `${messageID}_text`,
              sessionID,
              messageID,
              type: "text",
              text: prompt.text,
              time: { start: timeCreated, end: timeCreated },
            })
          }
          if (prompt.files) {
            for (let i = 0; i < prompt.files.length; i++) {
              const file = prompt.files[i]
              parts.push({
                id: `${messageID}_file_${i}`,
                sessionID,
                messageID,
                type: "file",
                mime: file.mime ?? "application/octet-stream",
                url: file.uri,
                filename: file.name,
              })
            }
          }
          if (parts.length > 0) {
            setStore("part", messageID, parts)
          }
          setStore("session_status", sessionID, { type: "busy" })
          break
        }

        case "session.next.step.started": {
          const { sessionID, assistantMessageID, agent, model, timestamp } = event.properties
          const timeCreated = toMillis(timestamp)
          const messages = store.message[sessionID] ?? []
          const existing = messages.find((m) => m.id === assistantMessageID)
          if (!existing) {
            const lastUser = messages.findLast((m) => m.role === "user")
            const assistantMsg: AssistantMessage = {
              id: assistantMessageID,
              sessionID,
              role: "assistant",
              parentID: lastUser?.id ?? "",
              modelID: typeof model === "object" ? model.id : String(model ?? ""),
              providerID: typeof model === "object" ? model.providerID : "",
              mode: agent,
              agent,
              path: {
                cwd: project.data.instance.path.directory ?? "",
                root: project.data.instance.path.worktree ?? project.data.instance.path.directory ?? "",
              },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: timeCreated },
            }
            putMessage(sessionID, assistantMsg)
          }
          if (!store.part[assistantMessageID]) {
            setStore("part", assistantMessageID, [])
          }
          setStore("session_status", sessionID, { type: "busy" })
          break
        }

        case "session.next.step.ended": {
          const { sessionID, assistantMessageID, finish, cost, tokens, timestamp } = event.properties
          touchMessage(sessionID, assistantMessageID)
          const timeCompleted = toMillis(timestamp)
          const messages = store.message[sessionID]
          if (messages) {
            const index = messages.findIndex((m) => m.id === assistantMessageID)
            if (index !== -1) {
              setStore(
                "message",
                sessionID,
                index,
                produce((draft) => {
                  const assistant = draft as AssistantMessage
                  assistant.time = { ...assistant.time, completed: timeCompleted }
                  assistant.finish = finish
                  assistant.cost = cost
                  assistant.tokens = tokens
                }),
              )
            }
          }
          setStore("session_status", sessionID, { type: "idle" })
          break
        }

        case "session.next.step.failed": {
          const { sessionID, assistantMessageID, error, timestamp } = event.properties
          touchMessage(sessionID, assistantMessageID)
          const timeCompleted = toMillis(timestamp)
          const messages = store.message[sessionID]
          if (messages) {
            const index = messages.findIndex((m) => m.id === assistantMessageID)
            if (index !== -1) {
              setStore(
                "message",
                sessionID,
                index,
                produce((draft) => {
                  const assistant = draft as AssistantMessage
                  assistant.time = { ...assistant.time, completed: timeCompleted }
                  assistant.finish = "error"
                  const errMessage =
                    typeof error === "string"
                      ? error
                      : (error as any)?.message ?? JSON.stringify(error ?? "Step failed")
                  assistant.error = {
                    name: "UnknownError",
                    data: { message: errMessage },
                  }
                }),
              )
            }
          }
          setStore("session_status", sessionID, { type: "idle" })
          break
        }

        case "session.next.text.started": {
          const { sessionID, assistantMessageID, textID, timestamp } = event.properties
          touchPart(sessionID, textID)
          const timeCreated = toMillis(timestamp)
          const newPart: TextPart = {
            id: textID,
            sessionID,
            messageID: assistantMessageID,
            type: "text",
            text: "",
            time: { start: timeCreated },
          }
          const parts = store.part[assistantMessageID]
          if (!parts) {
            setStore("part", assistantMessageID, [newPart])
            break
          }
          if (!parts.some((p) => p.id === textID)) {
            setStore(
              "part",
              assistantMessageID,
              produce((draft) => {
                draft.push(newPart)
              }),
            )
          }
          break
        }

        case "session.next.text.delta": {
          const { sessionID, assistantMessageID, textID, delta } = event.properties
          touchPart(sessionID, textID)
          const parts = store.part[assistantMessageID]
          if (!parts) break
          const index = parts.findIndex((p) => p.id === textID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((draft) => {
                if (draft.type === "text") draft.text += delta
              }),
            )
          } else {
            const newPart: TextPart = {
              id: textID,
              sessionID,
              messageID: assistantMessageID,
              type: "text",
              text: delta,
              time: { start: Date.now() },
            }
            setStore(
              "part",
              assistantMessageID,
              produce((draft) => {
                draft.push(newPart)
              }),
            )
          }
          break
        }

        case "session.next.text.ended": {
          const { sessionID, assistantMessageID, textID, text, timestamp } = event.properties
          touchPart(sessionID, textID)
          const timeEnded = toMillis(timestamp)
          const parts = store.part[assistantMessageID]
          if (!parts) break
          const index = parts.findIndex((p) => p.id === textID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((draft) => {
                const part = draft as TextPart
                part.text = text
                if (part.time) part.time.end = timeEnded
              }),
            )
          }
          break
        }

        case "session.next.reasoning.started": {
          const { sessionID, assistantMessageID, reasoningID, timestamp } = event.properties
          touchPart(sessionID, reasoningID)
          const timeCreated = toMillis(timestamp)
          const newPart: ReasoningPart = {
            id: reasoningID,
            sessionID,
            messageID: assistantMessageID,
            type: "reasoning",
            text: "",
            time: { start: timeCreated },
          }
          const parts = store.part[assistantMessageID]
          if (!parts) {
            setStore("part", assistantMessageID, [newPart])
            break
          }
          if (!parts.some((p) => p.id === reasoningID)) {
            setStore(
              "part",
              assistantMessageID,
              produce((draft) => {
                draft.push(newPart)
              }),
            )
          }
          break
        }

        case "session.next.reasoning.delta": {
          const { sessionID, assistantMessageID, reasoningID, delta } = event.properties
          touchPart(sessionID, reasoningID)
          const parts = store.part[assistantMessageID]
          if (!parts) break
          const index = parts.findIndex((p) => p.id === reasoningID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((draft) => {
                if (draft.type === "reasoning") draft.text += delta
              }),
            )
          } else {
            const newPart: ReasoningPart = {
              id: reasoningID,
              sessionID,
              messageID: assistantMessageID,
              type: "reasoning",
              text: delta,
              time: { start: Date.now() },
            }
            setStore(
              "part",
              assistantMessageID,
              produce((draft) => {
                draft.push(newPart)
              }),
            )
          }
          break
        }

        case "session.next.reasoning.ended": {
          const { sessionID, assistantMessageID, reasoningID, text, timestamp } = event.properties
          touchPart(sessionID, reasoningID)
          const timeEnded = toMillis(timestamp)
          const parts = store.part[assistantMessageID]
          if (!parts) break
          const index = parts.findIndex((p) => p.id === reasoningID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((draft) => {
                const part = draft as ReasoningPart
                part.text = text
                if (part.time) part.time.end = timeEnded
              }),
            )
          }
          break
        }

        case "session.next.tool.input.started": {
          const { sessionID, assistantMessageID, callID, name } = event.properties
          touchPart(sessionID, callID)
          const newPart: ToolPart = {
            id: callID,
            sessionID,
            messageID: assistantMessageID,
            type: "tool",
            callID,
            tool: name,
            state: { status: "pending", input: {}, raw: "" },
          }
          const parts = store.part[assistantMessageID]
          if (!parts) {
            setStore("part", assistantMessageID, [newPart])
            break
          }
          if (!parts.some((p) => p.id === callID)) {
            setStore(
              "part",
              assistantMessageID,
              produce((draft) => {
                draft.push(newPart)
              }),
            )
          }
          break
        }

        case "session.next.tool.input.delta": {
          const { sessionID, assistantMessageID, callID, delta } = event.properties
          touchPart(sessionID, callID)
          const parts = store.part[assistantMessageID]
          if (!parts) break
          const index = parts.findIndex((p) => p.id === callID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((part) => {
                if (part.type === "tool" && part.state.status === "pending") {
                  part.state.raw += delta
                }
              }),
            )
          }
          break
        }

        case "session.next.tool.input.ended": {
          const { sessionID, assistantMessageID, callID, text } = event.properties
          touchPart(sessionID, callID)
          const parts = store.part[assistantMessageID]
          if (!parts) break
          const index = parts.findIndex((p) => p.id === callID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((part) => {
                if (part.type === "tool" && part.state.status === "pending") {
                  part.state.raw = text
                }
              }),
            )
          }
          break
        }

        case "session.next.tool.called": {
          const { sessionID, assistantMessageID, callID, tool, input, timestamp } = event.properties
          touchPart(sessionID, callID)
          const timeRan = toMillis(timestamp)
          const runningState: ToolState = {
            status: "running",
            input: (input as Record<string, unknown>) ?? {},
            title: tool,
            time: { start: timeRan },
          }
          const parts = store.part[assistantMessageID]
          if (!parts) {
            setStore("part", assistantMessageID, [
              {
                id: callID,
                sessionID,
                messageID: assistantMessageID,
                type: "tool",
                callID,
                tool,
                state: runningState,
              },
            ])
            break
          }
          const index = parts.findIndex((p) => p.id === callID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((part) => {
                if (part.type === "tool") {
                  part.tool = tool
                  part.state = runningState
                }
              }),
            )
          } else {
            setStore(
              "part",
              assistantMessageID,
              produce((draft) => {
                draft.push({
                  id: callID,
                  sessionID,
                  messageID: assistantMessageID,
                  type: "tool",
                  callID,
                  tool,
                  state: runningState,
                })
              }),
            )
          }
          break
        }

        case "session.next.tool.progress": {
          const { sessionID, assistantMessageID, callID, content } = event.properties
          touchPart(sessionID, callID)
          const parts = store.part[assistantMessageID]
          if (!parts) break
          const index = parts.findIndex((p) => p.id === callID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((part) => {
                if (part.type === "tool" && part.state.status === "running") {
                  const text = (content ?? [])
                    .filter((c: any) => c.type === "text")
                    .map((c: any) => c.text)
                    .join("")
                  if (text) {
                    part.state.metadata = { ...(part.state.metadata ?? {}), progress: text }
                  }
                }
              }),
            )
          }
          break
        }

        case "session.next.tool.success": {
          const { sessionID, assistantMessageID, callID, content, result, timestamp } = event.properties
          touchPart(sessionID, callID)
          const timeCompleted = toMillis(timestamp)
          const parts = store.part[assistantMessageID]
          if (!parts) break
          const index = parts.findIndex((p) => p.id === callID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((part) => {
                if (part.type === "tool") {
                  const textContent = (content ?? [])
                    .filter((c: any) => c.type === "text")
                    .map((c: any) => c.text)
                    .join("")
                  const output = textContent || (typeof result === "string" ? result : JSON.stringify(result ?? ""))
                  const start = (part.state as any).time?.start ?? timeCompleted
                  part.state = {
                    status: "completed",
                    input: (part.state as any).input ?? {},
                    output,
                    title: part.tool,
                    metadata: (part.state as any).metadata ?? {},
                    time: { start, end: timeCompleted },
                  }
                }
              }),
            )
          }
          break
        }

        case "session.next.tool.failed": {
          const { sessionID, assistantMessageID, callID, error, timestamp } = event.properties
          touchPart(sessionID, callID)
          const timeCompleted = toMillis(timestamp)
          const parts = store.part[assistantMessageID]
          if (!parts) break
          const index = parts.findIndex((p) => p.id === callID)
          if (index !== -1) {
            setStore(
              "part",
              assistantMessageID,
              index,
              produce((part) => {
                if (part.type === "tool") {
                  const errorStr =
                    typeof error === "string"
                      ? error
                      : (error as any)?.message ?? JSON.stringify(error ?? "Tool execution failed")
                  const start = (part.state as any).time?.start ?? timeCompleted
                  part.state = {
                    status: "error",
                    input: (part.state as any).input ?? {},
                    error: errorStr,
                    metadata: (part.state as any).metadata ?? {},
                    time: { start, end: timeCompleted },
                  }
                }
              }),
            )
          }
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          putMessage(event.properties.info.sessionID, event.properties.info)
          break
        }
        case "message.removed": {
          touchMessage(event.properties.sessionID, event.properties.messageID)
          const messages = store.message[event.properties.sessionID]
          const index = messages.findIndex((message) => message.id === event.properties.messageID)
          if (index !== -1) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          touchPart(event.properties.part.sessionID, event.properties.part.id)
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = search(parts, event.properties.part.id, (part) => part.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = search(parts, event.properties.partID, (part) => part.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, event.properties.partID)
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          touchPart(event.properties.sessionID, event.properties.partID)
          const parts = store.part[event.properties.messageID]
          const result = search(parts, event.properties.partID, (part) => part.id)
          if (result.found) {
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          if (workspace === project.workspace.current()) {
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const capabilitiesPromise = sdk.client.experimental.capabilities
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => undefined)
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
      await Promise.all([
        providersPromise,
        providerListPromise,
        capabilitiesPromise,
        agentsPromise,
        configPromise,
        projectPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ])
        .then(async () => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const capabilitiesResponse = capabilitiesPromise
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            capabilitiesResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const capabilities = responses[2]
            const consoleState = responses[3]
            const agents = responses[4]
            const config = responses[5]
            const sessions = responses[6]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("capabilities", "experimentalBackgroundSubagents", capabilities?.backgroundSubagents === true)
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.session.status({ workspace }).then((x) => {
              setStore("session_status", reconcile(x.data ?? {}))
            }),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          console.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            exit(e)
          } else {
            throw e
          }
        })
    }

    onMount(() => {
      void bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const list = await listSessions()
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          const status = store.session_status[sessionID]
          if (status?.type === "busy" || status?.type === "retry") return "working"
          const session = result.session.get(sessionID)
          if (session?.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const syncing = syncingSessions.get(sessionID)
          if (syncing) return syncing
          const tracker = { messages: new Set<string>(), parts: new Set<string>() }
          hydratingSessions.set(sessionID, tracker)
          const task = (async () => {
            const [session, messages, todo, diff] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true }),
              sdk.client.session.messages({ sessionID, limit: 100 }),
              sdk.client.session.todo({ sessionID }),
              sdk.client.session.diff({ sessionID }),
            ])
            setStore(
              produce((draft) => {
                const match = search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
                draft.todo[sessionID] = todo.data ?? []
                const currentMessages = draft.message[sessionID] ?? []
                const infos = (messages.data ?? []).flatMap((message) => {
                  if (!tracker.messages.has(message.info.id)) return [message.info]
                  const current = currentMessages.find((item) => item.id === message.info.id)
                  return current ? [current] : []
                })
                infos.push(
                  ...currentMessages.filter(
                    (message) => tracker.messages.has(message.id) && !infos.some((item) => item.id === message.id),
                  ),
                )
                infos.sort(compareMessage)
                const removed = infos.slice(0, -100)
                const visible = infos.slice(-100)
                const visibleIDs = new Set(visible.map((message) => message.id))
                for (const message of messages.data ?? []) {
                  if (!visibleIDs.has(message.info.id)) {
                    delete draft.part[message.info.id]
                    continue
                  }
                  const currentParts = draft.part[message.info.id] ?? []
                  const parts = message.parts.flatMap((part) => {
                    const current = currentParts.find((item) => item.id === part.id)
                    if (tracker.parts.has(part.id)) return current ? [current] : []
                    if (
                      current &&
                      (part.type === "text" || part.type === "reasoning") &&
                      (current.type === "text" || current.type === "reasoning") &&
                      part.text.length === 0 &&
                      current.text.length > 0
                    ) {
                      return [current]
                    }
                    return [part]
                  })
                  parts.push(
                    ...currentParts.filter(
                      (part) => tracker.parts.has(part.id) && !parts.some((item) => item.id === part.id),
                    ),
                  )
                  draft.part[message.info.id] = parts
                }
                for (const message of removed) delete draft.part[message.id]
                draft.message[sessionID] = visible
                draft.session_diff[sessionID] = diff.data ?? []
              }),
            )
            fullSyncedSessions.add(sessionID)
          })().finally(() => {
            syncingSessions.delete(sessionID)
            hydratingSessions.delete(sessionID)
          })
          syncingSessions.set(sessionID, task)
          return task
        },
      },
      bootstrap,
    }

    createEffect(() => {
      if (permission.mode !== "auto") return
      for (const [sessionID, requests] of Object.entries(store.permission)) {
        if (!requests?.length) continue
        const session = result.session.get(sessionID)
        const directory = session?.directory
        for (const req of requests) {
          void sdk.client.permission.reply({
            requestID: req.id,
            reply: "once",
            directory,
          })
        }
      }
    })

    return result
  },
})
