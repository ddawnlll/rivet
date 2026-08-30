# Stable knowledge artifacts

Bir kere pahalı semantic reasoning ile çıkarılan ve sonradan doğrulanan stabil bilgi serialized artifact'e dönüşür:

```text
PROJECT_MODEL.json
CAPABILITIES.json
ARCHITECTURE_CONSTRAINTS.yaml
PORTING_RULES.md
OWNERSHIP.tsv
API_GRAPH.bin
TEST_MAP.json
```

Bun rewrite'ındaki `PORTING.md` ve `LIFETIMES.tsv` bu pattern'in güçlü endüstriyel örnekleridir. Aynı knowledge'ın her worker tarafından sıfırdan yeniden türetilmesi yerine ortak artifact kullanılmıştır.
