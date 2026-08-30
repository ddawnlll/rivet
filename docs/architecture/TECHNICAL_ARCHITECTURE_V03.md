# Technical Architecture v0.3

<span class="badge provisional">PROVISIONAL_DECISION</span> v0.3 epistemik tezi yeniden yazmaz; v0.2'de tanımlanan state architecture'ı ilk executable vertical slice için somut bir implementation profile'a bağlar. Bu profile araştırma sonucu değildir. Seçimler; düşük integration friction, güçlü typing, tek-process state ownership, replayability ve ilk ablation'ları mümkün olduğunca az altyapıyla çalıştırma hedeflerine göre yapılmıştır.

## Implementation status and scope

v0.3'ün teknik statüsü **implementation-ready research profile**'dır. Amaç “production architecture tamamlandı” demek değildir. Amaç, ilk iki günlük yoğun agentic development sonunda çalışabilir bir walking skeleton ve birkaç gün içinde falsification-capable vertical slice çıkaracak kadar karar yüzeyini daraltmaktır.

| Alan | v0.3 kararı | Statü |
| --- | --- | --- |
| Core language | Rust, edition 2024 | LOCKED_FOR_SLICE |
| Agent/harness ownership | Rivet kendi Harness Core'una sahiptir; external agent framework host değildir | LOCKED_ARCHITECTURAL |
| Process model | Single process, in-memory first, no internal IPC | LOCKED_FOR_SLICE |
| Async runtime | Tokio; async yalnız gerçek I/O ve orchestration boundary'lerinde | LOCKED_FOR_SLICE |
| Soft state | RAM-first, bounded, session/task scoped | LOCKED_FOR_SLICE |
| Hard state | Event-sourced; hot materialized state RAM'de, embedded durable store arkada | LOCKED_ARCHITECTURAL |
| First durable backend | `redb` preferred; backend Rivet-owned trait arkasında | PROVISIONAL |
| Model transport | Rivet-owned `ModelBackend`; first multiprovider adapter `genai` | PROVISIONAL |
| Agent framework | No fork; Rig/OpenCode/Pi/DSH reference or optional compatibility adapter only | LOCKED_ARCHITECTURAL |
| Repository/git | Native filesystem + `gix` where useful; external Git CLI allowed as explicit capability fallback | PROVISIONAL |
| MCP | `rmcp` only at external capability boundary; never internal subsystem bus | LOCKED_FOR_SLICE |
| UI | CLI/TUI first: `clap` + Ratatui/Crossterm; desktop deferred | LOCKED_FOR_SLICE |
| Desktop candidate | Tauri if polished web UI wins; egui/eframe if pure-Rust direct-call UI wins | DEFERRED |
| Internal serialization | Typed Rust values; serialization only at persistence/provider/audit boundaries | LOCKED_ARCHITECTURAL |

“Full Rust” burada ürünün agent semantics, harness, Noesis, ACCP, Praxis, Hephaestus, repository runtime, CLI ve adapters'ının Rust olması anlamına gelir. External commands ve provider HTTP endpoints doğal olarak process/network boundaries'dir. Ama internal subsystem'ler HTTP/gRPC/MCP/JSON-RPC üzerinden birbirleriyle konuşmaz.

## Harness ownership boundary

<span class="badge invariant">LOCKED_INVARIANT</span> Rivet **harness-agnostic değildir**. Model, provider, storage ve frontend replaceable substrate olabilir; fakat aşağıdaki semantics Rivet Harness Core'a aittir:

- bir Rivet run/session'ın açılması, resume edilmesi ve kapanması;
- hangi project revision ve Noesis revision üzerinde cognition yürüdüğü;
- Soft Workspace'in lifecycle'ı ve hangi workspace'in hangi model invocation'a bağlandığı;
- Cognitive View'un nasıl hazırlandığı ve model input'una nasıl serialize edildiği;
- model çıktısının hangi typed cognitive actions'a dönüşebildiği;
- ACCP authorization, runtime execution, Praxis verification ve Noesis revision sırası;
- cancellation, timeout, retry, stale-state ve partial-failure semantics;
- completion'ın model prose'u değil obligation/verification state'i tarafından belirlenmesi;
- model veya provider değişse bile Rivet identity ve hard-state continuity'nin korunması.

