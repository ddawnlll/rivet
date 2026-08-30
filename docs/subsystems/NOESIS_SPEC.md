# Noesis specification: cognitive state kernel

<span class="badge project">PROJECT_DESIGN</span> Noesis, Rivet'in “memory” modülü değildir. Görevi konuşmanın özeti değil, problem ve environment hakkında **epistemik olarak typed state** tutmaktır. Aynı entity hakkında observation, inference, hypothesis ve verified fact ayrı state sınıflarıdır.

## Noesis entity classes

Minimum önerilen entity seti:

```text
Goal
Constraint
NonGoal
Requirement
Obligation
Task
Artifact
File
Symbol
Module
Package
BuildTarget
TestTarget
Service
Process
Capability
CapabilityProvider
Observation
Evidence
Claim
Hypothesis
Unknown
Contradiction
Patch
Verification
HumanDecision
ModelInvocation
ResourceLock
```

Her entity stable `EntityId` taşır. Source code entity'leri mümkün olduğunda `repo_snapshot + provider + structural_identity` ile adreslenir. Line number stable identity değildir.

## Epistemic classes

```text
OBSERVATION     = environment'tan geldi, yorumlanmadı
MEASUREMENT     = belirli method/tool ile ölçüldü
REPORTED        = dış kaynak veya user tarafından bildirildi
ASSUMPTION      = henüz evidence ile doğrulanmayan çalışma öncülü
INFERENCE       = evidence + rule üzerinden türetildi
HYPOTHESIS      = test edilebilir olası açıklama
VERIFIED        = belirli verification contract altında geçti
REJECTED        = evidence ile zayıflatıldı / falsified
UNKNOWN         = çözülmemiş ve authoritative biçimde bilinmiyor
CONTRADICTED    = aynı scope'ta uyumsuz destekler var
```

Confidence tek başına epistemik class değildir. `%95 confidence` yazan unsupported bir model cümlesi hâlâ `MODEL_INFERENCE` olabilir. Noesis'in önemli işi, “yüksek güven” ile “yüksek kanıt authority”yi karıştırmamaktır.

## Noesis Hard State

<span class="badge project">PROJECT_DESIGN</span> Hard State, project'in session'lar arasında yaşaması gereken düşük-plastisiteli epistemik durumudur. Büyük olabilir; model context'ine doğrudan dump edilmez.

```yaml
hard_state:
  revision: 412
  project_revision: git:abc123
  entities: [...]
  claims:
    - proposition: "canonical verification command is make verify"
      status: supported
      scope: repository
      evidence_refs: [obs:118, doc:policy-4]
  constraints: [...]
  rejected: [...]
  procedures: [...]
  capabilities: [...]
  obligations: [...]
  provenance: [...]
```

Hard State'in amacı “model ne düşünmüştü?” sorusunu saklamak değildir. Amaç durable project reality hakkında **hangi proposition'ın hangi scope, evidence, authority ve revision altında tutulduğunu** taşımaktır. Event-sourced history ile materialized current state ayrılabilir.

## Noesis Soft Workspace

Soft Workspace, bir task/session/worker boyunca yaşayan yüksek-plastisiteli çalışma durumudur. Context window değildir; aktif cognition'ın externalized working set'idir. Model bunu sık ve serbestçe değiştirebilir.

```yaml
soft_workspace:
  owner: session:47
  task: O17
  focus:
    - current economic degradation
    - evaluation authority mismatch
  active_hypotheses:
    - id: H-soft-1
      proposition: "commission sensitivity is the dominant current failure"
      confidence: 0.43
    - id: H-soft-2
      proposition: "previous baseline evidence is stale under current evaluation regime"
      confidence: 0.67
  unresolved:
    - "which prior receipts remain admissible?"
  candidate_actions:
    - inspect_current_evaluation_manifest
  local_decisions:
    - "do not treat a single-asset diagnostic run as canonical portfolio evidence"
```

