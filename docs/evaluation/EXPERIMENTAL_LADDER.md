# Experimental Ladder

v0.2'nin deney sırası architecture büyüklüğünü değil **state hypothesis'in incremental contribution'ını** izole eder. Aynı model, aynı base prompt family, aynı execution capabilities, aynı sandbox ve aynı verification standardı korunur.

## E0 — Context-Centric Baseline

Minimal OpenCode/Pi/mini-SWE-agent benzeri loop. Persistent epistemic hard state veya explicit soft workspace yok. Record: verified success, model calls, uncached/cached tokens, repeated reads, repeated error, wall-clock.

## E1 — Noesis Hard State Only

Session'lar arası evidence-bound durable project state eklenir; model-facing representation mümkün olduğunca basit tutulur.

**Question:** repeated discovery ve rejected-error resurrection azalıyor mu?

## E2 — Hard State + Soft Workspace

Task/session-scoped bounded hypotheses/focus/unknowns eklenir.

**Question:** long-horizon consistency ve repair iterations iyileşiyor mu; workspace bloat oluşuyor mu?

## E3 — Cognitive View Compiler

Raw retrieval yerine task-conditioned hybrid semantic+typed projection kullanılır. Raw text/triples/graph-path/hybrid ablation aynı underlying memory ile çalışır.

**Question:** next-action accuracy, contradiction recall ve token efficiency iyileşiyor mu?

## E4 — Hierarchical Repository Relevance

Flat/full indexing yerine directory census → LLM relevance → selective descent kullanılır.

**Question:** inspected bytes/files/token azalırken localization/verified success korunuyor mu?

## E5 — Promotion + Invalidation

Soft→hard admission, source revision, stale/superseded/reopened semantics ve no-self-confirming-memory invariant devreye girer.

**Question:** persistent unsupported belief ve stale-state error rate düşüyor mu?

## Experiment rule

E0–E5 v0.2’nin tek primary experimental ladder’ıdır. Her basamak yalnız immediately simpler baseline’a karşı admission alır. +2–3 percentage-point verified success, aynı success altında meaningful repeated-read/token azalması veya repeated-error suppression başlangıç sinyali sayılabilir. Praxis/ACCP integration, semantic capability abstraction, invocation economy, Hephaestus ve parallel/multi-agent orchestration bu ladder’ın sonucu pozitifleşmeden primary experiment değildir; ilgili mimari bölümler future-work rationale olarak korunur.
