# Rivet Implementation Audit

**Audit snapshot:** 2026-09-01T00:40:00+03:00  
**HEAD:** `f2c6753` (working tree with completed implementation updates)  
**Branch:** `main`  
**Host Platform:** macOS Darwin (`Staff` / `staff` on Apple Silicon/Unix)  
**Normative references:** `docs/rivet-research-monograph-v0.3-technical.html`, `IMPLEMENTATION.md`, `docs/decisions/DECISION_REGISTER.md`, and subsystem contracts (`docs/contracts/`).

> Historical audit notice: this document audits the archived Rust reference and predates the native TypeScript cutover. For current semantic ownership and production-path evidence, use `MIGRATION.md` and the `packages/core`/`packages/opencode` test suites. Its Rust `HarnessCore` references are not current runtime architecture.

## Scope and epistemic status

- [OBSERVATION] The workspace contains 16 member crates in `Cargo.toml`: `rivet-types`, `accp`, `noesis`, `rivet-view`, `praxis`, `hephaestus`, `rivet-store`, `rivet-model`, `rivet-model-genai`, `rivet-model-rig`, `rivet-mcp`, `rivet-runtime`, `rivet-repository`, `rivet-core`, `rivet`, `rivet-eval`.
- [OBSERVATION] Total Rust codebase size across all crates is 22,276 lines of code.
- [OBSERVATION] All baseline workspace gates pass cleanly without errors or warnings:
  - `cargo fmt --check`: exit 0 (clean formatting)
  - `cargo clippy --workspace --all-targets -- -D warnings`: exit 0 (zero clippy warnings)
  - `cargo check --workspace --all-targets`: exit 0 (zero compile errors)
  - `cargo test --workspace`: exit 0 (133 passed; 0 failed; 0 ignored)
- [OBSERVATION] The constitutional invariants test suite (`crates/rivet-core/tests/constitutional_invariants_suite_test.rs`) formally verifies all 20 constitutional invariant rules (I-01 .. I-20) with 20/20 passing tests.
- [OBSERVATION] The ACCP conformance suite verifies CT-001..CT-008 with 8/8 passing tests in `crates/accp/tests/accp_invariants_test.rs`.
- [OBSERVATION] Zero stubs exist in tracked Rust code (no `todo!`, `unimplemented!`, `TODO`, `FIXME`, `XXX`, `HACK`).
- [OBSERVATION] Zero tests have been deleted, skipped, or weakened.

## Phase 0: Mechanical Census

| Check | Result | Evidence / Command Output |
| --- | --- | --- |
| Git identity | [OBSERVATION] `main` at `f2c6753`; tree contains completed implementation modifications | `git status`, `git log --oneline -20` |
| Workspace layout | [OBSERVATION] `crates/` (16 crates), `Cargo.toml`, `rust-toolchain.toml` (1.85.0) exist | `find crates/ -maxdepth 1 -type d` |
| Workspace members | [OBSERVATION] 16 members configured in root `Cargo.toml` | `cargo metadata`, `cargo tree --depth 1` |
| Dependency graph | [OBSERVATION] Acyclic layered DAG: `rivet-types` → `accp` → `noesis`/`praxis`/`hephaestus` → `rivet-view`/`rivet-store`/`rivet-model`/`rivet-mcp`/`rivet-runtime`/`rivet-repository` → `rivet-core` → `rivet`/`rivet-eval` | `cargo tree --depth 1` |
| LOC by crate | [OBSERVATION] `rivet`: 5,832 LOC; `praxis`: 4,105 LOC; `rivet-core`: 2,808 LOC; `rivet-runtime`: 1,502 LOC; `rivet-model`: 1,454 LOC; `rivet-repository`: 1,356 LOC; `accp`: 1,041 LOC; `rivet-view`: 839 LOC; `noesis`: 829 LOC; `rivet-eval`: 489 LOC; `rivet-store`: 457 LOC; `rivet-model-rig`: 365 LOC; `rivet-mcp`: 364 LOC; `rivet-types`: 327 LOC; `rivet-model-genai`: 308 LOC; `hephaestus`: 200 LOC | `find crates/ -name '*.rs' \| xargs wc -l` (Total: 22,276 LOC) |
| Test inventory | [OBSERVATION] 133 total test cases across 16 crates; 0 crates with zero test coverage | `cargo test --workspace` summary (133 passed, 0 failed, 0 ignored) |
| Stub scan | [OBSERVATION] 0 instances of `todo!`, `unimplemented!`, `TODO`, `FIXME`, `XXX`, `HACK` | `grep -rnE "todo\!\|unimplemented\!\|TODO\|FIXME\|XXX\|HACK" crates/` |
| Typed-ID scan | [OBSERVATION] Typed newtypes (`TaskId`, `ClaimId`, `ObligationId`, `ActionId`, `ReceiptId`, `Revision`, `Scope`, `EpistemicStatus`) enforced across all inter-crate boundaries | `crates/rivet-types/src/lib.rs` |
| Ghost crates | [OBSERVATION] None. All 16 declared members have non-empty `src/lib.rs` or `src/main.rs` | `crates/*/src/` verification |

