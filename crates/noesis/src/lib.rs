//! # noesis (Cognitive State Kernel)
//!
//! Owns the authoritative Hard State, bounded Soft Workspace, event replay,
//! state promotion, and cognitive view compilation.

use std::collections::HashMap;
use chrono::{DateTime, Utc};
use rivet_types::*;
use serde::{Deserialize, Serialize};

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
}

/// Materialized durable Hard State
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HardState {
    pub revision: Revision,
    pub claims: HashMap<ClaimId, ClaimRecord>,
    pub obligations: HashMap<ObligationId, String>,
    pub closed_obligations: HashMap<ObligationId, ReceiptId>,
    pub evidence: HashMap<EvidenceId, String>,
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
            NoesisEvent::EvidenceRecorded {
                evidence_id,
                summary,
                ..
            } => {
                self.evidence.insert(evidence_id.clone(), summary.clone());
            }
            NoesisEvent::ObligationCreated {
                obligation_id,
                description,
                ..
            } => {
                self.obligations
                    .insert(obligation_id.clone(), description.clone());
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
        if self.hypotheses.len() >= self.max_capacity_items {
            self.hypotheses.remove(0); // Evict oldest
        }
        self.hypotheses.push(hypothesis.into());
    }

    pub fn set_focus(&mut self, focus: Vec<String>) {
        self.active_focus = focus;
    }
}

/// Task-conditioned Cognitive View projected to the model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitiveView {
    pub hard_revision: Revision,
    pub goal_description: String,
    pub active_claims: Vec<ClaimRecord>,
    pub open_obligations: Vec<String>,
    pub active_hypotheses: Vec<String>,
    pub active_focus: Vec<String>,
    pub relevant_files: Vec<String>,
    pub token_budget_hint: u32,
}

impl CognitiveView {
    pub fn format_prompt_block(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!("### CURRENT GOAL (Revision: {})\n", self.hard_revision));
        out.push_str(&format!("{}\n\n", self.goal_description));

        if !self.active_claims.is_empty() {
            out.push_str("### AUTHORITATIVE HARD CLAIMS:\n");
            for c in &self.active_claims {
                out.push_str(&format!("- [{}] {}: {}\n", c.status, c.id, c.proposition));
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
            out.push_str("### OPEN OBLIGATIONS TO VERIFY:\n");
            for o in &self.open_obligations {
                out.push_str(&format!("- [ ] {}\n", o));
            }
            out.push('\n');
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
        assert_eq!(state1.claims.get(&c_id).unwrap().status, EpistemicStatus::Verified);
        assert_eq!(state1.revision, state2.revision);
    }
}
