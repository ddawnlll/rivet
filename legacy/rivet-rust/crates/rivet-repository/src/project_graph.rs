//! # rivet-repository::project_graph
//!
//! Structural Project Graph representation: nodes for files, symbols, modules,
//! build/test targets, and edges carrying explicit provenance.

use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Repository,
    Directory,
    SourceFile,
    GeneratedFile,
    Symbol,
    Type,
    Module,
    Package,
    BuildTarget,
    TestTarget,
    Service,
    ExternalDependency,
    Config,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Defines,
    References,
    Calls,
    Imports,
    Inherits,
    Implements,
    Builds,
    LinksTo,
    DependsOn,
    TestedBy,
    Covers,
    Generates,
    ConfiguredBy,
    ServedBy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EdgeProvenance {
    pub provider: String,
    pub repo_snapshot: String,
    pub confidence: String,
    pub evidence_refs: Vec<EvidenceId>,
}

impl Default for EdgeProvenance {
    fn default() -> Self {
        Self {
            provider: "deterministic_census".into(),
            repo_snapshot: "r0".into(),
            confidence: "authoritative_within_provider_scope".into(),
            evidence_refs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectNode {
    pub id: String,
    pub kind: NodeKind,
    pub label: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectEdge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
    pub provenance: EdgeProvenance,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectGraph {
    pub nodes: HashMap<String, ProjectNode>,
    pub edges: Vec<ProjectEdge>,
}

impl ProjectGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_node(&mut self, id: impl Into<String>, kind: NodeKind, label: impl Into<String>) {
        let id_str = id.into();
        let label_str = label.into();
        self.nodes.insert(
            id_str.clone(),
            ProjectNode {
                id: id_str,
                kind,
                label: label_str,
                metadata: serde_json::Value::Null,
            },
        );
    }

    pub fn add_node_with_metadata(
        &mut self,
        id: impl Into<String>,
        kind: NodeKind,
        label: impl Into<String>,
        metadata: serde_json::Value,
    ) {
        let id_str = id.into();
        let label_str = label.into();
        self.nodes.insert(
            id_str.clone(),
            ProjectNode {
                id: id_str,
                kind,
                label: label_str,
                metadata,
            },
        );
    }

    pub fn add_edge(
        &mut self,
        from: impl Into<String>,
        to: impl Into<String>,
        kind: EdgeKind,
        provenance: EdgeProvenance,
    ) {
        self.edges.push(ProjectEdge {
            from: from.into(),
            to: to.into(),
            kind,
            provenance,
        });
    }

    pub fn outgoing_edges(&self, node_id: &str) -> Vec<&ProjectEdge> {
        self.edges.iter().filter(|e| e.from == node_id).collect()
    }

    pub fn incoming_edges(&self, node_id: &str) -> Vec<&ProjectEdge> {
        self.edges.iter().filter(|e| e.to == node_id).collect()
    }

    pub fn dependencies_of(&self, node_id: &str) -> Vec<String> {
        self.edges
            .iter()
            .filter(|e| {
                e.from == node_id
                    && matches!(
                        e.kind,
                        EdgeKind::DependsOn
                            | EdgeKind::Imports
                            | EdgeKind::References
                            | EdgeKind::Calls
                    )
            })
            .map(|e| e.to.clone())
            .collect()
    }

    pub fn dependents_of(&self, node_id: &str) -> Vec<String> {
        self.edges
            .iter()
            .filter(|e| {
                e.to == node_id
                    && matches!(
                        e.kind,
                        EdgeKind::DependsOn
                            | EdgeKind::Imports
                            | EdgeKind::References
                            | EdgeKind::Calls
                    )
            })
            .map(|e| e.from.clone())
            .collect()
    }

    pub fn tests_covering(&self, node_id: &str) -> Vec<String> {
        self.edges
            .iter()
            .filter(|e| {
                (e.to == node_id && matches!(e.kind, EdgeKind::Covers | EdgeKind::TestedBy))
                    || (e.from == node_id && e.kind == EdgeKind::TestedBy)
            })
            .map(|e| {
                if e.to == node_id {
                    e.from.clone()
                } else {
                    e.to.clone()
                }
            })
            .collect()
    }

    pub fn symbols_in_file(&self, file_id: &str) -> Vec<String> {
        self.edges
            .iter()
            .filter(|e| e.from == file_id && e.kind == EdgeKind::Defines)
            .map(|e| e.to.clone())
            .collect()
    }

    /// Reachability closure for impact analysis
    pub fn transitive_dependents(&self, root_id: &str) -> HashSet<String> {
        let mut visited = HashSet::new();
        let mut queue = vec![root_id.to_string()];

        while let Some(current) = queue.pop() {
            for dep in self.dependents_of(&current) {
                if visited.insert(dep.clone()) {
                    queue.push(dep);
                }
            }
        }

        visited
    }
}
