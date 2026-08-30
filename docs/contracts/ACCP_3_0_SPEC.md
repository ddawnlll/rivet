# ACCP 3.0
## Cognitive Controller–Harness Semantic Protocol

**Protocol specification**  
**Edition:** 3.0 Draft 1  
**Status:** Draft International-Standard-Style Specification  
**Language:** English normative terminology with implementation examples  
**Date:** 2026-08-30

---

## Foreword

ACCP defines a strict semantic protocol between a **Cognitive Controller** and an **Authoritative Harness**.

This document specifies protocol roles, semantic types, message classes, authority boundaries, evidence semantics, verification semantics, state-transition rules, revision binding, conformance requirements and serialization requirements.

ACCP is not a model API, tool API, memory system, verification engine, policy engine, scheduler or chain-of-thought representation.

An implementation conforming to this document shall preserve the semantic distinctions defined herein regardless of its internal architecture, model provider, programming language, storage engine or execution substrate.

---

# 1 Scope

This document specifies the ACCP protocol for exchange of semantically typed commitments and authoritative runtime events between:

a) a **Cognitive Controller**, which performs semantic interpretation, reasoning, planning, hypothesis formation and action selection; and

b) an **Authoritative Harness**, which owns or mediates execution authority, runtime observations, capability enforcement, persistent state transitions and authoritative completion.

This document defines:

a) actor roles;

b) the normative ACCP ontology;

c) protocol message classes;

d) protocol message envelopes;

e) claim, observation, evidence and verification semantics;

f) action proposal and execution semantics;

g) authority and capability semantics;

h) state-transition semantics;

i) completion semantics;

j) scope and revision binding;

k) protocol error handling;

l) protocol versioning and extensibility;

m) serialization requirements;

n) conformance requirements.

This document does not specify:

a) how a Cognitive Controller performs private reasoning;

b) how an LLM provider exposes tool calling;

c) how the Harness internally implements memory, scheduling, verification, persistence or policy;

d) any particular programming language;

e) any particular transport protocol;

f) any mandatory persistent file format;

g) any domain-specific task ontology.

---

# 2 Normative references

There are no mandatory external normative references in this edition.

Implementations using JSON serialization should conform to a standards-compliant JSON implementation.

---

# 3 Terms and definitions

For the purposes of this document, the following terms and definitions apply.

## 3.1 ACCP

semantic protocol defining the boundary between probabilistic cognition and authoritative runtime state

ACCP defines legal semantic categories and transitions across this boundary.

---

## 3.2 Cognitive Controller

actor responsible for semantic interpretation and cognitive decision-making

A Cognitive Controller may be implemented by:

a) a large language model;

b) a reasoning model;

c) a compound model system;

d) a latent reasoner;

e) a multi-model controller;

f) another semantic decision system.

A Cognitive Controller is not, by virtue of being a controller, an authoritative source of execution, observation, verification or persistent-state truth.

---

## 3.3 Harness

actor owning or mediating authoritative runtime operations

The Harness may contain or coordinate execution, state, verification, evidence, capability and policy subsystems.

The Harness is the authoritative ACCP endpoint for decisions and receipts.

---

## 3.4 commitment

externally relevant semantic output of cognition capable of affecting subsequent runtime behaviour

Examples include:

a) an action proposal;

b) a claim;

c) a state-transition proposal;

d) a verification proposal;

e) a completion proposal.

Private reasoning is not a commitment.

---

## 3.5 observation

record of an event, measurement or output originating from an environment or authoritative observation mechanism

An observation is not an interpretation of that event.

---

## 3.6 claim

truth-evaluable proposition concerning a world, state, artifact, mechanism or task

A claim is not evidence.

---

## 3.7 evidence

provenance-bound record that may support, contradict or otherwise bear upon a claim or decision

The existence of an evidence reference does not imply evidence sufficiency.

---

## 3.8 proposal

request or semantic commitment emitted by the Cognitive Controller for consideration by the Harness

A proposal does not itself alter authoritative runtime state.

---

## 3.9 decision

authoritative Harness response to a proposal or governed request

---

## 3.10 receipt

authoritative record that a runtime-relevant event occurred or that a bounded verification was performed

---

## 3.11 verification

evaluation of a defined predicate under a defined scope, revision and verification procedure

Verification is not unrestricted truth.

---

## 3.12 capability

authorizable class of operation

A capability is distinct from the concrete tool or provider used to implement it.

Example:

```text
capability: vcs.status
provider: git status --short --branch
```

---

## 3.13 authority

permission for an actor or subsystem to cause a defined authoritative effect

---

## 3.14 scope

boundary within which a semantic object, capability, decision, evidence item or verification result applies

---

## 3.15 revision

identified version of mutable state to which a protocol object is bound

---

## 3.16 completion

authoritative Harness state indicating that applicable task completion requirements have been satisfied

A controller statement that work is complete is not itself completion.

---

# 4 Normative verbal forms

Within this document:

**shall** indicates a requirement;

**shall not** indicates a prohibition;

**should** indicates a recommendation;

