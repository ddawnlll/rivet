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
| `accp` | `packages/core/src/rivet/accp.ts` | ACCP 3.0 envelopes, `AuthorizedAction` contract, Semantic Gates | **PORTED** |
| `noesis` | `packages/core/src/rivet/noesis.ts` | Hard State (event-sourced replay) + bounded Soft Workspace | **PORTED** |
| `rivet-view` | `packages/core/src/rivet/view-compiler.ts` | Cognitive View compiler (4 modes: RAW_TEXT, TRIPLES, PATHS, HYBRID) | **PORTED** |
| `praxis` (kernel) | `packages/core/src/rivet/praxis/` | Merkle (RFC 6962), NDJSON Ledger, 8-Gate Pipeline, Circuit Breaker, Blind Reviewer (I-08/I-14) | **PORTED** |
| `praxis` (parsers) | `packages/core/src/rivet/praxis.ts` | Scoped mechanical verification, test parsers (Cargo, Bun, Pytest, Go) | **PORTED** |
| `goal_compiler` | `packages/core/src/rivet/goal-compiler.ts` | Prompt compiler & ObligationGraph DAG | **PORTED** |
| `hephaestus` | `packages/core/src/rivet/hephaestus.ts` | Cold-path cognition & reframing | **PORTED** |
| `action_parser` | `packages/core/src/session/commitment.ts` | Provider frame to typed ACCP commitment adapter | **CORE-OWNED** |
| `rivet-repository` | `packages/core/src/rivet/repository/project-graph.ts` | Multi-graph symbols, dependency DAG, reachability closure | **PORTED** |
| `rivet-runtime` (AST) | `packages/core/src/rivet/runtime/semantic-patch.ts` | `symbol://` URI AST patcher with CAS revision validation | **PORTED** |
| `rivet-runtime` (Risk) | `packages/core/src/rivet/runtime/sandbox.ts` | `CommandRiskClassifier` typed AST/flag classification | **PORTED** |
| `rivet-core` lifecycle | `packages/core/src/session/semantics.ts` + `packages/core/src/session/**` | Session-owned lifecycle state, Noesis replay, Cognitive View and completion authority | **NATIVE** |
| `rivet-runtime` (Mechanisms) | `packages/opencode` substrate | Process execution, PTY, filesystem (commodity mechanism) | **REUSED** |
| `rivet-model*` | `packages/opencode` provider layer | Provider streaming, tool schemas (replaceable substrate) | **REUSED** |

## 4. Rust → fork implementation mapping

- `crates/rivet-types/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/types.ts` (`test/rivet/types.test.ts`)
- `crates/accp/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/accp.ts` (`test/rivet/accp.test.ts`)
- `crates/noesis/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/noesis.ts` (`test/rivet/noesis.test.ts`)
- `crates/rivet-view/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/view-compiler.ts` (`test/rivet/view-compiler.test.ts`)
- `crates/praxis/src/merkle.rs` $\rightarrow$ `packages/core/src/rivet/praxis/merkle.ts` (`test/rivet/praxis/merkle_and_ledger.test.ts`)
- `crates/praxis/src/ledger.rs` $\rightarrow$ `packages/core/src/rivet/praxis/ledger.ts` (`test/rivet/praxis/merkle_and_ledger.test.ts`)
- `crates/praxis/src/circuit_breaker.rs` $\rightarrow$ `packages/core/src/rivet/praxis/circuit-breaker.ts` (`test/rivet/praxis/circuit_breaker.test.ts`)
- `crates/praxis/src/reviewer.rs` $\rightarrow$ `packages/core/src/rivet/praxis/reviewer.ts` (`test/rivet/praxis/reviewer_independence.test.ts`)
- `crates/praxis/src/pipeline.rs` $\rightarrow$ `packages/core/src/rivet/praxis/pipeline.ts` (`test/rivet/praxis/verity_pipeline.test.ts`)
- `crates/rivet-repository/src/project_graph.rs` $\rightarrow$ `packages/core/src/rivet/repository/project-graph.ts` (`test/rivet/repository/project_graph.test.ts`)
- `crates/rivet-runtime/src/semantic_patch.rs` $\rightarrow$ `packages/core/src/rivet/runtime/semantic-patch.ts` (`test/rivet/runtime/sandbox_and_patch.test.ts`)
- `crates/hephaestus/src/lib.rs` $\rightarrow$ `packages/core/src/rivet/hephaestus.ts` (`test/rivet/goal-hephaestus.test.ts`)
- `crates/rivet-core/src/lib.rs` $\rightarrow$ `packages/core/src/session/semantics.ts` and the normal SessionRunner path (`test/session-runner.test.ts`)
- `crates/accp/tests/accp_invariants_test.rs` $\rightarrow$ `packages/core/test/rivet/constitutional_invariants.test.ts`
- `crates/rivet-core/tests/cognitive_cycle_test.rs` $\rightarrow$ normal SessionRunner architecture coverage (`test/session-runner.test.ts`, `test/session_runner_architecture.test.ts`)

