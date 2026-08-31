//! # rivet-mcp (External MCP Capability Bridge)
//!
//! Model Context Protocol (MCP) external tool integration boundary.
//! Maps external tool definitions to typed Capabilities and converts tool
//! executions into non-authoritative Observations and EvidenceRecords.

pub mod bridge;
pub mod schema;
pub mod stdio;

pub use bridge::{McpCapabilityBridge, McpCapabilityRegistration, McpObservation, McpTransport};
pub use schema::{McpCallToolResult, McpContent, McpTool, McpToolsListResult};
pub use stdio::StdioProcessTransport;
