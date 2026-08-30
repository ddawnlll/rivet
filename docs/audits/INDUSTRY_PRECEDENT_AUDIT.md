# Industry precedent audit

Bu bölüm “kim bizi kopyaladı?” veya “biz kime benziyoruz?” bölümü değildir. Amaç, hangi fikirlerin **zaten mevcut olduğunu** açıkça ayırıp Rivet novelty'sini yanlış yerde aramamaktır.

## OpenAI Codex: klasik agent loop'un açık örneği

OpenAI'nin Ocak 2026 tarihli [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) yazısı, Codex harness'ının user → model inference → tool calls → tool results → tekrar inference akışını ayrıntılı biçimde açıklar. Konuşma history'si büyüdükçe prompt da büyür; Codex context threshold aşılınca compaction uygular ve prompt cache hit'lerini önemser.

**Rivet açısından:** Codex'in iyi context engineering'i klasik loop paradigmasının gelişmiş bir örneğidir. Rivet'in hipotezi compaction'ı biraz daha iyi yapmak değil; bazı tool-result → next-action transitions'ında model inference'ın kendisinin gereksiz olabileceğidir.

## Claude Code: hooks, subagents, plugins, skills

Anthropic'in 2026 [Advanced Patterns](https://www.anthropic.com/webinars/claude-code-advanced-patterns) materyalleri subagent, hook ve MCP ile multi-step orchestration, parallel work ve guardrail kurmayı anlatır. Claude Agent SDK/Claude Code ayrıca checkpointing, background tasks, hooks ve subagents ile uzun-running autonomy sağlar.

**Rivet açısından:** plugin/hook/worker fikri yeni değildir. Fark iddiası “plugin var” değil; control-plane decision'ın modelden explicit task/capability/evidence state'e taşınmasıdır.

## Vercel plugin: knowledge graph + contextual injection

Vercel'in Mart 2026 [coding-agent plugin](https://vercel.com/changelog/introducing-vercel-plugin-for-coding-agents) sistemi 47+ skill'i relational platform knowledge graph ile sunar; real-time file edits/terminal activity'ye göre context inject eder; injection engine context'i rank/deduplicate/budget-control eder; PostToolUse validation ile stale/deprecated patterns yakalar.

**Rivet açısından:** dynamic context injection, project profiling, graph-backed knowledge ve post-tool validation zaten production precedent’ıdır. Rivet bunları novelty olarak sahiplenemez. Potansiyel fark v0.2’de daha dar tanımlanır: persistent hard epistemic state ile task-scoped soft workspace’i ayırmak, bu state’i task-conditioned Cognitive View olarak modele derlemek ve project semantics’i pre-defined memory yerine LLM-led induction ile öğrenmek.

## Vercel Zerolang: graph-native program database

[Vercel Labs Zerolang](https://github.com/vercel-labs/zerolang) deneysel graph-native bir programming language'dir; semantic graph program database'dir, agent graph'ı query eder, checked edits submit eder ve sonucu kanıtlamaya çalışır.

**Rivet açısından yakınlık:** stable semantic node identity, checked edits, graph-native agent interface.

**Fark:** Zero programın kendisini graph-native representation yapar. Rivet arbitrary existing Rust/Python/TS/C++ repository'yi değiştirmeden **derived semantic/project graph** üretmeyi hedefler. Bu fark ampirik olarak değerli olmayabilir; benchmark gerekir.

## Pi: minimal harness + extensions + compaction

Pi'nin güncel dokümantasyonu core'u minimal tutup TypeScript extensions üzerinden custom tools, lifecycle interception, UI, session persistence ve custom compaction eklenmesine izin verir. Compaction old context'i structured summary'ye indirger; tool output serialization'ı da sınırlanır.

Kaynaklar: [Pi extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md), [Pi compaction](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md).

**Rivet implementasyon kararı:** Pi iyi bir ilk adapter/prototyping shell olabilir. Fakat Rivet Core Pi'nin loop'una gömülürse control-plane bağımsızlığı kaybolur. Core ayrı crate/package olmalı; Pi adapter bir front-end/host olmalıdır.

## DeepSeek Harness: swappable loop / everything is a plugin

DeepSeek Harness'ın Ağustos 2026 developer preview'i model, tools, skills, sessions, sandboxes, storage, loops, scheduling ve UI dahil her capability'yi plugin olarak sunar; core dokümanı agent-loop'un swappable tutulduğunu açıkça belirtir.

Kaynaklar: [DeepSeek Harness](https://www.deepseek.com/harness/en/), [Core subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md).

**Rivet açısından:** Production substrate adayı olarak Pi'den daha uygun olabilir çünkü loop itself swappable. Ancak developer preview ve breaking changes riski nedeniyle Rivet Core'un DSH internals'a bağlanması anayasal olarak yanlış olur.

## Aider: repo map ve token-budgeted context

[Aider repository map](https://aider.chat/docs/repomap.html), tree-sitter ile definitions/references çıkarır ve file dependency graph üzerinde ranking yaparak token budget'a sığan en önemli repository context'ini modele verir. Default map budget dokümanda 1k token olarak açıklanır.

**Rivet açısından:** repository context'i sıkıştırma, graph ranking ve relevance selection yeni değildir. Rivet'in farkı repo map'i model prompt'undan bağımsız persistent project state / scheduler input olarak da kullanabilmektir.

## Serena: semantic capability layer

[Serena](https://github.com/oraios/serena) LSP veya JetBrains analysis kullanarak `find_symbol`, references, hierarchy, semantic edits, rename/move/safe delete gibi agent-first capabilities sağlar. Kendi 2026 evaluation dokümanları token efficiency'nin operation shape'e göre değiştiğini; tiny known-location edits'te primitive patch'in, cross-file semantic refactorlarda Serena'nın daha avantajlı olabildiğini gösterir.

**Rivet açısından:** Serena doğrudan `CapabilityProvider` olabilir. Rivet “semantic editing'i icat ettik” diyemez; önemli olan provider seçimini cost/reliability/operation semantics'e bağlamaktır.
