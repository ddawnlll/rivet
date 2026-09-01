use async_trait::async_trait;
use rivet_core::HarnessCore;
use rivet_model::{ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use rivet_types::*;
use std::sync::Arc;
use tempfile::tempdir;

struct MalformedJsonBackend;

#[async_trait]
impl ModelBackend for MalformedJsonBackend {
    async fn invoke(&self, _request: ModelRequest) -> RivetResult<ModelResponse> {
        Ok(ModelResponse {
            text_content: r#"I will execute tool: {"action_type": "tool_call", "payload": { INVALID JSON HERE"#.into(),
            actions: vec![],
            usage: TokenUsage::default(),
        })
    }
}

#[tokio::test]
async fn test_malformed_json_adds_feedback_hypothesis() {
    let dir = tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(dir.path()));
    let store = Arc::new(MemoryStore::new());
    let model = Arc::new(MalformedJsonBackend);
    let harness = HarnessCore::new(store, model, runtime);

    let resp = harness.step("Test goal", "Search for files").await.unwrap();
    assert!(resp.contains("INVALID JSON"));

    // Check soft workspace for corrective feedback hypothesis
    let hypotheses = harness.soft_workspace.lock().await.hypotheses.clone();
    assert!(hypotheses.iter().any(|h| {
        h.contains("Model output attempted an action proposal but the JSON payload was malformed")
    }));
}
