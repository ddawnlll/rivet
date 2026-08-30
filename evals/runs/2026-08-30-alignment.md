# Rivet alignment evaluation ledger — 2026-08-30

This ledger records the verification runs performed during the `/goal` window.
It makes no performance, reliability, or economic claim beyond the commands and
fixtures listed below.

## Timebox

- `start_time`: `2026-08-30T21:24:55.0414998+03:00`
- `minimum_end_time`: `2026-08-30T23:24:55.0414998+03:00`
- system timezone: `Europe/Istanbul`

## Run ledger

| Run | Command / exercise | Result |
|---|---|---|
| EVAL-001 | Baseline `cargo test --workspace` | PASS before alignment work. |
| EVAL-002 | Baseline `cargo clippy --workspace -- -D warnings` | FAIL: 7 pre-existing Praxis lint errors; repaired and committed as `dd7b17b`. |
| EVAL-003 | `cargo test --workspace` after clippy baseline repair | PASS. |
| EVAL-004 | `cargo test -p rivet-repository` | PASS: deterministic ordering, ignore/defer classification, symlink non-following. |
| EVAL-005 | `cargo test -p accp` | PASS: producer matrix, ontology family/kind, claim/completion/action semantics. |
| EVAL-006 | `cargo test -p rivet-runtime` | PASS: traversal boundary, atomic write observations, idempotency, concurrent retry, UTF-8 truncation. |
| EVAL-007 | `cargo test -p rivet-core` | PASS: real Runtime→Praxis verification, completion gate, redb restart, scope denial, concurrent step serialization, authoritative injection denial. |
| EVAL-008 | `cargo test -p praxis` | PASS: parsers, Merkle/ledger, 8-gate pipeline, safe cwd boundary. |
| EVAL-009 | `cargo test -p rivet-model-genai` | PASS: credential-aware live smoke test skipped cleanly because OpenCode credentials are absent. |
| EVAL-010 | `cargo clippy --workspace -- -D warnings` after current changes | PASS. |
| EVAL-011 | `cargo run -q -p rivet -- census .` | PASS: observed 120 files, 1 deferred tree, bounded frontier implementation available. |
| EVAL-012 | `":quit" \| cargo run -q -p rivet -- chat .` | PASS: binary initializes persistent `.rivet/state.redb`, compiles census frontier, enters and exits REPL. |
| EVAL-013 | `cargo test -p rivet-core` with credential-aware real cycle test | PASS offline via explicit SKIP; when configured, the same test invokes `GenAiBackend` and asserts Harness/Noesis accounting. |
| EVAL-014 | `cargo test --workspace` after receipt metadata, persisted idempotency, REPL, and invalidation changes | PASS: all unit, integration, and doc tests. |
| EVAL-015 | `cargo clippy --workspace -- -D warnings` after the same changes | PASS. |
| EVAL-016 | `cargo test -p rivet-core --test cognitive_cycle_test` | PASS: 8 tests, including restart idempotency and serialized concurrent steps. |
| EVAL-017 | `cargo test -p rivet-core --test cognitive_cycle_test` after phase/invalidation additions | PASS: 9 tests, including explicit `RunPhase` outcomes and failed Praxis verification reopening its obligation. |
| EVAL-018 | `cargo test --workspace` after strict scope matching, prompt bounds, append-log recovery, and phase changes | PASS: all workspace unit, integration, and doc tests. |
| EVAL-019 | `cargo clippy --workspace -- -D warnings` after the same changes | PASS. |
| EVAL-020 | `cargo test -p rivet-core --test cognitive_cycle_test` plus `cargo clippy -p rivet-core -- -D warnings` after canonical lifecycle phase completion | PASS: 9 core tests and strict core clippy; `Observing` and `Responding` transitions now exist alongside the documented lifecycle states. |
| EVAL-021 | `cargo test -p rivet-core --test cognitive_cycle_test` plus `cargo clippy -p rivet-core --tests -- -D warnings` after the Verity bridge | PASS: 10 core tests; a real `cargo --version` subprocess traverses the 8-gate PlanSpec pipeline and becomes a scoped, persisted Harness verification receipt. |
| EVAL-022 | `cargo test --workspace` after Harness Verity bridge | PASS: all workspace unit, integration, and doc tests, including 10 Core cognitive-cycle tests. |
| EVAL-023 | `cargo clippy --workspace -- -D warnings` after Harness Verity bridge | PASS. |
| EVAL-024 | `cargo test -p rivet-store --test store_test -- --nocapture` plus `cargo clippy -p rivet-store --tests -- -D warnings` | PASS: 4 persistence tests; a real child test process exits before checkpoint and its append-log event is recovered after reopen. |
| EVAL-025 | `cargo test -p accp --test accp_invariants_test` plus `cargo clippy -p accp --tests -- -D warnings` | PASS: 8 ontology tests; every current VIEW/QUERY/PROPOSAL/DECISION/RECEIPT/SIGNAL carrier round-trips through canonical JSON with family/kind/scope/revision preserved. |
| EVAL-026 | `cargo test -p noesis; cargo test -p rivet-repository; cargo test -p rivet-core --test cognitive_cycle_test; cargo clippy --workspace -- -D warnings` | PASS: directory-level census signals reach CognitiveView as non-authoritative context; 6 Noesis, 2 repository, 10 Core tests and workspace clippy pass. |
| EVAL-027 | `cargo test -p rivet-repository; cargo test -p noesis; cargo test -p rivet-core --test cognitive_cycle_test; cargo clippy --workspace -- -D warnings` | PASS after repository-signal wiring; directory counts/bytes and deferred high-volume signals are bounded to CognitiveView and all targeted tests plus workspace clippy pass. |
| EVAL-028 | `cargo test -p rivet-core --test cognitive_cycle_test` after unknown-obligation enforcement | PASS: 11 Core tests; verification rejects unknown obligations before command execution, and the end-to-end fixture now creates and verifies a real obligation before completion. |
| EVAL-029 | `cargo test -p rivet-core --test cognitive_cycle_test` plus `cargo clippy -p rivet-core --tests -- -D warnings` after completion-event hardening | PASS: 12 Core tests; direct completion events reject open obligations/unclosed receipts and accept only after recorded PASS plus closure. |
| EVAL-030 | `cargo test -p rivet-core --test cognitive_cycle_test` plus `cargo clippy -p rivet-core --tests -- -D warnings` after authoritative event hardening | PASS: 13 Core tests; direct verification and closure events cannot mint unknown obligations. |
| EVAL-031 | `cargo test -p rivet-core --test cognitive_cycle_test` plus `cargo clippy -p rivet-core --tests -- -D warnings` after verification serialization | PASS: 14 Core tests; two same-revision real Praxis requests yield one subprocess verification and one stale rejection before execution. |
| EVAL-032 | `cargo run -q -p rivet -- census .` and `":quit" | cargo run -q -p rivet -- chat .` after repository-signal wiring | PASS: CLI census observes 122 files, 49 bounded directory signals, and 1 deferred tree; persistent chat opens and exits cleanly. |
| EVAL-033 | `cargo test -p rivet-core --test cognitive_cycle_test -- --nocapture` after Verity failure-path coverage | PASS: 14 Core tests; a missing evidence ledger yields HOLD, persists a failed verification receipt, and reopens the previously closed obligation. |
| EVAL-034 | `cargo test --workspace` and `cargo clippy --workspace -- -D warnings` after all current changes | PASS: complete workspace test/doc suite and strict clippy. |
| EVAL-035 | `cargo test -p rivet-core --test cognitive_cycle_test -- --nocapture` plus `cargo clippy -p rivet-core --tests -- -D warnings` | PASS: 14 Core tests now prove Verity PASS can complete a task, while a later HOLD reopens the obligation and invalidates completion. |
| EVAL-036 | `cargo test -p rivet-repository` plus `cargo clippy -p rivet-repository -- -D warnings` after deferred signal refinement | PASS: deferred directory observations distinguish high-volume, dependency-materialization, and generated-artifacts signals. |
| EVAL-037 | `cargo test -p rivet-core --test cognitive_cycle_test` plus `cargo clippy -p rivet-core --tests -- -D warnings` after task-bound completion hardening | PASS: direct completion for a foreign task ID is rejected; 14 Core tests and strict Core clippy pass. |
| EVAL-038 | `cargo test -p rivet-model-genai --test live_opencode_test -- --nocapture` plus `cargo clippy -p rivet-model-genai --tests -- -D warnings` | PASS: credential-aware live test skips explicitly without keys; with credentials it now checks both non-stream invoke and native stream paths. |
| EVAL-039 | `cargo test -p rivet-core --test cognitive_cycle_test` plus `cargo clippy -p rivet-core --tests -- -D warnings` after obligation scope/identity hardening | PASS: 14 Core tests; wrong-repository obligations and cross-obligation closure attempts are rejected before state mutation. |
| EVAL-040 | `cargo test --workspace --release` after all current changes | PASS: optimized workspace unit, integration, and doc tests; 14 Core, 8 ACCP, 6 Noesis, 4 Runtime, and 4 process-persistence tests pass. |
| EVAL-041 | `cargo test -p rivet-core --test cognitive_cycle_test` plus `cargo clippy -p rivet-core --tests -- -D warnings` after durable obligation scope enforcement | PASS: 15 Core tests; obligation scopes survive restart and broader repository/path verification scopes are rejected before subprocess execution. |
| EVAL-042 | `cargo test --workspace` and `cargo clippy --workspace -- -D warnings` after durable obligation scope enforcement | PASS: final debug workspace unit, integration, and doc suite; strict workspace clippy passes. |
| EVAL-043 | `cargo test --workspace --release` after durable obligation scope enforcement | PASS: optimized final workspace unit, integration, and doc suite; 15 Core tests and process-persistence tests pass. |
| EVAL-044 | `cargo test --workspace --locked` after durable obligation scope enforcement | PASS: lockfile-constrained debug workspace unit, integration, and doc suite; 15 Core tests, live-test skips, and process-persistence tests pass. |
| EVAL-045 | `cargo test -p rivet-core --test cognitive_cycle_test --release` and `cargo test --workspace --locked` | PASS: optimized 15-test Core cycle and a second lockfile-constrained full workspace regression both pass. |
| EVAL-046 | `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace --quiet` after Praxis test-lint repair | PASS: all workspace targets are warning-free; full debug workspace suite passes with exit code 0. |

