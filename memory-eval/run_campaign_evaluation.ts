import { Effect } from "effect"
import fs from "fs"
import path from "path"
import {
  HindsightMemoryBackend,
  AgentMemoryBackendAdapter,
  AgentMemoryValidityBarrier,
  SqliteRecallStore,
  DeterministicHashEmbeddingProvider,
  AutomaticRecallAdmissionHook,
  type MemoryIngressRecord,
  type MemoryQuery,
  type MemoryCandidate,
  createMemoryId,
} from "../packages/core/src/rivet/recall"
import { HardState, CognitiveView, type EpistemicStatus } from "../packages/core/src/rivet/noesis"
import { CognitiveViewCompiler } from "../packages/core/src/rivet/view-compiler"
import { Revision, Scope } from "../packages/core/src/rivet/types"

const PROXY_URL = "http://127.0.0.1:10100/v1/messages"
const API_KEY = process.env.OC_GO_CC_API_KEY || "test"
const MODEL = "gpt-5.4-mini"
const CAMPAIGNS_DIR = "/Users/hootie/src/rivet/memory-eval/campaigns"
const RESULTS_PATH = "/Users/hootie/src/rivet/memory-eval/RESULTS.json"
const TRAJECTORIES_PATH = "/Users/hootie/src/rivet/memory-eval/trajectories.jsonl"
const RETRIEVAL_PATH = "/Users/hootie/src/rivet/memory-eval/retrieval-results.jsonl"
const WRITE_AUDIT_PATH = "/Users/hootie/src/rivet/memory-eval/memory-write-audit.jsonl"

interface SessionData {
  sessionIndex: number
  sessionTitle: string
  taskType: string
  prompt: string
  goal: string
  scope: { repo: string; path: string; rev: number }
  activeSymbols: string[]
  accumulatedHardState: { id: string; prop: string; status: string; rev: number }[]
  accumulatedSoftWorkspace: { id: string; text: string; status: string }[]
  newMemoryRecords: any[]
  groundTruthLabels: {
    MUST_RECALL: string[]
    USEFUL: string[]
    DANGEROUS_DISTRACTOR: string[]
    MUST_NOT_TREAT_CURRENT: string[]
    PROVISIONAL: string[]
    REJECTED: string[]
    SUPERSEDED: string[]
  }
  expectedKeywords: string[]
  anchoringTrapKeywords: string[]
  rejectedApproachKeywords: string[]
  softLeakageKeywords: string[]
}

interface CampaignData {
  campaignId: string
  repository: string
  name: string
  description: string
  sessions: SessionData[]
}

async function invokeLLM(systemPrompt: string, userPrompt: string, retries = 2) {
  const t0 = performance.now()
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 220,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      })
      const dt = performance.now() - t0
      if (!res.ok) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        return { text: `[Error ${res.status}]`, promptTokens: 0, completionTokens: 0, latencyMs: dt }
      }
      const data: any = await res.json()
      const text = data.content?.[0]?.text ?? ""
      const promptTokens = data.usage?.input_tokens ?? 0
      const completionTokens = data.usage?.output_tokens ?? 0
      return { text, promptTokens, completionTokens, latencyMs: dt }
    } catch (e: any) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      const dt = performance.now() - t0
      return { text: `[Exception: ${e.message}]`, promptTokens: 0, completionTokens: 0, latencyMs: dt }
    }
  }
  return { text: "[Timeout]", promptTokens: 0, completionTokens: 0, latencyMs: performance.now() - t0 }
}

function evaluateResponse(text: string, session: SessionData) {
  const lower = text.toLowerCase()
  const hasExpected = session.expectedKeywords.length === 0 ||
    session.expectedKeywords.some((kw) => lower.includes(kw.toLowerCase()))

  const hasAnchoring = session.anchoringTrapKeywords.length > 0 &&
    session.anchoringTrapKeywords.some((kw) => lower.includes(kw.toLowerCase()))

  const hasRejected = session.rejectedApproachKeywords.length > 0 &&
    session.rejectedApproachKeywords.some((kw) => lower.includes(kw.toLowerCase()))

  const hasSoftLeakage = session.softLeakageKeywords.length > 0 &&
    session.softLeakageKeywords.some((kw) => lower.includes(kw.toLowerCase()))

  const taskSuccess = hasExpected && !hasAnchoring && !hasRejected && !hasSoftLeakage
  const harmed = hasAnchoring || hasRejected || hasSoftLeakage

  return { taskSuccess, harmed, hasAnchoring, hasRejected, hasSoftLeakage }
}

