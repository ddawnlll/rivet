import { describe, expect, test } from "bun:test"
import {
  HardState,
  type NoesisEvent,
} from "../../src/rivet/noesis"
import {
  Revision,
  Scope,
  createClaimId,
  createEvidenceId,
} from "../../src/rivet/types"
import { EpistemicMaintenanceEngine } from "../../src/rivet/maintenance"

describe("Slow Epistemic Maintenance Engine Audit (Item 6)", () => {
  test("Detects unresolved DIRTY claims and emits revalidation proposals", () => {
    const scope = Scope.global("repo", Revision.ZERO)
    const claimId = createClaimId("dirty_claim")

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId,
        proposition: "Auth module uses token encryption",
        status: "supported",
        evidence: [],
        dependencies: [{ type: "file", path: "src/auth.ts" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_dirtied",
        claimId,
        reason: "src/auth.ts modified",
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)
    const audit = EpistemicMaintenanceEngine.audit(state, ["src/auth.ts"])

    expect(audit.unresolvedDirtyCount).toBe(1)
    expect(audit.proposals.length).toBeGreaterThan(0)
    const prop = audit.proposals.find((p) => p.targetClaimId === claimId && p.type === "revalidate_claim")
    expect(prop).toBeDefined()
    expect(prop?.reason).toContain("DIRTY state")
  })

  test("Detects weak/missing provenance on verified claims", () => {
    const scope = Scope.global("repo", Revision.ZERO)
    const unbackedClaim = createClaimId("unbacked")

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId: unbackedClaim,
        proposition: "Critical security patch applied",
        status: "verified",
        evidence: [],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)
    const audit = EpistemicMaintenanceEngine.audit(state)

    expect(audit.weakProvenanceCount).toBeGreaterThan(0)
    const prop = audit.proposals.find((p) => p.targetClaimId === unbackedClaim && p.type === "request_evidence")
    expect(prop).toBeDefined()
    expect(prop?.severity).toBe("critical")
  })

  test("Detects orphan dependencies for deleted files and missing claims", () => {
    const scope = Scope.global("repo", Revision.ZERO)
    const orphanFileClaim = createClaimId("orphan_file")
    const missingClaimDep = createClaimId("missing_parent_claim")
    const orphanClaimDep = createClaimId("orphan_dep")

    const ev1 = createEvidenceId("ev_legacy")
    const ev2 = createEvidenceId("ev_theorem")

    const events: NoesisEvent[] = [
      {
        type: "evidence_recorded",
        evidenceId: ev1,
        source: "file_audit",
        summary: "Found legacy.yaml",
        timestamp: new Date().toISOString(),
      },
      {
        type: "evidence_recorded",
        evidenceId: ev2,
        source: "proof",
        summary: "Proved theorem",
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: orphanFileClaim,
        proposition: "Config in legacy.yaml",
        status: "supported",
        evidence: [ev1],
        dependencies: [{ type: "file", path: "config/legacy.yaml" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: orphanClaimDep,
        proposition: "Derived theorem",
        status: "supported",
        evidence: [ev2],
        dependencies: [{ type: "claim", claimId: missingClaimDep }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)
    // Pass current workspace files without legacy.yaml
    const audit = EpistemicMaintenanceEngine.audit(state, ["src/index.ts", "package.json"])

    expect(audit.orphanDependencyCount).toBe(2)
    const fileProp = audit.proposals.find((p) => p.targetClaimId === orphanFileClaim && p.type === "stale_claim")
    const claimProp = audit.proposals.find((p) => p.targetClaimId === orphanClaimDep && p.type === "purge_orphan")
    expect(fileProp).toBeDefined()
    expect(claimProp).toBeDefined()
  })

  test("Detects cyclic supersession relationships without mutating HardState", () => {
    const scope = Scope.global("repo", Revision.ZERO)
    const c1 = createClaimId("c1")
    const c2 = createClaimId("c2")

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId: c1,
        proposition: "Database is MySQL",
        status: "superseded",
        evidence: [],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: c2,
        proposition: "Database is Postgres",
        status: "superseded",
        evidence: [],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_superseded",
        claimId: c1,
        supersededBy: c2,
        reason: "Migrated to Postgres",
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_superseded",
        claimId: c2,
        supersededBy: c1,
        reason: "Reverted back to MySQL",
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)
    const audit = EpistemicMaintenanceEngine.audit(state)

    expect(audit.brokenSupersessionCount).toBeGreaterThan(0)
    const cyclicProp = audit.proposals.find((p) => p.reason.includes("Cyclic supersession"))
    expect(cyclicProp).toBeDefined()
    expect(cyclicProp?.severity).toBe("critical")

    // State remains unchanged (audit is purely consultative and does not mutate HardState)
    expect(state.claims.get(c1)?.status).toBe("superseded")
    expect(state.claims.get(c2)?.status).toBe("superseded")
  })
})
