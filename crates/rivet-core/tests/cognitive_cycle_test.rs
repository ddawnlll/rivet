use accp::{ActionProposal, ActionRisk};
use async_trait::async_trait;
use chrono::Utc;
use noesis::NoesisEvent;
use praxis::{
    AcceptanceCriterion, CriterionVerification, ExactAllowedCommand, Ledger, LedgerRecord,
    PlanCommands, PlanMetadata, PlanSpec, PlanTask, PlanWorkspace,
};
use rivet_core::{HarnessCore, RunPhase};
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_runtime::Runtime;
use rivet_store::{HardStateStore, MemoryStore, RedbStore};
use rivet_types::*;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Mock ModelBackend for deterministic testing
struct ScriptedModelBackend {
    responses: Arc<Mutex<Vec<ModelResponse>>>,
}

impl ScriptedModelBackend {
    fn new(responses: Vec<ModelResponse>) -> Self {
        Self {
            responses: Arc::new(Mutex::new(responses)),
        }
    }
}

#[async_trait]
impl ModelBackend for ScriptedModelBackend {
    async fn invoke(&self, _request: ModelRequest) -> RivetResult<ModelResponse> {
        let mut list = self.responses.lock().await;
        if list.is_empty() {
            Ok(ModelResponse {
                text_content: "Default response".into(),
                actions: vec![],
                usage: TokenUsage::default(),
            })
        } else {
            Ok(list.remove(0))
        }
    }
}