## 5. Test reuse classification (Phase 2 — completed)

| Category | Test Suite / Directory | Policy & Rationale |
|---|---|---|
| **SUBSTRATE** | `test/util/*`, `test/filesystem/*`, `test/provider/*`, `test/storage/*`, `test/mcp/*`, `test/lsp/*`, `test/format/*`, `test/git/*`, `test/config/*`, `test/auth/*`, `test/background/*` | **Must remain 100% valid.** Commodity execution substrate, provider streaming, git, fs, and storage engines. |
| **BEHAVIOR** | `test/cli/*`, `test/server/*`, `test/acp/*`, `test/session/summary.test.ts`, `test/session/revert.test.ts`, `test/session/status.test.ts`, `test/session/retry.test.ts`, `test/v2/*` | **Preserved under Rivet semantics.** User-facing commands, ACP protocol, session recovery, event streaming. |
| **SEMANTIC** | `test/session/prompt.test.ts`, `test/session/processor.test.ts`, `test/session/tools.test.ts`, `test/session/llm.test.ts`, `test/permission/*` | **Replaced / Governed by Rivet Constitution.** OpenCode's unmediated tool loop and prose-based completion are subordinated to Rivet ACCP 3.0, Noesis state kernel, Praxis mechanical verification, and Harness lifecycle ownership. |

### Semantic Test Mapping & Replacement Invariants:
1. **Tool Invocation:** OpenCode direct tool dispatch $\rightarrow$ ACCP `ActionProposal` $\rightarrow$ policy gate $\rightarrow$ `AuthorizedAction` $\rightarrow$ `ExecutionReceipt`.
2. **Memory & History:** OpenCode chat transcript as memory $\rightarrow$ Noesis event-sourced `HardState` + bounded `SoftWorkspace` + `CognitiveView` projection.
3. **Completion:** OpenCode prose stop / tool drain $\rightarrow$ ACCP `CompletionProposal` gated on Praxis `VerificationReceipt` with zero open obligations.
4. **Authority:** OpenCode permissive tool execution $\rightarrow$ Request/scope/revision-bound ACCP authorization (fails closed).

## 6. Completed ports & Acceptance Episodes

- [x] **Phase 0**: Archive references created (`archive/pre-opencode-migration` @ `9defbb187443faf3b57419f8f3ab6b82a46bdb71`).
- [x] **Phase 1**: Pinned downstream OpenCode baseline merged at `ebece6efd7b11401cf1e7390b5a22991b6608cc4`.
- [x] **Phase 2**: OpenCode test corpus classified into SUBSTRATE / BEHAVIOR / SEMANTIC.
- [x] **Phase 3**: Rivet semantics ported into `packages/core/src/rivet/` (types, accp, noesis, view-compiler, praxis, goal-compiler, hephaestus, project-graph, semantic-patch, sandbox).
- [x] **Phase 4**: Native session/tool lifecycle is owned by `SessionSemantics` and the normal `SessionRunner` path (`AuthorizedExecution`, provider-frame admission, receipts, observations and completion proposals).
- [x] **Phase 5**: Semantic events are persisted on the Session aggregate and rehydrated into Noesis. The normal runner test reconstructs the goal, execution receipt, observation, evidence and next Cognitive View after restart.
- [x] **Phase 6**: V2, legacy V1, MCP/resource, nested code-mode, subtask, and debug-agent execution routes enter through core semantic admission. The generic LLM `ToolRuntime` remains an unexported provider/substrate fixture and is not used by product sessions.
- [x] **Phase 7**: Constitutional tests ported (15 invariant suites: I-01..I-20 / CT-001..CT-008).
- [x] **Phase 8**: The former standalone cognitive-episode fixtures were replaced by normal SessionRunner production-path coverage, including receipt/observation/evidence separation, restart rehydration, Praxis verification, accepted completion, rejected completion, and ordinary provider-stop non-completion.

## 7. Fork Verification Status

- `bun typecheck` in `packages/core`: **PASS (0 errors)**
- `bun typecheck` in `packages/opencode`: **PASS (0 errors)**
- `bun test test/session_runner_architecture.test.ts test/session-runner-tool-registry.test.ts` in `packages/core`: **PASS after adapting substrate assertions**
- `bun test test/session/llm-native.test.ts` in `packages/opencode`: **PASS (16/16)**
- `cargo check --workspace` in `legacy/rivet-rust/`: **PASS (0 errors)**
- `bun test test/session-runner.test.ts --test-name-pattern "normal runner compiles"` in `packages/core`: **PASS; semantic state and Cognitive View rehydrate from the Session aggregate**

## 8. Intentionally rejected OpenCode behavior

