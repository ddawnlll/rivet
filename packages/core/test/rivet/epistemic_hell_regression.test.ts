import { describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSemantics } from "@opencode-ai/core/session/semantics"
import {
  TurnAdmissionGate,
  CognitiveViewCompiler,
  AccpSemanticGate,
  createEvidenceId,
  createClaimId,
  createObligationId,
  Scope,
  Revision,
} from "../../src/rivet"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), []),
)

describe("Epistemic Hell Prevention & Praxis Integrity Regressions", () => {
  // Test 1: Exact reproduction prompt with residual hard state
  it.effect("1. Exact reproduction prompt 'selam, config dosyan neydi bakar misin?' does not trigger Epistemic Hell", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_repro_epistemic_hell")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-repro-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)

      // Step A: Seed prior hard state (e.g. an earlier autonomous goal)
      yield* semantics.ensureGoal(events, "/goal initial setup", tmp, "execution")
      expect(semantics.hardState.goalDescription).toBe("/goal initial setup")
      expect(semantics.hardState.openObligationIds().length).toBeGreaterThan(0)

      // Step B: User sends conversational config query
      const userPrompt = "selam, config dosyan neydi bakar misin?"
      const admission = TurnAdmissionGate.classify(userPrompt)

      // TurnAdmission must classify this as conversational / state query, NOT autonomous_goal
      expect(admission.shouldCreateGoal).toBe(false)
      expect(admission.shouldCreateObligation).toBe(false)
      expect(admission.requiresPraxis).toBe(false)
      expect(["state_query", "conversational_query"]).toContain(admission.category)

      // Step C: Compile cognitive view with isNonGoalTurn / conversational turn isolation
      const view = CognitiveViewCompiler.compile({
        hardState: semantics.hardState,
        repositoryId: "rivet-test",
        userPrompt,
        goalDescription: "", // Isolated: non-goal turn overrides stale hardState goal
        tokenBudget: 4000,
        mode: "RAW_TEXT",
      })

      // Completion readiness MUST be NOT_REQUIRED
      expect(view.completionReadiness.status).toBe("NOT_REQUIRED")
      expect(view.completionReadiness.blockers).toHaveLength(0)

      const cognitiveView = CognitiveViewCompiler.toCognitiveView(view)
      const promptBlock = cognitiveView.formatPromptBlock()

      // Must be in conversational mode
      expect(promptBlock).toContain("CONVERSATIONAL MODE")
      expect(promptBlock).not.toContain("COMPLETION READINESS: BLOCKED")
      // Obligations must NOT be rendered as active requirements
      expect(promptBlock).not.toContain("OBLIGATION CONTRACTS & CLOSURE REQUIREMENTS")
      expect(promptBlock).toContain("No Active Autonomous Goal")
    }),
  )

  // Test 2: Genuine Praxis positive control (execution goal with file constraint passes upon file creation)
  it.effect("2. Genuine Praxis positive control verifies file constraint when file exists", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_praxis_positive_control")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-praxis-pos-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)

      yield* semantics.ensureGoal(events, "/goal create config.json", tmp, "execution")
      const fileId = [...semantics.hardState.obligationPredicates.entries()].find(
        ([, predicate]) => predicate.type === "file_constraint",
      )?.[0]
      expect(fileId).toBeDefined()

      const request = {
        obligationId: fileId!,
        predicate: "verify target file",
        targetScope: semantics.scope(tmp),
        timeoutSeconds: 30,
        timestamp: new Date().toISOString(),
      }

      // Step A: Verification fails when file does not exist
      const failed = yield* semantics.verifyLastExecution(events, request)
      expect(failed.type).toBe("praxis")
      if (failed.type !== "praxis") return
      expect(failed.receipt.passed).toBe(false)
      expect(failed.receipt.diagnostics).toContain("FILE_NOT_FOUND")

      // Step B: Create the file in the workspace
      fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ name: "rivet" }))

      // Step C: Verification passes independently via Praxis
      const passed = yield* semantics.verifyLastExecution(events, request)
      expect(passed.type).toBe("praxis")
      if (passed.type !== "praxis") return
      expect(passed.receipt.passed).toBe(true)
      expect(passed.receipt.reasonCodes).toContain("FILE_CONSTRAINT_SATISFIED")
    }),
  )

  // Test 3: Predicate FALSE (file does not exist) cleanly fails Praxis with FILE_NOT_FOUND
  it.effect("3. Predicate FALSE fails Praxis with clean FILE_NOT_FOUND without getting trapped in loop", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_praxis_predicate_false")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-praxis-neg-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)

      yield* semantics.ensureGoal(events, "/goal check missing_file.txt", tmp, "execution")
      const fileId = [...semantics.hardState.obligationPredicates.entries()].find(
        ([, predicate]) => predicate.type === "file_constraint",
      )?.[0]
      expect(fileId).toBeDefined()

      const request = {
        obligationId: fileId!,
        predicate: "verify target file",
        targetScope: semantics.scope(tmp),
        timeoutSeconds: 30,
        timestamp: new Date().toISOString(),
      }

      const failed = yield* semantics.verifyLastExecution(events, request)
      expect(failed.type).toBe("praxis")
      if (failed.type !== "praxis") return
      expect(failed.receipt.passed).toBe(false)
      expect(failed.receipt.diagnostics).toContain("FILE_NOT_FOUND")
      // Reason codes and diagnostics must clearly indicate the specific failure
      expect(failed.receipt.diagnostics?.length).toBeGreaterThan(0)
    }),
  )

  // Test 4: Praxis verifies legitimate user config path in home directory with admitted evidence
  it.effect("4. Praxis verifies user config path via home directory expansion and admitted evidence", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_praxis_user_config")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-user-cfg-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)

      const targetPath = "~/.config/rivet/config.json"
      const homeDir = process.env.HOME || process.env.USERPROFILE || tmp
      const expandedTarget = path.join(homeDir, ".config", "rivet", "config.json")
      fs.mkdirSync(path.dirname(expandedTarget), { recursive: true })
      fs.writeFileSync(expandedTarget, JSON.stringify({ version: "1.0" }), "utf8")

      yield* semantics.ensureGoal(events, `/goal verify ${targetPath}`, tmp, "execution")

      const fileId = [...semantics.hardState.obligationPredicates.entries()].find(
        ([, predicate]) => predicate.type === "file_constraint",
      )?.[0]
      expect(fileId).toBeDefined()

      // Admit evidence that tool observed this file
      const evId = createEvidenceId()
      yield* semantics.append(events, {
        type: "evidence_recorded",
        evidenceId: evId,
        summary: `read_file ~/.config/rivet/config.json content: {"version": "1.0"}`,
        source: "observation",
        timestamp: new Date().toISOString(),
      })

      const request = {
        obligationId: fileId!,
        predicate: "verify target file",
        targetScope: semantics.scope(tmp),
        timeoutSeconds: 30,
        timestamp: new Date().toISOString(),
      }

      const result = yield* semantics.verifyLastExecution(events, request)
      expect(result.type).toBe("praxis")
      if (result.type !== "praxis") return
      // Should pass via admitted observation evidence corroboration
      expect(result.receipt.passed).toBe(true)
      expect(result.receipt.reasonCodes).toContain("FILE_CONSTRAINT_SATISFIED")

      // Clean up test file
      if (fs.existsSync(expandedTarget)) {
        fs.unlinkSync(expandedTarget)
      }
    }),
  )

  // Test 5: Insufficient evidence recoverable retry with admitted claim
  it.effect("5. Claims verification succeeds when supporting claim and evidence are admitted", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_praxis_claims_verified")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-claims-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)

      yield* semantics.ensureGoal(events, "Ensure config is verified", tmp, "execution")
      const rootId = [...semantics.hardState.obligationPredicates.entries()].find(
        ([, predicate]) => predicate.type === "claims_verified",
      )?.[0]
      expect(rootId).toBeDefined()

      // Without claim admitted, verification fails
      const req = {
        obligationId: rootId!,
        predicate: "verify claims",
        targetScope: semantics.scope(tmp),
        timeoutSeconds: 30,
        timestamp: new Date().toISOString(),
      }

      const failResult = yield* semantics.verifyLastExecution(events, req)
      expect(failResult.type).toBe("praxis")
      if (failResult.type !== "praxis") return
      expect(failResult.receipt.passed).toBe(false)
      expect(failResult.receipt.reasonCodes).toContain("CLAIM_NOT_ADMITTED")

      // Admit evidence and claim
      const evId = createEvidenceId("ev_cfg_observed")
      yield* semantics.append(events, {
        type: "evidence_recorded",
        evidenceId: evId,
        summary: "Config file located at ~/.config/rivet/config.json",
        source: "observation",
        timestamp: new Date().toISOString(),
      })
      yield* semantics.append(events, {
        type: "claim_asserted",
        claimId: createClaimId("claim_cfg_verified"),
        proposition: "Goal 'Ensure config is verified' fulfilled",
        status: "supported",
        evidence: [evId],
        dependencies: [],
        validityPolicy: "CURRENT_STATE",
        scope: semantics.scope(tmp),
        timestamp: new Date().toISOString(),
      })

      // With claim and evidence admitted, verification passes
      const passResult = yield* semantics.verifyLastExecution(events, req)
      expect(passResult.type).toBe("praxis")
      if (passResult.type !== "praxis") return
      expect(passResult.receipt.passed).toBe(true)
      expect(passResult.receipt.reasonCodes).toContain("CLAIMS_VERIFIED")
    }),
  )

  // Test 6: Prompt admission suite (Zero-regex, explicit protocol contracts only)
  it.effect("6. Natural queries are admitted without synthetic goals or obligations; explicit markers create goals", () =>
    Effect.gen(function* () {
      // Natural language inspection & conversational prompts
      // Under zero-regex architecture, NONE of these create hardcoded goals or obligations.
      // The LLM evaluates cognitive intent directly.
      const naturalPrompts = [
        "hangi git branchindeyiz?",
        "şu an hangi model tanımlı?",
        "typescript sürümü kaç?",
        "bu repoda sqlite nerede açılıyor?",
        "son commit ne?",
        "package.json'da effect var mı?",
        "README hangi lisansı söylüyor?",
        "bu dosya gerçekten var mı?",
        "config dosyan nerede?",
        "hangi branchteyiz?",
        "package version ne?",
        "testler geciyor mu?",
        "bu projede typescript surumu kac?",
        "where is your config file located?",
        "what branch are we on right now?",
        "what is the current package version?",
        "did the test suite pass?",
        "where is sqlite opened in this repository?",
        "does package.json contain effect?",
        "what license does the README specify?",
        "config dosyasını oluştur",
        "package versionunu değiştir",
        "bu dosyayı sil",
        "testi düzelt ve geçtiğini doğrula",
        "create the config file",
        "update the package version",
        "delete this file",
        "fix the test and verify it passes",
      ]

      for (const prompt of naturalPrompts) {
        const admission = TurnAdmissionGate.classify(prompt)
        expect(admission.shouldCreateGoal).toBe(false)
        expect(admission.shouldCreateObligation).toBe(false)
        expect(admission.requiresPraxis).toBe(false)
        expect(admission.category).toBe("conversational_query")
      }

      // Explicit protocol markers & slash commands MUST create goals and obligations
      const explicitCommands = [
        "/goal create config file",
        "/goal fix the failing test",
        "[RIVET GOAL EXECUTION]\nGoal: Refactor database layer",
      ]

      for (const cmd of explicitCommands) {
        const admission = TurnAdmissionGate.classify(cmd)
        expect(admission.shouldCreateGoal).toBe(true)
        expect(admission.shouldCreateObligation).toBe(true)
        expect(admission.requiresPraxis).toBe(true)
        expect(admission.requiresCompletion).toBe(true)
        expect(admission.category).toBe("autonomous_goal")
        expect(admission.obligationKind).toBe("execution")
      }
    }),
  )
})
