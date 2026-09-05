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