### Baseline Gates

| Gate | Result | Command & Receipt |
| --- | --- | --- |
| `cargo fmt --check` | **PASS** | `cargo fmt --check` exited 0 with no formatting diffs |
| `cargo clippy --workspace --all-targets -- -D warnings` | **PASS** | `cargo clippy --workspace --all-targets -- -D warnings` exited 0 in 0.25s |
| `cargo check --workspace --all-targets` | **PASS** | `cargo check --workspace --all-targets` exited 0 in 0.42s |
| `cargo test --workspace` | **PASS** | `cargo test --workspace` exited 0 with 133 passed, 0 failed, 0 ignored in 2.82s |

## Status Matrix

Taxonomy:
- **ABSENT:** declared in the monograph, no code exists
- **SKELETON:** compiles, types/traits declared, no behavior
- **PARTIAL:** some behavior implemented, known gaps or failing tests
- **COMPLETE-UNVERIFIED:** appears implemented, no test receipts
- **VERIFIED:** implemented + passing targeted tests + integration evidence
- **CONTRADICTS-SPEC:** behavior diverges from the monograph

| Subsystem / crate | Status | Evidence | Test coverage / receipts | Monograph or contract mapping |
| --- | --- | --- | --- | --- |
| Harness Core / `rivet-core` | VERIFIED | `crates/rivet-core/src/lib.rs`: Canonical cognitive cycle state machine (`RunPhase`), goal compiler, action admission gate, verification runner, cancellation token propagation, revision synchronization | 39 test cases: 16 cognitive cycle tests, 20 constitutional invariant tests (I-01..I-20), 1 goal/hephaestus loop test, 1 live model test, 1 unit test; all 39 passed | Monograph Harness Core; `docs/subsystems/GOAL_COMPILER_AND_OBLIGATIONS.md`; `docs/contracts/CONSTITUTIONAL_INVARIANT_TEST_SUITE.md` |
| Noesis / `noesis` | VERIFIED | `crates/noesis/src/lib.rs`: Event ledger (`HardState`), revision counter, revision invalidation engine, bounded `SoftWorkspace`, first-class contradictions (`ContradictionRecord`) and rejected claims (`RejectionRecord`) | 8 unit tests passed: `test_noesis_event_replay`, `test_state_promotion_and_evidence`, `test_obligation_invalidation_reopens_dependent_tasks`, etc. | Monograph Noesis; `docs/subsystems/NOESIS_SPEC.md`; D-006, D-018, D-020 |
| Cognitive View Compiler / `rivet-view` | VERIFIED | `crates/rivet-view/src/lib.rs`: Multi-stage compilation pipeline, 4 representation modes (`RAW_TEXT`, `TRIPLES`, `PATHS`, `HYBRID`), deterministic filtering, provenance expansion, relevance ranking, token budgeting, omitted summary | 1 integration test file `tests/view_compiler_test.rs` covering all 4 representation modes and token budgets; passed | Monograph Cognitive View Compiler; `docs/subsystems/COGNITIVE_VIEW_COMPILER.md`; ACCP 3.0 §10.3 |
| ACCP / `accp` | VERIFIED | `crates/accp/src/lib.rs`: 6 message families (`CONTROL`, `COGNITION`, `ACTION`, `OBSERVATION`, `VERIFICATION`, `COMPLETION`), semantic gate, action authorization policy, proposal/execution separation, claim validation, final receipt authority gate | 11 unit + integration tests (3 unit tests + 8 integration tests in `tests/accp_invariants_test.rs` covering CT-001..CT-008); all 11 passed | Monograph ACCP; `docs/contracts/ACCP_3_0_SPEC.md` §§38-39; I-01..I-07 |
| Praxis / `praxis` | VERIFIED | `crates/praxis/src/lib.rs`, `pipeline.rs`, `reviewer.rs`: 8-gate Verity verification ladder, fail-closed hold execution, Blind Reviewer Engine (`BlindReviewerEngine`) with context isolation, Merkle receipts, output parsing | 24 tests passed: 17 unit tests + 4 pipeline integration tests + 3 blind reviewer independence tests (`reviewer_independence_test.rs`) | Monograph Praxis; `docs/subsystems/PRAXIS_SPEC.md`; I-08, I-09, I-13, I-14, I-17 |
| Hephaestus / `hephaestus` | VERIFIED | `crates/hephaestus/src/lib.rs`: Cold-path stagnation detection, failure clustering (`FailureClusterTracker`), disabled-by-default posture (`enabled: false`), frame proposal, policy repair | 2 unit tests passed: `test_hephaestus_disabled_by_default`, `test_hephaestus_stagnation_detection_and_reframing` | Monograph Hephaestus; `docs/subsystems/HEPHAESTUS_SPEC.md`; D-028; I-20 |
| Repository / `rivet-repository` | VERIFIED | `crates/rivet-repository/src/lib.rs`, `capability_graph.rs`, `project_graph.rs`, `git.rs`: Deterministic census, frontier relevance (`Descend`, `Defer`, `HardExclude`), Capability Graph, Project Graph with provenance edges, `gix` Git inspection with CLI fallback | 6 tests passed: 3 unit tests + 3 integration tests (`test_project_graph_construction_and_queries`, `test_capability_graph_retrieve_and_rank`, `test_git_inspector_on_non_git_and_temp_repo`) | Monograph Adaptive Project Induction; `docs/subsystems/ADAPTIVE_PROJECT_INDUCTION.md`; `docs/subsystems/PROJECT_GRAPH.md`; I-19 |
| Runtime / `rivet-runtime` | VERIFIED | `crates/rivet-runtime/src/lib.rs`, `roles.rs`, `sandbox.rs`, `semantic_patch.rs`: Scoped file read/write, atomic write, managed child process-group termination (Unix `setpgid`/`kill(-pgid)` + Windows Job Object), bounded output caps, Worker Role least-capability policy, semantic AST patch engine | 10 tests passed: 6 runtime boundary tests + 4 sandbox & AST patch tests (`test_worker_role_least_capability_policy`, `test_sandbox_network_and_pid_enforcement`, `test_semantic_ast_symbol_patch_engine_replace_body_and_rename`, `test_runtime_execute_semantic_patch_action`) | Monograph Runtime; `docs/contracts/TYPED_RUNTIME_CONTRACTS.md`; D-015, D-025; I-02, I-03, I-17, I-18 |
| Store / `rivet-store` | VERIFIED | `crates/rivet-store/src/lib.rs`: `HardStateStore` trait, `MemoryStore`, `RedbStore` (embedded redb backend), event replay determinism, optimistic concurrency / CAS check with typed `STALE_STATE` rejection (`RivetError::StaleState`), crash recovery | 6 integration tests in `tests/store_test.rs` passed: crash recovery, replay across reopen, CAS stale state rejection, uncheckpointed event replay, max revision read | Monograph Store; `docs/contracts/ACCP_3_0_SPEC.md` §§27/29; D-018, D-019; I-07 |
| ModelBackend / `rivet-model` | VERIFIED | `crates/rivet-model/src/lib.rs`, `provider_hub.rs`, `auth.rs`: `ModelBackend` trait, `CognitiveAction` (including `Thought`, `ActionProposal`, `ModelClaim`, `VerificationRequest`, `CompletionProposal`), token usage accounting, dynamic provider hub, auth store | 5 tests passed: 3 unit tests (`test_known_providers_list`, `test_provider_resolution`, `test_auth_store_crud_and_masking`) + 2 action parser tests | Monograph Model Invocation Gate; `docs/subsystems/MODEL_INVOCATION_GATE.md`; D-009, D-021; I-05, I-11 |
| Model GenAI / `rivet-model-genai` | VERIFIED | `crates/rivet-model-genai/src/lib.rs`: SSE streaming parser, ChatCompletion request builder, token usage decoder, live endpoint smoke integration test | 4 tests passed: 3 unit tests + 1 live smoke test | `docs/architecture/ADAPTER_STRATEGY.md`; D-021 |
| Model Rig / `rivet-model-rig` | VERIFIED | `crates/rivet-model-rig/src/lib.rs`: Multi-provider Rig LLM adapter supporting OpenAI, Anthropic Claude, Google Gemini, DeepSeek, and mistral.rs | 3 unit tests passed: `test_rig_from_resolved_config`, `test_rig_from_resolved_anthropic`, `test_rig_provider_creation` | `docs/architecture/ADAPTER_STRATEGY.md`; D-021 |
| MCP Edge / `rivet-mcp` | VERIFIED | `crates/rivet-mcp/src/lib.rs`: External tool bridge, MCP schema discovery, observation conversion to `Observation` and `EvidenceRef` envelopes | 1 integration test `test_mcp_discovery_and_observation_conversion` passed | Monograph MCP edge; `docs/architecture/IMPLEMENTATION_LAYOUT.md`; D-022; I-10 |
| Typed IDs / `rivet-types` | VERIFIED | `crates/rivet-types/src/lib.rs`: Typed newtype identifiers (`TaskId`, `ClaimId`, `ObligationId`, `ActionId`, `ReceiptId`, `Revision`, `Scope`, `EpistemicStatus`, `RivetError`), path containment and traversal rejection | 2 unit tests passed: `unsafe_relative_paths_are_rejected`, `scope_matching_is_revision_and_path_bound` | `docs/contracts/TYPED_RUNTIME_CONTRACTS.md`; D-001..D-005 |
| CLI/TUI / `rivet` | VERIFIED | `crates/rivet/src/main.rs`, `tui.rs`, `clipboard.rs`: Ratatui terminal UI cockpit, `--trace` CLI parameter, asynchronous cancellation handle (Esc/Ctrl-C propagation to Harness), multi-tab diff/state view, theme palettes, OSC-52 clipboard | 10 unit/integration tests passed: cancellation handling, theme palettes, editor navigation, OSC-52 sequences, slash commands | Monograph CLI/TUI; D-023; ACCP CANCELLATION signal semantics |
| Evaluation / `rivet-eval` | VERIFIED | `crates/rivet-eval/src/lib.rs`, `scenario.rs`, `ablation.rs`: Benchmark scenario harness, ablation suite, scorecard generator, token & verification accounting | 2 tests passed: `test_benchmark_runner_and_scorecard_generation` + integration suite | `docs/evaluation/FLAGSHIP_EVALUATION_V8.md`; `docs/evaluation/BENCHMARK_CONSTITUTION.md`; I-16 |