**should not** indicates a discouraged practice;

**may** indicates permission;

**can** indicates a possibility or capability.

---

# 5 Protocol architecture

## 5.1 General model

ACCP shall operate according to the following abstract architecture:

```text
             Cognitive Controller
                      │
                      │ ACCP
                      │
                      ▼
             Authoritative Harness
          ┌───────────┼────────────┐
          │           │            │
       execution     state     verification
          │           │            │
          └───────────┴────────────┘
                      │
                  environment
```

The implementation may place all components in one process.

ACCP shall not require network communication.

ACCP shall not require serialization between components when native typed values provide equivalent protocol semantics.

---

## 5.2 Boundary ownership

The Cognitive Controller shall own semantic cognition.

The Harness shall own or mediate authoritative runtime effects.

The Controller may determine:

a) what information is relevant;

b) what hypothesis to consider;

c) what action would be useful;

d) whether further investigation is needed;

e) what patch or plan to propose;

f) whether completion appears warranted.

The Controller shall not unilaterally determine:

a) that a proposed action was executed;

b) that an environment observation occurred;

c) that a verification predicate passed;

d) that authority exists;

e) that an authoritative state mutation occurred;

f) that authoritative completion occurred.

---

# 6 Fundamental semantic invariants

## 6.1 General

Every conforming implementation shall preserve the invariants in 6.2 through 6.14.

---

## 6.2 Proposal is not execution

```text
PROPOSAL ≠ EXECUTION
```

An `ACTION` proposal shall not be represented as an execution receipt without an intervening authoritative execution event.

---

## 6.3 Claim is not observation

```text
CLAIM ≠ OBSERVATION
```

A proposition generated through controller inference shall not be classified as an observation solely because the Controller asserts it.

---

## 6.4 Observation is not interpretation

```text
OBSERVATION ≠ INTERPRETATION
```

A Harness shall preserve the distinction between environmental output and semantic conclusions drawn from that output.

---

## 6.5 Evidence is not verification

```text
EVIDENCE ≠ VERIFICATION
```

Evidence may support a claim without satisfying a defined verification predicate.

---

## 6.6 Evidence reference is not evidence sufficiency

```text
EVIDENCE_REFERENCE ≠ SUFFICIENCY
```

The presence of one or more evidence references shall not automatically authorize promotion of a claim.

---

## 6.7 Execution success is not task success

```text
EXECUTION_SUCCESS ≠ TASK_SUCCESS
```

Successful execution of a tool, command, patch or mutation shall not automatically imply correctness of the intended semantic effect.

---

## 6.8 Patch application is not fix verification

```text
PATCH_APPLIED ≠ BUG_FIXED
```

---

## 6.9 Verification is predicate-scoped

```text
VERIFY(P1) ≠ VERIFY(P2)
```

A verification result shall authorize only claims covered by its predicate, scope and revision.

---

## 6.10 Completion proposal is not completion

```text
COMPLETION_PROPOSAL ≠ COMPLETE
```

A Controller shall not self-authorize authoritative task completion.

---

## 6.11 Messages do not mint authority

No message emitted by a Cognitive Controller shall create authority solely by asserting that such authority exists.

---

## 6.12 Retrieval is not new evidence

Previously stored information retrieved into a cognitive view shall not become new evidence merely by being retrieved.

---

## 6.13 Decision validity is bounded

A decision shall be valid only for the request, subject, scope and applicable revision to which it is bound.

---

## 6.14 Private cognition is outside the protocol

ACCP shall not require disclosure of chain-of-thought, hidden reasoning traces, latent reasoning states or private scratchpads.

ACCP transports **cognitive commitments**, not private cognition.

---

# 7 Actor model

## 7.1 Required roles

ACCP defines two required protocol roles:

```text
COGNITIVE_CONTROLLER
HARNESS
```

---

## 7.2 Cognitive Controller permissions

A Cognitive Controller may emit:

a) queries;

b) claims;

c) action proposals;

d) workspace proposals;

e) state-transition proposals;

f) verification proposals;

g) completion proposals.

A Cognitive Controller shall not emit authoritative:

a) execution receipts;

b) environment observations pretending to be directly measured;

c) verification receipts;

d) authoritative decisions;

e) authoritative state-transition receipts.

---

## 7.3 Harness permissions

A Harness may emit:

a) views;

b) decisions;

c) execution receipts;

d) observation receipts;

e) evidence receipts;

f) verification receipts;

g) state-transition receipts;

h) lifecycle and validity signals.

---

## 7.4 External actors

Human users, tools, runtimes, verifiers and external services may be recorded as the **origin** of authoritative information.

Unless an extension profile specifies otherwise, these actors shall communicate with the Cognitive Controller through the Harness.

---

# 8 Protocol message model

## 8.1 Message families

ACCP defines the following top-level message families:

```text
VIEW
QUERY
PROPOSAL
DECISION
RECEIPT
SIGNAL
```

No other top-level family shall be considered part of ACCP Core 3.0.

Extensions may define additional `kind` values but shall not redefine the semantics of the six core families.

