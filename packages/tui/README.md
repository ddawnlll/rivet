# Rivet TUI

A Rivet-native terminal interface for software engineering workflows, built on Solid.js and OpenTUI.

## Overview

The Rivet TUI presents an ergonomic coding interface exposing Rivet's epistemic operating model in plain software-engineering language. Rather than treating an LLM session as a raw chat transcript, the interface maintains visible, grounded representations of:

- **Current Work**: Persistent status rail and sidebar summarizing active goal, revision, phase, obligations, and changes.
- **Epistemic State**: Hard verified claims, soft hypotheses, unknowns, and candidate plans.
- **Code Context**: Relevant priority files, related symbols, structural relations, and test suites.
- **Changes & Diffs**: Modified files with line counts, why-changed intent, and verification context.
- **Verification & Obligations**: Obligation satisfaction checklist, automated test results, and completion readiness (`READY`, `BLOCKED`, `OUTDATED`).
- **Memory**: Evaluated cognitive decisions with clear plain-language admission or suppression reasons (`[Used]` vs `[Ignored]`).

## Plain-Language Design Principles

Internal research constructs map strictly to plain software engineering terminology:

| Internal Concept | User-Facing Concept | Description |
|------------------|---------------------|-------------|
| HardState | Hard State / Claims | Verified facts (`✓ VERIFIED`, `● SUPPORTED`, `⚠ DIRTY`, `~ SUPERSEDED`, `× REJECTED`) |
| SoftWorkspace | Workspace | Provisional hypotheses, open unknowns, and current plan |
| MemoryFrontier | Memory | Context admission decisions (`Used` vs `Ignored` with plain reasons) |
| RepositoryFrontier | Relevant Code | Priority files, symbol references, and relations |
| Praxis / Obligations | Verification | Task obligations, test results, and completion readiness |
| ACCP lifecycle | Semantic Events | Compact inline badges (`◆ Inspected files`, `✓ Tests passed`, `⚠ Dirty claim`) |

## Navigation & Keybindings

All views are accessible via modal dialogs, leader keybindings, and slash commands.

| View | Keybinding | Slash Command | Description |
|------|------------|---------------|-------------|
| **State** | `<leader>S` | `/state` | Full state modal with Hard State, Workspace, Memory, and History tabs |
| **Hard State** | — | `/hard`, `/state-hard` | Opens State modal focused on verified claims |
| **Workspace** | — | `/workspace` | Opens State modal focused on hypotheses and current plan |
| **Memory** | `<leader>M` | `/memory` | Opens State modal focused on memory admission decisions |
| **Code Context** | `<leader>C` | `/code` | Priority files, symbol relations, test files, and uncertain items |
| **Changes** | `<leader>D` | `/changes` | File changes list, why-changed context, and full diff viewer trigger |
| **Verify** | `<leader>V` | `/verify` | Verification obligations, test results, and completion readiness |
| **History** | `<leader>H` | `/history` | Revision history log across turns |

*(Note: `<leader>` is configurable in settings, defaulting to `,` or space.)*

## Architecture

```
src/rivet/
├── types.ts           # Clean TypeScript interfaces for UI models
├── projection.ts      # Pure reactive projection from session data, diffs, & tool parts
├── context.tsx        # RivetProvider and useRivet() Solid context
├── components/
│   ├── status-rail.tsx   # Responsive status bar (wide: detailed, narrow: compact symbols)
│   └── current-work.tsx  # Compact sidebar card for active goal, phase, & verification
└── views/
    ├── state-view.tsx    # State modal (Hard State, Workspace, Memory, History)
    ├── code-view.tsx     # Code context modal (Files, symbols, relations, tests)
    ├── verify-view.tsx   # Verification modal (Obligations, test results, readiness)
    └── changes-view.tsx  # Changes modal (Modified files, semantic why, diff trigger)
```

## Testing & Verification

Run tests from the `packages/tui` directory:

```bash
# Run all Rivet-native tests
bun test test/rivet/

# Run complete TUI test suite
bun test

# Typecheck
bun typecheck
```
