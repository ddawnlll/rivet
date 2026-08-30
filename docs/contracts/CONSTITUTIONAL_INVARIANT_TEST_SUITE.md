# Rivet Constitutional Invariant Test Suite

Aşağıdaki testler product correctness'ten bağımsız olarak architecture correctness'i sınar.

| ID | Invariant | Failure meaning |
| --- | --- | --- |
| I-01 | Tüm required obligations VERIFIED olmadan task COMPLETE olamaz. | Fake completion. |
| I-02 | Worker declared write scope dışına mutate edemez. | Authority breach. |
| I-03 | Untrusted project config/hook trust grant öncesi execute edilemez. | Security breach. |
| I-04 | Model text'i doğrudan authoritative fact/state mutation yapamaz. | Epistemic breach. |
| I-05 | Her model invocation valid InvocationReceipt taşır. | Compute/accounting breach. |
| I-06 | Material claim supporting evidence/provenance olmadan promote edilemez. | ACCP breach. |
| I-07 | Stale semantic patch revision mismatch'te reject edilir. | Concurrency integrity breach. |
| I-08 | Reviewer'ın implementer reasoning context'ine blind olması gereken policy enforce edilir. | Independence breach. |
| I-09 | Verification failure ilgili obligation'ı reopen eder. | Praxis breach. |
| I-10 | Capability provider VERIFIED değilse authoritative execution provider sayılmaz. | Discovery/trust breach. |
| I-11 | Token receipt provider accounting ile reconcile olur. | Efficiency evidence breach. |
| I-12 | Human approval/rejection immutable authority event olarak kaydedilir. | Governance breach. |
| I-13 | Raw evidence silinmeden summary supersede edilebilir. | Provenance breach. |
| I-14 | Duplicate/identical reviewer output bağımsız evidence gibi ağırlık kazanmaz. | Correlated evidence inflation. |
| I-15 | Mechanically decidable bir sub-step ayrı model round-trip olmadan yürütülüyorsa semantic responsibility ve resulting observation yine açıkça trace edilir; compute optimizasyonu cognition/authority kaybını gizleyemez. | Premature determinization / hidden cognition loss. |
| I-16 | Benchmark adapter core scheduler semantics değiştiremez. | Benchmark overfitting breach. |
| I-17 | Failed test deletion/skip requires explicit human-authorized goal change. | Oracle corruption. |
| I-18 | Rollback target and pre-state hash recorded without destructive action run edilemez. | Recovery breach. |
| I-19 | Project Graph assertion source/evidence pointer olmadan authoritative olamaz. | Graph reification breach. |
| I-20 | Hephaestus success declaration authority taşımaz; yalnızca new frame/tasks önerebilir. | Separation-of-powers breach. |
