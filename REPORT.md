# Rivet Audit and Bugfix Campaign Report

**Snapshot:** 2026-08-31T20:24:21.6949663+03:00  
**HEAD:** `d20ccd054d0bdf5b58cfc387bf0daf6fe3656020`  
**Campaign state:** BLOCKED — external edit stream and active TUI process

## Counts

| Category | Count | Authority |
| --- | ---: | --- |
| Closed/fixed | 0 | No bug has green verifier receipts. |
| Open | 6 | BUG-001 through BUG-006. |
| Blocked or authority-gated | 7 | BUG-001, BUG-003, BUG-004, BUG-005, BUG-006, BUG-007 plus the campaign itself. |
| Review cycles completed | 0 | No safe implementer diff existed to review. |
| Tests deleted/skipped/weakened | 0 observed | No source/test edits were made by this audit. |

BUG-002 is counted as open/needs reproduction rather than blocked in the total above. BUG-007 is open but requires human authority before a public store API change.

## Receipts

- [OBSERVATION] `cargo fmt --check`: FAIL; unclosed delimiter and moving-tree formatting diffs. Receipt: [.rivet/audit/baseline/01-cargo-fmt-check.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/baseline/01-cargo-fmt-check.txt).
- [OBSERVATION] strict clippy: FAIL at `rivet-types/src/lib.rs:155` (`collapsible_if`). Receipt: [.rivet/audit/baseline/02-cargo-clippy.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/baseline/02-cargo-clippy.txt).
- [OBSERVATION] `cargo check --workspace`: PASS with an `unreachable pattern` warning in Rig. Receipt: [.rivet/audit/baseline/03-cargo-check.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/baseline/03-cargo-check.txt).
- [OBSERVATION] `cargo test --workspace`: FAIL at capture time with an ACCP unit-test/type mismatch; the source changed afterward. Receipt: [.rivet/audit/baseline/04-cargo-test.txt](/C:/Users/dresden/Documents/rivet/.rivet/audit/baseline/04-cargo-test.txt).

## Failure clustering

[OBSERVATION] One workspace-test signature repeated within one moving compile attempt, but no stable count of three independent failures was established. The ≥3 process-level escalation threshold is therefore not triggered.  
[INFERENCE] The dominant process risk is non-atomic external editing during verification; the proposed process fix is to release/serialize the active TUI and source-edit stream before any implementer scope is issued.

## Remaining gaps ranked by vertical-slice impact

1. Stabilize the worktree and rerun the complete baseline.
2. Reproduce BUG-002 with a scripted model and close the revision contract.
3. Fix/verify fail-closed Praxis execution (BUG-006).
4. Fix runtime output/cancellation boundaries (BUG-003/BUG-004/BUG-005).
5. Decide store CAS authority (BUG-007).
6. Implement or explicitly revise Cognitive View rejected/provenance sections and missing planned crates.
7. Add `--trace` and CLI/TUI regression tests.

## Recommended next work

The human should first stop or release the active `cargo run --bin rivet -- --tui` session and confirm whether the concurrent source edits are authoritative. Then rerun the baseline receipts. Only after a stable green/known-failing baseline should an implementer receive one of BUG-002, BUG-006, or BUG-003 with a least-capability scope manifest, followed by an independent review and mechanical verifier.

No completion claim is made: full-gate receipts, independent reviews, and closed obligations are missing.
