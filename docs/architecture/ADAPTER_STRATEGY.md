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
