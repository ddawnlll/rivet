//! # rivet-repository::git
//!
//! Pure repository Git inspection: branch, HEAD hash, dirty status,
//! tracked/untracked ratio, and commit history.

use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitRepositoryStatus {
    pub is_git_repository: bool,
    pub head_commit: Option<String>,
    pub current_branch: Option<String>,
    pub is_dirty: bool,
    pub tracked_files_count: usize,
    pub untracked_files_count: usize,
    pub tracked_ratio: f64,
}

pub struct GitInspector;

impl GitInspector {
    /// Inspect repository Git metadata with fallback mechanisms
    pub async fn inspect(root: impl AsRef<Path>) -> RivetResult<GitRepositoryStatus> {
        let root = root.as_ref();
        let git_dir = root.join(".git");

        if !tokio::fs::try_exists(&git_dir).await.unwrap_or(false) {
            return Ok(GitRepositoryStatus {
                is_git_repository: false,
                head_commit: None,
                current_branch: None,
                is_dirty: false,
                tracked_files_count: 0,
                untracked_files_count: 0,
                tracked_ratio: 1.0,
            });
        }

        // Try reading .git/HEAD
        let mut head_commit = None;
        let mut branch = None;

        let head_file = git_dir.join("HEAD");
        if let Ok(head_content) = tokio::fs::read_to_string(&head_file).await {
            let trimmed = head_content.trim();
            if let Some(ref_path) = trimmed.strip_prefix("ref: ") {
                let branch_name = ref_path.rsplit('/').next().unwrap_or(ref_path).to_string();
                branch = Some(branch_name);

                let ref_file = git_dir.join(ref_path);
                if let Ok(commit_hash) = tokio::fs::read_to_string(&ref_file).await {
                    head_commit = Some(commit_hash.trim().to_string());
                }
            } else if trimmed.len() >= 40 {
                head_commit = Some(trimmed.to_string());
            }
        }

        // Run git status via process if available for dirty/untracked ratio
        let mut is_dirty = false;
        let mut tracked_count = 0;
        let mut untracked_count = 0;

        let status_output = tokio::process::Command::new("git")
            .arg("status")
            .arg("--porcelain")
            .current_dir(root)
            .output()
            .await;

        if let Ok(output) = status_output
            && output.status.success()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let line = line.trim();
                if line.starts_with("??") {
                    untracked_count += 1;
                } else if !line.is_empty() {
                    is_dirty = true;
                    tracked_count += 1;
                }
            }
        }

        // Get total tracked files
        let ls_output = tokio::process::Command::new("git")
            .arg("ls-files")
            .current_dir(root)
            .output()
            .await;

        if let Ok(output) = ls_output
            && output.status.success()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            let total_tracked = text.lines().filter(|l| !l.trim().is_empty()).count();
            if total_tracked > 0 {
                tracked_count = total_tracked;
            }
        }

        let total = tracked_count + untracked_count;
        let tracked_ratio = if total > 0 {
            tracked_count as f64 / total as f64
        } else {
            1.0
        };

        Ok(GitRepositoryStatus {
            is_git_repository: true,
            head_commit,
            current_branch: branch,
            is_dirty,
            tracked_files_count: tracked_count,
            untracked_files_count: untracked_count,
            tracked_ratio,
        })
    }
}