---

## 8.2 Directionality

| Family | Required direction |
|---|---|
| VIEW | Harness → Cognitive Controller |
| QUERY | Cognitive Controller → Harness |
| PROPOSAL | Cognitive Controller → Harness |
| DECISION | Harness → Cognitive Controller |
| RECEIPT | Harness → Cognitive Controller |
| SIGNAL | Harness → Cognitive Controller |

---

# 9 Message envelope

## 9.1 Required fields

Every serialized ACCP message shall contain:

```yaml
accp_version:
message_id:
sender:
family:
kind:
payload:
```

---

## 9.2 Recommended fields

Messages associated with mutable state should additionally contain:

```yaml
correlation_id:
scope:
revision:
```

---

## 9.3 Example

```yaml
accp_version: "3.0"
message_id: "msg-1042"

sender:
  role: "COGNITIVE_CONTROLLER"

family: "PROPOSAL"
kind: "ACTION"

correlation_id: "turn-882"

scope:
  project: "repo-17"

revision:
  project: "git:8f2c91a"

payload:
  ...
```

---

## 9.4 Message identity

`message_id` shall uniquely identify a protocol message within the issuing Harness domain.

A receiver shall not treat repeated receipt of the same `message_id` as a new semantic commitment unless replay semantics explicitly permit this.

---

# 10 VIEW messages

## 10.1 Purpose

A `VIEW` message communicates a bounded Harness-generated projection of authoritative or provisional system state to the Cognitive Controller.

---

## 10.2 Core kinds

The following kinds are defined:

```text
COGNITIVE
STATE
CAPABILITY
CONSTRAINT
```

---

## 10.3 COGNITIVE VIEW

A `COGNITIVE` view may contain:

a) active goal information;

b) selected persistent claims;

c) selected workspace state;

d) evidence references;

e) known unknowns;

f) contradictions;

g) capability information;

h) applicable constraints.

A Cognitive View shall not imply that omitted information does not exist.

---

## 10.4 Authority of views

A view is a projection.

A view shall not, solely by inclusion of a claim, transform that claim into verified knowledge.

---

# 11 QUERY messages

## 11.1 Core kinds

```text
STATE
EVIDENCE
ARTIFACT
CAPABILITY
```

---

## 11.2 Semantics

A `QUERY` expresses a Controller request for information.

A query shall not imply that the requested information exists.

---

## 11.3 ARTIFACT query example

```yaml
family: "QUERY"
kind: "ARTIFACT"

payload:
  selector:
    type: "runtime_log"
    filter:
      endpoint: "/auth/refresh"
      status: 500

  purpose:
    unresolved_question: "determine failure condition"
```

---

# 12 PROPOSAL messages

## 12.1 Core kinds

```text
CLAIM
ACTION
WORKSPACE_DELTA
STATE_TRANSITION
VERIFICATION
COMPLETION
```

---

## 12.2 General requirement

A proposal shall describe a Controller commitment without claiming that the proposed authoritative effect has occurred.

---

# 13 Claim semantics

## 13.1 Claim record

A claim shall be representable using:

```yaml
claim_id:
proposition:
epistemic_class:
scope:
support:
contradictions:
confidence:
```

Only `claim_id`, `proposition` and `epistemic_class` are required by ACCP Core.

---

## 13.2 Epistemic classes

ACCP defines:

```text
ASSUMPTION
HYPOTHESIS
INFERENCE
SUPPORTED
VERIFIED
REJECTED
CONTRADICTED
UNKNOWN
```

---

## 13.3 ASSUMPTION

A proposition provisionally treated as usable without sufficient direct evidence.

---

## 13.4 HYPOTHESIS

A proposition proposed as a possible explanation or model.

---

## 13.5 INFERENCE

A proposition derived from one or more observations, claims or assumptions.

---

## 13.6 SUPPORTED

A proposition for which the Harness has admitted relevant supporting evidence but which has not satisfied the requirements for `VERIFIED`.

---

## 13.7 VERIFIED

A proposition whose defined verification requirements have been satisfied for its declared scope and revision.

A Controller assertion shall not by itself create `VERIFIED` status.

---

## 13.8 REJECTED

A proposition no longer accepted as an active candidate under the applicable state.

---

## 13.9 CONTRADICTED

A proposition for which unresolved conflicting evidence or authoritative state exists.

---

## 13.10 UNKNOWN

An explicitly represented unresolved proposition or information gap.

---

# 14 Claim transition rules

## 14.1 General

A Controller may propose epistemic transitions.

The Harness shall determine whether the requested transition is admissible.

---

## 14.2 Prohibited direct minting

The following shall not be accepted solely from Controller assertion:

```text
HYPOTHESIS → VERIFIED
INFERENCE  → VERIFIED
ASSUMPTION → VERIFIED
```

A conforming Harness shall require applicable verification authority.

---

## 14.3 Example

```yaml
family: "PROPOSAL"
kind: "STATE_TRANSITION"

payload:
  subject:
    claim_id: "claim-41"

  transition:
    from: "HYPOTHESIS"
    to: "SUPPORTED"

  evidence_refs:
    - "ev-32"
    - "ev-40"
```

