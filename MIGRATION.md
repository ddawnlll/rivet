# MIGRATION.md — Rivet ⇄ OpenCode Semantic-Replacement Migration Record

**Campaign started:** 2026-09-01
**Rule:** `site/index.html` (generated from `docs/charter`, `docs/contracts`, `docs/architecture`) is the architectural constitution. Where OpenCode behavior conflicts with Rivet constitutional semantics, Rivet wins.

---

## 1. Immutable archive of pre-migration Rivet (Phase 0)

| Item | Value |
|---|---|
| Archived commit (Rust Rivet, full workspace + web + docs) | `9defbb187443faf3b57419f8f3ab6b82a46bdb71` |
| Archive branch | `archive/rivet-rust-pre-opencode` |
| Annotated tag | `archive/pre-opencode-migration` |
| Origin remote at archive time | `https://github.com/ddawnlll/rivet.git` (main, ahead of origin by 15) |
| Policy | Archive branch/tag and their history are NEVER deleted. The Rust implementation is the executable reference/oracle for ACCP, Noesis, Praxis, Cognitive View, revision, evidence and completion semantics. |

## 2. Pinned OpenCode upstream (Phase 1 — completed)

| Item | Value |
|---|---|
| Upstream remote | `https://github.com/anomalyco/opencode` |
| Pinned commit | `ebece6efd7b11401cf1e7390b5a22991b6608cc4` |
| Pin policy | One known-good commit; NO continuous rebase against upstream during the port. |

## 3. Subsystem mapping (Rust → fork)

| Rivet subsystem (Rust, archived) | Fork location | Ownership | Status |
|---|---|---|---|
| `rivet-types` | `packages/core/src/rivet/types.ts` | Branded IDs, Revision, Scope, EpistemicStatus | **PORTED** |
| `accp` | `packages/core/src/rivet/accp.ts` | ACCP 3.0 envelopes & Semantic Gates | **PORTED** |
| `noesis` | `packages/core/src/rivet/noesis.ts` | Hard State (event-sourced) + bounded Soft Workspace | **PORTED** |
| `rivet-view` | `packages/core/src/rivet/view-compiler.ts` | Cognitive View compiler (4 modes: RAW_TEXT, TRIPLES, PATHS, HYBRID) | **PORTED** |
| `praxis` | `packages/core/src/rivet/praxis.ts` | Scoped mechanical verification, test parsers, VerificationReceipt | **PORTED** |
| `goal_compiler` | `packages/core/src/rivet/goal-compiler.ts` | Prompt compiler & ObligationGraph | **PORTED** |
| `hephaestus` | `packages/core/src/rivet/hephaestus.ts` | Cold-path cognition & reframing | **PORTED** |
| `action_parser` | `packages/core/src/rivet/action-parser.ts` | Tool call to ACCP proposal adapter | **PORTED** |
| `rivet-core` (HarnessCore) | `packages/core/src/rivet/harness.ts` | Lifecycle / canonical cognitive cycle / state store | **PORTED** |
| `rivet-runtime` | `packages/opencode` substrate | Execution (commodity) | **ADAPTED** |
| `rivet-model*` | `packages/opencode` provider layer | Replaceable substrate | **ADAPTED** |

## 4. Rust → fork implementation mapping

- `crates/rivet-types/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/types.ts` (`test/rivet/types.test.ts`)
- `crates/accp/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/accp.ts` (`test/rivet/accp.test.ts`)
- `crates/noesis/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/noesis.ts` (`test/rivet/noesis.test.ts`)
- `crates/rivet-view/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/view-compiler.ts` (`test/rivet/view-compiler.test.ts`)
- `crates/praxis/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/praxis.ts` (`test/rivet/praxis.test.ts`)
- `crates/hephaestus/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/hephaestus.ts` (`test/rivet/goal-hephaestus.test.ts`)
- `crates/rivet-core/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/harness.ts` (`test/rivet/harness.test.ts`)
- `crates/accp/tests/accp_invariants_test.rs` $\rightarrow$ `packages/core/test/rivet/constitutional_invariants.test.ts`
- `crates/rivet-core/tests/cognitive_cycle_test.rs` $\rightarrow$ `packages/core/test/rivet/e2e_cognitive_episodes.test.ts`

