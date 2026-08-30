# Rivet: Generalist Epistemic Software Engineering Agent Runtime

**Araştırma monografı · anayasa · mimari spesifikasyon · literatür denetimi · falsification programı****Sürüm:** Research Draft 0.3 · **Tarih:** 30 Ağustos 2026**Durum:** PRE-IMPLEMENTATION / EVIDENCE-BOUND · TECHNICAL PROFILE LOCKED FOR FIRST VERTICAL SLICE

> [!NOTE]
> **Okuma kuralı.** Bu belge Rivet'in Claude Code, Codex, Pi, SWE-agent, OpenCode veya başka bir coding agent'tan kanıtlanmış biçimde daha hızlı, ucuz ya da güvenilir olduğunu iddia etmez. v0.2'nin epistemik tezi korunur: **frontier LLM ana generalist semantik motor olarak kalır; Rivet onun geçici ve yanılabilir cognition'ını persistent epistemik state, bounded working state, evidence, authority ve verification ile çevreler.** v0.3 bu tezi değiştirmez; onu ilk implementation için teknik bir profile bağlar. **Rivet kendi Harness Core'una sahip self-contained agentic software-development system'dır; model/provider/frontend/backend değiştirilebilir, fakat cognitive lifecycle ve state semantics Rivet'e aittir.** İlk implementation full Rust, single-process ve in-memory-first çalışır; internal IPC yoktur. Model-sparse execution hâlâ secondary outcome'dur. Noesis + ACCP + Praxis + Hephaestus korunur; performans iddiaları eş-model, eş-capability, eş-repository ve execution-based benchmark gerektirir.

## Kanıt etiketleri

Bu belgede iddialar şu statülerle ayrılır:

- <span class="badge established">ESTABLISHED_PRECEDENT</span>: Dış kaynakta açıkça gösterilmiş mimari, yöntem veya ampirik sonuç.
- <span class="badge project">PROJECT_DESIGN</span>: Rivet için tasarlanan, henüz bağımsız deneyle doğrulanmamış mimari karar.
- <span class="badge inference">DESIGN_INFERENCE</span>: Mevcut kanıttan türetilen fakat ayrıca sınanması gereken mühendislik çıkarımı.
- <span class="badge invariant">LOCKED_INVARIANT</span>: Deney süresince korunması önerilen güvenlik / epistemik geçerlilik kuralı.
- <span class="badge provisional">PROVISIONAL_DECISION</span>: Geri döndürülebilir implementasyon kararı.
- <span class="badge open">OPEN_QUESTION</span>: Verinin henüz cevaplamadığı soru.
- <span class="badge falsifier">FALSIFIER</span>: İddianın zayıflamasına veya terk edilmesine yol açacak gözlem.
