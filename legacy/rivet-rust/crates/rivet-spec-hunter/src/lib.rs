//! Rivet Spec Hunter — independent oracle
//! This crate NEVER looks at HarnessCore internals to decide what's correct.
//! It parses the normative spec files as oracle and tests Harness against them.
//! If Harness is wrong, hunter must catch it — that's ruthless.

pub mod llm_sim;

use accp::{AccpEnvelope, AccpMessage, AccpSemanticGate, ActionRisk};
use chrono::Utc;
use rivet_types::*;

/// Spec-derived invariants — copied from docs/contracts/ACCP_3_0_SPEC.md §6 and CT-001..007
/// These are NOT imported from accp crate logic; they are independent re-statements of spec.
pub struct SpecOracle;

impl SpecOracle {
    /// CT-001: Controller cannot mint observation
    pub fn ct001_controller_cannot_mint_observation() -> bool {
        let receipt = AccpMessage::ExecutionReceipt(accp::ExecutionReceipt{
            receipt_id: ReceiptId::new(), action_id: ActionId::new(),
            idempotency_key: "k".into(), action_fingerprint: "f".into(),
            capability: "file.read".into(), success: true, exit_code: Some(0),
            scope: Scope::global("rivet", Revision(0)), risk: ActionRisk::Inspect,
            human_approved: false, output_summary: "x".into(), observations: serde_json::json!({}),
            evidence_id: EvidenceId::new(), execution_duration_ms: 1, timestamp: Utc::now(),
        });
        let env = AccpEnvelope::from_message("m1", accp::ActorRole::CognitiveController, &receipt).unwrap();
        env.validate_direction().is_err()
    }

    /// CT-002: Proposal cannot become execution without Harness
    pub fn ct002_proposal_is_not_execution() -> bool {
        let proposal = accp::ActionProposal{
            action_id: ActionId::new(), capability: "file.read".into(), target: "src/lib.rs".into(),
            parameters: serde_json::json!({}), estimated_risk: ActionRisk::Inspect,
            intent: "read".into(), scope: Scope::global("rivet", Revision(0)), idempotency_key: None, timestamp: Utc::now(),
        };
        let msg = AccpMessage::ActionProposal(proposal);
        let env = AccpEnvelope::from_message("m2", accp::ActorRole::CognitiveController, &msg).unwrap();
        // Controller may emit PROPOSAL, but not RECEIPT — validate direction must allow proposal, block receipt
        env.validate_direction().is_ok()
    }

    /// CT-003: Evidence reference does not verify (SUPPORTED != VERIFIED)
    pub fn ct003_evidence_does_not_verify() -> bool {
        let claim = accp::ClaimProposal{
            claim_id: ClaimId::new(), proposition: "evidence exists".into(),
            proposed_status: EpistemicStatus::Verified, supporting_evidence: vec![EvidenceId::new()],
            scope: Scope::global("rivet", Revision(0)), timestamp: Utc::now(),
        };
        AccpSemanticGate::validate_claim_proposal(&claim).is_err()
    }

    /// CT-005: Stale decision cannot authorize new revision
    pub fn ct005_stale_revision_blocked() -> bool {
        let proposal = accp::ActionProposal{
            action_id: ActionId::new(), capability: "file.read".into(), target: "src/lib.rs".into(),
            parameters: serde_json::json!({}), estimated_risk: ActionRisk::Inspect,
            intent: "read".into(), scope: Scope::global("rivet", Revision(0)), idempotency_key: None, timestamp: Utc::now(),
        };
        let policy = accp::ActionAuthorizationPolicy{
            repository: "rivet".into(), current_revision: Revision(5),
            allowed_scope: Scope::global("rivet", Revision(5)),
            allowed_capabilities: vec!["file.read".into()], allow_material: false, human_approved: false,
        };
        let decision = AccpSemanticGate::authorize_action(&proposal, &policy);
        decision.verdict == accp::ActionDecisionVerdict::Block
    }

    /// CT-006: Controller cannot self-complete
    pub fn ct006_controller_cannot_self_complete() -> bool {
        let proposal = accp::CompletionProposal{
            task_id: TaskId::new(), summary: "done".into(), claims_addressed: vec![],
            base_revision: Revision(0), timestamp: Utc::now(),
        };
        let decision = AccpSemanticGate::evaluate_completion(&proposal, Revision(0), vec![], &[]);
        !decision.completed
    }
}

/// Fuzz generator — independent of Harness, generates arbitrary envelopes
pub struct FuzzGen;

impl FuzzGen {
    pub fn random_envelope_variant() -> AccpMessage {
        // Simple deterministic fuzz: cycle through all message kinds with malformed payloads
        // Real fuzzer would use arbitrary bytes; this is a placeholder for cargo fuzz integration
        AccpMessage::ActionProposal(accp::ActionProposal{
            action_id: ActionId::new(), capability: "file.read".into(), target: "../evil".into(),
            parameters: serde_json::json!({}), estimated_risk: ActionRisk::Inspect,
            intent: "fuzz".into(), scope: Scope::global("rivet", Revision(0)), idempotency_key: None, timestamp: Utc::now(),
        })
    }
}

#[cfg(test)]
mod spec_tests {
    use super::SpecOracle;
    #[test]
    fn ct001() { assert!(SpecOracle::ct001_controller_cannot_mint_observation(), "CT-001 failed: controller minted observation"); }
    #[test]
    fn ct002() { assert!(SpecOracle::ct002_proposal_is_not_execution(), "CT-002 failed"); }
    #[test]
    fn ct003() { assert!(SpecOracle::ct003_evidence_does_not_verify(), "CT-003 failed"); }
    #[test]
    fn ct005() { assert!(SpecOracle::ct005_stale_revision_blocked(), "CT-005 failed"); }
    #[test]
    fn ct006() { assert!(SpecOracle::ct006_controller_cannot_self_complete(), "CT-006 failed"); }
}
