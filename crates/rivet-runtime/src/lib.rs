//! # rivet-runtime (Execution & Environment Runtime)
//!
//! Sandboxed process execution, scoped file mutations, and authoritative
//! observations. Runtime checks are deliberately repeated below ACCP so a
//! caller cannot bypass the boundary by invoking the adapter directly.

use accp::{ActionProposal, ExecutionReceipt};
use chrono::Utc;
use rivet_types::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tokio::process::Command;
use tokio::sync::Mutex;

const MAX_OBSERVATION_BYTES: usize = 64 * 1024;

pub struct Runtime {
    working_dir: PathBuf,
    executed_actions: Arc<Mutex<HashMap<String, CachedAction>>>,
    execution_lock: Arc<Mutex<()>>,
}

#[derive(Clone)]
struct CachedAction {
    fingerprint: String,
    receipt: ExecutionReceipt,
}

impl Runtime {
    pub fn new(working_dir: impl AsRef<Path>) -> Self {
        Self {
            working_dir: working_dir.as_ref().to_path_buf(),
            executed_actions: Arc::new(Mutex::new(HashMap::new())),
            execution_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn working_dir(&self) -> &Path {
        &self.working_dir
    }

    /// Execute a command in the environment with a bounded wall-clock time.
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
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| {
            RivetError::Runtime(format!(
                "Command '{}' timed out after {}s",
                cmd, timeout_seconds
            ))
        })?
        .map_err(|e| RivetError::Runtime(e.to_string()))?;

        let duration_ms = start.elapsed().as_millis() as u64;
        let exit_code = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        Ok((exit_code, stdout, stderr, duration_ms))
    }

    /// Execute an authorized action proposal and emit an ExecutionReceipt.
    pub async fn execute_action(&self, proposal: &ActionProposal) -> RivetResult<ExecutionReceipt> {
        // The identity check and side effect must be one critical section;
        // otherwise concurrent retries can both pass the cache lookup.
        let _execution_guard = self.execution_lock.lock().await;
        let identity = proposal.idempotency_identity();
        let fingerprint = proposal.idempotency_fingerprint()?;
        if let Some(previous) = self.executed_actions.lock().await.get(&identity).cloned() {
            if previous.fingerprint == fingerprint {
                tracing::debug!(
                    action_id = %proposal.action_id,
                    "returning idempotent action receipt"
                );
                return Ok(previous.receipt);
            }
            return Err(RivetError::Runtime(format!(
                "idempotency key '{}' was reused for a different action",
                identity
            )));
        }

        let start = Instant::now();
        let result = match proposal.capability.as_str() {
            "file.read" => {
                let path = match self.resolve_target(&proposal.target).await {
                    Ok(path) => path,
                    Err(error) => {
                        return self
                            .failed_receipt(proposal, start, error.to_string())
                            .await;
                    }
                };
                match tokio::fs::read_to_string(&path).await {
                    Ok(content) => {
                        let truncated = content.len() > MAX_OBSERVATION_BYTES;
                        let observed = if truncated {
                            let mut end = MAX_OBSERVATION_BYTES;
                            while !content.is_char_boundary(end) {
                                end -= 1;
                            }
                            content[..end].to_string()
                        } else {
                            content.clone()
                        };
                        (
                            true,
                            Some(0),
                            format!(
                                "Read {} bytes{}",
                                content.len(),
                                if truncated { " (truncated)" } else { "" }
                            ),
                            serde_json::json!({
                                "kind": "file.read",
                                "target": proposal.target,
                                "content": observed,
                                "truncated": truncated,
                            }),
                        )
                    }
                    Err(error) => (
                        false,
                        Some(1),
                        format!("Failed to read: {error}"),
                        serde_json::json!({ "kind": "file.read", "target": proposal.target }),
                    ),
                }
            }
            "file.write" => {
                let path = match self.resolve_target(&proposal.target).await {
                    Ok(path) => path,
                    Err(error) => {
                        return self
                            .failed_receipt(proposal, start, error.to_string())
                            .await;
                    }
                };
                let Some(content) = proposal.parameters.get("content").and_then(|v| v.as_str())
                else {
                    return self
                        .failed_receipt(
                            proposal,
                            start,
                            "file.write requires a string content parameter".into(),
                        )
                        .await;
                };
                let parent = path.parent().unwrap_or(&self.working_dir);
                if let Err(error) = tokio::fs::create_dir_all(parent).await {
                    return self
                        .failed_receipt(
                            proposal,
                            start,
                            format!("Failed to create parent: {error}"),
                        )
                        .await;
                }
                let temp_name = format!(
                    ".{}.rivet-tmp-{}",
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("file"),
                    ActionId::new()
                );
                let temp_path = parent.join(temp_name);
                match tokio::fs::write(&temp_path, content).await {
                    Ok(_) => match tokio::fs::rename(&temp_path, &path).await {
                        Ok(_) => (
                            true,
                            Some(0),
                            format!("Wrote {} bytes to {}", content.len(), proposal.target),
                            serde_json::json!({
                                "kind": "file.write",
                                "target": proposal.target,
                                "bytes": content.len(),
                            }),
                        ),
                        Err(error) => {
                            let _ = tokio::fs::remove_file(&temp_path).await;
                            (
                                false,
                                Some(1),
                                format!("Failed to atomically replace file: {error}"),
                                serde_json::json!({ "kind": "file.write", "target": proposal.target }),
                            )
                        }
                    },
                    Err(error) => {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        (
                            false,
                            Some(1),
                            format!("Failed to write temporary file: {error}"),
                            serde_json::json!({ "kind": "file.write", "target": proposal.target }),
                        )
                    }
                }
            }
            _ => (
                false,
                Some(1),
                format!("Unknown capability: {}", proposal.capability),
                serde_json::json!({ "kind": "unknown", "capability": proposal.capability }),
            ),
        };

        let (success, exit_code, summary, observations) = result;
        let receipt = ExecutionReceipt {
            receipt_id: ReceiptId::new(),
            action_id: proposal.action_id.clone(),
            idempotency_key: proposal.idempotency_identity(),
            action_fingerprint: proposal.idempotency_fingerprint()?,
            capability: proposal.capability.clone(),
            success,
            exit_code,
            scope: proposal.scope.clone(),
            risk: proposal.estimated_risk,
            human_approved: false,
            output_summary: summary,
            observations,
            evidence_id: EvidenceId::new(),
            execution_duration_ms: start.elapsed().as_millis() as u64,
            timestamp: Utc::now(),
        };
        self.executed_actions.lock().await.insert(
            identity,
            CachedAction {
                fingerprint,
                receipt: receipt.clone(),
            },
        );
        Ok(receipt)
    }

