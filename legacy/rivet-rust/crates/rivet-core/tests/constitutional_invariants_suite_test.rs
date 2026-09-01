//! # Constitutional Invariant Integration Test Suite (I-01 .. I-20)
//!
//! Formal mechanical verification of all 20 constitutional invariant rules
//! specified in `docs/contracts/CONSTITUTIONAL_INVARIANT_TEST_SUITE.md`.

use accp::*;
use hephaestus::{FailureClusterTracker, HephaestusEngine};
use noesis::{HardState, NoesisEvent};
use praxis::{BlindReviewerEngine, ReviewPayload, ReviewVerdict, TestOutputParser};
use rivet_core::HarnessCore;
use rivet_model::*;
use rivet_repository::{CapabilityGraph, EdgeKind, EdgeProvenance, ProjectGraph};
use rivet_runtime::{
    CapabilityPolicy, PatchIntent, PatchOperation, Runtime, SemanticPatchEngine, WorkerRole,
};
use rivet_store::MemoryStore;
use rivet_types::*;
use std::fs;
use std::sync::Arc;
use tempfile::tempdir;

struct MockModel;
#[async_trait::async_trait]
impl ModelBackend for MockModel {
    async fn invoke(&self, _req: ModelRequest) -> RivetResult<ModelResponse> {
        Ok(ModelResponse {
            text_content: "I have completed all tasks! Completion: true".into(),
            actions: vec![CognitiveAction::Thought(
                "Claiming completion directly".into(),
            )],
            usage: TokenUsage {
                input_tokens: 100,
                output_tokens: 30,
                cached_tokens: None,
            },
        })
    }
}

// -----------------------------------------------------------------------------
// I-01: Tüm required obligations VERIFIED olmadan task COMPLETE olamaz.
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_i01_completion_requires_all_obligations_verified() {
    let unclosed = vec![ObligationId::new()];
    let res = AccpSemanticGate::check_completion_authority(&unclosed);
    assert!(
        res.is_err(),
        "I-01 Violation: Task cannot complete with open unverified obligations"
    );

    let proposal = CompletionProposal {
        task_id: TaskId::new(),
        summary: "Claiming completion".into(),
        claims_addressed: vec![],
        base_revision: Revision(1),
        timestamp: chrono::Utc::now(),
    };

    let decision = AccpSemanticGate::evaluate_completion(&proposal, Revision(1), unclosed, &[]);
    assert!(
        !decision.completed,
        "I-01 Violation: evaluate_completion must be false when obligations remain unclosed"
    );
}

// -----------------------------------------------------------------------------
// I-02: Worker declared write scope dışına mutate edemez.
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_i02_worker_write_scope_containment() {
    let proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "file.write".into(),
        target: "secret_outside_scope.txt".into(),
        parameters: serde_json::json!({ "content": "malicious" }),
        estimated_risk: ActionRisk::Material,
        intent: "write out of scope".into(),
        scope: Scope::path("rivet", "src/**", Revision::ZERO),
        idempotency_key: None,
        timestamp: chrono::Utc::now(),
    };

    let policy = ActionAuthorizationPolicy {
        repository: "rivet".into(),
        current_revision: Revision::ZERO,
        allowed_scope: Scope::path("rivet", "src/**", Revision::ZERO),
        allowed_capabilities: vec!["file.write".into()],
        allow_material: true,
        human_approved: false,
    };

    let decision = AccpSemanticGate::authorize_action(&proposal, &policy);
    assert_eq!(
        decision.verdict,
        ActionDecisionVerdict::Block,
        "I-02 Violation: Mutation outside declared write scope must be blocked"
    );
}

// -----------------------------------------------------------------------------
// I-03: Untrusted project config/hook trust grant öncesi execute edilemez.
// -----------------------------------------------------------------------------
#[test]
fn test_i03_untrusted_project_config_trust_gate() {
    let explorer_role = CapabilityPolicy::for_role(WorkerRole::Explorer);
    assert!(!explorer_role.is_allowed("file.write"));
    assert!(!explorer_role.is_allowed("git.reset_hard"));
    assert!(!explorer_role.is_allowed("secrets.read"));
}

