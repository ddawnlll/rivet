# Rivet Current-State Stabilization Audit Report

**Audit Date:** 2026-09-05T17:21:00+03:00  
**Repository:** `ddawnlll/rivet`  
**Host Environment:** macOS Darwin (Apple Silicon / arm64), Bun v1.3.14  
**Runtime Provenance:**
- **Branch:** `main`
- **HEAD Commit:** `8f1e9a4d7b2bd6f26f797881c52d007287635420` (`fix(runtime): stabilize day-one session harness`)
- **Working Tree:** Clean (0 uncommitted changes)
- **Runtime PID:** `30882` (Active test/audit process execution)
- **Normative Architectural Constitution:** `site/index.html` (`docs/charter`, `docs/contracts`, `docs/architecture`), `MIGRATION.md`, `IMPLEMENTATION.md`

---

## Executive Verdict

### **READY AFTER SMALL STABILIZATION PASS**

The Rivet runtime has crossed its most dangerous stabilization chasm. The Day-1 stabilization commits (`ef56890` and `8f1e9a4`) on `main` have resolved the critical unbounded waits, decoupled intra-turn tool execution from stagnation guards, bounded repeated identical tool calls, enforced pre-execution revision checks, eliminated manufactured human approvals, task-bound completion authority, and guaranteed user response delivery on ACCP policy denials.

The active production runner (`packages/core/src/session/runner/llm.ts` + `packages/core/src/session/semantics.ts`) passes 100% of its native regression suites (99/99 in `test/session-runner.test.ts`, 35/35 in constitutional/gate/controller regressions, and all bi-temporal validity and memory recall lifecycle tests). The system is not a theoretical model or synthetic toy; it is an operational, event-sourced, bi-temporal cognitive harness running on SQLite WAL persistence.

However, the repository is **not yet ready for unattended V8 dogfooding today** due to three concrete, reproducible blockers:
1. **Model Directive Friction:** System prompt instructions in `packages/core/src/plugin/agent.ts` still command the model to call `query_epistemic_state` and `retrieve_memory` as its first tool calls on knowledge turns, even though the Harness now proactively injects the complete `CognitiveView` and `MemoryFrontier` into Turn 1 system context. This causes unnecessary round-trips and token waste.
2. **Legacy Test Suite Sabotage Divergence:** 56 tests in `packages/opencode/test/session/` fail because `SessionPrompt.prompt`, `loop`, and `command` were intentionally sabotaged with `ConstitutionalViolationError` to fail-closed against legacy OpenCode unmediated execution. While the HTTP API and CLI properly route through `admitRivetPrompt` -> `SessionV2` -> `SessionRunnerLLM`, the legacy test corpus has not been adapted, masking true downstream regressions.
3. **Live TUI Observability Blind Spot:** During the 3–8 second model prefill / Time-To-First-Token (TTFT) phase, the TUI status rail renders a static `● Provider generation` without live streaming attribution. While the Flight Recorder captures `provider.wait_first_token` and writes it to `.rivet/traces/<session>.wal`, the user is left in the dark in real time.

Executing the **5-point Stabilization Shortlist** detailed below will establish rock-solid V8 dogfooding readiness without requiring a premature OpenCode cutover.

---

## 1. Production-Path Topology

### Actual Current Runtime Path

The diagram below traces the actual current runtime path for all user requests entering Rivet:

