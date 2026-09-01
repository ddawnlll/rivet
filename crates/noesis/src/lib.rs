//! # noesis (Cognitive State Kernel)
//!
//! Owns the authoritative Hard State, bounded Soft Workspace, event replay,
//! state promotion, and cognitive view compilation.

use chrono::{DateTime, Utc};
use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Materialized durable claim in Hard State
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimRecord {
    pub id: ClaimId,
    pub proposition: String,
    pub status: EpistemicStatus,
    pub supporting_evidence: Vec<EvidenceId>,
    pub scope: Scope,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Materialized contradiction record in Hard State
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContradictionRecord {
    pub claim_id: ClaimId,
    pub contradicted_by: Vec<EvidenceId>,
    pub reason: String,
    pub scope: Scope,
    pub created_at: DateTime<Utc>,
}

/// Materialized rejected belief record in Hard State
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RejectionRecord {
    pub claim_id: ClaimId,
    pub reason: String,
    pub evidence: Vec<EvidenceId>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InvocationReason {
    GoalAmbiguity,
    SemanticDiagnosis,
    HypothesisConflict,
    NovelArchitecture,
    CapabilityDiscoveryFallback,
    UnexpectedResult,
    StateContradiction,
    LongHorizonReframe,
    ReviewSemantics,
}

/// Durable, non-semantic accounting record for a model invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInvocationRecord {
    pub invocation_id: ReceiptId,
    pub model_id: String,
    pub reason: InvocationReason,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub latency_ms: u64,
    pub timestamp: DateTime<Utc>,
}

/// An immutable event in Noesis event-sourced ledger
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum NoesisEvent {
    ClaimAsserted {
        claim_id: ClaimId,
        proposition: String,
        status: EpistemicStatus,
        evidence: Vec<EvidenceId>,
        scope: Scope,
        timestamp: DateTime<Utc>,
    },
    ClaimStatusChanged {
        claim_id: ClaimId,
        new_status: EpistemicStatus,
        reason: String,
        timestamp: DateTime<Utc>,
    },
    EvidenceRecorded {
        evidence_id: EvidenceId,
        source: String,
        summary: String,
        timestamp: DateTime<Utc>,
    },
    ExecutionRecorded {
        receipt: accp::ExecutionReceipt,
        timestamp: DateTime<Utc>,
    },
    ObligationCreated {
        obligation_id: ObligationId,
        description: String,
        scope: Scope,
        timestamp: DateTime<Utc>,
    },
    ObligationClosed {
        obligation_id: ObligationId,
        receipt_id: ReceiptId,
        timestamp: DateTime<Utc>,
    },
    VerificationRecorded {
        receipt: accp::VerificationReceipt,
        timestamp: DateTime<Utc>,
    },
    ObligationReopened {
        obligation_id: ObligationId,
        reason: String,
        timestamp: DateTime<Utc>,
    },
    ClaimContradicted {
        claim_id: ClaimId,
        contradicted_by: Vec<EvidenceId>,
        reason: String,
        scope: Scope,
        timestamp: DateTime<Utc>,
    },
    ClaimRejected {
        claim_id: ClaimId,
        reason: String,
        evidence: Vec<EvidenceId>,
        timestamp: DateTime<Utc>,
    },
    ModelInvocationRecorded {
        record: ModelInvocationRecord,
    },
    CompletionAccepted {
        task_id: TaskId,
        final_receipt: ReceiptId,
        timestamp: DateTime<Utc>,
    },
}

/// Materialized durable Hard State
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HardState {
    pub revision: Revision,
    /// Stable task identity used by a resumed Harness session.
    #[serde(default)]
    pub active_task_id: Option<TaskId>,
    pub claims: HashMap<ClaimId, ClaimRecord>,
    #[serde(default)]
    pub contradictions: HashMap<ClaimId, ContradictionRecord>,
    #[serde(default)]
    pub rejected_claims: HashMap<ClaimId, RejectionRecord>,
    pub obligations: HashMap<ObligationId, String>,
    /// Durable scope declarations for open and historically closed obligations.
    #[serde(default)]
    pub obligation_scopes: HashMap<ObligationId, Scope>,
    pub closed_obligations: HashMap<ObligationId, ReceiptId>,
    pub evidence: HashMap<EvidenceId, String>,
    #[serde(default)]
    pub execution_receipts: Vec<accp::ExecutionReceipt>,
    #[serde(default)]
    pub verification_receipts: HashMap<ObligationId, accp::VerificationReceipt>,
    #[serde(default)]
    pub model_invocations: Vec<ModelInvocationRecord>,
    #[serde(default)]
    pub completed_tasks: HashMap<TaskId, ReceiptId>,
}

impl HardState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply an event to update the materialized in-memory state
    pub fn apply(&mut self, event: &NoesisEvent) {
        self.revision = self.revision.next();
        match event {
            NoesisEvent::ClaimAsserted {
                claim_id,
                proposition,
                status,
                evidence,
                scope,
                timestamp,
            } => {
                self.claims.insert(
                    claim_id.clone(),
                    ClaimRecord {
                        id: claim_id.clone(),
                        proposition: proposition.clone(),
                        status: *status,
                        supporting_evidence: evidence.clone(),
                        scope: scope.clone(),
                        created_at: *timestamp,
                        updated_at: *timestamp,
                    },
                );
            }
            NoesisEvent::ClaimStatusChanged {
                claim_id,
                new_status,
                timestamp,
                ..
            } => {
                if let Some(record) = self.claims.get_mut(claim_id) {
                    record.status = *new_status;
                    record.updated_at = *timestamp;
                }
            }
            NoesisEvent::ClaimContradicted {
                claim_id,
                contradicted_by,
                reason,
                scope,
                timestamp,
            } => {
                if let Some(record) = self.claims.get_mut(claim_id) {
                    record.status = EpistemicStatus::Rejected;
                    record.updated_at = *timestamp;
                }
                self.contradictions.insert(
                    claim_id.clone(),
                    ContradictionRecord {
                        claim_id: claim_id.clone(),
                        contradicted_by: contradicted_by.clone(),
                        reason: reason.clone(),
                        scope: scope.clone(),
                        created_at: *timestamp,
                    },
                );
            }
            NoesisEvent::ClaimRejected {
                claim_id,
                reason,
                evidence,
                timestamp,
            } => {
                if let Some(record) = self.claims.get_mut(claim_id) {
                    record.status = EpistemicStatus::Rejected;
                    record.updated_at = *timestamp;
                }
                self.rejected_claims.insert(
                    claim_id.clone(),
                    RejectionRecord {
                        claim_id: claim_id.clone(),
                        reason: reason.clone(),
                        evidence: evidence.clone(),
                        timestamp: *timestamp,
                    },
                );
            }
            NoesisEvent::EvidenceRecorded {
                evidence_id,
                summary,
                ..
            } => {
                self.evidence.insert(evidence_id.clone(), summary.clone());
            }
            NoesisEvent::ExecutionRecorded { receipt, .. } => {
                self.execution_receipts.push(receipt.clone());
            }
            NoesisEvent::ObligationCreated {
                obligation_id,
                description,
                scope,
                ..
            } => {
                self.obligations
                    .insert(obligation_id.clone(), description.clone());
                self.obligation_scopes
                    .insert(obligation_id.clone(), scope.clone());
            }
            NoesisEvent::ObligationClosed {
                obligation_id,
                receipt_id,
                ..
            } => {
                self.obligations.remove(obligation_id);
                self.closed_obligations
                    .insert(obligation_id.clone(), receipt_id.clone());
            }
            NoesisEvent::VerificationRecorded { receipt, .. } => {
                self.verification_receipts
                    .insert(receipt.obligation_id.clone(), receipt.clone());
                if !receipt.passed {
                    // A failed re-check invalidates terminal completion for the
                    // current materialized task; work must re-enter the gate.
                    self.completed_tasks.clear();
                    if let Some(previous_receipt) =
                        self.closed_obligations.remove(&receipt.obligation_id)
                    {
                        self.obligations.insert(
                            receipt.obligation_id.clone(),
                            format!(
                                "Reopened after failed verification receipt {} (previously closed by {})",
                                receipt.receipt_id, previous_receipt
                            ),
                        );
                    }
                }
            }
            NoesisEvent::ObligationReopened {
                obligation_id,
                reason,
                ..
            } => {
                self.closed_obligations.remove(obligation_id);
                self.obligations
                    .insert(obligation_id.clone(), reason.clone());
                self.completed_tasks.clear();
            }
            NoesisEvent::ModelInvocationRecorded { record } => {
                self.model_invocations.push(record.clone());
            }
            NoesisEvent::CompletionAccepted {
                task_id,
                final_receipt,
                ..
            } => {
                self.completed_tasks
                    .insert(task_id.clone(), final_receipt.clone());
            }
        }
    }

    /// Replay an event sequence to reconstruct deterministic HardState
    pub fn replay(events: &[NoesisEvent]) -> Self {
        let mut state = Self::new();
        for event in events {
            state.apply(event);
        }
        state
    }

    pub fn open_obligation_ids(&self) -> Vec<ObligationId> {
        let mut ids: Vec<_> = self.obligations.keys().cloned().collect();
        ids.sort();
        ids
    }

    pub fn passing_verification_receipts(&self) -> Vec<ReceiptId> {
        let mut receipts: Vec<_> = self
            .verification_receipts
            .values()
            .filter(|receipt| receipt.passed)
            .map(|receipt| receipt.receipt_id.clone())
            .collect();
        receipts.sort();
        receipts
    }
}

