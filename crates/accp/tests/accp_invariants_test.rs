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
        idempotency_key: None,
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

#[test]
fn controller_cannot_emit_authoritative_receipt() {
    let receipt = AccpMessage::ExecutionReceipt(ExecutionReceipt {
        receipt_id: ReceiptId::new(),
        action_id: ActionId::new(),
        idempotency_key: "receipt-key".into(),
        action_fingerprint: "receipt-fingerprint".into(),
        capability: "file.read".into(),
        success: true,
        exit_code: Some(0),
        scope: Scope::global("rivet", Revision::ZERO),
        risk: ActionRisk::Inspect,
        human_approved: false,
        output_summary: "model says it worked".into(),
        observations: serde_json::json!({}),
        evidence_id: EvidenceId::new(),
        execution_duration_ms: 1,
        timestamp: Utc::now(),
    });
    let envelope =
        AccpEnvelope::from_message("message-1", ActorRole::CognitiveController, &receipt).unwrap();
    assert!(envelope.validate_direction().is_err());

    let harness_envelope =
        AccpEnvelope::from_message("message-2", ActorRole::Harness, &receipt).unwrap();
    assert!(harness_envelope.validate_direction().is_ok());
    assert_eq!(harness_envelope.accp_version, ACCP_VERSION);

    let action = ActionProposal {
        action_id: ActionId::new(),
        capability: "file.read".into(),
        target: "src/lib.rs".into(),
        parameters: serde_json::json!({}),
        estimated_risk: ActionRisk::Inspect,
        intent: "metadata test".into(),
        scope: Scope::path("rivet", "src/**", Revision(8)),
        idempotency_key: None,
        timestamp: Utc::now(),
    };
    let action_envelope = AccpEnvelope::from_message(
        "action-metadata",
        ActorRole::CognitiveController,
        &AccpMessage::ActionProposal(action),
    )
    .unwrap();
    assert_eq!(action_envelope.revision, Some(Revision(8)));
    assert_eq!(
        action_envelope.scope.unwrap().path_pattern,
        Some("src/**".into())
    );
}

#[test]
fn claim_and_completion_semantics_are_not_direct_casts() {
    let claim = ClaimProposal {
        claim_id: ClaimId::new(),
        proposition: "all tests pass".into(),
        proposed_status: EpistemicStatus::Verified,
        supporting_evidence: vec![],
        scope: Scope::global("rivet", Revision::ZERO),
        timestamp: Utc::now(),
    };
    assert!(AccpSemanticGate::validate_claim_proposal(&claim).is_err());

    let proposal = CompletionProposal {
        task_id: TaskId::new(),
        summary: "done".into(),
        claims_addressed: vec![],
        base_revision: Revision::ZERO,
        timestamp: Utc::now(),
    };
    let decision = AccpSemanticGate::evaluate_completion(&proposal, Revision::ZERO, vec![], &[]);
    assert!(!decision.completed);
    assert!(decision.final_receipt.is_none());
}

#[test]
fn action_policy_is_scope_revision_and_risk_bound() {
    let action = ActionProposal {
        action_id: ActionId::new(),
        capability: "file.write".into(),
        target: "src/lib.rs".into(),
        parameters: serde_json::json!({ "content": "safe" }),
        estimated_risk: ActionRisk::Material,
        intent: "edit source".into(),
        scope: Scope::path("rivet", "src/**", Revision(4)),
        idempotency_key: Some("edit-1".into()),
        timestamp: Utc::now(),
    };
    let policy = ActionAuthorizationPolicy {
        repository: "rivet".into(),
        current_revision: Revision(4),
        allowed_scope: Scope::path("rivet", "src/**", Revision(4)),
        allowed_capabilities: vec!["file.write".into()],
        allow_material: true,
        human_approved: false,
    };
    let decision = AccpSemanticGate::authorize_action(&action, &policy);
    assert_eq!(decision.verdict, ActionDecisionVerdict::Allow);

    let mut destructive = action.clone();
    destructive.estimated_risk = ActionRisk::Destructive;
    let decision = AccpSemanticGate::authorize_action(&destructive, &policy);
    assert_eq!(
        decision.verdict,
        ActionDecisionVerdict::RequireHumanApproval
    );

    let mut stale = action;
    stale.scope.revision = Revision(3);
    let decision = AccpSemanticGate::authorize_action(&stale, &policy);
    assert_eq!(decision.verdict, ActionDecisionVerdict::Block);

    let mut traversal = ActionProposal {
        action_id: ActionId::new(),
        capability: "file.write".into(),
        target: "../outside.txt".into(),
        parameters: serde_json::json!({ "content": "unsafe" }),
        estimated_risk: ActionRisk::Material,
        intent: "escape test".into(),
        scope: Scope::global("rivet", Revision(4)),
        idempotency_key: None,
        timestamp: Utc::now(),
    };
    traversal.scope = policy.allowed_scope.clone();
    let decision = AccpSemanticGate::authorize_action(&traversal, &policy);
    assert_eq!(decision.verdict, ActionDecisionVerdict::Block);
}

#[test]
fn envelope_rejects_ontology_mismatch_and_non_object_payloads() {
    let mut envelope = AccpEnvelope {
        accp_version: ACCP_VERSION.into(),
        message_id: "message-ontology".into(),
        sender: ActorRole::Harness,
        family: MessageFamily::Receipt,
        kind: "ACTION".into(),
        payload: serde_json::json!({}),
        correlation_id: None,
        scope: None,
        revision: None,
    };
    assert!(envelope.validate_direction().is_err());

    envelope.kind = "EXECUTION".into();
    envelope.payload = serde_json::json!("model prose");
    assert!(envelope.validate_direction().is_err());
}

#[test]
fn family_direction_supports_view_and_query_without_confusing_authority() {
    let view = AccpMessage::View(ViewMessage {
        kind: "COGNITIVE".into(),
        payload: serde_json::json!({ "goal": "inspect" }),
    });
    let view_from_harness =
        AccpEnvelope::from_message("view-1", ActorRole::Harness, &view).unwrap();
    assert!(view_from_harness.validate_direction().is_ok());
    let view_from_controller =
        AccpEnvelope::from_message("view-2", ActorRole::CognitiveController, &view).unwrap();
    assert!(view_from_controller.validate_direction().is_err());

    let query = AccpMessage::Query(QueryMessage {
        kind: "ARTIFACT".into(),
        selector: serde_json::json!({ "path": "src/lib.rs" }),
        purpose: "resolve implementation context".into(),
        scope: Scope::global("rivet", Revision::ZERO),
    });
    let query_from_controller =
        AccpEnvelope::from_message("query-1", ActorRole::CognitiveController, &query).unwrap();
    assert!(query_from_controller.validate_direction().is_ok());
}