```text
replaceable:
  model provider
  model family
  persistence backend
  external tool provider
  MCP server
  frontend

Rivet-owned:
  cognitive lifecycle
  epistemic lifecycle
  workspace lifecycle
  state promotion
  execution authority
  verification integration
  continuation / completion semantics
```

Bu nedenle Rig'in `AgentRunner`'ı, Pi session loop'u veya başka bir host framework Rivet'in semantic owner'ı olamaz. Bu framework'ler provider/tool plumbing için incelenebilir veya adapter olarak kullanılabilir; fakat Rivet onların “agent” nesnesinin memory plugin'i haline gelmez. v0.3 teknik ayrımı: **reuse commodity infrastructure; own the research semantics.**

## Process and memory model

İlk implementation tek OS process'tir. Noesis, Praxis, ACCP, Hephaestus ve Harness Core direct Rust calls/typed values üzerinden konuşur. Async channels ancak gerçek concurrency boundary'si bulunduğunda kullanılır; “subsystem separation” adına message bus yaratılmaz.

```text
┌──────────────────────────── RIVET PROCESS ─────────────────────────────┐
│                                                                       │
│  CLI/TUI                                                              │
│    │                                                                  │
│    ▼                                                                  │
│  Harness Core ──────────────── ModelBackend ─────── HTTP/provider     │
│    │    │                                                             │
│    │    ├── Noesis Hard State  ───── durable embedded store           │
│    │    ├── Noesis Soft Workspace ── RAM                              │
│    │    ├── Cognitive View Compiler                                   │
│    │    ├── ACCP                                                      │
│    │    ├── Praxis                                                    │
│    │    ├── Hephaestus                                                │
│    │    └── Runtime ─────────────── fs/process/git/MCP external edge   │
│    │                                                                  │
│    └── typed events / receipts / revisions                            │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

Internal IPC'nin erken kullanımı dört gereksiz maliyet yaratır: serialization, duplicate state ownership, distributed failure semantics ve schema evolution across process boundaries. Bunların hiçbiri v0.3'ün araştırma sorusuna katkı sağlamaz. Multi-process isolation yalnız security/resource requirements bunu somut biçimde gerektirirse daha sonra eklenir.

## Rust runtime stack

Rust seçimi yalnız performans gerekçesi değildir. Rivet çok sayıda invalid state kombinasyonunu compile-time type boundaries ile imkânsızlaştırmak, mutation authority'yi explicit contracts'a bağlamak ve long-lived process state'ini memory-safe tutmak ister. Buna rağmen “Rust yazdık, dolayısıyla doğru” varsayımı yasaktır; semantic correctness hâlâ tests, receipts ve Praxis'e bağlıdır.

| Katman | Önerilen teknoloji | Neden |
| --- | --- | --- |
| Async I/O | `tokio` | Model streaming, process I/O, timeouts, cancellation, MCP/network; ecosystem standardı. |
| CLI | `clap` | Stable command/config surface. |
| TUI | `ratatui` + `crossterm` | Chat-first terminal surface; research iteration UI'dan bağımsız kalır. |
| Serialization | `serde`, `serde_json` | Provider/audit/config boundaries. Internal domain model stringly JSON değildir. |
| Shared immutable buffers | `bytes::Bytes`, `Arc<str>`, `Arc<[T]>`, `Cow` | Large artifact/model-view copies'i azaltma. |
| Error taxonomy | `thiserror`; binary boundary'de gerekirse `anyhow` | Library errors typed kalır; CLI aggregation ergonomik olur. |
| Tracing | `tracing` + `tracing-subscriber` | Cognitive cycle, provider, tool, verification ve state revision spans. |
| Git | `gix` + explicit Git CLI fallback | Pure-Rust read/plumbing ve stable repo observations; missing porcelain için controlled escape hatch. |
| Embedded store | `redb` first candidate | Pure Rust, ACID, MVCC, crash safety ve zero-copy oriented API; Noesis indexes Rivet tarafından kontrol edilir. |
| Model multiprovider | `genai` behind Rivet trait | Provider-specific HTTP/protocol plumbing'i reuse eder; agent lifecycle'ını sahiplenmez. |
| MCP edge | `rmcp` | External MCP ecosystem compatibility; internal bus değildir. |
| Property tests | `proptest` | Promotion/invalidation/state-machine invariants. |
| Microbench | `criterion` or equivalent | View compilation, census, persistence and allocation regressions. |

Reference snapshot, 30 Aug 2026: Tokio describes itself as an asynchronous Rust runtime; Ratatui is a Rust terminal UI library; `redb` is a pure-Rust ACID embedded store with MVCC and zero-copy oriented access; `genai` is a multiprovider Rust client; `gix` is a pure-Rust Git implementation; the Rust MCP SDK uses Tokio. These are substrate choices, not evidence for Rivet's cognitive thesis.

## Zero-copy and allocation policy

<span class="badge provisional">PROVISIONAL_DECISION</span> “Zero-copy” v0.3'te dogmatik bir global invariant değil, **no unnecessary copies / no unnecessary serialization boundaries** politikasıdır. LLM provider JSON, compression, persistence schema migration veya security boundary kopya gerektiriyorsa kopya yapılır. Self-referential lifetime mimarisi kurup araştırma iteration'ını kilitlemek başarısızlıktır.

Hot-path ilkeleri:

- large raw outputs `String` kopyaları olarak dolaşmaz; `Bytes` veya immutable artifact reference tutulur;
- Cognitive View birden fazla consumer'a veriliyorsa immutable shared ownership tercih edilir;
- hard-state entities stable IDs ile referanslanır; aynı evidence text farklı objects içine duplicate edilmez;
- repository census path/string interning ancak profiler veya memory accounting anlamlı kazanç gösterirse eklenir;
- provider serialization en son boundary'de yapılır; internal Noesis/ACCP/Praxis communication Rust enums/structs olarak kalır;
- raw logs default model context'e kopyalanmaz; view yalnız selected slices veya evidence refs taşır;
- serialization format “zero-copy” uğruna erken kilitlenmez; event schema evolution correctness'ten daha düşük önceliklidir.

```rust
pub struct ArtifactBody {
    pub id: ArtifactId,
    pub bytes: bytes::Bytes,
    pub media_type: MediaType,
}

