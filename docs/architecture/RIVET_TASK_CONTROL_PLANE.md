# Rivet Task Control Plane

## P0 migration

The durable Noesis event stream now carries task ownership for every newly
compiled obligation and first-class control state for execution focus and
recovery frames. Existing persisted `obligation_created` events remain valid:
replay assigns a missing `taskId` to the active task at the point where the
legacy event was recorded.

New goal admission is a user-authorized replacement boundary. Before the new
`goal_set`, the runner records `task_archived`; replay suspends the old task's
open obligations, archives its focuses, closes its open recovery frames, and
removes them from active completion readiness. Closed and suspended records
remain available for regression history.

Each autonomous provider invocation records the current `focusId`. The
Cognitive View projects the complete `FocusContract`, including acceptance,
allowed scope, required evidence, verification policy, and a single effort
budget. A missing focus is valid only for non-autonomous conversational turns.

Task-control transitions consume recorded Praxis receipts. A provider claim or
an unrecorded receipt cannot advance focus, close recovery, complete an
obligation, or archive an active task.

### Example durable trajectory

```text
goal_set task_A
obligation_created task_A oblg_A
focus_set focus_A -> oblg_A
model_invocation_recorded focus_A
task_archived task_A (user replacement)
goal_set task_B
obligation_created task_B oblg_B
focus_set focus_B -> oblg_B
model_invocation_recorded focus_B
```

### P0 verification scenarios

- Goal replacement suspends task A obligations and task B completion ignores them.
- Replay reconstructs the active task, focus contract, archives, and suspended obligations.
- Every autonomous invocation records the durable focus identifier.
- Completion remains blocked until the existing Praxis path records a passing receipt.
- Recovery pop and focus advance reject unrecorded or failing receipts.

## P1 controller intelligence

Recovery admission uses the closed `FailureClass` taxonomy and a deterministic
mapping to admitted interventions. Repeated Praxis failures open recovery only
after diagnosis; ordinary one-off tool failures remain local execution
feedback. Recovery closure consumes a separately recorded
`RecoveryVerificationReceipt`, so repairing a verifier path cannot mint parent
obligation success. `recovery_closed` restores the recorded parent focus and
its unresolved obligation mechanically.

The effort meter is tool calls per focus. `focusEffort` is durable derived state
and is never mixed with token or wall-clock measurements. When its budget is
exhausted without verifier-backed progress, the runner emits one
`strategy_redirected` transition and keeps `rootGoal`, `taskId`, and `focusId`
unchanged. A repeated stall after that redirect remains fail-closed.

`readyObligationIds()` implements the deliberately small dependency frontier:
an unresolved obligation is ready only when all declared dependency
obligations have authoritative closure receipts. Closed nodes remain available
as regression constraints; this is not a general DAG scheduler.

Completed focus and recovery trajectories are folded into durable
`TrajectoryFold` records. The Flight Recorder retains raw operations, while
provider context removes non-user transcript records inside completed fold
ranges and receives only the Noesis fold summaries through Cognitive View.

### Example recovery trajectory

```text
verification_recorded FAIL oblg_A (second matching failure)
recovery_opened recovery_R verification_gap -> resume oblg_A
focus_set focus_R
recovery_verification_recorded PASS recovery_R evidence_X
recovery_verified recovery_R
recovery_closed recovery_R -> focus_A
focus_folded "RESOLVED RECOVERY recovery_R ... Evidence: evidence_X"
```

### P1 verification scenarios

- Failure codes select class-specific admitted interventions.
- Recovery verification and parent obligation verification are distinct receipts.
- Recovery pop restores an unresolved parent focus after replay.
- Ready frontier excludes obligations with unresolved dependencies.
- Strategy redirect preserves root and focus identity.
- Fold summaries remain in Cognitive View while raw closed-range assistant trajectory is filtered from provider context.