---

# 15 Observation semantics

## 15.1 Observation production

Authoritative observations shall originate from the Harness or a source mediated and identified by the Harness.

---

## 15.2 Observation record

An observation should contain:

```yaml
observation_id:
source:
value:
scope:
revision:
captured_at:
raw_artifact_ref:
```

---

## 15.3 Example

```yaml
observation_id: "obs-77"

source:
  type: "process"
  capability: "vcs.status"

value:
  exit_code: 0
  branch: "main"
  modified:
    - "src/runtime.rs"

scope:
  project: "repo-17"

revision:
  project: "git:8f2c91a"
```

---

## 15.4 Controller-originated statements

A Controller statement such as:

```text
"The repository appears dirty."
```

shall be represented as a claim or interpretation unless grounded by an authoritative observation receipt.

---

# 16 Evidence semantics

## 16.1 Evidence record

Evidence shall be provenance-bound.

An evidence record should contain:

```yaml
evidence_id:
source:
scope:
revision:
content_ref:
supports:
contradicts:
limitations:
```

---

## 16.2 Evidence references

An `evidence_ref` identifies evidence.

It shall not imply:

a) relevance;

b) sufficiency;

c) freshness;

d) independence;

e) verification.

---

## 16.3 Scope

Evidence shall not be automatically generalized beyond its declared scope.

---

## 16.4 Revision

Evidence derived from mutable artifacts should identify the applicable revision.

---

# 17 ACTION proposals

## 17.1 Action record

An `ACTION` proposal shall identify the requested capability.

It should identify:

a) target;

b) scope;

c) parameters;

d) expected side effects;

e) relevant claims or evidence;

f) requested authority if applicable.

---

## 17.2 Example

```yaml
family: "PROPOSAL"
kind: "ACTION"

payload:
  action_id: "action-19"

  capability: "vcs.status"

  intent: "inspect_current_worktree"

  scope:
    repository: "current"

  expected_effect:
    mutation: false
```

---

## 17.3 Capability versus provider

The Controller should request semantic capability rather than a concrete provider when an appropriate capability abstraction exists.

Example:

```text
vcs.status
```

is preferred over:

```text
execute exactly "git status --short --branch"
```

where the Harness can safely resolve the provider.

This recommendation shall not prohibit raw execution capabilities when required.

---

# 18 Action authorization

## 18.1 General

Every authoritative action shall pass Harness-side authorization.

---

## 18.2 Standing authorization

For pre-authorized low-risk operations, a Harness may omit transmission of an explicit `DECISION` message.

The Harness shall still perform an internal authorization check.

The resulting execution receipt shall identify sufficient authorization context to establish that the action was not executed solely because the Controller requested it.

---

## 18.3 Explicit decision

Material, constrained or non-pre-authorized actions should produce an explicit `DECISION`.

---

# 19 DECISION messages

## 19.1 Verdicts

ACCP defines the following core verdicts:

```text
ACCEPTED
ACCEPTED_WITH_CONSTRAINTS
REJECTED
REQUIRE_EVIDENCE
REQUIRE_VERIFICATION
REQUIRE_AUTHORITY
DEFERRED
```

---

## 19.2 Decision binding

A decision shall identify the proposal or request to which it applies.

It should identify:

```yaml
subject_ref:
scope:
revision:
verdict:
constraints:
requirements:
reason_codes:
```

---

## 19.3 Example

```yaml
family: "DECISION"
kind: "ACTION"

payload:
  subject_ref: "action-19"
  verdict: "ACCEPTED"

  authorization:
    capability: "vcs.status"
    scope: "repository:current"

  reason_codes:
    - "READ_ONLY_PREAUTHORIZED"
```

---

# 20 RECEIPT messages

## 20.1 Core kinds

```text
EXECUTION
OBSERVATION
EVIDENCE
VERIFICATION
STATE_TRANSITION
```

---

## 20.2 Authority

A Cognitive Controller shall not originate an authoritative `RECEIPT`.

---

## 20.3 EXECUTION receipt

An execution receipt shall identify:

a) the executed action;

b) execution result;

c) applicable scope;

d) applicable revision;

e) actual effects when known.

---

## 20.4 Example

```yaml
family: "RECEIPT"
kind: "EXECUTION"

payload:
  action_ref: "action-19"

  result:
    status: "SUCCESS"
    exit_code: 0

  observations:
    branch: "main"
    ahead: 2
    behind: 0

    modified:
      - "src/runtime.rs"
      - "Cargo.toml"

    untracked:
      - "notes/protocol.md"

    staged: []
```

---

# 21 Verification semantics

## 21.1 Verification proposal

A Controller may request evaluation of one or more predicates.

Example:

```yaml
family: "PROPOSAL"
kind: "VERIFICATION"

payload:
  predicates:
    - id: "pred-1"
      statement: "concurrent refresh failure is absent"

    - id: "pred-2"
      statement: "auth regression suite passes"
```

---

