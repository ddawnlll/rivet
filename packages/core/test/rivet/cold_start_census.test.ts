import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { SessionSemantics } from "../../src/session/semantics"
import { SessionSchema } from "../../src/session/schema"
import { HardState } from "../../src/rivet/noesis"
import { InMemoryRecallStore } from "../../src/rivet/recall/store"
import { AutomaticRecallAdmissionHook } from "../../src/rivet/recall/harness"

describe("Rivet Cold Start Repository Census & Epistemic Memory", () => {
  it("Cold start initializes repository census into Hard State and Recall Store", async () => {
    // 1. Mock Event service
    const publishedEvents: any[] = []
    const mockEvents: any = {
      publish: (_eventDef: any, payload: any) =>
        Effect.sync(() => {
          publishedEvents.push(payload)
        }),
    }

    const testDir = path.resolve(__dirname, "../../../..")
    const sessionID = SessionSchema.ID.make("ses_test_cold_start")

    // Create session semantics with fresh HardState and recall store
    const store = new InMemoryRecallStore()
    const hardState = new HardState()
    const instance = new (SessionSemantics as any)(sessionID, hardState, store)

    expect(instance.hardState.claims.size).toBe(0)
    expect(instance.hardState.observations.size).toBe(0)

    // 2. Execute ensureColdStart
    await Effect.runPromise(instance.ensureColdStart(mockEvents, testDir))

    // 3. Verify HardState is populated
    expect(instance.hardState.claims.size).toBeGreaterThan(0)
    expect(instance.hardState.observations.size).toBeGreaterThan(0)
    expect(instance.hardState.evidence.size).toBeGreaterThan(0)

    // Check specific census claims
    const claimLanguages: any = Array.from(instance.hardState.claims.values()).find((c: any) =>
      c.proposition.includes("primary implementation language"),
    )
    expect(claimLanguages).toBeDefined()
    expect(claimLanguages?.status).toBe("supported")

    const claimWorkspaces: any = Array.from(instance.hardState.claims.values()).find((c: any) =>
      c.proposition.includes("workspace structure comprises"),
    )
    expect(claimWorkspaces).toBeDefined()

    // 4. Verify Idempotence: Second call does not duplicate claims
    const claimCountBefore = instance.hardState.claims.size
    await Effect.runPromise(instance.ensureColdStart(mockEvents, testDir))
    expect(instance.hardState.claims.size).toBe(claimCountBefore)

    // 5. Verify CognitiveView includes authoritative claims instead of empty placeholder
    const cognitiveView: any = await Effect.runPromise(
      instance.cognitiveView({
        repositoryId: testDir,
        userPrompt: "Proje hakkında ne biliyorsun? Hard state ve hafıza durumunu kontrol et",
      }),
    )
    const promptBlock = cognitiveView.formatPromptBlock()
    expect(promptBlock).toContain("### AUTHORITATIVE HARD CLAIMS:")
    expect(promptBlock).not.toContain("(None currently admitted in Hard State")
    expect(promptBlock).toContain("primary implementation language")

    // 6. Verify Memory Retrieval (cross-lingual Turkish prompt returns active project knowledge)
    const memoryFrontier = await Effect.runPromise(
      AutomaticRecallAdmissionHook.admitRecall({
        hardState: instance.hardState,
        recallStore: store,
        userPrompt: "Proje hakkında ne biliyorsun? Hafıza ve hard state durumu nedir?",
        goalDescription: "Proje hakkında ne biliyorsun?",
        repositoryId: testDir,
      }),
    )

    const allRecalled = [
      ...memoryFrontier.active,
      ...memoryFrontier.procedural,
      ...memoryFrontier.episodic,
    ]
    expect(allRecalled.length).toBeGreaterThan(0)
    expect(allRecalled.some((m) => m.summary.includes("primary implementation language"))).toBe(true)

    // 7. Verify Epistemic State Query snapshot
    const snapshot = instance.getEpistemicState(instance.scope(testDir))
    expect(snapshot.activeClaims.length).toBeGreaterThan(0)
    expect(snapshot.recentEvidence.length).toBeGreaterThan(0)
  })
})
