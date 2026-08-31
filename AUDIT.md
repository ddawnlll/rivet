# Rivet Implementation Audit

**Audit snapshot:** 2026-08-31T20:24:21.6949663+03:00  
**HEAD:** `d20ccd054d0bdf5b58cfc387bf0daf6fe3656020`  
**Branch:** `main`  
**Normative references:** `docs/rivet-research-monograph-v0.3-technical.html`, `IMPLEMENTATION.md`, `docs/decisions/DECISION_REGISTER.md`, and the subsystem/contract documents.

## Scope and epistemic status

- [OBSERVATION] The source tree was dirty at the start and changed during the audit. The current snapshot contains 27 tracked modifications plus untracked `.rivet-auth.json`; raw status is in [.rivet/audit/snapshot-marker.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/snapshot-marker.txt).
- [OBSERVATION] A separate `cargo run --bin rivet -- --tui` process was active during the snapshot. Its presence and command line are recorded in the snapshot marker.
- [OBSERVATION] No source or test file was edited by this audit. Only audit artifacts were added under the repository root and `.rivet/audit/`.
- [INFERENCE] Receipts gathered while the external edit stream was active are not a stable basis for patching. The baseline failure that occurred during a moving source snapshot is therefore recorded as open/blocked rather than treated as a settled source defect.
- [UNKNOWN] Whether the active edits belong to the user, another agent, or an unfinished formatter/build workflow. I refuse to infer ownership or revert them.

## Phase 0: mechanical census

| Check | Result | Receipt |
| --- | --- | --- |
| Git identity | [OBSERVATION] `main` at `d20ccd0`; dirty tree | [.rivet/audit/phase0/git.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/phase0/git.txt) |
| Planned layout | [OBSERVATION] `crates/` and `Cargo.toml` exist; root `tests/` and `rust-toolchain.toml` are absent | [.rivet/audit/phase0/git.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/phase0/git.txt) |
| Workspace members | [OBSERVATION] 14 members; includes `rivet-eval` and `rivet-model-rig`; planned `rivet-view` and `rivet-mcp` are absent | [.rivet/audit/phase0/workspace-members.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/phase0/workspace-members.txt), [Cargo.toml](/C:/Users/dresden/Documents/rivet/Cargo.toml:1) |
| Dependency graph | [OBSERVATION] Internal edges are acyclic in the captured depth-1 graph; no `rivet-view`/`rivet-mcp` node exists | [.rivet/audit/phase0/internal-dependency-edges.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/phase0/internal-dependency-edges.txt), [.rivet/audit/phase0/cargo-tree-depth1.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/phase0/cargo-tree-depth1.txt) |
| LOC/tests | [OBSERVATION] PowerShell fallback inventory: `rivet-core` 2,138 Rust LOC / 18 test attributes; `praxis` 3,009 / 19; `rivet` 2,654 / 0; `rivet-types` 279 / 2; see full table | [.rivet/audit/phase0/test-inventory.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/phase0/test-inventory.txt) |
| Stub scan | [OBSERVATION] No TODO/FIXME/XXX/HACK/unimplemented markers in tracked source; one test `panic!` is an assertion arm | [.rivet/audit/phase0/stub-scan-rust.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/phase0/stub-scan-rust.txt) |
| Typed-ID scan | [OBSERVATION] Newtype IDs exist, but raw `String` fields remain for repository, model, message, record, and plan-related identities | [.rivet/audit/phase0/typed-id-scan.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/phase0/typed-id-scan.txt) |
| Ghost crates | [OBSERVATION] All declared members have a source directory; absent planned crates are not declared members | [.rivet/audit/phase0/ghost-crates.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/phase0/ghost-crates.txt) |

### Baseline gates

The required order was executed against the working tree. The edit stream changed files between commands, so the receipts are a snapshot, not a reproducible clean baseline.

