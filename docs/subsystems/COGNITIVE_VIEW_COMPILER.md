# Cognitive View Compiler

<span class="badge project">PROJECT_DESIGN</span> Storage representation ile model-facing representation aynı şey değildir. SQL tables, event logs, graph edges veya embeddings authoritative substrate için uygun olabilir; fakat LLM'in reasoning yapacağı payload query-conditioned biçimde derlenmelidir.

```text
HARD STATE ───────────┐
SOFT WORKSPACE ───────┼─→ relevance / path selection
USER INTENT ──────────┤          ↓
REPO FRONTIER ────────┤   semantic compression
RECENT EVIDENCE ──────┘          ↓
                           COGNITIVE VIEW
                                ↓
                               LLM
```

Örnek hybrid projection:

```yaml
cognitive_view:
  subject: canonical_evaluation
  current_understanding: >
    Portfolio-level evaluation is authoritative; a single-asset run is diagnostic
    unless an active decision explicitly promotes it.
  active_workspace:
    focus: [economic_health, next_gate]
    hypotheses: [H-soft-2]
  durable_constraints:
    - no_unanchored_evaluation
  rejected_paths:
    - proposition: single_asset_is_canonical
      status: rejected
      evidence_refs: [D-...]
  open_obligations:
    - establish_current_economic_health
  unknowns:
    - prior_receipt_admissibility_under_current_revision
  relevant_artifacts:
    - evaluation_manifest
    - decision_register
```

v0.2 doğrudan representation ablation ister: **(A) raw retrieved text, (B) triples, (C) selected graph paths, (D) hybrid semantic+typed cognitive view.** Aynı underlying evidence altında next-action accuracy, contradiction detection, rejected-belief recall, unsupported relation üretimi, token cost ve latency ölçülmelidir. “Graph kullanmak” katkı değildir; doğru cognitive serialization katkı olabilir.
