import { Effect } from "effect"
import fs from "fs"
import path from "path"
import {
  SqliteRecallStore,
  SurrealRecallStore,
  DeterministicHashEmbeddingProvider,
  AutomaticRecallAdmissionHook,
  type RecallDocument,
  type RecallQuery,
  type RecallCandidate,
  createMemoryId,
} from "../../../src/rivet/recall"
import { HardState, CognitiveView } from "../../../src/rivet/noesis"
import { CognitiveViewCompiler } from "../../../src/rivet/view-compiler"
import { Revision, Scope, createWorkspaceId } from "../../../src/rivet/types"

const PROXY_URL = "http://127.0.0.1:10100/v1/messages"
const API_KEY = process.env.OC_GO_CC_API_KEY || "test"
const DATASET_PATH = "/Users/hootie/src/rivet/EVALUATION_DATASET.jsonl"
const RESULTS_PATH = "/Users/hootie/src/rivet/EVALUATION_RESULTS.json"

interface ScenarioRecord {
  id: string
  family: string
  title: string
  prompt: string
  goal: string
  scope: { repo: string; path: string; rev: number }
  activeSymbols: string[]
  corpus: any[]
  labels: {
    MUST_RECALL: string[]
    USEFUL_IF_RECALLED: string[]
    HISTORICAL_ONLY: string[]
    MUST_NOT_TREAT_CURRENT: string[]
    IRRELEVANT: string[]
    DANGEROUS_DISTRACTOR: string[]
  }
  expectedResolutionKeywords: string[]
  anchoringTrapKeywords: string[]
  rejectedApproachKeywords: string[]
}

interface RetrievalEvaluation {
  backend: string
  recallAt1: number
  recallAt5: number
  precisionAt5: number
  mrr: number
  dangerousDistractorRetrieved: boolean
  staleMemoryLeakedToActive: boolean
  rejectedApproachRecalled: boolean
  annRecallAt5VsOracle: number
  retrievedCandidateIds: string[]
  topScore: number
  latencyMs: number
}

interface AgentTrialResult {
  condition: "A_NO_MEMORY" | "B_VALIDITY_ONLY" | "C_SQLITE_RECALL" | "D_SURREAL_RECALL"
  model: string
  trialIndex: number
  promptTokens: number
  completionTokens: number
  latencyMs: number
  responseText: string
  taskSuccess: boolean
  failureAvoided: boolean
  harmfulAnchoring: boolean
  premiseConflictResisted: boolean
  classification: "HELPED_BY_MEMORY" | "NEUTRAL" | "HARMED_BY_MEMORY"
}

interface ScenarioFullResult {
  scenarioId: string
  family: string
  title: string
  retrieval: {
    sqlite: RetrievalEvaluation
    surreal: RetrievalEvaluation
  }
  agentTrials: AgentTrialResult[]
}

async function invokeLLM(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; promptTokens: number; completionTokens: number; latencyMs: number }> {
  const t0 = performance.now()
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 220,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    })
    const dt = performance.now() - t0
    if (!res.ok) {
      const err = await res.text()
      console.error(`LLM Error (${res.status}): ${err.slice(0, 100)}`)
      return { text: `[Error ${res.status}]`, promptTokens: 0, completionTokens: 0, latencyMs: dt }
    }
    const data: any = await res.json()
    const text = data.content?.[0]?.text ?? ""
    const promptTokens = data.usage?.input_tokens ?? 0
    const completionTokens = data.usage?.output_tokens ?? 0
    return { text, promptTokens, completionTokens, latencyMs: dt }
  } catch (e: any) {
    const dt = performance.now() - t0
    console.error(`LLM Fetch Exception: ${e.message}`)
    return { text: `[Exception: ${e.message}]`, promptTokens: 0, completionTokens: 0, latencyMs: dt }
  }
}

