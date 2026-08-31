use accp::{ActionProposal, ActionRisk};
use chrono::Utc;
use rivet_mcp::{McpCallToolResult, McpCapabilityBridge, McpContent, McpTool, McpTransport};
use rivet_types::*;
use std::sync::Arc;

struct MockMcpServer;

#[async_trait::async_trait]
impl McpTransport for MockMcpServer {
    async fn list_tools(&self) -> RivetResult<Vec<McpTool>> {
        Ok(vec![
            McpTool {
                name: "fetch_schema".into(),
                description: Some("Fetch DB schema".into()),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "table": { "type": "string" }
                    }
                }),
            },
            McpTool {
                name: "query_db".into(),
                description: Some("Execute SQL query".into()),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "sql": { "type": "string" }
                    }
                }),
            },
        ])
    }

    async fn call_tool(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> RivetResult<McpCallToolResult> {
        if name == "fetch_schema" {
            let table = args
                .get("table")
                .and_then(|v| v.as_str())
                .unwrap_or("users");
            Ok(McpCallToolResult {
                content: vec![McpContent {
                    content_type: "text".into(),
                    text: Some(format!(
                        "CREATE TABLE {} (id INT PRIMARY KEY, name TEXT);",
                        table
                    )),
                    data: None,
                    mime_type: Some("text/sql".into()),
                }],
                is_error: Some(false),
            })
        } else if name == "query_db" {
            Ok(McpCallToolResult {
                content: vec![McpContent {
                    content_type: "text".into(),
                    text: Some("1 row returned: (1, 'Alice')".into()),
                    data: None,
                    mime_type: None,
                }],
                is_error: Some(false),
            })
        } else {
            Ok(McpCallToolResult {
                content: vec![McpContent {
                    content_type: "text".into(),
                    text: Some(format!("Unknown tool: {}", name)),
                    data: None,
                    mime_type: None,
                }],
                is_error: Some(true),
            })
        }
    }
}

#[tokio::test]
async fn test_mcp_discovery_and_observation_conversion() {
    let mock = Arc::new(MockMcpServer);
    let bridge = McpCapabilityBridge::new("postgres_mcp", mock);

    // 1. Tool Discovery
    let capabilities = bridge.discover_capabilities().await.unwrap();
    assert_eq!(capabilities.len(), 2);
    assert_eq!(
        capabilities[0].capability_id,
        "mcp.postgres_mcp.fetch_schema"
    );
    assert!(!capabilities[0].is_verified_provider);

    // 2. Tool Execution to Observation and Receipt
    let proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "mcp.postgres_mcp.fetch_schema".into(),
        target: "db://postgres/users".into(),
        parameters: serde_json::json!({ "table": "users" }),
        estimated_risk: ActionRisk::Inspect,
        intent: "inspect users table schema".into(),
        scope: Scope::global("rivet", Revision::ZERO),
        idempotency_key: None,
        timestamp: Utc::now(),
    };

    let (receipt, observation) = bridge.execute_mcp_action(&proposal).await.unwrap();

    assert!(receipt.success);
    assert_eq!(receipt.exit_code, Some(0));
    assert!(receipt.output_summary.contains("completed successfully"));
    assert_eq!(observation.tool_name, "fetch_schema");
    assert!(observation.output_text.contains("CREATE TABLE users"));
    assert!(!observation.is_error);
    assert_eq!(receipt.evidence_id, observation.evidence_id);
}

#[tokio::test]
async fn test_stdio_process_transport_mock_responder() {
    use rivet_mcp::StdioProcessTransport;

    // Python one-liner mock JSON-RPC server that reads line and echoes JSON-RPC response
    let py_script = r#"
import sys, json
for line in sys.stdin:
    req = json.loads(line.strip())
    req_id = req.get("id")
    method = req.get("method")
    if method == "tools/list":
        res = {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": [
                    {
                        "name": "system_stat",
                        "description": "Returns system status",
                        "input_schema": {"type": "object"}
                    }
                ]
            }
        }
    elif method == "tools/call":
        res = {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [{"type": "text", "text": "cpu_load=0.15"}],
                "isError": False
            }
        }
    else:
        res = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found"}}
    sys.stdout.write(json.dumps(res) + "\n")
    sys.stdout.flush()
"#;

    let transport = StdioProcessTransport::new("python3", vec!["-c".into(), py_script.into()]);
    let tools = transport.list_tools().await.unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "system_stat");

    let call_res = transport
        .call_tool("system_stat", serde_json::json!({}))
        .await
        .unwrap();
    assert_eq!(call_res.content.len(), 1);
    assert_eq!(call_res.content[0].text.as_deref(), Some("cpu_load=0.15"));
    assert_eq!(call_res.is_error, Some(false));
}
