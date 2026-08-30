//! Live provider smoke test. It is intentionally a no-op when credentials are
//! not present, so normal workspace CI remains deterministic and offline.

use noesis::CognitiveView;
use rivet_model::{ModelBackend, ModelRequest};
use rivet_model_genai::GenAiBackend;
use std::sync::Arc;

#[tokio::test]
async fn opencode_zen_real_backend_smoke_test_when_configured() {
    if std::env::var_os("OPENCODE_API_KEY").is_none()
        && std::env::var_os("OPENCODE_ZEN_API_KEY").is_none()
    {
        eprintln!("SKIP live OpenCode smoke test: no OPENCODE_API_KEY configured");
        return;
    }

    let backend = GenAiBackend::new();
    let request = ModelRequest {
        model_id: std::env::var("RIVET_MODEL_ID")
            .unwrap_or_else(|_| "muse-spark-1.2-contributor-free".into()),
        system_prompt: Arc::from("Return a concise plain-text health check."),
        cognitive_view: Arc::new(CognitiveView {
            hard_revision: rivet_types::Revision::ZERO,
            repository_id: "smoke-test".into(),
            goal_description: "Provider connectivity smoke test".into(),
            active_claims: vec![],
            open_obligations: vec![],
            recent_evidence: vec![],
            repository_signals: vec![],
            unknowns: vec![],
            active_hypotheses: vec![],
            active_focus: vec![],
            relevant_files: vec![],
            token_budget_hint: 256,
            model_invocation_count: 0,
        }),
        user_prompt: "Reply with the single word READY.".into(),
        temperature: Some(0.0),
        max_tokens: Some(32),
    };
    let response = backend
        .invoke(request.clone())
        .await
        .expect("configured OpenCode backend should answer");
    assert!(!response.text_content.trim().is_empty());
    let stream_chunks = backend
        .stream(request)
        .await
        .expect("configured OpenCode native stream should answer");
    assert!(
        !stream_chunks.is_empty() && stream_chunks.iter().any(|chunk| !chunk.trim().is_empty())
    );
}
