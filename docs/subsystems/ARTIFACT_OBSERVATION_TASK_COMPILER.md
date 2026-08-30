# Artifact → Observation → Task Compiler

Bu bileşen önceki mimaride eksik kalan önemli bir köprüdür. Environment zaten birçok durumda “ne yanlış?” hakkında structured signal üretir. Bun'u bir modelin her defasında tekrar okuması gerekmeyebilir.

## Typed observation examples

Rust compiler:

```text
error[E0382]: use of moved value: `x`
```

normalize edilir:

```yaml
observation:
  type: StaticDiagnostic
  provider: rustc
  code: E0382
  severity: error
  location:
    file: src/foo.rs
    symbol: Foo/bar
  effect:
    obligation: build.default
    status: failed
```

Jest:

```yaml
observation:
  type: TestFailure
  test_id: auth.refresh.expired_grace
  expected: 200
  actual: 401
  stack_artifact: E-781
```

HTTP health check:

```yaml
observation:
  type: RuntimeHealthViolation
  endpoint: /health
  expected_status: 200
  actual_status: 500
```

Benchmark:

```yaml
observation:
  type: PerformanceRegression
  metric: p95_latency_ms
  baseline: 41.2
  candidate: 58.9
  threshold: 45.0
```

## Task compilation

Typed observation ile obligation arasındaki relation deterministic ise:

```text
TestFailure(test=T17)
        ↓
reopen Obligation O17
        ↓
generate DiagnoseFailure(T17)
```

Typed observation ile mechanical follow-up açıkça tanımlıysa runtime bu transition’ı doğrudan uygulayabilir; aktif modelin yeniden “test fail oldu, şimdi output’a bakmalıyım” sonucunu üretmesi gerekmez. Semantic diagnosis, hypothesis revision ve strategy yine model cognition’ının alanıdır.
