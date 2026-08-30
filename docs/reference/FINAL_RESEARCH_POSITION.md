# Final Research Position

Rivet v0.2'nin en güçlü tezi “LLM'ler gereksiz” veya “deterministik sistem modelden daha zekidir” değildir. Tam tersine, frontier LLM bugün generalist software engineering için sahip olduğumuz ana semantic motor olarak kabul edilir. Araştırılan problem, bu motorun **persistent project reality üzerinde güvenilir biçimde nasıl çalıştırılacağıdır.**

> **Frontier models are powerful enough to drive general software-engineering cognition, but too transient and non-authoritative to be the sole repository of project memory, evidence status, execution authority and completion truth.**

Rivet bu iddiayı şu division of labor ile test eder:

```text
LLM reasons, explores, hypothesizes and acts.

NOESIS preserves epistemic state:
  hard reality + soft working cognition.

COGNITIVE VIEW COMPILER decides what state
becomes current reasoning material.

PROJECT INDUCTION lets the LLM learn unseen repositories
without pre-defined project memory.

ACCP governs admission and authority.
PRAXIS verifies bounded predicates.
HEPHAESTUS reframes only when normal cognition is stuck.

CHAT exposes the agent; chat is not the agent.
```

Deterministic code remains crucial where behavior can be specified and tested: revision checks, parsers, hashes, permission gates, test execution, ledger/state transactions, dependency invalidation and other mechanical transitions. Fakat determinism generalist semantic cognition'ın yerine geçirilmez. **Deterministic ≠ true; deterministic means testable/reproducible under a contract.**

v0.2'nin ilk bilimsel hedefi küçük tutulur. Hard State + Soft Workspace + Cognitive View + Hierarchical Relevance aynı frontier model altında hiçbir measurable advantage üretmezse Rivet'in daha büyük scheduler/protocol/multi-agent vizyonu için maddi gerekçe zayıflar. Eğer yalnız birkaç puan success, aynı success altında meaningful compute reduction veya repeated-error suppression görülürse bir sonraki yatırım promotion/invalidation ve Praxis/ACCP entegrasyonudur.

V8 flagship evaluation project'idir fakat Rivet fork'u değildir. Rivet Core V8'i, trading'i veya V8 authority classes'ını bilmemelidir. Başarı, bunları repository'den öğrenip bir hafta sonra bile doğru task-conditioned state olarak kullanabilmesidir; aynı abstraction'ların alien projects ve greenfield development'a transferi generalist iddianın şartıdır.

The project remains a falsification program. v0.2 first tests whether externalized epistemic state and model-facing representation improve a frontier model’s long-horizon behavior. Promotion/verification follows if that signal is real. Model-sparse scheduling, semantic capability abstraction, concurrency and multi-agent scale are optional later optimizations, not part of the thesis that must be true.

**v0.3 implementation position.** Bu epistemik tez artık belirli bir first-slice systems profile ile uygulanacaktır: Rivet-owned Harness Core, Rust 2024, Tokio I/O runtime, single-process/no-internal-IPC architecture, event-sourced Noesis Hard State, RAM-first bounded Soft Workspace, embedded Rust persistence, Rivet-owned model contracts, CLI/TUI first surface ve external MCP/provider adapters. Bu teknik seçimler research claims değildir; amaç bağımsız değişken olan state/cognitive-view architecture'ını en az infrastructure confound ile test etmektir.
