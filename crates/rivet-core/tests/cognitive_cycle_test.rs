use accp::{ActionProposal, ActionRisk};
use async_trait::async_trait;
use chrono::Utc;
use noesis::NoesisEvent;
use rivet_core::HarnessCore;
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
    let view = harness.compile_view("Create greeting file").await;
    assert_eq!(view.relevant_files, vec!["src/lib.rs"]);
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
            obligation_id: ObligationId::new(),
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
    let revision = harness.hard_state.lock().await.revision;
    let result = harness
        .run_verification(accp::VerificationRequest {
            obligation_id: ObligationId::new(),
            predicate: "powershell Write-Output unsafe".into(),
            target_scope: Scope::global("rivet", revision),
            timeout_seconds: 5,
            timestamp: Utc::now(),
        })
        .await;
    assert!(matches!(result, Err(RivetError::AuthorityDenied(_))));
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
    let error = if first.is_err() {
        first.unwrap_err()
    } else {
        second.unwrap_err()
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