- Session transcript as authoritative state $\rightarrow$ Replaced with Noesis event-sourced HardState.
- Direct model tool execution without semantic authorization $\rightarrow$ Replaced with ACCP `AuthorizedAction` gate.
- Implicit task completion on model prose or provider stop $\rightarrow$ Replaced with ACCP `CompletionProposal` gated on Praxis verification.
- Tool results silently promoting to verified facts $\rightarrow$ Replaced with separate `ExecutionReceipt`, `EvidenceRecord`, and `VerificationReceipt` lifecycle.

## 9. Native semantic-ownership correction (active migration record)

The initial port documented above was too permissive: it placed a Rivet gate beside an OpenCode-owned loop. This section is the authoritative migration record for the correction. “OpenCode” below means inherited implementation ownership, not the product identity of this fork.

| Subsystem | Mechanism retained | Former semantic owner | Rivet semantic owner | Contract changed | Old path to delete |
|---|---|---|---|---|---|
| Session/run lifecycle | Durable events, local coordinator, provider streaming | Legacy session prompt / provider loop | `SessionRunner` + `SessionSemantics` | Run state carries Noesis revision, goal, scope and Cognitive View; provider transcript is transport history | Any loop that decides meaning from transcript replay or provider termination |
| Provider invocation | Provider adapters, protocol framing, retry/HTTP transport | Provider request/response shape | Harness invocation boundary | `ModelInvocation` carries a first-class Cognitive View and semantic metadata before provider serialization | Prompt-only Cognitive View injection |
| Tool dispatch | Existing filesystem, process, PTY, plugin and tool mechanisms | Raw provider `ToolCall` / AI SDK execute callback | ACCP commitment admission + `AuthorizedExecution` / `AuthorizedAction` | `ToolRegistry` and `Tool` consume authorized semantic actions; raw calls stop at transport parsing | `ToolCall -> execute`, raw `ExecuteInput`, and boolean pre-gates |
| Execution result | Existing output bounding and result projection | Tool success/result value | `ExecutionReceipt`, then `Observation`, then explicit evidence admission | Execution, observation, evidence and verification are separate typed transitions | Receipt-as-verification or receipt-as-memory shortcuts |
| State and persistence | EventV2 storage and projections | Session transcript as agent memory | Noesis Hard State with Session-owned semantic events | Semantic events replay into revision-bound Hard State; transcript remains compatibility history | Duplicate transcript/Noesis truth |
| Scope/revision | Existing filesystem/location mechanics | Implicit provider/session context | ACCP policy and `Scope`/`Revision` CAS | Authorization fails closed before mechanism execution | Static `repo` / `Revision.ZERO` policy construction |
| Permissions | Mature user consent and capability prompts | Permission service as authority | Rivet semantic authorization, then permission/capability consent | Permission is downstream of `AuthorizedAction` | Permission-only execution paths |
| Verification | Praxis parsers, ledger and 8-gate mechanisms | Tool loop or model assertion | Praxis `VerificationReceipt` bound to obligation, scope and revision | Evidence admission precedes verification; completion consumes valid receipts | Completion from finish reason, prose or drained tools |
| Completion/continuation | Existing loop scheduling and interruption plumbing | Provider finish reason / session idle | Harness `CompletionDecision` and obligation state | Completion is accepted only from a checked proposal; ordinary provider stop is non-authoritative | `finishReason -> completed` and `tool loop ended -> completed` |
| Legacy compatibility path | V1 SessionPrompt and AI SDK provider transport | V1 OpenCode session semantics | Core `SessionSemantics` with the same action contract | V1 tools use the same core admission/execution/receipt path while transport compatibility remains | Any remaining provider/tool route that constructs authority outside `SessionSemantics` |
| Generic LLM tool runtime | Provider schema decoding and stream fixtures | Raw low-level `ToolCall` dispatcher | No product semantic owner; retained only as substrate/test compatibility | Removed from the public LLM barrel; Rivet sessions never import or call it | Move or delete the fixture once downstream substrate examples no longer require it |

Current status: the standalone `HarnessCore` runtime and its sidecar fixtures are deleted. The native V2 registry, V1 SessionPrompt, MCP/resource, nested code-mode, subtask, and debug-agent routes use typed Rivet contracts. Provider transport carries a first-class ModelInvocation, and the normal production-path suites cover restart, Praxis, completion, and non-completion behavior. The only remaining compatibility artifact is the unexported generic LLM tool dispatcher retained for substrate fixtures; it is outside the Rivet product execution graph.

### 9.1 Deleted sidecar test runtime

`packages/core/src/rivet/harness.ts`, `test/rivet/harness.test.ts`, and `test/rivet/e2e_cognitive_episodes.test.ts` were intentionally removed together. Those tests instantiated an independent in-memory semantic runtime and therefore could pass while the normal session runner bypassed Rivet. Their guarantees are not accepted as production evidence. The replacement tests must use `SessionRunner`, `ToolRegistry`, durable Session events and `SessionSemantics.load` so the ordinary product path is the tested Harness.
