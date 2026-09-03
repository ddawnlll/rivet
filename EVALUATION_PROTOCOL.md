# Rivet Associative Recall Substrate Evaluation Protocol

**Status:** FROZEN  
**Date:** 2026-09-03  
**Frozen Git SHA:** `f952d38268251f9def387da03bd8469511664c61`  
**Evaluation Target:** Real-LLM Comparative Evaluation of Rivet Memory Backends (`SqliteRecallStore` vs `SurrealRecallStore`)

---

## 1. Core Research Questions

1. **Q1 (Recall Utility):** Does associative memory improve Rivet over validity-only baseline?
2. **Q2 (Retrieval Quality):** Does `SurrealRecallStore` improve retrieval quality over `SqliteRecallStore` against labeled ground truth?
3. **Q3 (Agent Utility):** Does `SurrealRecallStore` produce measurably better downstream coding-agent performance than `SqliteRecallStore` on real-model tasks?
4. **Q4 (Scaling Threshold):** At what memory corpus scale ($1\text{k}, 10\text{k}, 50\text{k}, 100\text{k}$) does indexed retrieval provide a measurable advantage over linear scan?
5. **Q5 (Harmful Memory Anchoring):** Does either backend increase false associative recall, stale belief reuse, or harmful memory anchoring on adversarial same-symptom/different-cause scenarios?
6. **Q6 (Channel Contributions):** Which retrieval channels (Semantic Vector, BM25 Lexical, Graph Neighborhood, Temporal, Scope) contribute genuine value?

---

## 2. Experimental Principle & Invariant Control

For every comparative run, all variables are held strictly constant except for the memory backend:
- **Model / Provider:** `gpt-5.4-mini` (OpenAI family) and `opencode-go/deepseek-v4-flash` (DeepSeek family) via Anthropic Messages Protocol at `http://127.0.0.1:10100/v1/messages`.
- **System Contract:** Identical `SystemContract` (`Rivet Harness v1, Authority: Harness`).
- **Noesis State:** Identical canonical `HardState` with valid claims, revision numbers, and provenance.
- **Embedding Representation:** 128-dimensional unit-normalized float vectors via `DeterministicHashEmbeddingProvider` (identical vectors stored and queried in both backends).
- **CognitiveView Implementation:** Identical compilation, filtering, and token budget hint ($B=4000$).
- **Validity Barrier:** Identical read-time validity barrier strictly blocking `STALE` and `SUPERSEDED` memories from entering active truth.
- **Retrieval Budget:** Frozen at $K=5$ top candidates.
- **Verification Policy:** Identical Praxis verification gates.

### 4 Comparative Conditions:
1. **Condition A (Memory Disabled):** Rivet running with no memory frontier and no recall.
2. **Condition B (Validity Only):** Rivet running with canonical `HardState` and read-time validity barriers, but zero associative recall of past episodes.
3. **Condition C (Rivet + SqliteRecallStore):** Exhaustive brute-force cosine linear scan + FTS5 fulltext search.
4. **Condition D (Rivet + SurrealRecallStore):** In-database HNSW vector indexing (`<|5, 40|>`) + native BM25 + RocksDB persistence.

---

## 3. Evaluation Battery: 24 Scenarios Across 12 Families