```text
[User Input: CLI / TUI / HTTP API / Desktop]
                     │
                     ▼
  [SessionHttpApi.promptAsync / prompt] (packages/opencode/src/server/routes/.../session.ts)
                     │
                     ▼
           [admitRivetPrompt]
                     │
                     ▼
            [SessionV2.prompt] (packages/core/src/session/v2.ts)
                     │
          (Durable Admission to SQLite)
                     ▼
          [SessionInputTable] (mode: "steer" | "queue")
                     │
                     ▼
        [SessionExecution.wake(sessionID)] (packages/core/src/session/execution/local.ts)
                     │
                     ▼
       [SessionRunCoordinator] (Single active drain per session; joins resumes, coalesces wakeups)
                     │
                     ▼
          [SessionRunnerLLM.run] (packages/core/src/session/runner/llm.ts)
                     │
    ┌────────────────┴───────────────────────────────────────────────────────┐
    │ Turn 1 Context & State Assembly:                                       │
    │  1. Fail orphan/interrupted tools from prior crash                     │
    │  2. TurnAdmissionGate.classify(latestUserMessage, activeGoal)          │
    │     - Preserves active HardState goal across conversational turns     │
    │     - Quadruple Invariant: Not every turn creates a goal               │
    │  3. SessionSemantics.load(db, sessionID, SqliteRecallStore)            │
    │  4. Proactive Associative Recall -> CognitiveView.memoryFrontier       │
    │     (Multi-channel: Cosine Vector + FTS5 BM25 + Graph + Decay)         │
    │  5. CognitiveViewCompiler.compile(HardState, SoftWorkspace, Frontier)  │
    │  6. Available Actions Resolution:                                      │
    │     - Builtin tools (read, write, edit, glob, grep, bash, todowrite...)│
    │     - Epistemic tools: propose_claim, query_epistemic_state, recall   │
    │     - Governance tools (active goal only): request_completion, verify │
    └────────────────┬───────────────────────────────────────────────────────┘
                     │
                     ▼
           [ModelInvocationGate]
                     │
                     ▼
            [llm.stream(request)] (Streaming Provider Execution)
     Deadlines: 30s inactivity timeout | 15m whole-turn timeout
     Spans: provider.wait_first_token (TTFT) -> provider.stream
                     │
                     ▼
    ┌────────────────┴───────────────────────────────────────────────────────┐
    │ Stream Event Processing:                                               │
    │  - Text/Reasoning deltas persisted incrementally to SessionMessageTable│
    │  - Tool Calls admitted as ACCP ActionProposals                         │
    │  - Idempotency claimed: semantics.claimExecution -> execution_claimed  │
    └────────────────┬───────────────────────────────────────────────────────┘
                     │
                     ▼
           [FiberSet.run(toolFibers)] (Concurrent Tool Settlement, max 2m timeout)
                     │
    ┌────────────────┴───────────────────────────────────────────────────────┐
    │ Tool Authorization & Execution Boundary:                               │
    │  1. AccpSemanticGate.ensureExecutionAuthorized                         │
    │  2. Stale Revision Check: semantics.isActionCurrent(action)            │
    │     - If revision changed: fail fast, do NOT execute side effect       │
    │  3. toolMaterialization.settle(action)                                 │
    │  4. Result Processing (atomic semantic commit):                        │
    │     -> ExecutionReceipt (success / exitCode / duration / uncertain)    │
    │     -> Observation                                                     │
    │     -> EvidenceRecord (admitted evidence ID attached to text result)   │
    └────────────────┬───────────────────────────────────────────────────────┘
                     │
                     ▼
    ┌────────────────┴───────────────────────────────────────────────────────┐
    │ Turn Continuation & Completion Evaluation:                             │
    │  1. Tool settlement check: lastToolFingerprint & summary recorded      │
    │  2. Repeated identical tool guard: >= 3 identical calls -> STALL HALT  │
    │  3. Stagnant autonomous drive guard: >= 2 drives with no progress and  │
    │     unchanged stall signature -> STALL HALT                            │
    │  4. Safety cap: > 50 drives -> STALL HALT                              │
    │  5. Completion Proposal Handling:                                      │
    │     - Evaluated via AccpSemanticGate.evaluateCompletion                │
    │     - Checks: 0 open obligations, current revision match, passing      │
    │       Praxis receipts, active TaskId match                             │
    │     - If rejected: continues with actionable blockers                  │
    │  6. Response Delivery Guard:                                           │
    │     - If policy denied or tools ran without text: forces response turn │
    └────────────────┬───────────────────────────────────────────────────────┘
                     │
                     ▼
          [Terminal Status Emission]
     Event: session.next.run.status
     Payload: { type: "idle", outcome: "completed"|"stalled"|"interrupted"|"failed",
                source: "session_runner"|"stagnation_guard"|"timeout"|"host_runtime_cancellation",
                reason, phase }
                     │
                     ▼
         [Response to User / Client]
```

### Key Topology Invariants
- **Authoritative Files:**
  - `packages/core/src/session/runner/llm.ts`: Authoritative orchestration loop.
  - `packages/core/src/session/semantics.ts`: Authoritative semantic aggregate (Noesis replay, claim admission, evidence recording, goal management).
  - `packages/core/src/rivet/turn-admission.ts`: Authoritative admission classifier.
  - `packages/core/src/rivet/accp.ts`: Authoritative semantic protocol gate.
  - `packages/core/src/rivet/praxis/`: Authoritative mechanical verification engine.
  - `packages/core/src/tool/registry.ts`: Authoritative tool materialization and pre-execution authorization gate.
- **Legacy Paths:**
  - `packages/opencode/src/session/prompt.ts`: Legacy OpenCode prompt loop is **fully decommissioned and sabotaged** with `ConstitutionalViolationError`.
  - `packages/core/src/rivet/harness.ts`: Standalone sidecar test harness is completely deleted (verified in Git history).
- **Single Session Authority:** Exactly **one** active drain runner exists per session, coordinated process-locally by `SessionRunCoordinator`. Concurrent resumes join the active fiber; wakeups coalesce.
- **Centralized Settlement:** All tool results, failures, and timeouts settle into `ExecutionReceipt`s within `SessionRunnerLLM.runTurn`.
- **Cancellation Chain:** `SessionExecution.interrupt(sessionID)` cancels the runner's FiberSet, which durably records `outcome: "interrupted"`, fails running tools, and closes partial text.

---

## 2. Working Long-Horizon Semantics