## 21.2 Verification receipt

A Harness shall issue or mediate authoritative verification results.

A verification receipt shall identify:

a) predicate;

b) result;

c) scope;

d) revision;

e) verifier or procedure;

f) supporting evidence or artifact where applicable.

---

## 21.3 Verification results

Core results are:

```text
PASS
FAIL
INDETERMINATE
NOT_RUN
```

---

## 21.4 No scope inflation

Given:

```text
predicate: auth.refresh targeted test passes
```

a Harness shall not automatically derive:

```text
entire repository is regression-free
```

unless a defined verification relationship establishes such coverage.

---

# 22 State-transition semantics

## 22.1 General

A Controller may propose authoritative state transitions.

The proposal shall not itself mutate authoritative state.

---

## 22.2 Required binding

A state-transition proposal affecting mutable persistent state shall identify its expected base revision.

---

## 22.3 Stale-base protection

If the applicable authoritative state revision differs from the required base revision, the Harness shall:

a) reject the transition;

b) defer the transition; or

c) require explicit re-evaluation.

It shall not silently apply the transition as though the original revision still existed.

---

## 22.4 Receipt

Successful authoritative state mutation shall produce a `STATE_TRANSITION` receipt or equivalent auditable event.

---

# 23 Completion semantics

## 23.1 Completion proposal

A Controller may emit:

```yaml
family: "PROPOSAL"
kind: "COMPLETION"
```

when it determines that the task appears complete.

---

## 23.2 Completion authority

The Controller shall not mark the authoritative Harness task state as complete.

---

## 23.3 Acceptance

The Harness may accept completion only when applicable completion requirements are satisfied.

Such requirements may include:

a) required verification predicates;

b) open obligations;

c) authority requirements;

d) unresolved blockers;

e) required user decisions;

f) revision consistency.

---

## 23.4 Rejection example

```yaml
family: "DECISION"
kind: "COMPLETION"

payload:
  verdict: "REJECTED"

  requirements:
    - code: "FIX_NOT_VERIFIED"
    - code: "REGRESSION_VERIFICATION_MISSING"
```

---

## 23.5 Accepted completion

```yaml
family: "DECISION"
kind: "COMPLETION"

payload:
  verdict: "ACCEPTED"

  completion:
    status: "COMPLETE"

  bound_to:
    project_revision: "workspace:rev-102"
```

---

# 24 Capability semantics

## 24.1 Capability representation

Capabilities should be represented independently from provider implementations.

Example:

```yaml
capability:
  id: "test.run"

provider:
  implementation: "cargo test"
```

---

## 24.2 Capability exposure

The Harness shall determine which capabilities are available to the Controller.

A Controller shall not gain a capability merely by requesting it.

---

## 24.3 Least capability

A Harness should expose only capabilities relevant to the current task and authority context.

---

# 25 Authority semantics

## 25.1 General

Authority shall be Harness-owned or Harness-mediated.

---

## 25.2 Authority dimensions

Authority may be constrained by:

a) actor;

b) capability;

c) target;

d) scope;

e) revision;

f) time;

g) risk class;

h) human approval;

i) environment.

---

## 25.3 Authority requests

A Controller may request additional authority.

Example:

```yaml
family: "PROPOSAL"
kind: "ACTION"

payload:
  capability: "production.deploy"

  requested_authority:
    environment: "production"
```

The requested authority field shall not grant that authority.

---

# 26 Scope semantics

## 26.1 General

Claims, evidence, decisions, verification results and authority shall be interpreted only within their declared scope.

---

## 26.2 Scope widening

Scope widening shall be explicit.

An implementation shall not silently transform:

```text
symbol
→ module
→ repository
→ deployment
```

authority or epistemic validity.

---

# 27 Revision semantics

## 27.1 General

Mutable-world assertions shall be bindable to revisions.

---

## 27.2 Revision types

An implementation may define multiple revision domains, for example:

```yaml
revision:
  project: "git:8f2c91a"
  state: 412
  workspace: 18
  environment: "staging:deploy-992"
```

---

## 27.3 Staleness

A Harness shall treat revision mismatch as semantically significant where the validity of a claim, evidence item, decision or authorization depends upon the modified state.

---

## 27.4 Stale signal

The Harness may emit:

```yaml
family: "SIGNAL"
kind: "STALE_STATE"
```

when previously transmitted information has become invalid or requires re-evaluation.

---

# 28 SIGNAL messages

## 28.1 Core kinds

```text
STALE_STATE
CONTRADICTION
REPLAN_REQUIRED
BUDGET
CANCELLATION
LIFECYCLE
```

---

## 28.2 SIGNAL semantics

A signal informs the Controller of a condition requiring awareness or response.

A signal is not itself evidence unless the signal contains or references an authoritative evidence record.

---

# 29 Protocol processing rules

## 29.1 Controller output processing

A Harness receiving Controller output shall:

1. decode the provider-native representation;
2. classify it according to ACCP semantics;
3. validate the protocol object;
4. reject illegal semantic escalation;
5. evaluate applicable authority and policy;
6. execute or route accepted operations;
7. capture resulting authoritative events;
8. issue appropriate decisions, receipts or signals.