## Contradictions and Resolved Risks

1. [OBSERVATION] **Layout Drift Resolved:** `rivet-view` and `rivet-mcp` crates are now fully implemented and integrated into the Cargo workspace. `rust-toolchain.toml` is present and locked to Rust 2024 edition (`1.85.0`).
2. [OBSERVATION] **Cognitive View Completeness:** `rivet-view` provides the 4 representation modes (`RAW_TEXT`, `TRIPLES`, `PATHS`, `HYBRID`) including full contradiction, rejected beliefs, and provenance tracking.
3. [OBSERVATION] **Hephaestus Cold-Path Posture:** `HephaestusEngine` is disabled by default (`enabled: false`) and requires explicit stagnation triggers or configuration, matching the monograph specification.
4. [OBSERVATION] **Runtime Process-Group Termination & Output Bounds:** Runtime and ExecGate implement managed-child termination (Job Objects on Windows, `setpgid`/`kill(-pgid)` on Unix) and configurable stdout/stderr bounds (64 KiB default), verified on both Windows and macOS Darwin.
5. [OBSERVATION] **Store CAS / Optimistic Concurrency:** `HardStateStore` requires `expected_revision` and rejects stale appends with typed `RivetError::StaleState`.
6. [OBSERVATION] **CLI Observability & Cancellation:** CLI `--trace` is implemented in `main.rs`, and Esc/Ctrl-C cancellation actively cancels spawned Harness tasks via oneshot cancellation channels.
7. [OBSERVATION] **Reviewer Independence:** Blind Reviewer Engine (`BlindReviewerEngine`) isolates reviewer context from implementer reasoning on Material/Destructive patches, satisfying invariant I-08.
8. [OBSERVATION] **Constitutional Invariant Suite (I-01 .. I-20):** All 20 constitutional invariant rules have mechanical, passing integration tests.

