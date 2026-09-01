import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  CommandRiskClassifier,
  ProcessSupervisor,
  type ProcessResourceLimits,
} from "../../../src/rivet/runtime/sandbox"
import {
  SemanticPatchEngine,
  type PatchIntent,
} from "../../../src/rivet/runtime/semantic-patch"
import { Revision } from "../../../src/rivet/types"

describe("Command Risk Classifier, Process Supervisor & Semantic Patch", () => {
  test("CommandRiskClassifier parses executable and flags into typed ActionRisk", () => {
    // Destructive
    const gitHardReset = CommandRiskClassifier.parseCommandLine("git reset --hard HEAD~1")
    expect(CommandRiskClassifier.classifyRisk(gitHardReset)).toBe("destructive")

    const rmRfRoot = CommandRiskClassifier.parseCommandLine("rm -rf /")
    expect(CommandRiskClassifier.classifyRisk(rmRfRoot)).toBe("destructive")

    // Inspect
    const ls = CommandRiskClassifier.parseCommandLine("ls -la src/")
    expect(CommandRiskClassifier.classifyRisk(ls)).toBe("inspect")

    const bunTest = CommandRiskClassifier.parseCommandLine("bun test test/util")
    expect(CommandRiskClassifier.classifyRisk(bunTest)).toBe("inspect")

    // Material
    const touch = CommandRiskClassifier.parseCommandLine("touch new_file.ts")
    expect(CommandRiskClassifier.classifyRisk(touch)).toBe("material")
  })

  test("ProcessSupervisor enforces execution timeout via signal", async () => {
    const limits: ProcessResourceLimits = {
      timeoutMs: 50,
      maxOutputBytes: 1024,
      killPolicy: "immediate_sigkill",
    }

    const result = await ProcessSupervisor.executeWithLimits("sleep 1", tmpdir(), limits)
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })

  test("SemanticPatchEngine parses symbol URIs correctly", () => {
    const uri = "symbol://src/auth/service.ts/authenticateUser"
    const parsed = SemanticPatchEngine.parseSymbolUri(uri)

    expect(parsed.filePath).toBe("src/auth/service.ts")
    expect(parsed.symbolName).toBe("authenticateUser")
  })

  test("SemanticPatchEngine enforces CAS revision check (Invariant I-07)", () => {
    const testDir = join(tmpdir(), `rivet-patch-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, "service.ts")
    writeFileSync(filePath, "function login() { return false }", "utf8")

    try {
      const intent: PatchIntent = {
        target: "symbol://service.ts/login",
        expectedRevision: Revision.from(1),
        operation: "replace_body",
        proposedArtifact: "function login() { return true }",
      }

      // Current revision is 2 -> Stale state rejection!
      expect(() =>
        SemanticPatchEngine.applyPatch(testDir, intent, Revision.from(2))
      ).toThrow(/Stale revision/)

      // Matching revision -> Applies atomically
      const msg = SemanticPatchEngine.applyPatch(testDir, intent, Revision.from(1))
      expect(msg).toContain("Successfully applied")
      expect(readFileSync(filePath, "utf8")).toBe("function login() { return true }")
    } finally {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true })
      }
    }
  })
})