#[tokio::test]
async fn test_end_to_end_cognitive_cycle() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(tmp_dir.path()));
    let store = Arc::new(MemoryStore::new());

    // Step 1 response: Create file hello.txt + add working hypothesis
    let step1_response = ModelResponse {
        text_content: "I will write hello.txt and form a hypothesis.".into(),
        actions: vec![
            CognitiveAction::ToolCall(ActionProposal {
                action_id: ActionId::new(),
                capability: "file.write".into(),
                target: "hello.txt".into(),
                parameters: serde_json::json!({ "content": "Hello Rivet Epistemic World!" }),
                estimated_risk: ActionRisk::Material,
                intent: "Create greeting file".into(),
                scope: Scope::global("rivet", Revision::ZERO),
                idempotency_key: None,
                timestamp: Utc::now(),
            }),
            CognitiveAction::HypothesisDelta {
                add: vec!["File hello.txt contains greeting".into()],
                remove: vec![],
            },
        ],
        usage: TokenUsage::default(),
    };

    let model = Arc::new(ScriptedModelBackend::new(vec![step1_response]));

    let harness = HarnessCore::new(store.clone(), model, runtime);

    // Initial state check: no open obligations
    let out1 = harness
        .step("Create greeting file", "Please create hello.txt")
        .await
        .unwrap();
    assert!(out1.contains("write hello.txt"));
    assert_eq!(harness.current_phase().await, RunPhase::Idle);

    // Verify file actually written to disk
    let written_content = tokio::fs::read_to_string(tmp_dir.path().join("hello.txt"))
        .await
        .unwrap();
    assert_eq!(written_content, "Hello Rivet Epistemic World!");

    // Verify evidence was recorded in Noesis Hard State
    {
        let hard = harness.hard_state.lock().await;
        assert_eq!(hard.evidence.len(), 1);
    }

    // Verify soft workspace holds the hypothesis
    {
        let soft = harness.soft_workspace.lock().await;
        assert_eq!(soft.hypotheses.len(), 1);
        assert_eq!(soft.hypotheses[0], "File hello.txt contains greeting");
    }
    harness
        .set_relevant_files(vec!["src/lib.rs".into(), "src/lib.rs".into()])
        .await;
    harness
        .set_repository_signals(vec![
            "src files=1 bytes=42 relevance=Active".into(),
            "target files=0 bytes=0 relevance=Deferred(\"target\")".into(),
            "src files=1 bytes=42 relevance=Active".into(),
        ])
        .await;
    let view = harness.compile_view("Create greeting file").await;
    assert_eq!(view.relevant_files, vec!["src/lib.rs"]);
    assert_eq!(view.repository_signals.len(), 2);
    assert!(view.format_prompt_block().contains("target files=0"));
    assert!(
        view.recent_evidence
            .iter()
            .any(|evidence| evidence.contains("Wrote"))
    );
    assert!(
        !view
            .format_prompt_block()
            .contains("Please create hello.txt")
    );

    // A real Praxis run is required before completion. Use a second Harness
    // with the repository runtime so the test exercises Runtime -> Praxis ->
    // Noesis rather than inserting a fake receipt.
    let obligation_id = ObligationId::new();
    let obligation_revision = harness.hard_state.lock().await.revision;
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: obligation_id.clone(),
            description: "the repository verification must pass".into(),
            scope: Scope::global("rivet", obligation_revision),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let verifier = HarnessCore::open(
        store.clone(),
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(env!("CARGO_MANIFEST_DIR"))),
    )
    .await
    .unwrap();
    let verification_revision = verifier.hard_state.lock().await.revision;
    let verification = verifier
        .run_verification(accp::VerificationRequest {
            obligation_id,
            predicate: "cargo test -p praxis --lib".into(),
            target_scope: Scope::global("rivet", verification_revision),
            timeout_seconds: 120,
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    assert!(
        verification.passed,
        "real Praxis verification must pass: {verification:?}"
    );

    let completion_model = Arc::new(ScriptedModelBackend::new(vec![ModelResponse {
        text_content: "Task is ready for completion.".into(),
        actions: vec![CognitiveAction::CompletionRequest {
            summary: "Greeting file was created successfully.".into(),
        }],
        usage: TokenUsage::default(),
    }]));
    let completed_harness = HarnessCore::open(
        store.clone(),
        completion_model,
        Arc::new(Runtime::new(tmp_dir.path())),
    )
    .await
    .unwrap();
    let out2 = completed_harness
        .step("Create greeting file", "Are you done?")
        .await
        .unwrap();
    assert!(out2.contains("Task completed"));
    assert_eq!(completed_harness.current_phase().await, RunPhase::Completed);
}

#[tokio::test]
async fn test_completion_rejected_if_obligation_unclosed() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(tmp_dir.path()));
    let store = Arc::new(MemoryStore::new());

    // Model tries to complete while an obligation is open
    let completion_response = ModelResponse {
        text_content: "I'm declaring this done!".into(),
        actions: vec![CognitiveAction::CompletionRequest {
            summary: "Done without verification".into(),
        }],
        usage: TokenUsage::default(),
    };

    let model = Arc::new(ScriptedModelBackend::new(vec![completion_response]));
    let harness = HarnessCore::new(store.clone(), model, runtime);

    // Create an unclosed obligation in HardState
    let oblg_id = ObligationId::new();
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: oblg_id.clone(),
            description: "Must verify integration tests pass".into(),
            scope: Scope::global("rivet", Revision::ZERO),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();

    // Model attempt to complete MUST FAIL with SemanticViolation
    let res = harness.step("Fix issue", "Finish the task").await;

    assert!(res.is_err());
    let err_msg = res.unwrap_err().to_string();
    assert!(err_msg.contains("obligations remain unverified"));
    assert_eq!(harness.current_phase().await, RunPhase::Failed);

    // Close it only through a real Runtime -> Praxis verification.
    let verifier = HarnessCore::open(
        store.clone(),
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(env!("CARGO_MANIFEST_DIR"))),
    )
    .await
    .unwrap();
    let verification_revision = verifier.hard_state.lock().await.revision;
    let verification = verifier
        .run_verification(accp::VerificationRequest {
            obligation_id: oblg_id.clone(),
            predicate: "cargo test -p praxis --lib".into(),
            target_scope: Scope::global("rivet", verification_revision),
            timeout_seconds: 120,
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    assert!(verification.passed);

    // Now completion model response can succeed
    let model2 = Arc::new(ScriptedModelBackend::new(vec![ModelResponse {
        text_content: "Done now.".into(),
        actions: vec![CognitiveAction::CompletionRequest {
            summary: "Verified done".into(),
        }],
        usage: TokenUsage::default(),
    }]));

    let harness2 = HarnessCore::open(
        store.clone(),
        model2,
        Arc::new(Runtime::new(tmp_dir.path())),
    )
    .await
    .unwrap();
    let res2 = harness2.step("Fix issue", "Finish the task").await;
    assert!(res2.is_ok());
    assert!(res2.unwrap().contains("Task completed"));
}

#[tokio::test]
async fn persisted_harness_reopens_checkpointed_noesis_state() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let db_path = tmp_dir.path().join(".rivet/state.redb");
    tokio::fs::create_dir_all(db_path.parent().unwrap())
        .await
        .unwrap();
    let obligation_id = ObligationId::new();

    {
        let store: Arc<dyn HardStateStore> = Arc::new(RedbStore::open(&db_path).unwrap());
        let harness = HarnessCore::open(
            store,
            Arc::new(ScriptedModelBackend::new(vec![])),
            Arc::new(Runtime::new(tmp_dir.path())),
        )
        .await
        .unwrap();
        let revision = harness
            .record_event(NoesisEvent::ObligationCreated {
                obligation_id: obligation_id.clone(),
                description: "restart must preserve obligations".into(),
                scope: Scope::global("rivet", Revision::ZERO),
                timestamp: Utc::now(),
            })
            .await
            .unwrap();
        assert_eq!(revision, Revision(1));
        assert!(
            harness
                .hard_state
                .lock()
                .await
                .obligations
                .contains_key(&obligation_id)
        );
    }

    let reopened_store: Arc<dyn HardStateStore> = Arc::new(RedbStore::open(&db_path).unwrap());
    let reopened = HarnessCore::open(
        reopened_store,
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(tmp_dir.path())),
    )
    .await
    .unwrap();
    let hard = reopened.hard_state.lock().await;
    assert_eq!(hard.revision, Revision(1));
    assert_eq!(reopened.task_id, hard.active_task_id.clone().unwrap());
    assert_eq!(
        hard.obligations.get(&obligation_id).unwrap(),
        "restart must preserve obligations"
    );
}

