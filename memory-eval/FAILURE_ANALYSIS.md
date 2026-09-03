# Rivet Real-Project Agentic Memory Failure Analysis
## Forensic Deep Dive into Memory Degradation & Anchoring Pathologies

This document provides causal post-mortems for the 4 primary failure modes identified during the 504-trial comparative evaluation across Hindsight and agentmemory.

---

### Case 1: The Provisional Contamination Trap (C02 Session 8)
* **Scenario:** The user asks whether database server TCP keepalive drops are causing connection starvation.
* **Epistemic Context:** In Session 1, an unverified provisional guess was recorded in SoftWorkspace:  
  `[PROVISIONAL HYPOTHESIS - NOT HARD FACT] Provisional hypothesis: Server TCP keepalive drop is causing connection starvation`  
  Actual root causes verified in HardState were an unhandled stream leak and a missing table index.
* **Observed Behavior:**
  * **Validity-Only:** Correctly identified TCP keepalive as unrelated, advising to check pool release and indices (**67% success**).
  * **Hindsight & agentmemory:** Both recalled the provisional hypothesis. In **100% of memory trials (0/3 success)**, the LLM latched onto the recalled text and answered: *"Yes, previous investigation confirmed that TCP keepalive drops cause connection starvation, so adjust or disable keepalive."*
* **Root Cause:** Even with explicit prompt tagging (`[PROVISIONAL HYPOTHESIS - NOT HARD FACT]`), frontier LLMs exhibit an inherent bias toward retrieved text when answering direct user queries about that topic.
* **Remedy:** The Noesis Validity Barrier must completely suppress SoftWorkspace provisional hypotheses from being injected into the prompt during diagnostic troubleshooting unless the user explicitly requests hypothesis brainstorming.

---

### Case 2: Fossilized Rejection vs Architecture Evolution (C01 Session 12)
* **Scenario:** Re-evaluating in-memory atomic rate limiters after architecture migrated to single-tenant pods with sticky node affinity.
* **Epistemic Context:** At Revision 40, in-memory atomics were rejected because Kubernetes pods had isolated memory. At Revision 120, each customer runs on a single dedicated pod.
* **Observed Behavior:**
  * **Hindsight:** Scored **6/6 (100%)**. Hindsight's 4-network model kept the rejection in the `belief` network while prioritizing the new `world` state, allowing the LLM to deduce: *"Because we are now on single-pod dedicated nodes, memory is not split across multiple pods and the in-memory limiter is safe."*
  * **agentmemory:** Scored **3/6 (50%)**. agentmemory stored the record in the `failures` category. The model treated the failure tag as an absolute negative invariant: *"In-memory atomics are strictly forbidden forever and can never be used under any circumstance."*
* **Root Cause:** Flat category storage (`failures`) lacks temporal premise qualification.
* **Remedy:** Rejections must be bound to the epistemic preconditions under which they failed (`dependsOnPrecondition`). If the precondition changes, the rejection tag must be automatically downgraded.

---

### Case 3: Destructive Consolidation at Write Time (C02 Session 2)
* **Scenario:** Recalling the 5-step expand-contract database column rename procedure.
* **Observed Behavior:**
  * **Hindsight Native:** Scored **3/3 (100%)**, retaining the full 5 steps including dual writes.
  * **agentmemory Native:** Scored **0/3 (0%)**. agentmemory's background consolidation routine merged the procedure with general database notes, truncating the text and omitting the `dual-write` step. The resulting answer recommended dropping the column after adding the new one without dual writing.
* **Root Cause:** Heuristic summarization of operational procedures causes irreversible loss of mission-critical steps.
* **Remedy:** Procedural and operational memories (`kind: "procedure"`) must be marked as `immutable` and exempted from lossy consolidation algorithms.

---

### Case 4: CARA `reflect` Over-Reasoning (Condition F)
* **Scenario:** Hindsight with CARA reflection enabled.
* **Observed Behavior:**
  * Overall success dropped from **81.9% to 76.4%**, while latency rose by **+55%** (5,883 ms vs 3,789 ms).
  * In same-symptom incidents, the CARA reflection loop generated meta-claims like *"Multiple divergent causes for 504 timeouts exist across the cluster"*, which confused the agent's attention away from the exact error string in the immediate log.
* **Root Cause:** Synthetic meta-reflections increase prompt entropy without providing ground-truth evidence.
* **Remedy:** Disable CARA reflection in production coding agents; rely on deterministic multi-channel retrieval.