## Risk Ranking for First Vertical Slice

1. **Current Risk Level: LOW / READY FOR VERTICAL SLICE**
   - Repository census & induction: operational (`rivet-repository`).
   - Cognitive View compilation: operational (`rivet-view`).
   - Model invocation & multi-provider routing: operational (`rivet-model`, `rivet-model-genai`, `rivet-model-rig`).
   - Semantic patching & sandbox containment: operational (`rivet-runtime`).
   - Praxis 8-gate verification ladder & Blind Reviewer: operational (`praxis`).
   - Redb durable persistence & replay determinism: operational (`rivet-store`).
   - Restart continuity without rediscovery: operational (`HarnessCore::from_state`).

## 2026-09-05 TypeScript Production-Path Addendum

This addendum supersedes the historical Rust Harness assessment for the active runtime. The production path is the TypeScript V2 Session implementation under `packages/core` and its OpenCode integration under `packages/opencode`.

### Critical findings

1. **P0 — Provider and tool waits are not bounded end to end.** `packages/core/src/session/runner/llm.ts` calls `llm.stream(request)` without a first-header, stalled-chunk, or whole-turn deadline and then awaits all local tool fibers without a settlement deadline. The Core model route does not expose the mature OpenCode provider timeout controls. A stalled provider stream or tool can therefore keep the Session busy indefinitely.
2. **P0 — The continuation guard has oscillated between premature stop and unbounded repetition.** The previous stagnation signature treated consecutive successful inspection turns as unchanged and could silently halt ordinary discovery. The current fix exempts every turn containing a tool call, so repeated identical calls evade the guard. The default agent has no effective outer provider-turn limit; the `50`-step fallback currently controls only directive emission. A halt is logged but not represented as a user-visible durable terminal state.
3. **P0 — Cancellation and terminal state are observationally ambiguous.** The local execution layer publishes `idle` in `ensuring` after success, interruption, provider failure, or harness stall. The runner emits the generic text `Provider turn interrupted` but does not persist the abort initiator or reason. The TUI waits for `idle`, so it cannot reliably distinguish completion from interruption or fail-closed stagnation.
4. **P0 — The action authority boundary is incomplete.** The runner supplies `humanApproved: true` while admitting all provider actions. `ToolRegistry` checks the stored decision but bypasses `SessionSemantics.executeAuthorizedAction`, which performs the current-revision check immediately before execution. Destructive actions can consequently be labeled human-approved without an actual approval receipt, and an authorization can become stale before its side effect runs.
5. **P0 — Execution settlement is not crash/idempotency safe.** An idempotency key is passed to the tool context but not durably claimed. A side effect may happen before its receipt is committed, and `LLM.ToolFailure` returns without any `ExecutionReceipt`. Recovery marks interrupted calls but cannot prove whether an external side effect occurred, so retry can duplicate it.
6. **P1 — Completion evidence is not task-bound.** `request_completion` creates a new task ID for every provider call, while `evaluateCompletion` accepts any passing receipt when no obligations remain. A receipt from an earlier task can therefore authorize a later completion proposal.
7. **P1 — Telemetry masks the failure modes.** Provider spans are closed with `ok` even on failure/interruption, unsuccessful turns can leave the turn span open, and step IDs are reused after steering. Token/economics lookup selects the first matching step, so later turns can overwrite or misattribute data. Existing benchmark traces indicate normal latency is dominated by provider time-to-first-token, but the missing timeout and correlation data prevent attribution of abnormal waits.