    async fn failed_receipt(
        &self,
        proposal: &ActionProposal,
        start: Instant,
        summary: String,
    ) -> RivetResult<ExecutionReceipt> {
        let receipt = ExecutionReceipt {
            receipt_id: ReceiptId::new(),
            action_id: proposal.action_id.clone(),
            idempotency_key: proposal.idempotency_identity(),
            action_fingerprint: proposal.idempotency_fingerprint()?,
            capability: proposal.capability.clone(),
            success: false,
            exit_code: Some(1),
            scope: proposal.scope.clone(),
            risk: proposal.estimated_risk,
            human_approved: false,
            output_summary: summary,
            observations: serde_json::json!({ "kind": "runtime.rejected" }),
            evidence_id: EvidenceId::new(),
            execution_duration_ms: start.elapsed().as_millis() as u64,
            timestamp: Utc::now(),
        };
        self.executed_actions.lock().await.insert(
            proposal.idempotency_identity(),
            CachedAction {
                fingerprint: proposal.idempotency_fingerprint()?,
                receipt: receipt.clone(),
            },
        );
        Ok(receipt)
    }

    async fn resolve_target(&self, target: &str) -> RivetResult<PathBuf> {
        if target.trim().is_empty() || !is_safe_relative_path(target) {
            return Err(RivetError::InvalidPath(target.into()));
        }
        let root = tokio::fs::canonicalize(&self.working_dir)
            .await
            .map_err(|error| {
                RivetError::Runtime(format!("working directory is unavailable: {error}"))
            })?;
        let norm_target = target.replace('\\', "/");
        let candidate = root.join(&norm_target);

        let is_existing = match tokio::fs::symlink_metadata(&candidate).await {
            Ok(meta) => {
                if meta.is_symlink() {
                    tokio::fs::canonicalize(&candidate).await.is_ok()
                } else {
                    true
                }
            }
            Err(_) => false,
        };

        let check_path = if is_existing {
            tokio::fs::canonicalize(&candidate)
                .await
                .map_err(|error| RivetError::Runtime(error.to_string()))?
        } else {
            let mut ancestor = candidate.as_path();
            while !tokio::fs::try_exists(ancestor).await.unwrap_or(false) {
                ancestor = ancestor
                    .parent()
                    .ok_or_else(|| RivetError::InvalidPath(target.into()))?;
            }
            let canonical_ancestor = tokio::fs::canonicalize(ancestor)
                .await
                .map_err(|error| RivetError::Runtime(error.to_string()))?;
            let suffix = candidate
                .strip_prefix(ancestor)
                .map_err(|error| RivetError::InvalidPath(error.to_string()))?;
            canonical_ancestor.join(suffix)
        };
        if !check_path.starts_with(&root) {
            return Err(RivetError::InvalidPath(target.into()));
        }
        Ok(candidate)
    }
}