/// Bounded Soft Workspace in RAM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoftWorkspace {
    pub workspace_id: WorkspaceId,
    pub session_id: SessionId,
    pub base_hard_revision: Revision,
    pub active_focus: Vec<String>,
    pub hypotheses: Vec<String>,
    pub unknowns: Vec<String>,
    pub candidate_actions: Vec<String>,
    pub max_capacity_items: usize,
}

impl SoftWorkspace {
    pub fn new(session_id: SessionId, base_revision: Revision) -> Self {
        Self {
            workspace_id: WorkspaceId::new(),
            session_id,
            base_hard_revision: base_revision,
            active_focus: Vec::new(),
            hypotheses: Vec::new(),
            unknowns: Vec::new(),
            candidate_actions: Vec::new(),
            max_capacity_items: 32,
        }
    }

    pub fn add_hypothesis(&mut self, hypothesis: impl Into<String>) {
        self.hypotheses.push(hypothesis.into());
        self.trim_to_capacity();
    }

    pub fn add_unknown(&mut self, unknown: impl Into<String>) {
        self.unknowns.push(unknown.into());
        self.trim_to_capacity();
    }

    pub fn add_candidate_action(&mut self, action: impl Into<String>) {
        self.candidate_actions.push(action.into());
        self.trim_to_capacity();
    }

