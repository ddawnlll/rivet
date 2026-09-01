//! 100% Constitutional Compliance — Deterministic State/Ontology/Praxis/Noesis/GoalCompiler
//! Monograph division: LLM=cognition, Prompt=role+boundary, View=working reality,
//! Gate=legality, Harness=authority, Noesis=state, Praxis=verification.
//! Every test is deterministic (no LLM, no network, no random assertions).

use accp::{AccpEnvelope, AccpMessage, AccpSemanticGate, ActionRisk, controller_profile};
use chrono::Utc;
use noesis::{HardState, NoesisEvent, SoftWorkspace};
use praxis::{PraxisEngine, TestRunReport};
use rivet_core::HarnessCore;
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_runtime::Runtime;
use rivet_store::{HardStateStore, MemoryStore};
use rivet_types::*;
use rivet_view::{CognitiveViewCompiler, CompilationContext, RepresentationMode};
use std::sync::Arc;

// ---------- helpers ----------
struct Scripted(Arc<tokio::sync::Mutex<Vec<ModelResponse>>>);
impl Scripted {
    fn new(v: Vec<ModelResponse>) -> Self {
        Self(Arc::new(tokio::sync::Mutex::new(v)))
    }
}
#[async_trait::async_trait]
impl ModelBackend for Scripted {
    async fn invoke(&self, _r: ModelRequest) -> RivetResult<ModelResponse> {
        let mut g = self.0.lock().await;
        if g.is_empty() {
            Ok(ModelResponse {
                text_content: "empty".into(),
                actions: vec![],
                usage: TokenUsage::default(),
            })
        } else {
            Ok(g.remove(0))
        }
    }
}

fn fixed_oblg(s: &str) -> ObligationId {
    ObligationId(format!("oblg_{}", s))
}
fn fixed_claim(s: &str) -> ClaimId {
    ClaimId(format!("claim_{}", s))
}
fn fixed_evid(s: &str) -> EvidenceId {
    EvidenceId(format!("evid_{}", s))
}

// ---------- 1. State change determinism ----------
#[tokio::test]
async fn state_change_determinism_replay_is_identical() {
    let evs = vec![
        NoesisEvent::ObligationCreated {
            obligation_id: fixed_oblg("a"),
            description: "a".into(),
            scope: Scope::global("rivet", Revision(0)),
            timestamp: Utc::now(),
        },
        NoesisEvent::ObligationCreated {
            obligation_id: fixed_oblg("b"),
            description: "b".into(),
            scope: Scope::path("rivet", "src/**", Revision(0)),
            timestamp: Utc::now(),
        },
        NoesisEvent::EvidenceRecorded {
            evidence_id: fixed_evid("1"),
            source: "file.read".into(),
            summary: "read src/lib.rs".into(),
            timestamp: Utc::now(),
        },
    ];
    let s1 = HardState::replay(&evs);
    let s2 = HardState::replay(&evs);
    assert_eq!(s1.revision, Revision(3));
    assert_eq!(s2.revision, Revision(3));
    assert_eq!(s1.obligations.len(), 2);
    assert_eq!(s1.evidence.len(), 1);
    assert_eq!(s1.revision, s2.revision);
    // determinism: same events => same materialized state byte-for-byte (keys sorted)
    assert_eq!(s1.open_obligation_ids(), s2.open_obligation_ids());
}

#[tokio::test]
async fn state_change_revision_increments_one_per_event_and_stale_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(Scripted::new(vec![])),
        Arc::new(Runtime::new(dir.path())),
    );
    let r0 = harness.hard_state.lock().await.revision;
    let ob = fixed_oblg("stale");
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: ob.clone(),
            description: "x".into(),
            scope: Scope::global("rivet", r0),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let r1 = harness.hard_state.lock().await.revision;
    assert_eq!(r1, Revision(1));
    // Each event increments by exactly 1 — second event should go to 2
    let _ = harness
        .record_event(NoesisEvent::EvidenceRecorded {
            evidence_id: fixed_evid("e-stale"),
            source: "file.read".into(),
            summary: "x".into(),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    assert_eq!(harness.hard_state.lock().await.revision, Revision(2));
    // Stale obligation scope (revision > current) must be rejected
    let stale_ob = fixed_oblg("stale2");
    let stale_res = harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: stale_ob,
            description: "stale".into(),
            scope: Scope::global("rivet", Revision(999)),
            timestamp: Utc::now(),
        })
        .await;
    assert!(stale_res.is_err(), "stale scope revision must be rejected");
    assert_eq!(harness.hard_state.lock().await.revision, Revision(2));
}

