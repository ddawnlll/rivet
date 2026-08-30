# Novelty Audit: What Rivet Must Not Claim

Rivet'in araştırma anlatısı ancak mevcut literatürün sınırlarını dürüstçe tanırsa değerlidir. Aşağıdaki ifadeler **yasak novelty claim** olarak ele alınmalıdır; her birinin güçlü bir precedenti vardır.

| Yasak / zayıf claim | Precedent | Neden yetersiz? |
| --- | --- | --- |
| “İlk graph-based coding agent” | RepoGraph, LocAgent, Agint, Zerolang | Graph representation ve graph-guided agents zaten mevcut. |
| “İlk compiler-inspired agent” | LLMCompiler, Agint | Planning/tool workflows'u compiler/DAG formuna çeviren sistemler var. |
| “İlk stateful agent runtime” | StateFlow, durable workflow systems | Explicit process state yeni değil. |
| “İlk deterministic + LLM hybrid” | Agentless, StateFlow, Agint | Hybrid orchestration önceden gösterildi. |
| “İlk repository graph” | RepoGraph, RIG, LocAgent | Repository structure graph literatürü güçlü. |
| “İlk evidence/provenance graph” | LEDGER ve provenance literatürü | Claim-to-evidence lineage yeni değil. |
| “İlk uncertainty routing” | HASSUM, selective reasoning/tool-use work | Uncertainty as orchestration signal mevcut. |
| “İlk tool-call gating” | When2Tool | Tool necessity gating açık precedent. |
| “İlk token-efficient agent” | ReWOO, StateFlow, LLMCompiler, Agentless | Maliyet azaltma literatürü geniş. |
| “İlk semantic code operations” | LSP tabanlı IDE'ler, Serena, Zerolang | Symbol-native editing yeni değil. |

## Defensible contribution hypothesis

Rivet'in savunulabilir katkısı ancak aşağıdaki **bileşik ve falsifiable** iddiaya indirgenmelidir:

> **Rivet is a repository-general software-engineering agent runtime that keeps a frontier LLM as the primary active semantic controller while externalizing durable epistemic state, bounded working state, evidence, verification and authority; it learns project structure through LLM-led adaptive induction and compiles task-relevant state into cognitive views rather than treating chat history or raw retrieval as memory.**

Bu ifade de henüz bir başarı iddiası değildir. Bir araştırma hipotezidir.

## Necessary empirical burden

Bu hipotezin kabulü için en az şu üç sonuç birlikte gereklidir:

1. **State value:** Hard State + Soft Workspace must improve long-horizon continuity, repeated-error behavior, or verified success versus an equivalent context-centric baseline.
2. **Representation value:** Cognitive View must outperform or meaningfully reduce cost versus raw-text retrieval without increasing wrong-projection failures.
3. **Generalization:** Hierarchical relevance and adaptive induction must transfer across heterogeneous repositories without project-specific core branches; V8 alone is insufficient.

Bunlardan yalnızca biri sağlanırsa Rivet'in daha dar bir katkısı olabilir; “yeni agent paradigması” iddiası yapılamaz.
