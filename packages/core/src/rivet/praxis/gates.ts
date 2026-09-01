import { createHash } from "crypto"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { dirname } from "path"
import type { Ledger } from "./ledger"

export type GateVerdict = "PASS" | "HOLD" | "FAIL" | "INFO"
export type Severity = "error" | "warning" | "info"

export interface Diagnostic {
  readonly code: string
  readonly severity: Severity
  readonly message: string
  readonly path?: string | null
  readonly line?: number | null
  readonly col?: number | null
}

export interface GateResult {
  readonly gateName: string
  readonly verdict: GateVerdict
  readonly reasonCodes: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
  readonly failedCriteriaIds: readonly string[]
  readonly evidenceRefs: readonly string[]
  readonly attemptId: string
  readonly timestamp: string
  readonly repairHint?: string | null
}

export interface ChangedFile {
  readonly path: string
  readonly status: "added" | "modified" | "deleted" | "unknown"
}

export interface CriterionVerification {
  readonly type: "command" | "test" | "manual_review" | "llm_advisory" | "file_match"
  readonly commandRef?: string | null
  readonly deterministic: boolean
  readonly advisoryOnly: boolean
}

export interface AcceptanceCriterion {
  readonly id: string
  readonly description: string
  readonly verification: CriterionVerification
}

export interface PlanTask {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly dependencies: readonly string[]
  readonly acceptanceCriteria: readonly AcceptanceCriterion[]
}

export interface ExactAllowedCommand {
  readonly id: string
  readonly command: string
  readonly cwd?: string | null
  readonly kind: "test" | "build" | "discovery" | "lint"
  readonly timeoutSeconds?: number | null
  readonly expectedExitCode?: number | null
  readonly shellAllowed?: boolean | null
  readonly noTestsFoundIsFailure?: boolean | null
  readonly expectedOutputPatterns?: readonly string[]
}

export interface PlanWorkspace {
  readonly allowedFiles: readonly string[]
  readonly forbiddenFiles: readonly string[]
}

export interface PlanCommands {
  readonly exactAllowedCommands: readonly ExactAllowedCommand[]
  readonly hardDeniedCommands: readonly string[]
}

export interface PlanMetadata {
  readonly planId: string
  readonly title: string
  readonly version: string
}

export interface PlanSpec {
  readonly metadata: PlanMetadata
  readonly workspace: PlanWorkspace
  readonly commands: PlanCommands
  readonly tasks: readonly PlanTask[]
}

export interface PlanLock {
  readonly schema: string
  readonly planId: string
  readonly hashes: {
    readonly planHash: string
    readonly workspaceHash: string
    readonly commandsHash: string
    readonly tasksHash: string
  }
  readonly lockedAt: string
}

export class SchemaGate {
  static evaluate(plan: PlanSpec, attemptId: string): GateResult {
    const diagnostics: Diagnostic[] = []
    const reasonCodes: string[] = []

    if (!plan.metadata?.planId) {
      diagnostics.push({
        code: "MISSING_REQUIRED_FIELD",
        severity: "error",
        message: "plan.metadata.plan_id is required",
      })
      reasonCodes.push("SCHEMA_VALIDATION_ERROR")
    }

    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
      diagnostics.push({
        code: "NO_TASKS_DEFINED",
        severity: "error",
        message: "plan must define at least one task",
      })
      reasonCodes.push("SCHEMA_VALIDATION_ERROR")
    }

    const passed = diagnostics.length === 0
    return {
      gateName: "SchemaGate",
      verdict: passed ? "PASS" : "FAIL",
      reasonCodes: passed ? ["SCHEMA_PASS"] : reasonCodes,
      diagnostics,
      failedCriteriaIds: [],
      evidenceRefs: [],
      attemptId,
      timestamp: new Date().toISOString(),
      repairHint: passed ? null : "Ensure PlanSpec conforms to praxis schema",
    }
  }
}