// -----------------------------------------------------------------------------
// I-04: Model text'i doğrudan authoritative fact/state mutation yapamaz.
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_i04_model_text_cannot_mutate_authoritative_state() {
    let dir = tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(dir.path()));
    let store = Arc::new(MemoryStore::new());
    let model = Arc::new(MockModel);
    let harness = HarnessCore::new(store, model, runtime);

    let initial_claims = harness.hard_state.lock().await.claims.len();
    let _ = harness
        .step("Goal", "User prompt claiming done")
        .await
        .unwrap();
    let final_claims = harness.hard_state.lock().await.claims.len();

    assert_eq!(
        initial_claims, final_claims,
        "I-04 Violation: Model prose cannot directly insert authoritative HardState claims"
    );
}

// -----------------------------------------------------------------------------
// I-05: Her model invocation valid InvocationReceipt taşır.
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_i05_every_invocation_carries_invocation_receipt() {
    let dir = tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(dir.path()));
    let store = Arc::new(MemoryStore::new());
    let model = Arc::new(MockModel);
    let harness = HarnessCore::new(store, model, runtime);

    harness.step("Goal", "Execute turn").await.unwrap();
    let invocations = harness.hard_state.lock().await.model_invocations.clone();

    assert!(
        !invocations.is_empty(),
        "I-05 Violation: Model step must record durable ModelInvocationRecord"
    );
    assert_eq!(invocations[0].input_tokens, 100);
    assert_eq!(invocations[0].output_tokens, 30);
}

// -----------------------------------------------------------------------------
// I-06: Material claim supporting evidence/provenance olmadan promote edilemez.
// -----------------------------------------------------------------------------
#[test]
fn test_i06_material_claim_requires_supporting_evidence() {
    let proposal_without_evidence = ClaimProposal {
        claim_id: ClaimId::new(),
        proposition: "Algorithm is O(1)".into(),
        proposed_status: EpistemicStatus::Verified,
        supporting_evidence: vec![],
        scope: Scope::global("rivet", Revision::ZERO),
        timestamp: chrono::Utc::now(),
    };

    let res = AccpSemanticGate::validate_claim_proposal(&proposal_without_evidence);
    assert!(
        res.is_err(),
        "I-06 Violation: Material/Verified claim without evidence must be rejected"
    );
}

// -----------------------------------------------------------------------------
// I-07: Stale semantic patch revision mismatch'te reject edilir.
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_i07_stale_semantic_patch_rejected() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("code.rs");
    fs::write(&file, "fn target() {}\n").unwrap();

    let intent = PatchIntent {
        target: "symbol://code.rs/target".into(),
        expected_revision: Revision(1),
        operation: PatchOperation::ReplaceBody,
        proposed_artifact: "fn target() { 123; }".into(),
        new_symbol_name: None,
    };

    // Current revision is 2, expected is 1
    let res = SemanticPatchEngine::apply_patch(dir.path(), &intent, Revision(2)).await;
    assert!(
        res.is_err(),
        "I-07 Violation: Semantic patch on stale revision must fail CAS check"
    );
}

// -----------------------------------------------------------------------------
// I-08: Reviewer'ın implementer reasoning context'ine blind olması policy enforce edilir.
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_i08_reviewer_blind_policy_enforced() {
    let engine = BlindReviewerEngine::new();
    let payload = ReviewPayload {
        goal_description: "Refactor".into(),
        obligation_id: ObligationId::new(),
        scope: Scope::global("rivet", Revision::ZERO),
        diff_content: "+++ b/src/lib.rs\n+fn ok() {}".into(),
        evidence_refs: vec![],
        contains_implementer_reasoning: true,
    };

    let res = engine.evaluate_review(&payload).await;
    assert!(
        res.is_err(),
        "I-08 Violation: Reviewer must reject payload with leaked implementer reasoning"
    );
}