pub struct CognitiveView {
    pub goal: std::sync::Arc<GoalView>,
    pub hard_state: std::sync::Arc<[ProjectedClaim]>,
    pub workspace: std::sync::Arc<WorkspaceSnapshot>,
    pub evidence: std::sync::Arc<[EvidenceRef]>,
    pub frontier: std::sync::Arc<[ArtifactSummary]>,
}
```

Performance acceptance yalnız “allocation count azaldı” değildir. Asıl metric end-to-end verified task efficiency'dir. Zero-copy yalnız wall-clock/memory/token pipeline'ında measurable katkı sağlıyorsa complexity budget kazanır.

## Canonical cognitive cycle

Rivet Harness Core'un en kritik implementasyonu tek bir açık state machine'dir. Bu loop başka agent framework'ün hidden callback lifecycle'ına bırakılmaz.

```text
IDLE / RESUMED
    ↓
LOAD project + Noesis revision
    ↓
OPEN or RESUME Soft Workspace
    ↓
REFRESH repository frontier if required
    ↓
COMPILE Cognitive View
    ↓
INVOKE active model controller
    ↓
DECODE typed CognitiveAction(s)
    ↓
AUTHORIZE state/action mutations (ACCP)
    ↓
EXECUTE capabilities / inspect environment
    ↓
CAPTURE observations + immutable evidence refs
    ↓
VERIFY bounded predicates when requested/required (Praxis)
    ↓
REVISE Soft Workspace
    ↓
PROMOTE / invalidate Hard State transactionally
    ↓
