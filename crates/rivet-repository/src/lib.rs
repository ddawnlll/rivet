//! # rivet-repository (Adaptive Project Induction & Census)
//!
//! Fast deterministic repository census, hierarchical relevance tree,
//! and DEFER classification for generated/vendored trees.

use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PathRelevance {
    /// Actively inspected and relevant to current goal
    Active,
    /// Postponed / large tree (e.g. node_modules, target, vendor)
    Deferred(String),
    /// Ignored via .gitignore
    Ignored,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub relative_path: String,
    pub size_bytes: u64,
    pub relevance: PathRelevance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryCensus {
    pub root_path: PathBuf,
    pub total_files: usize,
    pub total_bytes: u64,
    pub entries: Vec<FileEntry>,
    pub deferred_count: usize,
}

pub struct CensusRunner;

impl CensusRunner {
    pub async fn run_census(root: impl AsRef<Path>) -> RivetResult<RepositoryCensus> {
        let root = root.as_ref().to_path_buf();
        let mut entries = Vec::new();
        let mut total_bytes = 0;
        let mut deferred_count = 0;

        let mut stack = vec![root.clone()];

        while let Some(dir) = stack.pop() {
            let mut read_dir = tokio::fs::read_dir(&dir)
                .await
                .map_err(|e| RivetError::Repository(e.to_string()))?;

            while let Ok(Some(entry)) = read_dir.next_entry().await {
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().to_string();

                if file_name.starts_with('.') && file_name != ".gitignore" {
                    continue; // Skip hidden dirs (.git, .venv, etc.)
                }

                if path.is_dir() {
                    if file_name == "node_modules"
                        || file_name == "target"
                        || file_name == "vendor"
                        || file_name == "dist"
                    {
                        deferred_count += 1;
                        let rel = path
                            .strip_prefix(&root)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .to_string();
                        entries.push(FileEntry {
                            relative_path: rel,
                            size_bytes: 0,
                            relevance: PathRelevance::Deferred(file_name),
                        });
                    } else {
                        stack.push(path);
                    }
                } else if path.is_file() {
                    let meta = entry
                        .metadata()
                        .await
                        .map_err(|e| RivetError::Repository(e.to_string()))?;
                    let size = meta.len();
                    total_bytes += size;
                    let rel = path
                        .strip_prefix(&root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();

                    entries.push(FileEntry {
                        relative_path: rel,
                        size_bytes: size,
                        relevance: PathRelevance::Active,
                    });
                }
            }
        }

        Ok(RepositoryCensus {
            root_path: root,
            total_files: entries.len(),
            total_bytes,
            entries,
            deferred_count,
        })
    }
}