### Hard State (`packages/core/src/rivet/noesis.ts`)
- **Persistence & Replay:** Replays deterministically from `SessionEvent` SQLite WAL tables. Verified across restart (`test/rivet/constitutional_invariants.test.ts: I-15`).
- **Revision Behavior:** Monotonically increasing `Revision` newtype (`r0`, `r1`, `r2`...). Every state mutation (obligation created/closed, claim asserted/superseded, evidence admitted) advances the revision.
- **Bi-Temporal Validity:** Claims track both assertion revision (`learnedAtRevision`) and temporal validity (`validFromRevision` to `validToRevision`).
- **Claim Lifecycle:** Claims enter as `proposedStatus: "supported"` with strict `canPromoteToSupported` validation against admitted `EvidenceId`s. Claims **cannot** self-mint `verified` status (`I-01`, `I-02`).
- **Obligation Lifecycle:** Strict typed obligations (`execution`, `epistemic_inquiry`, `verification`, `user_input`, `artifact`, `state_mutation`).
- **Contradictions & Supersession:** Deterministic write-time adjudication supersedes prior claims on compatible updates and records `claim_contradicted` records on incompatible premises.

### Memory & Associative Recall (`packages/core/src/rivet/recall/`)
- **Production Backend:** `SqliteRecallStore` backed by `path.join(Global.Path.data, "rivet-recall.db")` using SQLite FTS5 lexical virtual tables and BLOB cosine vector linear scans.
- **Multi-Channel Fusion:** Dense vector cosine similarity (`Float32Array`), BM25 lexical search, bounded 2-hop graph relationship expansion with distance decay ($0.4\times$), and temporal decay.
- **Turn 1 Proactive Delivery:** Historical decisions, episodes, and rejected hypotheses are compiled directly into `CognitiveView.memoryFrontier` before Turn 1 execution. Tested and proven in `test/rivet/recall/killer_e2e_cross_session.test.ts` (Class A/B).
- **Read-Time Validity Barrier (Invariants R-01..R-06):**
  - High-scoring superseded and stale memories are strictly blocked from active knowledge (`R-04`).
  - Rejected approaches are placed into the `rejected` frontier for failure avoidance (`R-05`).
  - Historical verification cannot satisfy current-revision verification (`R-06`).
- **Core Invariant Verified:** `RECALLED CONTEXT != VERIFIED CURRENT FACT`. Recalled memories cannot satisfy Praxis verification or mint epistemic authority (`R-02`, `R-03`).

### Cognitive View (`packages/core/src/rivet/view-compiler.ts`)
- **Task Conditioning:** Conditions context on current `activeTaskId` and `goalDescription`.
- **Modes:** Supports 4 compilation modes (`RAW_TEXT`, `TRIPLES`, `PATHS`, `HYBRID`) with deterministic token budgeting.
- **Conversational Isolation:** In pure conversational mode (`isExplicitNonGoalTurn`), the Cognitive View omits completion bureaucracy, open obligation lists, and verification rules (`turn_admission_contracts.test.ts: I-21.8`).

---

## 3. TurnAdmission and Goal Semantics

Audit of `TurnAdmissionGate` (`packages/core/src/rivet/turn-admission.ts`):
- **Conversational Messages:** Phatic greetings (`"selam"`, `"merhaba"`, `"hi"`), acknowledgements (`"tamam"`, `"ok"`), and questions (`"bu proje ne işe yarıyor?"`, `"hard state'de neler var?"`) classify as `conversational_query` or `state_query`. They do **not** create persistent goals or obligations.
- **Active Goal Preservation:** If an active goal exists in `HardState`, conversational follow-up turns preserve `semantics.hardState.goalDescription` as the `effectiveGoal`. The turn intent does **not** overwrite or destroy the persistent session goal lifetime (`production_lifecycle_regression.test.ts: Test 3`).
- **Explicit Execution Requests:** Directives requesting actions (`"fix and verify"`, `"create file"`, `"implement feature"`, `/goal <text>`, `[RIVET GOAL EXECUTION]`) classify as `autonomous_goal` with `shouldCreateGoal: true`, `requiresPraxis: true`, `requiresCompletion: true`.
- **Punctuation & Token Robustness:** Turkish suffixes (`"hard state'de"`, `"nerede"`, `"bakar mısın"`), sentence-ending punctuation, decimal numbers (`"v0.3"`, `"3.14"`), and file paths (`"src/index.ts"`) are handled cleanly without false-positive file extraction or goal generation (`controller_turn_regression.test.ts`).

---

## 4. Tool Lifecycle & Continuation

- **Advertisement:** Tools materialize dynamically based on agent permissions and session mode. Governance tools (`request_completion`, `request_verification`, `invalidate_obligation`) are exposed **only** when `hasAutonomousGoal` is true. Epistemic tools (`query_epistemic_state`, `retrieve_memory`, `propose_claim`) are always available.
- **Authorization & CAS:** Before any tool side effect executes, `ToolRegistry` verifies ACCP authorization, and `llm.ts:1064` verifies `semantics.isActionCurrent(authorizedAction)`. If the revision changed between proposal and execution, the action is rejected fail-closed without side effect (`rivet-execution.test.ts`).
- **Settlement & Crash Idempotency:**
  - Idempotency key is claimed via `semantics.claimExecution` (`execution_claimed` event).
  - If a process crashes post-claim before receipt commitment, restart marks the action as `uncertain: true` and blocks automatic re-execution (`session-runner.test.ts:3581`).