CONTINUE cognition, RESPOND, WAIT_FOR_AUTHORITY or COMPLETE
```

Bir cycle'ın kendisi “bir LLM call” ile özdeş değildir. Bir model invocation birden fazla proposed action üretebilir; bir runtime action model çağrısı olmadan observation üretebilir; Praxis aynı cycle içinde ayrı verification receipts çıkarabilir. Harness Core bu sequence'in authoritative owner'ıdır.

Önerilen explicit runtime states:

```rust
pub enum RunPhase {
    Idle,
    PreparingView,
    InvokingModel,
    DecodingActions,
    Authorizing,
    Executing,
    Observing,
    Verifying,
    RevisingState,
    WaitingForUser,
    Responding,
    Completed,
    Cancelled,
    Failed,
}
```

State machine transitions replay/test edilebilir olmalıdır. Model prose'u phase transition'ın tek kaynağı değildir.

## Model backend contract

Rivet provider-agnostic olabilir; bu nedenle model dependency'si third-party framework type'larıyla core'a sızmaz. Core kendi minimal contract'ını taşır.

```rust
#[async_trait::async_trait]
pub trait ModelBackend: Send + Sync {
    async fn invoke(
        &self,
        request: ModelRequest,
        cancel: CancellationToken,
    ) -> Result<ModelResponse, ModelError>;

    async fn stream(
        &self,
        request: ModelRequest,
        cancel: CancellationToken,
    ) -> Result<ModelStream, ModelError>;
}

pub struct ModelRequest {
    pub model: ModelRef,
    pub system_contract: std::sync::Arc<str>,
    pub cognitive_view: std::sync::Arc<CognitiveView>,
    pub action_schema: std::sync::Arc<ActionSchema>,
    pub budget: ModelBudget,
    pub invocation: InvocationId,
}
```

First adapter `genai` olabilir çünkü multiprovider protocol normalization sağlar fakat Rivet'in agent lifecycle'ını sahiplenmez. Rig daha zengin agent/runtime abstractions sağladığı için direct core dependency yapılmaz; daha sonra adapter veya benchmark substrate olabilir. Direct OpenAI/Anthropic adapters gerektiğinde `ModelBackend` altında eklenebilir.

Provider features en düşük ortak paydaya zorlanmaz. `ModelCapabilities` ile structured output, native tools, prompt caching, reasoning controls, image input veya provider stateful-session support explicit negotiation edilir. Rivet persistent state'i hiçbir zaman provider-managed session continuity'ye devretmez.

## Structured cognitive actions

Provider-native “tool call” transport olarak kullanılabilir; fakat Rivet ontology'si function-name listesi değildir. İlk vertical slice'da action space küçük tutulur:

```rust
pub enum CognitiveAction {
    Inspect(InspectRequest),
    Execute(ExecutionRequest),
    Patch(PatchRequest),
    UpdateWorkspace(WorkspacePatch),
    ProposeHardState(HardStateProposal),
    RequestVerification(VerificationRequest),
    RequestAuthority(AuthorityRequest),
    Respond(UserResponse),
}
```

`Inspect/Execute/Patch` raw escape-hatch capability'leridir; semantic capability layer daha sonra incremental olarak crystallize olabilir. Modelin “hard state'i güncelle” demesi mutation değildir; `HardStateProposal` base revision, provenance, epistemic class ve supporting refs taşır.

```rust
pub struct HardStateProposal {
    pub base_revision: Revision,
    pub operations: Vec<ProposedStateOp>,
    pub rationale_summary: Option<std::sync::Arc<str>>,
}
```

Free-form chain-of-thought persistence is not required. Rivet yalnız externally relevant hypothesis/assessment/decision/action/state delta'yı structured hale getirir.

## Noesis physical architecture

Noesis logical model v0.2'de tanımlandı; v0.3 onun fiziksel runtime separation'ını sabitler:

```text
NOESIS
│
├── Event Ledger (durable canonical history)
│
├── Materialized Hard State (hot in-memory indexes)
│   ├── entities
│   ├── claims
│   ├── evidence refs
│   ├── relations
│   ├── obligations
│   ├── decisions
│   ├── procedures/capabilities
│   ├── rejected/superseded/stale
│   └── reverse dependencies
│
├── Soft Workspace Registry (RAM-first)
│   └── WorkspaceId → bounded active cognition
│
├── Revision / Invalidation Engine
│
└── Projection API
    └── task-conditioned data for Cognitive View Compiler
