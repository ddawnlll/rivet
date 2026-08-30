//! # rivet-runtime (Execution & Environment Runtime)
//!
//! Sandboxed process execution, file mutations, and environment observations.

use std::path::{Path, PathBuf};
use std::time::Instant;
use accp::{ActionProposal, ExecutionReceipt};
use chrono::Utc;
use rivet_types::*;
use tokio::process::Command;

pub struct Runtime {
    working_dir: PathBuf,
}

impl Runtime {
    pub fn new(working_dir: impl AsRef<Path>) -> Self {
        Self {
            working_dir: working_dir.as_ref().to_path_buf(),
        }
    }

    /// Execute a command in the environment
    pub async fn execute_command(
        &self,
        cmd: &str,
        args: &[&str],
        timeout_seconds: u64,
    ) -> RivetResult<(i32, String, String, u64)> {
        let start = Instant::now();

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_seconds),
            Command::new(cmd)
                .args(args)
                .current_dir(&self.working_dir)
                .output(),
        )
        .await
        .map_err(|_| RivetError::Runtime(format!("Command '{}' timed out after {}s", cmd, timeout_seconds)))?
        .map_err(|e| RivetError::Runtime(e.to_string()))?;

        let duration_ms = start.elapsed().as_millis() as u64;
        let exit_code = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        Ok((exit_code, stdout, stderr, duration_ms))
    }

    /// Execute an authorized action proposal and emit an ExecutionReceipt
    pub async fn execute_action(&self, proposal: &ActionProposal) -> RivetResult<ExecutionReceipt> {
        let start = Instant::now();

        // Dispatch based on capability
        let (success, exit_code, summary) = match proposal.capability.as_str() {
            "file.read" => {
                let path = self.working_dir.join(&proposal.target);
                match tokio::fs::read_to_string(&path).await {
                    Ok(content) => (true, Some(0), format!("Read {} bytes", content.len())),
                    Err(e) => (false, Some(1), format!("Failed to read: {}", e)),
                }
            }
            "file.write" => {
                let path = self.working_dir.join(&proposal.target);
                let content = proposal
                    .parameters
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                match tokio::fs::write(&path, content).await {
                    Ok(_) => (true, Some(0), format!("Wrote {} bytes to {}", content.len(), proposal.target)),
                    Err(e) => (false, Some(1), format!("Failed to write: {}", e)),
                }
            }
            _ => (false, Some(1), format!("Unknown capability: {}", proposal.capability)),
        };

        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(ExecutionReceipt {
            receipt_id: ReceiptId::new(),
            action_id: proposal.action_id.clone(),
            capability: proposal.capability.clone(),
            success,
            exit_code,
            output_summary: summary,
            evidence_id: EvidenceId::new(),
            execution_duration_ms: duration_ms,
            timestamp: Utc::now(),
        })
    }
}