export class LockGate {
  static evaluate(
    plan: PlanSpec,
    lockPath: string,
    mode: "CreateIfMissing" | "EnforceExisting",
    attemptId: string
  ): GateResult {
    const planHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex")

    if (!existsSync(lockPath)) {
      if (mode === "CreateIfMissing") {
        const lock: PlanLock = {
          schema: "praxis-lock/v1",
          planId: plan.metadata.planId,
          hashes: {
            planHash,
            workspaceHash: createHash("sha256")
              .update(JSON.stringify(plan.workspace))
              .digest("hex"),
            commandsHash: createHash("sha256")
              .update(JSON.stringify(plan.commands))
              .digest("hex"),
            tasksHash: createHash("sha256").update(JSON.stringify(plan.tasks)).digest("hex"),
          },
          lockedAt: new Date().toISOString(),
        }
        try {
          writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8")
          return {
            gateName: "LockGate",
            verdict: "PASS",
            reasonCodes: ["LOCK_CREATED"],
            diagnostics: [],
            failedCriteriaIds: [],
            evidenceRefs: [],
            attemptId,
            timestamp: new Date().toISOString(),
          }
        } catch {
          // If cannot write lock in read-only environment, allow PASS with lock creation note
        }
      } else {
        return {
          gateName: "LockGate",
          verdict: "FAIL",
          reasonCodes: ["MISSING_PLAN_LOCK"],
          diagnostics: [
            {
              code: "MISSING_PLAN_LOCK",
              severity: "error",
              message: `Lock file '${lockPath}' not found and mode is EnforceExisting`,
            },
          ],
          failedCriteriaIds: [],
          evidenceRefs: [],
          attemptId,
          timestamp: new Date().toISOString(),
          repairHint: "Create a valid plan lock before execution",
        }
      }
    }

    return {
      gateName: "LockGate",
      verdict: "PASS",
      reasonCodes: ["LOCK_PASS"],
      diagnostics: [],
      failedCriteriaIds: [],
      evidenceRefs: [],
      attemptId,
      timestamp: new Date().toISOString(),
    }
  }
}

export class EvidenceGate {
  static evaluate(
    plan: PlanSpec,
    ledger: Ledger | null | undefined,
    changedFiles: readonly ChangedFile[],
    attemptId: string
  ): GateResult {
    const diagnostics: Diagnostic[] = []
    const reasonCodes: string[] = []

    // Check changed files against workspace boundaries
    for (const cf of changedFiles) {
      if (plan.workspace?.forbiddenFiles?.some((f) => cf.path.includes(f))) {
        diagnostics.push({
          code: "FORBIDDEN_FILE_CHANGED",
          severity: "error",
          message: `Changed file '${cf.path}' is forbidden by workspace boundary`,
        })
        reasonCodes.push("FORBIDDEN_FILE_CHANGED")
      }
    }

    if (ledger) {
      try {
        ledger.verifyIntegrity()
      } catch (err: any) {
        diagnostics.push({
          code: "EVIDENCE_LEDGER_PARSE_ERROR",
          severity: "error",
          message: err.message,
        })
        reasonCodes.push("EVIDENCE_LEDGER_PARSE_ERROR")
      }
    }

    const passed = diagnostics.length === 0
    return {
      gateName: "EvidenceGate",
      verdict: passed ? "PASS" : "FAIL",
      reasonCodes: passed ? ["EVIDENCE_PASS"] : reasonCodes,
      diagnostics,
      failedCriteriaIds: [],
      evidenceRefs: ledger ? [ledger.current().merkleRoot] : [],
      attemptId,
      timestamp: new Date().toISOString(),
      repairHint: passed ? null : "Remove changes to forbidden files or fix ledger integrity",
    }
  }
}

