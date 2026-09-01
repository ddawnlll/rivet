import { describe, expect, test } from "bun:test"
import { tmpdir } from "os"
import { join } from "path"
import { VerityPipeline } from "../../../src/rivet/praxis/pipeline"
import type { PlanSpec } from "../../../src/rivet/praxis/gates"

describe("Praxis 8-Gate Verity Pipeline", () => {
  test("Runs full 8-gate verification and emits VerificationReceipt on pass", async () => {
    const pipeline = new VerityPipeline(tmpdir())

    const plan: PlanSpec = {
      metadata: {
        planId: "plan-verify-001",
        title: "Verify unit test suite",
        version: "3.0",
      },
      workspace: {
        allowedFiles: ["src/**"],
        forbiddenFiles: [".git/**"],
      },
      commands: {
        exactAllowedCommands: [
          {
            id: "cmd-test",
            command: "bun test",
            kind: "test",
          },
        ],
        hardDeniedCommands: [],
      },
      tasks: [
        {
          id: "task-1",
          name: "Run test suite",
          description: "All unit tests pass",
          dependencies: [],
          acceptanceCriteria: [
            {
              id: "crit-1",
              description: "bun test exits 0",
              verification: {
                type: "command",
                commandRef: "cmd-test",
                deterministic: true,
                advisoryOnly: false,
              },
            },
          ],
        },
      ],
    }

    const executor = async () => ({
      commandId: "cmd-test",
      exitCode: 0,
      stdout: "3 pass",
      stderr: "",
      passed: true,
    })

    const result = await pipeline.run(plan, null, [], "attempt-001", executor)
    expect(result.overallVerdict).toBe("PASS")
    expect(result.gateResults.length).toBeGreaterThanOrEqual(6)
    expect(result.finalReceipt).not.toBeNull()
    expect(result.finalReceipt?.passed).toBe(true)
  })

  test("Fails closed on forbidden file mutation", async () => {
    const pipeline = new VerityPipeline(tmpdir())

    const plan: PlanSpec = {
      metadata: {
        planId: "plan-forbidden",
        title: "Forbidden test",
        version: "3.0",
      },
      workspace: {
        allowedFiles: ["src/**"],
        forbiddenFiles: [".git/**", "secrets.json"],
      },
      commands: {
        exactAllowedCommands: [],
        hardDeniedCommands: [],
      },
      tasks: [
        {
          id: "t1",
          name: "t1",
          description: "t1",
          dependencies: [],
          acceptanceCriteria: [],
        },
      ],
    }

    const changedFiles = [{ path: "secrets.json", status: "modified" as const }]
    const result = await pipeline.run(plan, null, changedFiles, "attempt-002", async () => ({
      commandId: "none",
      exitCode: 0,
      stdout: "",
      stderr: "",
      passed: true,
    }))

    expect(result.overallVerdict).toBe("FAIL")
    expect(result.finalReceipt).toBeNull()
  })
})
