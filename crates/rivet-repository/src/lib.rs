//! # rivet-repository (Adaptive Project Induction & Census)
//!
//! Deterministic repository census, conservative ignore handling, and a
//! bounded active frontier for Cognitive View compilation.

use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryCensus {
    pub root_path: PathBuf,
    pub total_files: usize,
    pub total_bytes: u64,
    pub entries: Vec<FileEntry>,
    pub deferred_count: usize,
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
                if file_name.starts_with('.') && file_name != ".gitignore" {
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
                        entries.push(FileEntry {
                            relative_path,
                            size_bytes: 0,
                            relevance: PathRelevance::Deferred(reason),
                        });
                    } else if ignore_rules.matches(&relative_path, true) {
                        entries.push(FileEntry {
                            relative_path,
                            size_bytes: 0,
                            relevance: PathRelevance::Ignored,
                        });
                    } else {
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
        Ok(RepositoryCensus {
            root_path: root,
            total_files,
            total_bytes,
            entries,
            deferred_count,
        })
    }
}

#[derive(Debug, Clone)]
struct IgnoreRule {
    pattern: String,
    negated: bool,
    directory_only: bool,
    anchored: bool,
}

#[derive(Debug, Default, Clone)]
struct IgnoreRules {
    rules: Vec<IgnoreRule>,
}

impl IgnoreRules {
    async fn load(root: &Path) -> RivetResult<Self> {
        let path = root.join(".gitignore");
        let content = match tokio::fs::read_to_string(path).await {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(error) => return Err(RivetError::Repository(error.to_string())),
        };

        let mut rules = Vec::new();
        for raw_line in content.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let (negated, line) = line
                .strip_prefix('!')
                .map_or((false, line), |rest| (true, rest));
            let directory_only = line.ends_with('/');
            let line = line.trim_end_matches('/');
            if line.is_empty() {
                continue;
            }
            let anchored = line.starts_with('/');
            let pattern = line.trim_start_matches('/').replace('\\', "/");
            rules.push(IgnoreRule {
                pattern,
                negated,
                directory_only,
                anchored,
            });
        }
        Ok(Self { rules })
    }

    fn matches(&self, relative_path: &str, is_dir: bool) -> bool {
        let mut ignored = false;
        for rule in &self.rules {
            if rule.directory_only && !is_dir {
                continue;
            }
            let matches = if rule.anchored || rule.pattern.contains('/') {
                wildcard_matches(&rule.pattern, relative_path)
            } else {
                relative_path
                    .split('/')
                    .any(|component| wildcard_matches(&rule.pattern, component))
            };
            if matches {
                ignored = !rule.negated;
            }
        }
        ignored
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    let pattern = pattern.as_bytes();
    let value = value.as_bytes();
    let mut dp = vec![vec![false; value.len() + 1]; pattern.len() + 1];
    dp[0][0] = true;
    for p in 0..pattern.len() {
        for v in 0..=value.len() {
            if !dp[p][v] {
                continue;
            }
            match pattern[p] {
                b'*' => {
                    dp[p + 1][v] = true;
                    if v < value.len() {
                        dp[p][v + 1] = true;
                    }
                }
                b'?' if v < value.len() => dp[p + 1][v + 1] = true,
                byte if v < value.len() && byte == value[v] => dp[p + 1][v + 1] = true,
                _ => {}
            }
        }
    }
    dp[pattern.len()][value.len()]
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
