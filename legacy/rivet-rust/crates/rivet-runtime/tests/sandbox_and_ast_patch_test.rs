use accp::{ActionProposal, ActionRisk};
use chrono::Utc;
use rivet_runtime::{
    CapabilityPolicy, NetworkPolicy, PatchIntent, PatchOperation, Runtime, SandboxConfig,
    SandboxEnforcer, SemanticPatchEngine, WorkerRole,
};
use rivet_types::*;
use std::fs;
use tempfile::tempdir;

#[test]
fn test_sandbox_network_and_pid_enforcement() {
    let config = SandboxConfig {
        network_policy: NetworkPolicy::Blocked,
        ..Default::default()
    };

    // Blocked network command
    let res = SandboxEnforcer::validate_command(&config, "curl", &["https://evil.com"]);
    assert!(res.is_err());
    assert!(
        res.unwrap_err()
            .to_string()
            .contains("Network execution blocked")
    );

    // Allowed local command
    let res = SandboxEnforcer::validate_command(&config, "ls", &["-la"]);
    assert!(res.is_ok());

    // Fork bomb detection
    let res = SandboxEnforcer::validate_command(&config, "bash", &["-c", ":(){ :|:& };:"]);
    assert!(res.is_err());
}

#[test]
fn test_worker_role_least_capability_policy() {
    let refactor_policy = CapabilityPolicy::for_role(WorkerRole::MechanicalRefactor);
    assert!(refactor_policy.is_allowed("file.read"));
    assert!(refactor_policy.is_allowed("file.write"));
    assert!(refactor_policy.is_allowed("semantic.patch"));
    assert!(!refactor_policy.is_allowed("git.reset_hard"));
    assert!(!refactor_policy.is_allowed("git.push"));

    let explorer_policy = CapabilityPolicy::for_role(WorkerRole::Explorer);
    assert!(explorer_policy.is_allowed("file.read"));
    assert!(!explorer_policy.is_allowed("file.write"));
    assert!(!explorer_policy.is_allowed("git.reset_hard"));
}

#[tokio::test]
async fn test_semantic_ast_symbol_patch_engine_replace_body_and_rename() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("auth.rs");
    let initial_code = r#"
pub fn validate_token(token: &str) -> bool {
    let is_valid = token.len() > 10;
    is_valid
}

pub fn refresh_session() {}
"#;
    fs::write(&file_path, initial_code).unwrap();

    // 1. Replace body
    let intent_replace = PatchIntent {
        target: "symbol://auth.rs/validate_token".into(),
        expected_revision: Revision(1),
        operation: PatchOperation::ReplaceBody,
        proposed_artifact: "pub fn validate_token(token: &str) -> bool {\n    !token.is_empty()\n}"
            .into(),
        new_symbol_name: None,
    };

    let msg = SemanticPatchEngine::apply_patch(dir.path(), &intent_replace, Revision(1))
        .await
        .unwrap();
    assert!(msg.contains("Successfully applied ReplaceBody"));

    let updated_code = fs::read_to_string(&file_path).unwrap();
    assert!(updated_code.contains("!token.is_empty()"));
    assert!(!updated_code.contains("token.len() > 10"));
    assert!(updated_code.contains("pub fn refresh_session()"));

    // 2. Test Invariant I-07: Stale revision rejection
    let intent_stale = PatchIntent {
        target: "symbol://auth.rs/refresh_session".into(),
        expected_revision: Revision(1), // Stale! actual is 2
        operation: PatchOperation::ReplaceBody,
        proposed_artifact: "pub fn refresh_session() { println!(\"fresh\"); }".into(),
        new_symbol_name: None,
    };
    let stale_res = SemanticPatchEngine::apply_patch(dir.path(), &intent_stale, Revision(2)).await;
    assert!(stale_res.is_err());
    assert!(matches!(
        stale_res.unwrap_err(),
        RivetError::StaleState { .. }
    ));
}

#[tokio::test]
async fn test_runtime_execute_semantic_patch_action() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("logic.rs");
    fs::write(&file_path, "fn calculate() -> i32 {\n    1 + 1\n}\n").unwrap();

    let runtime = Runtime::new(dir.path());

    let proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "semantic.patch".into(),
        target: "symbol://logic.rs/calculate".into(),
        parameters: serde_json::json!({
            "operation": "replace_body",
            "content": "fn calculate() -> i32 {\n    42\n}",
        }),
        estimated_risk: ActionRisk::Material,
        intent: "update calculate return value".into(),
        scope: Scope::global("rivet", Revision(5)),
        idempotency_key: None,
        timestamp: Utc::now(),
    };

    let receipt = runtime.execute_action(&proposal).await.unwrap();
    assert!(receipt.success);
    assert_eq!(receipt.exit_code, Some(0));

    let updated = fs::read_to_string(&file_path).unwrap();
    assert!(updated.contains("42"));
}
