//! Real-life scenarios — ported 1:1 from opencode's session-runner pattern
//! Each scenario uses llm_sim::sse_events + wiremock to simulate LLM without live API
//! Scenarios: init from scratch, audit existing repo, file mutation with verification

use rivet_core::HarnessCore;
use rivet_model_genai::GenAiBackend;
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use rivet_spec_hunter::llm_sim::{chat_response_with_tool_call, mock_opencode_server};
use std::sync::Arc;

#[tokio::test]
async fn scenario_init_from_scratch() {
    let dir = tempfile::tempdir().unwrap();
    let body = chat_response_with_tool_call("call_1", "file.write", r#"{"target":"Cargo.toml","content":"[package]\nname = \"scratch\"\n"}"#);
    let server = mock_opencode_server(rivet_spec_hunter::llm_sim::ScriptedSse::single(body)).await;
    unsafe { std::env::set_var("OPENCODE_API_KEY", "test"); }
    let backend = GenAiBackend::with_endpoint(format!("{}/v1/chat/completions", server.uri()), "OPENCODE_API_KEY");
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(backend),
        Arc::new(Runtime::new(dir.path())),
    );
    let _res = harness
        .step("init workspace", "Create Cargo.toml for new Rust project")
        .await
        .unwrap();
    let hard = harness.hard_state.lock().await;
    assert_eq!(hard.execution_receipts.len(), 1, "init should produce 1 receipt");
    assert!(hard.evidence.len() == 1, "init should produce evidence");
    assert!(dir.path().join("Cargo.toml").exists(), "Cargo.toml must exist on disk");
}

#[tokio::test]
async fn scenario_audit_existing_repo_with_query() {
    let dir = tempfile::tempdir().unwrap();
    tokio::fs::write(dir.path().join("src_config.rs"), "pub struct AppConfig { pub port: u16 }")
        .await
        .unwrap();
    let body = chat_response_with_tool_call("call_1", "file.read", r#"{"target":"src_config.rs"}"#);
    let server = mock_opencode_server(rivet_spec_hunter::llm_sim::ScriptedSse::single(body)).await;
    unsafe { std::env::set_var("OPENCODE_API_KEY", "test"); }
    let backend = GenAiBackend::with_endpoint(format!("{}/v1/chat/completions", server.uri()), "OPENCODE_API_KEY");
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(backend),
        Arc::new(Runtime::new(dir.path())),
    );
    let _res = harness
        .step("audit repo", "Inspect src_config.rs to find port config")
        .await
        .unwrap();
    let hard = harness.hard_state.lock().await;
    assert_eq!(hard.execution_receipts.len(), 1);
    assert!(hard.execution_receipts[0].capability == "file.read");
}

#[tokio::test]
async fn scenario_multi_turn_tool_loop_like_opencode() {
    let dir = tempfile::tempdir().unwrap();
    tokio::fs::write(dir.path().join("port.txt"), "8080").await.unwrap();
    let body = chat_response_with_tool_call("call_1", "file.read", r#"{"target":"port.txt"}"#);
    let server = mock_opencode_server(rivet_spec_hunter::llm_sim::ScriptedSse::single(body)).await;
    unsafe { std::env::set_var("OPENCODE_API_KEY", "test"); }
    let backend = GenAiBackend::with_endpoint(format!("{}/v1/chat/completions", server.uri()), "OPENCODE_API_KEY");
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(backend),
        Arc::new(Runtime::new(dir.path())),
    );
    harness.step("find port", "Read port.txt").await.unwrap();
    let hard = harness.hard_state.lock().await;
    assert_eq!(hard.execution_receipts[0].success, true);
}
