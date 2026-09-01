//! # rivet-mcp::stdio
//!
//! Subprocess-based JSON-RPC 2.0 Transport for MCP servers over stdio pipes.

use crate::bridge::McpTransport;
use crate::schema::{McpCallToolResult, McpTool, McpToolsListResult};
use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::{Duration, timeout};

#[derive(Debug, Serialize, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

struct ProcessPipes {
    _child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
}

pub struct StdioProcessTransport {
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    working_dir: Option<PathBuf>,
    pipes: Arc<Mutex<Option<ProcessPipes>>>,
    next_id: AtomicU64,
    timeout_duration: Duration,
}

impl StdioProcessTransport {
    pub fn new(command: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            command: command.into(),
            args,
            env: HashMap::new(),
            working_dir: None,
            pipes: Arc::new(Mutex::new(None)),
            next_id: AtomicU64::new(1),
            timeout_duration: Duration::from_secs(30),
        }
    }

    pub fn with_env(mut self, key: impl Into<String>, val: impl Into<String>) -> Self {
        self.env.insert(key.into(), val.into());
        self
    }

    pub fn with_working_dir(mut self, path: PathBuf) -> Self {
        self.working_dir = Some(path);
        self
    }

    pub fn with_timeout(mut self, duration: Duration) -> Self {
        self.timeout_duration = duration;
        self
    }

    async fn ensure_spawned(&self) -> RivetResult<()> {
        let mut guard = self.pipes.lock().await;
        if guard.is_some() {
            return Ok(());
        }

        let mut cmd = Command::new(&self.command);
        cmd.args(&self.args);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::null());

        for (k, v) in &self.env {
            cmd.env(k, v);
        }
        if let Some(dir) = &self.working_dir {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn().map_err(|e| {
            RivetError::Runtime(format!(
                "Failed to spawn MCP subprocess '{}': {}",
                self.command, e
            ))
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| RivetError::Runtime("Failed to open child stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| RivetError::Runtime("Failed to open child stdout".into()))?;
        let reader = BufReader::new(stdout);

        *guard = Some(ProcessPipes {
            _child: child,
            stdin,
            reader,
        });

        Ok(())
    }

    async fn send_request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> RivetResult<serde_json::Value> {
        self.ensure_spawned().await?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: method.to_string(),
            params,
        };

        let payload =
            serde_json::to_string(&req).map_err(|e| RivetError::Serialization(e.to_string()))?;

        let mut guard = self.pipes.lock().await;
        let pipes = guard
            .as_mut()
            .ok_or_else(|| RivetError::Runtime("Process pipes not initialized".into()))?;

        let write_fut = async {
            pipes.stdin.write_all(payload.as_bytes()).await?;
            pipes.stdin.write_all(b"\n").await?;
            pipes.stdin.flush().await?;
            Ok::<(), std::io::Error>(())
        };

        timeout(self.timeout_duration, write_fut)
            .await
            .map_err(|_| RivetError::Timeout("Timeout writing request to MCP server".into()))?
            .map_err(|e| RivetError::Runtime(format!("I/O write error: {}", e)))?;

        let read_fut = async {
            let mut line = String::new();
            loop {
                line.clear();
                let bytes = pipes.reader.read_line(&mut line).await?;
                if bytes == 0 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "MCP subprocess closed stdout EOF",
                    ));
                }
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                // Try parse JSON-RPC response
                if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(trimmed)
                    && resp.id == Some(id)
                {
                    return Ok(resp);
                }
            }
        };

        let response = timeout(self.timeout_duration, read_fut)
            .await
            .map_err(|_| RivetError::Timeout("Timeout awaiting response from MCP server".into()))?
            .map_err(|e| RivetError::Runtime(format!("I/O read error: {}", e)))?;

        if let Some(err) = response.error {
            return Err(RivetError::Runtime(format!(
                "MCP JSON-RPC error ({}): {}",
                err.code, err.message
            )));
        }

        response
            .result
            .ok_or_else(|| RivetError::Runtime("Empty result from MCP response".into()))
    }
}

#[async_trait::async_trait]
impl McpTransport for StdioProcessTransport {
    async fn list_tools(&self) -> RivetResult<Vec<McpTool>> {
        let result = self.send_request("tools/list", None).await?;
        let parsed: McpToolsListResult = serde_json::from_value(result)
            .map_err(|e| RivetError::Serialization(format!("Invalid tools/list schema: {}", e)))?;
        Ok(parsed.tools)
    }

    async fn call_tool(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> RivetResult<McpCallToolResult> {
        let params = serde_json::json!({
            "name": name,
            "arguments": args
        });
        let result = self.send_request("tools/call", Some(params)).await?;
        let parsed: McpCallToolResult = serde_json::from_value(result)
            .map_err(|e| RivetError::Serialization(format!("Invalid tools/call schema: {}", e)))?;
        Ok(parsed)
    }
}