| Gate | Result | Observed signature |
| --- | --- | --- |
| `cargo fmt --check` | **FAIL** | [OBSERVATION] At capture time, `crates/praxis/src/gates/final_gate.rs` had an unclosed delimiter; formatter diffs also covered the moving tree. | 
| `cargo clippy --workspace --all-targets -- -D warnings` | **FAIL** | [OBSERVATION] `rivet-types/src/lib.rs:155` triggered `clippy::collapsible_if`. | 
| `cargo check --workspace` | **PASS** | [OBSERVATION] Finished successfully, but emitted an `unreachable pattern` warning in `rivet-model-rig/src/lib.rs:292`. | 
| `cargo test --workspace` | **FAIL at capture time** | [OBSERVATION] `accp/src/lib.rs:598` referenced missing `CompletionProposal.proposal_id` / `ProposalId`; the same file changed afterward, so this signature is recorded as a moving-snapshot failure. | 

Full output and exit receipts are in [.rivet/audit/baseline/](/C:/Users/dresden/Documents/rivet/.rivet/audit/baseline/).

## Status matrix

Statuses use the requested taxonomy exactly. `COMPLETE-UNVERIFIED` means implementation appears present but has no green targeted/integration receipt in this audit. `CONTRADICTS-SPEC` is reserved for an observed structural or behavioral mismatch with a locked/normative requirement.