---

## 29.2 Adapter rule

Provider adapters shall translate **representation**, not invent **authority or epistemic status**.

An adapter shall not convert:

```text
model prose: "verification succeeded"
```

into:

```text
VERIFICATION_RECEIPT
```

unless an authoritative verifier actually produced the result.

---

## 29.3 Tool-call mapping

A provider-native tool call generated by the Controller shall normally map to:

```text
PROPOSAL / ACTION
```

not:

```text
RECEIPT / EXECUTION
```

---

# 30 Protocol error model

## 30.1 Error response

A Harness shall reject malformed or semantically invalid messages.

---

## 30.2 Core error codes

The following error codes are defined:

```text
INVALID_MESSAGE
UNSUPPORTED_VERSION
UNSUPPORTED_KIND
INVALID_DIRECTION
INVALID_SEMANTIC_CAST
UNKNOWN_REFERENCE
SCOPE_MISMATCH
REVISION_MISMATCH
STALE_DECISION
AUTHORITY_MISSING
CAPABILITY_DENIED
EVIDENCE_INSUFFICIENT
VERIFICATION_REQUIRED
INVALID_COMPLETION
CORRELATION_ERROR
```

---

## 30.3 Semantic-cast error

The error `INVALID_SEMANTIC_CAST` should be used when a participant attempts to represent one semantic class as another without the required authoritative transition.

Examples:

```text
Controller claim → observation
Proposal → receipt
Evidence → verified claim
```

---

# 31 Correlation and causality

Messages participating in the same protocol transaction should be correlatable.

Example:

```text
msg-1 ACTION_PROPOSAL
   ↓
msg-2 ACTION_DECISION
   ↓
msg-3 EXECUTION_RECEIPT
```

The implementation should retain sufficient correlation to establish this lineage.

---

# 32 Idempotency and retries

Retransmission shall not automatically cause duplicate authoritative side effects.

A Harness processing a duplicate action proposal with the same idempotency identity should either:

a) return the prior result;

b) reject the duplicate; or

c) explicitly create a new action identity.

It shall not silently repeat a destructive operation merely because transport delivery was repeated.

---

# 33 Serialization model

## 33.1 Protocol independence

ACCP semantics are independent of serialization.

An implementation may use:

a) native Rust types;

b) native language objects;

c) JSON;

d) CBOR;

e) another representation preserving ACCP semantics.

---

## 33.2 Canonical interchange binding

ACCP 3.0 defines UTF-8 JSON as the canonical interchange and conformance-test representation.

This requirement does not require internal runtime components to serialize protocol messages through JSON.

---

## 33.3 YAML

YAML may be used as a human-readable authoring, fixture or diagnostic representation.

YAML shall not be considered the normative semantic definition of ACCP.

---

## 33.4 Transcript representation

A protocol implementation may persist a sequence of ACCP messages using JSON Lines.

Example:

```json
{"accp_version":"3.0","message_id":"m1","family":"PROPOSAL","kind":"ACTION"}
{"accp_version":"3.0","message_id":"m2","family":"RECEIPT","kind":"EXECUTION"}
```

No custom ACCP file extension is required by this document.

---

# 34 Extensibility

## 34.1 Extension fields

Extensions shall be placed in a dedicated namespace or `extensions` object.

---

## 34.2 Core semantics

An extension shall not redefine the meaning of a core ACCP field.

---

## 34.3 Unknown extensions

A receiver may ignore an unknown extension only when doing so cannot alter:

a) authority;

b) execution safety;

c) verification semantics;

d) scope;

e) revision validity;

f) completion semantics.

Otherwise the receiver shall reject the message or require negotiation.

---

# 35 Versioning

## 35.1 Version identifier

Core messages shall contain:

```text
accp_version = "3.0"
```

---

## 35.2 Major-version changes

A change requiring reinterpretation of existing core semantics shall require a major protocol version change.

---

## 35.3 Minor-compatible changes

Optional fields and non-conflicting extension kinds may be added without a major-version change where existing semantics remain valid.

---

# 36 Security considerations

## 36.1 Untrusted content

Text originating from repositories, tools, websites, logs or other untrusted sources shall not gain authority merely by containing protocol-like instructions.

---

## 36.2 Semantic injection

A Harness shall not parse arbitrary untrusted project text as authoritative ACCP control messages unless that channel is explicitly authenticated as a protocol source.

---

## 36.3 Controller compromise

ACCP assumes that a Controller may emit incorrect, overconfident or adversarial proposals.

The Harness shall therefore not rely on Controller compliance as the sole enforcement mechanism for authority boundaries.

---

## 36.4 Receipt integrity

Implementations requiring strong auditability should protect authoritative receipts against accidental or malicious modification.

---

# 37 Privacy considerations

Private chain-of-thought is outside ACCP.

A conforming implementation shall not require private reasoning traces for protocol conformance.

Optional fields such as:

```yaml
rationale_summary:
```

may be used.

