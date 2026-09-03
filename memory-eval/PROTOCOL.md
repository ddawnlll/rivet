# Rivet Real-Project Agentic Memory Evaluation Protocol: Hindsight vs agentmemory

**Status:** FROZEN  
**Date:** 2026-09-03  
**Evaluator:** Antigravity Evaluation Engine  
**Frozen Git SHA:** `1522dab`  
**Primary Model:** `gpt-5.4-mini` via local proxy (`http://127.0.0.1:10100/v1/messages`)  
**Target Comparison:** `Hindsight` vs `agentmemory` vs `Rivet Validity-Only Baseline`

---

## 1. Core Authority & Architectural Boundary

Rivet enforces strict epistemic isolation between authoritative truth and associative memory:
```text
                     RIVET
                       │
          ┌────────────┴────────────┐
          │                         │
       NOESIS                 MEMORY ENGINE
    authoritative              associative
          │                         │
          │              ┌──────────┴──────────┐
          │              │                     │
          │         Hindsight             agentmemory
          │
          └──────────── validity ──────────────┐
                                               ▼
                                        MemoryFrontier
                                               ▼
                                         CognitiveView
                                               ▼
                                             LLM
```

### Invariants:
1. `Memory != Evidence`
2. `Memory != Verification`
3. `Memory != Current Truth`
4. `Memory Rank != Authority`
5. `Memory consolidation != VERIFIED`
6. `Historical verification != Current verification`
7. `SoftWorkspace hypothesis != HardState`

Nothing produced by Hindsight or agentmemory may directly mutate authoritative HardState.

---

## 2. Evaluation Tracks

### Track A — Controlled Memory Engine
Both engines receive the exact same normalized Rivet `MemoryIngressRecord` instances (same sessions, same HardState, same SoftWorkspace, same decisions, same failures).
* Answers: *Which engine's retrieval, entity-graph linking, and scoring is superior when given identical epistemic input?*

### Track B — Native Memory Engine
Allows each engine to use its intended native ingestion and consolidation behavior:
* **Hindsight:** Native fact extraction, entity resolution, temporal priming, and 4-network routing (`world`, `experience`, `observation`, `belief`).
* **agentmemory:** Native category-based capture (`facts`, `episodes`, `decisions`, `failures`, `actions`), tool-event capture, and observation consolidation.
* Answers: *Which product works better as an actual agent-memory system when allowed to use its native capture strengths?*

### Hindsight `reflect` Separate Ablation Arm
`reflect` is tested as an isolated ablation arm (Condition F) with separate accounting for reasoning tokens, latency, and cost.

---

## 3. Compared Conditions

| Condition | Description | Ingress Mode |
|---|---|---|
| **Condition A** | Rivet Validity-Only (No memory engine) | N/A |
| **Condition B** | Rivet + Hindsight | Controlled (Track A) |
| **Condition C** | Rivet + agentmemory | Controlled (Track A) |
| **Condition D** | Rivet + Hindsight | Native (Track B) |
| **Condition E** | Rivet + agentmemory | Native (Track B) |
| **Condition F** | Rivet + Hindsight (`reflect` CARA reasoning enabled) | Native (Track B + Reflect) |
| **Condition G** | Rivet + SQLite (Legacy Reference Control) | Legacy |

---

## 4. Evaluation Campaigns & Workload Characteristics

The evaluation executes over multi-session, evolving project lifecycles:
* **Campaign 1 (Distributed Gateway & Authentication):** 12 chronological sessions covering auth token refresh deadlocks, sliding-window rate limiting, in-memory atomics rejection, Ed25519 upgrades, security package refactor, process restart interference, Redis pool 504 timeouts, mTLS migration, long-interval bug return, provisional contamination traps, and node-affinity limiter reversal.
* **Campaign 2 (Embedded Database & Storage Engine):** 12 chronological sessions covering idle connection pool leaks, zero-downtime expand-contract column renames, write-through lock rejection, SurrealDB/RocksDB migration, logger refactoring, sequential scan connection starvation, long-interval migration recall, TCP keepalive provisional trap, historical verification expiration, and non-idempotent balance deductions.

---

## 5. Primary Metrics & Forensic Classifications

1. **Task Success Rate (%):** Mechanically verified task completion passing all required assertions.
2. **Harm Rate (`HARMED_BY_MEMORY_RATE` %):** Rate at which recalled memory induced false anchoring, repeated a rejected approach, or misled the agent into an obsolete diagnosis.
3. **Soft-to-Hard Leakage Rate (%):** Rate at which provisional SoftWorkspace hypotheses are erroneously treated as authoritative HardState claims.
4. **Provisional Anchor Rate (%):** Rate at which the agent anchors its resolution on an unverified provisional guess.
5. **Memory Write Cost:** Extraction and consolidation tokens consumed during native ingestion.
6. **Causal Lift:** Delta in task success and efficiency attributable specifically to memory over the Validity-Only baseline.