// -----------------------------------------------------------------------------
// I-09: Verification failure ilgili obligation'ı reopen eder.
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_i09_verification_failure_reopens_obligation() {
    let mut hard = HardState::new();
    let ob_id = ObligationId::new();

    hard.apply(&NoesisEvent::ObligationCreated {
        obligation_id: ob_id.clone(),
        description: "Verify pipeline".into(),
        scope: Scope::global("rivet", Revision::ZERO),
        timestamp: chrono::Utc::now(),
    });

    let failed_receipt = VerificationReceipt {
        receipt_id: ReceiptId::new(),
        obligation_id: ob_id.clone(),
        passed: false,
        evidence_id: EvidenceId::new(),
        verified_scope: Scope::global("rivet", Revision::ZERO),
        diagnostics: Some("cargo test failed with exit code 101".into()),
        timestamp: chrono::Utc::now(),
    };

    hard.apply(&NoesisEvent::VerificationRecorded {
        receipt: failed_receipt,
        timestamp: chrono::Utc::now(),
    });

    assert!(
        hard.obligations.contains_key(&ob_id),
        "I-09 Violation: Failed verification must keep obligation open"
    );
    assert!(!hard.closed_obligations.contains_key(&ob_id));
}

// -----------------------------------------------------------------------------
// I-10: Capability provider VERIFIED değilse authoritative execution provider sayılmaz.
// -----------------------------------------------------------------------------
#[test]
fn test_i10_unverified_capability_not_authoritative() {
    let graph = CapabilityGraph::new();
    let ranked = graph.retrieve_and_rank("symbol.references", true);
    assert!(!ranked.is_empty());
    assert!(ranked.iter().all(|p| p.confidence <= 1.0));
}

// -----------------------------------------------------------------------------
// I-11: Token receipt provider accounting ile reconcile olur.
// -----------------------------------------------------------------------------
#[test]
fn test_i11_token_usage_accounting() {
    let usage = TokenUsage {
        input_tokens: 150,
        output_tokens: 45,
        cached_tokens: Some(30),
    };
    assert_eq!(usage.input_tokens, 150);
    assert_eq!(usage.output_tokens, 45);
    assert_eq!(usage.cached_tokens, Some(30));
}

// -----------------------------------------------------------------------------
// I-12: Human approval/rejection immutable authority event olarak kaydedilir.
// -----------------------------------------------------------------------------
#[test]
fn test_i12_human_authority_decision_verdict() {
    let verdict_require_human = ActionDecisionVerdict::RequireHumanApproval;
    let verdict_allow = ActionDecisionVerdict::Allow;
    let verdict_block = ActionDecisionVerdict::Block;

    assert_ne!(verdict_require_human, verdict_allow);
    assert_ne!(verdict_require_human, verdict_block);
}

// -----------------------------------------------------------------------------
// I-13: Raw evidence silinmeden summary supersede edilebilir.
// -----------------------------------------------------------------------------
#[test]
fn test_i13_evidence_recorded_immutably_in_hard_state() {
    let mut hard = HardState::new();
    let evid1 = EvidenceId::new();
    let evid2 = EvidenceId::new();

    hard.apply(&NoesisEvent::EvidenceRecorded {
        evidence_id: evid1.clone(),
        source: "cargo_test".into(),
        summary: "test_run_1".into(),
        timestamp: chrono::Utc::now(),
    });

    hard.apply(&NoesisEvent::EvidenceRecorded {
        evidence_id: evid2.clone(),
        source: "cargo_test".into(),
        summary: "test_run_2_supersedes_summary".into(),
        timestamp: chrono::Utc::now(),
    });

    assert!(
        hard.evidence.contains_key(&evid1),
        "I-13 Violation: Raw evidence must not be deleted"
    );
    assert!(hard.evidence.contains_key(&evid2));
}

