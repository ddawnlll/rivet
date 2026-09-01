use accp::VerificationRequest;
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
async fn test_dynamic_verification_allowed_and_blocked() {
    let dir = tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(dir.path()));
    let store = Arc::new(MemoryStore::new());
    let model = Arc::new(DummyBackend);
    let harness = HarnessCore::new(store.clone(), model, runtime);

    let obligation_id = ObligationId::new();
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: obligation_id.clone(),
            description: "Check tests pass".into(),
            scope: Scope::global("rivet", Revision(0)),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();

    // 1. Standard runner "cargo" is allowed
    let current_rev = harness.hard_state.lock().await.revision;
    let req = VerificationRequest {
        obligation_id: obligation_id.clone(),
        predicate: "cargo --version".into(),
        target_scope: Scope::global("rivet", current_rev),
        timeout_seconds: 10,
        timestamp: Utc::now(),
    };
    let res = harness.run_verification(req).await;
    assert!(res.is_ok());

    // 2. Unregistered random command like "malicious_script" is denied
    let current_rev = harness.hard_state.lock().await.revision;
    let bad_req = VerificationRequest {
        obligation_id: obligation_id.clone(),
        predicate: "malicious_script --flag".into(),
        target_scope: Scope::global("rivet", current_rev),
        timeout_seconds: 10,
        timestamp: Utc::now(),
    };
    let bad_res = harness.run_verification(bad_req).await;
    assert!(bad_res.is_err());
    assert!(bad_res.unwrap_err().to_string().contains("not exposed"));

    // 3. Manifest discovery: create Makefile in working dir
    tokio::fs::write(dir.path().join("Makefile"), "test:\n\techo ok\n")
        .await
        .unwrap();
    let current_rev = harness.hard_state.lock().await.revision;
    let make_req = VerificationRequest {
        obligation_id: obligation_id.clone(),
        predicate: "make test".into(),
        target_scope: Scope::global("rivet", current_rev),
        timeout_seconds: 10,
        timestamp: Utc::now(),
    };
    let make_res = harness.run_verification(make_req).await;
    assert!(make_res.is_ok());
}
