use accp::{ActionProposal, ActionRisk};
use async_trait::async_trait;
use chrono::Utc;
use rivet_mcp::{McpCallToolResult, McpCapabilityBridge, McpContent, McpTool, McpTransport};
use rivet_runtime::Runtime;
use rivet_types::*;
use std::sync::Arc;
use tempfile::tempdir;

struct MockMcpServer;

#[async_trait]
impl McpTransport for MockMcpServer {
    async fn list_tools(&self) -> RivetResult<Vec<McpTool>> {
        Ok(vec![McpTool {
            name: "fetch_info".into(),
            description: Some("Fetch info".into()),
            input_schema: serde_json::json!({}),
        }])
    }

    async fn call_tool(
        &self,
        name: &str,
        _args: serde_json::Value,
    ) -> RivetResult<McpCallToolResult> {
        if name == "fetch_info" {
            Ok(McpCallToolResult {
                content: vec![McpContent {
                    content_type: "text".into(),
                    text: Some("server_status_ok".into()),
                    data: None,
                    mime_type: Some("text/plain".into()),
                }],
                is_error: Some(false),
            })
        } else {
            Err(RivetError::Runtime(format!("unknown tool {name}")))
        }
    }
}

#[tokio::test]
async fn test_file_read_line_slicing() {
    let dir = tempdir().unwrap();
    let runtime = Runtime::new(dir.path());

    let file_content = (1..=100)
        .map(|i| format!("Line {i} content"))
        .collect::<Vec<_>>()
        .join("\n");
    tokio::fs::write(dir.path().join("test_lines.txt"), file_content)
        .await
        .unwrap();

    let proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "file.read".into(),
        target: "test_lines.txt".into(),
        parameters: serde_json::json!({
            "start_line": 10,
            "end_line": 15
        }),
        estimated_risk: ActionRisk::Inspect,
        scope: Scope::global("rivet", Revision(0)),
        intent: "Read lines 10-15".into(),
        idempotency_key: None,
        timestamp: Utc::now(),
    };

    let receipt = runtime.execute_action(&proposal).await.unwrap();
    assert!(receipt.success);
    assert_eq!(receipt.exit_code, Some(0));

    let obs = receipt.observations;
    assert_eq!(obs.get("start_line").and_then(|v| v.as_u64()), Some(10));
    assert_eq!(obs.get("end_line").and_then(|v| v.as_u64()), Some(15));
    assert_eq!(obs.get("total_lines").and_then(|v| v.as_u64()), Some(100));
    let content = obs.get("content").and_then(|v| v.as_str()).unwrap();
    assert!(content.contains("Line 10 content"));
    assert!(content.contains("Line 14 content"));
}

#[tokio::test]
async fn test_code_search_and_dir_list() {
    let dir = tempdir().unwrap();
    let runtime = Runtime::new(dir.path());

    let src_dir = dir.path().join("src");
    tokio::fs::create_dir_all(&src_dir).await.unwrap();
    tokio::fs::write(
        src_dir.join("main.rs"),
        "fn main() {\n    println!(\"hello rivet search\");\n}\n",
    )
    .await
    .unwrap();
    tokio::fs::write(
        src_dir.join("lib.rs"),
        "pub fn compute() -> i32 {\n    42\n}\n",
    )
    .await
    .unwrap();

    // 1. Test code.search
    let search_proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "code.search".into(),
        target: "search".into(),
        parameters: serde_json::json!({
            "query": "hello rivet"
        }),
        estimated_risk: ActionRisk::Inspect,
        scope: Scope::global("rivet", Revision(0)),
        intent: "Search for greeting".into(),
        idempotency_key: None,
        timestamp: Utc::now(),
    };
    let search_receipt = runtime.execute_action(&search_proposal).await.unwrap();
    assert!(search_receipt.success);
    let search_obs = search_receipt.observations;
    assert_eq!(
        search_obs.get("total_matches").and_then(|v| v.as_u64()),
        Some(1)
    );

    // 2. Test dir.list
    let list_proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "dir.list".into(),
        target: "src".into(),
        parameters: serde_json::json!({}),
        estimated_risk: ActionRisk::Inspect,
        scope: Scope::global("rivet", Revision(0)),
        intent: "List src dir".into(),
        idempotency_key: None,
        timestamp: Utc::now(),
    };
    let list_receipt = runtime.execute_action(&list_proposal).await.unwrap();
    assert!(list_receipt.success);
    let list_obs = list_receipt.observations;
    assert_eq!(
        list_obs.get("total_entries").and_then(|v| v.as_u64()),
        Some(2)
    );
}

