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
- `pending` — direct completion-event hardening and updated semantic gap tracking (to be committed after final gate).

## Interpretation and remaining limits

The strongest current evidence is executable behavior: the workspace compiles,
the full test suite and denied-authority paths pass, and the core integration
tests execute real subprocess verification through Runtime and Praxis. No
credentialed OpenCode network evaluation was possible in this environment, and
the remaining gaps are recorded in `TASKS.yaml` rather than represented as
completed behavior.
