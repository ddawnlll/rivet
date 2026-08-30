# Adaptive Project Induction: generalistliğin çekirdeği

<span class="badge project">PROJECT_DESIGN</span> v0.1'deki Environment Compiler listeleri artık project semantics'in deterministic compiler'ı olarak yorumlanmaz. **Pre-defined project memory yoktur.** Deterministic katman yalnız ucuz sensing/census/probe üretir; “bu repository'de ne önemlidir, hangi artifact authoritative olabilir, hangi subsystem task ile ilişkili?” sorularında LLM ana semantic induction motorudur.

Bu bölümde korunan Cargo/package/pytest/LSP vb. örnekler **high-signal mechanical observations**'dır; universal decision tree değildir. Unseen ecosystem bu listede yoksa Rivet generalistliğini kaybetmemelidir.

## LLM-led Hierarchical Repository Relevance

Production-scale repository'nin tüm dosyalarını indexlemek veya modele göstermek yasak bir başlangıç varsayımıdır. Runtime önce klasör düzeyinde ucuz census sağlar; model yalnız relevant frontier'i recursively genişletir.

```yaml
root:
  - path: src/
    files: 481
    tracked_ratio: 1.0
    action: DESCEND
  - path: docs/
    files: 92
    tracked_ratio: 1.0
    action: DESCEND
  - path: node_modules/
    files: 182441
    tracked_ratio: 0.0
    signals: [dependency_materialization, high_volume]
    action: DEFER
  - path: research/
    files: 311
    action: MAYBE
```

`DEFER` “irrelevant forever” değildir. Örneğin dependency regression taskında `node_modules` veya vendored source yeniden yüksek relevance alabilir. Default goal compute'u **small semantic frontier** üzerinde tutmaktır.

LLM her node için yalnız isim görmez; deterministic signals alabilir: file count/bytes, git tracked ratio, binary/generated candidates, manifest/import references, churn, recent modification, hashes ve cheap parse metadata. **Signals deterministic; relevance judgment semantic.**

## Project Induction Loop

```text
cheap repository census
        ↓
LLM relevance selection
        ↓
selective descent / artifact inspection
        ↓
candidate project ontology + authority hypotheses
        ↓
targeted observations / probes
        ↓
soft state revision
        ↓
promotion candidates → hard state
        ↓
future tasks use incremental revision, not full re-init
```

Existing project için yön `WORLD → STATE`'tir. Greenfield directory için aynı machinery ters yönde çalışır: `INTENT → provisional STATE → WORLD/artifacts → observed STATE`. Bu nedenle “new project mode” ayrı ontology gerektirmez.

<span class="badge inference">DESIGN_INFERENCE</span> Rivet'i generalist yapacak şey bütün dilleri önceden bilmesi değildir; **yeni project'te specialization'ı runtime'da öğrenebilmesi**dir.

## Deterministic Census + Probe Boundary

<span class="badge project">PROJECT_DESIGN</span> Environment Compiler v0.2’de project semantics üreten bir compiler değildir. Görevi yalnızca **ucuz, doğrulanabilir ve semantik olarak iddiasız observations** sağlamaktır. Hangi observations’ın önemli olduğu ve bunların proje hakkında ne anlama geldiği LLM-led Project Induction tarafından belirlenir.

```text
DETERMINISTIC CENSUS
  filesystem tree / counts / sizes
  git tracked-untracked metadata
  file type / binary / generated signals
  hashes / revision identifiers
  cheap manifest and import references
          ↓
LLM-LED RELEVANCE + SEMANTIC INDUCTION
          ↓
TARGETED SAFE PROBE
  command/provider exists?
  returns expected shape?
  scope and revision?
          ↓
OBSERVATION / EVIDENCE
          ↓
NOESIS soft state → promotion candidate
```

Census hiçbir ecosystem için canonical dosya listesi dayatmaz. `Cargo.toml`, `package.json`, `pyproject.toml`, CI config veya language-server metadata yalnız gözlenebilen high-signal artifacts olabilir; bunların yokluğu veya yeni bir build system Rivet Core’da branch eklenmesini gerektirmemelidir.

**Probe semantics:** LLM veya mevcut project state bir capability/provider adayı kurduğunda runtime düşük-risk bir probe ile yalnız o provider contract’ını sınar. Örneğin “bu workspace’te `cargo test` canonical verification’dır” sonucu yalnız `Cargo.toml` görülerek mint edilmez; probe ve project authority/evidence ile scope-bound state olur.

**Boundary rule:** deterministic census “ne var?” sorusunun mekanik kısmını cevaplar; LLM-led induction “ne önemli, neye bağlı, hangi artifact authoritative olabilir?” sorularını cevaplar; Praxis/ACCP ise hangi sonuçların hard state’e hangi authority ile geçebileceğini sınırlar. Environment Compiler bu üç rolü tekrar kendi içinde kopyalamaz.