#[tokio::test]
async fn verification_cannot_escape_the_exposed_test_runner_capability() {
    let directory = tempfile::tempdir().unwrap();
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(directory.path())),
    );
    let obligation_id = ObligationId::new();
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: obligation_id.clone(),
            description: "capability boundary".into(),
            scope: Scope::global("rivet", Revision::ZERO),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let revision = harness.hard_state.lock().await.revision;
    let result = harness
        .run_verification(accp::VerificationRequest {
            obligation_id,
            predicate: "powershell Write-Output unsafe".into(),
            target_scope: Scope::global("rivet", revision),
            timeout_seconds: 5,
            timestamp: Utc::now(),
        })
        .await;
    assert!(matches!(result, Err(RivetError::AuthorityDenied(_))));
}

#[tokio::test]
async fn verification_cannot_mint_an_unknown_obligation() {
    let directory = tempfile::tempdir().unwrap();
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(directory.path())),
    );
    let revision = harness.hard_state.lock().await.revision;
    let result = harness
        .run_verification(accp::VerificationRequest {
            obligation_id: ObligationId::new(),
            predicate: "cargo --version".into(),
            target_scope: Scope::global("rivet", revision),
            timeout_seconds: 30,
            timestamp: Utc::now(),
        })
        .await;
    let error = result.expect_err("unknown obligations must be rejected before execution");
    assert!(error.to_string().contains("unknown obligation"));
}

