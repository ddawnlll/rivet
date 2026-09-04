import { describe, expect, test } from "bun:test"
import { projectRivetState } from "../../src/rivet/projection"
import type { ToolPart } from "@opencode-ai/sdk/v2"

describe("Rivet UI Projection", () => {
  test("Scenario A — Active coding: projects goal, relevant files, changed files, obligations, and implementing phase", () => {
    const projection = projectRivetState({
      sessionID: "ses_1",
      title: "Fix refresh race in coordinator",
      sessionStatus: "busy",
      changedFiles: [
        { file: "packages/security/src/refresh.ts", additions: 18, deletions: 2, status: "modified" },
      ],
      parts: [
        {
          id: "p1",
          type: "tool",
          tool: "edit",
          state: {
            status: "completed",
            input: { filePath: "packages/security/src/refresh.ts" },
          },
        } as unknown as ToolPart,
        {
          id: "p2",
          type: "tool",
          tool: "request_completion",
          state: {
            status: "completed",
            metadata: {
              obligations: [
                { id: "ob_1", description: "reproduction unit test" },
                { id: "ob_2", description: "concurrency stress test" },
              ],
            },
          },
        } as unknown as ToolPart,
      ],
    })

    expect(projection.goal).toBe("Fix refresh race in coordinator")
    expect(projection.statusRail.changedFileCount).toBe(1)
    expect(projection.obligations.length).toBe(2)
    expect(projection.completion.status).toBe("blocked")
    expect(projection.completion.remainingCount).toBe(2)
    expect(projection.code.relevantFiles.some((f) => f.path.includes("refresh.ts"))).toBe(true)
  })

  test("Scenario B — Memory suppression: projects cognitive admission decisions and plain-language reasons", () => {
    const projection = projectRivetState({
      sessionID: "ses_2",
      metadata: {
        rivet: {
          memory: [
            {
              id: "mem_1",
              kind: "procedure",
              summary: "Previous streaming leak was fixed using try/finally",
              relevance: "high",
              used: true,
            },
            {
              id: "mem_2",
              kind: "provisional",
              summary: "Maybe TCP keepalive causes starvation",
              used: false,
              whyIgnored: [
                "old hypothesis",
                "current task is debugging",
                "never verified",
              ],
            },
            {
              id: "mem_3",
              kind: "historical",
              summary: "AuthManager mutex implementation",
              used: false,
              whyIgnored: [
                "implementation no longer exists",
                "repository architecture changed",
              ],
            },
          ],
        },
      },
    })

    expect(projection.memory.length).toBe(3)
    const used = projection.memory.filter((m) => m.used)
    const ignored = projection.memory.filter((m) => !m.used)

    expect(used.length).toBe(1)
    expect(used[0].kind).toBe("procedure")
    expect(used[0].relevance).toBe("high")

    expect(ignored.length).toBe(2)
    const provisional = ignored.find((m) => m.kind === "provisional")
    expect(provisional).toBeDefined()
    expect(provisional?.whyIgnored).toContain("old hypothesis")
    expect(provisional?.whyIgnored).toContain("never verified")

    const historical = ignored.find((m) => m.kind === "historical")
    expect(historical).toBeDefined()
    expect(historical?.whyIgnored).toContain("implementation no longer exists")
  })

  test("Scenario C — Dirty HardState: modifying a source file marks dependent claim DIRTY", () => {
    const projection = projectRivetState({
      sessionID: "ses_3",
      parts: [
        {
          id: "p1",
          type: "tool",
          tool: "propose_claim",
          state: {
            status: "completed",
            input: {
              proposition: "RefreshCoordinator uses pendingPromise serialization in refresh.ts",
              supporting_evidence: ["evid_1"],
              scope: "packages/security/src/refresh.ts",
            },
            metadata: { claim_id: "claim_refresh" },
          },
        } as unknown as ToolPart,
        {
          id: "p2",
          type: "tool",
          tool: "edit",
          state: {
            status: "completed",
            input: { filePath: "packages/security/src/refresh.ts" },
          },
        } as unknown as ToolPart,
      ],
    })

    expect(projection.hardState.length).toBe(1)
    const claim = projection.hardState[0]
    expect(claim.status).toBe("dirty")
    expect(claim.reason).toContain("source changed at")
  })

  test("Scenario D — Verification: passing tests with remaining obligations reports BLOCKED", () => {
    const projection = projectRivetState({
      sessionID: "ses_4",
      parts: [
        {
          id: "p1",
          type: "tool",
          tool: "request_completion",
          state: {
            status: "completed",
            metadata: {
              obligations: [
                { id: "ob_unit", description: "unit tests" },
                { id: "ob_stress", description: "concurrency stress test" },
              ],
            },
          },
        } as unknown as ToolPart,
        {
          id: "p2",
          type: "tool",
          tool: "request_verification",
          state: {
            status: "completed",
            input: { obligation_id: "ob_unit", predicate: "refresh.test.ts" },
            metadata: { passed: true, receiptId: "rcpt_101" },
            output: "18 pass \n 0 fail",
          },
        } as unknown as ToolPart,
      ],
    })

    const unitOb = projection.obligations.find((o) => o.id === "ob_unit")
    const stressOb = projection.obligations.find((o) => o.id === "ob_stress")

    expect(unitOb?.status).toBe("passed")
    expect(stressOb?.status).toBe("pending")
    expect(projection.completion.status).toBe("blocked")
    expect(projection.completion.remainingCount).toBe(1)
    expect(projection.completion.message).toContain("1 required verification remains")
  })

  test("Scenario E — Completion: all obligations satisfied reports READY", () => {
    const projection = projectRivetState({
      sessionID: "ses_5",
      parts: [
        {
          id: "p1",
          type: "tool",
          tool: "request_completion",
          state: {
            status: "completed",
            metadata: {
              obligations: [{ id: "ob_all", description: "all checks" }],
            },
          },
        } as unknown as ToolPart,
        {
          id: "p2",
          type: "tool",
          tool: "request_verification",
          state: {
            status: "completed",
            input: { obligation_id: "ob_all", predicate: "all.test.ts" },
            metadata: { passed: true, receiptId: "rcpt_999" },
            output: "5 pass \n 0 fail",
          },
        } as unknown as ToolPart,
      ],
    })

    expect(projection.completion.status).toBe("ready")
    expect(projection.completion.remainingCount).toBe(0)
    expect(projection.completion.message).toBe("All required obligations satisfied")
  })

  test("Outdated verification: edit made after verification marks obligation OUTDATED", () => {
    const projection = projectRivetState({
      sessionID: "ses_6",
      parts: [
        {
          id: "p1",
          type: "tool",
          tool: "request_completion",
          state: {
            status: "completed",
            metadata: {
              obligations: [{ id: "ob_1", description: "unit tests" }],
            },
          },
        } as unknown as ToolPart,
        {
          id: "p2",
          type: "tool",
          tool: "request_verification",
          state: {
            status: "completed",
            input: { obligation_id: "ob_1", predicate: "refresh.test.ts" },
            metadata: { passed: true, receiptId: "rcpt_1" },
            output: "1 pass \n 0 fail",
          },
        } as unknown as ToolPart,
        {
          id: "p3",
          type: "tool",
          tool: "edit",
          state: {
            status: "completed",
            input: { filePath: "packages/security/src/refresh.ts" },
          },
        } as unknown as ToolPart,
      ],
    })

    const ob = projection.obligations.find((o) => o.id === "ob_1")
    expect(ob?.status).toBe("outdated")
    expect(projection.completion.status).toBe("outdated")
    expect(projection.completion.message).toBe("Verification predates latest edit")
  })

  test("Empty state: gracefully handles empty inputs without errors", () => {
    const projection = projectRivetState({})

    expect(projection.hardState.length).toBe(0)
    expect(projection.workspace.hypotheses.length).toBe(0)
    expect(projection.memory.length).toBe(0)
    expect(projection.code.relevantFiles.length).toBe(0)
    expect(projection.obligations.length).toBe(0)
    expect(projection.completion.status).toBe("ready")
    expect(projection.statusRail.changedFileCount).toBe(0)
    expect(projection.statusRail.taskCount).toBe(0)
  })
})
