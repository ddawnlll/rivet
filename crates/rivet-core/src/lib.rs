//! # rivet-core (Harness Core & Cognitive State Machine)
//!
//! Orchestrates the canonical cycle:
//! Cognitive View -> Model Controller -> ACCP -> Runtime -> Praxis -> Noesis.
//! The core owns lifecycle and admission decisions, while each subsystem keeps
//! ownership of its own semantic state.

use accp::{
    AccpEnvelope, AccpMessage, AccpSemanticGate, ActionAuthorizationPolicy, CompletionProposal,
    VerificationRequest,
};
use noesis::{CognitiveView, HardState, ModelInvocationRecord, NoesisEvent, SoftWorkspace};
use praxis::{
    CargoTestParser, GoTestParser, JestParser, ParsedTestReport, PraxisEngine, PytestParser,
    TestRunReport,
};
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest};
use rivet_runtime::Runtime;
use rivet_store::HardStateStore;
use rivet_types::*;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

/// Explicit phase state machine for a single cognitive cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunPhase {
    Idle,
    PreparingView,
    InvokingModel,
    DecodingActions,
    Authorizing,
    Executing,
    Verifying,
    RevisingState,
    Completed,
    Failed,
}

pub struct HarnessCore {
    pub session_id: SessionId,
    pub task_id: TaskId,
    pub hard_state: Arc<Mutex<HardState>>,
    pub soft_workspace: Arc<Mutex<SoftWorkspace>>,
    pub store: Arc<dyn HardStateStore>,
    pub model: Arc<dyn ModelBackend>,
    pub runtime: Arc<Runtime>,
    repository_id: String,
    relevant_files: Arc<Mutex<Vec<String>>>,
}

impl HarnessCore {
    pub fn new(
        store: Arc<dyn HardStateStore>,
        model: Arc<dyn ModelBackend>,
        runtime: Arc<Runtime>,
    ) -> Self {
        Self::from_state(
            store,
            model,
            runtime,
            SessionId::new(),
            TaskId::new(),
            HardState::new(),
        )
    }

    /// Reopen a persisted Harness session. A checkpoint is only a snapshot;
    /// events after its revision are replayed before the model sees a view.
    pub async fn open(
        store: Arc<dyn HardStateStore>,
        model: Arc<dyn ModelBackend>,
        runtime: Arc<Runtime>,
    ) -> RivetResult<Self> {
        let checkpoint = store.load_checkpoint().await?;
        let mut hard = checkpoint.unwrap_or_default();
        let events = store.read_events(hard.revision).await?;
        for event in &events {
            hard.apply(event);
        }
        Ok(Self::from_state(
            store,
            model,
            runtime,
            SessionId::new(),
            TaskId::new(),
            hard,
        ))
    }

