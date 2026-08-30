# Decision Register

| ID | Decision | Status | Rationale |
| --- | --- | --- | --- |
| D-001 | Agent/product adı **Rivet**. | PROVISIONAL_DECISION | Teknik, kısa; yeni mitolojik naming yok. |
| D-002 | Noesis, ACCP, Praxis, Hephaestus korunur fakat ayrı ürün/service yapılmaz. | LOCKED_PROJECT_CONTINUITY | Conceptually separate, operationally unified. |
| D-003 | Frontier LLM Rivet'in primary active semantic engine'idir; Rivet persistent agent identity'dir. | CORE_RESEARCH_HYPOTHESIS | v0.2 canonical thesis. |
| D-004 | Generalist project semantics LLM-led induction ile öğrenilir; pre-defined project memory yasak. | CORE_RESEARCH_HYPOTHESIS | Hard-coded project workflows generalist claim'i bozar. |
| D-005 | Capability ile provider ayrıdır; fakat semantic capability layer primary v0.3 experiment değildir. | PROVISIONAL_DECISION | Raw escape hatch first slice'ta korunur. |
| D-006 | Hard State, Soft Workspace ve Context ayrı state classes'dır. | LOCKED_ARCHITECTURAL | Context ≠ memory ≠ active working cognition. |
| D-007 | Token/compute receipts first-class accounting state'tir fakat epistemic evidence ile karıştırılmaz. | PROVISIONAL_DECISION | Efficiency claim ölçülebilir olmalı. |
| D-008 | Rivet kendi Harness Core'una sahiptir; Pi/OpenCode/Rig/DSH host harness değildir. | LOCKED_ARCHITECTURAL | Cognitive lifecycle araştırma nesnesidir. |
| D-009 | Model/provider adapters Rivet-owned `ModelBackend` arkasındadır. | LOCKED_ARCHITECTURAL | Provider-agnostic, harness-owned. |
| D-010 | Raw tool output immutable evidence/artifact ref olarak tutulur; summaries disposable views'dır. | PROVISIONAL_DECISION | Compression truth replacement olmamalı. |
| D-011 | Independent review material changes için context-isolated olabilir. | PROVISIONAL_DECISION | Correlated error azaltma; first slice için şart değil. |
| D-012 | Benchmark-specific core heuristics yasak. | LOCKED_RESEARCH_RULE | Generalization validity. |
| D-013 | Novelty ancak cross-project empirical evidence sonrası iddia edilir. | LOCKED_RESEARCH_RULE | Literature precedents strong. |
| D-014 | Core/runtime implementation language Rust; edition 2024. | LOCKED_FOR_FIRST_SLICE | Typed state machines, memory safety, single binary, predictable systems integration. |
| D-015 | Internal architecture single process + in-memory first; internal IPC yok. | LOCKED_FOR_FIRST_SLICE | Serialization/distributed-state complexity araştırma hipotezine katkı sağlamıyor. |
| D-016 | Tokio async runtime; pure state functions sync kalır. | LOCKED_FOR_FIRST_SLICE | I/O concurrency without contaminating deterministic state logic. |
| D-017 | Zero-copy hedefi “no unnecessary copy/serialization” olarak uygulanır, dogma değildir. | PROVISIONAL_DECISION | Correctness/schema evolution lifetimes optimization'dan üstündür. |
| D-018 | Noesis Hard State event-sourced; current state rebuildable materialization'dır. | LOCKED_ARCHITECTURAL | Audit, rollback, invalidation, replay. |
| D-019 | First embedded store `redb`; `HardStateStore` trait backend independence sağlar. | PROVISIONAL_DECISION | Pure Rust + ACID/MVCC/crash-safety; relational query ergonomics later benchmark edilir. |
| D-020 | Soft Workspace RAM-first ve bounded. | LOCKED_FOR_FIRST_SLICE | Transient cognition'ı persistent truth'tan ayırır. |
| D-021 | First model adapter `genai`; Rig agent loop core'a alınmaz. | PROVISIONAL_DECISION | Provider plumbing reuse, agent semantics ownership korunur. |
| D-022 | MCP yalnız external capability boundary'de `rmcp` ile desteklenir. | LOCKED_FOR_FIRST_SLICE | Internal subsystem bus değildir. |
| D-023 | First UI CLI/TUI: Clap + Ratatui/Crossterm. | LOCKED_FOR_FIRST_SLICE | Chat-only UX en düşük infrastructure cost ile test edilir. |
| D-024 | Desktop UI kararı ertelendi: Tauri vs egui/eframe production UX evidence sonrası. | DEFERRED | UI framework cognitive architecture'ı sürüklememeli. |
| D-025 | `gix` preferred Rust Git substrate; unsupported porcelain için explicit Git CLI fallback izinli. | PROVISIONAL_DECISION | Purity uğruna Git semantics yeniden yazılmaz. |
| D-026 | Praxis verification receipt üretir; Noesis claim truth'u doğrudan mutate etmez. | LOCKED_ARCHITECTURAL | Verification result ≠ epistemic scope interpretation. |
| D-027 | ACCP internal hot-path wire protocol değildir; typed Rust authority/promotion API'sidir. | LOCKED_ARCHITECTURAL | Canonical YAML audit/interchange olarak kalabilir. |
| D-028 | Hephaestus cold-path `FrameProposal` üretir; normal workspace/scheduler değildir. | LOCKED_ARCHITECTURAL | Normal cognition Soft Workspace + LLM'de. |
| D-029 | Structured actions Rivet ontology'sidir; provider function calling yalnız transport. | LOCKED_ARCHITECTURAL | Provider tool semantics core'a sızmaz. |
| D-030 | First vertical slice restart continuity testini geçmeden multi-agent/concurrency yatırımına geçmez. | LOCKED_RESEARCH_RULE | Önce state thesis. |
