# MIGRATION.md — Rivet ⇄ OpenCode Semantic-Replacement Migration Record

**Campaign started:** 2026-09-01
**Rule:** `site/index.html` (generated from `docs/charter`, `docs/contracts`, `docs/architecture`) is the architectural constitution. Where OpenCode behavior conflicts with Rivet constitutional semantics, Rivet wins.

---

## 1. Immutable archive of pre-migration Rivet (Phase 0)

| Item | Value |
|---|---|
| Archived commit (Rust Rivet, full workspace + web + docs) | `9defbb187443faf3b57419f8f3ab6b82a46bdb71` |
| Archive branch | `archive/rivet-rust-pre-opencode` |
| Annotated tag | `archive/pre-opencode-migration` |
| Origin remote at archive time | `https://github.com/ddawnlll/rivet.git` (main, ahead of origin by 15) |
| Policy | Archive branch/tag and their history are NEVER deleted. The Rust implementation is the executable reference/oracle for ACCP, Noesis, Praxis, Cognitive View, revision, evidence and completion semantics. |

## 2. Pinned OpenCode upstream (Phase 1 — completed)

| Item | Value |
|---|---|
| Upstream remote | `https://github.com/anomalyco/opencode` |
| Pinned commit | `ebece6efd7b11401cf1e7390b5a22991b6608cc4` |
| Pin policy | One known-good commit; NO continuous rebase against upstream during the port. |

## 3. Subsystem mapping (Rust → fork)

| Rivet subsystem (Rust, archived) | Fork location (planned) | Ownership |
|---|---|---|
| `accp` | `legacy/rivet-rust/crates/accp` → ported into fork core | Cognition↔runtime semantic boundary |
| `noesis` | ported | Hard State (event-sourced) + bounded Soft Workspace |
| `rivet-view` | ported | Cognitive View compiler (model-facing projection) |
| `praxis` | ported | Scoped mechanical verification, VerificationReceipt |
| `rivet-core` (HarnessCore) | ported | Lifecycle / canonical cognitive cycle |
| `rivet-runtime` | mapped onto OpenCode execution substrate | Execution (commodity) |
| `rivet-model*` | mapped onto OpenCode provider layer | Replaceable substrate |
| `rivet-store` | mapped onto OpenCode session persistence, Hard State stays authoritative | Persistence |
| `hephaestus` | ported (disabled by default) | Cold-path reframing |

## 4. Rust → fork implementation mapping

To be filled per milestone as ports land.

## 5. Test reuse classification (Phase 2)

To be filled: every OpenCode test file → SUBSTRATE / BEHAVIOR / SEMANTIC.
Every removed/replaced semantic test requires a documented Rivet reason + replacement coverage. No deletions for green CI.

## 6. Completed ports

- [x] Phase 0 archive references created (this file, branch, tag).

## 7. Remaining semantic differences

- (open) Full cognitive-loop lifecycle ownership transfer (Harness owns lifecycle; provider tools cannot mint authority; completion requires current-revision Praxis verification).

## 8. Intentionally rejected OpenCode behavior

- (open) Session transcript as authoritative state; tool results silently promoting to verified facts; completion on model prose.

## 9. Known blockers

- None currently. `task` internal tool serializer is broken in this session; TASKS.yaml is the live queue.