| ID | Family | Title | Core Diagnostic Test | Ground Truth Category |
|---|---|---|---|---|
| **S01** | Recurring Bug | Auth token refresh deadlock | Deadlock on mutex under concurrent refresh | `MUST_RECALL`: Prior mutex fix |
| **S02** | Recurring Bug | DB pool leak on idle timeout | Unreturned connections in pool | `MUST_RECALL`: Prior connection leak fix |
| **S03** | Same Symptom, Diff Cause | 504 Gateway Timeout | Redis pool exhaustion (NOT old mutex deadlock) | `DANGEROUS_DISTRACTOR`: Old mutex fix |
| **S04** | Same Symptom, Diff Cause | 100% CPU Spike | Infinite event bus loop (NOT old regex backtracking) | `DANGEROUS_DISTRACTOR`: Old regex fix |
| **S05** | Rejected Approach | Clustered rate limiter | Clustered multi-node rate limiter | `MUST_NOT_TREAT_CURRENT`: In-memory atomics |
| **S06** | Rejected Approach | Distributed caching | Cache invalidation stampede | `MUST_NOT_TREAT_CURRENT`: Write-through lock |
| **S07** | Successful Procedure | DB column rename | Zero-downtime column migration | `USEFUL_IF_RECALLED`: Expand/contract steps |
| **S08** | Successful Procedure | TLS certificate rotation | Live cert reload without disconnects | `USEFUL_IF_RECALLED`: Graceful reload procedure |
| **S09** | Superseded State | Build pipeline refactor | Rust cargo build (NOT legacy Python build) | `HISTORICAL_ONLY`: Python build script |
| **S10** | Superseded State | API Authentication | mTLS token exchange (NOT legacy basic auth) | `HISTORICAL_ONLY`: Basic auth headers |
| **S11** | Repository Refactor | Token verification relocation | `src/security/token.ts` (NOT old `src/auth/`) | `USEFUL_IF_RECALLED`: Logic without old path |
| **S12** | Repository Refactor | HTTP client relocation | `src/transport/client.ts` (NOT `src/net/`) | `USEFUL_IF_RECALLED`: Logic without old path |
| **S13** | Name Collision | `RateLimiter` collision | Public gateway limiter (NOT metrics limiter) | `IRRELEVANT`: Internal metrics limiter |
| **S14** | Name Collision | `EventDispatcher` collision | UI dispatcher (NOT Kafka log dispatcher) | `IRRELEVANT`: Kafka consumer dispatcher |
| **S15** | Cross-Session Decision | Concurrency architecture | Optimistic locking rationale | `USEFUL_IF_RECALLED`: OCC architecture rationale |
| **S16** | Cross-Session Decision | Audit compliance | Immutable event stream rationale | `USEFUL_IF_RECALLED`: Compliance event logging |
| **S17** | Historical Verification | Stale verification check | Verification from revision 12 vs current 40 | `HISTORICAL_ONLY`: Revision 12 test pass |
| **S18** | Historical Verification | Staging vs Prod verification | Staging test vs production deployment | `HISTORICAL_ONLY`: Staging test receipt |
| **S19** | Contradictory History | Multi-tenant caching | Multi-tenant tenant-scoped Redis keys | `MUST_NOT_TREAT_CURRENT`: Single-tenant global keys |
| **S20** | Contradictory History | Retry idempotency | Non-idempotent POST (no retry) vs GET | `MUST_NOT_TREAT_CURRENT`: Aggressive retry policy |
| **S21** | Long Irrelevant Interval | Auth memory survival | Survives across 5 intervening frontend sessions | `MUST_RECALL`: Prior auth fix |
| **S22** | Long Irrelevant Interval | Migration pattern survival | Survives across 4 intervening refactor sessions | `MUST_RECALL`: Prior migration pattern |
| **S23** | User Premise Trap | Stateless JWT revocation trap | User claims revocation unnecessary | `MUST_NOT_TREAT_CURRENT`: User premise (reject) |
| **S24** | User Premise Trap | Blind retry trap | User claims all writes are idempotent | `MUST_NOT_TREAT_CURRENT`: User premise (reject) |

---

## 4. Evaluation Metrics

### Layer 1: Retrieval Metrics
- **Recall@1, Recall@5, Recall@10:** Percentage of `MUST_RECALL` items retrieved in top $K$.
- **Precision@5, Precision@10:** Proportion of retrieved items that are `MUST_RECALL` or `USEFUL_IF_RECALLED`.
- **Dangerous Distractor Retrieval Rate:** Rate at which `DANGEROUS_DISTRACTOR` items appear in top 5.
- **Stale Memory Leakage Rate:** Rate at which `HISTORICAL_ONLY` or `MUST_NOT_TREAT_CURRENT` memories are surfaced into active truth rather than historical/rejected frontiers.
- **Mean Reciprocal Rank (MRR):** Reciprocal rank of the first relevant document.
- **ANN Recall@5 Relative to SQLite Oracle:** Overlap between SurrealDB HNSW results and SQLite exhaustive search.

### Layer 2: Real-Agent Utility Metrics
- **Task Success Rate (%):** Mechanically evaluated task completion passing all required assertions.
- **Failure Avoidance Rate (%):** Agent explicitly avoids repeating known rejected approaches.
- **Harmful Memory Anchoring Rate (%):** Agent falsely anchors on an irrelevant/superseded historical memory.
- **Premise Conflict Resistance (%):** Agent detects and rejects false user premises.
- **Token Efficiency:** Mean prompt and completion tokens per task.
- **Trajectory Classification:**
  - `HELPED_BY_MEMORY`: Recalled memory directly assisted faster or correct solution.
  - `NEUTRAL`: Memory had no measurable impact.
  - `HARMED_BY_MEMORY`: Recalled memory misled agent into incorrect hypotheses, repeated errors, or false anchoring.

---

## 5. Execution Environment & Reproducibility

- **OS:** macOS darwin-arm64 (Apple Silicon)
- **Runtime:** Bun v1.3.14
- **Database Engine:** SurrealDB v2.0.8 via `@surrealdb/node` v3.0.3 with native RocksDB persistence
- **SQLite Engine:** Bun native `bun:sqlite`
- **Models:** `gpt-5.4-mini`, `opencode-go/deepseek-v4-flash`
- **Repetitions:** 3 stochastic trials per condition
- **Order:** Interleaved execution across conditions to prevent temporal bias.