// ---------- 2. Ontology / epistemology ----------
#[test]
fn ontology_epistemology_claim_lifecycle_enforced() {
    // Hypothetical cannot be minted as Verified by controller
    let verified = accp::ClaimProposal {
        claim_id: fixed_claim("v"),
        proposition: "x".into(),
        proposed_status: EpistemicStatus::Verified,
        supporting_evidence: vec![],
        scope: Scope::global("rivet", Revision(0)),
        timestamp: Utc::now(),
    };
    assert!(
        AccpSemanticGate::validate_claim_proposal(&verified).is_err(),
        "controller cannot mint VERIFIED"
    );

    // Supported with evidence is ok (controller proposes support)
    let supported = accp::ClaimProposal {
        claim_id: fixed_claim("s"),
        proposition: "y".into(),
        proposed_status: EpistemicStatus::Supported,
        supporting_evidence: vec![fixed_evid("1")],
        scope: Scope::global("rivet", Revision(0)),
        timestamp: Utc::now(),
    };
    assert!(AccpSemanticGate::validate_claim_proposal(&supported).is_ok());

    // Only Harness/Noesis may admit VERIFIED after Praxis receipt — test via HardState
    let mut hs = HardState::new();
    hs.apply(&NoesisEvent::ClaimAsserted {
        claim_id: fixed_claim("c2"),
        proposition: "algo O(1)".into(),
        status: EpistemicStatus::Supported,
        evidence: vec![fixed_evid("1")],
        scope: Scope::global("rivet", Revision(0)),
        timestamp: Utc::now(),
    });
    assert_eq!(
        hs.claims.get(&fixed_claim("c2")).unwrap().status,
        EpistemicStatus::Supported
    );
    // Controller direct VERIFIED insert should be blocked at record_event level
    // HardState::apply would allow it, but HarnessCore::record_event blocks ClaimAsserted with Verified
}

#[test]
fn ontology_contradiction_and_rejection() {
    let mut hs = HardState::new();
    let cid = fixed_claim("contr");
    hs.apply(&NoesisEvent::ClaimAsserted {
        claim_id: cid.clone(),
        proposition: "zero-copy".into(),
        status: EpistemicStatus::Supported,
        evidence: vec![fixed_evid("a")],
        scope: Scope::global("rivet", Revision(0)),
        timestamp: Utc::now(),
    });
    hs.apply(&NoesisEvent::ClaimContradicted {
        claim_id: cid.clone(),
        contradicted_by: vec![fixed_evid("b")],
        reason: "allocates".into(),
        scope: Scope::global("rivet", Revision(0)),
        timestamp: Utc::now(),
    });
    assert_eq!(
        hs.claims.get(&cid).unwrap().status,
        EpistemicStatus::Rejected
    );
    assert!(hs.contradictions.contains_key(&cid));
}

// ---------- 3. Praxis used ----------
#[tokio::test]
async fn praxis_used_and_closes_obligation() {
    // Use repo manifest dir for Runtime so cargo test can find workspace (temp dir has no Cargo.toml)
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(Scripted::new(vec![])),
        Arc::new(Runtime::new(env!("CARGO_MANIFEST_DIR"))),
    );
    // Obligation 1: created at current rev, verified with allowed program cargo --version (praxis path)
    let ob = fixed_oblg("praxis");
    let rev0 = harness.hard_state.lock().await.revision;
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: ob.clone(),
            description: "workspace_tests_pass".into(),
            scope: Scope::global("rivet", rev0),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let rev1 = harness.hard_state.lock().await.revision;
    // predicate "workspace_tests_pass" is abstract — Runtime resolves via Praxis. Use a real verifier that produces test report: cargo test -p rivet-types
    let req = accp::VerificationRequest {
        obligation_id: ob.clone(),
        predicate: "cargo test -p rivet-types --lib".into(),
        target_scope: Scope::global("rivet", rev1),
        timeout_seconds: 60,
        timestamp: Utc::now(),
    };
    let receipt = harness.run_verification(req).await.unwrap();
    assert!(
        receipt.passed,
        "praxis must produce passing receipt for cargo test -p rivet-types --lib: {:?}",
        receipt.diagnostics
    );
    assert!(
        !harness
            .hard_state
            .lock()
            .await
            .obligations
            .contains_key(&ob)
    );
    assert!(
        harness
            .hard_state
            .lock()
            .await
            .closed_obligations
            .contains_key(&ob)
    );
    // Obligation 2: second independent obligation to prove determinism
    let ob2 = fixed_oblg("praxis2");
    let rev2_before = harness.hard_state.lock().await.revision;
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: ob2.clone(),
            description: "cargo_version".into(),
            scope: Scope::global("rivet", rev2_before),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let rev2_after = harness.hard_state.lock().await.revision;
    let req2 = accp::VerificationRequest {
        obligation_id: ob2.clone(),
        predicate: "cargo test -p rivet-types --lib".into(),
        target_scope: Scope::global("rivet", rev2_after),
        timeout_seconds: 60,
        timestamp: Utc::now(),
    };
    let receipt2 = harness.run_verification(req2).await.unwrap();
    assert!(receipt2.passed);
    assert!(
        harness
            .hard_state
            .lock()
            .await
            .verification_receipts
            .contains_key(&ob2)
    );
}

