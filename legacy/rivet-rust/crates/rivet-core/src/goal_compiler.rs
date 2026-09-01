//! # rivet-core::goal_compiler
//!
//! Compiles unstructured natural language requests into structured, verifiable
//! GoalSpecs and ObligationGraphs with typed predicates.

use chrono::Utc;
use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Status of an obligation within the graph
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObligationStatus {
    Open,
    Satisfied,
    Violated,
    Waived,
}

/// Verification predicate defining how an obligation must be proven
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum ObligationPredicate {
    /// Must pass a specific command/test suite (e.g. "cargo test -p my_crate")
    CommandPass {
        command: String,
        expected_exit_code: i32,
    },
    /// A file must exist and optionally match content
    FileConstraint {
        path: String,
        must_exist: bool,
        content_pattern: Option<String>,
    },
    /// A set of claims must be verified in Noesis
    ClaimsVerified { claim_propositions: Vec<String> },
    /// Pure manual confirmation (only for human-in-the-loop)
    HumanApproval { prompt: String },
}

/// A single node in the ObligationGraph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObligationNode {
    pub id: ObligationId,
    pub title: String,
    pub description: String,
    pub target_scope: Scope,
    pub predicate: ObligationPredicate,
    pub status: ObligationStatus,
    pub dependencies: Vec<ObligationId>,
    pub receipt_id: Option<ReceiptId>,
    pub created_at: chrono::DateTime<Utc>,
}

/// Complete DAG of obligations required to satisfy a goal
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ObligationGraph {
    pub nodes: HashMap<ObligationId, ObligationNode>,
}

impl ObligationGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_obligation(&mut self, node: ObligationNode) {
        self.nodes.insert(node.id.clone(), node);
    }

    pub fn is_all_satisfied(&self) -> bool {
        self.nodes.values().all(|n| {
            n.status == ObligationStatus::Satisfied || n.status == ObligationStatus::Waived
        })
    }

    pub fn open_obligations(&self) -> Vec<&ObligationNode> {
        self.nodes
            .values()
            .filter(|n| n.status == ObligationStatus::Open)
            .collect()
    }

    pub fn mark_satisfied(&mut self, id: &ObligationId, receipt: ReceiptId) -> bool {
        if let Some(node) = self.nodes.get_mut(id) {
            node.status = ObligationStatus::Satisfied;
            node.receipt_id = Some(receipt);
            true
        } else {
            false
        }
    }
}

/// Compiled goal with requirements and target obligation graph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalSpec {
    pub goal_id: TaskId,
    pub summary: String,
    pub target_scope: Scope,
    pub graph: ObligationGraph,
    pub raw_prompt: String,
}

pub struct GoalCompiler;

impl GoalCompiler {
    /// Compiles a user prompt into a formal GoalSpec and ObligationGraph
    pub fn compile(user_prompt: &str, repo_name: &str, current_revision: Revision) -> GoalSpec {
        let goal_id = TaskId::new();
        let mut graph = ObligationGraph::new();

        let prompt_lower = user_prompt.to_lowercase();

        // 1. Root task obligation
        let root_oblg_id = ObligationId::new();
        let root_scope = Scope::global(repo_name, current_revision);

        let predicate = if prompt_lower.contains("test")
            || prompt_lower.contains("verify")
            || prompt_lower.contains("fix")
        {
            ObligationPredicate::CommandPass {
                command: "cargo test".into(),
                expected_exit_code: 0,
            }
        } else {
            ObligationPredicate::ClaimsVerified {
                claim_propositions: vec![format!("Goal '{}' fulfilled", user_prompt)],
            }
        };

        graph.add_obligation(ObligationNode {
            id: root_oblg_id,
            title: "Fulfill requested goal requirements".into(),
            description: user_prompt.to_string(),
            target_scope: root_scope.clone(),
            predicate,
            status: ObligationStatus::Open,
            dependencies: vec![],
            receipt_id: None,
            created_at: Utc::now(),
        });

        // 2. Detect mentioned files and attach file constraints
        for word in user_prompt.split_whitespace() {
            if (word.contains('.') || word.contains('/')) && !word.starts_with("http") {
                let clean_path = word.trim_matches(|c: char| {
                    !c.is_alphanumeric() && c != '.' && c != '/' && c != '_' && c != '-'
                });
                if clean_path.len() > 3 {
                    let file_oblg_id = ObligationId::new();
                    graph.add_obligation(ObligationNode {
                        id: file_oblg_id,
                        title: format!("Ensure target path '{}' is maintained", clean_path),
                        description: format!("File constraint for {}", clean_path),
                        target_scope: Scope::path(repo_name, clean_path, current_revision),
                        predicate: ObligationPredicate::FileConstraint {
                            path: clean_path.to_string(),
                            must_exist: true,
                            content_pattern: None,
                        },
                        status: ObligationStatus::Open,
                        dependencies: vec![],
                        receipt_id: None,
                        created_at: Utc::now(),
                    });
                }
            }
        }

        GoalSpec {
            goal_id,
            summary: user_prompt.to_string(),
            target_scope: root_scope,
            graph,
            raw_prompt: user_prompt.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_goal_compilation_and_graph() {
        let prompt = "Fix authentication bug in src/auth.rs and verify tests pass";
        let goal = GoalCompiler::compile(prompt, "rivet", Revision::ZERO);

        assert_eq!(goal.summary, prompt);
        assert!(!goal.graph.is_all_satisfied());
        assert!(goal.graph.nodes.len() >= 2);

        let open = goal.graph.open_obligations();
        assert_eq!(open.len(), goal.graph.nodes.len());

        // Satisfy all
        let mut g = goal.graph.clone();
        for id in goal.graph.nodes.keys() {
            g.mark_satisfied(id, ReceiptId::new());
        }
        assert!(g.is_all_satisfied());
    }
}
