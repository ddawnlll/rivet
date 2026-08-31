use praxis::{BlindReviewerEngine, ReviewPayload, ReviewVerdict};
use rivet_types::*;

#[tokio::test]
async fn test_reviewer_rejects_implementer_reasoning_leakage_i08() {
    let engine = BlindReviewerEngine::new();

    let leaked_payload = ReviewPayload {
        goal_description: "Refactor auth middleware".into(),
        obligation_id: ObligationId::new(),
        scope: Scope::path("rivet", "src/auth/**", Revision::ZERO),
        diff_content: "+++ b/src/auth/mod.rs\n+pub fn check() {}".into(),
        evidence_refs: vec![],
        contains_implementer_reasoning: true, // Invariant I-08 breach
    };

    let result = engine.evaluate_review(&leaked_payload).await;
    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(err_msg.contains("Invariant I-08"));
}

#[tokio::test]
async fn test_reviewer_detects_scope_breach_and_destructive_ops() {
    let engine = BlindReviewerEngine::new();

    let out_of_scope_payload = ReviewPayload {
        goal_description: "Refactor auth only".into(),
        obligation_id: ObligationId::new(),
        scope: Scope::path("rivet", "src/auth/**", Revision::ZERO),
        diff_content: "+++ b/src/billing/mod.rs\n+pub fn hijack() {}".into(),
        evidence_refs: vec![],
        contains_implementer_reasoning: false,
    };

    let verdict = engine.evaluate_review(&out_of_scope_payload).await.unwrap();
    assert!(matches!(verdict, ReviewVerdict::Rejected { .. }));

    if let ReviewVerdict::Rejected { reasons, .. } = verdict {
        assert!(
            reasons
                .iter()
                .any(|r| r.contains("outside declared write scope"))
        );
    }
}

#[tokio::test]
async fn test_reviewer_approves_valid_patch_and_handles_duplicate_i14() {
    let engine = BlindReviewerEngine::new();
    let obligation_id = ObligationId::new();

    let valid_payload = ReviewPayload {
        goal_description: "Refactor auth middleware".into(),
        obligation_id: obligation_id.clone(),
        scope: Scope::path("rivet", "src/auth/**", Revision::ZERO),
        diff_content: "+++ b/src/auth/mod.rs\n+pub fn check() -> bool { true }".into(),
        evidence_refs: vec![],
        contains_implementer_reasoning: false,
    };

    // First review: full confidence (0.95)
    let verdict1 = engine.evaluate_review(&valid_payload).await.unwrap();
    assert!(verdict1.is_approved());
    if let ReviewVerdict::Approved { confidence, .. } = verdict1 {
        assert!((confidence - 0.95).abs() < 0.01);
    }

    // Duplicate review: I-14 non-inflation (confidence 0.5)
    let verdict2 = engine.evaluate_review(&valid_payload).await.unwrap();
    assert!(verdict2.is_approved());
    if let ReviewVerdict::Approved { confidence, .. } = verdict2 {
        assert!((confidence - 0.5).abs() < 0.01);
    }
}
