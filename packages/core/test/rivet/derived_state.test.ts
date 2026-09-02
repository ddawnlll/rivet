import { describe, expect, test } from "bun:test"
import { DerivedStateProjector } from "../../src/rivet/derived-state"
import { HardState } from "../../src/rivet/noesis"
import { Revision, Scope, createClaimId } from "../../src/rivet/types"

describe("DERIVED_STATE & Non-Fossilized Projection Audit (Item 2)", () => {
  test("Live environment census dynamically projects primary languages and manifests", () => {
    const files = [
      "Cargo.toml",
      "src/main.rs",
      "src/engine.rs",
      "README.md",
    ]

    const census = DerivedStateProjector.projectFromFiles(files, Revision.from(1))
    expect(census.primaryLanguages).toContain("Rust")
    expect(census.manifestFiles).toContain("Cargo.toml")
    expect(census.buildSystems).toContain("cargo")

    const facts = DerivedStateProjector.generateDerivedFacts(census, Revision.from(1))
    expect(facts.some((f) => f.property === "primary_language" && f.value.includes("Rust"))).toBe(true)
  })

  test("DERIVED_STATE claims in HardState are invalidated when live projections disagree", () => {
    const scope = Scope.global("repo", Revision.ZERO)
    const pythonClaimId = createClaimId("c_py_derived")

    const state = new HardState()
    state.apply({
      type: "claim_asserted",
      claimId: pythonClaimId,
      proposition: "Primary implementation language is Python",
      status: "supported",
      evidence: [],
      dependencies: [{ type: "manifest", name: "pyproject.toml" }],
      validityPolicy: "DERIVED_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    const claim = state.claims.get(pythonClaimId)!

    // Current repository has rewritten to Rust (Cargo.toml, src/main.rs)
    const rustFiles = ["Cargo.toml", "src/main.rs"]
    const liveCensus = DerivedStateProjector.projectFromFiles(rustFiles, Revision.from(2))

    const validation = DerivedStateProjector.validateDerivedClaim(claim, liveCensus)
    expect(validation.isValid).toBe(false)
    expect(validation.reason).toContain("Derived state mismatch")
  })
})
