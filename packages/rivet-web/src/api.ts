import { createOpencodeClient, type OpencodeClient, type Session, type Event } from '@opencode-ai/sdk/v2/client'
import type {
  Attachment,
  Census,
  Diff,
  GoalSummary,
  HistoryEntry,
  McpServerInfo,
  ModelCatalog,
  Project,
  SaveAuthPayload,
  State,
  StepResponse,
} from './types'
import {
  createInitialState,
  mapModelCatalog,
  mapProjectInfo,
} from './rivet-adapter'

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

let clientInstance: OpencodeClient | null = null

export function getClient(): OpencodeClient {
  if (!clientInstance) {
    clientInstance = createOpencodeClient({
      baseUrl: typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:4096',
    })
  }
  return clientInstance
}

export async function getProject(): Promise<Project> {
  const client = getClient()
  try {
    const { data } = await client.project.current()
    return mapProjectInfo(data)
  } catch {
    const { data } = await client.path.get()
    return mapProjectInfo({ worktree: data?.directory })
  }
}

export async function getModels(): Promise<ModelCatalog> {
  const client = getClient()
  try {
    const [{ data: providersData }, { data: configData }] = await Promise.all([
      client.provider.list(),
      client.config.get().catch(() => ({ data: undefined })),
    ])

    const providers = (providersData?.all ?? providersData?.connected ?? []).map((p: any) => ({
      id: p.id,
      name: p.name ?? p.id,
      configured: Boolean(p.configured ?? true),
      masked_key: p.masked_key,
      base_url: p.base_url,
      models: (p.models ?? []).map((m: any) => ({ id: m.id ?? m, name: m.name ?? m.id ?? m })),
    }))

    let activeProvider = providers[0]?.id || 'anthropic'
    let activeModel = providers.find((p: any) => p.id === activeProvider)?.models[0]?.id || 'claude-3-7-sonnet'

    if (typeof configData?.model === 'string' && configData.model.includes('/')) {
      const [p, ...rest] = configData.model.split('/')
      activeProvider = p
      activeModel = rest.join('/')
    } else if (configData?.model && typeof configData.model === 'object') {
      activeProvider = (configData.model as any).providerID || activeProvider
      activeModel = (configData.model as any).modelID || activeModel
    }

    return mapModelCatalog(providers, activeProvider, activeModel)
  } catch {
    return mapModelCatalog([])
  }
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const client = getClient()
  try {
    const { data } = await client.session.list({ limit: 50 })
    return (data ?? []).map((s: Session) => ({
      id: s.id,
      prompt: s.title || 'Untitled Session',
      status: s.time.archived ? 'archived' : 'ready',
      created_at: new Date(s.time.created).toLocaleTimeString(),
    }))
  } catch {
    return []
  }
}

export async function getCensus(): Promise<Census> {
  const client = getClient()
  try {
    const { data } = await client.find.files({ query: '' })
    const files = data ?? []
    const directoriesMap = new Map<string, { count: number; bytes: number }>()

    for (const file of files) {
      const parts = file.split('/')
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
      const existing = directoriesMap.get(dir) || { count: 0, bytes: 0 }
      existing.count += 1
      existing.bytes += 1024
      directoriesMap.set(dir, existing)
    }

    const directories = Array.from(directoriesMap.entries()).map(([relative_path, stats]) => ({
      relative_path,
      file_count: stats.count,
      total_bytes: stats.bytes,
      relevance: 'high',
      signals: ['active workspace source'],
    }))

    return {
      total_files: files.length,
      total_bytes: files.length * 1024,
      deferred_count: 0,
      directories,
    }
  } catch {
    return {
      total_files: 0,
      total_bytes: 0,
      deferred_count: 0,
      directories: [],
    }
  }
}

export async function getDiff(): Promise<Diff> {
  const client = getClient()
  try {
    const { data } = await client.vcs.diff({ mode: 'git' })
    const text = typeof data === 'string' ? data : (data as any)?.diff || (data as any)?.text || ''
    const files = text
      .split('\n')
      .filter((line: string) => line.startsWith('diff --git'))
      .map((line: string) => line.split(' ').pop()?.replace(/^b\//, '') || '')
      .filter(Boolean)

    return {
      status: text ? 'modified' : 'clean',
      text,
      files,
    }
  } catch {
    return { status: 'clean', text: '', files: [] }
  }
}

export async function getMcp(): Promise<McpServerInfo[]> {
  const client = getClient()
  try {
    const { data } = await client.mcp.status()
    if (!data) return []
    return Object.entries(data).map(([name, server]: [string, any]) => ({
      name,
      command: server.command ?? 'stdio',
      args: server.args ?? [],
      disabled: server.status === 'disabled',
      tools_count: server.tools?.length ?? 0,
      status: server.status ?? 'connected',
      tools: (server.tools ?? []).map((tool: any) => ({
        capability_id: tool.name,
        tool_name: tool.name,
        description: tool.description ?? '',
        input_schema: tool.input_schema ?? {},
        is_verified_provider: true,
      })),
    }))
  } catch {
    return []
  }
}

export async function openProject(path: string): Promise<Project> {
  const client = getClient()
  return mapProjectInfo({ worktree: path })
}

export async function saveAuth(payload: SaveAuthPayload): Promise<ModelCatalog> {
  const client = getClient()
  try {
    await client.auth.set({
      providerID: payload.provider,
      auth: {
        type: 'api',
        key: payload.key,
      },
    })
  } catch {
    // continue to refresh
  }
  return getModels()
}

export async function removeAuth(provider: string): Promise<ModelCatalog> {
  const client = getClient()
  try {
    await client.auth.remove({ providerID: provider })
  } catch {
    // continue
  }
  return getModels()
}

export async function selectModel(provider: string, model: string): Promise<ModelCatalog> {
  const client = getClient()
  try {
    await client.config.update({
      config: {
        model: `${provider}/${model}`,
      },
    })
  } catch {
    // fallback
  }
  return getModels()
}

export async function createSession(title?: string, model?: { id: string; providerID: string }): Promise<Session> {
  const client = getClient()
  const { data } = await client.session.create({
    title: title || 'Rivet Session',
    model: model ? { id: model.id, providerID: model.providerID } : undefined,
  })
  if (!data) {
    throw new Error('Failed to create session')
  }
  return data
}

export async function sendPrompt(
  sessionID: string,
  prompt: string,
  attachments: Attachment[] = [],
  model?: { id: string; providerID: string },
) {
  const client = getClient()
  const parts: any[] = [{ type: 'text', text: prompt }]

  for (const att of attachments) {
    parts.push({
      type: 'file',
      path: att.name,
      content: att.content,
    })
  }

  return client.session.prompt({
    sessionID,
    parts,
    model: model ? { modelID: model.id, providerID: model.providerID } : undefined,
  })
}

export async function abortSession(sessionID: string) {
  const client = getClient()
  return client.session.abort({ sessionID })
}

export function openEventStream(
  onEvent: (event: Event) => void,
  onState: (state: 'live' | 'offline') => void,
): EventSource {
  const stream = new EventSource('/event')
  stream.onopen = () => onState('live')
  stream.onerror = () => onState('offline')
  stream.onmessage = message => {
    try {
      const parsed = JSON.parse(message.data)
      if (parsed) {
        onEvent(parsed as Event)
      }
    } catch {
      // ignore parse errors or heartbeats
    }
  }
  return stream
}