```

Canonicality rule: current materialized Hard State rebuildable olmalıdır. Eğer materialized index bozulursa event log + snapshot'tan yeniden üretilebilir. Raw evidence immutable reference olarak ayrı artifact store'da tutulabilir; event payload içine dev logs embed edilmez.

```rust
pub enum NoesisEvent {
    ObservationAdded(ObservationRecord),
    ClaimProposed(ClaimRecord),
    EvidenceAttached(EvidenceLink),
    ClaimPromoted(PromotionRecord),
    ClaimRejected(RejectionRecord),
    ClaimSuperseded(SupersessionRecord),
    EntityInvalidated(InvalidationRecord),
    ObligationOpened(ObligationRecord),
    ObligationClosed(ClosureRecord),
    DecisionRecorded(DecisionRecord),
    CapabilityRegistered(CapabilityRecord),
}
```

Events sequence-numbered `Revision(u64)` üzerinden ilerler. Persisted domain IDs typed newtype olmalıdır; raw `String` ID'ler core API'de kabul edilmez.

## Hard-state persistence

<span class="badge provisional">PROVISIONAL_DECISION</span> İlk durable backend için `redb` tercih edilir. Gerekçe: single-process embedded kullanım, pure Rust implementation, ACID transactions, MVCC, crash-safe storage ve zero-copy oriented read API. Bunun karşılığında relational query engine verilmez; Noesis ihtiyaç duyduğu indexes'i explicit olarak kurar. Bu trade-off v0.3'ün typed/event-sourced domain modeline uygundur fakat benchmark sonucu değiştirilebilir.

Önerilen logical tables:

```text
meta
  schema_version → ...
  latest_revision → ...
  latest_snapshot → ...

events
  Revision → EventEnvelope

snapshots
  Revision → SnapshotBlob

artifacts
  ArtifactId → ArtifactMeta + content pointer/hash

entity_index
  EntityId → compact materialized record

relation_out
  EntityId + RelationType → [EntityId]

relation_in
  EntityId + RelationType → [EntityId]

claim_status
  ClaimId → EpistemicStatus

reverse_dependency
  EntityId → [DependentStateId]
```

Store crate `HardStateStore` trait expose eder. Böylece SQLite/Postgres veya başka backend daha sonra benchmark/migration gerekçesiyle eklenebilir; fakat domain semantics store query language'ına gömülmez.

```rust
pub trait HardStateStore {
    fn append(&self, expected: Revision, events: &[NoesisEvent])
        -> Result<Revision, StoreError>;
    fn load_snapshot(&self) -> Result<Option<Snapshot>, StoreError>;
    fn events_after(&self, revision: Revision)
        -> Result<Box<dyn Iterator<Item = Result<EventEnvelope, StoreError>> + '_>, StoreError>;
}
```

Optimistic concurrency: promotion/action sonucu `base_revision` taşımalıdır. Revision değişmişse mutation `STALE_STATE` ile reddedilir ve model eski world-state üzerinde authoritative write yapamaz.

Schema evolution: event envelope explicit version taşır. Snapshot disposable/rebuildable olduğu için migration'ın authoritative burden'ı event decoder/upcaster katmanındadır. v0.3'te persisted Rust memory layout doğrudan disk formatı yapılmaz; bu, Rust struct refactor'larını kalıcı formatla gereksiz yere kilitlememek içindir.

## Soft workspace runtime

Soft Workspace ilk implementation'da RAM-first'tür. Crash sonrası kaybı accepted prototype trade-off olabilir; fakat explicit user/session checkpoint istenirse workspace snapshot ayrı *non-authoritative* record olarak persist edilebilir. Restore edilen workspace hard truth statüsü kazanmaz.

```rust
pub struct Workspace {
    pub id: WorkspaceId,
    pub project: ProjectId,
    pub base_revision: Revision,
    pub focus: BoundedVec<FocusItem>,
    pub hypotheses: BoundedMap<HypothesisId, ActiveHypothesis>,
    pub questions: BoundedVec<OpenQuestion>,
    pub local_findings: BoundedVec<LocalFinding>,
    pub candidate_actions: BoundedVec<CandidateAction>,
    pub strategy: Option<StrategyFrame>,
}
```

`Bounded*` burada literal crate API olmak zorunda değildir; invariant'ı gösterir. Workspace'in büyümesi admission/eviction policy ile sınırlanır. İlk version learned eviction yapmaz. Deterministic caps + model-proposed consolidation yeterlidir; hangi cap'in iyi olduğu benchmark/open question olarak kalır.

Aynı project üzerinde birden fazla workspace olabilir. Hard State shared olabilir; soft cognition worker/session scoped'tur. İki workspace'in zıt hipotez taşıması contradiction değildir; contradiction yalnız hard-state scope içinde epistemik claim'ler çakıştığında ayrı state olarak yükseltilir.

## Cognitive View runtime pipeline

Cognitive View Compiler tek “RAG query” fonksiyonu değildir. v0.3 runtime pipeline:

```text
User intent / active task
        +
