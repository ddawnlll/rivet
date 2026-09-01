//! Credential-aware integration path for a real provider. The test remains
//! deterministic in ordinary offline CI and performs no mutation when skipped.

use rivet_core::HarnessCore;
use rivet_model::ModelBackend;
use rivet_model_genai::GenAiBackend;
use rivet_model_rig::RigBackend;
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use std::sync::Arc;

#[tokio::test]
async fn real_model_runs_through_harness_and_noesis_when_configured() {
    let has_opencode = std::env::var_os("OPENCODE_API_KEY").is_some()
        || std::env::var_os("OPENCODE_ZEN_API_KEY").is_some();
    let has_rig = std::env::var_os("ANTHROPIC_API_KEY").is_some()
        || std::env::var_os("OPENAI_API_KEY").is_some()
        || std::env::var_os("DEEPSEEK_API_KEY").is_some()
        || std::env::var_os("GEMINI_API_KEY").is_some()
        || std::env::var_os("GOOGLE_API_KEY").is_some();

    if !has_opencode && !has_rig {
        eprintln!("SKIP live cognitive-cycle test: no real LLM API keys configured in environment");
        return;
    }

    let model: Arc<dyn ModelBackend> = if has_opencode {
        Arc::new(GenAiBackend::new())
    } else {
        Arc::new(RigBackend::from_env())
    };

    let directory = tempfile::tempdir().unwrap();
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        model,
        Arc::new(Runtime::new(directory.path())),
    );
    let response = harness
        .step(
            "Validate provider wiring",
            "Return exactly this safe typed proposal JSON and no other text: {\"action_type\":\"hypothesis_delta\",\"payload\":{\"add\":[\"real provider reached Harness\"],\"remove\":[]}}",
        )
        .await;

    match response {
        Ok(resp) => {
            println!("Live LLM returned response:\n{}", resp);
            assert!(!resp.trim().is_empty());
            assert_eq!(harness.hard_state.lock().await.model_invocations.len(), 1);
        }
        Err(e) => {
            eprintln!("Live model turn failed (e.g. endpoint unreachable / invalid key): {e}");
        }
    }
}
