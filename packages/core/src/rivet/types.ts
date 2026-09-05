import path from "path"

export type SessionId = string & { readonly __brand: "SessionId" }
export type TaskId = string & { readonly __brand: "TaskId" }
export type ObligationId = string & { readonly __brand: "ObligationId" }
export type ClaimId = string & { readonly __brand: "ClaimId" }
export type EvidenceId = string & { readonly __brand: "EvidenceId" }
export type ArtifactId = string & { readonly __brand: "ArtifactId" }
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" }
export type ActionId = string & { readonly __brand: "ActionId" }
export type ReceiptId = string & { readonly __brand: "ReceiptId" }
export type InvocationId = string & { readonly __brand: "InvocationId" }
export type FocusId = string & { readonly __brand: "FocusId" }
export type RecoveryId = string & { readonly __brand: "RecoveryId" }

/**
 * User-authorized subject of the active task. Autonomous self-repair is never
 * an admission value; it is the fail-closed outcome when a normal task reaches
 * Rivet internals without this authority.
 */
export type TaskAuthority = "normal_project_task" | "rivet_maintenance_task"

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10)
}

export function createSessionId(val?: string): SessionId {
  return (val ?? `sess_${randomSuffix()}`) as SessionId
}

export function createTaskId(val?: string): TaskId {
  return (val ?? `task_${randomSuffix()}`) as TaskId
}

export function createObligationId(val?: string): ObligationId {
  return (val ?? `oblg_${randomSuffix()}`) as ObligationId
}

export function createClaimId(val?: string): ClaimId {
  return (val ?? `claim_${randomSuffix()}`) as ClaimId
}

export function createEvidenceId(val?: string): EvidenceId {
  return (val ?? `evid_${randomSuffix()}`) as EvidenceId
}

export function createArtifactId(val?: string): ArtifactId {
  return (val ?? `artf_${randomSuffix()}`) as ArtifactId
}

export function createWorkspaceId(val?: string): WorkspaceId {
  return (val ?? `ws_${randomSuffix()}`) as WorkspaceId
}

export function createActionId(val?: string): ActionId {
  return (val ?? `act_${randomSuffix()}`) as ActionId
}

export function createReceiptId(val?: string): ReceiptId {
  return (val ?? `rcpt_${randomSuffix()}`) as ReceiptId
}

export function createInvocationId(val?: string): InvocationId {
  return (val ?? `inv_${randomSuffix()}`) as InvocationId
}

export function createFocusId(val?: string): FocusId {
  return (val ?? `focus_${randomSuffix()}`) as FocusId
}

export function createRecoveryId(val?: string): RecoveryId {
  return (val ?? `recovery_${randomSuffix()}`) as RecoveryId
}

export class Revision {
  static readonly ZERO = new Revision(0n)

  constructor(readonly value: bigint) {}

  static from(val: bigint | number | string): Revision {
    return new Revision(BigInt(val))
  }

  next(): Revision {
    return new Revision(this.value + 1n)
  }

  equals(other: Revision): boolean {
    return this.value === other.value
  }

  toString(): string {
    return `r${this.value}`
  }

  toJSON(): string {
    return this.value.toString()
  }
}

export type EpistemicStatus =
  | "hypothetical"
  | "supported"
  | "verified"
  | "dirty"
  | "stale"
  | "superseded"
  | "rejected"
  | "invalidated"

export type ValidityPolicy = "HISTORICAL" | "CURRENT_STATE" | "DERIVED_STATE" | "PROCEDURAL" | "EPISTEMIC"

/**
 * Obligations are typed because each kind requires a different closure proof
 * object: epistemic inquiries close via authoritative Noesis projections,
 * execution obligations close via Praxis verification receipts over observed
 * executions, and state mutations require an authorized action plus a revision
 * transition. Treating them uniformly turns assurance into bureaucracy.
 */
export type ObligationKind =
  | "epistemic_inquiry"
  | "execution"
  | "verification"
  | "user_input"
  | "artifact"
  | "state_mutation"

