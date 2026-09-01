# ACCP 3.0 Controller Conformance Profile

**Layer:** `ACCP SPEC (normative) → Controller Profile (normative) → Reference System Prompt (non-normative, derived)`
**Status:** Draft, derives from ACCP 3.0 SPEC §6-§12 / §29
**Version:** `accp_version = "3.0"`, `profile_version = "3.0.0"`

This profile defines what a conforming **Cognitive Controller** MAY and SHALL NOT emit. The **Reference System Prompt** is a serialization of this profile for LLM consumption. It SHALL be derived from this profile + machine-readable schema, not hand-authored.

---

## 1. Authority

- Harness owns execution, observation, verification (Praxis), persistence (Noesis), completion.
- Controller owns proposals and hypotheses only.
- Enforcement point is `AccpSemanticGate + HardState` (Rust types), not the prompt.

## 2. Canonical Wire Contract (single)

Controller output SHALL be exactly one `AccpEnvelope`:

```json
{
  "accp_version": "3.0",
  "sender": "COGNITIVE_CONTROLLER",
  "family": "PROPOSAL | QUERY",
  "kind": "<allowed kind>",
  "payload": { "...typed object..." },
  "correlation_id": "optional",
  "scope": { "repository": "...", "revision": 17, "path_pattern": "..." },
  "revision": 17
}
```

Legacy `{ "action_type": "tool_call", "payload": {} }` is a **provider-adapter shorthand**, not the canonical ACCP contract. Adapters SHALL map provider `tool_use` → `PROPOSAL/ACTION` (AccpEnvelope).

## 3. Allowed Controller-Side Messages

```
QUERY/STATE
QUERY/EVIDENCE
QUERY/ARTIFACT
QUERY/CAPABILITY

PROPOSAL/CLAIM
PROPOSAL/ACTION            // capability request, NOT "tool_call"
PROPOSAL/WORKSPACE_DELTA
PROPOSAL/STATE_TRANSITION
PROPOSAL/VERIFICATION
PROPOSAL/COMPLETION
```

All use `sender = COGNITIVE_CONTROLLER`, `family = QUERY|PROPOSAL`.

## 4. Forbidden Controller-Side Messages

Controller SHALL NOT emit (Harness-only):

```
VIEW/*
DECISION/*
RECEIPT/EXECUTION
RECEIPT/OBSERVATION
RECEIPT/EVIDENCE
RECEIPT/VERIFICATION
RECEIPT/STATE_TRANSITION
SIGNAL/*
```

Any `VERIFIED` status, `VerificationReceipt`, or `CompletionDecision` appearing in controller output SHALL be rejected with `INVALID_SEMANTIC_CAST`.

## 5. Verified Semantics (corrected)

```
Controller cannot mint VERIFIED.
Praxis may emit VerificationReceipt { passed, evidence_id, verified_scope }.
Harness/Noesis may admit a VERIFIED state transition ONLY when
  applicable VerificationReceipt + policy + scope/revision checks hold.
Praxis does NOT write VERIFIED directly to Noesis.
```

## 6. Predicate Abstraction (corrected)

Predicates are **abstract, repository-scoped conditions**, not execution strings.

Wrong:
```yaml
predicate: "cargo test"
```

Correct:
```yaml
predicate: "workspace_tests_pass"
scope: { repository: "rivet", revision: 17 }
# Harness/Praxis resolves predicate → execution plan (e.g. "cargo test --workspace")
```

VerificationRequest: `{ obligation_id, predicate: "workspace_tests_pass", target_scope, timeout_seconds }`

## 7. Revision vs Scope

```
revision = temporal state version (HardState.revision). Must equal view.hard_revision at proposal time.
scope    = spatial authority boundary (repository + path_pattern). Must satisfy scope ⊆ permitted_scope.
```

Wrong: `proposal.scope.revision == view.hard_revision` conflated.

Correct:
```
proposal.revision == view.hard_revision
proposal.scope ⊆ Harness.allowed_scope
```

Stale revision → BLOCK. Out-of-scope → BLOCK.

## 8. Evidence Provenance Rule

```
Retrieved state is context, not new evidence. (ACCP §6.12)
```

- CognitiveView contents (claims, evidence summaries, triples, paths) are **context**.
- Controller SHALL NOT cite view contents as newly observed evidence.
- Only `evidence_id` values supplied by Harness `RECEIPT/EVIDENCE` or `recent_evidence[]` are valid `supporting_evidence` references.
- Citing an unseen `evidence_id` → `UNKNOWN_REFERENCE`.

## 9. Output Envelope Schema (controller side)

All payloads SHALL be JSON objects validated against ACCP types in `rivet-types` + `accp`.

Example PROPOSAL/ACTION:
```json
{
  "accp_version": "3.0",
  "sender": "COGNITIVE_CONTROLLER",
  "family": "PROPOSAL",
  "kind": "ACTION",
  "revision": 17,
  "scope": { "repository": "rivet", "revision": 17 },
  "payload": {
    "action_id": "act_...",
    "capability": "file.read",
    "target": "src/config.rs",
    "parameters": {},
    "estimated_risk": "inspect",
    "intent": "inspect current config"
  }
}
```

## 10. Prompt Derivation

Reference prompt SHALL be generated from `controller_profile::{ALLOWED,FORBIDDEN,INVARIANTS}` via `prompt_compiler`. Hand edits to the prompt without updating the profile/schema are non-conforming.

```
ACCP 3.0 SPEC
  ↓
controller_profile.rs (normative constants + JSON Schema)
  ↓ prompt_compiler::compile_reference_prompt()
  ↓
Reference System Prompt (non-normative serialization)
```

Safety enforcement remains in `AccpSemanticGate`, not the prompt.

## 11. Conformance

Controller profile conformance requires all ACCP 3.0 Core conformance (§38) plus this profile's §3-§8. A prompt that diverges from the profile is a conformance error even if the Rust gate still blocks the resulting message.
