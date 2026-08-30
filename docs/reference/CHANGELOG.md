# Changelog

## 2026-08-30 — Research Monograph v0.3

**Technical implementation pass; v0.2 body retained.** v0.3 does not replace the epistemic thesis or delete independent research material. It adds the implementation profile required to begin coding and aligns only the previously provisional implementation/adapter decisions with the now-canonical harness-owned architecture.

- Defined Rivet as a self-contained agentic software-development system with its own Harness Core; clarified provider/model/frontend agnosticism without claiming harness agnosticism.
- Locked first-slice implementation to Rust 2024, Tokio, single process, in-memory-first operation and no internal IPC.
- Added zero-copy/no-unnecessary-serialization policy with explicit limits against premature lifetime/serialization complexity.
- Specified canonical cognitive-cycle state machine, cancellation, typed cognitive actions and Rivet-owned `ModelBackend`.
- Specified Noesis physical architecture: durable event ledger, rebuildable materialized Hard State, bounded RAM Soft Workspace, revision/invalidation engine and Cognitive View projection.
- Selected `redb` as provisional first embedded HardStateStore backend while retaining a Rivet-owned store trait and backend replay compatibility.
- Selected `genai` as provisional first multiprovider model adapter; Rig/OpenCode/Pi/DeepSeek Harness are reference/compatibility surfaces, not lifecycle owners or forks.
- Selected Ratatui/Crossterm CLI/TUI as first chat surface; Tauri vs egui/eframe deferred until product UX requires a desktop surface.
- Added repository runtime contract, gix/Git fallback policy, external-only MCP boundary, and runtime contracts for Praxis, ACCP and Hephaestus.
- Replaced the old implementation layout, adapter strategy and decision register with v0.3-consistent technical decisions.
- Added testing/replay/crash-recovery strategy and a concrete 48-hour first vertical-slice plan.
- No Bun case study, literature/novelty audit, Praxis ladder, ACCP governance, security, metrics, invariant table, state hypothesis or v0.2 falsification material was removed.

## 2026-08-29 — Research Monograph v0.2

**Conflict-resolution pass:** removed duplicate experimental ladders; canonicalized E0–E5 as the only primary state ladder; collapsed Environment Compiler phases into deterministic census + targeted probe; rewrote residual v0.1 “deterministic runtime owns cognition / model only at uncertainty boundaries” claims in contribution, failure, invariant and lineage sections. No independent Bun/literature/Praxis/ACCP/security/metrics material was removed.

- Preserved the v0.1 monograph body and literature/benchmark/security/concurrency material; revised the central thesis rather than replacing the document.
- Reframed the frontier LLM as Rivet's primary active semantic controller while keeping Rivet as the persistent agent identity.
- Added Noesis Hard State / Soft Workspace separation, state promotion, invalidation and epistemic-ossification risk.
- Added Cognitive View Compiler and representation ablation (raw text vs triples vs graph paths vs hybrid view).
- Reframed Environment Compiler as LLM-led Adaptive Project Induction with hierarchical repository relevance and `DEFER ≠ IRRELEVANT`.
- Demoted minimum model invocation from central doctrine to secondary cognitive-economy experiment.
- Clarified Praxis as bounded mechanical verification and ACCP as evidence/promotion/action authority governance.
- Separated normal Soft Workspace from Hephaestus cold-path reframing; added Global Workspace literature as motivation only.
- Added chat-only interaction decision, V8 flagship evaluation without a V8 fork, alien-project controls and greenfield symmetry.
- Reordered the experimental ladder around state architecture before semantic capabilities, invocation economy, concurrency and multi-agent scale.

## 2026-08-27 — Research Monograph v0.1

- Rivet upper-level identity consolidated.
- Existing Noesis / ACCP / Praxis / Hephaestus architecture preserved.
- Persistent deterministic Harness Core made explicit.
- Environment Compiler and verified Capability Graph formalized.
- Artifact → Observation → Task compilation added.
- Model Invocation Gate and token/compute receipts specified.
- Generalist specialization rule added: specialization is learned state, not baked-in control flow.
- Bun Rust rewrite incorporated as production case study with strict epistemic limits.
- Academic novelty audit expanded across ReWOO, StateFlow, LLMCompiler, Agentless, CodePlan, RepoGraph, LocAgent, RIG, Agint, When2Tool, HASSUM, Enrich-Retrieve-Rank and LEDGER.
- Cross-language benchmark ladder and falsification criteria added.
- New components constrained to descriptive engineering names; no new mythological naming layer.
