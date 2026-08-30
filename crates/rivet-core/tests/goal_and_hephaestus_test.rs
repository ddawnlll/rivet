use std::sync::Arc;
use accp::VerificationRequest;
use chrono::Utc;
use rivet_core::*;
use rivet_model::*;
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use rivet_types::*;

struct StubModel;

#[async_trait::async_trait]
impl ModelBackend for StubModel {
    async fn invoke(&self, _req: ModelRequest) -> RivetResult<ModelResponse> {
        Ok(ModelResponse {
            text_content: "Reframing test response".into(),
            actions: vec![],
            usage: TokenUsage {
                input_tokens: 50,
                output_tokens: 20,
                cached_tokens: None,
            },
        })
    }
}

#[tokio::test]
async fn test_goal_compiler_and_hephaestus_reframing_loop() {
    let store = Arc::new(MemoryStore::new());
    let model = Arc::new(StubModel);
    let tmp = tempfile::tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(tmp.path()));

    let harness = HarnessCore::new(store, model, runtime);

    // 1. Test Goal Initialization
    let goal_prompt = "Fix database concurrency bug in src/db.rs and ensure cargo test passes";
    let goal_spec = harness.initialize_goal(goal_prompt).await.unwrap();

    assert_eq!(goal_spec.summary, goal_prompt);
    let open_oblg = harness.hard_state.lock().await.obligations.len();
    assert!(open_oblg >= 2);

    // 2. Test Hephaestus Stagnation & Auto-Reframing
    let oblg_id = harness
        .hard_state
        .lock()
        .await
        .obligations
        .keys()
        .next()
        .unwrap()
        .clone();

    for _ in 0..3 {
        let current_rev = harness.hard_state.lock().await.revision;
        let failing_req = VerificationRequest {
            obligation_id: oblg_id.clone(),
            predicate: "cargo test".into(),
            target_scope: Scope::global("rivet", current_rev),
            timeout_seconds: 10,
            timestamp: Utc::now(),
        };
        let _ = harness.run_verification(failing_req).await;
    }

    // Check that phase became Stagnated and SoftWorkspace was reframed
    assert_eq!(harness.current_phase().await, RunPhase::Stagnated);
    let soft = harness.soft_workspace.lock().await;
    assert!(soft.hypotheses.iter().any(|h| h.contains("[Hephaestus Reframed]")));
}
