# Benchmark Constitution

Rivet herhangi bir benchmark'ta yalnızca score kovalamak için benchmark-specific heuristics ekleyemez. Benchmark runner ile general runtime arasında açık bir adapter sınırı bulunmalıdır.

## Benchmark families

### SWE-bench

**Jimenez et al., 2023 — [SWE-bench: Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770)**

Repository-level issue resolution için temel benchmark. Fakat benchmark kalitesi, test coverage ve issue leakage gibi eleştiriler bulunduğundan tek otorite değildir.

### Multi-SWE-bench

**Zan et al., 2025 — [Multi-SWE-bench: A Multilingual Benchmark for Issue Resolving](https://arxiv.org/abs/2504.02605)**

Java, TypeScript, JavaScript, Go, Rust, C ve C++ dahil 1.632 instance sunarak Rivet'in cross-language generalization claim'i için daha uygun bir test alanı sağlar.

### SWE-PolyBench

**Rashid et al., 2025 — [SWE-PolyBench: A multi-language benchmark for repository-level issue resolution](https://arxiv.org/abs/2504.08703)**

Java/JavaScript/TypeScript/Python içeren 21 repository ve 2.110 task ile ek multilingual coverage sağlar.

### SWE-rebench V2

**Badertdinov et al., 2026 — [SWE-rebench V2](https://arxiv.org/abs/2602.23866)**

On binlerce task, binlerce repository ve çok sayıda programlama diliyle daha büyük ölçekli, environment synthesis içeren benchmark ailesidir. Rivet'in Environment Compiler'ı için özellikle değerlidir.

### SWE-bench Live

**Zhang et al., 2025 — [SWE-bench Live](https://arxiv.org/abs/2505.23419)**

Daha güncel ve updateable issue set'iyle contamination/staleness riskini azaltmayı hedefler.

### SWE-bench Science

**Xu et al., 2026 — [SWE-bench Science: Can Coding Agents Resolve Engineering Tasks in Science?](https://arxiv.org/abs/2608.19799)**

119 task, 98 repository ve 20 scientific domain içerir. Makale tested agents içinde en güçlü pass@1'in %50'nin altında kaldığını, guided knowledge'ın doğru bağlandığında token efficiency'yi iyileştirebildiğini fakat kötü guidance'ın anchoring yaratabildiğini raporlar.

Bu benchmark Noesis context selection ve knowledge-grounding için güçlü OOD testidir.

## Long-horizon transformation benchmark

SWE-bench tek başına yeterli değildir. Rivet için ayrıca aşağıdaki family oluşturulmalıdır:

- language migration (küçük/orta repo);
- framework major-version migration;
- cross-file API redesign;
- monorepo package split/merge;
- build-system migration;
- large-scale mechanical refactor + semantic residue;
- multi-platform CI repair;
- performance regression localization + verified patch.

Bu benchmark'ın oracle'ları executable olmalı; yalnızca human “looks good” verdict'i yeterli değildir.