export type ObligationVerifier = "NOESIS" | "PRAXIS" | "HARNESS"

export type FocusKind = "obligation" | "recovery"

export type FailureClass =
  | "transient_tool"
  | "execution_error"
  | "verification_gap"
  | "environment_blocker"
  | "procedure_gap"
  | "authorization_blocker"
  | "stagnation"
  | "user_input_required"

export interface VerificationPolicy {
  readonly minimumEvidence: number
  readonly sufficientWhen: string
  readonly escalationConditions: readonly string[]
}

export interface FocusContract {
  readonly objective: string
  readonly acceptanceCriteria: readonly string[]
  readonly allowedScope: readonly string[]
  readonly requiredEvidence: readonly string[]
  readonly relevantEvidence?: readonly string[]
  readonly effortBudget?: number
  readonly verificationPolicy: VerificationPolicy
}

export interface ExecutionFocus {
  readonly id: FocusId
  readonly taskId: TaskId
  readonly kind: FocusKind
  readonly targetObligationId?: ObligationId
  readonly parentFocusId?: FocusId
  readonly objective: string
  readonly reason: string
  readonly acceptanceCriteria: readonly string[]
  readonly boundary: readonly string[]
  readonly requiredEvidence?: readonly string[]
  readonly relevantEvidence?: readonly string[]
  readonly effortBudget?: number
  readonly resumeTarget?: FocusId
  readonly contract: FocusContract
  readonly createdAt: string
}

export interface RecoveryFrame {
  readonly id: RecoveryId
  readonly taskId: TaskId
  readonly failureClass: FailureClass
  readonly parentFocusId: FocusId
  readonly targetObligationId: ObligationId
  readonly objective: string
  readonly acceptanceCriteria: readonly string[]
  readonly resumeTarget: FocusId
  readonly admittedInterventions?: readonly string[]
  readonly budget?: number
  readonly status: "open" | "verified" | "closed"
  readonly createdAt: string
  readonly verificationReceiptId?: ReceiptId
  readonly closedAt?: string
}

export interface RecoveryVerificationReceipt {
  readonly receiptId: ReceiptId
  readonly recoveryId: RecoveryId
  readonly passed: boolean
  readonly evidenceRefs: readonly EvidenceId[]
  readonly verifier: "PRAXIS"
  readonly timestamp: string
}

export interface TrajectoryFold {
  readonly focusId: FocusId
  readonly taskId: TaskId
  readonly kind: FocusKind
  readonly summary: string
  readonly evidenceRefs: readonly string[]
  readonly startedAt: string
  readonly completedAt: string
}

export interface ObligationClosureSpec {
  readonly requiredProofKind: string
  readonly verifier: ObligationVerifier
  readonly praxisRequired: boolean
  readonly acceptedProofRefs: readonly string[]
}

export interface ObligationViewRecord {
  readonly id: ObligationId
  readonly type: ObligationKind
  readonly objective: string
  readonly status: "open" | "satisfied" | "invalidated"
  readonly scope: Scope
  readonly closure: ObligationClosureSpec
  readonly blockers: readonly string[]
  readonly predicateSummary?: string
  readonly legalTransitions?: readonly string[]
}

export interface CompletionBlocker {
  readonly obligationId?: ObligationId
  readonly kind?: ObligationKind
  readonly reason: string
  readonly verifier?: ObligationVerifier
  readonly requiredProofKind?: string
  readonly actionableGuidance?: string
}

export interface CompletionReadiness {
  readonly status: "READY" | "BLOCKED" | "NOT_REQUIRED"
  readonly blockers: readonly string[]
  readonly structuredBlockers: readonly CompletionBlocker[]
}

export type DependencyRef =
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "file_pattern"; readonly pattern: string }
  | { readonly type: "manifest"; readonly name: string; readonly path?: string }
  | { readonly type: "symbol"; readonly symbol: string; readonly file?: string }
  | { readonly type: "census"; readonly key: string }
  | { readonly type: "claim"; readonly claimId: ClaimId }
  | { readonly type: "predicate"; readonly predicate: string }
  | { readonly type: "config"; readonly key: string }

