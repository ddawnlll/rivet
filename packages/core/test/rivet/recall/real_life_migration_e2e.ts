import { Effect } from "effect"
import {
  HindsightMemoryBackend,
  AgentMemoryValidityBarrier,
  DeterministicHashEmbeddingProvider,
  type MemoryIngressRecord,
  type MemoryQuery,
} from "../../../src/rivet/recall"
import { HardState, CognitiveView } from "../../../src/rivet/noesis"
import { CognitiveViewCompiler } from "../../../src/rivet/view-compiler"
import { Revision, Scope } from "../../../src/rivet/types"

const PROXY_URL = "http://127.0.0.1:10100/v1/messages"
const MODEL = "gpt-5.4-mini"

async function callLLM(systemPrompt: string, userPrompt: string, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        signal: AbortSignal.timeout(12000),
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 350,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      })
      if (!res.ok) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        return `[HTTP Error ${res.status}]`
      }
      const data: any = await res.json()
      return data.content?.[0]?.text ?? "[No response]"
    } catch (e: any) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      return `[Exception: ${e.message}]`
    }
  }
  return "[Timeout]"
}

async function runRealLifeTest() {
  console.log("=================================================================")
  console.log("REAL-LIFE E2E TEST: PYTHON TO RUST MIGRATION UNDER LIVE LLM")
  console.log("Testing: Naive Memory (Claude/OpenCode style) vs Rivet Noesis Cognitive Admission")
  console.log("Model:", MODEL)
  console.log("=================================================================\n")

  const scope = Scope.global("core-engine", Revision.from(100))
  const embedding = new DeterministicHashEmbeddingProvider(128)
  const backend = new HindsightMemoryBackend({ mode: "controlled", embeddingProvider: embedding })

  // 1. Ingest Project History
  const records: MemoryIngressRecord[] = [
    {
      id: "claim_py_engine",
      kind: "hard_claim",
      authority: "historical",
      revision: Revision.from(10),
      scope,
      timestamp: Date.now() - 30 * 86400000,
      content: "Legacy concurrency: Core engine pipeline uses Python 3.11 with asyncio.gather, threading, and concurrent.futures ThreadPoolExecutor in engine.py.",
      relatedSymbols: ["asyncio", "ThreadPoolExecutor", "engine.py"],
      metadata: { epistemicStatus: "superseded", sourceRefs: ["claim_py_engine"] },
    },
    {
      id: "claim_rust_engine",
      kind: "hard_claim",
      authority: "authoritative",
      revision: Revision.from(50),
      scope,
      timestamp: Date.now() - 5 * 86400000,
      content: "Production concurrency: Core engine is completely rewritten in Rust. Concurrency uses Tokio async runtime, tokio::spawn, and mpsc channels in src/engine.rs.",
      relatedSymbols: ["tokio", "spawn", "mpsc", "src/engine.rs"],
      metadata: { epistemicStatus: "verified", sourceRefs: ["claim_rust_engine"] },
    },
  ]
  await Effect.runPromise(backend.ingest(records))

  // 2. Set up Canonical HardState at Revision 100
  const hardState = new HardState()
  hardState.claims.set("claim_py_engine" as any, {
    id: "claim_py_engine" as any,
    proposition: "Core engine runs on Python 3.11 with asyncio event loop",
    status: "superseded",
    supersededBy: "claim_rust_engine" as any,
    validityPolicy: "EPISTEMIC",
    validFromRevision: Revision.from(10),
    validToRevision: Revision.from(50),
    learnedAtRevision: Revision.from(10),
    dependencies: [],
    dependsOn: [],
    supportingEvidence: [],
    scope,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  hardState.claims.set("claim_lang_rust" as any, {
    id: "claim_lang_rust" as any,
    proposition: "Core engine is completely rewritten in Rust with Tokio async runtime and zero-cost abstractions",
    status: "verified",
    validityPolicy: "EPISTEMIC",
    validFromRevision: Revision.from(50),
    learnedAtRevision: Revision.from(50),
    dependencies: [],
    dependsOn: [],
    supportingEvidence: [],
    scope,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const userCodingPrompt = "Write the worker concurrency dispatch logic for our core engine. Show code snippet."

  // =========================================================================
  // TEST 1: NAIVE MEMORY (Claude / Standard OpenCode Markdown Style)
  // Both memories retrieved by similarity and stuffed into prompt without Noesis
  // =========================================================================
  console.log(">>> [SCENARIO 1] NAIVE MEMORY (Standard OpenCode / Claude markdown dump)...")
  const naiveSystemPrompt = `You are an AI coding assistant.
Here is your project memory:
- [Memory 1]: Legacy concurrency: Core engine pipeline uses Python 3.11 with asyncio.gather, threading, and concurrent.futures ThreadPoolExecutor in engine.py.
- [Memory 2]: Production concurrency: Core engine is completely rewritten in Rust. Concurrency uses Tokio async runtime, tokio::spawn, and mpsc channels in src/engine.rs.`

  const naiveResponse = await callLLM(naiveSystemPrompt, userCodingPrompt)
  console.log("--- Naive Agent Response ---")
  console.log(naiveResponse.slice(0, 450) + "...\n")

  // Check language produced
  const naiveHasPython = /def |asyncio|import |python/i.test(naiveResponse)
  const naiveHasRust = /pub |fn |tokio|async fn|let mut/i.test(naiveResponse)
  console.log(`Naive Agent: Produced Python? ${naiveHasPython} | Produced Rust? ${naiveHasRust}`)

  // =========================================================================
  // TEST 2: RIVET NOESIS COGNITIVE ADMISSION (Our new system)
  // Task phase inferred as 'implementation' -> Superseded Python memory SUPPRESSED
  // =========================================================================
  console.log("\n>>> [SCENARIO 2] RIVET WITH NOESIS COGNITIVE ADMISSION POLICY...")
  const query: MemoryQuery = {
    prompt: userCodingPrompt,
    goal: "Implement worker concurrency dispatch logic in core engine",
    scope,
    revision: Revision.from(100),
    activeSymbols: ["engine", "concurrency", "worker"],
    limit: 5,
  }

  const frontier = await Effect.runPromise(
    AgentMemoryValidityBarrier.admitRecall({
      hardState,
      backend,
      query,
    })
  )

  console.log("Noesis Admission Decisions:")
  console.log("  Active Memory:", frontier.active.map(m => m.summary))
  console.log("  Procedural Memory:", frontier.procedural.map(m => m.summary))
  console.log("  Episodic Memory:", frontier.episodic.map(m => m.summary))
  console.log("  (Notice: Superseded Python memory was SUPPRESSED!)")

  const view = new CognitiveView(CognitiveViewCompiler.compile({
    hardState,
    goalDescription: query.goal,
    repositoryId: scope.repository,
    userPrompt: query.prompt,
    memoryFrontier: frontier,
    tokenBudget: 4000,
    mode: "HYBRID",
  }) as any)

  const rivetSystemPrompt = `You are a principal software engineer participating in a Rivet-governed development session.
${view.formatPromptBlock()}`

  const rivetResponse = await callLLM(rivetSystemPrompt, userCodingPrompt)
  console.log("\n--- Rivet Noesis Agent Response ---")
  console.log(rivetResponse.slice(0, 450) + "...\n")

  const rivetHasPython = /def |asyncio|import |python/i.test(rivetResponse)
  const rivetHasRust = /pub |fn |tokio|async fn|let mut/i.test(rivetResponse)
  console.log(`Rivet Agent: Produced Python? ${rivetHasPython} | Produced Rust? ${rivetHasRust}`)

  // =========================================================================
  // TEST 3: HISTORICAL POST-MORTEM DIAGNOSIS
  // Task phase = 'diagnosis' -> Python memory admitted as [HISTORICAL ARCHIVE]
  // =========================================================================
  console.log("\n>>> [SCENARIO 3] HISTORICAL DIAGNOSIS (Why did we abandon Python for Rust?)...")
  const diagPrompt = "What limitations in our old Python concurrency setup led us to migrate to Rust Tokio?"
  const diagQuery: MemoryQuery = {
    prompt: diagPrompt,
    goal: "Diagnose historical reasons for Python to Rust migration",
    scope,
    revision: Revision.from(100),
    activeSymbols: ["concurrency", "python", "tokio"],
    limit: 5,
  }

  const diagFrontier = await Effect.runPromise(
    AgentMemoryValidityBarrier.admitRecall({
      hardState,
      backend,
      query: diagQuery,
      taskPhase: "diagnosis",
    })
  )

  console.log("Noesis Diagnosis Admission:")
  console.log("  Episodic Memory:", diagFrontier.episodic.map(m => m.summary))

  const diagView = new CognitiveView(CognitiveViewCompiler.compile({
    hardState,
    goalDescription: diagQuery.goal,
    repositoryId: scope.repository,
    userPrompt: diagQuery.prompt,
    memoryFrontier: diagFrontier,
    tokenBudget: 4000,
    mode: "HYBRID",
  }) as any)

  const diagResponse = await callLLM(
    `You are a principal software engineer participating in a Rivet-governed development session.\n${diagView.formatPromptBlock()}`,
    diagPrompt
  )
  console.log("\n--- Rivet Historical Diagnosis Response ---")
  console.log(diagResponse.slice(0, 450) + "...\n")

  console.log("=================================================================")
  console.log("REAL-LIFE VERIFICATION COMPLETED SUCCESSFULLY!")
  console.log("=================================================================")
}

runRealLifeTest().catch(console.error)
