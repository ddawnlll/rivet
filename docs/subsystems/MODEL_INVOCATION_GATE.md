# Model Invocation Economy Gate (Secondary Optimization)

<span class="badge open">OPEN_QUESTION</span> v0.1 bu bölümü “bütün projenin en zor araştırma problemi” olarak tanımlıyordu. v0.2'de öncelik değişmiştir: **önce modelin hangi state representation üzerinde reasoning yapması gerektiği** çözülmelidir. Invocation Gate yalnız mechanically decidable transitions'da gereksiz frontier inference'ı azaltan secondary efficiency policy'dir; semantic cognition'ı sistematik biçimde bastırmak amaç değildir.

Bu secondary policy, “model ne zaman düşünmeye izinli?” sorusunu değil, “aynı semantic control korunurken hangi ayrı model round-trip gerçekten gereksiz?” sorusunu sorar. State quality ve active-controller semantics bu optimizasyondan önce gelir.

1. **Mechanical closure:** Sonraki alt-adım explicit contract/state ile tamamen belirlenmiş mi?
2. **Observation availability:** Eksik veri ayrı reasoning turn’ü olmadan güvenli bir capability ile alınabilir mi?
3. **State freshness:** Mevcut Cognitive View ve Soft Workspace bu observation’dan sonra modelin devam edebilmesi için yeterli mi?
4. **Risk of suppression:** Model turn’ünü atlamak semantic drift veya wrong-path riskini artırıyor mu?

Önerilen decision procedure:

```text
ACTIVE MODEL CONTROLLER
  ↓ requests observation/action
Is the requested sub-step mechanically closed?
  ├─ yes → runtime executes + returns typed observation to workspace
  └─ no  → keep semantic control in the model

Only after state architecture is validated:
Can an entire extra model round-trip be removed without changing decisions?
  ├─ yes → suppress/merge turn and record receipt
  └─ no  → retain model interaction
```

## Invocation reasons

Allowed initial enum:

```text
GOAL_AMBIGUITY
SEMANTIC_DIAGNOSIS
HYPOTHESIS_CONFLICT
NOVEL_ARCHITECTURE
CAPABILITY_DISCOVERY_FALLBACK
UNEXPECTED_RESULT
STATE_CONTRADICTION
LONG_HORIZON_REFRAME
REVIEW_SEMANTICS
```

“Need next step” gibi generic reason kabul edilmemelidir.

## Invocation receipt

```yaml
invocation:
  id: I-291
  reason: HYPOTHESIS_CONFLICT
  unresolved_entities: [H4, H5, C17]
  deterministic_options_exhausted:
    - inspect_config
    - compare_metrics
    - find_recent_changes
  context:
    task_state_tokens: 412
    code_slice_tokens: 1831
    evidence_tokens: 294
    policy_tokens: 381
  model_tier: frontier
  output_tokens: 627
  result:
    proposed_hypothesis: H8
  verification_required: true
```

Bu receipt hem cost accounting hem de sonradan “bu call avoidable mıydı?” audit'i için kullanılır.
