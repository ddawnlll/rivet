//! # accp (ACCP 3.0 Protocol Implementation)
//!
//! Strict semantic protocol defining legal commitments, authority boundaries,
//! and event transitions between Cognitive Controller and Authoritative Harness.

use chrono::{DateTime, Utc};
use rivet_types::*;
use serde::{Deserialize, Serialize};

/// Action risk level defined by ACCP 3.0
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionRisk {
    /// Read-only / inspection (zero side effects)
    Inspect,
    /// Targeted modification with git checkpoint / easily reversible
    Material,
    /// Irreversible / global mutation (e.g. hard reset, force push, drop db)
    Destructive,
}

/// Action decision verdict emitted by Harness
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionDecisionVerdict {
    Allow,
    Block,
    RequireHumanApproval,
}

/// 1. Action Proposal emitted by Cognitive Controller
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionProposal {
    pub action_id: ActionId,
    pub capability: String,
    pub target: String,
    pub parameters: serde_json::Value,
    pub estimated_risk: ActionRisk,
    pub intent: String,
    pub scope: Scope,
    pub timestamp: DateTime<Utc>,
}

/// 2. Action Decision emitted by Authoritative Harness
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionDecision {
    pub action_id: ActionId,
    pub verdict: ActionDecisionVerdict,
    pub reason: String,
    pub authorized_scope: Scope,
    pub timestamp: DateTime<Utc>,
}

/// 3. Execution Receipt issued after authoritative runtime execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionReceipt {
    pub receipt_id: ReceiptId,
    pub action_id: ActionId,
    pub capability: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub output_summary: String,
    pub evidence_id: EvidenceId,
    pub execution_duration_ms: u64,
    pub timestamp: DateTime<Utc>,
}

/// 4. Claim Proposal emitted by Cognitive Controller
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimProposal {
    pub claim_id: ClaimId,
    pub proposition: String,
    pub proposed_status: EpistemicStatus,
    pub supporting_evidence: Vec<EvidenceId>,
    pub scope: Scope,
    pub timestamp: DateTime<Utc>,
}

/// 5. Verification Request emitted to Praxis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationRequest {
    pub obligation_id: ObligationId,
    pub predicate: String,
    pub target_scope: Scope,
    pub timeout_seconds: u32,
    pub timestamp: DateTime<Utc>,
}

/// 6. Verification Receipt issued by Praxis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationReceipt {
    pub receipt_id: ReceiptId,
    pub obligation_id: ObligationId,
    pub passed: bool,
    pub evidence_id: EvidenceId,
    pub verified_scope: Scope,
    pub diagnostics: Option<String>,
    pub timestamp: DateTime<Utc>,
}

/// 7. State Transition Proposal emitted by Controller
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateTransitionProposal {
    pub base_revision: Revision,
    pub claims_to_assert: Vec<ClaimProposal>,
    pub claims_to_reject: Vec<ClaimId>,
    pub obligations_to_create: Vec<String>,
    pub timestamp: DateTime<Utc>,
}

/// 8. Completion Proposal emitted by Controller
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionProposal {
    pub task_id: TaskId,
    pub summary: String,
    pub claims_addressed: Vec<ClaimId>,
    pub timestamp: DateTime<Utc>,
}

/// 9. Completion Decision issued by Harness (Praxis gate enforced)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionDecision {
    pub task_id: TaskId,
    pub completed: bool,
    pub required_obligations_satisfied: bool,
    pub unclosed_obligations: Vec<ObligationId>,
    pub final_receipt: Option<ReceiptId>,
    pub timestamp: DateTime<Utc>,
}

/// All 9 Normative ACCP 3.0 Message Classes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "class", content = "payload", rename_all = "snake_case")]
pub enum AccpMessage {
    ActionProposal(ActionProposal),
    ActionDecision(ActionDecision),
    ExecutionReceipt(ExecutionReceipt),
    ClaimProposal(ClaimProposal),
    VerificationRequest(VerificationRequest),
    VerificationReceipt(VerificationReceipt),
    StateTransitionProposal(StateTransitionProposal),
    CompletionProposal(CompletionProposal),
    CompletionDecision(CompletionDecision),
}

/// Invariant Gate Enforcement
pub struct AccpSemanticGate;

impl AccpSemanticGate {
    /// Invariant 6.2: Proposal is not execution
    pub fn ensure_execution_authorized(decision: &ActionDecision) -> RivetResult<()> {
        match decision.verdict {
            ActionDecisionVerdict::Allow => Ok(()),
            ActionDecisionVerdict::Block => Err(RivetError::AuthorityDenied(format!(
                "Action blocked by policy: {}",
                decision.reason
            ))),
            ActionDecisionVerdict::RequireHumanApproval => Err(RivetError::AuthorityDenied(
                "Action requires explicit human approval".into(),
            )),
        }
    }

    /// Invariant 6.12: Controller prose is not completion
    pub fn check_completion_authority(unclosed_obligations: &[ObligationId]) -> RivetResult<()> {
        if !unclosed_obligations.is_empty() {
            return Err(RivetError::SemanticViolation(format!(
                "Cannot complete task: {} obligations remain unverified",
                unclosed_obligations.len()
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_completion_invariant() {
        let unclosed = vec![ObligationId::new()];
        assert!(AccpSemanticGate::check_completion_authority(&unclosed).is_err());
        assert!(AccpSemanticGate::check_completion_authority(&[]).is_ok());
    }

    #[test]
    fn test_action_decision_invariant() {
        let block_decision = ActionDecision {
            action_id: ActionId::new(),
            verdict: ActionDecisionVerdict::Block,
            reason: "destructive action without authority".into(),
            authorized_scope: Scope::global("test", Revision::ZERO),
            timestamp: Utc::now(),
        };
        assert!(AccpSemanticGate::ensure_execution_authorized(&block_decision).is_err());
    }
}
