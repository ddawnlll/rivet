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