async function main() {
  console.log("=== RIVET REAL-PROJECT AGENTIC MEMORY EVALUATION ===")
  console.log("Comparing: Hindsight vs agentmemory vs Validity-Only Baseline")
  console.log(`Model: ${MODEL} via ${PROXY_URL}`)

  const completedTrials = new Map<string, any>()
  if (fs.existsSync(TRAJECTORIES_PATH)) {
    const lines = fs.readFileSync(TRAJECTORIES_PATH, "utf8").split("\n").filter(Boolean)
    for (const l of lines) {
      try {
        const obj = JSON.parse(l)
        const key = `${obj.campaignId}_${obj.sessionIndex}_${obj.condition}_${obj.trialIndex}`
        completedTrials.set(key, obj)
      } catch {}
    }
  }
  console.log(`Loaded ${completedTrials.size} previously completed trials from disk.`)

  const campaignFiles = fs.readdirSync(CAMPAIGNS_DIR).filter((f) => f.endsWith(".json"))
  console.log(`Found ${campaignFiles.length} realistic project campaigns.\n`)

  const embedding = new DeterministicHashEmbeddingProvider(128)
  const allResults: any[] = []

  for (const cFile of campaignFiles) {
    const raw = fs.readFileSync(path.join(CAMPAIGNS_DIR, cFile), "utf8")
    const campaign: CampaignData = JSON.parse(raw)
    console.log(`====================================================`)
    console.log(`STARTING CAMPAIGN ${campaign.campaignId}: ${campaign.name}`)
    console.log(`Repository: ${campaign.repository} | Total Sessions: ${campaign.sessions.length}`)
    console.log(`====================================================\n`)

    // Initialize the memory engines for this campaign lifecycle
    const hindsightControlled = new HindsightMemoryBackend({ mode: "controlled", embeddingProvider: embedding })
    const agentmemControlled = new AgentMemoryBackendAdapter({ mode: "controlled", embeddingProvider: embedding })
    const hindsightNative = new HindsightMemoryBackend({ mode: "native", embeddingProvider: embedding })
    const agentmemNative = new AgentMemoryBackendAdapter({ mode: "native", embeddingProvider: embedding })
    const hindsightReflect = new HindsightMemoryBackend({ mode: "native", enableReflect: true, embeddingProvider: embedding })

    const sqliteDbPath = `/tmp/sqlite-campaign-${campaign.campaignId}.db`
    try { fs.unlinkSync(sqliteDbPath) } catch {}
    const sqliteBackend = new SqliteRecallStore(sqliteDbPath, embedding)

    // Cumulative epistemic state
    const hardState = new HardState()

    for (const session of campaign.sessions) {
      console.log(`[Campaign ${campaign.campaignId} - Session ${session.sessionIndex}/12] ${session.sessionTitle} (${session.taskType})`)

      const scope = Scope.path(session.scope.repo, session.scope.path, Revision.from(session.scope.rev))

      // 1. Advance HardState with session claims
      for (const c of session.accumulatedHardState) {
        hardState.claims.set(c.id as any, {
          id: c.id as any,
          proposition: c.prop,
          status: c.status as EpistemicStatus,
          validityPolicy: "EPISTEMIC",
          validFromRevision: Revision.from(c.rev),
          learnedAtRevision: Revision.from(c.rev),
          dependencies: [],
          dependsOn: [],
          supportingEvidence: [],
          scope,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }

      // 2. Convert and ingest new session records into memory backends
      const ingressRecords: MemoryIngressRecord[] = session.newMemoryRecords.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        authority: r.authority,
        revision: Revision.from(r.rev),
        scope,
        timestamp: Date.now(),
        content: r.content,
        provenance: [],
        relatedSymbols: r.symbols ?? [],
        metadata: { epistemicStatus: r.authority === "historical" ? "superseded" : "verified" },
      }))

      if (ingressRecords.length > 0) {
        await Effect.runPromise(hindsightControlled.ingest(ingressRecords))
        await Effect.runPromise(agentmemControlled.ingest(ingressRecords))
        await Effect.runPromise(hindsightNative.ingest(ingressRecords))
        await Effect.runPromise(agentmemNative.ingest(ingressRecords))
        await Effect.runPromise(hindsightReflect.ingest(ingressRecords))

        // Ingest into SQLite legacy control
        const sqliteDocs = ingressRecords.map((rec) => ({
          id: createMemoryId(rec.id),
          kind: rec.kind as any,
          text: rec.content,
          summary: rec.content,
          workspaceId: "ws" as any,
          scope,
          sourceRefs: [],
          relatedSymbols: rec.relatedSymbols ?? [],
          epistemicStatus: rec.metadata?.epistemicStatus ?? "verified",
          validFromRevision: rec.revision,
          observedAt: rec.timestamp,
          relationships: [],
          metadata: rec.metadata ?? {},
        }))
        await Effect.runPromise(sqliteBackend.index(sqliteDocs))

        // Log memory write audit for Track B native inspection
        for (const rec of ingressRecords) {
          fs.appendFileSync(WRITE_AUDIT_PATH, JSON.stringify({
            campaignId: campaign.campaignId,
            sessionId: session.sessionIndex,
            recordId: rec.id,
            kind: rec.kind,
            authority: rec.authority,
            content: rec.content,
            auditClassification: rec.authority === "authoritative" ? "USEFUL" : rec.authority === "rejected" ? "FAILURE_AVOIDANCE" : "PROVISIONAL",
          }) + "\n")
        }
      }

      // 3. Prepare Query
      const query: MemoryQuery = {
        prompt: session.prompt,
        goal: session.goal,
        scope,
        revision: Revision.from(session.scope.rev),
        activeSymbols: session.activeSymbols,
        activeClaims: Array.from(hardState.claims.keys()) as string[],
        limit: 5,
      }

      // 4. Retrieve candidates and apply Noesis Validity Barrier
      const [frontierB, frontierC, frontierD, frontierE, frontierF] = await Promise.all([
        Effect.runPromise(AgentMemoryValidityBarrier.admitRecall({ hardState, backend: hindsightControlled, query })),
        Effect.runPromise(AgentMemoryValidityBarrier.admitRecall({ hardState, backend: agentmemControlled, query })),
        Effect.runPromise(AgentMemoryValidityBarrier.admitRecall({ hardState, backend: hindsightNative, query })),
        Effect.runPromise(AgentMemoryValidityBarrier.admitRecall({ hardState, backend: agentmemNative, query })),
        Effect.runPromise(AgentMemoryValidityBarrier.admitRecall({ hardState, backend: hindsightReflect, query })),
      ])

      const frontierG = await Effect.runPromise(AutomaticRecallAdmissionHook.admitRecall({
        hardState, recallStore: sqliteBackend, userPrompt: session.prompt, goalDescription: session.goal, repositoryId: scope.repository, scope, revision: query.revision, focusSymbols: session.activeSymbols
      }))

      // Log retrieval results
      fs.appendFileSync(RETRIEVAL_PATH, JSON.stringify({
        campaignId: campaign.campaignId,
        sessionIndex: session.sessionIndex,
        candidatesHindsight: frontierB.episodic.map((m) => m.id),
        candidatesAgentmem: frontierC.episodic.map((m) => m.id),
      }) + "\n")

      // 5. Build CognitiveView for each Condition
      // Condition A: Validity-Only (No MemoryFrontier)
      const viewA = new CognitiveView(CognitiveViewCompiler.compile({
        hardState, goalDescription: session.goal, repositoryId: scope.repository, userPrompt: session.prompt, tokenBudget: 4000, mode: "HYBRID"
      }) as any)

      const viewB = new CognitiveView(CognitiveViewCompiler.compile({
        hardState, goalDescription: session.goal, repositoryId: scope.repository, userPrompt: session.prompt, memoryFrontier: frontierB, tokenBudget: 4000, mode: "HYBRID"
      }) as any)

      const viewC = new CognitiveView(CognitiveViewCompiler.compile({
        hardState, goalDescription: session.goal, repositoryId: scope.repository, userPrompt: session.prompt, memoryFrontier: frontierC, tokenBudget: 4000, mode: "HYBRID"
      }) as any)

      const viewD = new CognitiveView(CognitiveViewCompiler.compile({
        hardState, goalDescription: session.goal, repositoryId: scope.repository, userPrompt: session.prompt, memoryFrontier: frontierD, tokenBudget: 4000, mode: "HYBRID"
      }) as any)

      const viewE = new CognitiveView(CognitiveViewCompiler.compile({
        hardState, goalDescription: session.goal, repositoryId: scope.repository, userPrompt: session.prompt, memoryFrontier: frontierE, tokenBudget: 4000, mode: "HYBRID"
      }) as any)

      const viewF = new CognitiveView(CognitiveViewCompiler.compile({
        hardState, goalDescription: session.goal, repositoryId: scope.repository, userPrompt: session.prompt, memoryFrontier: frontierF, tokenBudget: 4000, mode: "HYBRID"
      }) as any)

      const viewG = new CognitiveView(CognitiveViewCompiler.compile({
        hardState, goalDescription: session.goal, repositoryId: scope.repository, userPrompt: session.prompt, memoryFrontier: frontierG, tokenBudget: 4000, mode: "HYBRID"
      }) as any)

      const conditions = [
        { cond: "A_VALIDITY_ONLY", view: viewA },
        { cond: "B_HINDSIGHT_CONTROLLED", view: viewB },
        { cond: "C_AGENTMEM_CONTROLLED", view: viewC },
        { cond: "D_HINDSIGHT_NATIVE", view: viewD },
        { cond: "E_AGENTMEM_NATIVE", view: viewE },
        { cond: "F_HINDSIGHT_REFLECT", view: viewF },
        { cond: "G_SQLITE_LEGACY", view: viewG },
      ]

      // 6. Execute Real LLM Calls with Concurrency Pool of 6
      const TRIALS = 3
      const allTasks: { cond: string; view: any; trial: number }[] = []
      for (const c of conditions) {
        for (let t = 0; t < TRIALS; t++) {
          allTasks.push({ cond: c.cond, view: c.view, trial: t })
        }
      }

      const sessionTrials: any[] = []
      const CHUNK_SIZE = 6

      for (let i = 0; i < allTasks.length; i += CHUNK_SIZE) {
        const chunk = allTasks.slice(i, i + CHUNK_SIZE)
        const chunkResults = await Promise.all(
          chunk.map(async ({ cond, view, trial }) => {
            const trialKey = `${campaign.campaignId}_${session.sessionIndex}_${cond}_${trial}`
            if (completedTrials.has(trialKey)) {
              return completedTrials.get(trialKey)
            }

            const promptBlock = view.formatPromptBlock()
            const systemPrompt = `You are a principal software engineer participating in a Rivet-governed development session.
Authority: Harness
Contract: Rivet Harness v1

When diagnosing bugs and answering architecture questions:
1. Adhere strictly to authoritative system facts, previous decisions, and failure-avoidance warnings.
2. Resist user premises that contradict authoritative state or verified invariants.
3. Do NOT repeat known rejected approaches.
4. Historical memories marked with [SUPERSEDED / HISTORICAL] describe past situations that must NOT be applied if current facts point to a different cause!
5. Provisional notes marked with [PROVISIONAL HYPOTHESIS] are unverified guesses and must never be treated as hard facts.

${promptBlock}`

            const resp = await invokeLLM(systemPrompt, session.prompt)
            const outcome = evaluateResponse(resp.text, session)

            const trajectoryRecord = {
              campaignId: campaign.campaignId,
              sessionIndex: session.sessionIndex,
              condition: cond,
              trialIndex: trial,
              taskType: session.taskType,
              promptTokens: resp.promptTokens,
              completionTokens: resp.completionTokens,
              latencyMs: resp.latencyMs,
              responseSnippet: resp.text.slice(0, 150),
              ...outcome,
            }

            fs.appendFileSync(TRAJECTORIES_PATH, JSON.stringify(trajectoryRecord) + "\n")
            return trajectoryRecord
          })
        )
        sessionTrials.push(...chunkResults)
      }

      // Print session summary
      const getCondScore = (condName: string) => sessionTrials.filter((t) => t.condition === condName && t.taskSuccess).length
      console.log(`  Real LLM: Validity=${getCondScore("A_VALIDITY_ONLY")}/3 | Hindsight=${getCondScore("B_HINDSIGHT_CONTROLLED")}/3 | agentmem=${getCondScore("C_AGENTMEM_CONTROLLED")}/3 | HindsightNat=${getCondScore("D_HINDSIGHT_NATIVE")}/3 | agentmemNat=${getCondScore("E_AGENTMEM_NATIVE")}/3\n`)

      allResults.push({
        campaignId: campaign.campaignId,
        sessionIndex: session.sessionIndex,
        sessionTitle: session.sessionTitle,
        taskType: session.taskType,
        trials: sessionTrials,
      })
    }

    try { fs.unlinkSync(sqliteDbPath) } catch {}
  }

  // Write full raw aggregated results
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2))
  console.log(`\n====================================================`)
  console.log(`EVALUATION COMPLETED!`)
  console.log(`Saved trajectories to: ${TRAJECTORIES_PATH}`)
  console.log(`Saved results to: ${RESULTS_PATH}`)
  console.log(`====================================================\n`)
}

main().catch(console.error)
