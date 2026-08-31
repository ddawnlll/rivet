use rivet_repository::{
    CapabilityGraph, EdgeKind, EdgeProvenance, GitInspector, NodeKind, ProjectGraph,
};
use rivet_types::EvidenceId;
use tempfile::tempdir;

#[test]
fn test_project_graph_construction_and_queries() {
    let mut graph = ProjectGraph::new();

    // Add nodes
    graph.add_node("file://src/auth.rs", NodeKind::SourceFile, "src/auth.rs");
    graph.add_node(
        "symbol://auth/refresh_token",
        NodeKind::Symbol,
        "refresh_token",
    );
    graph.add_node(
        "symbol://auth/validate_token",
        NodeKind::Symbol,
        "validate_token",
    );
    graph.add_node(
        "file://tests/auth_test.rs",
        NodeKind::TestTarget,
        "tests/auth_test.rs",
    );

    // Add edges with provenance
    let prov = EdgeProvenance {
        provider: "rust-analyzer".into(),
        repo_snapshot: "r12".into(),
        confidence: "authoritative".into(),
        evidence_refs: vec![EvidenceId::new()],
    };

    graph.add_edge(
        "file://src/auth.rs",
        "symbol://auth/refresh_token",
        EdgeKind::Defines,
        prov.clone(),
    );
    graph.add_edge(
        "file://src/auth.rs",
        "symbol://auth/validate_token",
        EdgeKind::Defines,
        prov.clone(),
    );
    graph.add_edge(
        "symbol://auth/refresh_token",
        "symbol://auth/validate_token",
        EdgeKind::Calls,
        prov.clone(),
    );
    graph.add_edge(
        "file://tests/auth_test.rs",
        "symbol://auth/refresh_token",
        EdgeKind::TestedBy,
        prov.clone(),
    );

    // Query symbols in file
    let symbols = graph.symbols_in_file("file://src/auth.rs");
    assert_eq!(symbols.len(), 2);
    assert!(symbols.contains(&"symbol://auth/refresh_token".to_string()));

    // Query callers / dependencies
    let deps = graph.dependencies_of("symbol://auth/refresh_token");
    assert_eq!(deps, vec!["symbol://auth/validate_token".to_string()]);

    let callers = graph.dependents_of("symbol://auth/validate_token");
    assert_eq!(callers, vec!["symbol://auth/refresh_token".to_string()]);

    // Query tests
    let tests = graph.tests_covering("symbol://auth/refresh_token");
    assert_eq!(tests, vec!["file://tests/auth_test.rs".to_string()]);
}

#[test]
fn test_capability_graph_retrieve_and_rank() {
    let graph = CapabilityGraph::new();

    // When workspace is indexed: rust-analyzer should be preferred over ripgrep
    let ranked_indexed = graph.retrieve_and_rank("symbol.references", true);
    assert!(!ranked_indexed.is_empty());
    assert_eq!(ranked_indexed[0].provider_id, "rust-analyzer.references");

    // When workspace is NOT indexed: ripgrep fallback should be selected
    let ranked_unindexed = graph.retrieve_and_rank("symbol.references", false);
    assert!(!ranked_unindexed.is_empty());
    assert_eq!(ranked_unindexed[0].provider_id, "ripgrep.fallback");
}

#[tokio::test]
async fn test_git_inspector_on_non_git_and_temp_repo() {
    let dir = tempdir().unwrap();
    let status = GitInspector::inspect(dir.path()).await.unwrap();
    assert!(!status.is_git_repository);
    assert_eq!(status.tracked_files_count, 0);
}

#[test]
fn test_ast_parser_multi_language() {
    use rivet_repository::{AstParser, SymbolKind};

    // 1. Rust
    let rs_src = r#"
use std::sync::Arc;
pub struct SessionStore;
#[test]
fn test_store_init() {}
pub async fn fetch_session() -> bool { true }
"#;
    let rs_ast = AstParser::parse_source("src/session.rs", rs_src);
    assert_eq!(rs_ast.language, "rust");
    assert_eq!(rs_ast.imports, vec!["std::sync::Arc"]);
    assert_eq!(rs_ast.test_targets, vec!["test_store_init"]);
    assert!(
        rs_ast
            .symbols
            .iter()
            .any(|s| s.name == "SessionStore" && s.kind == SymbolKind::Struct)
    );
    assert!(
        rs_ast
            .symbols
            .iter()
            .any(|s| s.name == "fetch_session" && s.kind == SymbolKind::Function)
    );

    // 2. TypeScript
    let ts_src = r#"
import { Client } from './client';
export interface UserConfig { id: string; }
export class AuthService {}
it("verifies user auth", () => {});
"#;
    let ts_ast = AstParser::parse_source("src/auth.ts", ts_src);
    assert_eq!(ts_ast.language, "typescript");
    assert_eq!(ts_ast.test_targets, vec!["verifies user auth"]);
    assert!(
        ts_ast
            .symbols
            .iter()
            .any(|s| s.name == "UserConfig" && s.kind == SymbolKind::Interface)
    );
    assert!(
        ts_ast
            .symbols
            .iter()
            .any(|s| s.name == "AuthService" && s.kind == SymbolKind::Class)
    );

    // 3. Python
    let py_src = r#"
import os
class DatabaseManager:
    pass

def test_db_connection():
    assert True

def query_user():
    pass
"#;
    let py_ast = AstParser::parse_source("app/db.py", py_src);
    assert_eq!(py_ast.language, "python");
    assert_eq!(py_ast.test_targets, vec!["test_db_connection"]);
    assert!(
        py_ast
            .symbols
            .iter()
            .any(|s| s.name == "DatabaseManager" && s.kind == SymbolKind::Class)
    );

    // 4. Go
    let go_src = r#"
package main
import "fmt"
type ServerConfig struct {}
func TestServerInit(t *testing.T) {}
func StartServer() {}
"#;
    let go_ast = AstParser::parse_source("cmd/server.go", go_src);
    assert_eq!(go_ast.language, "go");
    assert_eq!(go_ast.test_targets, vec!["TestServerInit"]);
    assert!(
        go_ast
            .symbols
            .iter()
            .any(|s| s.name == "ServerConfig" && s.kind == SymbolKind::Struct)
    );

    // 5. Build full ProjectGraph
    let files = vec![
        ("src/session.rs".to_string(), rs_src.to_string()),
        ("src/auth.ts".to_string(), ts_src.to_string()),
        ("app/db.py".to_string(), py_src.to_string()),
        ("cmd/server.go".to_string(), go_src.to_string()),
    ];
    let project_graph = AstParser::build_project_graph(&files, "multi_polyglot_repo");
    assert!(
        project_graph
            .nodes
            .contains_key("repo://multi_polyglot_repo")
    );
    assert!(project_graph.nodes.contains_key("file://src/session.rs"));
    assert!(
        project_graph
            .nodes
            .contains_key("symbol://src/session.rs/SessionStore")
    );
    assert!(
        project_graph
            .nodes
            .contains_key("test://src/session.rs/test_store_init")
    );
}