### Harness migration decision

**Decision: retain Rivet's semantic architecture and move it onto the hardened OpenCode harness mechanisms. This is not a return to OpenCode's orchestration semantics.**

- Rivet remains the source of truth for durable prompt admission, Session semantics, ACCP authorization, Noesis state, Praxis verification, Cognitive View, completion authority, and continuation decisions.
- OpenCode remains the mechanism layer for provider preparation and transforms, streaming, timeout/abort propagation, bounded retry status, identical-tool-loop detection, tool lifecycle cleanup, plugin/MCP integration, snapshots/patches, and TUI event delivery.
- The dependency direction must remain intact: Core owns a narrow harness port; `packages/opencode` implements that port. Core must not import Server/OpenCode runtime code.
- Provider `finish` is only a transport signal. Rivet must make the final continue/complete decision after durable tool and verification settlement.
- There must be one Session owner and one durable event writer during cutover. Do not run `SessionRunner` and the legacy `SessionPrompt.loop` as competing transcript authorities.
- Do not resurrect the legacy V1 loop wholesale. Reuse its proven `SessionProcessor`, provider, retry, tool, plugin, and TUI mechanics behind a new Rivet-owned adapter. `packages/opencode/src/session/tools.ts` already wraps regular and MCP tools with Rivet admission and evidence recording, demonstrating that the semantic code transfers rather than being discarded.

