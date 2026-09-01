//! # rivet-mcp::config
//!
//! Declarative `.rivet/mcp.json` configuration parsing and multi-server management.

use crate::bridge::{McpCapabilityBridge, McpCapabilityRegistration};
use crate::stdio::StdioProcessTransport;
use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct McpConfigFile {
    #[serde(rename = "mcpServers", default)]
    pub mcp_servers: HashMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpServerConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerStatusDto {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub disabled: bool,
    pub tools_count: usize,
    pub tools: Vec<McpCapabilityRegistration>,
    pub status: String,
}

impl McpConfigFile {
    pub fn load_from_file(path: impl AsRef<Path>) -> RivetResult<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| RivetError::Storage(format!("Failed to read mcp.json: {}", e)))?;
        let config: Self = serde_json::from_str(&content)
            .map_err(|e| RivetError::Serialization(format!("Invalid mcp.json format: {}", e)))?;
        Ok(config)
    }

    pub fn load_from_workspace(root: impl AsRef<Path>) -> RivetResult<Option<Self>> {
        let path = root.as_ref().join(".rivet").join("mcp.json");
        if !path.exists() {
            return Ok(None);
        }
        Self::load_from_file(path).map(Some)
    }

    pub fn instantiate_bridges(
        &self,
        working_dir: Option<PathBuf>,
    ) -> Vec<(String, McpCapabilityBridge)> {
        let mut out = Vec::new();
        for (name, srv) in &self.mcp_servers {
            if srv.disabled {
                continue;
            }
            let mut transport = StdioProcessTransport::new(srv.command.clone(), srv.args.clone());
            for (k, v) in &srv.env {
                transport = transport.with_env(k.clone(), v.clone());
            }
            if let Some(ref dir) = working_dir {
                transport = transport.with_working_dir(dir.clone());
            }
            let bridge = McpCapabilityBridge::new(name.clone(), Arc::new(transport));
            out.push((name.clone(), bridge));
        }
        out
    }
}