function evaluateAgentResponse(
  response: string,
  scenario: ScenarioRecord,
  condition: string,
  baselineFailed: boolean
): {
  taskSuccess: boolean
  failureAvoided: boolean
  harmfulAnchoring: boolean
  premiseConflictResisted: boolean
  classification: "HELPED_BY_MEMORY" | "NEUTRAL" | "HARMED_BY_MEMORY"
} {
  const text = response.toLowerCase()

  // 1. Task Success: contains at least one expected keyword
  const hasExpectedKeyword = scenario.expectedResolutionKeywords.length === 0 ||
    scenario.expectedResolutionKeywords.some((kw) => text.includes(kw.toLowerCase()))

  // 2. Harmful Anchoring: contains anchoring trap keywords
  const hasAnchoringTrap = scenario.anchoringTrapKeywords.length > 0 &&
    scenario.anchoringTrapKeywords.some((kw) => text.includes(kw.toLowerCase()))

  // 3. Failure Avoidance: does not contain rejected approach keywords
  const repeatsRejectedApproach = scenario.rejectedApproachKeywords.length > 0 &&
    scenario.rejectedApproachKeywords.some((kw) => text.includes(kw.toLowerCase()))

  const taskSuccess = hasExpectedKeyword && !hasAnchoringTrap && !repeatsRejectedApproach
  const failureAvoided = !repeatsRejectedApproach
  const harmfulAnchoring = hasAnchoringTrap

  // Premise conflict resistance for S23, S24
  let premiseConflictResisted = true
  if (scenario.id === "S23" || scenario.id === "S24") {
    premiseConflictResisted = hasExpectedKeyword && !hasAnchoringTrap
  }

  let classification: "HELPED_BY_MEMORY" | "NEUTRAL" | "HARMED_BY_MEMORY" = "NEUTRAL"
  if (condition === "C_SQLITE_RECALL" || condition === "D_SURREAL_RECALL") {
    if (harmfulAnchoring || repeatsRejectedApproach) {
      classification = "HARMED_BY_MEMORY"
    } else if (taskSuccess && baselineFailed) {
      classification = "HELPED_BY_MEMORY"
    }
  }

  return { taskSuccess, failureAvoided, harmfulAnchoring, premiseConflictResisted, classification }
}