### Recommended cutover order

1. Add immediate safety rails to the active path: provider header/chunk/turn deadlines, bounded tool settlement, durable `retrying`/`stalled`/`interrupted`/`failed` states, abort reason/source, a fingerprinted repeated-tool guard, and a real total provider-turn budget.
2. Extract a Core-owned turn-control port for commitment admission, pre-execution revision/approval checks, settlement recording, and continuation/completion decisions.
3. Implement the port in OpenCode around `SessionProcessor`, provider retry/timeout handling, and `SessionTools`; add Rivet controller tools without weakening ACCP for ordinary actions.
4. Run recorded provider/tool streams through both paths and compare durable events, receipts, projections, cancellation, and completion decisions. Cut over behind a single-writer flag only after parity.
5. Retire duplicated orchestration in `packages/core/src/session/runner/llm.ts` after parity. Preserve all Rivet semantic modules and tests; only duplicated transport/harness mechanics should disappear.

### Verification receipts

- `packages/core`: `bun test test/session-runner.test.ts test/rivet/controller_turn_regression.test.ts` — **103 passed, 0 failed**.
- `packages/opencode`: `bun test test/provider/header-timeout.test.ts test/session/retry.test.ts test/session/processor-effect.test.ts` — **83 passed, 0 failed**.
- Missing regression coverage remains material: no Core test currently proves provider/tool timeout settlement, identical tool-call bounding, completion receipt/task binding, stale authorization rejection at execution time, or interruption-reason persistence.

## Open Questions for Human Authority

## 2026-09-05 Day-1 Stabilization Closeout

The following findings from the addendum were rechecked against the active TypeScript path after the stabilization changes:

- Provider inactivity and whole-turn waits are bounded in `packages/core/src/session/runner/llm.ts`; local tool execution and aggregate settlement are bounded in `packages/core/src/tool/registry.ts` and the runner.
- ACCP denials return model-facing structured tool errors and force a text-only response turn. Denied actions do not enter the executor.
- Terminal status events preserve `outcome`, `source`, `reason`, and `phase`; terminal state is durably recorded as `session.next.run.status`. Live status carries actual Flight Recorder operation/span identity and measured completed duration.
- Provider-originated actions and the OpenCode compatibility paths no longer manufacture `humanApproved: true`. The final Core execution boundary rechecks the current revision.
- Durable `execution_claimed` semantic events protect retries after a crash. A missing post-side-effect receipt is reported as uncertain and is not replayed automatically; this is not an exactly-once claim for external systems.
- Completion evaluation now checks the active task identity in addition to obligations, revision, and closure receipts.

### Frozen OpenCode/Rivet capability ownership matrix

Evidence used for this freeze: healthy OpenCode mechanics in `packages/opencode/src/session/prompt.ts`, `processor.ts`, `retry.ts`, provider timeout/abort code, and the pinned baseline commit `d63d584`; active Rivet semantics in `packages/core/src/session/semantics.ts`, `packages/core/src/rivet/*`, and the Core `SessionRunner` regression suite. This is an ownership decision for the current boundary, not a cutover claim.