#[tokio::test]
async fn test_workspace_snapshot_and_rollback() {
    let dir = tempdir().unwrap();
    let runtime = Runtime::new(dir.path());

    let existing_file = dir.path().join("config.json");
    tokio::fs::write(&existing_file, "{\"initial\": true}")
        .await
        .unwrap();

    // 1. Modify existing file via file.write
    let modify_proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "file.write".into(),
        target: "config.json".into(),
        parameters: serde_json::json!({
            "content": "{\"modified\": true}"
        }),
        estimated_risk: ActionRisk::Material,
        scope: Scope::global("rivet", Revision(0)),
        intent: "Modify config".into(),
        idempotency_key: None,
        timestamp: Utc::now(),
    };
    let write_receipt = runtime.execute_action(&modify_proposal).await.unwrap();
    assert!(write_receipt.success);
    assert_eq!(
        tokio::fs::read_to_string(&existing_file).await.unwrap(),
        "{\"modified\": true}"
    );

    // 2. Create new file via file.write
    let new_file_proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "file.write".into(),
        target: "new_file.txt".into(),
        parameters: serde_json::json!({
            "content": "created in session"
        }),
        estimated_risk: ActionRisk::Material,
        scope: Scope::global("rivet", Revision(0)),
        intent: "Create new file".into(),
        idempotency_key: None,
        timestamp: Utc::now(),
    };
    let new_receipt = runtime.execute_action(&new_file_proposal).await.unwrap();
    assert!(new_receipt.success);
    assert!(dir.path().join("new_file.txt").exists());

    // 3. Rollback
    let rollback_proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "workspace.rollback".into(),
        target: ".".into(),
        parameters: serde_json::json!({}),
        estimated_risk: ActionRisk::Material,
        scope: Scope::global("rivet", Revision(0)),
        intent: "Rollback all changes".into(),
        idempotency_key: None,
        timestamp: Utc::now(),
    };
    let rollback_receipt = runtime.execute_action(&rollback_proposal).await.unwrap();
    assert!(rollback_receipt.success);

    // Verify existing file restored and new file removed
    assert_eq!(
        tokio::fs::read_to_string(&existing_file).await.unwrap(),
        "{\"initial\": true}"
    );
    assert!(!dir.path().join("new_file.txt").exists());
}

#[tokio::test]
async fn test_mcp_capability_bridge_routing() {
    let dir = tempdir().unwrap();
    let runtime = Runtime::new(dir.path());

    let bridge = Arc::new(McpCapabilityBridge::new(
        "db_server",
        Arc::new(MockMcpServer),
    ));
    bridge.discover_capabilities().await.unwrap();
    runtime.register_mcp_bridge("db_server", bridge).await;

    let mcp_proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "mcp.db_server.fetch_info".into(),
        target: ".".into(),
        parameters: serde_json::json!({}),
        estimated_risk: ActionRisk::Inspect,
        scope: Scope::global("rivet", Revision(0)),
        intent: "Fetch db server info".into(),
        idempotency_key: None,
        timestamp: Utc::now(),
    };

    let receipt = runtime.execute_action(&mcp_proposal).await.unwrap();
    assert!(receipt.success);
    assert_eq!(receipt.exit_code, Some(0));
    assert_eq!(receipt.capability, "mcp.db_server.fetch_info");
}
