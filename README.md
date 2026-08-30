# Rivet — Generalist Epistemic Software Engineering Agent Runtime

**Status: RESEARCH DRAFT 0.3 · PRE-IMPLEMENTATION / EVIDENCE-BOUND.**

Rivet couples a frontier LLM (as active cognitive controller) to persistent evidence-bound hard epistemic state (Noesis), a bounded task-conditioned soft workspace, and a cognitive view compiler.

## Repository Layout

```
docs/                  # source corpus — the single source of truth (Markdown/YAML)
  charter/             #   RIVET_CONSTITUTION.md, ONTOLOGICAL_AUDIT.md, ...
  architecture/        #   HIGH_LEVEL_ARCHITECTURE.md, TECHNICAL_ARCHITECTURE_V03.md, ...
  subsystems/          #   NOESIS_SPEC.md, ACCP_SPEC.md, PRAXIS_SPEC.md, ...
  contracts/           #   TYPED_RUNTIME_CONTRACTS.md, CONTEXT_ARCHITECTURE.md, ...
  audits/              #   BUN_REWRITE_CASE_STUDY.md, ACADEMIC_LITERATURE_AUDIT.md, ...
  evaluation/          #   BENCHMARK_CONSTITUTION.md, FLAGSHIP_EVALUATION_V8.md, ...
  decisions/           #   DECISION_REGISTER.md, OPEN_QUESTIONS.md
  reference/           #   ROADMAP.md, CHANGELOG.md, GLOSSARY.md, ...
site/                  # generated reading artifacts (never hand-edited)
  index.html           #   compiled single-file HTML monograph
tools/                 # monograph compiler and build tooling
  build_monograph.py   #   monograph compiler
  heads/               #   HTML head templates & styles
```

## Rebuilding the Monograph

Reproducible: the same corpus + manifest + script produce byte-identical HTML.

```bash
uv run tools/build_monograph.py --docs docs --out site/index.html
```
