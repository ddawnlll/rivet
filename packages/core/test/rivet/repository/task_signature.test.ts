import { describe, expect, test } from "bun:test"
import { TaskSignatureCompiler, SelectiveRetrievalGate } from "../../../src/rivet/repository/task-signature"
import { HardState, SoftWorkspace } from "../../../src/rivet/noesis"
import { createSessionId, Scope, Revision } from "../../../src/rivet/types"

describe("TaskSignature & SelectiveRetrievalGate", () => {
  test("Compiles domain concepts, candidate symbols, and task phase", () => {
    const hardState = new HardState()
    hardState.apply({
      type: "obligation_created",
      obligationId: "oblg_1" as any,
      description: "Ensure OAuth refresh token concurrency is non-blocking",
      scope: Scope.global("rivet", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })

    const softWorkspace = new SoftWorkspace(createSessionId(), Revision.ZERO)
    softWorkspace.activeFocus.push("TokenProvider")

    const signature = TaskSignatureCompiler.compile({
      userPrompt: "OAuth refresh occasionally deadlocks under concurrency in RefreshCoordinator",
      hardState,
      softWorkspace,
    })

    expect(signature.concepts).toContain("oauth")
    expect(signature.concepts).toContain("refresh")
    expect(signature.concepts).toContain("deadlocks")
    expect(signature.possibleSymbols).toContain("RefreshCoordinator")
    expect(signature.taskPhase).toBe("diagnosis")
    expect(signature.relevantObligations).toContain("oblg_1" as any)
    expect(signature.softWorkspaceFocus).toContain("TokenProvider")
  })

  test("SelectiveRetrievalGate skips retrieval for trivial localized edits (Indexed != Needs Projection)", () => {
    const signature = TaskSignatureCompiler.compile({
      userPrompt: "Fix typo in README.md title",
    })

    const decision = SelectiveRetrievalGate.evaluate(signature, {
      userPrompt: "Fix typo in README.md title",
      knownFiles: ["README.md", "src/index.ts"],
    })

    expect(decision.shouldRetrieve).toBe(false)
    expect(decision.reason).toContain("bypassing repository retrieval")
    expect(decision.bypassScope).toBeDefined()
  })

  test("SelectiveRetrievalGate activates retrieval for multi-symbol brownfield tasks", () => {
    const signature = TaskSignatureCompiler.compile({
      userPrompt: "Refactor RefreshCoordinator to use TokenProvider rotating mutex",
    })

    const decision = SelectiveRetrievalGate.evaluate(signature, {
      userPrompt: "Refactor RefreshCoordinator to use TokenProvider rotating mutex",
      knownFiles: ["packages/core/src/auth.ts"],
    })

    expect(decision.shouldRetrieve).toBe(true)
    expect(decision.reason).toContain("candidate symbols")
  })
})