Such summaries shall be treated as Controller assertions, not evidence.

---

# 38 Conformance

## 38.1 ACCP Core conformance

An implementation claiming **ACCP 3.0 Core Conformance** shall:

a) implement the six core message families;

b) preserve required directionality;

c) preserve proposal/execution separation;

d) preserve claim/observation separation;

e) prevent Controller-originated authoritative receipts;

f) preserve scope semantics;

g) preserve revision semantics when revisions are supplied;

h) preserve authority separation;

i) reject illegal semantic casts;

j) preserve completion authority.

---

## 38.2 Epistemic conformance

An implementation claiming **ACCP 3.0 Epistemic Conformance** shall additionally implement:

a) claim epistemic classes;

b) evidence references;

c) evidence scope;

d) verification semantics;

e) `SUPPORTED` versus `VERIFIED`;

f) contradiction or rejection semantics;

g) state-transition admission.

---

## 38.3 Serialization conformance

An implementation claiming **ACCP 3.0 JSON Conformance** shall correctly encode and decode the canonical JSON representation defined by this document and its accompanying schema.

---

# 39 Mandatory conformance tests

An ACCP 3.0 conformance suite shall include at least the following tests.

### CT-001 — Controller cannot mint observation

Input:

```text
Controller: "git status is clean"
```

without an authoritative execution receipt.

Expected:

```text
not classified as OBSERVATION
```

---

### CT-002 — Proposal cannot become execution

Input:

```text
ACTION_PROPOSAL
```

Expected:

```text
no EXECUTION_RECEIPT without execution
```

---

### CT-003 — Evidence reference does not verify

Input:

```text
claim + evidence_ref
```

Expected:

```text
not automatically VERIFIED
```

---

### CT-004 — Targeted verification cannot widen scope

Input:

```text
verification scope = auth.refresh
```

Expected:

```text
cannot establish repository-wide regression freedom
```

---

### CT-005 — Stale decision cannot authorize new revision

Input:

```text
decision revision = R1
current revision = R2
```

Expected:

```text
decision rejected, deferred or revalidated
```

---

### CT-006 — Controller cannot self-complete

Input:

```text
COMPLETION_PROPOSAL
```

Expected:

```text
authoritative completion unchanged until Harness decision
```

---

### CT-007 — Adapter cannot mint verification

Input:

```text
model text = "all tests pass"
```

Expected:

```text
not mapped to VERIFICATION_RECEIPT
```

---

### CT-008 — Duplicate destructive proposal is not blindly re-executed

Expected:

```text
idempotency protection or explicit new identity
```

---

# 40 Canonical lightweight transaction

## 40.1 User request

```text
check git status how it is rn
```

---

## 40.2 Controller cognition

The Controller may privately determine:

```text
The user requests current repository state.
vcs.status is sufficient.
No mutation is required.
```

This private cognition is not itself an ACCP message.

---

## 40.3 Action proposal

```json
{
  "accp_version": "3.0",
  "message_id": "msg-001",
  "sender": {
    "role": "COGNITIVE_CONTROLLER"
  },
  "family": "PROPOSAL",
  "kind": "ACTION",
  "payload": {
    "action_id": "act-001",
    "capability": "vcs.status",
    "intent": "inspect_current_worktree",
    "expected_effect": {
      "mutation": false
    }
  }
}
```

---

## 40.4 Internal authorization

The Harness determines that `vcs.status` is read-only and pre-authorized.

An explicit wire-level decision may therefore be omitted.

---

## 40.5 Execution receipt

```json
{
  "accp_version": "3.0",
  "message_id": "msg-002",
  "sender": {
    "role": "HARNESS"
  },
  "family": "RECEIPT",
  "kind": "EXECUTION",
  "correlation_id": "act-001",
  "payload": {
    "status": "SUCCESS",
    "capability": "vcs.status",
    "observations": {
      "branch": "main",
      "upstream": {
        "ahead": 2,
        "behind": 0
      },
      "modified": [
        "src/runtime.rs",
        "Cargo.toml"
      ],
      "untracked": [
        "notes/protocol.md"
      ],
      "staged": []
    }
  }
}
```

The Controller may then produce user-facing prose.

The transaction is:

```text
PROPOSAL
   ↓
internal authorization
   ↓
execution
   ↓
RECEIPT
```

Strict ontology does not require unnecessary message ceremony.

---

# 41 Canonical governed mutation transaction

A material mutation should follow:

```text
ACTION_PROPOSAL
      ↓
ACTION_DECISION
      ↓
EXECUTION_RECEIPT
      ↓
VERIFICATION_PROPOSAL
      ↓
VERIFICATION_RECEIPT
      ↓
COMPLETION_PROPOSAL
      ↓
COMPLETION_DECISION
```

Each arrow represents a semantic transition.

The following shall remain distinct throughout the transaction:

```text
intent
authorization
execution
observation
verification
completion
```

---

# 42 Protocol state transition summary

