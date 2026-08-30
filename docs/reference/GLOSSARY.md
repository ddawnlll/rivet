# Glossary

**Agent:** Kullanıcı hedefi üzerinde persistent state ve authority altında çevreyle etkileşen bütün computational system; LLM ile eşanlamlı değildir.

**Harness Core:** Rivet'in kendi cognitive lifecycle, model invocation, state/view transition, execution orchestration, cancellation ve continuation semantics'ini taşıyan merkez. Rivet harness-agnostic değildir; Harness Core ürünün iç parçasıdır.

**Repository Census / Probe:** Unseen project için filesystem/git/process metadata ve targeted probes üreten mekanik sensing katmanı; semantic project induction ve relevance kararı LLM-led frontier'a aittir.

**Project Graph:** Code/build/test/service entities ve evidence-backed relations'ın derived representation'ı. Reality'nin kendisi değildir.

**Capability:** “Ne yapılması gerekiyor?” sorusunun abstract operation cevabı; provider'dan ayrıdır.

**Provider:** Capability'yi mevcut environment'ta gerçekleştiren concrete mechanism.

**Observation:** Environment/tool output'tan extracted typed state candidate.

**Evidence:** Provenance ve immutable content reference taşıyan observation/artifact record.

**Obligation:** Goal completion için kapanması gereken explicit requirement.

**Noesis:** Problem ontology, facts/inferences/hypotheses/unknowns/contradictions ve completion knowledge state'i.

**ACCP:** Claim ve action'lar için evidence/authority/risk/reversibility governance.

**Praxis:** Reality check; tests/invariants/acceptance gates üzerinden verification.

**Hephaestus:** Normal scheduler tıkandığında devreye giren cold-path hypothesis/frame-revision service.

**Invocation Economy:** State quality kanıtlandıktan sonra mekanik veya tekrarlı cognition'ı azaltmaya çalışan secondary cost policy; Rivet'in primary cognition ownership modeli değildir.

**Semantic uncertainty:** Mevcut observation/capabilities ile next transition'ın authoritative biçimde türetilemediği durum. Sadece model confidence score değildir.

**Deterministic transition:** Aynı authoritative state ve environment preconditions altında model semantic judgment gerektirmeyen state transition.

**Artifact → Task Compilation:** Compiler/test/CI/static-analysis outputs gibi artifacts'ı typed observations ve actionable obligations/tasks'a dönüştürme.

**Context View:** Authoritative state'in model için minimal, task-specific projection'ı; authoritative memory değildir.

**Verification Ladder:** Risk/goal'a göre static→compile→targeted→integration→regression→cross-platform vb. gates.

**Hard State:** Noesis'in durable, evidence/scope/revision-bound persistent epistemic project state'i.

**Soft Workspace:** Task/session/worker scoped, bounded, high-plasticity, non-authoritative active working state; context window ile eşanlamlı değildir.

**Cognitive View Compiler:** Hard state, soft workspace, user intent, evidence ve repository frontier'dan model cognition'ı için task-conditioned representation üreten katman.

**Project Induction:** Unseen repository'de LLM-led semantic exploration ile candidate ontology/procedures/authority relationships oluşturup evidence ile persistent state'e bağlama süreci.

**Repository Relevance Frontier:** Tüm repository'yi ingest etmek yerine recursively genişletilen, task-relative olarak inspect/defer edilen hierarchical artifact frontier.

**Epistemic Ossification:** Yanlış veya aşırı güçlü model inference'ının persistent hard state'e yerleşip gelecek cognition'ı sistematik biçimde saptırması.
