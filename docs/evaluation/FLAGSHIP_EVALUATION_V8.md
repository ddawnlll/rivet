# Flagship Project Evaluation: V8 Without a V8 Fork

<span class="badge project">PROJECT_DESIGN</span> V8, Rivet'in ilk yüksek-kompleksite flagship acceptance project'idir; **Rivet Core V8'e özel hiçbir semantic type veya rule içermemelidir.** V8'in decision registers, authority hierarchy, evaluation gates, rejected baselines, evidence receipts ve long-lived project history'si yalnız repository induction ile öğrenilmelidir.

Motivating failure class: kullanıcı “sıradaki adım ne; V8.5 gate'lere mi odaklansak; bot ekonomik olarak kötü” dediğinde context-centric agent alakasız/single-asset tape'i körlemesine çalıştırıp mevcut evaluation authority'yi hiçe sayabilir. Rivet'in hedefi bu promptu hard-coded “V8 kuralı” ile değil, task-conditioned retrieval ile çözmektir:

```text
user intent
   ↓
entity resolution: V8.5 + economic evaluation + next obligations
   ↓
retrieve: active constraints + authoritative decisions + rejected paths
          + current evidence + open obligations
   ↓
Cognitive View
   ↓
LLM strategic reasoning
```

Örnek acceptance scenarios:

- “Sıradaki adım ne?” → current obligations/authority/evidence retrieval;
- diagnostic single-asset artifact → canonical baseline diye promote edilmemeli;
- new architecture revision → dependent old claims/procedures stale olabilmeli;
- old rejected approach → aynı scope/revision değişmediyse tekrar “yeni fikir” olarak dirilmemeli;
- authority conflict → silently choose yerine contradiction/open question üretmeli;
- bir hafta/session sonra continuity → chat transcript olmadan durable knowledge korunmalı.

**Anti-overfit rule:** Her V8-derived core feature en az bir alien-project control'da test edilmelidir: ordinary TypeScript service, Python/data project, farklı build ecosystem ve empty-directory greenfield task. Yalnız V8'de yararlı abstraction Rivet Core'a alınamaz.