    fn from_state(
        store: Arc<dyn HardStateStore>,
        model: Arc<dyn ModelBackend>,
        runtime: Arc<Runtime>,
        session_id: SessionId,
        task_id: TaskId,
        hard_state: HardState,
    ) -> Self {
        let base_revision = hard_state.revision;
        Self {
            session_id: session_id.clone(),
            task_id,
            hard_state: Arc::new(Mutex::new(hard_state)),
            soft_workspace: Arc::new(Mutex::new(SoftWorkspace::new(session_id, base_revision))),
            store,
            model,
            runtime,
            repository_id: std::env::var("RIVET_REPOSITORY_ID").unwrap_or_else(|_| "rivet".into()),
            relevant_files: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn set_relevant_files(&self, mut files: Vec<String>) {
        files.sort();
        files.dedup();
        *self.relevant_files.lock().await = files;
    }

    /// Compile a bounded, deterministic task-conditioned Cognitive View.
    pub async fn compile_view(&self, goal: &str) -> CognitiveView {
        let hard = self.hard_state.lock().await;
        let soft = self.soft_workspace.lock().await;
        let relevant_files = self.relevant_files.lock().await.clone();

        let mut active_claims: Vec<_> = hard.claims.values().cloned().collect();
        active_claims.sort_by(|left, right| left.id.cmp(&right.id));
        let mut open_obligations: Vec<_> = hard
            .obligations
            .iter()
            .map(|(id, description)| format!("{id}: {description}"))
            .collect();
        open_obligations.sort();

        CognitiveView {
            hard_revision: hard.revision,
            goal_description: goal.to_string(),
            active_claims,
            open_obligations,
            unknowns: soft.unknowns.clone(),
            active_hypotheses: soft.hypotheses.clone(),
            active_focus: soft.active_focus.clone(),
            relevant_files,
            token_budget_hint: 4096,
            model_invocation_count: hard.model_invocations.len(),
        }
    }

    /// Execute one model turn while preserving the proposal/execution,
    /// evidence/verification and completion boundaries.
    pub async fn step(&self, goal: &str, user_prompt: &str) -> RivetResult<String> {
        let view = self.compile_view(goal).await;
        let model_id = std::env::var("RIVET_MODEL_ID")
            .unwrap_or_else(|_| "muse-spark-1.2-contributor-free".into());
        let view_revision = view.hard_revision;
        let model_req = ModelRequest {
            model_id: model_id.clone(),
            system_prompt: Arc::from(
                "You are Rivet's cognitive controller. Use only typed proposal JSON when requesting actions. A proposal is not execution, an observation, verification, or completion.",
            ),
            cognitive_view: Arc::new(view),
            user_prompt: user_prompt.to_string(),
            temperature: Some(0.2),
            max_tokens: Some(2048),
        };

        let invocation_start = Instant::now();
        let response = self.model.invoke(model_req).await?;
        self.record_event(NoesisEvent::ModelInvocationRecorded {
            record: ModelInvocationRecord {
                invocation_id: ReceiptId::new(),
                model_id,
                reason: "SEMANTIC_DIAGNOSIS".into(),
                input_tokens: response.usage.input_tokens,
                output_tokens: response.usage.output_tokens,
                latency_ms: invocation_start.elapsed().as_millis() as u64,
                timestamp: chrono::Utc::now(),
            },
        })
        .await?;

        for action in response.actions {
            match action {
                CognitiveAction::Thought(thought) => {
                    tracing::info!("Model thought: {}", thought);
                }
                CognitiveAction::ToolCall(proposal) => {
                    let proposal_message = AccpMessage::ActionProposal(proposal.clone());
                    AccpEnvelope::from_message(
                        proposal.action_id.to_string(),
                        accp::ActorRole::CognitiveController,
                        &proposal_message,
                    )?
                    .validate_direction()?;

                    // The proposal is bound to the view revision that the model
                    // actually received. Invocation accounting is a later audit
                    // event and must not make an otherwise fresh proposal stale.
                    let current_revision = view_revision;
                    let policy = ActionAuthorizationPolicy {
                        repository: self.repository_id.clone(),
                        current_revision,
                        allowed_scope: Scope::global(&self.repository_id, current_revision),
                        allowed_capabilities: vec!["file.read".into(), "file.write".into()],
                        allow_material: true,
                        human_approved: false,
                    };
                    let decision = AccpSemanticGate::authorize_action(&proposal, &policy);
                    let decision_message = AccpMessage::ActionDecision(decision.clone());
                    AccpEnvelope::from_message(
                        format!("decision-{}", proposal.action_id),
                        accp::ActorRole::Harness,
                        &decision_message,
                    )?
                    .validate_direction()?;
                    AccpSemanticGate::ensure_execution_authorized(&decision)?;

                    let receipt = self.runtime.execute_action(&proposal).await?;
                    let receipt_message = AccpMessage::ExecutionReceipt(receipt.clone());
                    AccpEnvelope::from_message(
                        receipt.receipt_id.to_string(),
                        accp::ActorRole::Harness,
                        &receipt_message,
                    )?
                    .validate_direction()?;
                    self.record_event(NoesisEvent::ExecutionRecorded {
                        receipt: receipt.clone(),
                        timestamp: chrono::Utc::now(),
                    })
                    .await?;
                    self.record_event(NoesisEvent::EvidenceRecorded {
                        evidence_id: receipt.evidence_id.clone(),
                        source: proposal.capability.clone(),
                        summary: receipt.output_summary.clone(),
                        timestamp: chrono::Utc::now(),
                    })
                    .await?;
                }
                CognitiveAction::HypothesisDelta { add, remove } => {
                    let mut soft = self.soft_workspace.lock().await;
                    for hypothesis in add {
                        soft.add_hypothesis(hypothesis);
                    }
                    for hypothesis in remove {
                        soft.hypotheses.retain(|current| current != &hypothesis);
                    }
                }
                CognitiveAction::VerificationRequest(request) => {
                    self.run_verification(request).await?;
                }
                CognitiveAction::ClaimProposal(proposal) => {
                    AccpSemanticGate::validate_claim_proposal(&proposal)?;
                    let mut soft = self.soft_workspace.lock().await;
                    soft.add_hypothesis(format!(
                        "Claim proposal (not promoted): {}",
                        proposal.proposition
                    ));
                }
                CognitiveAction::StateTransitionProposal(proposal) => {
                    let current_revision = self.hard_state.lock().await.revision;
                    if proposal.base_revision != current_revision {
                        return Err(RivetError::SemanticViolation(
                            "State transition proposal has a stale base revision".into(),
                        ));
                    }
                    for description in proposal.obligations_to_create {
                        self.record_event(NoesisEvent::ObligationCreated {
                            obligation_id: ObligationId::new(),
                            description,
                            scope: Scope::global(&self.repository_id, current_revision),
                            timestamp: chrono::Utc::now(),
                        })
                        .await?;
                    }
                }
                CognitiveAction::CompletionRequest { summary } => {
                    let hard = self.hard_state.lock().await;
                    let proposal = CompletionProposal {
                        task_id: self.task_id.clone(),
                        summary: summary.clone(),
                        claims_addressed: Vec::new(),
                        base_revision: hard.revision,
                        timestamp: chrono::Utc::now(),
                    };
                    let decision = AccpSemanticGate::evaluate_completion(
                        &proposal,
                        hard.revision,
                        hard.open_obligation_ids(),
                        &hard.passing_verification_receipts(),
                    );
                    drop(hard);
                    if !decision.completed {
                        let reason = if !decision.unclosed_obligations.is_empty() {
                            format!(
                                "completion rejected: {} obligations remain unverified",
                                decision.unclosed_obligations.len()
                            )
                        } else {
                            format!(
                                "completion rejected: Praxis PASS receipt required (final_receipt={})",
                                decision.final_receipt.is_some()
                            )
                        };
                        return Err(RivetError::VerificationFailed(format!(
                            "{reason}; revision_consistent={}",
                            decision.required_obligations_satisfied
                        )));
                    }
                    let final_receipt = decision
                        .final_receipt
                        .expect("completion gate checked receipt");
                    self.record_event(NoesisEvent::CompletionAccepted {
                        task_id: self.task_id.clone(),
                        final_receipt,
                        timestamp: chrono::Utc::now(),
                    })
                    .await?;
                    return Ok(format!("Task completed: {summary}"));
                }
            }
        }

        Ok(response.text_content)
    }

    /// Execute a model-requested verification through Runtime and classify its
    /// output with the real Praxis parsers/engine.
    pub async fn run_verification(
        &self,
        request: VerificationRequest,
    ) -> RivetResult<accp::VerificationReceipt> {
        let current_revision = self.hard_state.lock().await.revision;
        if request.target_scope.revision != current_revision {
            return Err(RivetError::SemanticViolation(
                "Verification request is stale for the current state revision".into(),
            ));
        }
        let mut parts = request.predicate.split_whitespace();
        let Some(program) = parts.next() else {
            return Err(RivetError::VerificationFailed(
                "verification predicate is empty".into(),
            ));
        };
        let args: Vec<_> = parts.collect();
        let (exit_code, stdout, stderr, _duration_ms) = self
            .runtime
            .execute_command(program, &args, request.timeout_seconds as u64)
            .await?;
        let report = parse_report(program, &stdout, &stderr);
        let legacy_report = TestRunReport {
            passed_count: report.passed_count,
            failed_count: report.failed_count,
            ignored_count: report.skipped_count,
            raw_stdout: report.raw_stdout.clone(),
            raw_stderr: report.raw_stderr.clone(),
        };
        let mut receipt = PraxisEngine::evaluate_test_result(&request, &legacy_report);
        if exit_code != 0 {
            receipt.passed = false;
            receipt.diagnostics =
                Some(format!("verification command exited with code {exit_code}"));
        }
        self.record_event(NoesisEvent::VerificationRecorded {
            receipt: receipt.clone(),
            timestamp: chrono::Utc::now(),
        })
        .await?;
        if receipt.passed {
            let is_open = self
                .hard_state
                .lock()
                .await
                .obligations
                .contains_key(&request.obligation_id);
            if is_open {
                self.record_event(NoesisEvent::ObligationClosed {
                    obligation_id: request.obligation_id,
                    receipt_id: receipt.receipt_id.clone(),
                    timestamp: chrono::Utc::now(),
                })
                .await?;
            }
        }
        Ok(receipt)
    }

    /// Append and materialize one event in a single Harness ordering point.
    pub async fn record_event(&self, event: NoesisEvent) -> RivetResult<Revision> {
        let mut hard = self.hard_state.lock().await;
        let expected = hard.revision.next();
        let revision = self.store.append_event(&event).await?;
        if revision != expected {
            return Err(RivetError::Storage(format!(
                "event store revision {} does not match expected {}",
                revision, expected
            )));
        }
        hard.apply(&event);
        self.store.save_checkpoint(&hard).await?;
        Ok(revision)
    }
}

fn parse_report(program: &str, stdout: &str, stderr: &str) -> ParsedTestReport {
    match program {
        "cargo" => CargoTestParser::parse(stdout, stderr),
        "pytest" => PytestParser::parse(stdout, stderr),
        "go" => GoTestParser::parse(stdout, stderr),
        "npm" | "pnpm" | "yarn" | "jest" | "vitest" => JestParser::parse(stdout, stderr),
        _ => CargoTestParser::parse(stdout, stderr),
    }
}
