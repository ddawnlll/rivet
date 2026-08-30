//! Credential-aware integration path for a real provider. The test remains
//! deterministic in ordinary offline CI and performs no mutation when skipped.

use rivet_core::HarnessCore;
use rivet_model_genai::GenAiBackend;
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use std::sync::Arc;

#[tokio::test]
async fn real_model_runs_through_harness_and_noesis_when_configured() {
    if std::env::var_os("OPENCODE_API_KEY").is_none()
        && std::env::var_os("OPENCODE_ZEN_API_KEY").is_none()
    {
        eprintln!("SKIP live cognitive-cycle test: no OPENCODE_API_KEY configured");
        return;
    }

    let directory = tempfile::tempdir().unwrap();
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(GenAiBackend::new()),
        Arc::new(Runtime::new(directory.path())),
    );
    let response = harness
        .step(
            "Validate provider wiring",
            "Return exactly this safe typed proposal JSON and no other text: {\"action_type\":\"hypothesis_delta\",\"payload\":{\"add\":[\"real provider reached Harness\"],\"remove\":[]}}",
        )
        .await
        .expect("configured real provider should complete a Harness turn");
    assert!(!response.trim().is_empty());
    assert_eq!(harness.hard_state.lock().await.model_invocations.len(), 1);
}