Soft Workspace
        +
Hard-State candidates
        +
Repository frontier
        +
Recent observations
        ↓
1. deterministic eligibility filtering
        ↓
2. relation / provenance path expansion
        ↓
3. relevance ranking / budget allocation
        ↓
4. semantic compression where needed
        ↓
5. contradiction + rejected-belief inclusion checks
        ↓
6. model-facing serialization
        ↓
CognitiveView
```

Compiler output immutable view object'tir. Hard state'in kendisi değildir ve model response ile overwrite edilmez. Her invocation receipt hangi view revision/hash'i kullandığını kaydeder. Wrong Cognitive Projection daha sonra replay edilebilmelidir.

İlk ablation serialization modes:

- `RAW_TEXT` — equivalent retrieved textual material;
- `TRIPLES` — selected typed relations;
- `PATHS` — supporting/contradicting evidence paths;
- `HYBRID` — concise semantic summary + typed relations + epistemic status + authority/freshness + evidence refs.

v0.3 default implementasyonu HYBRID olabilir fakat benchmark diğer representations'a karşı yapılmadan “optimal” sayılmaz.

## Repository runtime and induction frontier

Repository subsystem iki role ayrılır: **mechanical sensing** ve **semantic induction**. Mechanical sensing Rust runtime tarafından yapılır; semantic relevance ve ontology authoring active LLM controller'a aittir.

Cheap census örnek signals:

- path/name/type/depth;
- file count, approximate byte size, extension/media type;
- git tracked/untracked/ignored state;
- known binary/text determination;
- manifest/CI/config existence as observations, not semantic truth;
- mtime/churn where available;
- lazy content hash;
- optional reference/import signals when cheap and provider-safe.

LLM frontier action:

```rust
pub enum FrontierDecision {
    Descend { priority: u16, reason: ShortReason },
    Defer { revisit_on: Vec<RelevanceTrigger>, reason: ShortReason },
    HardExclude { evidence: EvidenceRef, reason: ShortReason },
}
```

`HardExclude` rare'dir. `DEFER` task-relative düşük priority demektir. Node modules, vendored or generated directories için runtime yalnız signals üretir; semantic “junk” taxonomy hardcode edilmez. Relevance false-negative ölçümü için benchmark'ta deferred subtree counterfactual sampling tutulabilir.

Repository file content default olarak global vector index'e ingest edilmez. Selected frontier üzerinden content inspection ve optional local indexes incremental kurulur. Bu, cold-start compute'u task'a bağlar.

## Praxis / ACCP / Hephaestus runtime contracts

v0.3 mevcut Rust subsystem'leri yeniden ürünleştirmez; Rivet process içindeki typed modules olarak kullanır. API audit'in amacı yeni state modeline göre output ownership'i düzeltmektir.

### Praxis

```rust
pub trait Verifier {
    async fn verify(
        &self,
        request: VerificationRequest,
        cancel: CancellationToken,
    ) -> Result<VerificationReceipt, VerificationError>;
}
```

Praxis `VERIFIED hard truth` yazmaz. Belirli revision/environment/provider altında predicate sonucu üretir. Noesis claim status promotion'ı bu receipt'i scope-aware biçimde kullanır.

### ACCP

```rust
pub trait AuthorityGate {
    fn evaluate_state_promotion(&self, request: &PromotionRequest)
        -> AuthorityDecision;
    fn evaluate_action(&self, request: &ActionRequest)
        -> AuthorityDecision;
}
```

ACCP'nin internal wire format olması gerekmez. Canonical YAML compiler/profile audit ve interchange için korunabilir; hot path typed Rust AST kullanır. ACCP'nin amacı protocol bureaucracy değil admission/authority semantics'tir.

### Hephaestus

```rust
pub trait Reframer {
    async fn reframe(
        &self,
        input: ReframeInput,
        cancel: CancellationToken,
    ) -> Result<FrameProposal, ReframeError>;
}
```

Hephaestus normal workspace değildir ve scheduler değildir. Yalnız trigger oluştuğunda new frame/strategy/workspace patch proposal üretir; hard state'e doğrudan authoritative mutation yapamaz.

## Concurrency and cancellation

Tokio seçimi “her fonksiyon async” anlamına gelmez. Noesis event application, ACCP checks, view selection'ın pure/deterministic parçaları synchronous tutulur. Async yalnız network/process/filesystem wait veya concurrent orchestration gerektiğinde kullanılır.

- Her user-visible run bir root cancellation token taşır.
- Model stream, process execution, MCP request ve long verification child token alır.
- User interrupt child work'i cancel eder; hard-state commit atomic transaction boundary dışında yarım kalamaz.
- External process timeout'ta yalnız parent future drop edilmez; process group/child termination semantics explicit olmalıdır.
- Concurrent observations read-only olabilir; concurrent hard-state writes expected revision üzerinden serialize edilir.
- Background “fire and forget” cognitive tasks default olarak yasaktır; untracked task agent continuity'yi bozar.

İlk slice multi-agent parallelism yapmaz. Concurrency model/provider streaming + process I/O + safe observation parallelism ile sınırlıdır. Worktree/worker scheduler mevcut monograf bölümünde gelecekteki capability olarak kalır.

## Observability and receipts

Chat-only UI mechanical trace'i yok etmez. Runtime structured spans ve receipts üretir:

```text
RunReceipt
  run_id
  project_revision_start/end
  noesis_revision_start/end
  model_invocations[]
  cognitive_view_hashes[]
  actions[]
  observations[]
  verification_receipts[]
  authority_decisions[]
  promotions[]
  token/latency/io accounting
  completion status
