# Semantic code operations and token economics

Serena gibi LSP/IDE tabanlı sistemler symbol-level retrieval/editing sağlayarak broad reads ve grep zincirlerini azaltabilir. Ancak semantic tool **her durumda** daha token-efficient değildir. Serena'nın kendi 2026 değerlendirmeleri küçük, bilinen-location değişikliklerde built-in patch'in daha ucuz olabildiğini; cross-file refactor ve büyük symbol rewrite'larda semantic operation'ın avantajlı olabildiğini gösterir.

Bu nedenle Rivet capability resolver yalnızca semantic sophistication'a göre değil, **operation shape + context cost + reliability** ile provider seçmelidir:

```yaml
provider_choice:
  capability: code.modify
  task_shape: one_line_known_location
  candidates:
    - search_replace: estimated_tokens 90
    - semantic_replace_body: estimated_tokens 620
  choose: search_replace
```

Başka task:

```yaml
provider_choice:
  capability: refactor.move_symbol
  task_shape: cross_file_semantic
  candidates:
    - text_patch_chain: estimated_calls 8
    - semantic_move: estimated_calls 1
  choose: semantic_move
```
