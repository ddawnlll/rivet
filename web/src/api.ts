import type { Attachment, Census, Diff, HistoryEntry, ModelCatalog, Project, State, UiEvent } from './types'

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, init)
  const body = await response.text()
  if (!response.ok) {
    let message = body
    try { message = (JSON.parse(body) as { error?: string }).error ?? body } catch { /* plain response */ }
    throw new ApiError(response.status, message || `Request failed (${response.status})`)
  }
  return (body ? JSON.parse(body) : undefined) as T
}

export const getState = () => api<State>('state')
export const getProject = () => api<Project>('project')
export const getModels = () => api<ModelCatalog>('models')
export const getHistory = () => api<HistoryEntry[]>('history')
export const getCensus = () => api<Census>('census')
export const getDiff = () => api<Diff>('diff')

export function postRun(prompt: string, goal: string | undefined, attachments: Attachment[], steer: boolean, socket: WebSocket | null) {
  const payload = { type: steer ? 'steer' : 'step', prompt, goal, attachments }
  if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(payload)); return Promise.resolve() }
  return api('step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, goal, attachments }) }).then(() => undefined)
}

export function postGoal(prompt: string, socket: WebSocket | null) {
  if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'goal', prompt })); return Promise.resolve() }
  return api('goal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) }).then(() => undefined)
}

export function cancelRun(socket: WebSocket | null) {
  if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'cancel' })); return Promise.resolve() }
  return api('cancel', { method: 'POST' }).then(() => undefined)
}

export function selectModel(provider: string, model: string) {
  return api<ModelCatalog>('models/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, model }) })
}

export function openSocket(onEvent: (event: UiEvent) => void, onState: (state: 'live' | 'offline') => void) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const socket = new WebSocket(`${protocol}://${location.host}/api/ws`)
  socket.onopen = () => onState('live')
  socket.onclose = () => onState('offline')
  socket.onerror = () => onState('offline')
  socket.onmessage = message => {
    try { onEvent(JSON.parse(message.data) as UiEvent) } catch { /* ignore keepalives */ }
  }
  return socket
}