#[tokio::test]
async fn direct_completion_event_requires_closed_obligations() {
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(env!("CARGO_MANIFEST_DIR"))),
    );
    let obligation_id = ObligationId::new();
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: obligation_id.clone(),
            description: "direct completion guard".into(),
            scope: Scope::global("rivet", Revision::ZERO),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let receipt = accp::VerificationReceipt {
        receipt_id: ReceiptId::new(),
        obligation_id: obligation_id.clone(),
        passed: true,
        evidence_id: EvidenceId::new(),
        verified_scope: Scope::global("rivet", Revision(1)),
        diagnostics: None,
        timestamp: Utc::now(),
    };
    harness
        .record_event(NoesisEvent::VerificationRecorded {
            receipt: receipt.clone(),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let rejected = harness
        .record_event(NoesisEvent::CompletionAccepted {
            task_id: harness.task_id.clone(),
            final_receipt: receipt.receipt_id.clone(),
            timestamp: Utc::now(),
        })
        .await;
    assert!(matches!(rejected, Err(RivetError::VerificationFailed(_))));
    assert!(
        harness
            .hard_state
            .lock()
            .await
            .obligations
            .contains_key(&obligation_id)
    );

    harness
        .record_event(NoesisEvent::ObligationClosed {
            obligation_id: obligation_id.clone(),
            receipt_id: receipt.receipt_id.clone(),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    harness
        .record_event(NoesisEvent::CompletionAccepted {
            task_id: harness.task_id.clone(),
            final_receipt: receipt.receipt_id,
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    assert!(
        harness
            .hard_state
            .lock()
            .await
            .completed_tasks
            .contains_key(&harness.task_id)
    );
}

#[tokio::test]
async fn verification_scope_is_bound_to_the_harness_repository() {
    let directory = tempfile::tempdir().unwrap();
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(directory.path())),
    );
    let result = harness
        .run_verification(accp::VerificationRequest {
            obligation_id: ObligationId::new(),
            predicate: "cargo test -p praxis --lib".into(),
            target_scope: Scope::global("other-repository", Revision::ZERO),
            timeout_seconds: 5,
            timestamp: Utc::now(),
        })
        .await;
    assert!(matches!(result, Err(RivetError::SemanticViolation(_))));
}

#[tokio::test]
async fn harness_rejects_unverified_authoritative_state_injection() {
    let directory = tempfile::tempdir().unwrap();
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(directory.path())),
    );
    let claim_result = harness
        .record_event(NoesisEvent::ClaimAsserted {
            claim_id: ClaimId::new(),
            proposition: "model prose is truth".into(),
            status: EpistemicStatus::Verified,
            evidence: vec![],
            scope: Scope::global("rivet", Revision::ZERO),
            timestamp: Utc::now(),
        })
        .await;
    assert!(matches!(
        claim_result,
        Err(RivetError::SemanticViolation(_))
    ));

    let obligation_id = ObligationId::new();
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: obligation_id.clone(),
            description: "must not close without Praxis".into(),
            scope: Scope::global("rivet", Revision::ZERO),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let close_result = harness
        .record_event(NoesisEvent::ObligationClosed {
            obligation_id,
            receipt_id: ReceiptId::new(),
            timestamp: Utc::now(),
        })
        .await;
    assert!(matches!(
        close_result,
        Err(RivetError::VerificationFailed(_))
    ));
}

#[tokio::test]
async fn concurrent_steps_are_serialized_against_revision_staleness() {
    let directory = tempfile::tempdir().unwrap();
    let proposal = ActionProposal {
        action_id: ActionId::new(),
        capability: "file.write".into(),
        target: "serialized.txt".into(),
        parameters: serde_json::json!({ "content": "one turn" }),
        estimated_risk: ActionRisk::Material,
        intent: "serialize concurrent turn".into(),
        scope: Scope::global("rivet", Revision::ZERO),
        idempotency_key: None,
        timestamp: Utc::now(),
    };
    let response = ModelResponse {
        text_content: "write once".into(),
        actions: vec![CognitiveAction::ToolCall(proposal.clone())],
        usage: TokenUsage::default(),
    };
    let mut second_proposal = proposal;
    second_proposal.action_id = ActionId::new();
    let second_response = ModelResponse {
        text_content: "write once".into(),
        actions: vec![CognitiveAction::ToolCall(second_proposal)],
        usage: TokenUsage::default(),
    };
    let harness = Arc::new(HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(ScriptedModelBackend::new(vec![response, second_response])),
        Arc::new(Runtime::new(directory.path())),
    ));
    let (first, second) = tokio::join!(
        harness.step("concurrent", "turn one"),
        harness.step("concurrent", "turn two")
    );
    assert!(first.is_ok() ^ second.is_ok());
    let error = match (first, second) {
        (Err(error), _) | (_, Err(error)) => error,
        _ => unreachable!("one concurrent turn must be rejected as stale"),
    };
    assert!(error.to_string().contains("stale"));
}

