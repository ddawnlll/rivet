# Nihai yüksek seviye mimari

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                                  USER                                        │
│                 natural language · approvals · interrupts                    │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     ↕
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CHAT SURFACE                                    │
│     no Plan Mode · no Ask Mode · no Build Mode · no agent-dashboard state   │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     ↕
╔════════════════════════════════════╧═════════════════════════════════════════╗
║                                  RIVET                                      ║
║ persistent identity · execution · state revisions · evidence · authority    ║
╚══════════════════╤════════════════════════════════════════╤══════════════════╝
                   │                                        │
          ┌────────▼────────┐                      ┌────────▼────────┐
          │     NOESIS      │                      │  REPO FRONTIER  │
          │ hard state      │                      │ census/relevance│
          │ soft workspace  │                      └────────┬────────┘
          └────────┬────────┘                               │
                   └──────────────────┬─────────────────────┘
                                      ▼
                           COGNITIVE VIEW COMPILER
                                      ▼
                           FRONTIER LLM CONTROLLER
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
                 reason             state             capability
                 / plan             proposal          request
                    │                 │                 │
                    └──────────┬──────┴──────────┬──────┘
                               ▼                 ▼
                              ACCP             RUNTIME
                         authority/gates     execute/observe
                               └──────────┬──────┘
                                          ▼
                                        PRAXIS
                                 scoped verification
                                          ▼
                                   evidence + revision
```

**Noesis, ACCP, Praxis ve Hephaestus korunur.** Ancak v0.2'de Harness Core semantik cognition'ı modelden devralmaya çalışmaz. Core; persistence, revision, retrieval substrate, execution, authority, accounting ve mechanically decidable transitions için güvenilir altyapıdır.
