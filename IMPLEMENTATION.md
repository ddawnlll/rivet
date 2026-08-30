# IMPLEMENTATION.md — Rivet Operational Engineering Baseline

**Status:** FROZEN IMPLEMENTATION BOUNDARY (Edition v0.3 / ACCP 3.0)  
**Rule:** Architecture invention is CLOSED. Implement against typed contracts only.

---

## 1. Core Technical Invariants

* **Language & Edition:** Rust 2024.
* **Process Model:** Single OS process, in-memory first, zero internal IPC/RPC/gRPC.
* **Async Runtime:** Tokio only at true I/O (model streaming, process execution, fs, persistence).
* **Harness Ownership:** Rivet owns its Harness Core, session lifecycle, and cognitive state transitions. External agent frameworks are not lifecycle owners.
* **Hard State ≠ Soft Workspace ≠ Context:**
  * **Hard State (`noesis`):** Event-sourced, durable, evidence-bound project beliefs (`redb` backed).
  * **Soft Workspace (`noesis`):** Task/session bounded active hypotheses, scratchpad, candidate actions in RAM.
  * **Context (`rivet-view`):** Ephemeral, task-conditioned projection derived from Hard + Soft state.
* **ACCP 3.0 Conformance (`accp`):** Strict semantic protocol boundary between probabilistic cognition and authoritative runtime state. Model text cannot mint authority, observations, or completion.
* **Praxis Verification (`praxis`):** Mechanically decidable verification engine. Completion requires passing verification gates and signed receipts.
* **Runtime Execution (`rivet-runtime`):** Scoped process execution, filesystem mutations, and Git operations.
* **Hephaestus (`hephaestus`):** Cold-path reframing only when cognitive loops stagnate.

---

## 2. Workspace Crate Layout & Dependency Architecture

```text
crates/
├── rivet                  # [Binary] CLI/TUI composition root (clap + ratatui)
├── rivet-core             # [Engine] Harness Core, Canonical Cognitive Cycle (RunPhase state machine)
├── rivet-types            # [Types] Core shared IDs, Revision, EpistemicStatus, errors
├── noesis                 # [State] HardState (event ledger), SoftWorkspace, StatePromotion
├── accp                   # [Protocol] ACCP 3.0 typed message envelopes, semantics & invariant gates
├── praxis                 # [Verification] Scoped test execution, output parsing, VerificationReceipt
├── hephaestus             # [Reframing] Stagnation detection, frame proposal
├── rivet-model            # [Model] ModelBackend trait, CognitiveAction, InvocationReceipt
├── rivet-model-genai      # [Adapter] genai multi-provider implementation
├── rivet-store            # [Persistence] HardStateStore trait, redb embedded storage backend
├── rivet-repository       # [Induction] Deterministic census, repo frontier, DEFER policy
└── rivet-runtime          # [Execution] OS process runner, file system, Git integration
```

### Dependency Direction Rules

```text
rivet (binary)
      │
  rivet-core
  ┌───┼────────────────────────────────────────┐
  ▼   ▼                                        ▼
noesis accp praxis hephaestus rivet-model rivet-runtime rivet-repository
  │                                   ▲        │
  ▼                                   │        ▼
rivet-store                  rivet-model-genai (adapter)
  │
  ▼
rivet-types (leaf dependencies for shared IDs/contracts)
```

* `rivet-types` is a minimal leaf crate for IDs and fundamental value objects.
* Crates communicate via typed Rust method calls; no internal serialization overhead.
* Provider adapters translate provider-specific formats into strict ACCP types.

---

## 3. Development Invariant Rules

1. **No Semantic Casts:**
   * `ModelClaim ✗→ Observation`
   * `ActionProposal ✗→ ExecutionReceipt`
   * `Test(scope=A) ✗→ Verified(scope=repo)`
   * `CompletionProposal ✗→ Completion`
2. **Replay Determinism:** `same event history → same materialized state`.
3. **No Unanchored Architecture:** No new crate or subsystem without empirical/code-driven necessity.
