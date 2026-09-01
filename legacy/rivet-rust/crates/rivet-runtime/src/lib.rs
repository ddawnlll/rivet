//! # rivet-runtime (Execution & Environment Runtime)
//!
//! Sandboxed process execution, scoped file mutations, and authoritative
//! observations. Runtime checks are deliberately repeated below ACCP so a
//! caller cannot bypass the boundary by invoking the adapter directly.

use accp::{ActionProposal, ExecutionReceipt};
use chrono::Utc;
use rivet_types::*;
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const MAX_OBSERVATION_BYTES: usize = 64 * 1024;
pub const DEFAULT_MAX_COMMAND_OUTPUT_BYTES: usize = 1024 * 1024;
const OUTPUT_TRUNCATION_MARKER: &str = "\n[output truncated]";

pub mod roles;
pub mod sandbox;
pub mod semantic_patch;

pub use roles::{CapabilityPolicy, WorkerRole};
pub use sandbox::{NetworkPolicy, SandboxConfig, SandboxEnforcer};
pub use semantic_patch::{PatchIntent, PatchOperation, SemanticPatchEngine};

pub struct Runtime {
    working_dir: PathBuf,
    executed_actions: Arc<Mutex<HashMap<String, CachedAction>>>,
    execution_lock: Arc<Mutex<()>>,
    command_output_limit: usize,
    mcp_bridges: Arc<Mutex<HashMap<String, Arc<rivet_mcp::McpCapabilityBridge>>>>,
    rollback_snapshots: Arc<Mutex<HashMap<PathBuf, Option<String>>>>,
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
            command_output_limit: DEFAULT_MAX_COMMAND_OUTPUT_BYTES,
            mcp_bridges: Arc::new(Mutex::new(HashMap::new())),
            rollback_snapshots: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn working_dir(&self) -> &Path {
        &self.working_dir
    }

    pub fn with_command_output_limit(mut self, limit: usize) -> Self {
        self.command_output_limit = limit.max(1);
        self
    }

    pub async fn register_mcp_bridge(
        &self,
        server_name: impl Into<String>,
        bridge: Arc<rivet_mcp::McpCapabilityBridge>,
    ) {
        self.mcp_bridges
            .lock()
            .await
            .insert(server_name.into(), bridge);
    }