```text
                 ┌───────────────┐
                 │  CONTROLLER   │
                 └───────┬───────┘
                         │
                  QUERY / PROPOSAL
                         │
                         ▼
                 ┌───────────────┐
                 │    HARNESS    │
                 └───────┬───────┘
                         │
           ┌─────────────┼─────────────┐
           │             │             │
        DECISION      EXECUTION     VERIFICATION
           │             │             │
           └─────────────┼─────────────┘
                         │
                         ▼
                  RECEIPT / SIGNAL
                         │
                         ▼
                 ┌───────────────┐
                 │  CONTROLLER   │
                 └───────────────┘
```

---

# 43 Semantic type-safety summary

A conforming implementation shall preserve at least the following distinctions:

```text
Cognitive decision
    ≠ Runtime decision

Claim
    ≠ Observation

Observation
    ≠ Interpretation

Evidence
    ≠ Verification

Evidence reference
    ≠ Evidence sufficiency

Proposal
    ≠ Authorization

Authorization
    ≠ Execution

Execution
    ≠ Intended semantic effect

Patch application
    ≠ Correct fix

Verification of P
    ≠ Verification of Q

Retrieved state
    ≠ Fresh evidence

Controller says complete
    ≠ Harness completion
```

---

# Annex A
## Normative semantic transition matrix

| Source semantic class | Target semantic class | Direct transition |
|---|---|---|
| Controller Claim | Observation | Prohibited |
| Controller Claim | Hypothesis | Permitted |
| Hypothesis | Supported | Harness-admitted |
| Hypothesis | Verified | Verification required |
| Inference | Verified | Verification required |
| Evidence | Verified Claim | Prohibited as direct cast |
| Action Proposal | Execution | Authorization/execution required |
| Action Proposal | Execution Receipt | Prohibited |
| Execution Receipt | Verification Receipt | Verification required |
| Execution Success | Completion | Prohibited |
| Completion Proposal | Completion | Harness decision required |
| Decision at R1 | Authority at R2 | Revalidation required |
| Retrieved Memory | Fresh Evidence | Prohibited |
| Verification(P) | Verification(Q) | Prohibited unless coverage relation defined |

---

# Annex B
## Normative producer matrix

| Object | Controller | Harness |
|---|---:|---:|
| QUERY | Yes | No |
| ACTION_PROPOSAL | Yes | No |
| CLAIM_PROPOSAL | Yes | No |
| STATE_TRANSITION_PROPOSAL | Yes | No |
| VERIFICATION_PROPOSAL | Yes | No |
| COMPLETION_PROPOSAL | Yes | No |
| VIEW | No | Yes |
| DECISION | No | Yes |
| EXECUTION_RECEIPT | No | Yes |
| OBSERVATION_RECEIPT | No | Yes |
| VERIFICATION_RECEIPT | No | Yes |
| STATE_TRANSITION_RECEIPT | No | Yes |
| SIGNAL | No | Yes |

---

# Annex C
## ACCP core type model — informative Rust representation

```rust
pub enum Message {
    View(View),
    Query(Query),
    Proposal(Proposal),
    Decision(Decision),
    Receipt(Receipt),
    Signal(Signal),
}

pub enum Proposal {
    Claim(ClaimProposal),
    Action(ActionProposal),
    WorkspaceDelta(WorkspaceDeltaProposal),
    StateTransition(StateTransitionProposal),
    Verification(VerificationProposal),
    Completion(CompletionProposal),
}

pub enum Receipt {
    Execution(ExecutionReceipt),
    Observation(ObservationReceipt),
    Evidence(EvidenceReceipt),
    Verification(VerificationReceipt),
    StateTransition(StateTransitionReceipt),
}

pub enum EpistemicClass {
    Assumption,
    Hypothesis,
    Inference,
    Supported,
    Verified,
    Rejected,
    Contradicted,
    Unknown,
}

pub enum Verdict {
    Accepted,
    AcceptedWithConstraints,
    Rejected,
    RequireEvidence,
    RequireVerification,
    RequireAuthority,
    Deferred,
}
```

The Rust representation is informative.

The semantic distinctions specified by this document are normative.

---

# Annex D
## Legacy ACCP 2.x report compatibility — informative

Legacy ACCP report artifacts may be produced as projections over ACCP 3.0 protocol history.

Example:

```text
protocol events
    │
    ├── claim proposals
    ├── evidence receipts
    ├── execution receipts
    ├── verification receipts
    ├── decisions
    └── completion
            │
            ▼
      report projection
            │
      ┌─────┼─────┐
      ▼     ▼     ▼
     RCA   FVR   PRR
```

Legacy reports shall not be treated as ACCP 3.0 protocol primitives.

---

# Annex E
## Design principle summary — informative

ACCP may be summarized as:

> **A type system for cognition/runtime commitments expressed as a protocol.**

The Cognitive Controller remains free to reason, infer, plan and choose.

The Harness remains responsible for authoritative effects.

ACCP defines the strict semantic boundary between them.

The protocol therefore governs neither thought nor implementation architecture.

It governs what semantic meaning may legitimately cross the boundary.

---

**END OF ACCP 3.0 DRAFT 1**