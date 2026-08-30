# Ontolojik audit: Tam olarak ne inşa ediyoruz?

Rivet hakkında konuşurken birkaç kategoriyi birbirine karıştırmak büyük hata olur.

| Terim | Bu belgede anlamı | Ne değildir? |
| --- | --- | --- |
| **Model** | Semantik yorumlama, novel hypothesis, ambiguous reasoning veya gerektiğinde code synthesis yapan foundation model | Agent'ın kendisi değildir |
| **Harness / Runtime** | State, scheduling, capabilities, execution, persistence, budgets ve rollback'i yöneten control plane | Sadece model API wrapper'ı değildir |
| **Agent** | User goal + persistent state + policies + capabilities + environment interaction + selective model cognition bütünüdür | Sürekli çalışan LLM loop'u olmak zorunda değildir |
| **Project model** | Repository hakkında runtime'da türetilen ve evidence ile bağlı temsil | Repository'nin kendisi veya eksiksiz ground truth değildir |
| **Graph** | Belirli ilişkileri açıklaştıran temsil | “Gerçekliğin doğal biçimi” değildir; yanlış/eksik olabilir |
| **Capability** | Bir ihtiyacı belirli precondition/side-effect/verification contract'ıyla gerçekleştirebilen işlem | Tool adıyla özdeş değildir |
| **Observation** | Environment'tan gelen ölçüm/çıktı | Otomatik olarak fact veya doğru interpretation değildir |
| **Claim** | Observation'lardan türetilen önerme | Evidence'ın kendisi değildir |
| **Verification** | Belirli acceptance condition'ın gerçekten karşılandığını sınayan işlem | Modelin “looks good” demesi değildir |
| **Token efficiency** | Başarı başına model compute tüketiminin azalması | Sadece prompt'u kısaltmak değildir |

Bu ontoloji, Noesis'in temel ayrımıyla uyumludur: **RAW EVIDENCE ≠ INTERPRETATION ≠ CLAIM ≠ VERIFIED KNOWLEDGE**. Project graph veya LSP sonucu da bu kuralın dışında değildir. Bir language server'ın “0 reference” döndürmesi, “gerçekte hiçbir kullanım yoktur” önermesine ancak provider kapsamı ve indexing koşulları doğrulandıysa dönüşebilir.

## Active cognitive controller

<span class="badge project">PROJECT_DESIGN</span> v0.2'de modelin işlevsel rolü **active cognitive controller**'dır. Model Rivet'in persistent kimliği değildir; fakat invocation sırasında yalnızca tavsiye veren pasif servis de değildir. Hipotez kurar, repository exploration yönünü seçer, code/artifact mutation önerir veya gerçekleştirir, soft workspace'i aktif biçimde günceller ve hard-state mutation proposal'ları üretir.

```text
RIVET = persistent agent system
LLM invocation = transient active cognitive controller inside Rivet

LLM ∈ Rivet
Rivet ≠ LLM
```

Runtime'ın modeli sınırladığı alan semantik düşünme değil, **persistence, authority, verification status ve irreversible side effects**'tir. Bir modelin aynı önermeyi tekrar etmesi evidence authority'yi artırmaz; bir action'ı istemesi onu yetkili hale getirmez; “done” demesi completion değildir.
