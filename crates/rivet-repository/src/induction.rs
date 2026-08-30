//! # rivet-repository::induction
//!
//! Adaptive Repository Induction Engine
//! Converts static repository observations into an active, goal-conditioned
//! RepoFrontier with DESCEND / MAYBE / DEFER cognitive boundaries.

use crate::{PathRelevance, RepositoryCensus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Cognitive focus classification for progressive disclosure
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FrontierDecision {
    /// Read file content, parse symbols, include in active CognitiveView context
    Descend,
    /// Keep shallow summary only (path + size + top-level signature)
    Maybe,
    /// Do not read into context unless explicitly requested by model
    Defer,
    /// Exclude completely (gitignore / symlink sandbox breach)
    Ignored,
}

/// Active progressive disclosure tree node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontierNode {
    pub relative_path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub decision: FrontierDecision,
    pub symbols: Vec<String>,
    pub rationale: String,
}

/// Bounded cognitive frontier passed to CognitiveViewCompiler
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RepoFrontier {
    pub nodes: HashMap<String, FrontierNode>,
    pub total_active_bytes: u64,
    pub token_estimate: u32,
}

impl RepoFrontier {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_node(&mut self, node: FrontierNode) {
        if node.decision == FrontierDecision::Descend {
            self.total_active_bytes += node.size_bytes;
            self.token_estimate += (node.size_bytes / 4).max(1) as u32;
        }
        self.nodes.insert(node.relative_path.clone(), node);
    }

    pub fn descended_paths(&self) -> Vec<String> {
        self.nodes
            .values()
            .filter(|n| n.decision == FrontierDecision::Descend)
            .map(|n| n.relative_path.clone())
            .collect()
    }

    pub fn maybe_paths(&self) -> Vec<String> {
        self.nodes
            .values()
            .filter(|n| n.decision == FrontierDecision::Maybe)
            .map(|n| n.relative_path.clone())
            .collect()
    }

    pub fn deferred_paths(&self) -> Vec<String> {
        self.nodes
            .values()
            .filter(|n| n.decision == FrontierDecision::Defer)
            .map(|n| n.relative_path.clone())
            .collect()
    }
}

pub struct InductionEngine;

impl InductionEngine {
    /// Induce an adaptive RepoFrontier conditioned on the goal and active focus
    pub fn induce_frontier(
        census: &RepositoryCensus,
        goal_prompt: &str,
        active_focus: &[String],
        max_descend_tokens: u32,
    ) -> RepoFrontier {
        let mut frontier = RepoFrontier::new();
        let prompt_lower = goal_prompt.to_lowercase();
        let mut current_tokens = 0;

        for entry in &census.entries {
            let path_lower = entry.relative_path.to_lowercase();
            let is_in_focus = active_focus.iter().any(|f| {
                entry.relative_path.starts_with(f) || path_lower.contains(&f.to_lowercase())
            });
            let is_mentioned = prompt_lower.contains(&path_lower)
                || prompt_lower
                    .split_whitespace()
                    .any(|w| path_lower.contains(w) && w.len() > 3);

            let (decision, rationale) = match entry.relevance {
                PathRelevance::Ignored => (FrontierDecision::Ignored, "Matched .gitignore".into()),
                PathRelevance::Deferred(ref reason) => (
                    FrontierDecision::Defer,
                    format!("High volume tree: {}", reason),
                ),
                PathRelevance::Active => {
                    if is_in_focus || is_mentioned {
                        let token_est = (entry.size_bytes / 4).max(1) as u32;
                        if current_tokens + token_est <= max_descend_tokens {
                            current_tokens += token_est;
                            (
                                FrontierDecision::Descend,
                                "Directly relevant to current goal".into(),
                            )
                        } else {
                            (
                                FrontierDecision::Maybe,
                                "Relevant but exceeds descend token budget".into(),
                            )
                        }
                    } else if is_entrypoint_file(&entry.relative_path) {
                        (
                            FrontierDecision::Maybe,
                            "Root project entrypoint / metadata".into(),
                        )
                    } else {
                        (FrontierDecision::Defer, "Not in active focus area".into())
                    }
                }
            };

            frontier.add_node(FrontierNode {
                relative_path: entry.relative_path.clone(),
                is_dir: false,
                size_bytes: entry.size_bytes,
                decision,
                symbols: Vec::new(),
                rationale,
            });
        }

        frontier
    }
}

fn is_entrypoint_file(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    matches!(
        name.as_str(),
        "cargo.toml"
            | "package.json"
            | "pyproject.toml"
            | "readme.md"
            | "src/lib.rs"
            | "src/main.rs"
            | "index.ts"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FileEntry;

    #[test]
    fn test_adaptive_induction() {
        let census = RepositoryCensus {
            root_path: std::path::PathBuf::from("/test"),
            total_files: 3,
            total_bytes: 1024,
            entries: vec![
                FileEntry {
                    relative_path: "src/auth.rs".into(),
                    size_bytes: 200,
                    relevance: PathRelevance::Active,
                },
                FileEntry {
                    relative_path: "src/billing.rs".into(),
                    size_bytes: 800,
                    relevance: PathRelevance::Active,
                },
                FileEntry {
                    relative_path: "target/debug/lib.rlib".into(),
                    size_bytes: 5000,
                    relevance: PathRelevance::Deferred("target".into()),
                },
            ],
            deferred_count: 1,
            directories: vec![],
        };

        let frontier = InductionEngine::induce_frontier(
            &census,
            "Fix auth bug in auth.rs",
            &["src/auth.rs".into()],
            4096,
        );

        assert_eq!(frontier.descended_paths(), vec!["src/auth.rs"]);
        assert!(
            frontier
                .deferred_paths()
                .contains(&"src/billing.rs".to_string())
        );
        assert!(
            frontier
                .deferred_paths()
                .contains(&"target/debug/lib.rlib".to_string())
        );
    }
}
