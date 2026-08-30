# Token and compute architecture

Token optimization burada prompt engineering detayı değil, **control-plane objective**'idir.

Basit model:

```text
TotalModelCost ≈ Σ_i [uncached_input_i × price_in
                    + cached_read_i × price_cache
                    + output_i × price_out]
```

Ama araştırma metriği yalnızca toplam token olmamalıdır. Asıl hedef:

```text
Verified Task Efficiency = verified solved tasks / model compute cost
```

## Dört ana optimizasyon ekseni

### 1. Invocation count

En büyük teorik kazanç model çağrısının sayısını azaltmaktır. ReWOO'nun interleaved observation loop'u eleştirisi ve StateFlow/LLMCompiler gibi sistemlerin gösterdiği maliyet/latency kazançları, repeated inference'ın önemli overhead yaratabildiğini destekler.

### 2. Context size

Model bütün history yerine relevance-filtered state görür:

```yaml
context_view:
  goal: G1
  active_task: T82
  relevant_facts: [F19, F31]
  hypotheses: [H4, H7]
  contradictions: [C3]
  relevant_symbols: [S9, S17, S18]
  recent_verification: V22
  unknowns: [U7]
```

### 3. Raw-output compression

50.000 token test log'u default olarak modele girmez. Parser:

```yaml
summary:
  total: 1315
  passed: 1312
  failed: 3
  new_failures: [auth_refresh]
  failure_clusters:
    - signature: expired_token_401
      tests: 2
```

üretir. Model yalnızca gerekirse ilgili raw range'i ister.

### 4. Model tiering

```text
Tier 0 — deterministic parser / solver
Tier 1 — local or tiny classifier/router
Tier 2 — cheap general model
Tier 3 — frontier semantic reasoner
```

Tiering'in doğruluğu ayrıca ölçülmelidir; ucuz model routing hatası expensive downstream rework üretebilir.
