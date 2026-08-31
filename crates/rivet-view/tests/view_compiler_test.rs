use noesis::{HardState, NoesisEvent, SoftWorkspace};
use rivet_types::*;
use rivet_view::{CognitiveViewCompiler, CompilationContext, RepresentationMode};

#[test]
fn test_view_compiler_all_4_modes() {
    let mut hard = HardState::new();
    let session_id = SessionId::new();
    let mut soft = SoftWorkspace::new(session_id, hard.revision);

    soft.set_focus(vec!["auth".into(), "security".into()]);
    soft.add_hypothesis("H1: OAuth token expiry mismatch");
    soft.add_unknown("U1: clock sync status");

    let claim_id = ClaimId::new();
    let evid_id = EvidenceId::new();
    let ob_id = ObligationId::new();

    hard.apply(&NoesisEvent::EvidenceRecorded {
        evidence_id: evid_id.clone(),
        source: "cargo_test".into(),
        summary: "test_auth passed".into(),
        timestamp: chrono::Utc::now(),
    });

    hard.apply(&NoesisEvent::ClaimAsserted {
        claim_id: claim_id.clone(),
        proposition: "auth middleware is threadsafe".into(),
        status: EpistemicStatus::Supported,
        evidence: vec![evid_id.clone()],
        scope: Scope::global("rivet", hard.revision),
        timestamp: chrono::Utc::now(),
    });

    hard.apply(&NoesisEvent::ObligationCreated {
        obligation_id: ob_id.clone(),
        description: "verify auth refresh route".into(),
        scope: Scope::path("rivet", "src/auth/**", hard.revision),
        timestamp: chrono::Utc::now(),
    });

    let claim2_id = ClaimId::new();
    hard.apply(&NoesisEvent::ClaimAsserted {
        claim_id: claim2_id.clone(),
        proposition: "refresh token rotates on use".into(),
        status: EpistemicStatus::Supported,
        evidence: vec![evid_id.clone()],
        scope: Scope::global("rivet", hard.revision),
        timestamp: chrono::Utc::now(),
    });

    hard.apply(&NoesisEvent::ClaimContradicted {
        claim_id: claim_id.clone(),
        contradicted_by: vec![evid_id.clone()],
        reason: "regression in 401 response".into(),
        scope: Scope::global("rivet", hard.revision),
        timestamp: chrono::Utc::now(),
    });

    let files = vec!["src/auth/mod.rs".to_string(), "src/main.rs".to_string()];
    let signals = vec!["high_churn".to_string(), "auth_target".to_string()];

    // 1. HYBRID Mode
    let ctx_hybrid = CompilationContext {
        hard_state: &hard,
        soft_workspace: &soft,
        goal_description: "Fix authentication regression",
        repository_id: "rivet",
        relevant_files: &files,
        repository_signals: &signals,
        token_budget: 4000,
        mode: RepresentationMode::Hybrid,
        deferred_trees_count: 3,
    };
    let payload_hybrid = CognitiveViewCompiler::compile(&ctx_hybrid);
    let rendered_hybrid = payload_hybrid.render();
    assert!(rendered_hybrid.contains("cognitive_view:"));
    assert!(rendered_hybrid.contains("Fix authentication regression"));
    assert!(rendered_hybrid.contains("H1: OAuth token expiry mismatch"));
    assert!(rendered_hybrid.contains("contradictions:"));
    assert!(rendered_hybrid.contains("regression in 401 response"));
    assert!(rendered_hybrid.contains("deferred_trees: 3"));

    // 2. RAW_TEXT Mode
    let ctx_raw = CompilationContext {
        mode: RepresentationMode::RawText,
        ..ctx_hybrid
    };
    let payload_raw = CognitiveViewCompiler::compile(&ctx_raw);
    let rendered_raw = payload_raw.render();
    assert!(rendered_raw.contains("=== COGNITIVE STATE (RAW TEXT) ==="));
    assert!(rendered_raw.contains("Goal: Fix authentication regression"));
    assert!(rendered_raw.contains("Contradictions"));

    // 3. TRIPLES Mode
    let ctx_triples = CompilationContext {
        mode: RepresentationMode::Triples,
        ..ctx_hybrid
    };
    let payload_triples = CognitiveViewCompiler::compile(&ctx_triples);
    let rendered_triples = payload_triples.render();
    assert!(rendered_triples.contains("# COGNITIVE VIEW (TRIPLES MODE - KNOWLEDGE GRAPH)"));
    assert!(rendered_triples.contains("requires_obligation"));
    assert!(rendered_triples.contains("epistemic_status"));

    // 4. PATHS Mode
    let ctx_paths = CompilationContext {
        mode: RepresentationMode::Paths,
        ..ctx_hybrid
    };
    let payload_paths = CognitiveViewCompiler::compile(&ctx_paths);
    let rendered_paths = payload_paths.render();
    assert!(rendered_paths.contains("# COGNITIVE VIEW (PATHS MODE - PROVENANCE GRAPH)"));
    assert!(rendered_paths.contains("Goal(Fix authentication regression) -> Obligation("));
}

#[test]
fn test_tiktoken_bpe_token_counter() {
    use rivet_view::TokenCounter;

    let sample_prompt = "Fix database concurrency bug in src/db.rs and ensure cargo test passes";
    let token_count = TokenCounter::count_tokens(sample_prompt);
    assert!(token_count > 5);
    assert!(token_count < 30);

    let empty_count = TokenCounter::count_tokens("");
    assert_eq!(empty_count, 0);
}
