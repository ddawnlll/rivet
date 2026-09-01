import { join } from "path"
import type { VerificationReceipt } from "../accp"
import { Revision, Scope, createEvidenceId, createObligationId, createReceiptId } from "../types"
import {
  type ChangedFile,
  type CommandExecutionResult,
  EvidenceGate,
  ExecGate,
  FinalGate,
  type GateResult,
  type GateVerdict,
  LockGate,
  type PlanSpec,
  SchemaGate,
  WiringGate,
} from "./gates"
import type { Ledger } from "./ledger"

export interface VerityPipelineResult {
  readonly overallVerdict: GateVerdict
  readonly gateResults: readonly GateResult[]
  readonly finalReceipt?: VerificationReceipt | null
  readonly executionDurationMs: number
  readonly timestamp: string
}

export class VerityPipeline {
  readonly repoRoot: string
  readonly lockMode: "CreateIfMissing" | "EnforceExisting"

  constructor(repoRoot: string, lockMode: "CreateIfMissing" | "EnforceExisting" = "CreateIfMissing") {
    this.repoRoot = repoRoot
    this.lockMode = lockMode
  }

  async run(
    plan: PlanSpec,
    ledger: Ledger | null | undefined,
    changedFiles: readonly ChangedFile[],
    attemptId: string,
    executor: (cmd: any) => Promise<CommandExecutionResult>
  ): Promise<VerityPipelineResult> {
    const start = Date.now()
    const gateResults: GateResult[] = []

    // 1. SchemaGate
    const g1 = SchemaGate.evaluate(plan, attemptId)
    gateResults.push(g1)

    // 2. LockGate
    const sanitizedId = plan.metadata.planId.replace(/[^a-zA-Z0-9_-]/g, "_")
    const lockPath = join(this.repoRoot, ".praxis", `${sanitizedId}.lock.json`)
    const g2 = LockGate.evaluate(plan, lockPath, this.lockMode, attemptId)
    gateResults.push(g2)

    // 3. EvidenceGate
    const g3 = EvidenceGate.evaluate(plan, ledger, changedFiles, attemptId)
    gateResults.push(g3)

    // 4. WiringGate
    const g4 = WiringGate.evaluate(plan, attemptId)
    gateResults.push(g4)

    // 5. ExecGate
    const prerequisitesPass = gateResults.every((g) => g.verdict === "PASS")
    let commandResults: CommandExecutionResult[] = []

    if (prerequisitesPass) {
      const { result, commandResults: crs } = await ExecGate.executeAll(plan, attemptId, executor)
      gateResults.push(result)
      commandResults = crs
    } else {
      gateResults.push({
        gateName: "ExecGate",
        verdict: "HOLD",
        reasonCodes: ["PRIOR_GATE_NOT_PASS"],
        diagnostics: [
          {
            code: "PRIOR_GATE_NOT_PASS",
            severity: "warning",
            message: "ExecGate skipped because prerequisite gate did not PASS",
          },
        ],
        failedCriteriaIds: [],
        evidenceRefs: [],
        attemptId,
        timestamp: new Date().toISOString(),
      })
    }

    // 6. FinalGate
    const gFinal = FinalGate.evaluate(plan, gateResults, commandResults, attemptId)
    gateResults.push(gFinal)

    const overallVerdict = gFinal.verdict
    const executionDurationMs = Date.now() - start

    const finalReceipt: VerificationReceipt | null =
      overallVerdict === "PASS"
        ? {
            receiptId: createReceiptId(),
            obligationId: createObligationId(),
            passed: true,
            evidenceId: createEvidenceId(),
            verifiedScope: Scope.global("repo", Revision.ZERO),
            diagnostics: null,
            timestamp: new Date().toISOString(),
          }
        : null

    return {
      overallVerdict,
      gateResults,
      finalReceipt,
      executionDurationMs,
      timestamp: new Date().toISOString(),
    }
  }
}