```

Default chat semantic summaries gösterir. `--trace`, debug command veya “neden?” sorusu mechanical lineage'i projection olarak açabilir. `tracing` spans ile Noesis receipts aynı şey değildir: tracing operational telemetry, evidence/receipts epistemic/audit semantics'tir.

Secrets, model hidden reasoning ve sensitive raw content default telemetry'ye yazılmaz. Receipt externally relevant decisions/state transitions içerir.

## UI strategy

<span class="badge provisional">PROVISIONAL_DECISION</span> İlk surface CLI/TUI'dir. Bunun nedeni TUI'nin “nihai UX” olması değil, cognitive runtime'ı UI architecture'ından ayırıp chat-only product thesis'ini en hızlı test etmesidir.

```text
v0.3 vertical slice
  clap commands
  + Ratatui/Crossterm chat stream
  + status line
  + interrupt
  + scrollback
  + optional trace view
```

Tauri bugün Rust core + OS WebView + frontend message-passing/IPC modeli kullanır. Bu production desktop polish için güçlü olabilir; fakat v0.3'te no-internal-IPC ve direct in-process state hedefi nedeniyle erken complexity'dir. egui/eframe pure-Rust native/web UI alternatifi olarak daha doğrudan olabilir; fakat product design ihtiyacı ortaya çıkmadan UI framework kararı kilitlenmez.

Core frontend'i bilmez:

```rust
pub enum UiEvent {
    AssistantDelta(std::sync::Arc<str>),
    Status(RunStatus),
    AuthorityPrompt(AuthorityRequest),
    VerificationUpdate(VerificationReceiptSummary),
    Completed(CompletionSummary),
}
```

CLI, Tauri veya egui aynı event/query contracts'ını kullanabilir. Agent identity frontend'de yaşamaz.

## Testing and replay strategy

Rivet'in first production discipline'i model benchmark'tan önce deterministic core'u agresif test etmektir.

| Test class | Hedef |
| --- | --- |
| Unit | Event application, epistemic transitions, revision checks, workspace bounds. |
| Property | No self-confirmation, promotion prerequisites, invalidation closure, append-only evidence. |
| Replay | Same event log → same materialized Hard State hash. |
| Crash recovery | Commit öncesi/sonrası kill; snapshot + tail replay consistency. |
| Fake-model integration | Provider nondeterminism olmadan Harness Core lifecycle. |
| Fake-runtime integration | Known observations/failures ile Praxis/Noesis state outcomes. |
| Fuzz | Provider JSON/tool payloads, malformed repository outputs, ACCP parsers. |
| Golden/snapshot | Cognitive View serialization regressions; epistemic status görünürlüğü. |
| End-to-end | Temporary git repo → induction → patch → verify → persist → restart → continue. |
| Research eval | Context-centric baseline vs E1–E5 same model/capability/sandbox. |

CI minimum: `cargo fmt --check`, strict Clippy, unit/integration tests, dependency policy/security audit ve deterministic fixtures. Benchmarks correctness gate yerine geçmez.

## First vertical slice

İlk implementation “Rivet'in tüm vizyonu” değildir. Aşağıdaki vertical slice yeterlidir:

```text
rivet open <repo>
      ↓
