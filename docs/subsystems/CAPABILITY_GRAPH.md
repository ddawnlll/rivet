# Capability Graph

Capability Graph “hangi tool'lar var?” listesi değildir. Capability ihtiyaçları ile provider'lar, preconditions, side effects, cost ve reliability ilişkisini açıklar.

```text
Capability(symbol.references)
    ├─ provided_by → rust-analyzer.references
    │                  ├─ requires → indexed_workspace
    │                  ├─ effect → read_only
    │                  ├─ confidence → 0.98
    │                  └─ cost → low
    └─ fallback → ripgrep
                       ├─ semantic_precision → lower
                       └─ cost → low
```

Büyük capability registry'sini her model call'a prompt olarak vermek ölçeklenmez. 2026 tarihli **Enrich-Retrieve-Rank** çalışması 7.278 capability ölçeğinde full-context routing'in ciddi biçimde bozulduğunu ve retrieve-then-rank yaklaşımının maliyeti dramatik azaltabildiğini raporlar. Rivet bu sonucu doğrudan “bizim yöntemimiz doğrudur” diye kullanamaz; fakat capability discovery'yi prompt stuffing yerine ayrı bir retrieval/ranking problemi olarak tasarlamak için güçlü precedent sağlar.