export interface EvidenceRef {
  readonly evidenceId: EvidenceId
  readonly source: string
  readonly summary: string
  readonly revision: Revision
}

export interface Provenance {
  readonly source: string
  readonly author?: string
  readonly timestamp: string
  readonly derivedFrom?: readonly string[]
}

export interface PremiseConflict {
  readonly userPremise: string
  readonly currentValidState: string
  readonly conflictingClaimId?: ClaimId
  readonly supersededAtRevision?: Revision
  readonly evidenceRefs: readonly EvidenceId[]
}

export interface MemoryRef {
  readonly id: string
  readonly type: "claim" | "observation" | "decision" | "failure" | "procedure"
  readonly summary: string
  readonly status?: EpistemicStatus
  readonly relevanceScore?: number
  readonly revision?: Revision
  readonly tags?: readonly string[]
}

export interface MemoryFrontier {
  readonly revision: Revision
  readonly pinned: readonly MemoryRef[]
  readonly active: readonly MemoryRef[]
  readonly episodic: readonly MemoryRef[]
  readonly procedural: readonly MemoryRef[]
  readonly rejected: readonly MemoryRef[]
  readonly relatedSymbols: readonly string[]
}

export interface ScopeInit {
  repository: string
  pathPattern?: string | null
  revision: Revision
}

export class Scope {
  readonly repository: string
  readonly pathPattern?: string | null
  readonly revision: Revision

  constructor(init: ScopeInit) {
    this.repository = init.repository
    this.pathPattern = init.pathPattern ?? null
    this.revision = init.revision
  }

  static global(repository: string, revision: Revision): Scope {
    return new Scope({ repository, pathPattern: null, revision })
  }

  static path(repository: string, pattern: string, revision: Revision): Scope {
    return new Scope({ repository, pathPattern: pattern, revision })
  }

  allowsPath(repository: string, targetPath: string, revision: Revision): boolean {
    if (this.repository !== repository || !this.revision.equals(revision)) {
      return false
    }

    const normalized = normalizeRelativePath(targetPath)
    if (!this.pathPattern) {
      return true
    }

    const normPattern = normalizeRelativePath(this.pathPattern)
    if (normPattern.endsWith("/**")) {
      const prefix = normPattern.slice(0, -3)
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
        return true
      }
    }

    return globMatch(normPattern, normalized)
  }

  containsScope(narrower: Scope): boolean {
    if (this.repository !== narrower.repository || !this.revision.equals(narrower.revision)) {
      return false
    }

    if (!this.pathPattern) {
      return true
    }

    if (!narrower.pathPattern) {
      return false
    }

    const outer = normalizeRelativePath(this.pathPattern)
    const inner = normalizeRelativePath(narrower.pathPattern)

    if (outer === inner) {
      return true
    }

    if (outer.endsWith("/**")) {
      const prefix = outer.slice(0, -3)
      return inner === prefix || inner.startsWith(`${prefix}/`)
    }

    return false
  }

  toJSON() {
    return {
      repository: this.repository,
      path_pattern: this.pathPattern,
      revision: this.revision.toJSON(),
    }
  }
}

export function normalizeRelativePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "")
}

export function isSafeRelativePath(p: string): boolean {
  if (path.isAbsolute(p)) return false
  if (p.startsWith("/") || p.startsWith("\\")) return false
  if (/^[a-zA-Z]:/.test(p)) return false

  const normalized = p.replace(/\\/g, "/")
  const segments = normalized.split("/")
  for (const seg of segments) {
    if (seg === "..") return false
  }
  return true
}

// Applied to backslash-normalized spellings: POSIX absolute and Windows
// drive-letter paths are the two absolute forms a target or repository root
// can take. Anything else has no canonical containment semantics.
const looksAbsolute = (p: string) => p.startsWith("/") || /^[a-zA-Z]:\//.test(p)