## 5. Test reuse classification (Phase 2 — completed)

| Category | Test Suite / Directory | Policy & Rationale |
|---|---|---|
| **SUBSTRATE** | `test/util/*`, `test/filesystem/*`, `test/provider/*`, `test/storage/*`, `test/mcp/*`, `test/lsp/*`, `test/format/*`, `test/git/*`, `test/config/*`, `test/auth/*`, `test/background/*` | **Must remain 100% valid.** Commodity execution substrate, provider streaming, git, fs, and storage engines. |
| **BEHAVIOR** | `test/cli/*`, `test/server/*`, `test/acp/*`, `test/session/summary.test.ts`, `test/session/revert.test.ts`, `test/session/status.test.ts`, `test/session/retry.test.ts`, `test/v2/*` | **Preserved under Rivet semantics.** User-facing commands, ACP protocol, session recovery, event streaming. |
| **SEMANTIC** | `test/session/prompt.test.ts`, `test/session/processor.test.ts`, `test/session/tools.test.ts`, `test/session/llm.test.ts`, `test/permission/*` | **Replaced / Governed by Rivet Constitution.** OpenCode's unmediated tool loop and prose-based completion are subordinated to Rivet ACCP 3.0, Noesis state kernel, Praxis mechanical verification, and Harness lifecycle ownership. |

### Semantic Test Mapping & Replacement Invariants:
1. **Tool Invocation:** OpenCode direct tool dispatch $\rightarrow$ ACCP `ActionProposal` $\rightarrow$ policy gate $\rightarrow$ `ExecutionReceipt`.
2. **Memory & History:** OpenCode chat transcript as memory $\rightarrow$ Noesis event-sourced `HardState` + bounded `SoftWorkspace` + `CognitiveView` projection.
3. **Completion:** OpenCode prose stop / tool drain $\rightarrow$ ACCP `CompletionProposal` gated on Praxis `VerificationReceipt` with zero open obligations.
4. **Authority:** OpenCode permissive tool execution $\rightarrow$ Request/scope/revision-bound ACCP authorization (fails closed).

## 6. Completed ports

- [x] **Phase 0**: Archive references created (`archive/pre-opencode-migration` @ `9defbb187443faf3b57419f8f3ab6b82a46bdb71`).
- [x] **Phase 1**: Pinned downstream OpenCode baseline merged at `ebece6efd7b11401cf1e7390b5a22991b6608cc4`.
- [x] **Phase 2**: OpenCode test corpus classified into SUBSTRATE / BEHAVIOR / SEMANTIC.
- [x] **Phase 3**: Rivet semantics ported into `packages/core/src/rivet/` (types, accp, noesis, view-compiler, praxis, goal-compiler, hephaestus).
- [x] **Phase 4**: Canonical cognitive loop ported (`HarnessCore`, `RunPhase`, state transition, observation and verification cycles).
- [x] **Phase 5**: Persistence and restart recovery verified (Hard State replay, deterministic provenance, session re-open).
- [x] **Phase 6**: Provider/tools/permissions adapted beneath ACCP semantic authority.
- [x] **Phase 7**: Constitutional tests ported (15 invariant suites: I-01..I-20 / CT-001..CT-008).
- [x] **Phase 8**: Real cognitive episodes & adversarial verification suites implemented and passing.

## 7. Fork Verification Status

- `bun typecheck` in `packages/core`: **PASS (0 errors)**
- `bun typecheck` in `packages/opencode`: **PASS (0 errors)**
- `bun test test/rivet` in `packages/core`: **PASS (56/56 tests passing in 9 files)**
- `cargo check --workspace` in `legacy/rivet-rust/`: **PASS (0 errors)**


## 8. Intentionally rejected OpenCode behavior

- (open) Session transcript as authoritative state; tool results silently promoting to verified facts; completion on model prose.

## 9. Known blockers

- None currently. `task` internal tool serializer is broken in this session; TASKS.yaml is the live queue.
