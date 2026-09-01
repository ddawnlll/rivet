export type ReframingStrategy =
  | "interface_contract_mismatch"
  | "clean_rewrite"
  | "scope_expansion"
  | "environment_rebuild"

export interface StagnationSignal {
  readonly consecutiveFailures: number
  readonly failureClusterId?: string | null
  readonly failedTargets: readonly string[]
  readonly timestamp: string
}

export interface ReframingProposal {
  readonly strategy: ReframingStrategy
  readonly suggestedFrame: string
  readonly discardedApproaches: readonly string[]
  readonly newHypothesisCandidates: readonly string[]
  readonly suggestedFocus: readonly string[]
  readonly suggestedPolicyRepair?: string | null
  readonly timestamp: string
}

export class FailureClusterTracker {
  consecutiveFailures = 0
  readonly targetFailureCounts: Map<string, number> = new Map()
  readonly lastErrors: string[] = []

  recordFailure(target: string, errorMsg: string): void {
    this.consecutiveFailures += 1
    const count = this.targetFailureCounts.get(target) ?? 0
    this.targetFailureCounts.set(target, count + 1)
    if (this.lastErrors.length >= 5) {
      this.lastErrors.shift()
    }
    this.lastErrors.push(errorMsg)
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
    this.targetFailureCounts.clear()
    this.lastErrors.length = 0
  }
}

export class HephaestusEngine {
  enabled = false
  failureThreshold: number

  constructor(threshold: number = 3) {
    this.failureThreshold = threshold
  }

  static enabled(threshold: number = 3): HephaestusEngine {
    const engine = new HephaestusEngine(threshold)
    engine.enabled = true
    return engine
  }

  static disabled(): HephaestusEngine {
    return new HephaestusEngine(3)
  }

  shouldIntervene(tracker: FailureClusterTracker): boolean {
    return this.enabled && tracker.consecutiveFailures >= this.failureThreshold
  }

  analyzeAndReframe(
    tracker: FailureClusterTracker,
    currentHypotheses: readonly string[]
  ): ReframingProposal {
    let strategy: ReframingStrategy
    let frame: string
    let newHyps: string[]

    const hasTypeOrSyntax = tracker.lastErrors.some(
      (e) => e.includes("cannot find") || e.includes("mismatched") || e.includes("SyntaxError")
    )
    const hasTimeout = tracker.lastErrors.some(
      (e) => e.includes("timed out") || e.includes("timeout")
    )

    if (hasTypeOrSyntax) {
      strategy = "interface_contract_mismatch"
      frame =
        "Repeated type or contract errors detected. Reset local assumptions and inspect underlying interfaces."
      newHyps = [
        "Interface or function signature does not match caller usage",
        "Missing import, export, or configuration flag",
      ]
    } else if (hasTimeout) {
      strategy = "environment_rebuild"
      frame =
        "Command execution timeout detected. Step back from full test suite to targeted unit tests."
      newHyps = ["Test suite is hanging on an infinite loop or external I/O call"]
    } else {
      strategy = "scope_expansion"
      frame = "Repeated local failure. Expand search scope beyond current target files."
      newHyps = [
        "Root cause is in an adjacent module, not the current target",
        "Clean rebuild and fresh test run needed",
      ]
    }

    const suggestedFocus = Array.from(tracker.targetFailureCounts.keys())
    let suggestedPolicyRepair: string | null = null

    if (strategy === "interface_contract_mismatch") {
      suggestedPolicyRepair =
        "Restrict action capability to inspect and search until interfaces are verified"
    } else if (strategy === "environment_rebuild") {
      suggestedPolicyRepair =
        "Enforce reduced command timeout bounds and require unit test scope before full suite execution"
    }

    return {
      strategy,
      suggestedFrame: frame,
      discardedApproaches: [...currentHypotheses],
      newHypothesisCandidates: newHyps,
      suggestedFocus,
      suggestedPolicyRepair,
      timestamp: new Date().toISOString(),
    }
  }
}
