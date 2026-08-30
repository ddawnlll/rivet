# Implementation Layout

v0.3 implementation tek repository ve tek primary binary ile başlar. Noesis, Praxis, ACCP ve Hephaestus ayrı conceptual modules/crates olabilir; ayrı ürün, daemon veya network service değildir. Crate boundary testability ve dependency direction içindir; process boundary değildir.

```text
rivet/
├── Cargo.toml
├── rust-toolchain.toml
├── crates/
│   ├── rivet/                  # CLI/TUI binary; composition root only
│   ├── rivet-core/             # Harness Core; cognitive/run lifecycle
│   ├── rivet-types/            # tiny shared IDs/contracts; no utils dumping ground
│   ├── rivet-noesis/           # Hard State + Soft Workspace + revision/invalidation
│   ├── rivet-view/             # Cognitive View Compiler and serializers
│   ├── rivet-store/            # HardStateStore; first backend redb
│   ├── rivet-repository/       # census, frontier, artifact identity/read
│   ├── rivet-runtime/          # fs/process/git execution + cancellation
│   ├── rivet-model/            # Rivet-owned ModelBackend contracts
│   ├── rivet-model-genai/      # first multiprovider adapter
│   ├── rivet-accp/             # existing ACCP Rust core integration
│   ├── rivet-praxis/           # existing Praxis Rust verification integration
│   ├── rivet-hephaestus/       # existing cold-path reframing integration
│   └── rivet-mcp/              # rmcp external capability adapter; optional feature
│
├── tests/
│   ├── replay/
│   ├── crash-recovery/
│   ├── fixtures/
│   └── e2e/
│
├── evals/
│   ├── baseline/
│   ├── v8/
│   ├── alien-rust/
│   ├── alien-ts/
│   ├── alien-python/
│   └── greenfield/
│
├── docs/
│   ├── adr/
│   ├── protocol/
│   └── architecture/
│
└── schemas/
    ├── accp/
    └── exported-receipts/
```

## Dependency direction

Crates dependency-cycle yaratmamalıdır. Domain semantics düşük katmanlara sızmaz:

```text
rivet (binary)
                              │
                          rivet-core
                ┌─────────────┼──────────────┐
                ▼             ▼              ▼
          rivet-noesis     rivet-view     rivet-runtime
                │                            │
                ▼                            ▼
           rivet-store                  rivet-repository

        rivet-accp      rivet-praxis      rivet-hephaestus
              ▲               ▲                 ▲
              └──────────── rivet-core ─────────┘

        rivet-model  ← rivet-core contracts
             ▲
             └── rivet-model-genai

        rivet-mcp → rivet-runtime capability adapter only
```

`rivet-types` yalnız genuinely cross-cutting stable IDs/value objects taşır. Helpers, database logic, provider types veya business logic buraya atılmaz. “common crate” semantic landfill'e dönüşürse dependency architecture bozulur.

## Composition root

```rust
pub struct Rivet {
    pub harness: HarnessCore,
}

pub struct HarnessCore {
    model: std::sync::Arc<dyn ModelBackend>,
    noesis: Noesis,
    view: CognitiveViewCompiler,
    authority: Accp,
    praxis: Praxis,
    hephaestus: Hephaestus,
    runtime: Runtime,
    repository: RepositoryRuntime,
}
```

Concrete backends yalnız binary/composition layer'da wire edilir. Core crates `genai`, redb concrete types, Ratatui veya rmcp types'ına doğrudan bağımlı olmak zorunda değildir; adapter crates onları translate eder.

## Data ownership

- **Harness Core** lifecycle ownership taşır, domain state'in fiziksel owner'ı değildir.
- **Noesis** epistemic state transitions ve materialized indexes'in owner'ıdır.
- **Store** durable bytes/transactions owner'ıdır; epistemic meaning bilmez.
- **Repository Runtime** artifact/census observations üretir; importance truth'u yazmaz.
- **Praxis** verification receipts üretir; Noesis claim status'u doğrudan mutate etmez.
- **ACCP** allow/block/require-human decisions üretir; event log'un owner'ı değildir.
- **Hephaestus** frame proposal üretir; task scheduler veya hard-state writer değildir.
- **Model adapter** provider protocol çevirir; agent identity veya persistent memory taşımaz.

## Feature strategy

Optional integration'lar Cargo features ile ayrılabilir, fakat first slice feature explosion yapmaz:

```text
default = ["model-genai", "store-redb", "tui"]
optional:
  mcp
  direct-openai
  direct-anthropic
  sqlite-store     # comparison / fallback experiment
  egui-ui          # future
  tauri-bridge     # future; separate frontend package likely
```

New component isimleri descriptive engineering terms kullanır. Existing Noesis/ACCP/Praxis/Hephaestus tarihsel project modules olarak korunur; yeni mitolojik naming katmanı eklenmez.