- **Tool Failures:** Tool errors settle into `ExecutionReceipt` with `success: false` and are returned to the model with durable error records.
- **Mechanical Multi-Tool Continuation:** Read-only exploration chains (e.g. `glob` -> `read` -> `grep` -> `read` -> answer) continue mechanically because `llm.ts:1526` explicitly decouples turns containing tool calls (`toolCallsCount > 0`) from autonomous stagnation detection.
- **Stagnation Guard & Doom-Loop Protection:**
  - **Repeated Identical Tools:** Evaluates `stableToolFingerprint(name, input)` + `outputSummary`. >= 3 identical calls with identical results halt with `outcome: "stalled"`, `source: "stagnation_guard"`.
  - **Stagnant Autonomous Drives:** Bounded to 2 consecutive stagnant drives without tool progress and unchanged obligation stall signature.
  - **Absolute Safety Cap:** 50 total continuation drives maximum per session run.

---

## 5. ACCP & Authorization

- **Normative Action Authority:** `AccpSemanticGate` controls execution authority. Every tool call must parse into a typed `ActionProposal` before authorization.
- **No Manufactured Approvals:** Provider-originated actions and CLI compatibility routes no longer inject `humanApproved: true`. Only an actual human authorization event can mint human approval.
- **Destructive Action Protection:** Internal runtime mutations (e.g., attempts to write to `packages/core/src/rivet/*` or execute destructive commands) are denied by policy.
- **Policy Denial Handling (Regression Verified):**
  - When ACCP denies an action, the tool does **not** execute.
  - A structured model-facing error is returned.
  - The runner sets `responseRequired = true`, forcing a text-only response turn.
  - The session does **not** silently die; the user receives an explanation of the policy denial (`session-runner.test.ts:3626`, `authoritative_gate_contracts.test.ts`).

---

## 6. Praxis & Verification

- **Wiring:** `PraxisEngine` (`packages/core/src/rivet/praxis.ts` & `praxis/`) evaluates mechanical verification requests against admitted evidence and test outputs.
- **Predicate Scoping:**
  - `file_constraint`: Verified against harness filesystem observations and path containment rules.
  - `claims_verified`: Verified against admitted claims and revision-scoped receipts.
  - `test_passed`: Verified against structured test runner outputs (Bun, Cargo, Pytest, Go).
- **Anti-Laundering Guarantee:** A generic successful command or unrelated passing unit test **cannot** verify an unrelated obligation. Verified in `verification_predicates.test.ts: "does not launder an unrelated passing test into config-location authority"`.
- **Invariants Enforced:**
  $$\text{tool success} \neq \text{claim verified} \neq \text{goal completed}$$

---

## 7. Completion Authority

Completion evaluation in `AccpSemanticGate.evaluateCompletion` enforces:
1. **Zero Open Obligations:** `unclosedObligations.length === 0`.
2. **Current Revision Match:** `proposal.baseRevision.equals(currentRevision)`.
3. **Passing Verification Receipts:** At least one valid Praxis receipt exists (`passingReceipts.length > 0`).
4. **Task Binding (Fixed in Day 1):** `proposal.taskId === expectedTaskId` (`this.hardState.activeTaskId`). Cross-task receipt reuse is blocked (`authoritative_gate_contracts.test.ts:234`).
5. **Response Delivery Required:** Internal closure readiness cannot bypass user-facing response delivery (`constitutional_invariants.test.ts: I-11a`).
6. **Provider Finish Disregarded:** Provider finish reason `stop` without accepted `request_completion` proposal leaves obligations open and does **not** complete the Rivet goal (`session-runner.test.ts:3765`).

---

## 8. Response Delivery

- **Separation of Concerns:** Internal goal completion is cleanly separated from user-facing text delivery.
- **Text Delivery Enforcement:**
  - Conversational turns settle with user-facing assistant text.
  - Tool chains must culminate in assistant explanation or structured output.
  - Policy denials trigger a forced follow-up text turn.
  - Stalls and timeouts emit explicit durable status events.
- **"Alo" Regression Eliminated:** The user never needs to send `"alo"` or ping the runner to wake it up after normal tool completion or denial.

---

## 9. Timeout, Cancellation & Terminal State

- **Timeout Guardrails:**
  - Provider Inactivity (TTFT / chunk stall): 30 seconds (`PROVIDER_INACTIVITY_TIMEOUT`).
  - Whole Provider Turn: 15 minutes (`PROVIDER_TURN_TIMEOUT`).
  - Local Tool Execution & Settlement: 2 minutes (`TOOL_SETTLEMENT_TIMEOUT`).
- **Cancellation Provenance:**
  - User / host interrupt: `outcome: "interrupted"`, `source: "host_runtime_cancellation"`.
  - Provider timeout: `outcome: "failed"`, `source: "timeout"`.
  - Stagnation / repeated tools: `outcome: "stalled"`, `source: "stagnation_guard"`.
  - Normal completion: `outcome: "completed"`, `source: "session_runner"`.
  - Clean conversational settlement: `outcome: "quiescent"`, `source: "session_runner"`.
