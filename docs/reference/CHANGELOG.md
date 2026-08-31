# Changelog

## 2026-09-01 — Production Stack Hardening & Subsystem Consolidation

**Architectural hardening pass:** Replaced ad-hoc in-house implementations across 13 subsystems with 2026 production-grade Rust ecosystem standards, eliminating silent failure modes, security bypasses, and data corruption vectors without weakening constitutional invariants (I-01..I-20):

- **Filesystem Capability & Confinement (D-031):** Migrated from ad-hoc `canonicalize + starts_with` path checking to capability-oriented `cap-std::fs::Dir`, eliminating path traversal and symlink TOCTOU races at the kernel boundary.
- **Multi-layer Linux Execution Sandbox (D-032):** Established the `landlock` (fs rights) + `seccompiler` (syscall filtering) + `rlimit` (resource governance) triad, re-classifying substring blacklists as upper-level `CommandPolicy`.
- **Windows Process Containment (D-033):** Replaced manual Win32 extern FFI with Microsoft's official `windows` crate (`Win32_System_JobObjects`), guaranteeing cleanup of child process trees.
- **Universal Multi-language AST (D-034):** Replaced string split heuristics with `tree-sitter` (`tree-sitter-rust`, `tree-sitter-python`, `tree-sitter-typescript`, `tree-sitter-go`) for robust Concrete Syntax Tree extraction.
- **Two-tier Code Intelligence (D-035):** Separated local structural edits (Tree-sitter byte range replacement + `similar` diff rendering) from cross-file semantic refactoring (`async-lsp`).
- **Deterministic Census & Nested Ignore (D-036):** Adopted `ignore::WalkBuilder` for multi-level `.gitignore`/`.ignore` handling and `globset` for policy matching, preventing accidental secret leakage.
- **Pure-Rust Git Substrate (D-037):** Standardized on `gix` (Gitoxide) for repository discovery, packed-refs, and config trust models with CLI porcelain fallback.
- **Cryptographic Transparency Receipts (D-038):** Hardened Merkle tree generation using `rs_merkle` with custom RFC 6962 domain-separated hashing (`0x00` leaf, `0x01` node) and `tree_size` commitment, preventing CVE-2012-2459 root collision flaws.
- **Structured Test Ingestion (D-039):** Replaced human stdout regex parsing with `junit-parser` + `cargo-nextest` ingestion; restricted `strip-ansi-escapes` to telemetry display only.
- **Official Model Context Protocol (D-040):** Adopted the official `rmcp` 3.x Rust SDK for bidirectional async notifications and streaming tool execution.
- **Multi-line SSE Framing (D-041):** Integrated `eventsource-stream` for robust SSE framing without reconnect loops.
- **Credential Storage & Memory Safety (D-042):** Introduced `CredentialStore` trait backed by OS `keyring`, `secrecy` (`SecretString`), and `zeroize` memory clearing.
- **Panic-free YAML Serialization (D-043):** Adopted `serde-saphyr` for fuzz-tested, panic-free YAML output in Cognitive View compilation.

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