    pub async fn record_snapshot_for(&self, path: &Path) {
        let mut snapshots = self.rollback_snapshots.lock().await;
        if snapshots.contains_key(path) {
            return;
        }
        if path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(path).await {
                snapshots.insert(path.to_path_buf(), Some(content));
            }
        } else {
            snapshots.insert(path.to_path_buf(), None);
        }
    }

    pub async fn rollback_all(&self) -> RivetResult<Vec<String>> {
        let mut snapshots = self.rollback_snapshots.lock().await;
        let mut restored = Vec::new();
        for (path, original) in snapshots.drain() {
            match original {
                Some(content) => {
                    if let Some(parent) = path.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    if tokio::fs::write(&path, content).await.is_ok() {
                        restored.push(format!("restored: {}", path.display()));
                    }
                }
                None => {
                    if path.exists() && tokio::fs::remove_file(&path).await.is_ok() {
                        restored.push(format!("deleted new file: {}", path.display()));
                    }
                }
            }
        }
        Ok(restored)
    }

    /// Execute a command in the environment with a bounded wall-clock time.
    pub async fn execute_command(
        &self,
        cmd: &str,
        args: &[&str],
        timeout_seconds: u64,
    ) -> RivetResult<(i32, String, String, u64)> {
        let start = Instant::now();

        let mut command = Command::new(cmd);
        command
            .args(args)
            .current_dir(&self.working_dir)
            .kill_on_drop(true)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child =
            ManagedChild::spawn(command).map_err(|e| RivetError::Runtime(e.to_string()))?;
        let stdout = child
            .child
            .stdout
            .take()
            .ok_or_else(|| RivetError::Runtime("command stdout was not piped".into()))?;
        let stderr = child
            .child
            .stderr
            .take()
            .ok_or_else(|| RivetError::Runtime("command stderr was not piped".into()))?;

        let output =
            match tokio::time::timeout(std::time::Duration::from_secs(timeout_seconds), async {
                let (status, stdout, stderr) = tokio::join!(
                    child.wait(),
                    read_bounded(stdout, self.command_output_limit),
                    read_bounded(stderr, self.command_output_limit),
                );
                (
                    status.map_err(|e| RivetError::Runtime(e.to_string())),
                    stdout,
                    stderr,
                )
            })
            .await
            {
                Ok(output) => output,
                Err(_) => {
                    child.terminate().await;
                    return Err(RivetError::Runtime(format!(
                        "Command '{}' timed out after {}s",
                        cmd, timeout_seconds
                    )));
                }
            };

        let (status, (stdout, stdout_truncated), (stderr, stderr_truncated)) = output;
        let status = status?;

        let duration_ms = start.elapsed().as_millis() as u64;
        let exit_code = status.code().unwrap_or(-1);
        let stdout = bounded_string(&stdout, stdout_truncated, self.command_output_limit);
        let stderr = bounded_string(&stderr, stderr_truncated, self.command_output_limit);

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

        // Check for external MCP capability bridge delegation
        if proposal.capability.starts_with("mcp.") {
            let parts: Vec<&str> = proposal.capability.splitn(3, '.').collect();
            let server_name = if parts.len() >= 2 {
                parts[1]
            } else {
                "default"
            };
            let bridge_opt = self.mcp_bridges.lock().await.get(server_name).cloned();
            if let Some(bridge) = bridge_opt {
                match bridge.execute_mcp_action(proposal).await {
                    Ok((receipt, _obs)) => {
                        self.executed_actions.lock().await.insert(
                            identity,
                            CachedAction {
                                fingerprint,
                                receipt: receipt.clone(),
                            },
                        );
                        return Ok(receipt);
                    }
                    Err(e) => {
                        return self
                            .failed_receipt(proposal, start, format!("MCP execution failed: {e}"))
                            .await;
                    }
                }
            } else {
                return self
                    .failed_receipt(
                        proposal,
                        start,
                        format!("MCP server '{server_name}' is not registered"),
                    )
                    .await;
            }
        }

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
                        let start_line = proposal
                            .parameters
                            .get("start_line")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as usize);
                        let end_line = proposal
                            .parameters
                            .get("end_line")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as usize);

                        let lines: Vec<&str> = content.lines().collect();
                        let total_lines = lines.len();

                        let (observed_text, s_line, e_line, is_sliced) = if let Some(s) = start_line
                        {
                            let s_idx = s.saturating_sub(1).min(total_lines);
                            let e_idx = end_line.unwrap_or(total_lines).min(total_lines);
                            if s_idx < e_idx && s_idx < total_lines {
                                (lines[s_idx..e_idx].join("\n"), s_idx + 1, e_idx, true)
                            } else {
                                (String::new(), s, e_idx, true)
                            }
                        } else if let Some(e) = end_line {
                            let e_idx = e.min(total_lines);
                            (lines[0..e_idx].join("\n"), 1, e_idx, true)
                        } else {
                            (content.clone(), 1, total_lines, false)
                        };

                        let truncated = observed_text.len() > MAX_OBSERVATION_BYTES;
                        let observed = if truncated {
                            let mut end = MAX_OBSERVATION_BYTES;
                            while !observed_text.is_char_boundary(end) {
                                end -= 1;
                            }
                            observed_text[..end].to_string()
                        } else {
                            observed_text
                        };

                        let summary = if is_sliced {
                            format!(
                                "Read lines {}-{} of {} lines in {}{}",
                                s_line,
                                e_line,
                                total_lines,
                                proposal.target,
                                if truncated { " (truncated)" } else { "" }
                            )
                        } else {
                            format!(
                                "Read {} bytes ({} lines) in {}{}",
                                content.len(),
                                total_lines,
                                proposal.target,
                                if truncated { " (truncated)" } else { "" }
                            )
                        };

                        (
                            true,
                            Some(0),
                            summary,
                            serde_json::json!({
                                "kind": "file.read",
                                "target": proposal.target,
                                "content": observed,
                                "start_line": s_line,
                                "end_line": e_line,
                                "total_lines": total_lines,
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
                self.record_snapshot_for(&path).await;
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
            "semantic.patch" => {
                if let Ok(resolved) = self.resolve_target(&proposal.target).await {
                    self.record_snapshot_for(&resolved).await;
                }
                let operation = match proposal
                    .parameters
                    .get("operation")
                    .and_then(|v| v.as_str())
                {
                    Some("insert_before") => PatchOperation::InsertBefore,
                    Some("insert_after") => PatchOperation::InsertAfter,
                    Some("rename_symbol") => PatchOperation::RenameSymbol,
                    Some("delete_symbol") => PatchOperation::DeleteSymbol,
                    _ => PatchOperation::ReplaceBody,
                };
                let proposed_artifact = proposal
                    .parameters
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let new_symbol_name = proposal
                    .parameters
                    .get("new_symbol_name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let intent = PatchIntent {
                    target: proposal.target.clone(),
                    expected_revision: proposal.scope.revision,
                    operation,
                    proposed_artifact,
                    new_symbol_name,
                };

                match SemanticPatchEngine::apply_patch(
                    &self.working_dir,
                    &intent,
                    proposal.scope.revision,
                )
                .await
                {
                    Ok(msg) => (
                        true,
                        Some(0),
                        msg,
                        serde_json::json!({
                            "kind": "semantic.patch",
                            "target": proposal.target,
                            "operation": format!("{:?}", operation),
                        }),
                    ),
                    Err(error) => (
                        false,
                        Some(1),
                        format!("Semantic patch failed: {error}"),
                        serde_json::json!({
                            "kind": "semantic.patch.failed",
                            "target": proposal.target,
                            "error": error.to_string(),
                        }),
                    ),
                }
            }
            "code.search" => {
                let query = proposal
                    .parameters
                    .get("query")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&proposal.target);
                let is_regex = proposal
                    .parameters
                    .get("is_regex")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let path_filter = proposal
                    .parameters
                    .get("path_filter")
                    .and_then(|v| v.as_str());
                let max_results = proposal
                    .parameters
                    .get("max_results")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(50) as usize;

                let (matches, total, truncated) = self
                    .perform_code_search(query, is_regex, path_filter, max_results)
                    .await;
                (
                    true,
                    Some(0),
                    format!(
                        "Found {} matches for '{}'{}",
                        total,
                        query,
                        if truncated { " (truncated)" } else { "" }
                    ),
                    serde_json::json!({
                        "kind": "code.search",
                        "query": query,
                        "matches": matches,
                        "total_matches": total,
                        "truncated": truncated,
                    }),
                )
            }
            "dir.list" => {
                let target = proposal.target.trim();
                let dir_path = if target.is_empty() || target == "." {
                    self.working_dir.clone()
                } else {
                    match self.resolve_target(target).await {
                        Ok(p) => p,
                        Err(e) => {
                            return self.failed_receipt(proposal, start, e.to_string()).await;
                        }
                    }
                };
                let max_entries = proposal
                    .parameters
                    .get("max_entries")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(100) as usize;

                match self.perform_dir_list(&dir_path, max_entries).await {
                    Ok((entries, total, truncated)) => (
                        true,
                        Some(0),
                        format!(
                            "Listed {} entries in '{}'{}",
                            total,
                            proposal.target,
                            if truncated { " (truncated)" } else { "" }
                        ),
                        serde_json::json!({
                            "kind": "dir.list",
                            "target": proposal.target,
                            "entries": entries,
                            "total_entries": total,
                            "truncated": truncated,
                        }),
                    ),
                    Err(e) => (
                        false,
                        Some(1),
                        format!("Directory listing failed: {e}"),
                        serde_json::json!({ "kind": "dir.list.failed", "error": e.to_string() }),
                    ),
                }
            }
            "workspace.rollback" => match self.rollback_all().await {
                Ok(restored) => (
                    true,
                    Some(0),
                    format!("Rollback complete: {} items restored", restored.len()),
                    serde_json::json!({
                        "kind": "workspace.rollback",
                        "restored_items": restored,
                    }),
                ),
                Err(e) => (
                    false,
                    Some(1),
                    format!("Rollback failed: {e}"),
                    serde_json::json!({
                        "kind": "workspace.rollback.failed",
                        "error": e.to_string()
                    }),
                ),
            },
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

    async fn perform_code_search(
        &self,
        query: &str,
        is_regex: bool,
        path_filter: Option<&str>,
        max_results: usize,
    ) -> (Vec<serde_json::Value>, usize, bool) {
        let mut matches = Vec::new();
        let mut total_matches = 0;
        let mut truncated = false;

        let re_pattern = if is_regex {
            regex::Regex::new(query).ok()
        } else {
            None
        };

        let mut stack = vec![self.working_dir.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
                continue;
            };
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().to_string();

                // Skip hidden, build, and vendor directories
                if file_name.starts_with('.')
                    || file_name == "target"
                    || file_name == "node_modules"
                    || file_name == "vendor"
                {
                    continue;
                }

                if let Ok(file_type) = entry.file_type().await {
                    if file_type.is_dir() {
                        stack.push(path);
                    } else if file_type.is_file() {
                        let Ok(rel_path) = path.strip_prefix(&self.working_dir) else {
                            continue;
                        };
                        let rel_str = rel_path.to_string_lossy().replace('\\', "/");

                        if let Some(filter) = path_filter
                            && !rel_str.contains(filter)
                        {
                            continue;
                        }

                        // Read and search file if size is reasonable (< 1 MB)
                        if let Ok(metadata) = entry.metadata().await
                            && metadata.len() > 1024 * 1024
                        {
                            continue;
                        }

                        if let Ok(content) = tokio::fs::read_to_string(&path).await {
                            for (line_idx, line) in content.lines().enumerate() {
                                let is_match = if let Some(ref re) = re_pattern {
                                    re.is_match(line)
                                } else {
                                    line.contains(query)
                                };

                                if is_match {
                                    total_matches += 1;
                                    if matches.len() < max_results {
                                        matches.push(serde_json::json!({
                                            "file": rel_str,
                                            "line": line_idx + 1,
                                            "content": line.trim(),
                                        }));
                                    } else {
                                        truncated = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        (matches, total_matches, truncated)
    }

    async fn perform_dir_list(
        &self,
        dir_path: &Path,
        max_entries: usize,
    ) -> RivetResult<(Vec<serde_json::Value>, usize, bool)> {
        let mut entries = Vec::new();
        let mut read_dir = tokio::fs::read_dir(dir_path).await.map_err(|e| {
            RivetError::Runtime(format!(
                "Cannot read directory '{}': {e}",
                dir_path.display()
            ))
        })?;

        let mut collected = Vec::new();
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.starts_with('.') && file_name != ".gitignore" && file_name != ".rivet" {
                continue;
            }
            let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
            let size = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
            collected.push((file_name, is_dir, size));
        }

        // Sort: directories first, then alphabetical
        collected.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        let total_count = collected.len();
        let mut truncated = false;
        for (name, is_dir, size_bytes) in collected {
            if entries.len() < max_entries {
                entries.push(serde_json::json!({
                    "name": name,
                    "is_dir": is_dir,
                    "size_bytes": size_bytes,
                }));
            } else {
                truncated = true;
            }
        }

        Ok((entries, total_count, truncated))
    }
}

async fn read_bounded<R: AsyncRead + Unpin>(mut reader: R, limit: usize) -> (Vec<u8>, bool) {
    let mut retained = Vec::with_capacity(limit);
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;

    loop {
        let read = match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => break,
        };
        let remaining = limit.saturating_sub(retained.len());
        let retained_now = remaining.min(read);
        retained.extend_from_slice(&buffer[..retained_now]);
        if retained_now < read {
            truncated = true;
        }
    }

    (retained, truncated)
}

fn bounded_string(bytes: &[u8], truncated: bool, limit: usize) -> String {
    let text_limit = if truncated {
        limit.saturating_sub(OUTPUT_TRUNCATION_MARKER.len())
    } else {
        limit
    };
    let mut text = String::from_utf8_lossy(bytes).into_owned();
    if text.len() > text_limit {
        let mut end = text_limit;
        while end > 0 && !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    if truncated {
        let remaining = limit.saturating_sub(text.len());
        let marker_end = OUTPUT_TRUNCATION_MARKER
            .char_indices()
            .map(|(index, _)| index)
            .chain(std::iter::once(OUTPUT_TRUNCATION_MARKER.len()))
            .rfind(|&index| index <= remaining)
            .unwrap_or(0);
        text.push_str(&OUTPUT_TRUNCATION_MARKER[..marker_end]);
    }
    text
}

struct ManagedChild {
    child: Child,
    #[cfg(unix)]
    pid: u32,
    #[cfg(windows)]
    job: windows::Win32::Foundation::HANDLE,
    completed: bool,
}

impl ManagedChild {
    fn spawn(mut command: Command) -> io::Result<Self> {
        #[cfg(unix)]
        {
            unsafe {
                command.pre_exec(|| {
                    if libc::setpgid(0, 0) == -1 {
                        Err(io::Error::last_os_error())
                    } else {
                        Ok(())
                    }
                });
            }
        }

        let child = command.spawn()?;
        #[cfg(unix)]
        let pid = child
            .id()
            .ok_or_else(|| io::Error::other("spawned process has no pid"))?;
        #[cfg(windows)]
        let job = create_job_for_child(&child)?;

        Ok(Self {
            child,
            #[cfg(unix)]
            pid,
            #[cfg(windows)]
            job,
            completed: false,
        })
    }

    async fn wait(&mut self) -> io::Result<std::process::ExitStatus> {
        let result = self.child.wait().await;
        if result.is_ok() {
            self.completed = true;
        }
        result
    }

    async fn terminate(&mut self) {
        #[cfg(unix)]
        unsafe {
            let _ = libc::kill(-(self.pid as i32), 9);
        }
        #[cfg(windows)]
        terminate_job(self.job);
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
        self.completed = true;
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        if !self.completed {
            #[cfg(unix)]
            unsafe {
                let _ = libc::kill(-(self.pid as i32), 9);
            }
            #[cfg(windows)]
            terminate_job(self.job);
        }
        #[cfg(windows)]
        close_job(self.job);
    }
}

#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject,
};

#[cfg(windows)]
fn create_job_for_child(child: &Child) -> io::Result<HANDLE> {
    let job = unsafe { CreateJobObjectW(None, None) }
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    let configured = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };

    if configured.is_err() {
        unsafe {
            let _ = CloseHandle(job);
        }
        return Err(io::Error::last_os_error());
    }

    let Some(raw_handle) = child.raw_handle() else {
        unsafe {
            let _ = CloseHandle(job);
        }
        return Err(io::Error::other("spawned process has no process handle"));
    };

    let assigned = unsafe { AssignProcessToJobObject(job, HANDLE(raw_handle as _)) };
    if assigned.is_err() {
        unsafe {
            let _ = CloseHandle(job);
        }
        return Err(io::Error::last_os_error());
    }

    Ok(job)
}

#[cfg(windows)]
fn terminate_job(job: HANDLE) {
    unsafe {
        let _ = TerminateJobObject(job, 1);
    }
}

#[cfg(windows)]
fn close_job(job: HANDLE) {
    unsafe {
        let _ = CloseHandle(job);
    }
}
