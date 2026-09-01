export type ConnectionState = 'connecting' | 'live' | 'offline'
export type RunPhase = string

export type UiEvent =
  | { type: 'run_started'; run_id: string; prompt: string; goal: string }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'assistant_reasoning_delta'; delta: string }
  | { type: 'status'; phase: RunPhase; message: string }
  | { type: 'authority_prompt'; request_id: string; capability: string; target: string }
  | { type: 'verification_update'; obligation_id: string; passed: boolean; diagnostics?: string }
  | { type: 'cognitive_state'; focus: string; hypothesis?: string; status: string; evidence_count: number; counter_signal?: string }
  | { type: 'tool_activity'; action_id: string; capability: string; target: string; status: string; summary: string; output_summary?: string }
  | { type: 'observation'; source: string; summary: string; evidence_id?: string }
  | { type: 'praxis_update'; obligation_id: string; predicate: string; status: string; scope: string; diagnostics?: string; receipt_id?: string }
  | { type: 'hard_state_mutation'; revision: number; mutation: string; entity_id?: string; from?: string; to?: string }
  | { type: 'steer_accepted'; prompt: string }
  | { type: 'cancelled'; message: string }
  | { type: 'completed'; summary: string }
  | { type: 'error'; message: string }

export interface Attachment { name: string; mime_type: string; content: string; size: number }
export interface Obligation { id: string; description: string; scope: string; status: string }
export interface Verification { receipt_id: string; obligation_id: string; passed: boolean; diagnostics?: string; scope: string }
export interface HardState {
  revision: number; open_obligations: Obligation[]; closed_obligations: Obligation[]
  claims: Array<{ id: string; proposition: string; status: string; supporting_evidence: string[]; scope: string }>
  contradictions: Array<{ claim_id: string; reason: string; contradicted_by: string[]; scope: string }>
  rejected_claims: Array<{ claim_id: string; reason: string; evidence: string[] }>
  recent_evidence: Array<{ id: string; summary: string }>; verification_receipts: Verification[]; completed_tasks: string[]
}
export interface Workspace { workspace_id: string; session_id: string; base_hard_revision: number; active_focus: string[]; hypotheses: string[]; unknowns: string[]; candidate_actions: string[]; item_count: number; max_capacity: number }
export interface State { revision: number; phase: RunPhase; session_id: string; task_id: string; repository_id: string; hard_state: HardState; soft_workspace: Workspace; cognitive_view?: unknown; model_invocation_count: number }
export interface Census { total_files: number; total_bytes: number; deferred_count: number; directories: Array<{ relative_path: string; file_count: number; total_bytes: number; relevance: string; signals: string[] }> }
export interface Project { id: string; name: string; path: string; branch?: string; revision?: string; dirty: boolean }
export interface Provider { id: string; name: string; models: string[]; configured: boolean }
export interface ModelCatalog { active_provider: string; active_model: string; providers: Provider[] }
export interface HistoryEntry { id: string; prompt: string; status: string; revision?: number; created_at: string }
export interface Diff { status: string; text: string; files: string[] }
export interface Activity { id: string; kind: string; body: string; status: 'active' | 'done' | 'alert' | 'neutral'; timestamp: string; detail: Array<[string, string]>; authoritative?: boolean }
export interface Message { id: string; role: 'you' | 'rivet' | 'system'; body: string; live?: boolean; attachments?: string[] }