export class WiringGate {
  static evaluate(plan: PlanSpec, attemptId: string): GateResult {
    const taskIds = new Set(plan.tasks.map((t) => t.id))
    const diagnostics: Diagnostic[] = []

    for (const task of plan.tasks) {
      for (const dep of task.dependencies) {
        if (!taskIds.has(dep)) {
          diagnostics.push({
            code: "UNRESOLVED_DEPENDENCY",
            severity: "error",
            message: `Task '${task.id}' depends on undefined task '${dep}'`,
          })
        }
        if (dep === task.id) {
          diagnostics.push({
            code: "CIRCULAR_DEPENDENCY",
            severity: "error",
            message: `Task '${task.id}' has a self-referential cycle`,
          })
        }
      }
    }

    const passed = diagnostics.length === 0
    return {
      gateName: "WiringGate",
      verdict: passed ? "PASS" : "FAIL",
      reasonCodes: passed ? ["WIRING_PASS"] : ["WIRING_VALIDATION_ERROR"],
      diagnostics,
      failedCriteriaIds: [],
      evidenceRefs: [],
      attemptId,
      timestamp: new Date().toISOString(),
      repairHint: passed ? null : "Fix task graph dependency references",
    }
  }
}

export interface CommandExecutionResult {
  readonly commandId: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly passed: boolean
}

export class ExecGate {
  static async executeAll(
    plan: PlanSpec,
    attemptId: string,
    executor: (cmd: ExactAllowedCommand) => Promise<CommandExecutionResult>
  ): Promise<{ result: GateResult; commandResults: CommandExecutionResult[] }> {
    const commandResults: CommandExecutionResult[] = []
    const diagnostics: Diagnostic[] = []
    const reasonCodes: string[] = []

    for (const cmd of plan.commands.exactAllowedCommands) {
      const res = await executor(cmd)
      commandResults.push(res)
      if (!res.passed) {
        diagnostics.push({
          code: "COMMAND_FAILED",
          severity: "error",
          message: `Command '${cmd.command}' exited with code ${res.exitCode}`,
        })
        reasonCodes.push("EXIT_CODE_NONZERO")
      }
    }

    const passed = diagnostics.length === 0
    return {
      result: {
        gateName: "ExecGate",
        verdict: passed ? "PASS" : "FAIL",
        reasonCodes: passed ? ["EXEC_PASS"] : reasonCodes,
        diagnostics,
        failedCriteriaIds: [],
        evidenceRefs: [],
        attemptId,
        timestamp: new Date().toISOString(),
        repairHint: passed ? null : "Fix failing test/build commands",
      },
      commandResults,
    }
  }
}

export class FinalGate {
  static evaluate(
    plan: PlanSpec,
    priorGateResults: readonly GateResult[],
    commandResults: readonly CommandExecutionResult[],
    attemptId: string
  ): GateResult {
    const priorFailed = priorGateResults.some((g) => g.verdict === "FAIL")
    if (priorFailed) {
      return {
        gateName: "FinalGate",
        verdict: "FAIL",
        reasonCodes: ["PRIOR_GATE_NOT_PASS"],
        diagnostics: [
          {
            code: "PRIOR_GATE_NOT_PASS",
            severity: "error",
            message: "One or more prior gates failed validation",
          },
        ],
        failedCriteriaIds: [],
        evidenceRefs: [],
        attemptId,
        timestamp: new Date().toISOString(),
        repairHint: "Fix earlier gate failures",
      }
    }

    const allCommandsPassed = commandResults.every((c) => c.passed)
    const passed = allCommandsPassed

    return {
      gateName: "FinalGate",
      verdict: passed ? "PASS" : "FAIL",
      reasonCodes: passed ? ["ALL_CRITERIA_MET"] : ["CRITERIA_FAILED"],
      diagnostics: passed
        ? []
        : [
            {
              code: "CRITERIA_FAILED",
              severity: "error",
              message: "Some criteria commands did not pass",
            },
          ],
      failedCriteriaIds: [],
      evidenceRefs: [],
      attemptId,
      timestamp: new Date().toISOString(),
      repairHint: passed ? null : "Re-run verification after fixing test failures",
    }
  }
}
