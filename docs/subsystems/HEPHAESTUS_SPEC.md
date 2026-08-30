# Hephaestus specification: cold-path cognition

Hephaestus mevcut sistemde kalır fakat always-on “meta-agent” değildir.

**v0.2 clarification:** Hephaestus normal Soft Workspace değildir ve Global Workspace'in external karşılığı olarak always-on çalışmaz. Normal cognition her taskta soft workspace ↔ LLM döngüsüyle yürür. Hephaestus yalnız repeated contradiction, local-search exhaustion veya framing failure durumunda workspace/problem ontology'sini radikal biçimde yeniden çerçeveleyen cold-path service'tir.

## Activation conditions

```text
activate_hephaestus if:
  progress_delta <= epsilon for N cycles
  OR all local hypotheses rejected
  OR repeated failure cluster indicates workflow defect
  OR contradiction persists after available observations
  OR current problem ontology appears malformed
  OR task graph cycles / deadlocks without mechanical resolution
  OR token burn exceeds budget without verified progress
```

Hephaestus'un çıktıları doğrudan mutation değildir; yeni hypothesis, frame revision, search strategy veya scheduler policy proposal'dır. ACCP ve Praxis geçerliliği yine korur.

## Process-level error attribution

Bun rewrite'ındaki önemli patternlerden biri, aynı yanlış davranış tekrarlandığında tek tek kodu düzeltmek yerine workflow/prompt kuralını değiştirmekti. Rivet bunu typed failure clustering'e çevirebilir:

```yaml
failure_cluster:
  signature: implementation_stubbed_to_make_compile_green
  count: 17
  common_origin:
    workflow: compile_fix_worker_v3
  hypothesis:
    generator_policy_missing: "no semantic stubs"
  proposed_action:
    patch_workflow_policy
```

Bu, “self-improvement” iddiası değildir. Daha dar anlamda **repeated-output defects'in generator/process kusuruna bağlanması**dır.
