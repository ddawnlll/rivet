# IMPLEMENTATION.md — Rivet Operational Engineering Roadmap & Baseline

**Status:** ACTIVE IMPLEMENTATION PLAN (Edition v0.3 / ACCP 3.0 / Research Monograph Alignment)  
**Rule:** Architecture invention is CLOSED. Implement against typed contracts and monograph invariants only.

---

## 1. Core Technical Invariants

* **Language & Edition:** Rust 2024.
* **Process Model:** Single OS process, in-memory first, zero internal IPC/RPC/gRPC/MCP.
* **Async Runtime:** Tokio only at true I/O boundaries (model streaming, process execution, fs, persistence).
* **Harness Ownership:** Rivet owns its Harness Core, session lifecycle, and cognitive state transitions. External agent frameworks are not lifecycle owners.
* **Hard State ≠ Soft Workspace ≠ Context:**
  * **Hard State (`noesis`):** Event-sourced, durable, evidence-bound project beliefs (`redb` backed).
  * **Soft Workspace (`noesis`):** Task/session bounded active hypotheses, scratchpad, candidate actions in RAM.
  * **Context (`rivet-view`):** Ephemeral, task-conditioned projection derived from Hard + Soft state.
* **ACCP 3.0 Conformance (`accp`):** Strict semantic protocol boundary between probabilistic cognition and authoritative runtime state. Model text cannot mint authority, observations, or completion.
* **Praxis Verification (`praxis`):** Mechanically decidable verification engine. Completion requires passing verification gates and signed receipts.
* **Runtime Execution (`rivet-runtime`):** Scoped process execution, filesystem mutations, and Git operations.
* **Hephaestus (`hephaestus`):** Cold-path reframing only when cognitive loops stagnate (disabled by default).

---

## 2. Workspace Crate Layout Target

```text
crates/
├── rivet                  # [Binary] CLI/TUI composition root (clap + ratatui)
├── rivet-core             # [Engine] Harness Core, Canonical Cognitive Cycle (RunPhase state machine)
├── rivet-types            # [Types] Core shared IDs, Revision, EpistemicStatus, errors
├── noesis                 # [State] HardState (event ledger), SoftWorkspace, StatePromotion, Contradictions
├── rivet-view             # [View] Cognitive View Compiler, multi-stage pipeline, 4 representation modes
├── accp                   # [Protocol] ACCP 3.0 typed message envelopes, semantics & invariant gates
├── praxis                 # [Verification] Scoped test execution, output parsing, VerificationReceipt
├── hephaestus             # [Reframing] Cold-path stagnation detection, frame proposal, policy repair
├── rivet-model            # [Model] ModelBackend trait, CognitiveAction, InvocationReceipt
├── rivet-model-genai      # [Adapter] genai multi-provider implementation
├── rivet-model-rig        # [Adapter] rig multi-provider implementation
├── rivet-mcp              # [Adapter] rmcp external capability bridge (optional/external only)
├── rivet-store            # [Persistence] HardStateStore trait, redb embedded storage backend
├── rivet-repository       # [Induction] Deterministic census, repo frontier, Project Graph, DEFER policy
└── rivet-runtime          # [Execution] OS process runner, file system, Git integration, sandbox
```

---

## 3. Phase-by-Phase Implementation Roadmap

### Phase 1: Critical Fixes & State Model Enrichment (Hızlı Düzeltmeler)
- [x] **1.1 Proje Yapılandırması (`rust-toolchain.toml`):**
  - Rust 2024 edition için kök dizine `rust-toolchain.toml` eklenmesi.
- [x] **1.2 Hephaestus Cold-Path Yeniden Yapılandırması:**
  - `crates/rivet-core/src/lib.rs` içindeki `HephaestusEngine::new(3)` sabit başlatmasını düzeltme.
  - Hephaestus'un varsayılan olarak devre dışı (disabled-by-default) olması, sadece yapılandırma/tetikleyici (`stagnation_threshold`) ile aktif hale getirilmesi.
- [x] **1.3 CLI `--trace` Parametresi & Mekanik İzleme:**
  - `crates/rivet/src/main.rs` içine `--trace` bayrağının eklenmesi.
  - Bilişsel döngü adımlarının, görünüm hash'lerinin ve eylem kararlarının yapısal trace kaydının terminale/loglara aktarılması.
- [x] **1.4 Noesis Çelişki ve Reddedilen İnançlar Modeli:**
  - `crates/noesis/src/lib.rs` içine birinci sınıf `contradictions: HashMap<ClaimId, ContradictionRecord>` ve `rejected_claims: HashMap<ClaimId, RejectionRecord>` eklenmesi.
  - `NoesisEvent::ClaimContradicted` ve `NoesisEvent::ClaimRejected` olaylarının `HardState::apply` ve `replay` içine entegre edilmesi.
  - `CognitiveView` içine `contradictions` ve `rejected_refs` bölümlerinin eklenmesi.

