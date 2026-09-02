import type {
  Activity,
  Census,
  Diff,
  HardState,
  HistoryEntry,
  McpServerInfo,
  ModelCatalog,
  Obligation,
  Project,
  Provider,
  State,
  UiEvent,
  Verification,
  Workspace,
} from './types'
import type { Event, Part, Session } from '@opencode-ai/sdk/v2/client'

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
  const reasoning = thoughts.join('\n\n').trim()
  return {
    reasoning: reasoning || undefined,
    body: body.trim(),
  }
}

export function createInitialHardState(): HardState {
  return {
    revision: 0,
    open_obligations: [],
    closed_obligations: [],
    claims: [],
    contradictions: [],
    rejected_claims: [],
    recent_evidence: [],
    verification_receipts: [],
    completed_tasks: [],
  }
}

export function createInitialWorkspace(sessionID = ''): Workspace {
  return {
    workspace_id: `ws-${sessionID || 'default'}`,
    session_id: sessionID,
    base_hard_revision: 0,
    active_focus: [],
    hypotheses: [],
    unknowns: [],
    candidate_actions: [],
    item_count: 0,
    max_capacity: 10,
  }
}

export function createInitialState(sessionID = ''): State {
  return {
    revision: 0,
    phase: 'idle',
    session_id: sessionID,
    task_id: `task-${sessionID || 'main'}`,
    repository_id: 'local',
    hard_state: createInitialHardState(),
    soft_workspace: createInitialWorkspace(sessionID),
    model_invocation_count: 0,
  }
}

export function updateHardStateFromTool(
  current: HardState,
  tool: string,
  state: { status?: string; input?: Record<string, unknown>; metadata?: Record<string, unknown>; output?: unknown },
): { next: HardState; mutated: boolean } {
  if (state.status !== 'completed') {
    return { next: current, mutated: false }
  }

  const next: HardState = {
    ...current,
    open_obligations: [...current.open_obligations],
    closed_obligations: [...current.closed_obligations],
    claims: [...current.claims],
    verification_receipts: [...current.verification_receipts],
    recent_evidence: [...current.recent_evidence],
  }
  let mutated = false

  if (tool === 'propose_claim') {
    const proposition = String(state.input?.proposition ?? state.input?.claim ?? '')
    const scope = String(state.input?.scope ?? 'global')
    const id = String(state.input?.claim_id ?? state.metadata?.claim_id ?? `claim-${next.claims.length + 1}`)
    if (proposition && !next.claims.some(c => c.id === id)) {
      next.claims.push({
        id,
        proposition,
        status: 'asserted',
        supporting_evidence: Array.isArray(state.input?.evidence) ? state.input.evidence.map(String) : [],
        scope,
      })
      next.revision += 1
      mutated = true
    }
  } else if (tool === 'request_verification') {
    const obligationId = String(state.input?.obligation_id ?? state.input?.target ?? '')
    const passed = state.metadata?.passed === true || Boolean(state.output && !String(state.output).toLowerCase().includes('fail'))
    const diagnostics = typeof state.metadata?.diagnostics === 'string' ? state.metadata.diagnostics : undefined
    const receiptId = String(state.metadata?.receipt_id ?? `rcpt-${Date.now()}`)
    const scope = String(state.input?.scope ?? 'praxis')

    if (obligationId) {
      next.verification_receipts.push({
        receipt_id: receiptId,
        obligation_id: obligationId,
        passed,
        diagnostics,
        scope,
      })

      if (passed) {
        const foundIdx = next.open_obligations.findIndex(o => o.id === obligationId)
        if (foundIdx >= 0) {
          const [closed] = next.open_obligations.splice(foundIdx, 1)
          next.closed_obligations.push({ ...closed, status: 'verified' })
        }
      }
      next.revision += 1
      mutated = true
    }
  } else if (tool === 'request_completion') {
    const rawObligations = state.metadata?.obligations ?? state.input?.obligations
    if (Array.isArray(rawObligations)) {
      for (const item of rawObligations) {
        const text = typeof item === 'string' ? item : (item && typeof item === 'object' && 'description' in item ? String((item as any).description) : JSON.stringify(item))
        const obId = typeof item === 'object' && item && 'id' in item ? String((item as any).id) : `ob-${next.open_obligations.length + 1}`
        if (!next.open_obligations.some(o => o.id === obId || o.description === text)) {
          next.open_obligations.push({
            id: obId,
            description: text,
            scope: 'completion',
            status: 'open',
          })
          mutated = true
        }
      }
    }
    if (state.metadata?.completed === true) {
      next.completed_tasks.push(String(state.metadata?.task_id ?? 'completed'))
      mutated = true
    }
    if (mutated) {
      next.revision += 1
    }
  }

  return { next, mutated }
}

export function mapProjectInfo(data: { id?: string; name?: string; worktree?: string; directory?: string; branch?: string } | null | undefined): Project {
  return {
    id: data?.id ?? 'current',
    name: data?.name ?? (data?.worktree ? data.worktree.split('/').pop() : 'Rivet Project') ?? 'Rivet Project',
    path: data?.worktree ?? data?.directory ?? '/',
    branch: data?.branch,
    dirty: false,
  }
}

export function mapModelCatalog(
  providersData: Array<{ id: string; name?: string; configured?: boolean; masked_key?: string; base_url?: string; models?: Array<{ id: string; name?: string }> }> | null | undefined,
  activeProviderId?: string,
  activeModelId?: string,
): ModelCatalog {
  const providers: Provider[] = (providersData ?? []).map(p => ({
    id: p.id,
    name: p.name ?? p.id,
    models: (p.models ?? []).map(m => m.id),
    configured: p.configured ?? true,
    masked_key: p.masked_key,
    base_url: p.base_url,
  }))

  const active_provider = activeProviderId || providers[0]?.id || 'anthropic'
  const active_model = activeModelId || providers.find(p => p.id === active_provider)?.models[0] || 'claude-3-7-sonnet'

  return {
    active_provider,
    active_model,
    providers,
  }
}
