import type { ClaimRecord, HardState, SoftWorkspace, TaskPhase } from "../noesis"
import { Scope, type ObligationId } from "../types"

export interface TaskSignature {
  readonly rawPrompt: string
  readonly concepts: readonly string[]
  readonly possibleSymbols: readonly string[]
  readonly taskPhase: TaskPhase
  readonly currentScope: Scope
  readonly relevantObligations: readonly ObligationId[]
  readonly relevantClaims: readonly ClaimRecord[]
  readonly softWorkspaceFocus: readonly string[]
}

export interface SelectiveRetrievalContext {
  readonly knownFiles?: readonly string[]
  readonly userPrompt: string
  readonly hardState?: HardState
  readonly softWorkspace?: SoftWorkspace
  readonly taskPhase?: TaskPhase
  readonly currentScope?: Scope
}

export interface SelectiveRetrievalDecision {
  readonly shouldRetrieve: boolean
  readonly reason: string
  readonly bypassScope?: Scope
}

export class TaskSignatureCompiler {
  private static readonly STOPWORDS = new Set([
    "the", "and", "or", "to", "in", "a", "an", "is", "for", "with", "of", "on", "at",
    "by", "from", "as", "this", "that", "it", "not", "be", "are", "from", "then", "when"
  ])

  /**
   * Compiles a structured TaskSignature from prompt, HardState, and SoftWorkspace.
   */
  static compile(ctx: SelectiveRetrievalContext): TaskSignature {
    const rawPrompt = ctx.userPrompt.trim()
    const tokens = rawPrompt.split(/[^a-zA-Z0-9_#.-]+/).filter((t) => t.length > 2)

    const concepts = Array.from(
      new Set(
        tokens
          .map((t) => t.toLowerCase())
          .filter((t) => !this.STOPWORDS.has(t) && !/^\d+$/.test(t))
      )
    )

    // Identify potential symbols: PascalCase, camelCase, snake_case, dot.separated
    const possibleSymbols = Array.from(
      new Set(
        tokens.filter((t) =>
          /^[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*$/.test(t) || // PascalCase (compound)
          /^[a-z]+[A-Z][a-zA-Z0-9]*$/.test(t) || // camelCase
          /^[a-zA-Z0-9]+_[a-zA-Z0-9_]+$/.test(t) || // snake_case
          t.includes(".")
        )
      )
    )

    const taskPhase: TaskPhase = ctx.taskPhase ?? this.inferTaskPhase(rawPrompt)
    const currentScope = ctx.currentScope ?? (ctx.hardState ? Scope.global("root", ctx.hardState.revision) : Scope.global("root", 0n as any))

    const relevantObligations: ObligationId[] = []
    if (ctx.hardState) {
      for (const [id, desc] of ctx.hardState.obligations) {
        if (concepts.some((c) => desc.toLowerCase().includes(c))) {
          relevantObligations.push(id)
        }
      }
    }

    const relevantClaims: ClaimRecord[] = []
    if (ctx.hardState) {
      for (const claim of ctx.hardState.claims.values()) {
        const prop = claim.proposition.toLowerCase()
        if (concepts.some((c) => prop.includes(c))) {
          relevantClaims.push(claim)
        }
      }
    }

    const softWorkspaceFocus = ctx.softWorkspace?.activeFocus ?? []

    return {
      rawPrompt,
      concepts,
      possibleSymbols,
      taskPhase,
      currentScope,
      relevantObligations,
      relevantClaims,
      softWorkspaceFocus,
    }
  }

  private static inferTaskPhase(prompt: string): TaskPhase {
    const lower = prompt.toLowerCase()
    if (lower.includes("verify") || lower.includes("test") || lower.includes("validate") || lower.includes("check")) {
      return "verification"
    }
    if (lower.includes("bug") || lower.includes("fix") || lower.includes("deadlock") || lower.includes("crash") || lower.includes("error") || lower.includes("why")) {
      return "diagnosis"
    }
    if (lower.includes("refactor") || lower.includes("implement") || lower.includes("add") || lower.includes("write")) {
      return "implementation"
    }
    if (lower.includes("plan") || lower.includes("design") || lower.includes("propose")) {
      return "planning"
    }
    return "orientation"
  }
}

export class SelectiveRetrievalGate {
  /**
   * Decides whether whole-repository retrieval is required for the task.
   * Invariant: Indexed != Needs Projection.
   */
  static evaluate(
    signature: TaskSignature,
    context: SelectiveRetrievalContext
  ): SelectiveRetrievalDecision {
    const prompt = signature.rawPrompt.toLowerCase()

    const knownFiles = context.knownFiles ?? []
    const explicitFileMentioned = knownFiles.find((f) => {
      const base = f.split("/").pop() ?? f
      return prompt.includes(base.toLowerCase())
    })

    const externalSymbols = signature.possibleSymbols.filter((s) => {
      if (!explicitFileMentioned) return true
      const sLower = s.toLowerCase()
      const fLower = explicitFileMentioned.toLowerCase()
      return sLower !== fLower && !fLower.endsWith(sLower)
    })

    if (explicitFileMentioned && externalSymbols.length === 0) {
      return {
        shouldRetrieve: false,
        reason: `Task is localized to explicit file '${explicitFileMentioned}' with no external candidate symbols; bypassing repository retrieval.`,
        bypassScope: Scope.path("root", explicitFileMentioned, signature.currentScope.revision),
      }
    }

    // Rule 2: Pure non-code / meta prompt
    if (signature.concepts.length === 0 && signature.possibleSymbols.length === 0) {
      return {
        shouldRetrieve: false,
        reason: "Prompt contains no identifiable domain concepts or code symbols; skipping repository retrieval.",
      }
    }

    return {
      shouldRetrieve: true,
      reason: `Task involves ${signature.concepts.length} concepts and ${signature.possibleSymbols.length} candidate symbols across phase '${signature.taskPhase}'.`,
    }
  }
}