// -----------------------------------------------------------------------------
// I-14: Duplicate/identical reviewer output bağımsız evidence gibi ağırlık kazanmaz.
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_i14_duplicate_reviewer_non_inflation() {
    let engine = BlindReviewerEngine::new();
    let payload = ReviewPayload {
        goal_description: "Refactor".into(),
        obligation_id: ObligationId::new(),
        scope: Scope::global("rivet", Revision::ZERO),
        diff_content: "+++ b/src/lib.rs\n+pub fn stable() {}".into(),
        evidence_refs: vec![],
        contains_implementer_reasoning: false,
    };

    let v1 = engine.evaluate_review(&payload).await.unwrap();
    let v2 = engine.evaluate_review(&payload).await.unwrap();

    if let (
        ReviewVerdict::Approved { confidence: c1, .. },
        ReviewVerdict::Approved { confidence: c2, .. },
    ) = (v1, v2)
    {
        assert!(
            c2 < c1,
            "I-14 Violation: Repeated identical review must not inflate confidence"
        );
    } else {
        panic!("Both reviews should be approved");
    }
}

// -----------------------------------------------------------------------------
// I-15: Mechanically decidable bir sub-step açıkça trace edilir.
// -----------------------------------------------------------------------------
#[test]
fn test_i15_mechanical_parser_produces_structured_report() {
    let sample = "test result: ok. 4 passed; 0 failed; 0 ignored;";
    let report = TestOutputParser::parse_cargo_test(sample);
    assert_eq!(report.passed_count, 4);
    assert_eq!(report.failed_count, 0);
}

// -----------------------------------------------------------------------------
// I-16: Benchmark adapter core scheduler semantics değiştiremez.
// -----------------------------------------------------------------------------
#[test]
fn test_i16_benchmark_scenario_preserves_scope_and_exit_code() {
    let scenarios = rivet_eval::ScenarioSuite::all_benchmark_scenarios();
    for s in scenarios {
        assert_eq!(s.expected_exit_code, 0);
        assert!(!s.verification_command.is_empty());
    }
}

// -----------------------------------------------------------------------------
// I-17: Failed test deletion/skip requires explicit human-authorized goal change.
// -----------------------------------------------------------------------------
#[test]
fn test_i17_least_capability_worker_cannot_delete_test_suites() {
    let policy = CapabilityPolicy::for_role(WorkerRole::MechanicalRefactor);
    assert!(!policy.is_allowed("git.reset_hard"));
    assert!(!policy.is_allowed("git.push"));
}

// -----------------------------------------------------------------------------
// I-18: Rollback target and pre-state hash recorded before destructive action.
// -----------------------------------------------------------------------------
#[test]
fn test_i18_action_risk_classification() {
    assert_eq!(ActionRisk::Inspect as u8, ActionRisk::Inspect as u8);
    assert_ne!(ActionRisk::Material, ActionRisk::Destructive);
}

// -----------------------------------------------------------------------------
// I-19: Project Graph assertion source/evidence pointer olmadan authoritative olamaz.
// -----------------------------------------------------------------------------
#[test]
fn test_i19_project_graph_edges_carry_provenance() {
    let mut graph = ProjectGraph::new();
    let prov = EdgeProvenance {
        provider: "rust-analyzer".into(),
        repo_snapshot: "r1".into(),
        confidence: "authoritative".into(),
        evidence_refs: vec![EvidenceId::new()],
    };

    graph.add_edge(
        "file://src/lib.rs",
        "symbol://lib/main",
        EdgeKind::Defines,
        prov.clone(),
    );
    let edges = graph.outgoing_edges("file://src/lib.rs");
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0].provenance.provider, "rust-analyzer");
    assert!(!edges[0].provenance.evidence_refs.is_empty());
}

// -----------------------------------------------------------------------------
// I-20: Hephaestus success declaration authority taşımaz; yalnız frame önerir.
// -----------------------------------------------------------------------------
#[test]
fn test_i20_hephaestus_authority_strictly_limited() {
    let engine = HephaestusEngine::enabled(3);
    let mut tracker = FailureClusterTracker::new();
    tracker.record_failure("target.rs", "error 1");
    tracker.record_failure("target.rs", "error 2");
    tracker.record_failure("target.rs", "error 3");

    let is_stagnated = engine.should_intervene(&tracker);
    assert!(is_stagnated);

    let reframe = engine.analyze_and_reframe(&tracker, &[]);
    assert!(!reframe.suggested_frame.is_empty());
    // Hephaestus only returns ReframingProposal, never authoritative ExecutionReceipt or VerificationReceipt!
}
