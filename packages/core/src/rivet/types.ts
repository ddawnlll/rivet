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
  | "rejected"
  | "superseded"

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

export function globMatch(pattern: string, text: string): boolean {
  // Convert glob pattern to regular expression
  let regexStr = "^"
  let i = 0
  while (i < pattern.length) {
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
    readonly extra?: Record<string, unknown>
  ) {
    super(`[${kind}] ${message}`)
    this.name = "RivetError"
  }
}
