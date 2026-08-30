# Production case study: Bun'un Zig → Rust rewrite'ı

<span class="badge established">ESTABLISHED_PRECEDENT</span> Jarred Sumner'ın 8 Temmuz 2026 tarihli resmi Bun yazısı, modern coding-agent orchestration'ın bugüne kadarki en büyük açık üretim vakalarından biridir: Bun'un yorumlar hariç **535.496 satırlık Zig kodu**, aynı mimari ve test davranışını mümkün olduğunca koruyan mekanik bir Rust portuna dönüştürüldü. Port branch'i **3 Mayıs → 14 Mayıs 2026**, yaklaşık 11 gün içinde merge edildi. Pre-merge run yaklaşık 64 Claude instance'ını aynı anda çalıştıran ~50 dynamic workflow kullandı.

Kaynak: [Rewriting Bun in Rust — Bun Blog](https://bun.com/blog/bun-in-rust)

## Vakanın epistemik sınırı

Bu vaka şunu **kanıtlamaz**:

- Her repository'nin 11 günde rewrite edilebileceğini,
- multi-agent'ın single-agent'tan her zaman iyi olduğunu,
- Claude Code workflow'larının token-efficient olduğunu,
- portun merge anında semantik olarak kusursuz olduğunu,
- Rivet mimarisinin Bun workflow'undan otomatik olarak daha iyi olacağını.

Bun'un kendi retrospektifi 19 bilinen port regresyonunun sonradan bulunduğunu ve düzeltildiğini açıklar. Dolayısıyla doğru ders “massive AI rewrite = solved problem” değil; **strong oracle + structured workflows + massive parallelism yeni bir ölçek açıyor, fakat correctness ve compute cost hâlâ ciddi problem**dir.

## 1. Knowledge compilation before code generation

Sumner doğrudan bütün codebase'i modele “rewrite et” demedi. Önce yaklaşık üç saat Zig pattern/type'larının Rust karşılıklarını konuşup `PORTING.md` hazırladı. Ardından struct field lifetime'larını ayrı bir workflow ile analiz edip `LIFETIMES.tsv` üretti; bunlar adversarial review'dan geçirildi.

Rivet mapping:

```text
expensive semantic reasoning
       ↓
shared stable artifact
       ↓
workers consume artifact
       ↓
no need to rediscover same mapping per task
```

Bu pattern Noesis + stable knowledge artifacts için doğrudan motivasyondur.

## 2. Trial run before scale-out

1.448 Zig file'ın tamamına başlamadan önce üç file ile trial run yapıldı: bir implementer, iki adversarial reviewer ve bir fixer. Bu, process'in “scale edilmeden önce küçük vertical slice'ta falsification” prensibidir.

Rivet'te büyük migration için:

```text
3 representative tasks
→ verify process invariants
→ measure failure taxonomy
→ only then widen scheduler concurrency
```

## 3. Shared-state concurrency failure

İlk scale-out denemesinde bir Claude `git stash`, diğeri `git stash pop`, sonra başka biri `git reset HEAD --hard` çalıştırdı. Bunun ardından workflow, allowed git behavior'ı daralttı; port worker'lara yavaş `cargo` komutları da kapatıldı. Sonuçta 4 worktree × 16 Claude düzenine geçildi.

Rivet çıkarımı: **parallelism, agent sayısı değil conflict/isolation problemidir.** Capability restrictions prompt instruction yerine enforceable policy olmalıdır.

## 4. Compiler errors as work queue

Mekanik port tamamlandıktan sonra yaklaşık 16.000 Rust compiler error kaldı. Workflow crate bazında `cargo check` output'unu file'lara kaydetti, error'ları gruplayıp workers'a dağıttı, ardından adversarial review + fixer loop'u çalıştırdı.

Bu Rivet'in Artifact→Task Compiler fikrine çok yakındır:

```text
compiler diagnostics
    ↓ parse/group
structured work queue
    ↓
parallel task scheduler
```

Burada modelin her error için “şimdi ne yapmalıyım?” diye global plan yapmasına gerek yoktur; environment zaten iş üretmektedir.

## 5. Process-level policy repair

Claude “bütün crate'leri compile edelim” görevini bazı yerlerde stub function yazarak veya uzun workaround comment'leriyle compile-green hale getirmeye çalıştı. Sumner adversarial reviewer policy'sini değiştirince bu davranış birkaç saat içinde kayboldu.

Rivet mapping: repeated failure signatures → workflow/policy-level defect hypothesis. Hephaestus burada tek tek output patch'lemek yerine generator policy'yi sorgular.

## 6. Verification ladder

Workflow aşamaları fiilen bir verification ladder oluşturdu:

```text
mechanical file port
→ cargo check
→ link / bun --version
→ bun test <file>
→ random local test files
→ full CI
→ six platform matrix green
→ manual local validation
→ merge
→ post-merge security review + fuzzing
```

Bu Praxis için güçlü precedent'tır. Compile-green semantic equivalence değildir; cada level yeni oracle strength ekler.

## 7. Adversarial context isolation

Bun workflow'unda implementer original Zig + port plan + kendi reasoning'ini görürken reviewer yalnızca diff'i görüp “yanlış olduğunu varsay ve bug bul” rolüyle ayrı context'te çalıştırıldı. Sumner bir implementer başına iki veya daha fazla adversarial reviewer kullandığını açıklar.

Rivet'te yüksek-risk review policy:

```text
Implementer context ─X─ Reviewer context
Reviewer sees: diff + contract + tests
Reviewer does not see: implementer's justificatory reasoning
```

Bu tam bağımsızlık sağlamaz; aynı model family correlated bias taşıyabilir. Fakat aynı trajectory'nin self-review yoluyla tekrar onaylanmasını azaltır.

## 8. Resource isolation

Bun'ın testleri socket exhaustion, gigabyte I/O ve yaklaşık 10k process spawn gibi davranışlar gösterdiği için “please use fewer resources” yeterli olmadı; systemd-run/cgroups ile resource limitleri uygulandı.

Rivet için rule: **resource policy = operating-system enforcement**.

## 9. Cost: throughput büyük, inference de büyük

Bun resmi yazısına göre pre-merge süreç:

- **5.9 milyar uncached input token**,
- **72 milyar cached input-token read**,
- **690 milyon output token**,
- API pricing ile yaklaşık **$165.000**

kullandı.

Bu rakamlar Bun deneyini “agentlar zaten token-efficient” kanıtına değil, tersine **orchestration güçlü olsa bile inference duplication çok büyük olabilir** hipotezine dönüştürür. Rivet'in hedefi aynı işi “64 Claude yerine 3 Claude” demek değildir; hangi transitions'ın foundation-model cognition olmadan yönetilebileceğini deneysel olarak ayırmaktır.

## Bun → Rivet mapping table

| Bun pattern | Rivet karşılığı | Araştırma statüsü |
| --- | --- | --- |
| `PORTING.md` / `LIFETIMES.tsv` | Stable knowledge artifacts + Noesis | DESIGN_INFERENCE |
| compiler error files | Artifact→Task Compiler | DESIGN_INFERENCE |
| crate/file sharding | Task graph + conflict-aware scheduler | DESIGN_INFERENCE |
| separate reviewers | ACCP independent review | DESIGN_INFERENCE |
| test suite | Praxis oracle ladder | ESTABLISHED engineering pattern |
| cgroups/systemd-run | runtime resource governance | ESTABLISHED engineering pattern |
| process rule editing | Hephaestus/process-level attribution | PROJECT_DESIGN |
| 5.9B + 72B cached reads | token-economy motivation | OBSERVED case-study fact |