mechanical census
      ↓
LLM-led relevance descent
      ↓
create/resume Soft Workspace
      ↓
minimal Hard State + event log
      ↓
compile HYBRID Cognitive View
      ↓
frontier model through ModelBackend
      ↓
inspect / execute / patch / workspace update / hard-state proposal
      ↓
ACCP admission
      ↓
Praxis verification when applicable
      ↓
Noesis promotion + persistence
      ↓
chat response
      ↓
process exit
      ↓
restart → recover hard state → continue without rediscovery
```

**48-hour engineering target:**

1. **Skeleton:** Cargo workspace, `rivet-core`, `rivet-model`, `rivet-runtime`, `rivet-noesis`, existing ACCP/Praxis/Hephaestus integration stubs, CLI.
2. **Noesis:** event envelope, revision counter, in-memory materializer, redb append/replay, bounded workspace.
3. **Model:** fake backend first, then genai adapter with streaming and structured output normalization.
4. **Repository:** metadata tree/census, frontier decisions, selective file read.
5. **View:** minimal HYBRID compiler with provenance/rejected/unknown sections.
6. **Runtime:** read/search/process/patch primitives, output caps, cancellation.
7. **Integration:** Praxis receipt → Noesis evidence; ACCP promotion/action decision; Hephaestus disabled by default.
8. **Proof:** open real repo, learn one durable project fact, terminate process, reopen, answer related task without rediscovering same fact.

İlk V8 testinde hedef “V8'i tamamen çözmek” değildir. Rivet canonical authority/rejected-path state'i project'ten öğrenip restart sonrası doğru cognitive view'a geri getirebiliyorsa state architecture canlıdır. Ardından alien repo controls gelir.

## Technical non-goals

v0.3 first slice'ın özellikle yapmayacağı şeyler:

- multi-agent swarm;
- distributed workers veya service mesh;
- internal gRPC/HTTP/MCP;
- general graph database deployment;
- all-language semantic provider zoo;
- learned invocation router;
- production Tauri desktop;
- custom database engine;
- custom LLM inference engine;
- perfect zero-copy serialization;
- full ACCP wire-protocol rewrite;
- Hephaestus always-on meta-cognition;
- background autonomous jobs without explicit lifecycle ownership.

Bu exclusions ürün vizyonundan vazgeçmek değildir. İlk experiment'te independent variable'ın Noesis state + Cognitive View + repository relevance olmasını korur.