| Subsystem / crate | Status | Evidence | Test coverage / receipts | Monograph or contract mapping |
| --- | --- | --- | --- | --- |
| Harness Core / `rivet-core` | PARTIAL | [OBSERVATION] `RunPhase` exists at `crates/rivet-core/src/lib.rs:27`; `HarnessCore::open`, `step`, goal compilation, action admission, verification, and persistence paths exist. [OBSERVATION] `Cancelled` is an enum value, but no cancellation token or cancellation propagation exists. [INFERENCE] Model-generated verification requests use `view_revision.next()` after the invocation event, while the model only saw `view_revision` (`src/lib.rs:274`, `:396-407`). | 3 integration test files; no stable targeted receipt because workspace test gate failed/moved. | Monograph Harness Core; `docs/subsystems/GOAL_COMPILER_AND_OBLIGATIONS.md`; `docs/contracts/CONSTITUTIONAL_INVARIANT_TEST_SUITE.md` I-01/I-07. |
| Noesis / `noesis` | PARTIAL | [OBSERVATION] Event enum, `HardState`, replay, revision counter, failed-verification reopen/invalidation, bounded `SoftWorkspace`, and view formatting exist (`crates/noesis/src/lib.rs:49`, `:107`, `:246`, `:274`, `:342`). [OBSERVATION] Evidence materialization stores summary but discards the event's `source`; no general rejected/contradiction/provenance collections are materialized. | 7 unit tests; no green receipt in this audit. | Monograph Noesis; `docs/subsystems/NOESIS_SPEC.md`; D-006/D-018/D-020. |
| Cognitive View Compiler / embedded in `noesis`/`rivet-core` | CONTRADICTS-SPEC | [OBSERVATION] `CognitiveView` contains goal, claims, obligations, evidence, unknowns, hypotheses, focus, relevant files, and truncation (`crates/noesis/src/lib.rs:344-452`). [OBSERVATION] There is no `rejected_paths`, contradiction, capability, or explicit provenance section, and no `rivet-view` crate. | 2 Noesis view tests; no targeted receipt. | Monograph Cognitive View Compiler; `docs/subsystems/COGNITIVE_VIEW_COMPILER.md`; ACCP 3.0 §10.3. |
| ACCP / `accp` | PARTIAL | [OBSERVATION] Six message families, direction validation, scope/revision metadata, action policy, proposal/execution separation, claim validation, and completion decision code exist (`crates/accp/src/lib.rs:23`, `:271`, `:440`, `:465`, `:560`). [OBSERVATION] The integration suite contains tests corresponding to CT-001..CT-008, but no exact CT identifiers and no stable green receipt. | 11 unit-test attributes plus 8 integration tests in the inventory; workspace test capture failed during moving edits. | Monograph ACCP; `docs/contracts/ACCP_3_0_SPEC.md` §§38-39; I-01/I-04/I-06/I-07/I-20. |
| Praxis / `praxis` | PARTIAL | [OBSERVATION] Eight-gate pipeline, ledger/Merkle evidence, parsers, coverage, lock, wiring, execution, and final gates exist (`crates/praxis/src/lib.rs:7`, `crates/praxis/src/pipeline.rs:22-111`). [OBSERVATION] `VerityPipeline::run` invokes ExecGate after earlier gate results without a fail-closed short circuit; ExecGate uses `kill_on_drop` and captures unbounded stdout/stderr (`crates/praxis/src/gates/exec_gate.rs:110-137`). | 17 unit-test attributes + 2 async attributes and 1 integration test file; no stable full receipt. | Monograph Praxis verification ladder; `docs/subsystems/PRAXIS_SPEC.md`; I-09/I-13/I-17. |
| Hephaestus / `hephaestus` | CONTRADICTS-SPEC | [OBSERVATION] Thresholded failure tracking and reframing exist (`crates/hephaestus/src/lib.rs:46-140`). [OBSERVATION] `HarnessCore::from_state` unconditionally constructs `HephaestusEngine::new(3)` (`crates/rivet-core/src/lib.rs:125-126`); no disabled-by-default configuration is present. [OBSERVATION] Activation only checks consecutive failures, not the full trigger set. | 1 unit test; no green targeted receipt. | Monograph Hephaestus; `docs/subsystems/HEPHAESTUS_SPEC.md`; D-028; I-20. |
| Repository / `rivet-repository` | PARTIAL | [OBSERVATION] Deterministic census, ignore/symlink handling, deferred directories, directory summaries, active frontier, and goal/focus-conditioned induction exist (`crates/rivet-repository/src/lib.rs:45-250`, `src/induction.rs:38-175`). [OBSERVATION] No stable artifact/symbol identity reader exists; induction is path/filename heuristic based. | 1 unit test + 2 async tests; no stable targeted receipt. | Monograph Adaptive Project Induction / Repository; `docs/subsystems/ADAPTIVE_PROJECT_INDUCTION.md`; `docs/subsystems/PROJECT_GRAPH.md`. |
| Runtime / `rivet-runtime` | CONTRADICTS-SPEC | [OBSERVATION] File read/write, path containment, action idempotency, command timeout, and bounded file-read observation exist (`crates/rivet-runtime/src/lib.rs:45-303`). [OBSERVATION] No Git primitive is present. [OBSERVATION] Process timeout uses child `kill_on_drop`, not process-group termination, and command stdout/stderr has no cap. [OBSERVATION] `execute_action` accepts a proposal directly without an ACCP policy parameter; Harness admission is external to the runtime method. | 4 async runtime tests in inventory; no stable receipt. | Monograph Runtime; `docs/contracts/TYPED_RUNTIME_CONTRACTS.md`; D-015/D-025; I-02/I-03/I-18. |
| Store / `rivet-store` | CONTRADICTS-SPEC | [OBSERVATION] `HardStateStore`, `MemoryStore`, redb event append/read, checkpoint save/load, and crash-recovery tests exist (`crates/rivet-store/src/lib.rs:16-227`). [OBSERVATION] The trait has no expected-revision/CAS parameter and no `STALE_STATE` rejection; optimistic checks are only in selected Harness paths. | 5 async tests in inventory; no stable receipt. | Monograph Store; `docs/contracts/ACCP_3_0_SPEC.md` §§27/29; D-018/D-019; I-07. |
| ModelBackend / `rivet-model` + `rivet-model-genai` | PARTIAL | [OBSERVATION] `ModelBackend`, typed cognitive actions, fake backends in tests, token usage, parser, and GenAI HTTP/SSE adapter exist (`crates/rivet-model/src/lib.rs:20-205`, `crates/rivet-model-genai/src/lib.rs:109-219`). [OBSERVATION] `InvocationReceipt` is defined but the trait returns only `ModelResponse`; Harness records a separate `ModelInvocationRecord`. | `rivet-model` has 5 test attributes; GenAI has 3 unit tests + 1 live test inventory; no stable targeted receipt. | Monograph ModelBackend / invocation accounting; `docs/subsystems/MODEL_INVOCATION_GATE.md`; D-009/D-021; I-05/I-11. |
| Extra Rig adapter / `rivet-model-rig` | COMPLETE-UNVERIFIED | [OBSERVATION] Rig provider adapters and tests exist. [OBSERVATION] CLI selects Rig for every provider except `opencode` (`crates/rivet/src/main.rs:196-201`), which is a structural drift from the first-adapter decision. | 2 unit tests; only `cargo check` receipt, with an unreachable-pattern warning. | D-021; `docs/architecture/ADAPTER_STRATEGY.md`. |
| CLI/TUI / `rivet` | CONTRADICTS-SPEC | [OBSERVATION] Clap commands, chat, Ratatui TUI, auth/model commands, and trace-like state display exist (`crates/rivet/src/main.rs`, `crates/rivet/src/tui.rs`). [OBSERVATION] No `--trace` CLI option was found. [OBSERVATION] Ctrl-C/Esc only flips `is_processing`; spawned `harness.step` continues without a cancellation handle (`crates/rivet/src/tui.rs:2417-2421`, `:2675-2679`). | No test files / 0 test attributes in the inventory. | Monograph CLI/TUI; D-023; ACCP `CANCELLATION` signal semantics. |
| MCP edge / `rivet-mcp` | ABSENT | [OBSERVATION] No `rivet-mcp` workspace member, source directory, `rmcp` dependency, or `rmcp` reference was found. | No tests. | Monograph MCP edge; `docs/architecture/IMPLEMENTATION_LAYOUT.md:23`; D-022. |
| Evaluation / `rivet-eval` | COMPLETE-UNVERIFIED | [OBSERVATION] Scenario, ablation, runner, metrics, and a benchmark test exist; it is an extra workspace member. | 1 unit + 1 async test inventory; no targeted receipt. | Evaluation sections of monograph; not part of the supplied first-slice crate list. |
| Planned `rivet-view`, `rivet-mcp`, root `tests/`, `rust-toolchain.toml` | ABSENT | [OBSERVATION] Paths are absent and `rivet-view`/`rivet-mcp` are absent from Cargo metadata. | None. | `docs/architecture/IMPLEMENTATION_LAYOUT.md:14,23,25`; supplied master prompt. |