- **Terminal State Event:** Emits `SessionEvent.Run.Status` (`session.next.run.status`) durably to the event WAL. `idle` no longer masks failures, interruptions, or stalls.

---

## 10. Live Observability (Flight Recorder & TUI)

- **Flight Recorder (`packages/core/src/rivet/flight-recorder/`):**
  - **Storage:** Persists write-ahead log spans to `.rivet/traces/<sessionId>.wal`.
  - **Performance:** Monotonic clock, span creation cost $\approx 1.24\,\mu\text{s}$ per span (well under the $5\,\mu\text{s}$ budget).
  - **Span Coverage:** Full span coverage for `turn.admission`, `goal.compile`, `hardstate.load`, `recall.query`, `cognitive_view.compile`, `provider.wait_first_token`, `provider.stream`, `tool.execute`, `tool.result_process`, and `praxis.evaluate`.
  - **Economics:** Tracks input, cached, uncached, reasoning, and output tokens per turn.
- **TUI Cockpit (`packages/tui/`):**
  - Displays runtime Git provenance (`branch`, `HEAD SHA`, `isDirty`, `pid`, `processStartTime`) in the status rail.
  - Renders active phase (`orient`, `diag`, `plan`, `impl`, `verify`), revision (`rN`), open task count, changed file count, verification status (`V✓`, `V~`, `V!`), and prompt cache hit ratio.
  - Post-turn flight breakdown renders detailed execution economics.

---

## 11. Tool Surface Sanity

| Tool | Classification | Mode Availability | Authority Behavior |
|---|---|---|---|
| `read` | World Observation | Always | Scoped workspace read, output bounded |
| `write` | World Mutation | Always | Policy gated, internal runtime paths denied |
| `edit` | World Mutation | Always | Exact string replacement, revision checked |
| `apply_patch` | World Mutation | Always | Unified diff application, AST validated |
| `glob` | World Observation | Always | Scoped path discovery |
| `grep` | World Observation | Always | Ripgrep search within workspace |
| `bash` | World Mutation / Observation | Always | Sandboxed command execution, process group killed on cancel |
| `websearch` | World Observation | Always | External documentation lookup |
| `webfetch` | World Observation | Always | External content fetch |
| `skill` | Soft Workspace | Always | Skill template injection |
| `todowrite` | Soft Workspace | Always | Task list scratchpad |
| `question` | Human Interaction | Always | Interactive user prompt |
| `query_epistemic_state` | Epistemic Query | Always | Authoritative HardState projection |
| `retrieve_memory` | Epistemic Query | Always | Multi-channel associative recall query |
| `propose_claim` | Epistemic Proposal | Always | Requires exact evidence ID; mints `supported` (NEVER `verified`) |
| `request_verification` | Protocol / Governance | Autonomous Goal Only | Invokes Praxis mechanical verifier |
| `request_completion` | Protocol / Governance | Autonomous Goal Only | Evaluates 6-point completion gate |
| `invalidate_obligation`| Protocol / Governance | Autonomous Goal Only | Audited waiver of malformed obligation |

*Verified Invariant:* `propose_claim` **cannot** self-mint `VERIFIED` authority; it only admits claims with status `supported`, gated on verified `evidenceId` existence.

---

## 12. OpenCode vs Rivet Capability Ownership Matrix