#[tokio::test]
async fn persisted_action_identity_is_not_reexecuted_after_restart() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let db_path = tmp_dir.path().join("state.redb");
    let action_key = "persisted-write";
    let response = ModelResponse {
        text_content: "write once".into(),
        actions: vec![CognitiveAction::ToolCall(ActionProposal {
            action_id: ActionId::new(),
            capability: "file.write".into(),
            target: "persisted.txt".into(),
            parameters: serde_json::json!({ "content": "first content" }),
            estimated_risk: ActionRisk::Material,
            intent: "persist idempotency".into(),
            scope: Scope::global("rivet", Revision::ZERO),
            idempotency_key: Some(action_key.into()),
            timestamp: Utc::now(),
        })],
        usage: TokenUsage::default(),
    };
    let model = Arc::new(ScriptedModelBackend::new(vec![response.clone(), response]));
    let store: Arc<dyn HardStateStore> = Arc::new(RedbStore::open(&db_path).unwrap());
    let harness = HarnessCore::open(
        store.clone(),
        model.clone(),
        Arc::new(Runtime::new(tmp_dir.path())),
    )
    .await
    .unwrap();
    harness.step("persist action", "write").await.unwrap();
    assert_eq!(
        tokio::fs::read_to_string(tmp_dir.path().join("persisted.txt"))
            .await
            .unwrap(),
        "first content"
    );
    drop(harness);
    drop(store);

    let reopened_store: Arc<dyn HardStateStore> = Arc::new(RedbStore::open(&db_path).unwrap());
    let reopened = HarnessCore::open(
        reopened_store,
        model,
        Arc::new(Runtime::new(tmp_dir.path())),
    )
    .await
    .unwrap();
    reopened
        .step("persist action", "retry write")
        .await
        .unwrap();
    assert_eq!(reopened.hard_state.lock().await.execution_receipts.len(), 1);
    assert_eq!(
        tokio::fs::read_to_string(tmp_dir.path().join("persisted.txt"))
            .await
            .unwrap(),
        "first content"
    );
}

