import { createHash } from "crypto"
import {
  type EvidenceId,
  type ObligationId,
  type ReceiptId,
  type Scope,
  RivetError,
  createReceiptId,
} from "../types"

export type VerificationLevel =
  | "V0Syntax"
  | "V1StaticDiagnostics"
  | "V2Compile"
  | "V3TargetedTest"
  | "V4Integration"
  | "V5Regression"
  | "V6PlatformMatrix"
  | "V7DomainInvariant"

export interface ReviewPayload {
  readonly goalDescription: string
  readonly obligationId: ObligationId
  readonly scope: Scope
  readonly diffContent: string
  readonly evidenceRefs: readonly EvidenceId[]
  /**
   * Set to true if implementer reasoning / thought process was leaked into payload
   */
  readonly containsImplementerReasoning: boolean
}

export type ReviewVerdict =
  | {
      readonly status: "approved"
      readonly reviewReceiptId: ReceiptId
      readonly confidence: number
      readonly rationale: string
      readonly verifiedScope: Scope
      readonly timestamp: string
    }
  | {
      readonly status: "rejected"
      readonly reviewReceiptId: ReceiptId
      readonly reasons: readonly string[]
      readonly suggestedRepairs: readonly string[]
      readonly timestamp: string
    }
  | {
      readonly status: "needs_more_evidence"
      readonly missingRequirements: readonly string[]
      readonly timestamp: string
    }

export class BlindReviewerEngine {
  private reviewedHashes: Set<string> = new Set()

  async evaluateReview(payload: ReviewPayload): Promise<ReviewVerdict> {
    // Enforce Invariant I-08: Reviewer must be blind to implementer reasoning
    if (payload.containsImplementerReasoning) {
      throw new RivetError(
        "AuthorityDenied",
        "Invariant I-08 violation: reviewer payload contains implementer reasoning transcript. Independence compromised."
      )
    }

    if (!payload.diffContent.trim()) {
      return {
        status: "needs_more_evidence",
        missingRequirements: ["Empty patch diff; no code change presented for review"],
        timestamp: new Date().toISOString(),
      }
    }

    // Check for destructive operations or scope violations
    const reasons: string[] = []
    const suggestedRepairs: string[] = []

    if (
      payload.diffContent.includes("git reset --hard") ||
      payload.diffContent.includes("rm -rf /")
    ) {
      reasons.push("Destructive operation detected in patch payload")
      suggestedRepairs.push("Replace destructive reset with targeted revert")
    }

    // Scope check in diff lines
    const lines = payload.diffContent.split(/\r?\n/)
    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        const filePath = line.slice("+++ b/".length).trim()
        if (
          !payload.scope.allowsPath(
            payload.scope.repository,
            filePath,
            payload.scope.revision
          )
        ) {
          reasons.push(
            `File '${filePath}' is outside declared write scope ${payload.scope.toString()}`
          )
          suggestedRepairs.push(
            `Restrict changes to files inside scope ${payload.scope.toString()}`
          )
        }
      }
    }

    if (reasons.length > 0) {
      return {
        status: "rejected",
        reviewReceiptId: createReceiptId(),
        reasons,
        suggestedRepairs,
        timestamp: new Date().toISOString(),
      }
    }

    // Invariant I-14 check: Calculate review hash to detect duplicate/correlated reviews
    const hasher = createHash("sha256")
    hasher.update(payload.diffContent)
    hasher.update(payload.obligationId)
    const hash = hasher.digest("hex")

    const isDuplicate = this.reviewedHashes.has(hash)
    this.reviewedHashes.add(hash)

    // If duplicate, do not inflate confidence
    const confidence = isDuplicate ? 0.5 : 0.95

    return {
      status: "approved",
      reviewReceiptId: createReceiptId(),
      confidence,
      rationale: isDuplicate
        ? "Approved (Warning: duplicate review detected; evidence confidence not inflated per I-14)"
        : "Independent blind review passed all structural and scope checks",
      verifiedScope: payload.scope,
      timestamp: new Date().toISOString(),
    }
  }
}
