import { describe, expect, test } from "bun:test"
import { ProjectGraph } from "../../../src/rivet/repository/project-graph"
import { RepositoryCensusProjector } from "../../../src/rivet/repository/census"
import { ArchitectureSignalDetector, NoesisRepositoryIntegrator } from "../../../src/rivet/repository/architecture-signals"
import { HardState } from "../../../src/rivet/noesis"
import { createClaimId, Revision, Scope } from "../../../src/rivet/types"

describe("Noesis & Validity & Memory Admission Integration", () => {
  test("ProjectGraph delta invalidates Noesis dependent claims to DIRTY", () => {
    const hardState = new HardState()
    const claimId = createClaimId("claim_oauth_lock")

    hardState.apply({
      type: "claim_asserted",
      claimId,
      proposition: "RefreshCoordinator uses mutex serialization for token rotation",
      status: "supported",
      evidence: [],
      scope: Scope.global("rivet", Revision.ZERO),
      validityPolicy: "CURRENT_STATE",
      dependencies: [
        { type: "file", path: "packages/security/src/refresh.ts" },
      ],
      timestamp: new Date().toISOString(),
    })

    expect(hardState.claims.get(claimId)?.status).toBe("supported")

    // File modified -> ProjectGraph delta invalidates claim via ValidityEngine
    const impact = NoesisRepositoryIntegrator.applyGraphDeltaToValidity(
      hardState.validityGraph,
      hardState,
      ["packages/security/src/refresh.ts"]
    )

    expect(impact.allDirtyClaimIds).toContain(claimId)
  })

  test("ArchitectureSignalDetector identifies language migration and structural discontinuity", () => {
    const prevCensus = RepositoryCensusProjector.projectFromFiles(
      ["pyproject.toml", "src/auth.py"],
      Revision.from(1)
    )

    const currCensus = RepositoryCensusProjector.projectFromFiles(
      ["Cargo.toml", "src/lib.rs", "src/auth.rs"],
      Revision.from(2)
    )

    const signals = ArchitectureSignalDetector.detectDiscontinuities(prevCensus, currCensus)
    expect(signals.some((s) => s.type === "LANGUAGE_MIGRATION")).toBe(true)
    expect(signals[0]?.severity).toBe("CRITICAL")
  })

  test("Evaluates architecture drift to raise admission thresholds for stale memories", () => {
    const graph = new ProjectGraph()
    graph.addNode("symbol:RefreshCoordinator", "class", "RefreshCoordinator")

    const rustCensus = RepositoryCensusProjector.projectFromFiles(
      ["Cargo.toml", "src/lib.rs"],
      Revision.from(5)
    )

    const driftResult = NoesisRepositoryIntegrator.evaluateDriftForMemory(
      "Old Python AuthManager uses asyncio mutex",
      graph,
      rustCensus
    )

    expect(driftResult.isDrifted).toBe(true)
    expect(driftResult.penaltyScore).toBeGreaterThan(0.5)
    expect(driftResult.reason).toContain("Python")
  })
})