    pub fn set_focus(&mut self, focus: Vec<String>) {
        self.active_focus = focus;
        self.trim_to_capacity();
    }

    fn trim_to_capacity(&mut self) {
        while self.item_count() > self.max_capacity_items {
            if !self.hypotheses.is_empty() {
                self.hypotheses.remove(0);
            } else if !self.unknowns.is_empty() {
                self.unknowns.remove(0);
            } else if !self.candidate_actions.is_empty() {
                self.candidate_actions.remove(0);
            } else {
                self.active_focus.remove(0);
            }
        }
    }

    pub fn item_count(&self) -> usize {
        self.active_focus.len()
            + self.hypotheses.len()
            + self.unknowns.len()
            + self.candidate_actions.len()
    }
}

/// Task-conditioned Cognitive View projected to the model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitiveView {
    pub hard_revision: Revision,
    #[serde(default)]
    pub repository_id: String,
    pub goal_description: String,
    pub active_claims: Vec<ClaimRecord>,
    #[serde(default)]
    pub contradictions: Vec<String>,
    #[serde(default)]
    pub rejected_claims: Vec<String>,
    pub open_obligations: Vec<String>,
    #[serde(default)]
    pub recent_evidence: Vec<String>,
    /// Bounded deterministic repository observations. These are signals for
    /// semantic induction, never pre-authorized relevance decisions.
    #[serde(default)]
    pub repository_signals: Vec<String>,
    pub unknowns: Vec<String>,
    pub active_hypotheses: Vec<String>,
    pub active_focus: Vec<String>,
    pub relevant_files: Vec<String>,
    pub token_budget_hint: u32,
    #[serde(default)]
    pub model_invocation_count: usize,
}

