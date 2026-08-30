# Generalist control plane vs project-specific specialization

**v0.2 rule:** Generalist control plane'in görevi project'in nasıl çalıştığını önceden bilmek değil, project hakkında bilinmeyeni temsil edebilmek ve LLM-led induction'ı güvenli biçimde persistent state'e çevirmektir. Core yalnız `Entity/Relation/Observation/Claim/Hypothesis/Unknown/Evidence/Obligation/Capability/Verification` gibi meta-ontology primitives taşıyabilir; `RustWorkspace`, `ReactComponent`, `V8EvaluationGate` gibi project ontology classes runtime'da öğrenilir.

Bu mimarinin ana ayrımı:

```text
GENERALIZE THE CONTROL PLANE
SPECIALIZE THE ENVIRONMENT MODEL
```

Universal core şu kavramları bilir:

```text
build
run
inspect
find_symbol
find_references
modify
verify
test
benchmark
observe_service
rollback
```

Project specialization bunları provider'lara bağlar:

| Abstract capability | Rust | TypeScript | Python | C/C++ | Fallback |
| --- | --- | --- | --- | --- | --- |
| `symbol.references` | rust-analyzer | tsserver | pyright/jedi | clangd | tree-sitter / grep |
| `build.default` | cargo build | package script | project-specific | cmake/ninja | discovered shell |
| `test.targeted` | cargo test | vitest/jest | pytest | ctest/custom | discovered shell |
| `diagnostics.static` | cargo check | tsc/eslint | pyright/ruff | clang-tidy/compiler | build output |
| `refactor.rename` | LSP | LSP | LSP | clangd/IDE | model+verified patch |

Generalistlik iddiası ancak **unseen repository'de doğru provider discovery** ve **cross-language benchmark** ile desteklenebilir.
