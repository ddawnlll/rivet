//! # rivet-mcp::bridge
//!
//! Bridges external MCP tools into typed Rivet Capabilities and transforms
//! execution outputs into structured Observations and EvidenceRefs.

use crate::schema::{McpCallToolResult, McpTool};
use accp::{ActionProposal, ExecutionReceipt};
use chrono::Utc;
use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCapabilityRegistration {
    pub capability_id: String,
    pub tool_name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub is_verified_provider: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpObservation {
    pub observation_id: String,
    pub evidence_id: EvidenceId,
    pub tool_name: String,
    pub output_text: String,
    pub is_error: bool,
    pub timestamp: chrono::DateTime<Utc>,
}

#[async_trait::async_trait]
pub trait McpTransport: Send + Sync {
    async fn list_tools(&self) -> RivetResult<Vec<McpTool>>;
    async fn call_tool(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> RivetResult<McpCallToolResult>;
}

pub struct McpCapabilityBridge {
    server_name: String,
    transport: Arc<dyn McpTransport>,
    registered_tools: Arc<Mutex<HashMap<String, McpCapabilityRegistration>>>,
}

impl McpCapabilityBridge {
    pub fn new(server_name: impl Into<String>, transport: Arc<dyn McpTransport>) -> Self {
        Self {
            server_name: server_name.into(),
            transport,
            registered_tools: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Discover available tools from the MCP server and register them
    pub async fn discover_capabilities(&self) -> RivetResult<Vec<McpCapabilityRegistration>> {
        let tools = self.transport.list_tools().await?;
        let mut registrations = Vec::new();
        let mut map = self.registered_tools.lock().await;

        for tool in tools {
            let capability_id = format!("mcp.{}.{}", self.server_name, tool.name);
            let registration = McpCapabilityRegistration {
                capability_id: capability_id.clone(),
                tool_name: tool.name.clone(),
                description: tool.description.unwrap_or_default(),
                input_schema: tool.input_schema,
                // External MCP tools start unverified by default
                is_verified_provider: false,
            };
            map.insert(capability_id, registration.clone());
            registrations.push(registration);
        }

        Ok(registrations)
    }

    /// Execute an action proposal via MCP and produce an authoritative ExecutionReceipt + Observation
    pub async fn execute_mcp_action(
        &self,
        proposal: &ActionProposal,
    ) -> RivetResult<(ExecutionReceipt, McpObservation)> {
        let start = std::time::Instant::now();
        let (server, tool_name) = self.parse_capability(&proposal.capability)?;

        if server != self.server_name {
            return Err(RivetError::Runtime(format!(
                "MCP bridge for '{}' cannot handle server '{}'",
                self.server_name, server
            )));
        }

        let call_res = self
            .transport
            .call_tool(&tool_name, proposal.parameters.clone())
            .await?;

        let is_error = call_res.is_error.unwrap_or(false);
        let mut full_text = String::new();
        for content in &call_res.content {
            if let Some(text) = &content.text {
                full_text.push_str(text);
                full_text.push('\n');
            }
        }
        let full_text = full_text.trim().to_string();

        let evid_id = EvidenceId::new();
        let obs = McpObservation {
            observation_id: format!("obs_mcp_{}", Uuid::new_v4().simple()),
            evidence_id: evid_id.clone(),
            tool_name: tool_name.clone(),
            output_text: full_text.clone(),
            is_error,
            timestamp: Utc::now(),
        };

        let receipt = ExecutionReceipt {
            receipt_id: ReceiptId::new(),
            action_id: proposal.action_id.clone(),
            idempotency_key: proposal.idempotency_identity(),
            action_fingerprint: proposal.idempotency_fingerprint()?,
            capability: proposal.capability.clone(),
            success: !is_error,
            exit_code: Some(if is_error { 1 } else { 0 }),
            scope: proposal.scope.clone(),
            risk: proposal.estimated_risk,
            human_approved: false,
            output_summary: if is_error {
                format!("MCP tool '{}' failed: {}", tool_name, full_text)
            } else {
                format!(
                    "MCP tool '{}' completed successfully ({} bytes)",
                    tool_name,
                    full_text.len()
                )
            },
            observations: serde_json::json!({
                "kind": "mcp.observation",
                "server": self.server_name,
                "tool": tool_name,
                "output": full_text,
                "evidence_id": evid_id.to_string(),
            }),
            evidence_id: evid_id,
            execution_duration_ms: start.elapsed().as_millis() as u64,
            timestamp: Utc::now(),
        };

        Ok((receipt, obs))
    }

    fn parse_capability(&self, cap: &str) -> RivetResult<(String, String)> {
        let parts: Vec<&str> = cap.split('.').collect();
        if parts.len() >= 3 && parts[0] == "mcp" {
            Ok((parts[1].to_string(), parts[2..].join(".")))
        } else {
            Err(RivetError::Runtime(format!(
                "Invalid MCP capability format '{}', expected 'mcp.<server>.<tool>'",
                cap
            )))
        }
    }
}
