# Context Architecture

## Context is a view, not memory

**v0.2 amendment:** Bu bölümdeki “Context View” artık Cognitive View Compiler'ın output'u olarak okunmalıdır. Context yalnız serialization payload'ıdır; Soft Workspace aktif çalışma state'i, Hard State persistent epistemic state'tir. Modelin bütün memory'yi görmesi hedef değil, task için gerekli küçük working representation'ı görmesi hedeftir.

Model context authoritative state değildir; persistent state'in task-specific projection'ıdır.

```text
Authoritative State
   ├─ project graph
   ├─ beliefs
   ├─ obligations
   ├─ evidence
   ├─ capabilities
   └─ recent state deltas
            │
            ▼
      Context Selector
            │
            ▼
      Minimal Context View
            │
            ▼
           Model
```

## Context view contract

Bir model invocation varsayılan olarak şunları içermelidir:

1. current objective/subtask;
2. acceptance/verification constraints;
3. relevant known facts vs hypotheses ayrımı;
4. minimal code/symbol slice;
5. directly relevant observations;
6. available allowed actions;
7. unknown/contradiction that justified the invocation.

Varsayılan olarak şunları içermemelidir:

- bütün chat transcript;
- bütün repository tree;
- bütün tool schemas;
- irrelevant successful logs;
- superseded beliefs;
- previous model prose whose factual content state'e already compiled oldu.

## Progressive disclosure protocol

```text
Model gets minimal view
       │
       ├─ enough → answer/action proposal
       │
       └─ needs evidence → structured request
                          │
                          ▼
                    Context Expander
                          │
                          ▼
                 minimal additional slice
```

Model “more context” diyerek limitsiz dump isteyemez. Request target/kind/reason taşır.

## Soft Workspace

```yaml
soft_workspace:
  id: W-47
  owner: session:47
  base_hard_revision: 412
  task: O17
  focus: [auth_regression]
  hypotheses: [H-soft-1, H-soft-2]
  unknowns: [U9]
  candidate_actions: [A-soft-3]
  authority: non_authoritative
  eviction_policy: bounded_active_set
```

## Cognitive View

```yaml
cognitive_view:
  hard_revision: 412
  workspace_revision: 19
  goal: G1
  task: O17
  current_understanding: "..."
  durable_claim_refs: [C17, C82]
  rejected_refs: [R11]
  contradictions: [X4]
  unknowns: [U9]
  evidence_refs: [E118, E120]
  repo_frontier: [src/auth, docs/contracts]
  omitted_summary:
    deferred_trees: 7
    token_budget: 4200
```

## State Promotion Transaction

```yaml
state_patch:
  base_revision: 412
  operations:
    - type: assert_claim
      proposition: "canonical test entrypoint is make verify"
      epistemic_status: supported
      evidence_refs: [obs:118]
    - type: reject_claim
      claim_id: C91
      reason: "contradicted by obs:118"
    - type: create_obligation
      description: "re-run canonical evaluation under current revision"
```

Runtime schema/revision validation yapar; ACCP admission uygular; downstream invalidation materialize edilir. Model transaction önerebilir fakat `VERIFIED`, human approval veya policy waiver'ı kendi başına mint edemez.