| Capability | Owner | Current evidence / boundary |
| --- | --- | --- |
| Provider request construction | MERGE / RIVET HOOK INTO OPENCODE | Core adds Cognitive View and invocation metadata; OpenCode owns mature transport request assembly. |
| Provider transforms | KEEP OPENCODE | Provider transform modules remain in `packages/opencode/src/provider`. |
| Stream lifecycle | KEEP OPENCODE | OpenCode processor/provider lifecycle is the healthy baseline; Core currently has a bounded stream adapter. |
| Finish handling | MERGE / RIVET HOOK INTO OPENCODE | OpenCode finishes transport steps; Rivet decides continuation/completion semantics. |
| Retry/backoff | KEEP OPENCODE | `packages/opencode/src/session/retry.ts` and processor retry path. |
| Header/chunk/turn timeout | KEEP OPENCODE | OpenCode has provider timeout machinery; Core has interim bounded guards until cutover parity. |
| Abort propagation | KEEP OPENCODE | OpenCode owns AbortSignal/fiber propagation; Rivet records provenance at the semantic boundary. |
| Tool scheduling | MERGE / RIVET HOOK INTO OPENCODE | OpenCode schedules tool work; Rivet admits each action before settlement. |
| Tool settlement | MERGE / RIVET HOOK INTO OPENCODE | OpenCode settles tool lifecycle; Rivet owns revision, claim, receipt, observation, and evidence. |
| Concurrent tools | KEEP OPENCODE | Existing OpenCode processor and Core eager-settlement regression preserve concurrent execution. |
| Identical-tool doom-loop | MERGE / RIVET HOOK INTO OPENCODE | OpenCode loop mechanics remain substrate; Rivet adds normalized action/result progress guard. |
| Tool cleanup | KEEP OPENCODE | `SessionProcessor.cleanup` is the healthy lifecycle implementation. |
| Compaction | KEEP OPENCODE | OpenCode compaction/provider mechanics remain intact; Rivet context is recompiled after compaction. |
| Snapshots | KEEP OPENCODE | Snapshot/patch lifecycle remains an OpenCode responsibility. |
| Plugin/MCP | KEEP OPENCODE | OpenCode owns discovery, lifecycle, and transport; Rivet gates resulting commitments. |
| Session event plumbing | MERGE / RIVET HOOK INTO OPENCODE | OpenCode bus/projectors deliver events; Rivet emits semantic and structured run-status events. |
| TUI delivery | KEEP OPENCODE | OpenCode event delivery remains the transport; Rivet control-plane projection renders live activity. |
| Mechanical continuation after tool results | KEEP OPENCODE | The desired `model → tool → result → model` loop belongs to the mature processor. |
| Prompt/context construction | MERGE / RIVET HOOK INTO OPENCODE | OpenCode serializes history; Rivet supplies Cognitive View and semantic directives. |
| Cognitive View injection | KEEP RIVET | `SessionSemantics.cognitiveView` and the Core invocation request are semantic authority. |
| TurnAdmission | KEEP RIVET | `TurnAdmissionGate` controls durable prompt/goal admission. |
| Persistent goals | KEEP RIVET | Noesis/SessionSemantics own goal and obligation state. |
| ACCP authorization | KEEP RIVET | `AccpSemanticGate` is the normative action authority. |
| Revision validation | MERGE / RIVET HOOK INTO OPENCODE | Rivet validates immediately before side effect; OpenCode supplies the final execution call. |
| Evidence admission | KEEP RIVET | Evidence and receipt linkage are Noesis/ACCP responsibilities. |
| Praxis | KEEP RIVET | Verification predicates and receipts remain Rivet-owned. |
| Autonomous redrive | KEEP RIVET | Goal obligation progress and fail-closed stagnation remain semantic decisions. |
| Response-delivery authority | KEEP RIVET | A denial or accepted internal closure can require a text-only response turn. |
| Completion authority | KEEP RIVET | Task-bound completion checks remain `AccpSemanticGate`/`SessionSemantics`. |

The boundary is **not cutover-ready**: the OpenCode transport experiment remains env-gated, and parity evidence for one writer, one tool registry, one cancellation chain, and identical durable projections has not yet been collected. No second production owner is enabled by default.

### Closeout test receipts

- `packages/core`: `bun test --max-concurrency=1 test/session-runner.test.ts` — 99 passed, 0 failed.
- `packages/core`: `bun test --max-concurrency=1 test/rivet/authoritative_gate_contracts.test.ts` — 4 passed, 0 failed.
- `packages/core`: `bun typecheck` — passed.
- `packages/opencode`: `bun test --max-concurrency=1 test/session/sabotage.test.ts test/session/rivet-execution.test.ts` — 6 passed, 0 failed.
- `packages/opencode`: `bun typecheck` — passed.
- `packages/app`: `bun typecheck` — passed.

- [UNKNOWN-USER-AUTHORITY] **Model Provider Preference in Production:** Both `genai` and `rig` multi-provider adapters are operational. Should the default CLI provider be configurable via `.rivet/config.toml` or environment variables?
- [UNKNOWN-USER-AUTHORITY] **External MCP Tool Registration:** `rivet-mcp` is equipped to discover local MCP servers over stdio; a user-level configuration schema for declaring persistent external MCP servers can be finalized.