impl CognitiveView {
    pub fn format_prompt_block(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "### CURRENT GOAL (Revision: {})\n",
            self.hard_revision
        ));
        out.push_str(&format!("Repository: {}\n", self.repository_id));
        out.push_str(&format!("{}\n\n", self.goal_description));

        if !self.active_claims.is_empty() {
            out.push_str("### AUTHORITATIVE HARD CLAIMS:\n");
            for c in &self.active_claims {
                out.push_str(&format!("- [{}] {}: {}\n", c.status, c.id, c.proposition));
            }
            out.push('\n');
        }

        if !self.contradictions.is_empty() {
            out.push_str("### DETECTED CONTRADICTIONS (Must resolve before completion):\n");
            for c in &self.contradictions {
                out.push_str(&format!("- [!] {}\n", c));
            }
            out.push('\n');
        }

        if !self.rejected_claims.is_empty() {
            out.push_str("### REJECTED / FALSIFIED CLAIMS (Do not re-explore):\n");
            for r in &self.rejected_claims {
                out.push_str(&format!("- [x] {}\n", r));
            }
            out.push('\n');
        }

        if !self.active_hypotheses.is_empty() {
            out.push_str("### ACTIVE WORKING HYPOTHESES (Soft Workspace):\n");
            for h in &self.active_hypotheses {
                out.push_str(&format!("- {}\n", h));
            }
            out.push('\n');
        }

        if !self.open_obligations.is_empty() {
            out.push_str("### OPEN OBLIGATIONS TO VERIFY (Use internal ID only when proposing verification):\n");
            for o in &self.open_obligations {
                out.push_str(&format!("- [ ] {}\n", o));
            }
            out.push('\n');
        }

        if !self.recent_evidence.is_empty() {
            out.push_str("### RECENT AUTHORITATIVE EVIDENCE:\n");
            for evidence in &self.recent_evidence {
                out.push_str(&format!("- {evidence}\n"));
            }
            out.push('\n');
        }

        if !self.unknowns.is_empty() {
            out.push_str("### UNRESOLVED UNKNOWNs (not facts):\n");
            for unknown in &self.unknowns {
                out.push_str(&format!("- {}\n", unknown));
            }
            out.push('\n');
        }

        if !self.active_focus.is_empty() {
            out.push_str("### ACTIVE FOCUS:\n");
            for focus in &self.active_focus {
                out.push_str(&format!("- {}\n", focus));
            }
            out.push('\n');
        }

        if !self.relevant_files.is_empty() {
            out.push_str("### RELEVANT ARTIFACT FRONTIER:\n");
            for path in &self.relevant_files {
                out.push_str(&format!("- {}\n", path));
            }
            out.push('\n');
        }

        if !self.repository_signals.is_empty() {
            out.push_str("### REPOSITORY CENSUS SIGNALS (not semantic decisions):\n");
            for signal in &self.repository_signals {
                out.push_str(&format!("- {}\n", signal));
            }
            out.push('\n');
        }

        out.push_str(&format!(
            "### INVOCATION ACCOUNTING: {} prior model calls\n",
            self.model_invocation_count
        ));

        let marker = "\n[view truncated]";
        let max_bytes = (self.token_budget_hint as usize * 4).max(marker.len());
        if out.len() > max_bytes {
            let mut end = max_bytes.saturating_sub(marker.len());
            while !out.is_char_boundary(end) {
                end = end.saturating_sub(1);
            }
            out.truncate(end);
            out.push_str(marker);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_replay_determinism() {
        let c_id = ClaimId::new();
        let events = vec![
            NoesisEvent::ClaimAsserted {
                claim_id: c_id.clone(),
                proposition: "Test proposition".into(),
                status: EpistemicStatus::Supported,
                evidence: vec![],
                scope: Scope::global("repo", Revision::ZERO),
                timestamp: Utc::now(),
            },
            NoesisEvent::ClaimStatusChanged {
                claim_id: c_id.clone(),
                new_status: EpistemicStatus::Verified,
                reason: "Praxis PASS".into(),
                timestamp: Utc::now(),
            },
        ];

        let state1 = HardState::replay(&events);
        let state2 = HardState::replay(&events);

        assert_eq!(state1.revision, Revision(2));
        assert_eq!(
            state1.claims.get(&c_id).unwrap().status,
            EpistemicStatus::Verified
        );
        assert_eq!(state1.revision, state2.revision);
    }

    #[test]
    fn soft_workspace_is_bounded_across_all_working_sets() {
        let mut workspace = SoftWorkspace::new(SessionId::new(), Revision::ZERO);
        workspace.max_capacity_items = 3;
        workspace.set_focus(vec!["focus-a".into(), "focus-b".into()]);
        workspace.add_hypothesis("hypothesis-a");
        workspace.add_unknown("unknown-a");
        workspace.add_candidate_action("action-a");
        assert!(workspace.item_count() <= workspace.max_capacity_items);
    }

    #[test]
    fn failed_verification_reopens_a_closed_obligation() {
        let obligation_id = ObligationId::new();
        let receipt_id = ReceiptId::new();
        let receipt = accp::VerificationReceipt {
            receipt_id: receipt_id.clone(),
            obligation_id: obligation_id.clone(),
            passed: false,
            evidence_id: EvidenceId::new(),
            verified_scope: Scope::global("rivet", Revision::ZERO),
            diagnostics: Some("regression".into()),
            timestamp: Utc::now(),
        };
        let events = vec![
            NoesisEvent::ObligationCreated {
                obligation_id: obligation_id.clone(),
                description: "must pass".into(),
                scope: Scope::global("rivet", Revision::ZERO),
                timestamp: Utc::now(),
            },
            NoesisEvent::ObligationClosed {
                obligation_id: obligation_id.clone(),
                receipt_id: receipt_id.clone(),
                timestamp: Utc::now(),
            },
            NoesisEvent::VerificationRecorded {
                receipt,
                timestamp: Utc::now(),
            },
        ];
        let state = HardState::replay(&events);
        assert!(state.obligations.contains_key(&obligation_id));
        assert!(!state.closed_obligations.contains_key(&obligation_id));
    }

    #[test]
    fn failed_recheck_invalidates_previous_completion() {
        let obligation_id = ObligationId::new();
        let passing_id = ReceiptId::new();
        let task_id = TaskId::new();
        let passing = accp::VerificationReceipt {
            receipt_id: passing_id.clone(),
            obligation_id: obligation_id.clone(),
            passed: true,
            evidence_id: EvidenceId::new(),
            verified_scope: Scope::global("rivet", Revision::ZERO),
            diagnostics: None,
            timestamp: Utc::now(),
        };
        let failed = accp::VerificationReceipt {
            receipt_id: ReceiptId::new(),
            obligation_id: obligation_id.clone(),
            passed: false,
            evidence_id: EvidenceId::new(),
            verified_scope: Scope::global("rivet", Revision::ZERO),
            diagnostics: Some("regression".into()),
            timestamp: Utc::now(),
        };
        let state = HardState::replay(&[
            NoesisEvent::ObligationCreated {
                obligation_id: obligation_id.clone(),
                description: "must remain valid".into(),
                scope: Scope::global("rivet", Revision::ZERO),
                timestamp: Utc::now(),
            },
            NoesisEvent::VerificationRecorded {
                receipt: passing,
                timestamp: Utc::now(),
            },
            NoesisEvent::ObligationClosed {
                obligation_id: obligation_id.clone(),
                receipt_id: passing_id.clone(),
                timestamp: Utc::now(),
            },
            NoesisEvent::CompletionAccepted {
                task_id,
                final_receipt: passing_id,
                timestamp: Utc::now(),
            },
            NoesisEvent::VerificationRecorded {
                receipt: failed,
                timestamp: Utc::now(),
            },
        ]);
        assert!(state.obligations.contains_key(&obligation_id));
        assert!(state.completed_tasks.is_empty());
    }

    #[test]
    fn test_obligation_reopened_invalidates_completed_tasks() {
        let task_id = TaskId::new();
        let obligation_id = ObligationId::new();
        let passing_id = ReceiptId::new();

        let state = HardState::replay(&[
            NoesisEvent::ObligationClosed {
                obligation_id: obligation_id.clone(),
                receipt_id: passing_id.clone(),
                timestamp: Utc::now(),
            },
            NoesisEvent::CompletionAccepted {
                task_id,
                final_receipt: passing_id,
                timestamp: Utc::now(),
            },
            NoesisEvent::ObligationReopened {
                obligation_id: obligation_id.clone(),
                reason: "manual test regression".into(),
                timestamp: Utc::now(),
            },
        ]);
        assert!(state.obligations.contains_key(&obligation_id));
        assert!(state.completed_tasks.is_empty());
    }

    #[test]
    fn cognitive_view_prompt_obeys_byte_bound_and_utf8_boundary() {
        let view = CognitiveView {
            hard_revision: Revision::ZERO,
            repository_id: "repo".into(),
            goal_description: "x".repeat(10_000),
            active_claims: vec![],
            contradictions: vec![],
            rejected_claims: vec![],
            open_obligations: vec![],
            recent_evidence: vec![],
            repository_signals: vec![],
            unknowns: vec![],
            active_hypotheses: vec![],
            active_focus: vec![],
            relevant_files: vec![],
            token_budget_hint: 64,
            model_invocation_count: 0,
        };
        let prompt = view.format_prompt_block();
        assert!(prompt.len() <= 64 * 4);
        assert!(prompt.is_char_boundary(prompt.len()));
        assert!(prompt.ends_with("[view truncated]"));
    }

    #[test]
    fn cognitive_view_exposes_repository_signals_as_non_authoritative_context() {
        let view = CognitiveView {
            hard_revision: Revision::ZERO,
            repository_id: "repo".into(),
            goal_description: "inspect repository".into(),
            active_claims: vec![],
            contradictions: vec![],
            rejected_claims: vec![],
            open_obligations: vec![],
            recent_evidence: vec![],
            repository_signals: vec!["src files=3 bytes=120 relevance=Active".into()],
            unknowns: vec![],
            active_hypotheses: vec![],
            active_focus: vec![],
            relevant_files: vec![],
            token_budget_hint: 256,
            model_invocation_count: 0,
        };
        let prompt = view.format_prompt_block();
        assert!(prompt.contains("REPOSITORY CENSUS SIGNALS (not semantic decisions)"));
        assert!(prompt.contains("src files=3 bytes=120 relevance=Active"));
    }

    #[test]
    fn contradiction_and_rejection_materialization_and_replay() {
        let claim_id = ClaimId::new();
        let ev1 = EvidenceId::new();
        let ev2 = EvidenceId::new();
        let scope = Scope::global("rivet", Revision::ZERO);

        let events = vec![
            NoesisEvent::ClaimAsserted {
                claim_id: claim_id.clone(),
                proposition: "Parser is zero-copy".into(),
                status: EpistemicStatus::Supported,
                evidence: vec![ev1.clone()],
                scope: scope.clone(),
                timestamp: Utc::now(),
            },
            NoesisEvent::ClaimContradicted {
                claim_id: claim_id.clone(),
                contradicted_by: vec![ev2.clone()],
                reason: "Allocates String on every token".into(),
                scope: scope.clone(),
                timestamp: Utc::now(),
            },
            NoesisEvent::ClaimRejected {
                claim_id: ClaimId::new(),
                reason: "Approach dead-ends with borrow-checker cycle".into(),
                evidence: vec![ev2],
                timestamp: Utc::now(),
            },
        ];

        let state = HardState::replay(&events);
        assert_eq!(state.contradictions.len(), 1);
        assert_eq!(state.rejected_claims.len(), 1);
        assert_eq!(
            state.claims.get(&claim_id).unwrap().status,
            EpistemicStatus::Rejected
        );

        let view = CognitiveView {
            hard_revision: state.revision,
            repository_id: "rivet".into(),
            goal_description: "Refactor parser".into(),
            active_claims: vec![],
            contradictions: vec!["Parser allocates String on every token".into()],
            rejected_claims: vec!["Borrow-checker cycle approach".into()],
            open_obligations: vec![],
            recent_evidence: vec![],
            repository_signals: vec![],
            unknowns: vec![],
            active_hypotheses: vec![],
            active_focus: vec![],
            relevant_files: vec![],
            token_budget_hint: 512,
            model_invocation_count: 1,
        };
        let prompt = view.format_prompt_block();
        assert!(prompt.contains("### DETECTED CONTRADICTIONS"));
        assert!(prompt.contains("Parser allocates String on every token"));
        assert!(prompt.contains("### REJECTED / FALSIFIED CLAIMS"));
        assert!(prompt.contains("Borrow-checker cycle approach"));
    }
}