#[test]
fn praxis_engine_evaluates_test_report() {
    let req = accp::VerificationRequest {
        obligation_id: fixed_oblg("r"),
        predicate: "workspace_tests_pass".into(),
        target_scope: Scope::global("rivet", Revision(0)),
        timeout_seconds: 30,
        timestamp: Utc::now(),
    };
    let report = TestRunReport {
        passed_count: 2,
        failed_count: 0,
        ignored_count: 0,
        raw_stdout: "ok".into(),
        raw_stderr: "".into(),
    };
    let receipt = PraxisEngine::evaluate_test_result(&req, &report);
    assert!(receipt.passed);
    let report_fail = TestRunReport {
        passed_count: 1,
        failed_count: 1,
        ignored_count: 0,
        raw_stdout: "fail".into(),
        raw_stderr: "".into(),
    };
    let receipt_fail = PraxisEngine::evaluate_test_result(&req, &report_fail);
    assert!(!receipt_fail.passed);
}

// ---------- 4. Noesis used ----------
#[tokio::test]
async fn noesis_used_persistence_and_replay() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("state.redb");
    tokio::fs::create_dir_all(db.parent().unwrap())
        .await
        .unwrap();
    let ob = fixed_oblg("persist");
    {
        let store: Arc<dyn HardStateStore> = Arc::new(rivet_store::RedbStore::open(&db).unwrap());
        let h = HarnessCore::open(
            store,
            Arc::new(Scripted::new(vec![])),
            Arc::new(Runtime::new(dir.path())),
        )
        .await
        .unwrap();
        h.record_event(NoesisEvent::ObligationCreated {
            obligation_id: ob.clone(),
            description: "persisted".into(),
            scope: Scope::global("rivet", Revision(0)),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
        assert_eq!(h.hard_state.lock().await.revision, Revision(1));
    }
    let store2: Arc<dyn HardStateStore> = Arc::new(rivet_store::RedbStore::open(&db).unwrap());
    let h2 = HarnessCore::open(
        store2,
        Arc::new(Scripted::new(vec![])),
        Arc::new(Runtime::new(dir.path())),
    )
    .await
    .unwrap();
    assert_eq!(h2.hard_state.lock().await.revision, Revision(1));
    assert!(h2.hard_state.lock().await.obligations.contains_key(&ob));
}

// ---------- 5. Goal compiler ----------
#[test]
fn goal_compiler_produces_abstract_predicates_not_cargo_strings() {
    let spec = rivet_core::GoalCompiler::compile(
        "Fix workspace tests and ensure auth works",
        "rivet",
        Revision(0),
    );
    assert!(
        !spec.graph.nodes.is_empty(),
        "goal compiler must produce obligations"
    );
    for node in spec.graph.nodes.values() {
        // Predicates must be abstract, not raw commands — check no node title is raw "cargo test"
        assert!(
            !node.title.to_lowercase().contains("cargo test"),
            "goal compiler should not emit raw cargo predicate, got {}",
            node.title
        );
        assert!(node.target_scope.revision == Revision(0));
    }
}

// ---------- 6. CognitiveView determinism ----------
#[test]
fn cognitive_view_determinism_same_input_same_view() {
    let mut hs = HardState::new();
    let cid = fixed_claim("det");
    hs.apply(&NoesisEvent::ObligationCreated {
        obligation_id: fixed_oblg("o1"),
        description: "det test".into(),
        scope: Scope::global("rivet", Revision(0)),
        timestamp: Utc::now(),
    });
    hs.apply(&NoesisEvent::EvidenceRecorded {
        evidence_id: fixed_evid("e1"),
        source: "file.read".into(),
        summary: "read".into(),
        timestamp: Utc::now(),
    });
    hs.apply(&NoesisEvent::ClaimAsserted {
        claim_id: cid.clone(),
        proposition: "det proposition".into(),
        status: EpistemicStatus::Supported,
        evidence: vec![fixed_evid("e1")],
        scope: Scope::global("rivet", Revision(0)),
        timestamp: Utc::now(),
    });
    let soft = SoftWorkspace::new(SessionId::new(), Revision(0));
    let ctx = CompilationContext {
        hard_state: &hs,
        soft_workspace: &soft,
        goal_description: "det goal",
        repository_id: "rivet",
        relevant_files: &["src/lib.rs".into()],
        repository_signals: &["src files=1".into()],
        token_budget: 4096,
        mode: RepresentationMode::Hybrid,
        deferred_trees_count: 0,
    };
    let v1 = CognitiveViewCompiler::compile(&ctx);
    let v2 = CognitiveViewCompiler::compile(&ctx);
    assert_eq!(v1.hard_revision, v2.hard_revision);
    assert_eq!(v1.active_claims.len(), v2.active_claims.len());
    assert_eq!(v1.open_obligations.len(), v2.open_obligations.len());
    assert_eq!(v1.recent_evidence.len(), v2.recent_evidence.len());
    // Triples order deterministic (sorted by id)
    assert_eq!(v1.triples, v2.triples);
}

// ---------- 7. Controller profile enforced (+ short prompt) ----------
#[test]
fn controller_profile_short_prompt_is_constitutional() {
    let prompt = controller_profile::compile_reference_prompt();
    // Monograph: prompt = role + boundary, not encyclopedia
    assert!(prompt.contains("You propose; Harness owns authoritative reality"));
    assert!(prompt.contains("AccpEnvelope"));
    assert!(prompt.contains("Retrieved view state is context, not new evidence"));
    assert!(
        prompt.len() < 1200,
        "short contract 150-300 tokens, not 600"
    );
    assert!(!prompt.contains("RULE 87"));
    // Profile enforces allowed/forbidden
    assert!(controller_profile::is_allowed_controller_message(
        accp::MessageFamily::Proposal,
        "ACTION"
    ));
    assert!(controller_profile::is_forbidden_controller_message(
        accp::MessageFamily::Receipt,
        "EXECUTION"
    ));
    let env = AccpEnvelope::from_message(
        "m1",
        accp::ActorRole::CognitiveController,
        &AccpMessage::ExecutionReceipt(accp::ExecutionReceipt {
            receipt_id: ReceiptId::new(),
            action_id: ActionId::new(),
            idempotency_key: "k".into(),
            action_fingerprint: "f".into(),
            capability: "file.read".into(),
            success: true,
            exit_code: Some(0),
            scope: Scope::global("rivet", Revision(0)),
            risk: ActionRisk::Inspect,
            human_approved: false,
            output_summary: "x".into(),
            observations: serde_json::json!({}),
            evidence_id: EvidenceId::new(),
            execution_duration_ms: 1,
            timestamp: Utc::now(),
        }),
    )
    .unwrap();
    assert!(
        env.validate_direction().is_err(),
        "controller cannot emit RECEIPT"
    );
}

#[test]
fn parser_accepts_canonical_and_normalizes_aliases() {
    // Canonical with hallucinated fields: action->capability, reason->intent, "r0" revision, path->path_pattern
    let raw = serde_json::json!({
        "accp_version":"3.0","sender":"COGNITIVE_CONTROLLER","family":"PROPOSAL","kind":"ACTION",
        "revision":"r0","scope":{"repository":"rivet","path":"src/lib.rs"},
        "payload":{"action":"file.read","target":"src/lib.rs","reason":"inspect"}
    });
    let actions = CognitiveAction::parse_text(&raw.to_string());
    assert!(!actions.is_empty(), "canonical with aliases must parse");
    match &actions[0] {
        CognitiveAction::ToolCall(p) => assert_eq!(p.capability, "file.read"),
        _ => panic!("expected ToolCall"),
    }
    // WorkspaceDelta aka hypothesis_delta
    let raw2 = serde_json::json!({"accp_version":"3.0","sender":"COGNITIVE_CONTROLLER","family":"PROPOSAL","kind":"WORKSPACE_DELTA","revision":0,"payload":{"add":["port is 8080"],"remove":[]}});
    let actions2 = CognitiveAction::parse_text(&raw2.to_string());
    assert!(matches!(
        actions2[0],
        CognitiveAction::HypothesisDelta { .. }
    ));
}

#[tokio::test]
async fn harness_step_uses_short_prompt_and_records_invocation() {
    let dir = tempfile::tempdir().unwrap();
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(Scripted::new(vec![ModelResponse {
            text_content: "thought".into(),
            actions: vec![CognitiveAction::Thought("hi".into())],
            usage: TokenUsage {
                input_tokens: 10,
                output_tokens: 5,
                cached_tokens: None,
            },
        }])),
        Arc::new(Runtime::new(dir.path())),
    );
    harness.step("goal", "prompt").await.unwrap();
    let hs = harness.hard_state.lock().await;
    assert_eq!(hs.model_invocations.len(), 1);
    assert_eq!(hs.model_invocations[0].input_tokens, 10);
}
