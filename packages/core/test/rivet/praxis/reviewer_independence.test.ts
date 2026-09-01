import { describe, expect, test } from "bun:test"
import { BlindReviewerEngine, type ReviewPayload } from "../../../src/rivet/praxis/reviewer"
import {
  Revision,
  Scope,
  createObligationId,
  createEvidenceId,
} from "../../../src/rivet/types"

describe("Blind Reviewer Independence & Non-Inflation (I-08, I-14)", () => {
  test("Invariant I-08: Leaking implementer reasoning into review payload is rejected immediately", async () => {
    const engine = new BlindReviewerEngine()
    const payload: ReviewPayload = {
      goalDescription: "Fix security bug",
      obligationId: createObligationId(),
      scope: Scope.global("rivet", Revision.ZERO),
      diffContent: "--- a/lib.ts\n+++ b/lib.ts\n@@ -1 +1 @@\n-old\n+new",
      evidenceRefs: [createEvidenceId()],
      containsImplementerReasoning: true, // Leaked thought process
    }

    expect(engine.evaluateReview(payload)).rejects.toThrow(
      /Invariant I-08 violation/
    )
  })

  test("Invariant I-14: Duplicate reviews detect correlation and do not inflate confidence", async () => {
    const engine = new BlindReviewerEngine()
    const obligationId = createObligationId()
    const diff = "--- a/lib.ts\n+++ b/lib.ts\n@@ -1 +1 @@\n-old\n+new"

    const payload: ReviewPayload = {
      goalDescription: "Fix security bug",
      obligationId,
      scope: Scope.path("rivet", "lib.ts", Revision.ZERO),
      diffContent: diff,
      evidenceRefs: [createEvidenceId()],
      containsImplementerReasoning: false,
    }

    const firstVerdict = await engine.evaluateReview(payload)
    expect(firstVerdict.status).toBe("approved")
    if (firstVerdict.status === "approved") {
      expect(firstVerdict.confidence).toBe(0.95)
    }

    // Submit identical duplicate review
    const secondVerdict = await engine.evaluateReview(payload)
    expect(secondVerdict.status).toBe("approved")
    if (secondVerdict.status === "approved") {
      expect(secondVerdict.confidence).toBe(0.5) // Reduced confidence, no inflation
      expect(secondVerdict.rationale).toContain("duplicate review detected")
    }
  })

  test("Destructive commands in diff are rejected by blind reviewer", async () => {
    const engine = new BlindReviewerEngine()
    const payload: ReviewPayload = {
      goalDescription: "Fix bug",
      obligationId: createObligationId(),
      scope: Scope.global("rivet", Revision.ZERO),
      diffContent: "+++ b/run.sh\n+rm -rf /",
      evidenceRefs: [],
      containsImplementerReasoning: false,
    }

    const verdict = await engine.evaluateReview(payload)
    expect(verdict.status).toBe("rejected")
    if (verdict.status === "rejected") {
      expect(verdict.reasons[0]).toContain("Destructive operation")
    }
  })
})
