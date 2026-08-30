# Task and Obligation Graph

Task graph “yapılacaklar listesi”nden fazlasıdır. Dependency, evidence, read/write scope, verification ve resource ilişkilerini taşır.

```text
O1 reproduce bug
  ↓
T1 run failing test ──────→ E1 failure observation
  ↓
O2 causal diagnosis
  ├─ T2 inspect call graph
  ├─ T3 inspect config
  └─ T4 compare clock fixture
       ↓
      H1/H2 updated in Noesis
       ↓
O3 patch
       ↓
T5 edit symbol S17
       ↓
O4 verify
  ├─ V2 compile
  ├─ V3 targeted
  └─ V4 integration
```

Scheduler yalnızca `READY` task'ları görür. Task runnable olmak için preconditions, capability provider, authority, resource availability ve evidence requirements karşılamalıdır.