---

### Phase 2: Cognitive View Compiler (`crates/rivet-view` Crate Extraction)
- [x] **2.1 `crates/rivet-view` Crate'inin Oluşturulması:**
  - `Cargo.toml` workspace üyelerine `crates/rivet-view` eklenmesi.
- [x] **2.2 Çok Aşamalı Derleme Hattı (Pipeline):**
  - Deterministic Eligibility Filtering $\rightarrow$ Provenance Path Expansion $\rightarrow$ Relevance Ranking $\rightarrow$ Semantic Compression $\rightarrow$ Contradiction/Rejected Inclusion $\rightarrow$ Model Serialization.
- [x] **2.3 4 Deneysel Temsil Modunun İmplementasyonu:**
  - `RAW_TEXT`, `TRIPLES`, `PATHS`, `HYBRID` format derleyicileri.
  - Token bütçeleme ve `omitted_summary (deferred_trees, token_budget)` hesaplama.
- [x] **2.4 Entegrasyon:**
  - `rivet-core`'un `rivet-view`'e bağlanması ve `noesis` içindeki ilkel metin formatlayıcının kaldırılması.

---

### Phase 3: External MCP Capability Adapter (`crates/rivet-mcp`)
- [x] **3.1 `crates/rivet-mcp` Crate'i ve `rmcp` SDK Bağımlılığı:**
  - Workspace'e ekleme ve `rmcp` ile istemci adaptörü oluşturma.
- [x] **3.2 Dış Araç Keşfi ve Dönüşümü:**
  - MCP araç şemalarının okunması.
  - Dış MCP araç çalıştırma çıktılarının `Observation` ve `EvidenceRef`'e dönüştürülmesi.
- [x] **3.3 Runtime Entegrasyonu:**
  - `rivet-runtime`'ın MCP sağlayıcılarını harici yetenek olarak çağırması.

---

### Phase 4: Adaptive Project Induction & Depo Temsili (`rivet-repository`)
- [x] **4.1 LLM-led Hiyerarşik Relevance Frontier:**
  - Modelin verdiği `FrontierDecision` (`Descend`, `Defer`, `HardExclude`) kararlarını yöneten dinamik keşif döngüsü.
- [x] **4.2 Project Graph & Capability Graph:**
  - Kod, test, build ve konfigürasyon varlıklarının kanıta bağlı yapısal graf modelinin oluşturulması.
- [x] **4.3 Saf Rust `gix` (Gitoxide) Entegrasyonu:**
  - Depo git durumunun ve geçmişinin `gix` ile taranması, CLI fallback mekanizması.

---

### Phase 5: Praxis Mekanik Doğrulama & Kör Hakem (Reviewer Independence)
- [x] **5.1 Kör Bağımsız Denetçi (Blind Reviewer) Topolojisi:**
  - Yüksek riskli (`Material` / `Destructive`) yamalarda implementer context'ini görmeyen izole denetçi çağrısı.
- [x] **5.2 Genişletilmiş Doğrulama Basamakları:**
  - Platform matrisi ve etki alanı değişmezleri için otomatik gate koşucuları.

---

### Phase 6: Runtime Güvenlik Sandbox'ı & Semantik AST Yamalama
- [x] **6.1 İşletim Sistemi Seviyesinde Kaynak Kısıtlamaları:**
  - Bellek tavanı, işlem kotası, process-group sonlandırma ve ağ politikası sınırları.
- [x] **6.2 Rol Tabanlı Yetki (Least-Capability Worker):**
  - Worker rollerine göre izinli/yasaklı aksiyon filtreleri (`deny: git.reset_hard`, `secrets.read`).
- [x] **6.3 Semantik AST / Sembol Tabanlı Yama (Patch Intent):**
  - `symbol://` URI'leri üzerinden AST düzeyinde yapısal yama motoru.

---

### Phase 7: Anayasal Değişmezler (I-01 .. I-20) & Benchmark Paketi
- [x] **7.1 Anayasal Test Paketi:**
  - Monografta listelenen 20 anayasal kuralın (I-01 .. I-20) uçtan uca entegrasyon testlerinin yazılması.
- [x] **7.2 `evals/` Senaryoları:**
  - V8 amiral gemisi, yabancı diller (`alien-rust`, `alien-ts`, `alien-python`) ve greenfield test senaryoları.

---

## 4. Development Invariant Rules

1. **No Semantic Casts:**
   * `ModelClaim ✗→ Observation`
   * `ActionProposal ✗→ ExecutionReceipt`
   * `Test(scope=A) ✗→ Verified(scope=repo)`
   * `CompletionProposal ✗→ Completion`
2. **Replay Determinism:** `same event history → same materialized state`.
3. **No Unanchored Architecture:** No new crate or subsystem without empirical/code-driven necessity.
