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

    let mut shallow = action.clone();
    shallow.target = "src/private/lib.rs".into();
    shallow.scope = Scope::path("rivet", "src/*", Revision(4));
    let shallow_policy = ActionAuthorizationPolicy {
        allowed_scope: Scope::path("rivet", "src/*", Revision(4)),
        ..policy.clone()
    };
    let decision = AccpSemanticGate::authorize_action(&shallow, &shallow_policy);
    assert_eq!(decision.verdict, ActionDecisionVerdict::Block);

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

#[test]
fn every_wire_carrier_round_trips_with_its_frozen_family_and_kind() {
    let action_id = ActionId::new();
    let claim_id = ClaimId::new();
    let obligation_id = ObligationId::new();
    let task_id = TaskId::new();
    let scope = Scope::path("rivet", "src/**", Revision(7));
    let action = ActionProposal {
        action_id: action_id.clone(),
        capability: "file.read".into(),
        target: "src/lib.rs".into(),
        parameters: serde_json::json!({}),
        estimated_risk: ActionRisk::Inspect,
        intent: "wire fixture".into(),
        scope: scope.clone(),
        idempotency_key: Some("wire-action".into()),
        timestamp: Utc::now(),
    };
    let claim = ClaimProposal {
        claim_id: claim_id.clone(),
        proposition: "wire carriers preserve typed payloads".into(),
        proposed_status: EpistemicStatus::Supported,
        supporting_evidence: vec![EvidenceId::new()],
        scope: scope.clone(),
        timestamp: Utc::now(),
    };
    let verification_request = VerificationRequest {
        obligation_id: obligation_id.clone(),
        predicate: "cargo test".into(),
        target_scope: scope.clone(),
        timeout_seconds: 30,
        timestamp: Utc::now(),
    };
    let messages = vec![
        (
            ActorRole::Harness,
            AccpMessage::View(ViewMessage {
                kind: "COGNITIVE".into(),
                payload: serde_json::json!({"goal": "wire"}),
            }),
        ),
        (
            ActorRole::CognitiveController,
            AccpMessage::Query(QueryMessage {
                kind: "ARTIFACT".into(),
                selector: serde_json::json!({"path": "src/lib.rs"}),
                purpose: "wire fixture".into(),
                scope: scope.clone(),
            }),
        ),
        (
            ActorRole::CognitiveController,
            AccpMessage::ActionProposal(action.clone()),
        ),
        (
            ActorRole::Harness,
            AccpMessage::ActionDecision(ActionDecision {
                action_id: action_id.clone(),
                verdict: ActionDecisionVerdict::Allow,
                reason: "fixture allowed".into(),
                authorized_scope: scope.clone(),
                timestamp: Utc::now(),
            }),
        ),
        (
            ActorRole::Harness,
            AccpMessage::ExecutionReceipt(ExecutionReceipt {
                receipt_id: ReceiptId::new(),
                action_id: action_id.clone(),
                idempotency_key: "wire-action".into(),
                action_fingerprint: "fingerprint".into(),
                capability: "file.read".into(),
                success: true,
                exit_code: Some(0),
                scope: scope.clone(),
                risk: ActionRisk::Inspect,
                human_approved: false,
                output_summary: "read fixture".into(),
                observations: serde_json::json!({"bytes": 1}),
                evidence_id: EvidenceId::new(),
                execution_duration_ms: 1,
                timestamp: Utc::now(),
            }),
        ),
        (
            ActorRole::CognitiveController,
            AccpMessage::ClaimProposal(claim.clone()),
        ),
        (
            ActorRole::CognitiveController,
            AccpMessage::VerificationRequest(verification_request.clone()),
        ),
        (
            ActorRole::Harness,
            AccpMessage::VerificationReceipt(VerificationReceipt {
                receipt_id: ReceiptId::new(),
                obligation_id: obligation_id.clone(),
                passed: true,
                evidence_id: EvidenceId::new(),
                verified_scope: scope.clone(),
                diagnostics: None,
                timestamp: Utc::now(),
            }),
        ),
        (
            ActorRole::CognitiveController,
            AccpMessage::StateTransitionProposal(StateTransitionProposal {
                base_revision: Revision(7),
                claims_to_assert: vec![claim],
                claims_to_reject: vec![],
                obligations_to_create: vec!["wire obligation".into()],
                timestamp: Utc::now(),
            }),
        ),
        (
            ActorRole::CognitiveController,
            AccpMessage::CompletionProposal(CompletionProposal {
                task_id: task_id.clone(),
                summary: "wire completion".into(),
                claims_addressed: vec![claim_id],
                base_revision: Revision(7),
                timestamp: Utc::now(),
            }),
        ),
        (
            ActorRole::Harness,
            AccpMessage::CompletionDecision(CompletionDecision {
                task_id,
                completed: true,
                required_obligations_satisfied: true,
                unclosed_obligations: vec![],
                final_receipt: Some(ReceiptId::new()),
                timestamp: Utc::now(),
            }),
        ),
        (
            ActorRole::Harness,
            AccpMessage::Signal(SignalMessage {
                kind: "REPLAN_REQUIRED".into(),
                subject_ref: Some("task".into()),
                reason: "wire fixture".into(),
                scope: Some(scope),
            }),
        ),
    ];

    for (index, (sender, message)) in messages.iter().enumerate() {
        let envelope =
            AccpEnvelope::from_message(format!("wire-{index}"), *sender, message).unwrap();
        envelope.validate_direction().unwrap();
        let expected_payload = serde_json::to_value(message).unwrap();
        assert_eq!(envelope.payload, expected_payload);

        let encoded = serde_json::to_vec(&envelope).unwrap();
        let decoded: AccpEnvelope = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(decoded.family, envelope.family);
        assert_eq!(decoded.kind, envelope.kind);
        assert_eq!(decoded.payload, envelope.payload);
        assert_eq!(decoded.scope, envelope.scope);
        assert_eq!(decoded.revision, envelope.revision);
        decoded.validate_direction().unwrap();
    }
}
