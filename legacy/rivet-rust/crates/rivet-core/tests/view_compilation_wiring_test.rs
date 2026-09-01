use async_trait::async_trait;
use chrono::Utc;
use noesis::NoesisEvent;
use rivet_core::HarnessCore;
use rivet_model::{ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use rivet_types::*;
use std::sync::Arc;
use tempfile::tempdir;

struct DummyBackend;

#[async_trait]
impl ModelBackend for DummyBackend {
    async fn invoke(&self, _request: ModelRequest) -> RivetResult<ModelResponse> {
        Ok(ModelResponse {
            text_content: "noop".into(),
            actions: vec![],
            usage: TokenUsage::default(),
        })
    }
}

#[tokio::test]
async fn test_harness_compile_view_uses_view_compiler() {
    let dir = tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(dir.path()));
    let store = Arc::new(MemoryStore::new());
    let model = Arc::new(DummyBackend);
    let harness = HarnessCore::new(store.clone(), model, runtime);

    // Record some claims and evidence in hard state
    harness
        .record_event(NoesisEvent::ClaimAsserted {
            claim_id: ClaimId::new(),
            proposition: "The auth subsystem supports multiple providers".into(),
            status: EpistemicStatus::Hypothetical,
            evidence: vec![],
            depends_on: vec![],
            scope: Scope::global("rivet", Revision(0)),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();

    harness
        .record_event(NoesisEvent::EvidenceRecorded {
            evidence_id: EvidenceId::new(),
            source: "file.read".into(),
            summary: "Loaded provider registry configuration".into(),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();

    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: ObligationId::new(),
            description: "Verify that model backend compiles without error".into(),
            scope: Scope::global("rivet", Revision(0)),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();

    // Compile cognitive view
    let view = harness
        .compile_view("Implement robust multi-provider auth")
        .await;

    assert_eq!(
        view.goal_description,
        "Implement robust multi-provider auth"
    );
    assert_eq!(view.active_claims.len(), 1);
    assert_eq!(view.open_obligations.len(), 1);
    assert_eq!(view.recent_evidence.len(), 1);
    assert!(view.token_budget_hint > 0);
    assert_eq!(view.hard_revision, Revision(3));
}
