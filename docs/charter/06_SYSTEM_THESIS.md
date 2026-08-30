# System thesis: transient cognition’dan persistent state-coupled agency’ye

v0.1 Rivet'i ağırlıklı olarak “LLM loop'tan persistent deterministic runtime'a geçiş” olarak çerçeveliyordu. v0.2 bu çerçeveyi daraltır. **Asıl karşıtlık model vs runtime değildir; transient cognition vs persistent project reality'dir.**

Klasik context-centric agent kabaca:

```text
USER
  ↓
LLM interprets + reconstructs project state
  ↓
raw tool/action
  ↓
observation appended to context
  ↓
LLM re-reads / re-derives / re-plans
  ↓
...
```

Rivet v0.2 hedefi:

```text
USER
                           ↕
                          CHAT
                           ↕
                     ┌───────────┐
                     │   RIVET   │  persistent identity
                     └─────┬─────┘
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
     NOESIS HARD      SOFT WORKSPACE   EVIDENCE / ARTIFACTS
       STATE                │                │
           └───────────────┬┴────────────────┘
                           ▼
                 COGNITIVE VIEW COMPILER
                           ▼
                 FRONTIER LLM CONTROLLER
               reason · explore · hypothesize
                  edit · act · revise soft state
                           │
                           ▼
                 capability / state requests
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
               ACCP                RUNTIME
          authority/admission    execute/observe
                 │                   │
                 └─────────┬─────────┘
                           ▼
                         PRAXIS
                  bounded verification
                           │
                           ▼
                  NOESIS STATE REVISION
```

Model cognition'ın merkezindedir; fakat modelin context'i project state'in kendisi değildir. Runtime anlamı model adına önceden hardcode etmeye çalışmaz. Bunun yerine persistent reality'yi saklar, task-relevant view üretir, execution side effects'i sınırlar ve mechanically verifiable claims'i Praxis ile bağlar.

Bu nedenle v0.2'nin temel division of labor'ı: **LLM anlamlandırır ve dallanır; Noesis neyin bilindiğini ve hangi statüde bilindiğini taşır; Praxis belirli predicates'i doğrular; ACCP hangi evidence/actor'ın hangi promotion veya action'a yettiğini sınırlar; runtime state'i ve side effects'i güvenilir biçimde uygular.**
