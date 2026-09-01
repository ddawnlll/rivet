use accp::{AccpEnvelope, AccpMessage, AccpSemanticGate, ActionRisk};
use chrono::Utc;
use rivet_core::HarnessCore;
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use rivet_types::*;
use std::sync::Arc;

struct AttackModel(CognitiveAction);
#[async_trait::async_trait]
impl ModelBackend for AttackModel {
    async fn invoke(&self, _: ModelRequest) -> RivetResult<ModelResponse> {
        Ok(ModelResponse{ text_content: "attack".into(), actions: vec![self.0.clone()], usage: TokenUsage::default()})
    }
}

// Hunter tries to make Harness violate CT-001: mint observation via claim
#[tokio::test]
async fn hunter_ct001_observation_mint_blocked_by_harness() {
    let dir = tempfile::tempdir().unwrap();
    let claim = accp::ClaimProposal{
        claim_id: ClaimId::new(), proposition: "file is clean".into(),
        proposed_status: EpistemicStatus::Verified, // tries to mint VERIFIED
        supporting_evidence: vec![], scope: Scope::global("rivet", Revision(0)), timestamp: Utc::now(),
    };
    let model = Arc::new(AttackModel(CognitiveAction::ClaimProposal(claim)));
    let harness = HarnessCore::new(Arc::new(MemoryStore::new()), model, Arc::new(Runtime::new(dir.path())));
    let res = harness.step("attack", "try to mint VERIFIED").await;
    // Harness must not create a VERIFIED claim in HardState
    let hard = harness.hard_state.lock().await;
    assert!(hard.claims.is_empty() || hard.claims.values().all(|c| c.status != EpistemicStatus::Verified), "CT-001: Harness must not admit VERIFIED from controller");
    // The step should have not created a hard claim (soft only)
    assert_eq!(hard.claims.len(), 0, "CT-001: no hard claim from forged VERIFIED");
}

// Hunter tries CT-005 stale
#[tokio::test]
async fn hunter_ct005_stale_blocked() {
    let dir = tempfile::tempdir().unwrap();
    let harness = HarnessCore::new(Arc::new(MemoryStore::new()), Arc::new(AttackModel(CognitiveAction::Thought("hi".into()))), Arc::new(Runtime::new(dir.path())));
    for _ in 0..3 { harness.record_event(noesis::NoesisEvent::ObligationCreated{ obligation_id: ObligationId::new(), description:"bump".into(), scope: Scope::global("rivet", Revision(0)), timestamp: Utc::now()}).await.unwrap(); }
    assert_eq!(harness.hard_state.lock().await.revision, Revision(3));
    let stale = accp::ActionProposal{
        action_id: ActionId::new(), capability: "file.write".into(), target: "pwn.txt".into(),
        parameters: serde_json::json!({"content":"x"}), estimated_risk: ActionRisk::Material,
        intent: "stale".into(), scope: Scope::global("rivet", Revision(0)), idempotency_key: None, timestamp: Utc::now(),
    };
    let model = Arc::new(AttackModel(CognitiveAction::ToolCall(stale)));
    let harness2 = HarnessCore::from_state(
        harness.store.clone(), model, harness.runtime.clone(),
        harness.session_id.clone(), harness.task_id.clone(), harness.hard_state.lock().await.clone()
    );
    let res = harness2.step("stale", "try stale").await;
    assert!(res.is_err(), "CT-005: stale revision must be blocked");
    assert!(harness2.hard_state.lock().await.execution_receipts.is_empty(), "no receipt for stale");
}

// Hunter tries to make Harness complete without verification
#[tokio::test]
async fn hunter_ct006_completion_without_verification_blocked() {
    let dir = tempfile::tempdir().unwrap();
    let ob = ObligationId::new();
    let harness = HarnessCore::new(Arc::new(MemoryStore::new()), Arc::new(AttackModel(CognitiveAction::CompletionRequest{ summary:"done".into()})), Arc::new(Runtime::new(dir.path())));
    harness.record_event(noesis::NoesisEvent::ObligationCreated{ obligation_id: ob, description:"must verify".into(), scope: Scope::global("rivet", Revision(0)), timestamp: Utc::now()}).await.unwrap();
    let res = harness.step("complete", "try to complete without verification").await;
    assert!(res.is_err(), "CT-006: completion without verification must be blocked");
}

// Fuzz: random controller envelope must never be accepted as Harness-only
#[test]
fn hunter_fuzz_random_controller_envelopes_rejected() {
    for _ in 0..100 {
        let msg = accp::AccpMessage::ExecutionReceipt(accp::ExecutionReceipt{
            receipt_id: ReceiptId::new(), action_id: ActionId::new(), idempotency_key:"k".into(), action_fingerprint:"f".into(),
            capability:"file.read".into(), success:true, exit_code:Some(0), scope: Scope::global("rivet", Revision(0)), risk: ActionRisk::Inspect, human_approved:false, output_summary:"x".into(), observations: serde_json::json!({}), evidence_id: EvidenceId::new(), execution_duration_ms:1, timestamp: Utc::now(),
        });
        let env = AccpEnvelope::from_message("fuzz", accp::ActorRole::CognitiveController, &msg).unwrap();
        assert!(env.validate_direction().is_err(), "fuzz: controller must not emit RECEIPT");
    }
}
