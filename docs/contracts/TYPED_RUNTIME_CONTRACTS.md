# Typed Runtime Contracts

Rivet'in kritik state'i prose içinde kaybolmamalıdır. Aşağıdaki contract'lar illustrative taslaktır; implementation sırasında schema evolution ve serialization formatı ayrıca kararlaştırılır.

## Task

```rust
struct Task {
    id: TaskId,
    goal_ref: GoalId,
    kind: TaskKind,
    state: TaskState,
    scope: Scope,
    dependencies: Vec<TaskId>,
    required_capabilities: Vec<CapabilityId>,
    evidence_requirements: Vec<EvidenceRequirement>,
    verification_plan: VerificationPlan,
    risk: RiskClass,
    priority: Priority,
    created_from: TaskOrigin,
}
```

## Task state machine

```text
DISCOVERED
   │
   ├── unmet dependency ──────────────> BLOCKED
   │                                     │
   │                                     └─ dependency resolved
   ▼
READY
   │
   ├─ deterministic execution ────────> RUNNING
   ├─ missing observation ────────────> WAITING_OBSERVATION
   ├─ semantic uncertainty ───────────> WAITING_MODEL
   └─ authority required ─────────────> WAITING_HUMAN
                                           │
                                           ▼
                                       RUNNING
                                           │
                                           ▼
                                       VERIFYING
                                      /         \
                                VERIFIED       FAILED
                                                 │
                                                 ├─ new evidence/task
                                                 ├─ rollback
                                                 └─ Hephaestus if stagnated
```

`VERIFIED` terminal completion'dır; `RUNNING` veya model “done” text'i completion değildir.

## Capability

```rust
struct Capability {
    id: CapabilityId,              // e.g. "symbol.references"
    semantic_contract: Contract,
    providers: Vec<ProviderRef>,
    trust: CapabilityTrust,
    scope: CapabilityScope,
}

struct CapabilityProvider {
    id: ProviderId,
    capability_id: CapabilityId,
    invocation: InvocationSpec,
    preconditions: Vec<Predicate>,
    expected_observation: ObservationSchema,
    verification: ProviderVerification,
    cost_model: CostModel,
    side_effects: EffectSet,
}
```

Provider lifecycle:

```text
UNSEEN → CANDIDATE → PROBING → VERIFIED
                         │          │
                         └→ REJECTED│
                                    └→ DEGRADED → PROBING/REJECTED
```

LLM-discovered provider **CANDIDATE** olarak başlar; model suggestion'ı `VERIFIED` yetki üretmez.

## Observation

```rust
struct Observation {
    id: ObservationId,
    source: EvidenceRef,
    kind: ObservationKind,
    subject: EntityRef,
    timestamp: LogicalTime,
    payload: TypedPayload,
    confidence: ObservationConfidence,
}
```

Örnek:

```yaml
kind: verification_failure
subject: build_target://auth
payload:
  verifier: cargo_check
  diagnostic_code: E0382
  location: src/auth/session.rs:117
  raw_evidence_ref: evidence://E884
```

## Evidence record

```rust
struct EvidenceRecord {
    id: EvidenceId,
    provenance: Provenance,
    content_hash: ContentHash,
    artifact_ref: Option<ArtifactRef>,
    created_by: ActorRef,
    created_at: LogicalTime,
    supersedes: Option<EvidenceId>,
}
```

Evidence immutable'dır. “Düzeltme” yeni record üretir.

## Noesis belief

```rust
struct Belief {
    id: BeliefId,
    proposition: Proposition,
    status: BeliefStatus, // observation/fact/inference/hypothesis/assumption/rejected
    support: Vec<EvidenceId>,
    contradiction: Vec<EvidenceId>,
    confidence: CalibratedConfidence,
    scope: Scope,
}
```

`confidence` ontolojik truth değildir; sistemin bounded epistemic state'idir.

## ACCP action decision

```rust
struct ActionDecision {
    action: ActionIntent,
    evidence_status: EvidenceSufficiency,
    risk: RiskClass,
    reversibility: Reversibility,
    authority: AuthorityRequirement,
    verdict: Allow | RequireEvidence | RequireHuman | Downgrade | Block,
    receipt: DecisionReceipt,
}
```

## Praxis verification plan

```rust
struct VerificationPlan {
    obligations: Vec<VerificationObligation>,
    required_levels: Vec<VerificationLevel>,
    failure_policy: FailurePolicy,
}

enum VerificationLevel {
    Static,
    Compile,
    TargetedTest,
    Integration,
    Regression,
    CrossPlatform,
    Performance,
    Security,
}
```

Her task bütün level'ları gerektirmez; required set risk ve goal semantics'ten türetilir.

## Invocation receipt

```rust
struct InvocationReceipt {
    id: InvocationId,
    reason: InvocationReason,
    unresolved_question: QuestionRef,
    deterministic_alternatives_checked: Vec<CapabilityId>,
    model: ModelRef,
    context_view_hash: ContentHash,
    uncached_input_tokens: u64,
    cached_input_tokens: u64,
    output_tokens: u64,
    latency_ms: u64,
    estimated_cost: Money,
    produced_claims: Vec<ClaimId>,
}
```

Model invocation observability'siz optimizasyon yapılamaz.

## Token/compute receipt

```yaml
run: R-2026-00191
verified_result: true
model_calls: 12
frontier_calls: 4
uncached_input_tokens: 38120
cached_input_tokens: 109400
output_tokens: 9220
deterministic_transitions: 143
tool_executions: 81
wall_clock_ms: 188420
rollback_count: 1
wrong_deterministic_transitions: 1
```