/**
 * Map an action target to its canonical repository-relative spelling, or
 * `undefined` when repository-local identity cannot be established.
 *
 * Repository-relative and absolute spellings of the same file under the
 * declared repository root canonicalize to one value, so equivalent path
 * representations can never produce contradictory authority decisions.
 * Absolute targets outside the root, traversal segments, drive- or UNC-style
 * externals, and absolute spellings against a symbolic (non-path) repository
 * root all fail closed to `undefined`.
 *
 * This is a purely lexical boundary identity. Filesystem reality (symlinks,
 * mount boundaries, case sensitivity) stays owned by the executor's canonical
 * resolution (`LocationMutation`); ACCP authority is deliberately narrower or
 * equal to what the executor can later prove canonical.
 */
export function canonicalRepositoryPath(repository: string, target: string): string | undefined {
  const relativize = (value: string): string | undefined => {
    const slashed = value.replace(/\\/g, "/")
    const normalized = path.posix.normalize(slashed).replace(/\/+$/, "")
    if (normalized === "" || normalized === ".") return "."
    if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) return undefined
    return normalized
  }

  const slashedTarget = target.replace(/\\/g, "/")

  if (!looksAbsolute(slashedTarget) && isSafeRelativePath(target)) return relativize(target)

  // Absolute spellings (including Windows drive and UNC forms, independent of
  // host platform) are repository-local only when lexically contained in the
  // declared repository root, and only when that root is itself a path.
  // Mixed path styles (e.g. a drive-letter target against a POSIX root) have
  // no lexical containment proof and fail closed.
  const slashedRoot = repository.replace(/\\/g, "/")
  if (!looksAbsolute(slashedTarget) || !looksAbsolute(slashedRoot)) return undefined
  if (slashedTarget.startsWith("/") !== slashedRoot.startsWith("/")) return undefined
  const normRoot = path.posix.normalize(slashedRoot)
  const normTarget = path.posix.normalize(slashedTarget)
  if (normTarget === normRoot) return "."
  const prefix = normRoot.endsWith("/") ? normRoot : `${normRoot}/`
  if (!normTarget.startsWith(prefix)) return undefined
  return relativize(normTarget.slice(prefix.length))
}

export function globMatch(pattern: string, text: string): boolean {
  // Convert glob pattern to regular expression
  let regexStr = "^"
  let i = 0
  while (i < pattern.length) {
    if (pattern.slice(i, i + 4) === "/**/") {
      regexStr += "/(?:.+/)?"
      i += 4
      continue
    }
    if (pattern.slice(i, i + 3) === "/**") {
      regexStr += "(?:/.*)?"
      i += 3
      continue
    }
    const c = pattern[i]
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        regexStr += ".*"
        i += 2
        continue
      }
      regexStr += "[^/]*"
      i++
      continue
    }
    if (c === "?") {
      regexStr += "[^/]"
      i++
      continue
    }
    if (["\\", ".", "+", "(", ")", "[", "]", "{", "}", "^", "$", "|"].includes(c)) {
      regexStr += `\\${c}`
    } else {
      regexStr += c
    }
    i++
  }
  regexStr += "$"
  return new RegExp(regexStr).test(text)
}

export function shlexSplit(cmd: string): string[] {
  const args: string[] = []
  let current = ""
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (escaped) {
      current += c
      escaped = false
    } else if (c === "\\" && !inSingle) {
      escaped = true
    } else if (c === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (/\s/.test(c) && !inSingle && !inDouble) {
      if (current.length > 0) {
        args.push(current)
        current = ""
      }
    } else {
      current += c
    }
  }

  if (current.length > 0) {
    args.push(current)
  }
  return args
}

export class RivetError extends Error {
  constructor(
    readonly kind:
      | "SemanticViolation"
      | "AuthorityDenied"
      | "VerificationFailed"
      | "Storage"
      | "StaleState"
      | "Model"
      | "Runtime"
      | "Repository"
      | "Serialization"
      | "Timeout"
      | "InvalidPath",
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(`[${kind}] ${message}`)
    this.name = "RivetError"
  }
}