Soft State non-authoritative'dir. İki concurrent worker aynı project üzerinde birbirine zıt soft hypotheses taşıyabilir. Bu bir consistency bug değildir; premature institutional consensus'u engelleyebilir. Workspace bounded tutulmalıdır; aksi halde ikinci bir chat history'ye dönüşür.

## Hard State ≠ Soft State ≠ Context

| Katman | Ömür | İşlev | Authority |
| --- | --- | --- | --- |
| Hard State | project / günler-aylar | durable epistemic/world state | governed, scope-bound |
| Soft Workspace | task/session/worker | active hypotheses, focus, provisional strategy | non-authoritative |
| Model Context | tek inference payload | modelin bu turn görebildiği serialized view | state değildir |

Bu ayrım v0.2'nin çekirdek falsifiable varsayımıdır. Büyük memory'nin tamamını modele taşımak hedef değildir; **memory büyük olabilir, cognition küçük kalmalıdır.**

## Soft → Hard Promotion, Invalidation and Belief Revision

```text
model thought
   ↓
soft hypothesis
   ↓ observation / evidence
supported local conclusion
   ↓ promotion proposal
ACCP admission + applicable Praxis evidence
   ↓
HARD STATE

repository/evidence revision
   ↓
dependent claim becomes stale/superseded
   ↓
procedure invalidated / obligation reopened
```

Model hard state'i aktif biçimde değiştirmeyi önerebilir; fakat aynı LLM'in aynı belief'i tekrar etmesi promotion evidence değildir. Scope, validity interval, source revision ve dependency edges önemlidir. `REJECTED` de sonsuz yasak anlamına gelmez: rejection hangi conditions/revision altında oluştuysa onlar değiştiğinde reconsideration mümkün olabilir.

## Primary Risk: Epistemic Ossification

Persistent memory unutkanlığı çözebilir fakat daha tehlikeli bir failure mode yaratır: **yanlış cognition'ın kurumsallaşması.**

```text
LLM infers X
  ↓
stores X too strongly
  ↓
future LLM retrieves X
  ↓
"memory says X"
  ↓
X acquires false authority
```

Bu self-confirming loop forbidden'dır. Memory retrieval evidence değildir. Rivet'in başarısı daha çok hatırlamasından değil, **neyi hangi statüde hatırladığını ve ne zaman vazgeçtiğini** yönetebilmesinden gelir.

## Environment knowledge

Noesis'te yalnızca bug/feature state'i değil, repository hakkında keşfedilen çalışma bilgisi de tutulur:

```yaml
project:
  repo_snapshot: sha256:...
  languages:
    - name: rust
      evidence: [E17, E18]
  build_systems:
    - provider: cargo
      confidence: verified
      evidence: [E21]
  tests:
    - capability: test.run
      provider: cargo-test
      command_template: "cargo test {target}"
      status: verified
      scope: workspace
  semantic_navigation:
    - capability: symbol.references
      provider: rust-analyzer
      status: verified
  generated_paths:
    - target/**
  unsafe_paths:
    - .git/**
```

Bu state'in amacı modele her turn “bu repo Cargo mu kullanıyor?” diye tekrar düşündürmemektir.

## Contradictions as first-class state

Contradiction bir hata mesajı değil, scheduler input'udur.

```yaml
contradiction:
  id: C44
  propositions:
    - claim: "auth_refresh test fails because token parser rejects expired grace period"
      support: [E91, E92]
    - claim: "same parser passes equivalent unit case"
      support: [E93]
  status: unresolved
  discriminating_observations:
    - run_with_clock_fixture
    - inspect_callsite_options
```

Discriminating observation mekanik bir capability ile güvenilir biçimde alınabiliyorsa runtime bunu ayrı bir semantic inference problemi haline getirmek zorunda değildir; observation soft workspace’e döner ve aktif model hipotezlerini revize eder. Buradaki amaç modeli loop dışına atmak değil, mechanically decidable alt-adımları cognition yükünden ayırmaktır.
