# Metrics and Accounting

Rivet'te token/compute accounting first-class evidence'tır. Bir task “çözüldü” diye yalnızca başarı skoruna bakılmaz.

## Primary metrics

| Metric | Definition | Why it matters |
| --- | --- | --- |
| Verified Resolve Rate | Praxis gates'i geçen task / total tasks | Kalite tabanı. |
| Model Invocation Count | Foundation model request sayısı | Secondary cognitive-economy metric; primary state thesis’i tek başına doğrulamaz. |
| Frontier Invocation Count | High-cost/high-capability model calls | Ekonomik kritik. |
| Uncached Input Tokens | Provider'a yeni işlenen input | Context maliyeti. |
| Cached Input Read | Cache'den okunan prefix tokens | Modern provider accounting. |
| Output / Reasoning Tokens | Model üretimi | Cognition maliyeti. |
| Wall-clock | task start → verified completion | User-facing efficiency. |
| Tool Executions | total execution actions | Over-exploration sinyali. |
| Repeated Reads | same content/version tekrar retrieval | Context/harness waste. |
| Deterministic Transitions | model gerektirmeden gerçekleşen valid state transitions | Core thesis. |
| Wrong Deterministic Transitions | sonradan rollback/contradiction ile yanlışlanan deterministic transitions | Safety/reliability bedeli. |
| Verification Coverage | obligations için executed checks / required checks | Fake completion'a karşı. |
| Human Interventions | approvals/repairs/manual redirects | Autonomy gerçeği. |
| Capability Discovery Hit Rate | discovered provider'ın verify olup reuse edilme oranı | Self-specialization quality. |
| Environment Compile Time | cold/warm project model compile maliyeti | Generalist overhead. |

## Derived metrics

### Model Invocation Density

```text
MID = model_invocations / authoritative_state_transitions
```

Daha düşük her zaman daha iyi değildir. Resolve rate ile birlikte raporlanır.

### Determinization Ratio

```text
DR = valid_deterministic_transitions / authoritative_state_transitions
```

Yüksek DR, ancak wrong-deterministic-transition rate düşükse başarıdır.

### Verified Compute Efficiency

```text
VCE = verified_resolved_tasks / normalized_inference_cost
```

Normalized inference cost provider/model fiyatına veya compute proxy'sine göre açıkça tanımlanır.

### Context Amplification Ratio

```text
CAR = tokens_sent_to_models / unique_relevant_evidence_tokens
```

Aynı bilgi farklı turns boyunca tekrar tekrar taşınıyorsa CAR yükselir.

### Avoidable Invocation Rate

Bir completed run sonradan bağımsız reviewer tarafından replay edilir. Eğer bir model call'un gerekli output'u mevcut state/capability ile deterministic türetilebiliyorsa `avoidable=true` işaretlenir.

```text
AIR = avoidable_model_calls / total_model_calls
```

Bu metric kusursuz değildir; fakat harness inefficiency audit'i için değerlidir.