## Contradictions and high-risk observations

1. [OBSERVATION] The implementation layout names `rivet-view`, `rivet-mcp`, and a root `tests/` tree, while Cargo declares neither the two crates nor the root test directory. Evidence: `Cargo.toml:1-15`, `.rivet/audit/phase0/workspace-members.txt`.
2. [OBSERVATION] The Cognitive View has no rejected-path, contradiction, capability, or explicit provenance sections required by the view contract. Evidence: `crates/noesis/src/lib.rs:344-452`, `docs/contracts/ACCP_3_0_SPEC.md:644-664`.
3. [OBSERVATION] Hephaestus is always instantiated with threshold 3, contrary to the requested disabled-by-default cold-path posture. Evidence: `crates/rivet-core/src/lib.rs:125-126`, `docs/subsystems/HEPHAESTUS_SPEC.md`.
4. [OBSERVATION] Runtime command handling has no process-group kill or output cap; the file-read path is capped at 64 KiB but command output is not. Evidence: `crates/rivet-runtime/src/lib.rs:53-73`, `crates/praxis/src/gates/exec_gate.rs:120-137`.
5. [OBSERVATION] Store append has no optimistic expected-revision/CAS contract and no `STALE_STATE` result. Evidence: `crates/rivet-store/src/lib.rs:16-22,116-158`; ACCP `STALE_STATE` at `docs/contracts/ACCP_3_0_SPEC.md:1518-1534`.
6. [OBSERVATION] The CLI has no `--trace`; TUI cancellation is UI-only and does not cancel the spawned Harness task. Evidence: `rg -n -i 'trace|cancel' crates/rivet`, `crates/rivet/src/tui.rs:2417-2421,2675-2679`.
7. [INFERENCE] Model-generated verification requests are likely rejected as stale because the model receives revision R, the invocation record advances Hard State to R+1, and the request is checked against R+1 even though its target scope was constructed from the view at R. Evidence: `crates/rivet-core/src/lib.rs:274,288-303,396-407,659-674`. This requires a discriminating targeted test before patching.
8. [OBSERVATION] `cargo test --workspace` failed during a moving snapshot with an `accp` unit-test/type mismatch. It is not safe to attribute this to a settled file state while the external edit stream remains active.