## Atomic milestones

- `dd7b17b` — restore workspace clippy-clean baseline.
- `1000ccd` — enforce ACCP runtime verification boundaries.
- `bbcc519` — harden repository and verification boundaries, OpenCode adapter/native stream path, CLI persistence/frontier.
- `97e68f3` — close state/retry semantic gaps, strict ontology carriers, CognitiveView evidence/repository identity, concurrency and invalidation tests.
- `867dc90` — strict scope glob semantics, CognitiveView UTF-8/token bounds, append-log recovery, post-completion invalidation, and explicit RunPhase outcomes.
- `02c75aa` — Harness bridge for PlanSpec-driven VerityPipeline verification, with a real subprocess integration test and test clippy repair.
- `4e4ad0e` — child-process crash recovery test and updated persistence gap tracking.
- `4c088f7` — ACCP carrier round-trip fixtures and schema gap tracking.
- `76e9710` — hierarchical census summaries and CognitiveView repository-signal wiring.
- `0581e03` — known-obligation verification enforcement and corrected end-to-end completion fixture.
- `8e418a6` — direct completion-event hardening and updated semantic gap tracking.
- `98e5b1b` — authoritative verification/closure event hardening.
- `c06a13d` — cycle-serialized public verification and concurrency proof.
- `294238f` — Verity failure-path coverage and final full-gate ledger update.
- `dad588d` — Verity PASS → completion → failed recheck invalidation extension.
- `e85692c` — refined deferred-tree signals for semantic induction.
- `16d9d66` — task-bound completion event enforcement.
- `7426250` — credential-aware OpenCode invoke + native stream live coverage.
- `cecc8ca` — obligation scope and receipt identity hardening.
- `63b5e36` — optimized release workspace regression evidence.
- `4b8c65e` — durable obligation scope map and path-broadening verification guard.
- `b7d59af` — final debug workspace regression evidence after durable scope enforcement.
- `86c052e` — optimized final workspace regression evidence.
- `01c2b49` — lockfile-constrained workspace regression evidence.
- `pending` — optimized focused Core and repeated locked workspace regression evidence (to be committed after final gate).
- `pending` — all-target clippy repair and full debug workspace regression evidence (to be committed after final gate).

## Interpretation and remaining limits

The strongest current evidence is executable behavior: the workspace compiles,
the full test suite and denied-authority paths pass, and the core integration
tests execute real subprocess verification through Runtime and Praxis. No
credentialed OpenCode network evaluation was possible in this environment, and
the remaining gaps are recorded in `TASKS.yaml` rather than represented as
completed behavior.
