# Process-Level Error Attribution

Bun case study'sinden çıkan önemli fikir: aynı failure family tekrar ediyorsa her output'u patch etmek yerine generator/process hatası aranmalıdır.

```text
F91 stubbed implementation
F98 stubbed implementation
F104 stubbed implementation
F111 stubbed implementation
        │
        ▼
Failure Cluster C7
        │
        ▼
possible common cause:
workflow/policy/provider W3
        │
        ▼
Hephaestus / governance review
```

Rivet bunu bir “self-modifying agent” romantizmine çevirmemelidir. Workflow/policy değişikliği versioned challenger olur, benchmark/replay ile test edilir, sonra promotion yapılır.
