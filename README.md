# Rivet — Generalist Epistemic Software Engineering Agent Runtime

**Status: EXPERIMENTAL IMPLEMENTATION 0.3 · EVIDENCE-BOUND.**

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

## Running the implementation

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo run -p rivet -- census .
cargo run -p rivet -- .
```

The CLI stores resumable Hard State under `.rivet/state.redb`, keeps the
repository census frontier bounded, and accepts `:quit` in the terminal loop.
The default model adapter uses the OpenCode Zen OpenAI-compatible endpoint when
`OPENCODE_API_KEY` (or `OPENCODE_ZEN_API_KEY`) is configured; `RIVET_MODEL_ID`
can select the provider model and defaults to `muse-spark-1.2-contributor-free`.

Alignment test/evaluation evidence is recorded under `evals/runs/`, while
unimplemented high-priority gaps remain explicit in `TASKS.yaml`.

## Rebuilding the Monograph

Reproducible: the same corpus + manifest + script produce byte-identical HTML.

```bash
uv run tools/build_monograph.py --docs docs --out site/index.html
```