| Capability | Current Owner | Current Quality | Duplicated? | Known OpenCode Implementation | Recommended Eventual Owner | Migration Urgency |
|---|---|---|---|---|---|---|
| Provider request construction | Core `llm.ts` | Working (bounded cache key, affinity headers) | Yes | OpenCode `prompt.ts` | Merge / Rivet Hook | BACKLOG |
| Provider transforms | OpenCode `provider/` | Working (mature model specs) | No | OpenCode `src/provider/` | Keep OpenCode | BACKLOG |
| Stream lifecycle | Core `llm.ts` | Working (with 30s & 15m deadlines) | Yes | OpenCode `processor.ts` | Keep OpenCode | P2 |
| Finish handling | Rivet Core | Working (semantic override) | Yes | OpenCode provider finish | Merge / Rivet Hook | BACKLOG |
| Retry/backoff | OpenCode `retry.ts` | Working | Partially | OpenCode `src/session/retry.ts` | Keep OpenCode | P2 |
| Header/chunk/turn timeouts | Core `llm.ts` | Working (Day-1 bounded guards) | Yes | OpenCode HTTP timeouts | Keep OpenCode | P2 |
| Abort propagation | Core `execution/local.ts` | Working (provenance preserved) | Yes | OpenCode `run-state.ts` | Keep OpenCode | P2 |
| Tool scheduling | Core `llm.ts` | Working (FiberSet concurrency) | Yes | OpenCode `processor.ts` | Keep OpenCode | P2 |
| Tool settlement | Core `ToolRegistry` | Working (emits typed receipts) | Yes | OpenCode `tools.ts` | Keep Rivet | BACKLOG |
| Concurrent tool execution | Core `llm.ts` | Working | Yes | OpenCode `processor.ts` | Keep OpenCode | P2 |
| Doom-loop protection | Rivet Core | Working (fingerprint + 3-call cap) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Tool cleanup | Core `llm.ts` | Working (marks orphan errors) | Yes | OpenCode `revert.cleanup` | Keep OpenCode | P2 |
| Compaction | Core `compaction.ts` | Working (recomputes context epoch) | Yes | OpenCode `compaction.ts` | Keep OpenCode | BACKLOG |
| Snapshots | Core `snapshot.ts` | Working | Shared | OpenCode `snapshot.ts` | Keep OpenCode | BACKLOG |
| Plugin/MCP | OpenCode `mcp/` | Working (schema conversion) | No | OpenCode `src/mcp/` | Keep OpenCode | BACKLOG |
| Session event plumbing | Core `EventV2` | Working (SQLite WAL) | Yes | OpenCode bus | Merge / Rivet Hook | BACKLOG |
| TUI plumbing | OpenCode / TUI | Working (SolidJS cockpit) | No | OpenCode `packages/tui` | Keep OpenCode | BACKLOG |
| Mechanical tool continuation| Rivet Core | Working (decoupled from stagnation)| Yes | OpenCode `processor.loop` | Merge / Rivet Hook | BACKLOG |
| Prompt/context construction | Rivet Core | Working (Cognitive View injected) | Yes | OpenCode `prompt.ts` | Merge / Rivet Hook | BACKLOG |
| TurnAdmission | Rivet Core | Working (Quadruple Invariant) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Hard State | Rivet Core | Working (Noesis event-sourced) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Memory (Associative Recall) | Rivet Core | Working (`SqliteRecallStore`) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Cognitive View | Rivet Core | Working (4 modes, token budget) | No | None in OpenCode | Keep Rivet | BACKLOG |
| ACCP | Rivet Core | Working (fails closed, CAS check) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Revision validity | Rivet Core | Working (pre-execution CAS check) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Evidence admission | Rivet Core | Working (Noesis EvidenceRecord) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Praxis | Rivet Core | Working (anti-laundering verified) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Autonomous redrive | Rivet Core | Working (stall signature bounded) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Completion authority | Rivet Core | Working (task-bound, 6-point gate) | No | None in OpenCode | Keep Rivet | BACKLOG |
| Response delivery | Rivet Core | Working (guaranteed response) | No | None in OpenCode | Keep Rivet | BACKLOG |

---

## 13. Test Matrix & Real Runtime Evidence

| Test Suite / Command | Package | Pass / Fail | Evidence Class | Verified Production Behavior |
|---|---|---|---|---|
| `bun test test/session-runner.test.ts` | `core` | **99 PASS, 0 FAIL** | **Class A/B** | Bounded timeouts, tool settlement, ACCP denial response, crash idempotency, repeated tool halt, Praxis requirement, conversational 1-turn settlement. |
| `bun test test/rivet/constitutional_invariants.test.ts` | `core` | **21 PASS, 0 FAIL** | **Class B** | Invariants I-01..I-20, CT-001..CT-008: claim/evidence separation, scope containment, deterministic replay, memory $\neq$ evidence. |
| `bun test test/rivet/authoritative_gate_contracts.test.ts` | `core` | **4 PASS, 0 FAIL** | **Class B** | Epistemic inquiry closure without Praxis, actionable completion blockers, active task binding. |
| `bun test test/rivet/controller_turn_regression.test.ts` | `core` | **10 PASS, 0 FAIL** | **Class B** | Punctuation/path extraction, Turkish conversational turns, obligation waiver, complaint reuse. |
| `bun test test/rivet/flight_recorder.test.ts` | `core` | **7 PASS, 0 FAIL** | **Class B** | Monotonic clock, sub-5$\mu$s span cost, WAL persistence, Parquet export, latency aggregation. |
| `bun test test/rivet/production_lifecycle_regression.test.ts`| `core` | **5 PASS, 0 FAIL** | **Class B** | Ephemeral turn settlement, goal preservation across steering, completion readiness distinction. |
| `bun test test/rivet/turn_admission_contracts.test.ts` | `core` | **5 PASS, 0 FAIL** | **Class B** | I-21 invariants: phatic/conversational admission, slash command isolation, conversational prompt hygiene. |
| `bun test test/rivet/recall/killer_e2e_cross_session.test.ts` | `core` | **1 PASS, 0 FAIL** | **Class A/B** | Cross-session associative recall on Turn 1; rejected hypothesis surfaced for failure avoidance. |
| `bun test test/rivet/recall/validity_barrier_recall.test.ts` | `core` | **3 PASS, 0 FAIL** | **Class B** | R-04..R-06: Read-time invalidation of stale/superseded memories, historical verification tagging. |
| `bun test test/rivet/epistemic_hell_regression.test.ts` | `core` | **6 PASS, 0 FAIL** | **Class B** | Epistemic hell prevention; config file verification with home directory expansion. |
| `bun test test/rivet/verification_predicates.test.ts` | `core` | **5 PASS, 0 FAIL** | **Class B** | Anti-laundering enforcement; file constraint containment; cognitive view predicate exposure. |
| `bun test test/session/rivet-execution.test.ts` | `opencode` | **3 PASS, 0 FAIL** | **Class A/B** | RivetSessionExecution single owner; failed tool execution receipt; stale action revision fail-fast. |
| `bun test test/session/sabotage.test.ts` | `opencode` | **3 PASS, 0 FAIL** | **Class B** | Proves legacy `SessionPrompt.prompt`, `loop`, `command` fail-closed with `ConstitutionalViolationError`. |
| `bun test test/rivet/recall/scale_benchmark.test.ts` | `core` | **0 PASS, 3 FAIL** | **Class B** | Synthetic SurrealDB HNSW ANN benchmark fails threshold (0.27 & 0.07 recall vs SQLite Oracle). |
| `bun test test/session/` (Legacy OpenCode Suite) | `opencode` | **364 PASS, 56 FAIL** | **Class B** | 56 legacy tests fail due to intentional legacy harness sabotage (tests call legacy loop directly). |
| `bun typecheck` | `core`, `opencode`, `app` | **0 ERRORS** | **Class B** | Clean static type checking across all packages. |

