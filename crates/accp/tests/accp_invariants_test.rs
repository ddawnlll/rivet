use accp::*;
use chrono::Utc;
use rivet_types::*;

#[test]
fn test_accp_action_decision_policy() {
    let inspect_action = ActionProposal {
        action_id: ActionId::new(),
        capability: "file.read".into(),
        target: "src/lib.rs".into(),
        parameters: serde_json::json!({}),
        estimated_risk: ActionRisk::Inspect,
        intent: "Read module source".into(),
        scope: Scope::path("rivet", "src/**", Revision::ZERO),
        timestamp: Utc::now(),
    };

    let allowed_decision = ActionDecision {
        action_id: inspect_action.action_id.clone(),
        verdict: ActionDecisionVerdict::Allow,
        reason: "Read allowed within scope".into(),
        authorized_scope: inspect_action.scope.clone(),
        timestamp: Utc::now(),
    };

    assert!(AccpSemanticGate::ensure_execution_authorized(&allowed_decision).is_ok());

    let blocked_decision = ActionDecision {
        action_id: inspect_action.action_id.clone(),
        verdict: ActionDecisionVerdict::Block,
        reason: "Path outside declared scope".into(),
        authorized_scope: Scope::path("rivet", "docs/**", Revision::ZERO),
        timestamp: Utc::now(),
    };

    assert!(AccpSemanticGate::ensure_execution_authorized(&blocked_decision).is_err());
}

#[test]
fn test_accp_completion_gate_requires_zero_unclosed_obligations() {
    let oblg1 = ObligationId::new();
    let oblg2 = ObligationId::new();

    // 2 open obligations -> reject completion
    let res1 = AccpSemanticGate::check_completion_authority(&[oblg1.clone(), oblg2]);
    assert!(res1.is_err());

    // 1 open obligation -> reject completion
    let res2 = AccpSemanticGate::check_completion_authority(&[oblg1]);
    assert!(res2.is_err());

    // 0 open obligations -> allow completion
    let res3 = AccpSemanticGate::check_completion_authority(&[]);
    assert!(res3.is_ok());
}
