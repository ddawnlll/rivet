# Praxis specification: verification as a state transition

<span class="badge project">PROJECT_DESIGN</span> **Praxis bir “truth oracle” değil, bounded mechanical verification layer'dır.** `cargo test → PASS`, yalnız ilgili revision/environment/test contract altında predicate'in geçtiğini kanıtlar; “program tamamen doğrudur” claim'ini mint etmez. Noesis Praxis receipt'inin epistemic scope'unu taşır.

<span class="badge project">PROJECT_DESIGN</span> Praxis'in sorusu “model iyi iş yaptı mı?” değildir. **Belirli acceptance claim'ı environment üzerinde test edildi mi ve test sonucu hangi authority'yi destekliyor?**

## Verification ladder

```text
V0  parse / syntax
V1  static diagnostics
V2  compile / typecheck
V3  targeted unit tests
V4  module / package integration
V5  repository regression suite
V6  platform / configuration matrix
V7  domain-specific invariant / fuzz / performance / security gate
```

Alt basamak üst basamak yerine geçmez. `cargo check = 0` yalnızca compile/type layer'ı kapatır; semantic equivalence veya runtime correctness claim'i vermez.

## Obligation closure

```yaml
obligation:
  id: O-auth-refresh
  acceptance:
    - V2: compile
    - V3: auth_refresh targeted tests
    - V4: oauth/session integration
  status: open

verification_results:
  V2: passed
  V3: passed
  V4: pending

completion: false
```

Model “done” dese bile `completion=false` kalır.

## Differential and adversarial verification

Rivet, mümkün olduğunda independent oracle kullanmalıdır:

- before/after behavior comparison,
- reference implementation parity,
- golden tests,
- differential execution,
- property-based tests,
- fuzzing,
- hidden/untouched tests,
- platform matrix,
- independent reviewer.

Bun'un Rust rewrite'ında language-independent TypeScript test suite'i kritik avantaj sağlamıştır: test oracle implementation language'dan bağımsız kalmıştır. Bu, Rivet için genel bir ders değil, **oracle independence güçlü olduğunda massive mechanical transformation daha güvenli otomatikleştirilebilir** şeklinde daha sınırlı bir çıkarımdır.