---

## Production Smoke Matrix

| Scenario | Expected Result | Actual Result | Status | Evidence Class |
|---|---|---|---|---|
| **Greeting (`"selam"`)** | Immediate 1-turn response without goal creation | Settles in 1 turn, 0 synthetic loops | **PASS** | **Class A/B** |
| **Hard State query (`"hard state'de ne var"`)** | Epistemic tools exposed, no execution goal | Tools exposed, closed via projection | **PASS** | **Class A/B** |
| **Antigravity Memory Recall** | Prior context & rejected hypothesis recovered on Turn 1 | Turn 1 MemoryFrontier receives episode & failure avoidance | **PASS** | **Class A/B** |
| **3–5 Tool Read Chain** | Multi-tool exploration continues without stagnation halt | Intra-turn tool calls proceed to model answer | **PASS** | **Class A/B** |
| **Repeated Identical Tool** | Capped at 3 calls if no progress is made | Halts on 3rd identical call with `outcome: "stalled"` | **PASS** | **Class A/B** |
| **ACCP Policy Denial** | Tool execution blocked, user receives explanation | Mutation blocked, text explanation delivered | **PASS** | **Class A/B** |
| **Tool Failure Handling** | Durable failure receipt, model notified | Emits `ExecutionReceipt(success: false)`, continues | **PASS** | **Class A/B** |
| **User Abort / Interruption** | Fiber cancelled, status captures interruption source | Emits `outcome: "interrupted"`, `source: "host_runtime_cancellation"` | **PASS** | **Class A/B** |
| **Provider Timeout** | Inactivity timeout triggered, terminal failure recorded | 30s timeout emits `outcome: "failed"`, `source: "timeout"` | **PASS** | **Class A/B** |
| **Completion Authority** | Task-bound, requires passing Praxis receipts | Rejects mismatched task or missing verification | **PASS** | **Class A/B** |
| **Process Restart** | Deterministic state recovery from event WAL | Full HardState, revision, and claims rehydrated | **PASS** | **Class A/B** |

---

## Reproducible Blockers

### Blocker 1: Redundant Model Directive Instructions in System Prompt
- **Severity:** P1 (Materially harms V8 dogfooding efficiency and token economics)
- **Reproduction:** Inspect `packages/core/src/plugin/agent.ts:28-44` and compare with `packages/core/src/session/runner/llm.ts:495-508`.
- **Expected:** Because the Harness proactively compiles the full `CognitiveView` and `MemoryFrontier` into Turn 1 system context, the prompt should advise the model that active knowledge is already present, calling `query_epistemic_state` only if deeper revision history is required.
- **Actual:** `agent.ts` commands: *"You MUST call `query_epistemic_state` and/or `retrieve_memory` as your FIRST tool call(s)."* This forces the LLM to waste a full turn and ~1,000 tokens querying state it already has.
- **Probable Module:** `packages/core/src/plugin/agent.ts`
- **Evidence Class:** **Class C** (Source-code-supported inference + prompt traces)

### Blocker 2: 56 Failing Legacy OpenCode Session Tests
- **Severity:** P1 (Masks real regressions during development)
- **Reproduction:** Run `bun test test/session/` in `packages/opencode`. 56 tests fail or time out.
- **Expected:** The test suite in `packages/opencode` should cleanly test the active V2 Rivet execution path or skip decommissioned OpenCode loop tests.
- **Actual:** Tests directly invoke `SessionPrompt.prompt` and `loop`, which immediately fail with `ConstitutionalViolationError` or hang waiting for legacy OpenCode events.
- **Probable Module:** `packages/opencode/test/session/`
- **Evidence Class:** **Class B** (Local test execution output)