async function main() {
  console.log("=== RIVET REAL-LLM COMPARATIVE MEMORY EVALUATION ===")
  console.log(`Loading dataset from: ${DATASET_PATH}`)
  const rawDataset = fs.readFileSync(DATASET_PATH, "utf8").trim().split("\n")
  const scenarios: ScenarioRecord[] = rawDataset.map((l) => JSON.parse(l))
  console.log(`Loaded ${scenarios.length} scenarios across 12 families.`)

  const embedding = new DeterministicHashEmbeddingProvider(128)
  const fullResults: ScenarioFullResult[] = []

  const PRIMARY_MODEL = "gpt-5.4-mini"
  const TRIALS_PER_CONDITION = 3

  for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
    const sc = scenarios[sIdx]!
    console.log(`\n[${sIdx + 1}/${scenarios.length}] Evaluating ${sc.id}: ${sc.title} (${sc.family})...`)

    const scope = Scope.path(sc.scope.repo, sc.scope.path, Revision.from(sc.scope.rev))
    const wsId = createWorkspaceId(`ws_${sc.id.toLowerCase()}`)

    // Convert raw corpus into RecallDocument array
    const corpusDocs: RecallDocument[] = sc.corpus.map((raw: any) => ({
      id: createMemoryId(raw.id),
      kind: raw.kind,
      text: raw.text,
      summary: raw.summary,
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: raw.relatedSymbols ?? [],
      epistemicStatus: raw.epistemicStatus,
      validFromRevision: raw.validFromRev ? Revision.from(raw.validFromRev) : undefined,
      validToRevision: raw.validToRev ? Revision.from(raw.validToRev) : undefined,
      observedAt: raw.observedAt ?? Date.now(),
      relationships: raw.relationships ?? [],
      metadata: raw.metadata ?? {},
    }))

    // -------------------------------------------------------------
    // 1. LAYER 1: RETRIEVAL EVALUATION (SQLite Oracle vs SurrealDB)
    // -------------------------------------------------------------
    const sqliteDbPath = `/tmp/rivet-eval-sqlite-${sc.id}.db`
    try { fs.unlinkSync(sqliteDbPath) } catch {}
    const sqliteStore = new SqliteRecallStore(sqliteDbPath, embedding)
    await Effect.runPromise(sqliteStore.index(corpusDocs))

    const surrealStore = new SurrealRecallStore("mem://", embedding)
    await Effect.runPromise(surrealStore.index(corpusDocs))

    const query: RecallQuery = {
      prompt: sc.prompt,
      goal: sc.goal,
      scope,
      revision: Revision.from(sc.scope.rev),
      activeSymbols: sc.activeSymbols,
      activeClaims: [],
      limit: 5,
    }

    const tSqlite = performance.now()
    const sqliteCandidates = await Effect.runPromise(sqliteStore.recall(query))
    const dtSqlite = performance.now() - tSqlite

    const tSurreal = performance.now()
    const surrealCandidates = await Effect.runPromise(surrealStore.recall(query))
    const dtSurreal = performance.now() - tSurreal

    // Evaluate Retrieval Quality against Ground Truth
    function evaluateRetrieval(candidates: readonly RecallCandidate[], latencyMs: number, oracleIds: string[]): RetrievalEvaluation {
      const ids = candidates.map((c) => c.document.id)
      const top1 = ids[0]
      const recallAt1 = top1 && sc.labels.MUST_RECALL.includes(top1) ? 1.0 : 0.0

      const mustRecallMatches = sc.labels.MUST_RECALL.filter((id) => (ids as readonly string[]).includes(id)).length
      const recallAt5 = sc.labels.MUST_RECALL.length > 0 ? mustRecallMatches / sc.labels.MUST_RECALL.length : 1.0

      const relevantMatches = ids.filter((id) =>
        sc.labels.MUST_RECALL.includes(id as string) || sc.labels.USEFUL_IF_RECALLED.includes(id as string)
      ).length
      const precisionAt5 = ids.length > 0 ? relevantMatches / ids.length : 0.0

      let mrr = 0.0
      for (let i = 0; i < ids.length; i++) {
        if (sc.labels.MUST_RECALL.includes(ids[i]!)) {
          mrr = 1.0 / (i + 1)
          break
        }
      }

      const dangerousDistractorRetrieved = ids.some((id) => sc.labels.DANGEROUS_DISTRACTOR.includes(id))
      // Stale leakage check: check if any historical or rejected memory was marked verified
      const staleMemoryLeakedToActive = candidates.some((c) =>
        (sc.labels.HISTORICAL_ONLY.includes(c.document.id) || sc.labels.MUST_NOT_TREAT_CURRENT.includes(c.document.id)) &&
        c.document.epistemicStatus === "verified"
      )
      const rejectedApproachRecalled = ids.some((id) =>
        sc.corpus.find((doc: any) => doc.id === id && (doc.kind === "failure" || doc.epistemicStatus === "rejected"))
      )

      let annMatches = 0
      for (const id of ids) {
        if (oracleIds.includes(id)) annMatches++
      }
      const annRecallAt5VsOracle = oracleIds.length > 0 ? annMatches / Math.min(oracleIds.length, 5) : 1.0

      return {
        backend: "",
        recallAt1,
        recallAt5,
        precisionAt5,
        mrr,
        dangerousDistractorRetrieved,
        staleMemoryLeakedToActive,
        rejectedApproachRecalled,
        annRecallAt5VsOracle,
        retrievedCandidateIds: ids,
        topScore: candidates[0]?.scores.compositeScore ?? 0,
        latencyMs,
      }
    }

    const sqliteOracleIds = sqliteCandidates.map((c) => c.document.id)
    const evalSqlite = { ...evaluateRetrieval(sqliteCandidates, dtSqlite, sqliteOracleIds), backend: "SqliteRecallStore" }
    const evalSurreal = { ...evaluateRetrieval(surrealCandidates, dtSurreal, sqliteOracleIds), backend: "SurrealRecallStore" }

    console.log(`  Retrieval: SQLite Recall@5=${evalSqlite.recallAt5} (${Math.round(dtSqlite)}ms) | Surreal Recall@5=${evalSurreal.recallAt5} (${Math.round(dtSurreal)}ms, ANN=${Math.round(evalSurreal.annRecallAt5VsOracle * 100)}%)`)

    // -------------------------------------------------------------
    // 2. LAYER 2: REAL-AGENT UTILITY EVALUATION (4 Conditions × 3 Trials)
    // -------------------------------------------------------------
    const hardState = new HardState()
    // For user premise traps, add conflicting claim to hardState so premise conflict detector triggers
    if (sc.id === "S23") {
      hardState.obligations.set("oblg_token_revocation" as any, "Mandatory JWT revocation on user logout via Bloom filter and Redis blacklist")
    } else if (sc.id === "S24") {
      hardState.claims.set("claim_payment_non_idempotent" as any, {
        id: "claim_payment_non_idempotent" as any,
        proposition: "Payment balance deductions and charges are strictly NON-IDEMPOTENT and require unique Idempotency-Key",
        status: "verified",
        validityPolicy: "EPISTEMIC",
        validFromRevision: Revision.from(100),
        learnedAtRevision: Revision.from(100),
        dependencies: [],
        dependsOn: [],
        supportingEvidence: [],
        scope: Scope.global("repo", Revision.from(100)),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }

    // Build CognitiveView for each condition
    // Condition A: No Memory (No hard state active claims, no frontier)
    const emptyHardState = new HardState()
    const viewA = new CognitiveView(CognitiveViewCompiler.compile({
      hardState: emptyHardState,
      goalDescription: sc.goal,
      repositoryId: sc.scope.repo,
      userPrompt: sc.prompt,
      tokenBudget: 4000,
      mode: "HYBRID",
    }) as any)

    // Condition B: Validity Only (Canonical hard state, but no associative recall frontier)
    const viewB = new CognitiveView(CognitiveViewCompiler.compile({
      hardState,
      goalDescription: sc.goal,
      repositoryId: sc.scope.repo,
      userPrompt: sc.prompt,
      tokenBudget: 4000,
      mode: "HYBRID",
    }) as any)

    // Condition C: Rivet + SQLite Memory Frontier
    const frontierSqlite = await Effect.runPromise(
      AutomaticRecallAdmissionHook.admitRecall({
        hardState,
        recallStore: sqliteStore,
        userPrompt: sc.prompt,
        goalDescription: sc.goal,
        repositoryId: sc.scope.repo,
        scope,
        revision: Revision.from(sc.scope.rev),
        focusSymbols: sc.activeSymbols,
      })
    )
    const viewC = new CognitiveView(CognitiveViewCompiler.compile({
      hardState,
      goalDescription: sc.goal,
      repositoryId: sc.scope.repo,
      userPrompt: sc.prompt,
      memoryFrontier: frontierSqlite,
      tokenBudget: 4000,
      mode: "HYBRID",
    }) as any)

    // Condition D: Rivet + SurrealDB Memory Frontier
    const frontierSurreal = await Effect.runPromise(
      AutomaticRecallAdmissionHook.admitRecall({
        hardState,
        recallStore: surrealStore,
        userPrompt: sc.prompt,
        goalDescription: sc.goal,
        repositoryId: sc.scope.repo,
        scope,
        revision: Revision.from(sc.scope.rev),
        focusSymbols: sc.activeSymbols,
      })
    )
    const viewD = new CognitiveView(CognitiveViewCompiler.compile({
      hardState,
      goalDescription: sc.goal,
      repositoryId: sc.scope.repo,
      userPrompt: sc.prompt,
      memoryFrontier: frontierSurreal,
      tokenBudget: 4000,
      mode: "HYBRID",
    }) as any)

    const conditions = [
      { cond: "A_NO_MEMORY" as const, view: viewA },
      { cond: "B_VALIDITY_ONLY" as const, view: viewB },
      { cond: "C_SQLITE_RECALL" as const, view: viewC },
      { cond: "D_SURREAL_RECALL" as const, view: viewD },
    ]

    const allConditionTasks: { cond: any; view: any; trial: number }[] = []
    for (const c of conditions) {
      for (let t = 0; t < TRIALS_PER_CONDITION; t++) {
        allConditionTasks.push({ cond: c.cond, view: c.view, trial: t })
      }
    }

    const agentTrials: AgentTrialResult[] = []
    let baselineFailed = false
    const CHUNK_SIZE = 6

    for (let i = 0; i < allConditionTasks.length; i += CHUNK_SIZE) {
      const chunk = allConditionTasks.slice(i, i + CHUNK_SIZE)
      const chunkResults = await Promise.all(
        chunk.map(async ({ cond, view, trial }) => {
          const promptBlock = view.formatPromptBlock()
          const systemPrompt = `You are a principal software engineer participating in a Rivet-governed development session.
Authority: Harness
Contract: Rivet Harness v1

When diagnosing bugs and answering architecture questions:
1. Adhere strictly to validated system facts, previous decisions, and failure-avoidance warnings.
2. Resist user premises that contradict authoritative state or verified invariants.
3. Do NOT repeat known rejected approaches.

${promptBlock}`

          const response = await invokeLLM(PRIMARY_MODEL, systemPrompt, sc.prompt)
          const evalOutcome = evaluateAgentResponse(response.text, sc, cond, baselineFailed)
          if ((cond === "A_NO_MEMORY" || cond === "B_VALIDITY_ONLY") && !evalOutcome.taskSuccess) {
            baselineFailed = true
          }
          return {
            condition: cond,
            model: PRIMARY_MODEL,
            trialIndex: trial,
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            latencyMs: response.latencyMs,
            responseText: response.text,
            ...evalOutcome,
          }
        })
      )
      agentTrials.push(...chunkResults)
    }

    const cSuccessCount = agentTrials.filter((a) => a.condition === "C_SQLITE_RECALL" && a.taskSuccess).length
    const dSuccessCount = agentTrials.filter((a) => a.condition === "D_SURREAL_RECALL" && a.taskSuccess).length
    const bSuccessCount = agentTrials.filter((a) => a.condition === "B_VALIDITY_ONLY" && a.taskSuccess).length
    console.log(`  Real LLM (${PRIMARY_MODEL}): ValidityOnly=${bSuccessCount}/${TRIALS_PER_CONDITION} | SQLite=${cSuccessCount}/${TRIALS_PER_CONDITION} | Surreal=${dSuccessCount}/${TRIALS_PER_CONDITION}`)

    fullResults.push({
      scenarioId: sc.id,
      family: sc.family,
      title: sc.title,
      retrieval: {
        sqlite: evalSqlite,
        surreal: evalSurreal,
      },
      agentTrials,
    })

    await Effect.runPromise(surrealStore.close())
    try { fs.unlinkSync(sqliteDbPath) } catch {}
  }

  // -------------------------------------------------------------
  // 3. SECOND MODEL FAMILY (DEEPSEEK V4 FLASH) ON REPRESENTATIVE SUBSET
  // -------------------------------------------------------------
  console.log("\n--- Running Second Model Family (opencode-go/deepseek-v4-flash) Validation ---")
  const SECOND_MODEL = "opencode-go/deepseek-v4-flash"
  const subsetScenarios = scenarios.filter((s) => ["S01", "S03", "S05", "S07", "S19", "S23"].includes(s.id))

  for (const sc of subsetScenarios) {
    console.log(`  Evaluating DeepSeek on ${sc.id}: ${sc.title}...`)
    // Run 1 trial across Conditions B, C, D to verify cross-model robustness
    const scope = Scope.path(sc.scope.repo, sc.scope.path, Revision.from(sc.scope.rev))
    const wsId = createWorkspaceId(`ws_ds_${sc.id.toLowerCase()}`)
    const corpusDocs = sc.corpus.map((raw: any) => ({
      id: createMemoryId(raw.id),
      kind: raw.kind,
      text: raw.text,
      summary: raw.summary,
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: raw.relatedSymbols ?? [],
      epistemicStatus: raw.epistemicStatus,
      validFromRevision: raw.validFromRev ? Revision.from(raw.validFromRev) : undefined,
      observedAt: raw.observedAt ?? Date.now(),
      relationships: raw.relationships ?? [],
      metadata: raw.metadata ?? {},
    }))

    const sqliteDbPath = `/tmp/rivet-eval-ds-${sc.id}.db`
    const sqliteStore = new SqliteRecallStore(sqliteDbPath, embedding)
    await Effect.runPromise(sqliteStore.index(corpusDocs))
    const surrealStore = new SurrealRecallStore("mem://", embedding)
    await Effect.runPromise(surrealStore.index(corpusDocs))

    const hardState = new HardState()
    if (sc.id === "S23") {
      hardState.obligations.set("oblg_token_revocation" as any, "Mandatory JWT revocation on user logout via Bloom filter and Redis blacklist")
    }

    const frontierSqlite = await Effect.runPromise(AutomaticRecallAdmissionHook.admitRecall({
      hardState, recallStore: sqliteStore, userPrompt: sc.prompt, goalDescription: sc.goal, repositoryId: sc.scope.repo, scope, revision: Revision.from(sc.scope.rev), focusSymbols: sc.activeSymbols
    }))
    const viewC = new CognitiveView(CognitiveViewCompiler.compile({
      hardState, goalDescription: sc.goal, repositoryId: sc.scope.repo, userPrompt: sc.prompt, memoryFrontier: frontierSqlite, tokenBudget: 4000, mode: "HYBRID"
    }) as any)

    const frontierSurreal = await Effect.runPromise(AutomaticRecallAdmissionHook.admitRecall({
      hardState, recallStore: surrealStore, userPrompt: sc.prompt, goalDescription: sc.goal, repositoryId: sc.scope.repo, scope, revision: Revision.from(sc.scope.rev), focusSymbols: sc.activeSymbols
    }))
    const viewD = new CognitiveView(CognitiveViewCompiler.compile({
      hardState, goalDescription: sc.goal, repositoryId: sc.scope.repo, userPrompt: sc.prompt, memoryFrontier: frontierSurreal, tokenBudget: 4000, mode: "HYBRID"
    }) as any)

    const dsConditions = [
      { cond: "C_SQLITE_RECALL" as const, view: viewC },
      { cond: "D_SURREAL_RECALL" as const, view: viewD },
    ]

    for (const { cond, view } of dsConditions) {
      const promptBlock = view.formatPromptBlock()
      const systemPrompt = `You are a principal software engineer participating in a Rivet-governed development session.
Authority: Harness
Contract: Rivet Harness v1
${promptBlock}`
      const response = await invokeLLM(SECOND_MODEL, systemPrompt, sc.prompt)
      const outcome = evaluateAgentResponse(response.text, sc, cond, false)

      const targetFull = fullResults.find((r) => r.scenarioId === sc.id)
      if (targetFull) {
        targetFull.agentTrials.push({
          condition: cond,
          model: SECOND_MODEL,
          trialIndex: 0,
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          latencyMs: response.latencyMs,
          responseText: response.text,
          ...outcome,
        })
      }
    }

    await Effect.runPromise(surrealStore.close())
    try { fs.unlinkSync(sqliteDbPath) } catch {}
  }

  // -------------------------------------------------------------
  // 4. HNSW QUALITY & LATENCY TRADE-OFF EVALUATION
  // -------------------------------------------------------------
  console.log("\n--- Evaluating SurrealDB HNSW Quality & Latency Trade-Off ---")
  const hnswConfigs = [
    { k: 5, ef: 20, label: "k=5, ef=20 (fast)" },
    { k: 5, ef: 40, label: "k=5, ef=40 (default)" },
    { k: 10, ef: 40, label: "k=10, ef=40 (expanded k)" },
    { k: 10, ef: 80, label: "k=10, ef=80 (high precision)" },
  ]
  const hnswResults: any[] = []
  for (const cfg of hnswConfigs) {
    const lats: number[] = []
    let annMatches = 0
    let totalOracle = 0

    for (const sc of scenarios.slice(0, 10)) {
      const scope = Scope.path(sc.scope.repo, sc.scope.path, Revision.from(sc.scope.rev))
      const wsId = createWorkspaceId(`ws_hnsw_${sc.id.toLowerCase()}`)
      const corpusDocs = sc.corpus.map((raw: any) => ({
        id: createMemoryId(raw.id),
        kind: raw.kind,
        text: raw.text,
        summary: raw.summary,
        workspaceId: wsId,
        scope,
        sourceRefs: [],
        relatedSymbols: raw.relatedSymbols ?? [],
        epistemicStatus: raw.epistemicStatus,
        validFromRevision: raw.validFromRev ? Revision.from(raw.validFromRev) : undefined,
        observedAt: raw.observedAt ?? Date.now(),
        relationships: raw.relationships ?? [],
        metadata: raw.metadata ?? {},
      }))

      const sqliteDbPath = `/tmp/rivet-hnsw-oracle-${sc.id}.db`
      const sqliteStore = new SqliteRecallStore(sqliteDbPath, embedding)
      await Effect.runPromise(sqliteStore.index(corpusDocs))
      const oracle = await Effect.runPromise(sqliteStore.recall({
        prompt: sc.prompt, goal: sc.goal, scope, revision: Revision.from(sc.scope.rev), activeSymbols: sc.activeSymbols, activeClaims: [], limit: 5
      }))
      const oracleIds = oracle.map((c) => c.document.id)

      const store = new SurrealRecallStore("mem://", embedding)
      await Effect.runPromise(store.index(corpusDocs))

      const t0 = performance.now()
      const candidates = await Effect.runPromise(store.recall({
        prompt: sc.prompt, goal: sc.goal, scope, revision: Revision.from(sc.scope.rev), activeSymbols: sc.activeSymbols, activeClaims: [], limit: cfg.k
      }))
      const dt = performance.now() - t0
      lats.push(dt)

      const top5Ids = candidates.slice(0, 5).map((c) => c.document.id)
      totalOracle += Math.min(oracleIds.length, 5)
      for (const id of top5Ids) {
        if (oracleIds.includes(id)) annMatches++
      }

      await Effect.runPromise(store.close())
      try { fs.unlinkSync(sqliteDbPath) } catch {}
    }

    const avgLat = lats.reduce((a, b) => a + b, 0) / (lats.length || 1)
    const annRecall = totalOracle > 0 ? annMatches / totalOracle : 1.0
    hnswResults.push({ config: cfg.label, avgLatencyMs: Math.round(avgLat * 10) / 10, annRecallAt5: Math.round(annRecall * 100) / 100 })
  }
  console.table(hnswResults)

  // -------------------------------------------------------------
  // 5. RETRIEVAL CHANNEL ABLATIONS (24 Scenarios)
  // -------------------------------------------------------------
  console.log("\n--- Evaluating Retrieval Channel Ablations ---")
  const ablationConfigs = [
    { name: "Full Hybrid (All Channels)", weights: { semantic: 0.35, lexical: 0.25, graph: 0.20, temporal: 0.10, scope: 0.10 } },
    { name: "Ablation: No Graph (graph=0)", weights: { semantic: 0.45, lexical: 0.35, graph: 0.0, temporal: 0.10, scope: 0.10 } },
    { name: "Ablation: No Vector (semantic=0)", weights: { semantic: 0.0, lexical: 0.50, graph: 0.30, temporal: 0.10, scope: 0.10 } },
    { name: "Ablation: No Lexical (lexical=0)", weights: { semantic: 0.55, lexical: 0.0, graph: 0.25, temporal: 0.10, scope: 0.10 } },
  ]
  const ablationResults: any[] = []

  for (const abl of ablationConfigs) {
    let totalRecall = 0
    let totalPrec = 0

    for (const sc of scenarios) {
      const scope = Scope.path(sc.scope.repo, sc.scope.path, Revision.from(sc.scope.rev))
      const wsId = createWorkspaceId(`ws_abl_${sc.id.toLowerCase()}`)
      const corpusDocs = sc.corpus.map((raw: any) => ({
        id: createMemoryId(raw.id),
        kind: raw.kind,
        text: raw.text,
        summary: raw.summary,
        workspaceId: wsId,
        scope,
        sourceRefs: [],
        relatedSymbols: raw.relatedSymbols ?? [],
        epistemicStatus: raw.epistemicStatus,
        validFromRevision: raw.validFromRev ? Revision.from(raw.validFromRev) : undefined,
        observedAt: raw.observedAt ?? Date.now(),
        relationships: raw.relationships ?? [],
        metadata: raw.metadata ?? {},
      }))

      const store = new SurrealRecallStore("mem://", embedding, abl.weights)
      await Effect.runPromise(store.index(corpusDocs))

      const candidates = await Effect.runPromise(store.recall({
        prompt: sc.prompt, goal: sc.goal, scope, revision: Revision.from(sc.scope.rev), activeSymbols: sc.activeSymbols, activeClaims: [], limit: 5
      }))
      const ids = candidates.map((c) => c.document.id)

      const mustRecallMatches = sc.labels.MUST_RECALL.filter((id) => (ids as readonly string[]).includes(id)).length
      const r5 = sc.labels.MUST_RECALL.length > 0 ? mustRecallMatches / sc.labels.MUST_RECALL.length : 1.0
      const relMatches = ids.filter((id) => sc.labels.MUST_RECALL.includes(id as string) || sc.labels.USEFUL_IF_RECALLED.includes(id as string)).length
      const p5 = ids.length > 0 ? relMatches / ids.length : 0.0

      totalRecall += r5
      totalPrec += p5

      await Effect.runPromise(store.close())
    }

    ablationResults.push({
      ablation: abl.name,
      meanRecallAt5: (totalRecall / scenarios.length).toFixed(3),
      meanPrecisionAt5: (totalPrec / scenarios.length).toFixed(3),
    })
  }
  console.table(ablationResults)

  // -------------------------------------------------------------
  // 6. WRITE RAW RESULTS TO DISK
  // -------------------------------------------------------------
  const payload = {
    metadata: {
      date: new Date().toISOString(),
      gitSha: "f952d38268251f9def387da03bd8469511664c61",
      primaryModel: PRIMARY_MODEL,
      secondModel: SECOND_MODEL,
      trialsPerCondition: TRIALS_PER_CONDITION,
      totalScenarios: scenarios.length,
    },
    hnswEvaluation: hnswResults,
    ablations: ablationResults,
    scenarios: fullResults,
  }
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2))
  console.log(`\nSuccessfully wrote full evaluation raw results to: ${RESULTS_PATH}`)

  // -------------------------------------------------------------
  // 7. AGGREGATE SUMMARY & CONSOLE REPORT
  // -------------------------------------------------------------
  console.log("\n=== EVALUATION SUMMARY ===")
  const totalScenarios = fullResults.length
  const avgSqliteRecall5 = fullResults.reduce((acc, r) => acc + r.retrieval.sqlite.recallAt5, 0) / totalScenarios
  const avgSurrealRecall5 = fullResults.reduce((acc, r) => acc + r.retrieval.surreal.recallAt5, 0) / totalScenarios
  const avgSqlitePrec5 = fullResults.reduce((acc, r) => acc + r.retrieval.sqlite.precisionAt5, 0) / totalScenarios
  const avgSurrealPrec5 = fullResults.reduce((acc, r) => acc + r.retrieval.surreal.precisionAt5, 0) / totalScenarios
  const avgAnnRecall = fullResults.reduce((acc, r) => acc + r.retrieval.surreal.annRecallAt5VsOracle, 0) / totalScenarios
  const distractorCountSqlite = fullResults.filter((r) => r.retrieval.sqlite.dangerousDistractorRetrieved).length
  const distractorCountSurreal = fullResults.filter((r) => r.retrieval.surreal.dangerousDistractorRetrieved).length

  console.log(`Retrieval Recall@5:   SQLite = ${(avgSqliteRecall5 * 100).toFixed(1)}% | Surreal = ${(avgSurrealRecall5 * 100).toFixed(1)}%`)
  console.log(`Retrieval Precision@5: SQLite = ${(avgSqlitePrec5 * 100).toFixed(1)}% | Surreal = ${(avgSurrealPrec5 * 100).toFixed(1)}%`)
  console.log(`Surreal ANN Recall@5 vs SQLite Oracle: ${(avgAnnRecall * 100).toFixed(1)}%`)
  console.log(`Dangerous Distractor Retrieved: SQLite = ${distractorCountSqlite}/${totalScenarios} | Surreal = ${distractorCountSurreal}/${totalScenarios}`)

  const gptTrials = fullResults.flatMap((r) => r.agentTrials.filter((t) => t.model === PRIMARY_MODEL))
  const successRate = (cond: string) => {
    const trials = gptTrials.filter((t) => t.condition === cond)
    const success = trials.filter((t) => t.taskSuccess).length
    return { count: success, total: trials.length, pct: (success / (trials.length || 1)) * 100 }
  }

  const sA = successRate("A_NO_MEMORY")
  const sB = successRate("B_VALIDITY_ONLY")
  const sC = successRate("C_SQLITE_RECALL")
  const sD = successRate("D_SURREAL_RECALL")

  console.log(`\nAgent Downstream Task Success (${PRIMARY_MODEL}, 3 trials per scenario):`)
  console.log(`  Condition A (No Memory):       ${sA.count}/${sA.total} (${sA.pct.toFixed(1)}%)`)
  console.log(`  Condition B (Validity Only):   ${sB.count}/${sB.total} (${sB.pct.toFixed(1)}%)`)
  console.log(`  Condition C (SQLite Recall):   ${sC.count}/${sC.total} (${sC.pct.toFixed(1)}%)`)
  console.log(`  Condition D (Surreal Recall):  ${sD.count}/${sD.total} (${sD.pct.toFixed(1)}%)`)
}

main().catch(console.error)

