use rivet_core::HarnessCore;
use rivet_model_genai::GenAiBackend;
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use std::sync::Arc;

#[tokio::test]
async fn test_live_llm_tool_calling_and_steering() {
    if std::env::var_os("OPENCODE_API_KEY").is_none()
        && std::env::var_os("OPENCODE_ZEN_API_KEY").is_none()
    {
        eprintln!("SKIP live tool calling test: no OPENCODE_API_KEY configured");
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(dir.path()));
    let store = Arc::new(MemoryStore::new());
    let model = Arc::new(GenAiBackend::new());
    let harness = HarnessCore::new(store, model, runtime);

    // Create a target file in the workspace
    let sample_code = r#"// Server configuration
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub max_connections: usize,
}

pub fn default_config() -> AppConfig {
    AppConfig {
        host: "127.0.0.1".into(),
        port: 8080,
        max_connections: 500,
    }
}
"#;
    tokio::fs::write(dir.path().join("src_config.rs"), sample_code)
        .await
        .unwrap();

    // Turn 1: Live LLM executes code search or file read
    let prompt1 = "Please inspect src_config.rs using code.search or file.read to find what port is configured.";

    println!("\n>>> [TURN 1 PROMPT]: Sending task to live OpenCode mimo-v2.5...");
    let response1 = harness
        .step("Find port in src_config.rs", prompt1)
        .await
        .expect("Turn 1 should complete");
    println!("<<< [TURN 1 LIVE LLM RAW RESPONSE]:\n{}", response1);

    // Verify turn 1 executed real actions
    let hard1 = harness.hard_state.lock().await;
    println!("\n[HARNESS STATE AFTER TURN 1]:");
    println!("- Hard Revision: {}", hard1.revision.0);
    println!("- Execution Receipts: {}", hard1.execution_receipts.len());
    for receipt in &hard1.execution_receipts {
        println!(
            "  * Capability: {}, Success: {}, Observations: {:?}",
            receipt.capability, receipt.success, receipt.observations
        );
    }
    assert!(
        !hard1.execution_receipts.is_empty(),
        "Live LLM must emit an authorized ACCP action proposal"
    );
    drop(hard1);

    // Turn 2: Live LLM receives the observation and records a hypothesis or conclusion
    let prompt2 = "Based on the observations from your previous action, return a hypothesis_delta JSON confirming the port number found in src_config.rs.";
    println!("\n>>> [TURN 2 PROMPT]: Sending conclusion prompt to live mimo-v2.5...");
    let response2 = harness
        .step("Record port findings", prompt2)
        .await
        .expect("Turn 2 should complete");
    println!("<<< [TURN 2 LIVE LLM RAW RESPONSE]:\n{}", response2);

    let hard2 = harness.hard_state.lock().await;
    println!("\n[HARNESS STATE AFTER TURN 2]:");
    println!("- Final Hard Revision: {}", hard2.revision.0);
    println!(
        "- Total Model Invocations: {}",
        hard2.model_invocations.len()
    );
    assert_eq!(
        hard2.model_invocations.len(),
        2,
        "Harness must record durable invocation receipts for both turns"
    );
}