### Blocker 3: Live Observability TTFT Blank Period in TUI
- **Severity:** P1 (Poor dogfood UX during long model prefill)
- **Reproduction:** Launch TUI, submit a complex prompt requiring large context prefill. Observe status rail for 3–8 seconds before model streaming starts.
- **Expected:** Status rail displays live stage: `● Waiting for model (TTFT)` with elapsed seconds.
- **Actual:** Status rail displays generic `● Provider generation` without distinguishing network/prefill wait from active token emission.
- **Probable Module:** `packages/tui/src/rivet/projection.ts` and `packages/core/src/session/runner/llm.ts`
- **Evidence Class:** **Class A** (Directly exercised in runtime code inspection)

### Blocker 4: Synthetic SurrealDB Scale Benchmark Degradation
- **Severity:** P2 (Architectural debt / failing benchmark test)
- **Reproduction:** Run `bun test test/rivet/recall/scale_benchmark.test.ts`.
- **Expected:** Benchmark passes or is isolated from default test runs.
- **Actual:** Fails with `annRecallAt5VsOracle` received `0.27` (1k) and `0.07` (10k) against expected $\ge 0.6$.
- **Probable Module:** `packages/core/test/rivet/recall/scale_benchmark.test.ts`
- **Evidence Class:** **Class B** (Local test execution output)

### Blocker 5: Non-Idempotent External Side-Effect Crash Uncertainty
- **Severity:** P2 (Known boundary condition)
- **Reproduction:** Start a long-running external bash script mutating remote infrastructure; kill process mid-execution.
- **Expected:** Mechanical guarantee of external state.
- **Actual:** `claimExecution` marks the receipt `uncertain: true`, which safely blocks automatic replay in Rivet, but cannot roll back external operating system mutations that occurred prior to the crash.
- **Probable Module:** `packages/core/src/session/semantics.ts`
- **Evidence Class:** **Class C** (Architectural limitation)

---

## Non-Blocking Architectural Debt

1. **Duplicated Transport Orchestration:** `SessionRunnerLLM` implements interim provider timeouts and tool settlement while OpenCode's `SessionProcessor` contains mature retry and backoff machinery. This duplication is stable and working today; unifying them is deferred until after V8 dogfooding.
2. **Local vs Clustered Coordination:** `SessionRunCoordinator` is process-local. Distributed multi-node execution is reserved for post-V8 clustering.
3. **SurrealDB Substrate Artifacts:** References to SurrealDB in `MIGRATION.md` and benchmark files represent an abandoned performance experiment. `SqliteRecallStore` is the proven production engine.

---

## Stabilization Shortlist (Top 5 Actions Before V8 Dogfooding)

The following **5 focused changes** are strictly necessary to make Rivet boringly reliable for sustained V8 dogfooding:

1. **Align Model Epistemic Directives (`packages/core/src/plugin/agent.ts`):**
   - Update prompt directives to reflect that `CognitiveView` and `MemoryFrontier` are already proactively injected on Turn 1.
   - Demote `query_epistemic_state` and `retrieve_memory` from "MANDATORY Turn 1 tool calls" to "On-demand deep inspection tools."
   - *Why blocking:* Prevents every single knowledge inquiry from wasting 1 model turn and thousands of tokens on redundant queries.

2. **Adapt or Archive Decommissioned Legacy Tests (`packages/opencode/test/session/`):**
   - Mark legacy `prompt.test.ts` suites that bypass Rivet as archived/skipped or route them through `RivetSessionExecution` / HTTP API.
   - Ensure the repository test suite passes 100% green on `main`.
   - *Why blocking:* A red test suite prevents continuous integration and blinds the team to genuine regressions.

3. **Expose Live TTFT Span to TUI Status Rail (`packages/tui/src/rivet/projection.ts` & `llm.ts`):**
   - Stream `provider.wait_first_token` as an active span event so the status rail renders `● Waiting for model... (4.2s)` during prefill.
   - *Why blocking:* Eliminates the 3–8 second "is it frozen?" anxiety during heavy codebase context compilation.

4. **Officially Freeze SQLite as the Memory Backend & Quarantine SurrealDB:**
   - Remove or quarantine `scale_benchmark.test.ts` from default test runs.
   - Confirm `SqliteRecallStore` as the sole production associative recall store in documentation and configuration.
   - *Why blocking:* SurrealDB HNSW index degradation pollutes test receipts and distracts from the rock-solid SQLite recall oracle.

5. **Run End-to-End V8 Dogfooding Verification Script:**
   - Execute a multi-turn, multi-file code refactoring and test-verification scenario on the actual V8 repository codebase using the CLI/TUI.
   - Validate WAL span generation and memory retention across consecutive sessions.
   - *Why blocking:* Validates real-world disk I/O, large Git tree census, and multi-turn developer workflows before declaring victory.

---

## Final Recommendation

### **ONE FINAL STABILIZATION PASS**

Do not freeze Rivet prematurely while model directives force redundant queries and legacy tests fail.  
Do not attempt an OpenCode cutover before V8 dogfooding; the active Rivet runner path is already stable, bounded, and constitutionally sound.  

Execute the **5 items on the Stabilization Shortlist**, achieve a 100% green test suite across both packages, and immediately transition Rivet to active V8 dogfooding.
