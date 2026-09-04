import { createHash } from "crypto"
import {
  type EvidenceId,
  type ObligationId,
  type ReceiptId,
  type Scope,
  createEvidenceId,
  createReceiptId,
} from "./types"
import type { VerificationReceipt, VerificationRequest } from "./accp"

export interface ParsedTestReport {
  readonly passedCount: number
  readonly failedCount: number
  readonly skippedCount: number
  readonly rawStdout: string
  readonly rawStderr: string
}

export class CargoTestParser {
  static parse(stdout: string, stderr: string = ""): ParsedTestReport {
    let passed = 0
    let failed = 0
    let skipped = 0

    // Match lines like: test result: ok. 2 passed; 0 failed; 0 ignored;
    const summaryMatch = stdout.match(
      /test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/
    )
    if (summaryMatch) {
      passed = parseInt(summaryMatch[1], 10)
      failed = parseInt(summaryMatch[2], 10)
      skipped = parseInt(summaryMatch[3], 10)
    } else {
      // Fallback line-by-line counting
      const lines = stdout.split("\n")
      for (const line of lines) {
        if (line.endsWith("... ok")) passed++
        else if (line.endsWith("... FAILED")) failed++
        else if (line.endsWith("... ignored")) skipped++
      }
    }

    return {
      passedCount: passed,
      failedCount: failed,
      skippedCount: skipped,
      rawStdout: stdout,
      rawStderr: stderr,
    }
  }
}

export class BunTestParser {
  static parse(stdout: string, stderr: string = ""): ParsedTestReport {
    let passed = 0
    let failed = 0
    let skipped = 0

    // Match lines like: 6 pass \n 0 fail
    const passMatch = stdout.match(/(\d+)\s+pass/)
    const failMatch = stdout.match(/(\d+)\s+fail/)
    const skipMatch = stdout.match(/(\d+)\s+skip/)

    if (passMatch) passed = parseInt(passMatch[1], 10)
    if (failMatch) failed = parseInt(failMatch[1], 10)
    if (skipMatch) skipped = parseInt(skipMatch[1], 10)

    return {
      passedCount: passed,
      failedCount: failed,
      skippedCount: skipped,
      rawStdout: stdout,
      rawStderr: stderr,
    }
  }
}

export class PytestParser {
  static parse(stdout: string, stderr: string = ""): ParsedTestReport {
    let passed = 0
    let failed = 0
    let skipped = 0

    const passMatch = stdout.match(/(\d+)\s+passed/)
    const failMatch = stdout.match(/(\d+)\s+failed/)
    const skipMatch = stdout.match(/(\d+)\s+skipped/)

    if (passMatch) passed = parseInt(passMatch[1], 10)
    if (failMatch) failed = parseInt(failMatch[1], 10)
    if (skipMatch) skipped = parseInt(skipMatch[1], 10)

    return {
      passedCount: passed,
      failedCount: failed,
      skippedCount: skipped,
      rawStdout: stdout,
      rawStderr: stderr,
    }
  }
}

export class GoTestParser {
  static parse(stdout: string, stderr: string = ""): ParsedTestReport {
    let passed = 0
    let failed = 0
    let skipped = 0

    const lines = stdout.split("\n")
    for (const line of lines) {
      if (line.startsWith("--- PASS:")) passed++
      else if (line.startsWith("--- FAIL:")) failed++
      else if (line.startsWith("--- SKIP:")) skipped++
    }

    return {
      passedCount: passed,
      failedCount: failed,
      skippedCount: skipped,
      rawStdout: stdout,
      rawStderr: stderr,
    }
  }
}

export class MerkleTree {
  static hashLeaf(data: string): string {
    return createHash("sha256").update(`00${data}`).digest("hex")
  }

  static hashNode(left: string, right: string): string {
    return createHash("sha256").update(`01${left}${right}`).digest("hex")
  }

  static rootFromHashes(hashes: readonly string[]): string {
    if (hashes.length === 0) return MerkleTree.hashLeaf("")
    if (hashes.length === 1) return hashes[0]

    let current = [...hashes]
    while (current.length > 1) {
      const nextLevel: string[] = []
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          nextLevel.push(MerkleTree.hashNode(current[i], current[i + 1]))
        } else {
          nextLevel.push(current[i])
        }
      }
      current = nextLevel
    }
    return current[0]
  }
}

export interface BasicGateResult {
  readonly gateName: string
  readonly passed: boolean
  readonly reason: string
}

export class PraxisEngine {
  static parseTestOutput(
    framework: "cargo" | "bun" | "jest" | "pytest" | "go",
    stdout: string,
    stderr: string = ""
  ): ParsedTestReport {
    switch (framework) {
      case "cargo":
        return CargoTestParser.parse(stdout, stderr)
      case "bun":
      case "jest":
        return BunTestParser.parse(stdout, stderr)
      case "pytest":
        return PytestParser.parse(stdout, stderr)
      case "go":
        return GoTestParser.parse(stdout, stderr)
    }
  }

  static evaluateTestResult(
    req: VerificationRequest,
    report: ParsedTestReport
  ): VerificationReceipt {
    const passed = report.failedCount === 0 && report.passedCount > 0
    const reasonCodes: string[] = passed
      ? ["TESTS_PASSED"]
      : report.failedCount > 0
        ? ["TESTS_FAILED"]
        : ["NO_PASSING_TESTS"]
    const diagnostics = !passed
      ? `Praxis test verification failed: ${report.passedCount} passed, ${report.failedCount} failed, ${report.skippedCount} skipped`
      : null

    return {
      receiptId: createReceiptId(),
      obligationId: req.obligationId,
      passed,
      evidenceId: createEvidenceId(),
      verifiedScope: req.targetScope,
      predicate: req.predicate,
      diagnostics,
      reasonCodes,
      timestamp: new Date().toISOString(),
    }
  }

  static evaluateGates(options: {
    schemaValid: boolean
    locksValid: boolean
    evidenceReferenced: boolean
    executionSuccess: boolean
    testsPassed: boolean
  }): BasicGateResult[] {
    return [
      {
        gateName: "SchemaGate",
        passed: options.schemaValid,
        reason: options.schemaValid ? "Schema compliant" : "Schema violation detected",
      },
      {
        gateName: "LockGate",
        passed: options.locksValid,
        reason: options.locksValid ? "Scope locks acquired" : "Lock conflict",
      },
      {
        gateName: "EvidenceGate",
        passed: options.evidenceReferenced,
        reason: options.evidenceReferenced
          ? "Evidence references verified"
          : "Missing or invalid evidence references",
      },
      {
        gateName: "ExecGate",
        passed: options.executionSuccess,
        reason: options.executionSuccess ? "Execution succeeded" : "Execution failed",
      },
      {
        gateName: "FinalGate",
        passed:
          options.schemaValid &&
          options.locksValid &&
          options.evidenceReferenced &&
          options.executionSuccess &&
          options.testsPassed,
        reason: options.testsPassed ? "All gates passed" : "Verification requirements not met",
      },
    ]
  }
}
