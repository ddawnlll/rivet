import {
  type ObligationId,
  type ObligationKind,
  type ReceiptId,
  Revision,
  Scope,
  type TaskId,
  createObligationId,
  createTaskId,
} from "./types"
import { TurnAdmissionGate } from "./turn-admission"

export type ObligationStatus = "open" | "satisfied" | "violated" | "waived"


export type ObligationPredicate =
  | {
      readonly type: "command_pass"
      readonly command: string
      readonly expectedExitCode: number
    }
  | {
      readonly type: "file_constraint"
      readonly path: string
      readonly mustExist: boolean
      readonly contentPattern?: string | null
    }
  | {
      readonly type: "claims_verified"
      readonly claimPropositions: readonly string[]
    }
  | {
      readonly type: "human_approval"
      readonly prompt: string
    }

export interface ObligationNode {
  readonly id: ObligationId
  readonly title: string
  readonly description: string
  readonly targetScope: Scope
  readonly predicate: ObligationPredicate
  readonly kind: ObligationKind
  status: ObligationStatus
  readonly dependencies: readonly ObligationId[]
  receiptId?: ReceiptId | null
  readonly createdAt: string
}

export class ObligationGraph {
  readonly nodes: Map<ObligationId, ObligationNode> = new Map()

  addObligation(node: ObligationNode): void {
    this.nodes.set(node.id, node)
  }

  isAllSatisfied(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status !== "satisfied" && node.status !== "waived") {
        return false
      }
    }
    return true
  }

  openObligations(): ObligationNode[] {
    const list: ObligationNode[] = []
    for (const node of this.nodes.values()) {
      if (node.status === "open") {
        list.push(node)
      }
    }
    return list
  }

  markSatisfied(id: ObligationId, receipt: ReceiptId): boolean {
    const node = this.nodes.get(id)
    if (!node) return false
    node.status = "satisfied"
    node.receiptId = receipt
    return true
  }
}

const COMMON_FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "rs", "py", "json", "md", "toml", "yaml", "yml",
  "css", "scss", "html", "sh", "bash", "zsh", "sql", "go", "c", "cpp", "h", "hpp",
  "txt", "lock", "proto", "graphql", "wasm", "dockerfile", "env",
])

export function isValidFilePathCandidate(candidate: string): boolean {
  if (candidate.length <= 3) return false
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) return false
  if (candidate.endsWith(".") || candidate.endsWith("/") || candidate.endsWith("-")) return false
  if (/^\d+(?:\.\d+)+$/.test(candidate)) return false
  if (["e.g.", "i.e.", "etc.", "vs."].includes(candidate.toLowerCase())) return false
  // Single-segment slash tokens ("/goal", "/inquiry") are command markers,
  // never file targets; only multi-segment or dotted tokens can be paths.
  if (candidate.startsWith("/") && !candidate.slice(1).includes("/")) return false

  if (candidate.includes("/")) {
    if (candidate.includes("..") && !candidate.startsWith("../") && !candidate.startsWith("./")) return false
    // Slash alone is not evidence of a path ("and/or", "2024/01/15"). The
    // basename must itself look like a real file for a mustExist constraint.
    const base = candidate.slice(candidate.lastIndexOf("/") + 1)
    return isValidFilePathCandidate(base)
  }

  const dotIndex = candidate.lastIndexOf(".")
  if (dotIndex > 0 && dotIndex < candidate.length - 1) {
    const ext = candidate.slice(dotIndex + 1).toLowerCase()
    return COMMON_FILE_EXTENSIONS.has(ext)
  }

  return false
}

export function classifyGoalKind(userPrompt: string): ObligationKind {
  const trimmed = userPrompt.trim()
  if (trimmed.startsWith("/inquiry") || trimmed.startsWith("/ask")) {
    return "epistemic_inquiry"
  }
  const admission = TurnAdmissionGate.classify(trimmed)
  return admission.obligationKind ?? (admission.shouldCreateObligation ? "execution" : "epistemic_inquiry")
}

export interface GoalSpec {
  readonly goalId: TaskId
  readonly summary: string
  readonly targetScope: Scope
  readonly graph: ObligationGraph
  readonly rawPrompt: string
}

export class GoalCompiler {
  static compile(
    userPrompt: string,
    repoName: string,
    currentRevision: Revision,
    kind: ObligationKind = classifyGoalKind(userPrompt),
  ): GoalSpec {
    const goalId = createTaskId()
    const graph = new ObligationGraph()

    const rootOblgId = createObligationId()
    const rootScope = Scope.global(repoName, currentRevision)

    const predicate: ObligationPredicate = {
      type: "claims_verified",
      claimPropositions: [`Goal '${userPrompt}' fulfilled`],
    }

    const rootKind = kind

    graph.addObligation({
      id: rootOblgId,
      title: "Fulfill requested goal requirements",
      description: userPrompt,
      targetScope: rootScope,
      predicate,
      kind: rootKind,
      status: "open",
      dependencies: [],
      receiptId: null,
      createdAt: new Date().toISOString(),
    })

    // Detect mentioned files only for non-inquiry execution goals
    if (rootKind !== "epistemic_inquiry") {
      const words = userPrompt.split(/\s+/)
      const seenPaths = new Set<string>()
      for (const word of words) {
        if ((word.includes(".") || word.includes("/")) && !word.startsWith("http")) {
          const cleanPath = word
            .replace(/^[^\w.~/-]+|[^\w.~/-]+$/g, "")
            .replace(/[.,;:!?()\[\]{}"']+$/g, "")
            .replace(/^[.,;:!?()\[\]{}"']+/g, "")
          if (seenPaths.has(cleanPath)) continue
          if (isValidFilePathCandidate(cleanPath)) {
            seenPaths.add(cleanPath)
            const fileOblgId = createObligationId()
            graph.addObligation({
              id: fileOblgId,
              title: `Ensure target path '${cleanPath}' is maintained`,
              description: `File constraint for ${cleanPath}`,
              targetScope: Scope.path(repoName, cleanPath, currentRevision),
              predicate: {
                type: "file_constraint",
                path: cleanPath,
                mustExist: true,
                contentPattern: null,
              },
              kind: "execution",
              status: "open",
              dependencies: [],
              receiptId: null,
              createdAt: new Date().toISOString(),
            })
          }
        }
      }
    }

    return {
      goalId,
      summary: userPrompt,
      targetScope: rootScope,
      graph,
      rawPrompt: userPrompt,
    }
  }
}
