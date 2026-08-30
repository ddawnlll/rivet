# Academic literature audit

## ReAct — interleaved reasoning and acting

**Yao et al., 2022/ICLR 2023 — [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)**

<span class="badge established">ESTABLISHED_PRECEDENT</span> ReAct, reasoning traces ve external actions'ı interleaved biçimde üretir. Modern tool-using agent loop'un kavramsal temel precedent'larından biridir.

**Rivet'e transfer:** ReAct'in gücü adaptif environment interaction'dır. Rivet bunun tamamen yanlış olduğunu iddia etmez; yalnızca her observation sonrasında yeni full-model deliberation'ın gerekli olup olmadığını sorgular.

**Discriminating experiment:** Aynı model ve tools ile ReAct-style free loop vs Rivet deterministic transitions.

## ReWOO — reasoning'i observations'dan ayırmak

**Xu et al., 2023 — [ReWOO: Decoupling Reasoning from Observations for Efficient Augmented Language Models](https://arxiv.org/abs/2305.18323)**

ReWOO, tool observation geldikçe bütün reasoning prompt'unu tekrar çalıştırmanın redundant computation yarattığını söyler ve planner/worker/solver separation ile HotpotQA'da 5× token efficiency ve aynı deneyde accuracy artışı raporlar.

**Rivet'e transfer:** repeated model inference'ın doğal ve kaçınılmaz olmadığına güçlü precedent.

**Sınır:** NLP/tool benchmark sonucu repository-level long-horizon software engineering'e otomatik genellenmez.

## StateFlow — process grounding as state machine

**Wu et al., 2024 — [StateFlow: Enhancing LLM Task-Solving through State-Driven Workflows](https://arxiv.org/abs/2403.11322)**

StateFlow complex task solving'i state machine olarak kavramsallaştırır; process grounding'i state/transition'a, subtask solving'i state içi action'lara ayırır. InterCode SQL ve ALFWorld deneylerinde ReAct'e göre daha yüksek success ve 3×–5× daha düşük cost raporlar.

**Novelty threat:** “state-driven agent” Rivet için yeni değildir.

**Rivet fark adayı:** repository-derived capability/evidence/obligation state ve stronger deterministic transition policy.

## LLMCompiler — parallel function-call DAG

**Kim et al., 2023 — [An LLM Compiler for Parallel Function Calling](https://arxiv.org/abs/2312.04511)**

LLMCompiler planner, task fetching unit ve executor ile function calls'u parallelize eder; benchmarklarında ReAct'e karşı 3.7×'e kadar latency speedup ve 6.7×'e kadar cost saving raporlar.

**Novelty threat:** compiler-inspired orchestration ve DAG parallel execution yeni değildir.

**Rivet fark adayı:** DAG'ın büyük bölümünü LLM planner'ın her task için üretmesi yerine persistent repository/task state'ten türetmek.

## Agentless — LLM next-action autonomy'sini kaldırmak

**Xia et al., 2024 — [Agentless: Demystifying LLM-based Software Engineering Agents](https://arxiv.org/abs/2407.01489)**

Agentless localization → repair → patch validation şeklinde üç-phase bir pipeline kullanır ve modelin future actions seçmesine izin vermez. SWE-bench Lite'ta makalenin yayımlandığı dönemde %32 resolve ve ortalama $0.70/problem raporlamıştır.

**Rivet için en önemli precedent'lardan biri:** daha çok agent autonomy'nin otomatik olarak daha iyi olmadığına ampirik örnek.

**Rivet fark adayı:** Agentless pipeline bilinçli biçimde task-specific/sabitken Rivet self-specializing generalist runtime olmayı hedefler.

## SWE-agent — Agent-Computer Interface

**Yang et al., 2024 — [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793)**

SWE-agent, agentın kullandığı interface tasarımının performans üzerinde büyük etkisi olduğunu gösterir; custom ACI ile repository navigation, editing ve test execution'ı model için uygunlaştırır.

**Rivet çıkarımı:** model intelligence sabitken harness/interface değişikliği outcome'u etkileyebilir. Capability design token/reliability araştırmasının meşru bir systems problemi olduğunu destekler.

## CodePlan — repository-level dependency-aware planning

**Bairi et al., 2023 — [CodePlan: Repository-level Coding using LLMs and Planning](https://arxiv.org/abs/2309.12499)**

CodePlan repository-level migration ve broad edits'i planning problemi olarak formüle eder; incremental dependency analysis, change may-impact analysis ve adaptive planning ile multi-file edit chain üretir.

**Novelty threat:** repository dependency graph + change planning yeni değildir.

**Rivet ayrımı:** CodePlan'ın her plan step'inde LLM çağrısı yapması yerine mechanical transition'ları scheduler/capability layer'a taşıma hipotezi.

## RepoGraph — repository-level code graph as plug-in

**Ouyang et al., 2024 — [RepoGraph: Enhancing AI Software Engineering with Repository-level Code Graph](https://arxiv.org/abs/2410.14684)**

RepoGraph repository-level structure'ı plug-in module olarak agent sistemlerine ekler ve SWE-bench/CrossCodeEval'da farklı approaches'a takılabilirliğini test eder.

**Novelty threat:** “repository graph takınca agent daha iyi olur” fikri yeni değildir.

## LocAgent — heterogeneous graph for code localization

**Chen et al., 2025 — [LocAgent: Graph-Guided LLM Agents for Code Localization](https://arxiv.org/abs/2503.09089)**

LocAgent files/classes/functions ve import/invocation/inheritance edges içeren directed heterogeneous graph ile code localization yapar. Makale file-level localization'da yüksek accuracy ve proprietary baselines'a göre yaklaşık %86 cost reduction raporlar.

**Rivet'e transfer:** graph-guided localization context/token maliyetini azaltabilir.

**Sınır:** localization bir end-to-end control plane değildir.

## RIG — deterministic architectural map

**Cherny-Shahar & Yehudai, 2026 — [Repository Intelligence Graph: Deterministic Architectural Map for LLM Code Assistants](https://arxiv.org/abs/2601.10112)**

RIG buildable components, aggregators, runners, tests, external packages ve package managers'ı dependency/coverage edges ile evidence-backed graph'a çevirir. SPADE adlı deterministic extractor'ın current automatic support'u CMake File API/CTest üzerine odaklanır. Claude Code, Cursor ve Codex ile sekiz repository'de RIG context'i mean accuracy'yi %12.2 artırmış, completion time'ı %53.9 azaltmış ve seconds-per-correct-answer'ı %57.8 düşürmüştür; multilingual repos'ta kazanç daha büyük raporlanmıştır.

**Rivet için çok güçlü precedent:** environment/build structure'ı deterministic map'e çıkarmak agent efficiency'yi artırabilir.

**Rivet research gap:** arbitrary build/test ecosystems için general environment compilation ve graph'ın scheduler semantics'e bağlanması.

## Agint — agentic graph compilation

**Chivukula, Somasundaram & Somasundaram, 2025 — [Agint: Agentic Graph Compilation for Software Engineering Agents](https://arxiv.org/abs/2511.19635)**

Agint natural-language instructions'ı typed, effect-aware code DAG'lara incremental/hierarchical biçimde dönüştüren compiler/interpreter/runtime sunar; type floors, locality-preserving graph transformations, hybrid LLM/function execution, rollback ve parallel composition içerir.

Bu Rivet novelty'sine en yakın threat'tir.

Agint makalesinin limitation bölümünde comprehensive SWE-bench gibi established repository-level benchmark evaluation'ının future work olduğunu açıkça belirtmesi önemlidir. Mevcut demonstrations daha çok workflow/code/data pipeline compilation örnekleridir.

**Rivet'in daraltılmış fark iddiası:** natural language → new DAG compilation değil; **existing arbitrary repository → verified execution model compilation** ve bu modelin Noesis/ACCP/Praxis ile persistent control plane olarak kullanılması.

## When2Tool — tool necessity gating

**Sun et al., 2026 — [LLM Agents Already Know When to Call Tools — Even Without Reasoning](https://arxiv.org/abs/2605.09252)**

When2Tool 18 environment üzerinde tool necessity decision boundary'sini inceler; model hidden state'lerinde tool necessity'nin linearly decodable olduğunu raporlar. Probe&Prefill yöntemi tested models'da tool calls'u yaklaşık %48 azaltırken accuracy kaybını yaklaşık %1.7 seviyesinde tutmuştur.

**Novelty threat:** “gereksiz tool çağrısını gate edelim” yeni değildir.

**Rivet difference hypothesis:** Gate model hidden state'ten değil; deterministic resolvability, environment capabilities, Noesis uncertainty, ACCP risk ve Praxis state'inden birlikte türetilir.

## HASSUM — semantic uncertainty-guided orchestration

**Knowlton, Guha & Miikkulainen, 2026 — [Semantic Uncertainty-Guided Orchestration in Hierarchical Multi-Agent Systems](https://arxiv.org/abs/2608.14707)**

HASSUM semantic entropy/density ile verification, reprompting ve additional deliberation'ı adaptif hale getirir.

**Novelty threat:** semantic uncertainty'yi orchestration signal yapmak yeni değildir.

**Rivet position:** uncertainty tek signal değildir; “observable/deterministically resolvable mı?” sorusu daha önce gelir.

## Enrich-Retrieve-Rank — capability discovery at scale

**Sorathiya, Zhang & Akhbari, 2026 — [Enrich-Retrieve-Rank: Scaling Capability Discovery Beyond In-Context Routing](https://arxiv.org/abs/2608.22695)**

7.278 capability'ye kadar registry routing'i inceler. Full-context routing scale ile ciddi bozulurken retrieve-then-rank daha iyi korunur; full scale'de Full-Ctx'e karşı 70× cost reduction ve Search&Pick'e göre daha düşük cost raporlanır.

**Rivet consequence:** Capability Graph'ın tamamını model context'e koymak default tasarım olmamalıdır.

## LEDGER — claim-to-evidence trace graphs

**Kim, Miao & Liu, 2026 — [LEDGER: Claim-to-Evidence Trace Graphs for Auditing LLM Agents](https://arxiv.org/abs/2608.18398)**

LEDGER observed agent sessions üzerinde Trace Records → Evidence Nodes → Workflow Nodes katmanları oluşturur; claims'i actions, artifacts ve checks ile typed edges üzerinden bağlar.

**Novelty threat:** evidence graph/audit lineage tek başına yeni değildir.

**Rivet difference hypothesis:** Evidence graph passive audit artifact olmaktan çıkarak task executability, claim promotion ve completion gate'lerini doğrudan etkiler.

## Gurnee et al. — Verbalizable Representations Form a Global Workspace in Language Models

<span class="badge established">ESTABLISHED_PRECEDENT</span> Gurnee et al. (Transformer Circuits Thread, 6 July 2026) modern LLM'lerde report, directed modulation, internal reasoning, flexible generalization ve selectivity özellikleri gösteren küçük bir “workspace-like” representational subset için mekanistik evidence rapor eder. Çalışma, modelin çok miktarda automatic processing yaparken deliberate reasoning sırasında daha sınırlı ve seçici bir representational set kullandığını; tipik J-space decomposition'ında yaklaşık en fazla 25 güçlü aktif verbalizable vector kullanıldığını inceler. [Transformer Circuits, 2026](https://transformer-circuits.pub/2026/workspace/index.html).

<span class="badge inference">DESIGN_INFERENCE</span> Bu sonuç external agent memory architecture'ını kanıtlamaz. Rivet için yalnız teorik motivasyon sağlar: büyük persistent memory ile küçük active workspace'i ayırmak ve model cognition'ına tüm memory yerine seçici working representation sunmak makul bir engineering hypothesis'tir. Hephaestus bu workspace'in kendisi değildir; normal soft workspace always-available cognition surface, Hephaestus ise rare reframing mechanism'dır.
