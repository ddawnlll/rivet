# Source Map and Reading List

This list is not a bibliography-as-decoration. Each source corresponds to a specific architectural precedent, constraint or evaluation idea. Rivet-specific advantage claims remain unproven until experiments run.

## Agent loops, planning and model-call efficiency

1. **Yao et al. — ReAct: Synergizing Reasoning and Acting in Language Models.** [arXiv:2210.03629](https://arxiv.org/abs/2210.03629) — canonical interleaved reasoning/action/observation baseline.
2. **Xu et al. — ReWOO: Decoupling Reasoning from Observations for Efficient Augmented Language Models.** [arXiv:2305.18323](https://arxiv.org/abs/2305.18323) — observation-decoupling and token-efficiency precedent.
3. **Wu et al. — StateFlow: Enhancing LLM Task-Solving through State-Driven Workflows.** [arXiv:2403.11322](https://arxiv.org/abs/2403.11322) — state-driven process orchestration.
4. **Kim et al. — An LLM Compiler for Parallel Function Calling.** [arXiv:2312.04511](https://arxiv.org/abs/2312.04511) — DAG/tool parallelization and latency/cost reductions.
5. **Xia et al. — Agentless: Demystifying LLM-based Software Engineering Agents.** [arXiv:2407.01489](https://arxiv.org/abs/2407.01489) — fixed localization/repair/validation pipeline as strong non-agentic baseline.
6. **Sun et al. — LLM Agents Already Know When to Call Tools — Even Without Reasoning (When2Tool).** [arXiv:2605.09252](https://arxiv.org/abs/2605.09252) — explicit tool-use gating precedent.
7. **Knowlton et al. — Semantic Uncertainty-Guided Orchestration in Hierarchical Multi-Agent Systems.** [arXiv:2608.14707](https://arxiv.org/abs/2608.14707) — uncertainty-guided orchestration precedent.
8. **Sorathiya et al. — Enrich-Retrieve-Rank: Scaling Capability Discovery Beyond In-Context Routing.** [arXiv:2608.22695](https://arxiv.org/abs/2608.22695) — large capability registry retrieval/routing.
9. **Gurnee et al. — Verbalizable Representations Form a Global Workspace in Language Models.** [Transformer Circuits Thread, 6 Jul 2026](https://transformer-circuits.pub/2026/workspace/index.html) — mechanistic evidence for a selective, limited-capacity workspace-like representational subset in modern LLMs; used only as motivation for hard-memory/soft-workspace separation, not as validation of Rivet.

## Software-engineering agents and repository representations

1. **Yang et al. — SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering.** [arXiv:2405.15793](https://arxiv.org/abs/2405.15793) — importance of interface/tool design.
2. **Bairi et al. — CodePlan: Repository-level Coding using LLMs and Planning.** [arXiv:2309.12499](https://arxiv.org/abs/2309.12499) — dependency/change-impact planning.
3. **Ouyang et al. — RepoGraph: Enhancing AI Software Engineering with Repository-level Code Graph.** [arXiv:2410.14684](https://arxiv.org/abs/2410.14684) — repository graph plug-in precedent.
4. **Chen et al. — LocAgent: Graph-Guided LLM Agents for Code Localization.** [arXiv:2503.09089](https://arxiv.org/abs/2503.09089) — heterogeneous repository graph and graph-guided localization.
5. **Cherny-Shahar & Yehudai — Repository Intelligence Graph.** [arXiv:2601.10112](https://arxiv.org/abs/2601.10112) — deterministic evidence-backed build/test architectural map.
6. **Chivukula, Somasundaram & Somasundaram — Agint: Agentic Graph Compilation for Software Engineering Agents.** [arXiv:2511.19635](https://arxiv.org/abs/2511.19635) — strongest compiler/runtime novelty precedent.
7. **Kim, Miao & Liu — LEDGER: Claim-to-Evidence Trace Graphs for Auditing LLM Agents.** [arXiv:2608.18398](https://arxiv.org/abs/2608.18398) — evidence-centered trace graph precedent.

## Benchmarks and evaluation validity

1. **Jimenez et al. — SWE-bench.** [arXiv:2310.06770](https://arxiv.org/abs/2310.06770)
2. **Zan et al. — Multi-SWE-bench.** [arXiv:2504.02605](https://arxiv.org/abs/2504.02605)
3. **Rashid et al. — SWE-PolyBench.** [arXiv:2504.08703](https://arxiv.org/abs/2504.08703)
4. **Badertdinov et al. — SWE-rebench V2.** [arXiv:2602.23866](https://arxiv.org/abs/2602.23866)
5. **Zhang et al. — SWE-bench Live.** [arXiv:2505.23419](https://arxiv.org/abs/2505.23419)
6. **Xu et al. — SWE-bench Science.** [arXiv:2608.19799](https://arxiv.org/abs/2608.19799)
7. **SWE-Bench+ quality audit.** [arXiv:2410.06992](https://arxiv.org/abs/2410.06992) — reminder that benchmark tests/instances themselves require audit.

## Production and industry precedents

1. **Jarred Sumner — Rewriting Bun in Rust.** [Bun Blog, 8 July 2026](https://bun.com/blog/bun-in-rust) — 535,496 Zig LOC; ~50 dynamic workflows over 11 days; artifactized porting rules/lifetimes; adversarial review; compiler/test/CI work queues; process-level workflow repair; enormous token use. This is a production case study, not a controlled Rivet experiment.
2. **OpenAI — Unrolling the Codex agent loop.** [Engineering, 23 Jan 2026](https://openai.com/index/unrolling-the-codex-agent-loop/) — explicit model↔tool loop, growing history, prompt caching and compaction.
3. **Vercel — Introducing the Vercel plugin for coding agents.** [17 Mar 2026](https://vercel.com/changelog/introducing-vercel-plugin-for-coding-agents) — relational platform knowledge graph, project profiler, ranked/deduplicated/budgeted context injection and PostToolUse validation.
4. **Vercel Labs — Zerolang.** [GitHub](https://github.com/vercel-labs/zerolang) — graph-native experimental language/program database; checked structural edits.
5. **DeepSeek Harness.** [Developer Preview](https://www.deepseek.com/harness/en/) — composable plugin runtime; loops/scheduling/storage/UI are plugins; append-only trace stream; code mode.
6. **Aider — Repository map.** [Documentation](https://aider.chat/docs/repomap.html) — tree-sitter symbols + graph ranking under token budget.
7. **Serena.** [GitHub](https://github.com/oraios/serena) — semantic code retrieval/editing over language servers/IDE infrastructure.
8. **Anthropic — Claude Code auto mode.** [Engineering, 25 Mar 2026](https://www.anthropic.com/engineering/claude-code-auto-mode) — two-stage gating, cheap filter before expensive reasoning; useful control-plane precedent.
9. **Anthropic — How we contain Claude across products.** [Engineering, 25 May 2026](https://www.anthropic.com/engineering/how-we-contain-claude) — sandboxing, least blast radius and project/external-content trust lessons.
10. **Pi coding agent documentation / source.** [pi-mono](https://github.com/badlogic/pi-mono) — minimal shell/extension substrate considered for first Rivet adapter.

## v0.3 technical substrate references

- **Tokio.** [Official tutorial](https://tokio.rs/tokio/tutorial) — asynchronous Rust runtime used for network/process/model streaming boundaries.
- **Ratatui.** [Official site](https://ratatui.rs/) — Rust TUI substrate for the first chat surface.
- **redb.** [GitHub](https://github.com/cberner/redb) — pure-Rust embedded ACID/MVCC store, first HardStateStore candidate.
- **rust-genai.** [GitHub](https://github.com/jeremychone/rust-genai) — multiprovider model client; used only behind Rivet-owned ModelBackend.
- **Rig.** [GitHub](https://github.com/0xPlaygrounds/rig) — Rust LLM/agent framework studied as precedent/optional adapter; its AgentRunner does not own Rivet lifecycle.
- **gitoxide / gix.** [GitHub](https://github.com/GitoxideLabs/gitoxide) — pure-Rust Git implementation for repository plumbing/observations.
- **Rust MCP SDK / rmcp.** [Official SDK](https://github.com/modelcontextprotocol/rust-sdk) — external MCP compatibility boundary.
- **Tauri architecture.** [Official docs](https://v2.tauri.app/concept/architecture/) — later desktop candidate; WebView/message-passing process model is intentionally not part of first single-process TUI slice.
- **egui / eframe.** [Docs.rs](https://docs.rs/eframe/latest/eframe/) — pure-Rust native/web GUI candidate retained for later comparison.
