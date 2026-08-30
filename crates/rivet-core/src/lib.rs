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
use noesis::{
    CognitiveView, HardState, InvocationReason, ModelInvocationRecord, NoesisEvent, SoftWorkspace,
};
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
    cycle_lock: Arc<Mutex<()>>,
    phase: Arc<Mutex<RunPhase>>,
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
        mut hard_state: HardState,
    ) -> Self {
        let task_id = hard_state
            .active_task_id
            .clone()
            .unwrap_or_else(|| task_id.clone());
        hard_state.active_task_id = Some(task_id.clone());
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
            cycle_lock: Arc::new(Mutex::new(())),
            phase: Arc::new(Mutex::new(RunPhase::Idle)),
        }
    }

    pub async fn set_relevant_files(&self, mut files: Vec<String>) {
        files.sort();
        files.dedup();
        *self.relevant_files.lock().await = files;
    }

    pub fn with_repository_id(mut self, repository_id: impl Into<String>) -> Self {
        self.repository_id = repository_id.into();
        self
    }

    pub async fn current_phase(&self) -> RunPhase {
        *self.phase.lock().await
    }

    async fn set_phase(&self, phase: RunPhase) {
        *self.phase.lock().await = phase;
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
        let mut recent_evidence: Vec<_> = hard
            .evidence
            .iter()
            .map(|(id, summary)| format!("{id}: {summary}"))
            .collect();
        recent_evidence.sort();
        recent_evidence.truncate(32);

        CognitiveView {
            hard_revision: hard.revision,
            repository_id: self.repository_id.clone(),
            goal_description: goal.to_string(),
            active_claims,
            open_obligations,
            recent_evidence,
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
        let _cycle_guard = self.cycle_lock.lock().await;
        let result = self.step_inner(goal, user_prompt).await;
        if result.is_err() {
            self.set_phase(RunPhase::Failed).await;
        } else if self.current_phase().await != RunPhase::Completed {
            self.set_phase(RunPhase::Idle).await;
        }
        result
    }

    async fn step_inner(&self, goal: &str, user_prompt: &str) -> RivetResult<String> {
        self.set_phase(RunPhase::PreparingView).await;
        let view = self.compile_view(goal).await;
        let view_message = AccpMessage::View(accp::ViewMessage {
            kind: "COGNITIVE".into(),
            payload: serde_json::to_value(&view)
                .map_err(|error| RivetError::Serialization(error.to_string()))?,
        });
        AccpEnvelope::from_message(
            format!("view-{}-{}", self.task_id, view.hard_revision),
            accp::ActorRole::Harness,
            &view_message,
        )?
        .validate_direction()?;
        self.set_phase(RunPhase::InvokingModel).await;
        let model_id = std::env::var("RIVET_MODEL_ID")
            .unwrap_or_else(|_| "muse-spark-1.2-contributor-free".into());
        let view_revision = view.hard_revision;
        let model_req = ModelRequest {
            model_id: model_id.clone(),
            system_prompt: Arc::from(
                "You are Rivet's cognitive controller. The Harness owns authority, observations, verification, persistence, and completion. Use prose only for analysis, or return one typed proposal JSON object with action_type and payload. Allowed action_type values are tool_call, hypothesis_delta, claim_proposal, state_transition_proposal, verification_request, and completion_request. A proposal is not execution, an observation, verification, or completion. Never emit execution_receipt, verification_receipt, or completion_decision JSON. Keep paths relative and use the repository identity and revision shown in the Cognitive View.",
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
                reason: InvocationReason::SemanticDiagnosis,
                input_tokens: response.usage.input_tokens,
                output_tokens: response.usage.output_tokens,
                latency_ms: invocation_start.elapsed().as_millis() as u64,
                timestamp: chrono::Utc::now(),
            },
        })
        .await?;

        self.set_phase(RunPhase::DecodingActions).await;
        for action in response.actions {
            match action {
                CognitiveAction::Thought(thought) => {
                    tracing::info!("Model thought: {}", thought);
                }
                CognitiveAction::ToolCall(proposal) => {
                    self.set_phase(RunPhase::Authorizing).await;
                    let proposal_message = AccpMessage::ActionProposal(proposal.clone());
                    AccpEnvelope::from_message(
                        proposal.action_id.to_string(),
                        accp::ActorRole::CognitiveController,
                        &proposal_message,
                    )?
                    .validate_direction()?;

                    let idempotency_key = proposal.idempotency_identity();
                    let fingerprint = proposal.idempotency_fingerprint()?;
                    if let Some(previous) = self
                        .hard_state
                        .lock()
                        .await
                        .execution_receipts
                        .iter()
                        .find(|receipt| receipt.idempotency_key == idempotency_key)
                        .cloned()
                    {
                        if previous.action_fingerprint != fingerprint {
                            return Err(RivetError::Runtime(format!(
                                "idempotency key '{}' was reused for a different persisted action",
                                idempotency_key
                            )));
                        }
                        tracing::debug!(
                            action_id = %proposal.action_id,
                            receipt_id = %previous.receipt_id,
                            "returning persisted idempotent action receipt"
                        );
                        continue;
                    }

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

                    self.set_phase(RunPhase::Executing).await;
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
                    self.set_phase(RunPhase::Verifying).await;
                    let proposal_message = AccpMessage::VerificationRequest(request.clone());
                    AccpEnvelope::from_message(
                        format!("verification-{}", request.obligation_id),
                        accp::ActorRole::CognitiveController,
                        &proposal_message,
                    )?
                    .validate_direction()?;
                    let invocation_revision = view_revision.next();
                    self.run_verification_at(request, invocation_revision)
                        .await?;
                }
                CognitiveAction::ClaimProposal(proposal) => {
                    self.set_phase(RunPhase::RevisingState).await;
                    let proposal_message = AccpMessage::ClaimProposal(proposal.clone());
                    AccpEnvelope::from_message(
                        format!("claim-{}", proposal.claim_id),
                        accp::ActorRole::CognitiveController,
                        &proposal_message,
                    )?
                    .validate_direction()?;
                    AccpSemanticGate::validate_claim_proposal(&proposal)?;
                    let mut soft = self.soft_workspace.lock().await;
                    soft.add_hypothesis(format!(
                        "Claim proposal (not promoted): {}",
                        proposal.proposition
                    ));
                }
                CognitiveAction::StateTransitionProposal(proposal) => {
                    self.set_phase(RunPhase::RevisingState).await;
                    let proposal_message = AccpMessage::StateTransitionProposal(proposal.clone());
                    AccpEnvelope::from_message(
                        format!("transition-{}", self.task_id),
                        accp::ActorRole::CognitiveController,
                        &proposal_message,
                    )?
                    .validate_direction()?;
                    let current_revision = self.hard_state.lock().await.revision;
                    if proposal.base_revision != view_revision
                        || current_revision != view_revision.next()
                    {
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
                    self.set_phase(RunPhase::Verifying).await;
                    let hard = self.hard_state.lock().await;
                    if hard.completed_tasks.contains_key(&self.task_id) {
                        return Err(RivetError::SemanticViolation(
                            "Task has already been completed and cannot be completed again".into(),
                        ));
                    }
                    let proposal = CompletionProposal {
                        task_id: self.task_id.clone(),
                        summary: summary.clone(),
                        claims_addressed: Vec::new(),
                        base_revision: hard.revision,
                        timestamp: chrono::Utc::now(),
                    };
                    let proposal_message = AccpMessage::CompletionProposal(proposal.clone());
                    AccpEnvelope::from_message(
                        format!("completion-{}", self.task_id),
                        accp::ActorRole::CognitiveController,
                        &proposal_message,
                    )?
                    .validate_direction()?;
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
                    self.set_phase(RunPhase::Completed).await;
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
        self.run_verification_at(request, current_revision).await
    }

    async fn run_verification_at(
        &self,
        request: VerificationRequest,
        expected_revision: Revision,
    ) -> RivetResult<accp::VerificationReceipt> {
        let current_revision = self.hard_state.lock().await.revision;
        if request.target_scope.repository != self.repository_id
            || request.target_scope.revision != expected_revision
            || current_revision != expected_revision
        {
            return Err(RivetError::SemanticViolation(
                "Verification request is outside the current repository or state revision".into(),
            ));
        }
        let mut parts = request.predicate.split_whitespace();
        let Some(program) = parts.next() else {
            return Err(RivetError::VerificationFailed(
                "verification predicate is empty".into(),
            ));
        };
        let args: Vec<_> = parts.collect();
        if !is_allowed_verification_program(program) {
            return Err(RivetError::AuthorityDenied(format!(
                "verification program '{program}' is not exposed by the Harness"
            )));
        }
        if args.iter().any(|arg| {
            let path = std::path::Path::new(arg);
            path.is_absolute()
                || path.has_root()
                || path
                    .components()
                    .any(|component| matches!(component, std::path::Component::ParentDir))
        }) {
            return Err(RivetError::AuthorityDenied(
                "verification arguments cannot address an absolute or parent path".into(),
            ));
        }
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
        let receipt_message = AccpMessage::VerificationReceipt(receipt.clone());
        AccpEnvelope::from_message(
            receipt.receipt_id.to_string(),
            accp::ActorRole::Harness,
            &receipt_message,
        )?
        .validate_direction()?;
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
        match &event {
            NoesisEvent::ClaimAsserted {
                status: EpistemicStatus::Verified,
                ..
            }
            | NoesisEvent::ClaimStatusChanged {
                new_status: EpistemicStatus::Verified,
                ..
            } => {
                return Err(RivetError::SemanticViolation(
                    "Harness cannot admit VERIFIED claim status without a Praxis promotion path"
                        .into(),
                ));
            }
            NoesisEvent::ObligationClosed { receipt_id, .. } => {
                let verified = hard
                    .verification_receipts
                    .values()
                    .any(|receipt| receipt.receipt_id == *receipt_id && receipt.passed);
                if !verified {
                    return Err(RivetError::VerificationFailed(
                        "obligation closure requires a recorded passing Praxis receipt".into(),
                    ));
                }
            }
            NoesisEvent::CompletionAccepted { final_receipt, .. } => {
                let verified = hard
                    .verification_receipts
                    .values()
                    .any(|receipt| receipt.receipt_id == *final_receipt && receipt.passed);
                if !verified {
                    return Err(RivetError::VerificationFailed(
                        "completion acceptance requires a recorded passing Praxis receipt".into(),
                    ));
                }
            }
            _ => {}
        }
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

fn is_allowed_verification_program(program: &str) -> bool {
    matches!(
        program,
        "cargo" | "pytest" | "go" | "npm" | "pnpm" | "yarn" | "jest" | "vitest"
    )
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
