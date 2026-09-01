# Adapter Strategy

v0.3'te “adapter-first” artık host-agent adapter anlamına gelmez. Rivet self-contained agent system olduğu için adapter'lar **replaceable substrate boundaries** içindir: model providers, external capabilities, persistence ve frontend. Başka bir coding-agent harness Rivet'in control plane'i değildir.

## Pi / OpenCode / agent-shell compatibility

Pi, OpenCode ve benzeri coding agents reference implementations veya interoperability targets olabilir. İlk implementation bunların session loop'unu host olarak kullanmaz. Eğer daha sonra compatibility istenirse iki güvenli biçim vardır:

- Rivet'i external tool/server gibi çağıran thin compatibility layer;
- host'un UI/provider plumbing'ini kullanan fakat Rivet Harness Core lifecycle'ını authoritative tutan explicit bridge.

“Host agent decides next step, Rivet memory supplies context” modeli Rivet değildir; bu yalnız Noesis benzeri memory plugin olur.

## Rig / DeepSeek Harness / agent framework policy

Rust tarafında Rig güçlü agent/runtime abstractions sunar; 2026 releases agent loop, hooks, tool execution ve `AgentRunner` lifecycle'ını giderek daha fazla merkezileştirmiştir. Bu tam da Rivet'in kendi araştırdığı layer olduğu için Rig core dependency veya fork yapılmaz. Rig adapter ancak şu şartlarla kabul edilir:

- Rivet `ModelBackend` ve cognitive lifecycle contracts değişmez;
- Rig memory/session state authoritative olmaz;
- tool result → Noesis/Praxis semantics Rivet'te kalır;
- Rig dependency kaldırıldığında hard-state compatibility bozulmaz.

DeepSeek Harness ve diğer plugin runtimes için aynı kural geçerlidir. Framework composability ilham verebilir; product identity veya lifecycle ownership devredilmez.

## Why not fork first

Fork-first riski yalnız language mismatch değildir. Daha derin problem **ontological inheritance**'tır: host framework'ün Agent, Session, Memory, ToolCall ve Completion kavramları core'a sızar. Rivet'in araştırma konusu tam olarak bu kavramların yeniden ayrılmasıdır. Bu nedenle:

```text
DO NOT FORK THE COGNITIVE LIFECYCLE.

Reuse:
  HTTP
  provider protocols
  terminal UI
  git/filesystem libraries
  embedded storage
  MCP
  parsers

Own:
  Rivet identity
  Harness Core
  Noesis hard/soft semantics
  Cognitive View
  promotion/invalidation
  authority/verification integration
  completion and continuation
```

## Model adapters

First provider implementation `rivet-model-genai`. Direct adapters yalnız genai normalization bir provider özelliğini kaybediyorsa veya benchmark isolation gerekiyorsa eklenir. Provider selection config/state üzerinden olur; core model names hardcode etmez.

## External capability adapters

Native filesystem/process/git capability'leri first-class'tır. MCP external ecosystem bridge olarak desteklenir. MCP tool schemas core semantic capability ontology'si değildir; external tool result observation'a çevrilir ve raw result evidence ref olarak tutulur.

## Persistence adapters

`HardStateStore` backend abstraction mevcut olmalıdır fakat first slice yalnız bir backend'i production path olarak destekler. Multiple database support uğruna early generic abstraction growth yapılmaz. Backend swap testleri event replay compatibility üzerinden yürür.

## RivetService — UI-agnostic Harness Facade (v0.3 Phase 8)

Frontend'ler replaceable substrate'tır; fakat lifecycle ve epistemic semantics Rivet Harness Core'a aittir. Bu ayrımı somutlaştırmak için `rivet-service` crate'i bir **facade** sağlar:

```text
HarnessCore (owner: lifecycle, revision, Noesis, ACCP, Praxis)
      ↑
RivetService (facade: step, stream_step, initialize_goal, get_state, get_census)
      ↑
┌─────┼─────┐
TUI   Web   Tauri
(in-process) (axum SSE/WS) (tauri::command IPC)
```

*   **RivetService trait:** `step`, `stream_step`, `initialize_goal`, `get_obligations`, `get_census`, `current_phase` ve `UiEvent` broadcast (`AssistantDelta`, `Status`, `AuthorityPrompt`, `VerificationUpdate`, `Completed`).
*   **TUI:** `RivetService`'i in-process `Arc` ile doğrudan çağırır. `tui.rs` içindeki direkt `HarnessCore` erişimleri facade'e taşınır; F1-F5 mode tab yerine chat + projection drawer kullanılır (`INTERACTION_MODEL.md` chat-only uyumu).
*   **Web:** `rivet-api` (`axum`) aynı `RivetService`'i `POST /api/step`, `GET /api/stream` (SSE), `GET /api/state`, `GET /api/census` üzerinden expose eder. Bu, core subsystem'ler arası IPC değildir; single-process local projection'dır.
*   **Tauri:** Aynı `web/dist` (Vite + React + shadcn) build'ini `invoke("step")` ↔ `RivetService::step` ile saran thin shell. Web ve Desktop %100 aynı React codebase.
*   **Chat-only invariant korunur:** `agent ≠ frontend`, `chat = projection of persistent Rivet state`. Drawer'lardaki Obligations/Workspace/Census kartları mode değil, Hard/Soft state'in read-only projection'ıdır; frontend kapanıp açılsa agent identity değişmez.
*   **Display priority (drawer):** Tier 1 her zaman açık — Open Obligations + Verification + Contradictions (Hard State); Tier 2 collapsed — Soft Workspace hypotheses/focus + Cognitive View; Tier 3 on-demand — Recent Evidence/Receipts, Census Frontier, Full HardState explorer. Hard = solid kart, Soft = dashed/soluk.

Bu facade `TECHNICAL_ARCHITECTURE_V03.md`'deki `UiEvent` contract'ını somutlaştırır ve `IMPLEMENTATION.md` Phase 8'in teknik kaynağıdır.
