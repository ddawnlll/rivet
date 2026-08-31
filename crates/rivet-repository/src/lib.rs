//! # rivet-repository (Adaptive Project Induction & Census)
//!
//! Deterministic repository census, conservative ignore handling, and a
//! bounded active frontier for Cognitive View compilation.

use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub mod ast_parser;
pub mod capability_graph;
pub mod git;
pub mod induction;
pub mod project_graph;

pub use ast_parser::{AstParser, ExtractedFileAst, ExtractedSymbol, SymbolKind};
pub use capability_graph::{CapabilityCost, CapabilityEffect, CapabilityGraph, CapabilityProvider};
pub use git::{GitInspector, GitRepositoryStatus};
pub use induction::{FrontierDecision, FrontierNode, InductionEngine, RepoFrontier};
pub use project_graph::{
    EdgeKind, EdgeProvenance, NodeKind, ProjectEdge, ProjectGraph, ProjectNode,
};

const DEFERRED_DIRS: &[&str] = &["node_modules", "target", "vendor", "dist"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PathRelevance {
    /// Actively inspected and relevant to the current goal.
    Active,
    /// Postponed / large generated or vendored tree.
    Deferred(String),
    /// Ignored via the repository's root .gitignore or an unsafe symlink.
    Ignored,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub relative_path: String,
    pub size_bytes: u64,
    pub relevance: PathRelevance,
}

/// Deterministic directory-level signals supplied to the semantic relevance
/// layer. These are observations, not an assertion that a directory is
/// permanently irrelevant to a future goal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectorySummary {
    pub relative_path: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub relevance: PathRelevance,
    pub signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryCensus {
    pub root_path: PathBuf,
    pub total_files: usize,
    pub total_bytes: u64,
    pub entries: Vec<FileEntry>,
    pub deferred_count: usize,
    #[serde(default)]
    pub directories: Vec<DirectorySummary>,
}

impl RepositoryCensus {
    /// Select a stable, bounded set of active files for the Cognitive View.
    ///
    /// This is deliberately a deterministic signal-based frontier. Semantic
    /// model selection may refine it later, but it must never receive ignored
    /// or deferred paths by accident.
    pub fn active_frontier(&self, max_entries: usize) -> Vec<FileEntry> {
        let mut active: Vec<_> = self
            .entries
            .iter()
            .filter(|entry| matches!(entry.relevance, PathRelevance::Active))
            .cloned()
            .collect();
        active.sort_by(|left, right| {
            frontier_score(&right.relative_path)
                .cmp(&frontier_score(&left.relative_path))
                .then_with(|| left.relative_path.cmp(&right.relative_path))
        });
        active.truncate(max_entries);
        active
    }

    pub fn active_paths(&self, max_entries: usize) -> Vec<String> {
        self.active_frontier(max_entries)
            .into_iter()
            .map(|entry| entry.relative_path)
            .collect()
    }

    /// Select a bounded directory frontier for later semantic induction.
    /// Directory ranking is only a deterministic signal; it does not replace
    /// a model's goal-conditioned DESCEND/MAYBE/DEFER judgment.
    pub fn active_directory_frontier(&self, max_entries: usize) -> Vec<DirectorySummary> {
        let mut active: Vec<_> = self
            .directories
            .iter()
            .filter(|directory| matches!(directory.relevance, PathRelevance::Active))
            .cloned()
            .collect();
        active.sort_by(|left, right| {
            frontier_score(&right.relative_path)
                .cmp(&frontier_score(&left.relative_path))
                .then_with(|| left.relative_path.cmp(&right.relative_path))
        });
        active.truncate(max_entries);
        active
    }
}

pub struct CensusRunner;

impl CensusRunner {
    pub async fn run_census(root: impl AsRef<Path>) -> RivetResult<RepositoryCensus> {
        let root = tokio::fs::canonicalize(root.as_ref())
            .await
            .map_err(|e| RivetError::Repository(e.to_string()))?;
        let metadata = tokio::fs::metadata(&root)
            .await
            .map_err(|e| RivetError::Repository(e.to_string()))?;
        if !metadata.is_dir() {
            return Err(RivetError::Repository(format!(
                "census root is not a directory: {}",
                root.display()
            )));
        }

        let ignore_rules = IgnoreRules::load(&root).await?;
        let mut entries = Vec::new();
        let mut total_files = 0;
        let mut total_bytes = 0;
        let mut deferred_count = 0;
        let mut stack = vec![root.clone()];
        let mut directory_paths: Vec<(String, PathRelevance)> = Vec::new();
        let mut file_records: Vec<(String, u64)> = Vec::new();

        while let Some(dir) = stack.pop() {
            let mut children = Vec::new();
            let mut read_dir = tokio::fs::read_dir(&dir)
                .await
                .map_err(|e| RivetError::Repository(e.to_string()))?;
            while let Some(entry) = read_dir
                .next_entry()
                .await
                .map_err(|e| RivetError::Repository(e.to_string()))?
            {
                children.push(entry);
            }
            children.sort_by_key(|entry| entry.file_name());

            // The stack is LIFO, so reverse insertion preserves lexical DFS.
            for entry in children.into_iter().rev() {
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.starts_with('.')
                    && !matches!(file_name.as_str(), ".gitignore" | ".github")
                {
                    continue;
                }
                let relative_path = relative_path(&root, &path);
                let file_type = entry
                    .file_type()
                    .await
                    .map_err(|e| RivetError::Repository(e.to_string()))?;

                if file_type.is_symlink() {
                    entries.push(FileEntry {
                        relative_path,
                        size_bytes: 0,
                        relevance: PathRelevance::Ignored,
                    });
                    continue;
                }

                if file_type.is_dir() {
                    if let Some(reason) = DEFERRED_DIRS
                        .iter()
                        .find(|name| **name == file_name)
                        .map(|name| (*name).to_string())
                    {
                        deferred_count += 1;
                        directory_paths.push((
                            relative_path.clone(),
                            PathRelevance::Deferred(reason.clone()),
                        ));
                        entries.push(FileEntry {
                            relative_path,
                            size_bytes: 0,
                            relevance: PathRelevance::Deferred(reason),
                        });
                    } else if ignore_rules.matches(&relative_path, true) {
                        directory_paths.push((relative_path.clone(), PathRelevance::Ignored));
                        entries.push(FileEntry {
                            relative_path,
                            size_bytes: 0,
                            relevance: PathRelevance::Ignored,
                        });
                    } else {
                        directory_paths.push((relative_path, PathRelevance::Active));
                        stack.push(path);
                    }
                    continue;
                }

                if file_type.is_file() {
                    let meta = entry
                        .metadata()
                        .await
                        .map_err(|e| RivetError::Repository(e.to_string()))?;
                    let size = meta.len();
                    total_files += 1;
                    total_bytes += size;
                    file_records.push((relative_path.clone(), size));
                    let relevance = if ignore_rules.matches(&relative_path, false) {
                        PathRelevance::Ignored
                    } else {
                        PathRelevance::Active
                    };
                    entries.push(FileEntry {
                        relative_path,
                        size_bytes: size,
                        relevance,
                    });
                }
            }
        }

        entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let mut directories: Vec<_> = directory_paths
            .into_iter()
            .map(|(relative_path, relevance)| {
                let prefix = format!("{relative_path}/");
                let (file_count, total_bytes) = file_records
                    .iter()
                    .filter(|(path, _)| path.starts_with(&prefix))
                    .fold((0, 0), |(count, bytes), (_, size)| {
                        (count + 1, bytes + size)
                    });
                let mut signals = Vec::new();
                if let PathRelevance::Deferred(reason) = &relevance {
                    signals.push("high_volume".into());
                    if matches!(reason.as_str(), "node_modules" | "vendor") {
                        signals.push("dependency_materialization".into());
                    } else if matches!(reason.as_str(), "target" | "dist") {
                        signals.push("generated_artifacts".into());
                    }
                }
                DirectorySummary {
                    relative_path,
                    file_count,
                    total_bytes,
                    relevance,
                    signals,
                }
            })
            .collect();
        directories.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        Ok(RepositoryCensus {
            root_path: root,
            total_files,
            total_bytes,
            entries,
            deferred_count,
            directories,
        })
    }
}

#[derive(Clone)]
struct IgnoreRules {
    gitignore: ignore::gitignore::Gitignore,
}

impl IgnoreRules {
    async fn load(root: &Path) -> RivetResult<Self> {
        let mut builder = ignore::gitignore::GitignoreBuilder::new(root);
        let gitignore_path = root.join(".gitignore");
        if gitignore_path.exists() {
            let _ = builder.add(&gitignore_path);
        }
        let gitignore = builder
            .build()
            .map_err(|error| RivetError::Repository(error.to_string()))?;
        Ok(Self { gitignore })
    }

    fn matches(&self, relative_path: &str, is_dir: bool) -> bool {
        self.gitignore
            .matched_path_or_any_parents(Path::new(relative_path), is_dir)
            .is_ignore()
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    let clean_root = root
        .to_string_lossy()
        .replace(r"\\?\", "")
        .replace('\\', "/");
    let clean_path = path
        .to_string_lossy()
        .replace(r"\\?\", "")
        .replace('\\', "/");
    let root_trimmed = clean_root.trim_end_matches('/');

    if let Some(stripped) = clean_path.strip_prefix(root_trimmed) {
        stripped.trim_start_matches('/').to_string()
    } else {
        path.strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
            .to_string()
    }
}

fn frontier_score(path: &str) -> u8 {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    if matches!(
        name.as_str(),
        "cargo.toml"
            | "cargo.lock"
            | "package.json"
            | "pyproject.toml"
            | "requirements.txt"
            | "go.mod"
            | "readme.md"
            | "implementation.md"
            | "tasks.yaml"
    ) {
        return 100;
    }
    if path.starts_with("src/") || path == "src" {
        return 80;
    }
    if path.starts_with("tests/") || path.contains("/tests/") {
        return 70;
    }
    if path.starts_with("docs/") {
        return 60;
    }
    40
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn census_is_sorted_and_applies_ignore_and_defer_rules() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("src")).unwrap();
        fs::create_dir_all(root.path().join("target/debug")).unwrap();
        fs::write(root.path().join(".gitignore"), "ignored.txt\nsecret*/\n").unwrap();
        fs::write(root.path().join("Cargo.toml"), "[package]\n").unwrap();
        fs::write(root.path().join("src/lib.rs"), "pub fn ok() {}\n").unwrap();
        fs::write(root.path().join("ignored.txt"), "not in frontier\n").unwrap();
        fs::create_dir_all(root.path().join("secret-data")).unwrap();
        fs::write(root.path().join("secret-data/value"), "private\n").unwrap();
        fs::write(root.path().join("target/debug/generated"), "binary\n").unwrap();

        let census = CensusRunner::run_census(root.path()).await.unwrap();
        let paths: Vec<_> = census
            .entries
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect();
        let mut sorted = paths.clone();
        sorted.sort_unstable();
        assert_eq!(paths, sorted);
        assert_eq!(census.total_files, 4);
        assert_eq!(census.deferred_count, 1);
        assert!(matches!(
            census
                .entries
                .iter()
                .find(|entry| entry.relative_path == "ignored.txt")
                .unwrap()
                .relevance,
            PathRelevance::Ignored
        ));
        assert!(matches!(
            census
                .entries
                .iter()
                .find(|entry| entry.relative_path == "target")
                .unwrap()
                .relevance,
            PathRelevance::Deferred(_)
        ));
        assert_eq!(census.active_paths(2), vec!["Cargo.toml", "src/lib.rs"]);
        let src_summary = census
            .directories
            .iter()
            .find(|directory| directory.relative_path == "src")
            .unwrap();
        assert_eq!(src_summary.file_count, 1);
        assert_eq!(src_summary.total_bytes, "pub fn ok() {}\n".len() as u64);
        assert_eq!(census.active_directory_frontier(1)[0].relative_path, "src");
        let target_summary = census
            .directories
            .iter()
            .find(|directory| directory.relative_path == "target")
            .unwrap();
        assert_eq!(target_summary.file_count, 0);
        assert_eq!(
            target_summary.signals,
            vec!["high_volume", "generated_artifacts"]
        );
    }

    #[tokio::test]
    async fn census_does_not_follow_symlinks() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "secret\n").unwrap();
        #[cfg(unix)]
        if std::os::unix::fs::symlink(outside.path(), root.path().join("linked")).is_err() {
            return;
        }
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(outside.path(), root.path().join("linked")).is_err() {
            return;
        }

        let census = CensusRunner::run_census(root.path()).await.unwrap();
        assert!(
            census
                .entries
                .iter()
                .any(|entry| entry.relative_path == "linked"
                    && entry.relevance == PathRelevance::Ignored)
        );
        assert!(
            !census
                .entries
                .iter()
                .any(|entry| entry.relative_path == "linked/secret.txt")
        );
    }
}
