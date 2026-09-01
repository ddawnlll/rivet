import {
  type ObligationId,
  type ReceiptId,
  Revision,
  Scope,
  type TaskId,
  createObligationId,
  createTaskId,
} from "./types"

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
    currentRevision: Revision
  ): GoalSpec {
    const goalId = createTaskId()
    const graph = new ObligationGraph()
    const promptLower = userPrompt.toLowerCase()

    const rootOblgId = createObligationId()
    const rootScope = Scope.global(repoName, currentRevision)

    let predicate: ObligationPredicate
    if (
      promptLower.includes("test") ||
      promptLower.includes("verify") ||
      promptLower.includes("fix")
    ) {
      predicate = {
        type: "command_pass",
        command: "bun test",
        expectedExitCode: 0,
      }
    } else {
      predicate = {
        type: "claims_verified",
        claimPropositions: [`Goal '${userPrompt}' fulfilled`],
      }
    }

    graph.addObligation({
      id: rootOblgId,
      title: "Fulfill requested goal requirements",
      description: userPrompt,
      targetScope: rootScope,
      predicate,
      status: "open",
      dependencies: [],
      receiptId: null,
      createdAt: new Date().toISOString(),
    })

    // Detect mentioned files
    const words = userPrompt.split(/\s+/)
    for (const word of words) {
      if ((word.includes(".") || word.includes("/")) && !word.startsWith("http")) {
        const cleanPath = word.replace(/^[^\w./-]+|[^\w./-]+$/g, "")
        if (cleanPath.length > 3) {
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
            status: "open",
            dependencies: [],
            receiptId: null,
            createdAt: new Date().toISOString(),
          })
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
