import { describe, expect, test } from "bun:test"
import {
  CognitiveViewCompiler,
  type CompilationContext,
} from "../../src/rivet/view-compiler"
import { HardState, SoftWorkspace } from "../../src/rivet/noesis"
import {
  Revision,
  Scope,
  createClaimId,
  createEvidenceId,
  createObligationId,
  createSessionId,
} from "../../src/rivet/types"

describe("Cognitive View Compiler Pipeline & Modes", () => {
  test("Compiles and renders all 4 representation modes: RAW_TEXT, TRIPLES, PATHS, HYBRID", () => {
    const hardState = new HardState()
    const claimId = createClaimId()
    const obligationId = createObligationId()
    const evidenceId = createEvidenceId()

    hardState.apply({
      type: "evidence_recorded",
      evidenceId,
      source: "test_output",
      summary: "cargo test pass",
      timestamp: new Date().toISOString(),
    })

    hardState.apply({
      type: "claim_asserted",
      claimId,
      proposition: "System compiles without errors",
      status: "supported",
      evidence: [evidenceId],
      scope: Scope.global("rivet", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })

    hardState.apply({
      type: "obligation_created",
      obligationId,
      description: "Must verify unit tests",
      scope: Scope.global("rivet", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })

    const softWorkspace = new SoftWorkspace(createSessionId(), Revision.ZERO)
    softWorkspace.setFocus(["compiler optimization"])
    softWorkspace.addHypothesis("AST representation speeds up analysis")

    const modes: ("RAW_TEXT" | "TRIPLES" | "PATHS" | "HYBRID")[] = [
      "RAW_TEXT",
      "TRIPLES",
      "PATHS",
      "HYBRID",
    ]

    for (const mode of modes) {
      const ctx: CompilationContext = {
        hardState,
        softWorkspace,
        goalDescription: "Verify compiler pipeline",
        repositoryId: "rivet",
        relevantFiles: ["src/lib.ts"],
        repositorySignals: ["typescript: 100%"],
        tokenBudget: 2000,
        mode,
        deferredTreesCount: 2,
      }

      const compiled = CognitiveViewCompiler.compile(ctx)
      const rendered = CognitiveViewCompiler.render(compiled)

      expect(typeof rendered).toBe("string")
      expect(rendered.length).toBeGreaterThan(0)

      if (mode === "RAW_TEXT") {
        expect(rendered).toContain("=== COGNITIVE STATE (RAW TEXT) ===")
        expect(rendered).toContain("System compiles without errors")
      } else if (mode === "TRIPLES") {
        expect(rendered).toContain("TRIPLES MODE")
        expect(rendered).toContain("epistemic_status")
      } else if (mode === "PATHS") {
        expect(rendered).toContain("PATHS MODE")
      } else if (mode === "HYBRID") {
        expect(rendered).toContain("```yaml")
        expect(rendered).toContain("hard_revision")
      }
    }
  })
})