## Risk ranking by first vertical slice

1. **Blocker:** Unstable working tree / concurrent process prevents reproducible receipts and safe scope manifests.
2. **Blocker:** Workspace test gate is not green at the captured snapshot; no bug can close under the stated discipline.
3. **High:** Harness verification revision handling may reject the model's only visible revision.
4. **High:** Runtime/ExecGate lack output caps and process-group cancellation, risking leaked descendants and unbounded memory.
5. **High:** TUI cancellation does not cancel work, so user-visible cancellation can leave authoritative work running.
6. **High:** View omits rejected/contradictory/provenance information, reducing the epistemic projection needed for continuity.
7. **High:** Store lacks an explicit stale-state/CAS contract for concurrent writers and restart continuity.
8. **Medium:** ACCP typed-ID drift and missing MCP edge are structural contract gaps.
9. **Medium:** No `--trace` and no CLI tests reduce observability and regression protection.

## Open questions for human authority

- [UNKNOWN-USER-AUTHORITY] Should the audit wait for the active TUI/other agent to finish, or should that process be considered an intentionally shared live session?
- [UNKNOWN-USER-AUTHORITY] Is `rivet-model-rig` now an approved addition that supersedes D-021, or must the first adapter remain GenAI-only?
- [UNKNOWN-USER-AUTHORITY] Are `rivet-view`, `rivet-mcp`, root `tests/`, and `rust-toolchain.toml` still required, or has the implementation layout been intentionally revised?
- [UNKNOWN-USER-AUTHORITY] Should repository/model/message/ledger identifiers become newtypes? This changes public API and cannot be inferred from the raw-string scan alone.
- [UNKNOWN-USER-AUTHORITY] Is process-group termination required on Windows and Unix with a shared portable abstraction, or is child-only termination accepted for the current slice?

## Campaign after-state

The matrix above is the historical audit snapshot. The following records the authorized follow-up campaign at current HEAD `91fff718fecc76d7a29e74b77a59e9fbbf7de316`.

- [OBSERVATION] The TUI process was no longer running when stabilization was checked. The tree remained dirty because it contains pre-existing/user-authorized edits plus campaign edits; it was stable enough for serialized verification.
- [OBSERVATION] BUG-001's historical ACCP compile mismatch did not reproduce after stabilization; no BUG-001 source diff was needed.
- [OBSERVATION] BUG-002, BUG-003, BUG-005, BUG-006, and BUG-007 have focused regression receipts and pass the final workspace gates. Per-bug records are in [bugs/](/C:/Users/dresden/Documents/rivet/bugs/).
- [OBSERVATION] BUG-004's descendant-termination test passed on the current Windows host. Its Unix `cfg` path was compile-present but not execution-tested here; it remains an explicit UNKNOWN in [bugs/BUG-004.md](/C:/Users/dresden/Documents/rivet/bugs/BUG-004.md).
- [OBSERVATION] Final `cargo fmt --check`, strict clippy, `cargo check --workspace`, and `cargo test --workspace` all exited 0. Receipts: [.rivet/audit/baseline/](/C:/Users/dresden/Documents/rivet/.rivet/audit/baseline/).
- [OBSERVATION] No test attribute or test function was removed, no `#[ignore]` attribute was found, and the final workspace test output contains zero failed and zero ignored tests. Receipt: [.rivet/audit/self-check/test-integrity.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/self-check/test-integrity.txt).
- [UNKNOWN] No separate sub-agent implementation/review/verifier tool was exposed in this session. The per-bug receipts therefore document orchestrator review plus mechanical verification, not an independent-context reviewer.

The updated machine-readable before/after matrix is [AUDIT_MATRIX_AFTER.json](/C:/Users/dresden/Documents/rivet/AUDIT_MATRIX_AFTER.json). Residual structural gaps from the historical audit remain: absent `rivet-view`/`rivet-mcp`, missing explicit view provenance/rejected-path sections, no CLI `--trace`, and Hephaestus default activation.