#[tokio::test]
async fn failed_praxis_verification_keeps_obligation_open() {
    let harness = HarnessCore::new(
        Arc::new(MemoryStore::new()),
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(env!("CARGO_MANIFEST_DIR"))),
    );
    let obligation_id = ObligationId::new();
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: obligation_id.clone(),
            description: "a failing verification must not close this".into(),
            scope: Scope::global("rivet", Revision::ZERO),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let revision = harness.hard_state.lock().await.revision;
    let receipt = harness
        .run_verification(accp::VerificationRequest {
            obligation_id: obligation_id.clone(),
            predicate: "cargo test -p package_that_does_not_exist --lib".into(),
            target_scope: Scope::global("rivet", revision),
            timeout_seconds: 30,
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    assert!(!receipt.passed);
    assert!(
        harness
            .hard_state
            .lock()
            .await
            .obligations
            .contains_key(&obligation_id)
    );
}

#[tokio::test]
async fn full_verity_pipeline_is_admitted_as_scoped_harness_verification() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(MemoryStore::new());
    let harness = HarnessCore::new(
        store,
        Arc::new(ScriptedModelBackend::new(vec![])),
        Arc::new(Runtime::new(tmp_dir.path())),
    );
    tokio::fs::create_dir_all(tmp_dir.path().join("src"))
        .await
        .unwrap();
    tokio::fs::write(tmp_dir.path().join("src/lib.rs"), "pub fn stable() {}\n")
        .await
        .unwrap();

    let obligation_id = ObligationId::new();
    harness
        .record_event(NoesisEvent::ObligationCreated {
            obligation_id: obligation_id.clone(),
            description: "the full Verity pipeline must pass".into(),
            scope: Scope::global("rivet", Revision::ZERO),
            timestamp: Utc::now(),
        })
        .await
        .unwrap();
    let revision = harness.hard_state.lock().await.revision;

    let ledger_path = tmp_dir.path().join(".praxis").join("evidence.ledger.jsonl");
    let mut ledger = Ledger::open(&ledger_path, "core-verity-plan").unwrap();
    ledger
        .append(LedgerRecord {
            record_id: "core-verity-evidence".into(),
            captured_at: Utc::now().to_rfc3339(),
            payload: serde_json::json!({"type": "command", "commandId": "cargo-version"}),
        })
        .unwrap();

    let plan = PlanSpec {
        metadata: PlanMetadata {
            plan_id: "core-verity-plan".into(),
            title: "Core Verity bridge".into(),
            version: "1.0.0".into(),
        },
        workspace: PlanWorkspace {
            allowed_files: vec!["src/**".into()],
            forbidden_files: vec!["secrets/**".into()],
        },
        commands: PlanCommands {
            exact_allowed_commands: vec![ExactAllowedCommand {
                id: "cargo-version".into(),
                command: "cargo --version".into(),
                cwd: None,
                kind: "test".into(),
                timeout_seconds: Some(30),
                expected_exit_code: Some(0),
                shell_allowed: Some(false),
                no_tests_found_is_failure: Some(false),
                expected_output_patterns: vec!["cargo".into()],
            }],
            hard_denied_commands: vec!["git reset --hard".into()],
        },
        tasks: vec![PlanTask {
            id: "core-task".into(),
            name: "run cargo version".into(),
            description: "Prove the pipeline can execute the declared check".into(),
            dependencies: vec![],
            acceptance_criteria: vec![AcceptanceCriterion {
                id: "cargo-version-pass".into(),
                description: "cargo is available".into(),
                verification: CriterionVerification {
                    r#type: "command".into(),
                    command_ref: Some("cargo-version".into()),
                    deterministic: true,
                    advisory_only: false,
                },
            }],
        }],
    };
    let target_scope = Scope::global("rivet", revision);
    let result = harness
        .run_verity_plan(
            accp::VerificationRequest {
                obligation_id: obligation_id.clone(),
                predicate: "cargo --version".into(),
                target_scope: target_scope.clone(),
                timeout_seconds: 30,
                timestamp: Utc::now(),
            },
            &plan,
            Some(&ledger),
            &[praxis::ChangedFile {
                path: "src/lib.rs".into(),
                status: "modified".into(),
            }],
            None,
            "core-verity-attempt",
        )
        .await
        .unwrap();

    assert_eq!(result.overall_verdict, praxis::GateVerdict::Pass);
    let receipt = result.final_receipt.unwrap();
    assert!(receipt.passed);
    assert_eq!(receipt.obligation_id, obligation_id);
    assert_eq!(receipt.verified_scope, target_scope);
    let hard = harness.hard_state.lock().await;
    assert!(hard.closed_obligations.contains_key(&receipt.obligation_id));
    assert_eq!(hard.verification_receipts.len(), 1);
    assert_eq!(harness.current_phase().await, RunPhase::Idle);
}
