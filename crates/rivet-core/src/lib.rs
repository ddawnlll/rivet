pub mod goal_compiler;
pub use goal_compiler::{
    GoalCompiler, GoalSpec, ObligationGraph, ObligationNode, ObligationPredicate, ObligationStatus,
};

use accp::{
    AccpEnvelope, AccpMessage, AccpSemanticGate, ActionAuthorizationPolicy, CompletionProposal,
    VerificationRequest,
};
use hephaestus::{FailureClusterTracker, HephaestusEngine};
use noesis::{
    CognitiveView, HardState, InvocationReason, ModelInvocationRecord, NoesisEvent, SoftWorkspace,
};
use praxis::{
    CargoTestParser, ChangedFile, GateVerdict, GoTestParser, JestParser, Ledger, ParsedTestReport,
    PlanSpec, PraxisEngine, PytestParser, TestRunReport, VerityPipeline,
};
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest};
use rivet_repository::{InductionEngine, RepoFrontier, RepositoryCensus};
use rivet_runtime::Runtime;
use rivet_store::HardStateStore;
use rivet_types::*;
use rivet_view::{CognitiveViewCompiler, CompilationContext, RepresentationMode};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

/// Explicit phase state machine for a single cognitive cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum RunPhase {
    Idle,
    PreparingView,
    InvokingModel,
    DecodingActions,
    Authorizing,
    Executing,
    Observing,
    Verifying,
    RevisingState,
    Stagnated,
    WaitingForUser,
    Responding,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TurnOutcome {
    pub text: String,
    pub has_actions: bool,
    pub is_completed: bool,
}
/// These are intentionally typed summaries: raw model chain-of-thought never
/// crosses this boundary.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum HarnessEvent {
    Phase {
        phase: RunPhase,
        message: String,
    },
    CognitiveState {
        focus: String,
        hypothesis: Option<String>,
        status: String,
        evidence_count: usize,
        counter_signal: Option<String>,
    },
    ToolCall {
        action_id: String,
        capability: String,
        target: String,
        status: String,
        summary: String,
        output_summary: Option<String>,
    },
    Observation {
        source: String,
        summary: String,
        evidence_id: Option<String>,
    },
    Praxis {
        obligation_id: String,
        predicate: String,
        status: String,
        scope: String,
        diagnostics: Option<String>,
        receipt_id: Option<String>,
    },
    HardStateMutation {
        revision: u64,
        mutation: String,
        entity_id: Option<String>,
        from: Option<String>,
        to: Option<String>,
    },
}

pub type HarnessEventSink = Arc<dyn Fn(HarnessEvent) + Send + Sync>;

pub struct HarnessCore {
    pub session_id: SessionId,
    pub task_id: TaskId,
    pub hard_state: Arc<Mutex<HardState>>,
    pub soft_workspace: Arc<Mutex<SoftWorkspace>>,
    pub store: Arc<dyn HardStateStore>,
    pub model: Arc<dyn ModelBackend>,
    pub runtime: Arc<Runtime>,
    pub goal_spec: Arc<Mutex<Option<GoalSpec>>>,
    pub failure_tracker: Arc<Mutex<FailureClusterTracker>>,
    pub hephaestus: Arc<HephaestusEngine>,
    repository_id: String,
    relevant_files: Arc<Mutex<Vec<String>>>,
    repository_signals: Arc<Mutex<Vec<String>>>,
    cycle_lock: Arc<Mutex<()>>,
    phase: Arc<Mutex<RunPhase>>,
    pending_steers: Arc<Mutex<Vec<String>>>,
    event_sink: Arc<std::sync::RwLock<Option<HarnessEventSink>>>,
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

    pub fn from_state(
        store: Arc<dyn HardStateStore>,
        model: Arc<dyn ModelBackend>,
        runtime: Arc<Runtime>,
        session_id: SessionId,
        task_id: TaskId,
        mut hard: HardState,
    ) -> Self {
        let base_revision = hard.revision;
        let task_id = hard.active_task_id.clone().unwrap_or(task_id);
        hard.active_task_id = Some(task_id.clone());
        Self {
            session_id: session_id.clone(),
            task_id,
            hard_state: Arc::new(Mutex::new(hard)),
            soft_workspace: Arc::new(Mutex::new(SoftWorkspace::new(session_id, base_revision))),
            store,
            model,
            runtime,
            goal_spec: Arc::new(Mutex::new(None)),
            failure_tracker: Arc::new(Mutex::new(FailureClusterTracker::new())),
            hephaestus: Arc::new(HephaestusEngine::new(3)),
            repository_id: "rivet".into(),
            relevant_files: Arc::new(Mutex::new(Vec::new())),
            repository_signals: Arc::new(Mutex::new(Vec::new())),
            cycle_lock: Arc::new(Mutex::new(())),
            phase: Arc::new(Mutex::new(RunPhase::Idle)),
            pending_steers: Arc::new(Mutex::new(Vec::new())),
            event_sink: Arc::new(std::sync::RwLock::new(None)),
        }
    }

    /// Enqueue a non-blocking steering directive into the Harness without acquiring cycle lock.
    /// Injects into provisional SoftWorkspace focus and the upcoming cognitive turn.
    pub async fn steer(&self, prompt: impl Into<String>) {
        let prompt = prompt.into();
        self.pending_steers.lock().await.push(prompt.clone());
        let mut soft = self.soft_workspace.lock().await;
        soft.hypotheses
            .push(format!("Steering directive: {}", prompt));
        soft.active_focus.push(prompt);
    }

    /// Attach a non-blocking observer used by local UI adapters.
    pub fn with_event_sink(self, sink: HarnessEventSink) -> Self {
        if let Ok(mut slot) = self.event_sink.write() {
            *slot = Some(sink);
        }
        self
    }

    fn emit_event(&self, event: HarnessEvent) {
        if let Ok(slot) = self.event_sink.read()
            && let Some(sink) = slot.as_ref()
        {
            sink(event);
        }
    }

    /// Explicitly bind an external Hephaestus engine configuration to this Harness.
    pub fn with_hephaestus(mut self, hephaestus: HephaestusEngine) -> Self {
        self.hephaestus = Arc::new(hephaestus);
        self
    }

    pub fn enable_hephaestus(&mut self, threshold: usize) {
        self.hephaestus = Arc::new(HephaestusEngine::enabled(threshold));
    }

    /// Materialize goal obligations into Noesis Hard State through GoalCompiler.
    pub async fn initialize_goal(&self, user_prompt: &str) -> RivetResult<GoalSpec> {
        let current_revision = self.hard_state.lock().await.revision;
        let spec = GoalCompiler::compile(user_prompt, &self.repository_id, current_revision);

        for node in spec.graph.nodes.values() {
            self.record_event(NoesisEvent::ObligationCreated {
                obligation_id: node.id.clone(),
                description: format!("{}: {}", node.title, node.description),
                scope: node.target_scope.clone(),
                timestamp: chrono::Utc::now(),
            })
            .await?;
        }

        *self.goal_spec.lock().await = Some(spec.clone());
        self.set_phase(RunPhase::Idle).await;
        Ok(spec)
    }

    /// Adaptive repository induction: updates the active RepoFrontier conditioned on goal and focus
    pub async fn update_repo_frontier(
        &self,
        census: &RepositoryCensus,
        goal_prompt: &str,
    ) -> RepoFrontier {
        let focus = self.soft_workspace.lock().await.active_focus.clone();
        let frontier = InductionEngine::induce_frontier(census, goal_prompt, &focus, 8192);

        self.set_relevant_files(frontier.descended_paths()).await;

        let mut signals = Vec::new();
        for dir in census.active_directory_frontier(8) {
            signals.push(format!(
                "{}: {} files ({} KB)",
                dir.relative_path,
                dir.file_count,
                dir.total_bytes / 1024
            ));
        }
        self.set_repository_signals(signals).await;

        frontier
    }

    pub async fn set_relevant_files(&self, mut files: Vec<String>) {
        files.sort();
        files.dedup();
        *self.relevant_files.lock().await = files;
    }

    /// Install bounded deterministic repository observations for the next
    /// Cognitive View. They inform semantic induction but never authorize a
    /// path or mutate hard state by themselves.
    pub async fn set_repository_signals(&self, mut signals: Vec<String>) {
        signals.sort();
        signals.dedup();
        signals.truncate(64);
        *self.repository_signals.lock().await = signals;
    }

    pub fn with_repository_id(mut self, repository_id: impl Into<String>) -> Self {
        self.repository_id = repository_id.into();
        self
    }

    pub fn repository_id(&self) -> &str {
        &self.repository_id
    }

    pub async fn current_phase(&self) -> RunPhase {
        *self.phase.lock().await
    }

    pub async fn cancel(&self) {
        self.set_phase(RunPhase::Cancelled).await;
    }

    async fn set_phase(&self, phase: RunPhase) {
        *self.phase.lock().await = phase;
        self.emit_event(HarnessEvent::Phase {
            phase,
            message: format!("phase: {phase:?}"),
        });
    }

    /// Compile a bounded, deterministic task-conditioned Cognitive View using rivet-view.
    pub async fn compile_view(&self, goal: &str) -> CognitiveView {
        let hard = self.hard_state.lock().await;
        let soft = self.soft_workspace.lock().await;
        let relevant_files = self.relevant_files.lock().await.clone();
        let repository_signals = self.repository_signals.lock().await.clone();

        let ctx = CompilationContext {
            hard_state: &hard,
            soft_workspace: &soft,
            goal_description: goal,
            repository_id: &self.repository_id,
            relevant_files: &relevant_files,
            repository_signals: &repository_signals,
            token_budget: 4096,
            mode: RepresentationMode::Hybrid,
            deferred_trees_count: 0,
        };

        let compiled = CognitiveViewCompiler::compile(&ctx);

        CognitiveView {
            hard_revision: compiled.hard_revision,
            repository_id: compiled.repository_id,
            goal_description: compiled.goal_description,
            active_claims: compiled.active_claims,
            contradictions: compiled
                .contradictions
                .into_iter()
                .map(|c| format!("{}: {}", c.claim_id, c.reason))
                .collect(),
            rejected_claims: compiled
                .rejected_claims
                .into_iter()
                .map(|r| format!("{}: {}", r.claim_id, r.reason))
                .collect(),
            open_obligations: compiled
                .open_obligations
                .into_iter()
                .map(|(id, desc, _scope)| format!("{}: {}", id, desc))
                .collect(),
            recent_evidence: compiled
                .recent_evidence
                .into_iter()
                .map(|(id, src, sum)| format!("{}: [{}] {}", id, src, sum))
                .collect(),
            repository_signals: compiled.repository_signals,
            unknowns: compiled.unknowns,
            active_hypotheses: compiled.hypotheses,
            active_focus: compiled.active_focus,
            relevant_files: compiled.relevant_files,
            token_budget_hint: compiled.omitted_summary.token_budget,
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

    /// Execute an autonomous multi-turn cognitive cycle until completion,
    /// user interaction, stagnation, cancellation, or turn budget exhaustion.
    pub async fn run_task(
        &self,
        goal: &str,
        initial_prompt: &str,
        max_turns: usize,
    ) -> RivetResult<String> {
        let _cycle_guard = self.cycle_lock.lock().await;
        let mut turn = 0;
        let mut current_prompt = initial_prompt.to_string();
        let mut final_response = String::new();

        while turn < max_turns {
            turn += 1;
            if self.current_phase().await == RunPhase::Cancelled {
                return Err(RivetError::Runtime("Task cancelled by user".into()));
            }

            let outcome = match self.step_turn_inner(goal, &current_prompt).await {
                Ok(res) => res,
                Err(err) => {
                    self.set_phase(RunPhase::Failed).await;
                    return Err(err);
                }
            };
            final_response = outcome.text.clone();

            if outcome.is_completed || self.current_phase().await == RunPhase::Completed {
                self.set_phase(RunPhase::Completed).await;
                return Ok(final_response);
            }

            let phase = self.current_phase().await;
            if phase == RunPhase::Stagnated || phase == RunPhase::WaitingForUser {
                return Ok(final_response);
            }

            if !outcome.has_actions {
                self.set_phase(RunPhase::Idle).await;
                return Ok(final_response);
            }

            current_prompt = format!(
                "Original User Request: {}\n\nPrevious turn {} executed your requested action and recorded new observations and evidence. Answer the user's request using the evidence, or propose the next required action.",
                initial_prompt, turn
            );
        }

        self.record_event(NoesisEvent::ProcessErrorAttributed {
            record: noesis::ProcessErrorAttributionRecord {
                attribution_id: ReceiptId::new(),
                category: "BUDGET_EXHAUSTED".into(),
                diagnostic: format!("Autonomous loop reached turn limit of {max_turns}"),
                suggested_policy_repair: Some(
                    "Narrow scope or increase maximum turn budget".into(),
                ),
                timestamp: chrono::Utc::now(),
            },
        })
        .await?;

        self.set_phase(RunPhase::Idle).await;
        Ok(final_response)
    }

    async fn step_inner(&self, goal: &str, user_prompt: &str) -> RivetResult<String> {
        let outcome = self.step_turn_inner(goal, user_prompt).await?;
        Ok(outcome.text)
    }

    async fn step_turn_inner(&self, goal: &str, user_prompt: &str) -> RivetResult<TurnOutcome> {
        self.set_phase(RunPhase::PreparingView).await;
        let view = self.compile_view(goal).await;
        self.emit_event(HarnessEvent::CognitiveState {
            focus: goal.to_string(),
            hypothesis: view.active_hypotheses.first().cloned(),
            status: "provisional".into(),
            evidence_count: view.recent_evidence.len(),
            counter_signal: view.contradictions.first().cloned(),
        });
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
        let pending = {
            let mut steers = self.pending_steers.lock().await;
            std::mem::take(&mut *steers)
        };
        let effective_user_prompt = if pending.is_empty() {
            user_prompt.to_string()
        } else {
            let steer_block = pending
                .iter()
                .map(|s| format!("[Steering Directive]: {}", s))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{}\n\n{}", user_prompt, steer_block)
        };

        let model_id = std::env::var("RIVET_MODEL_ID").unwrap_or_default();
        let view_revision = view.hard_revision;
        let model_req = ModelRequest {
            model_id: model_id.clone(),
            system_prompt: Arc::from(accp::compile_controller_reference_prompt()),
            cognitive_view: Arc::new(view),
            user_prompt: effective_user_prompt,
            temperature: Some(0.2),
            max_tokens: Some(2048),
        };

        let invocation_start = Instant::now();
        let response = self.model.invoke(model_req).await?;
        let recorded_model_id = if model_id.is_empty() {
            "active_model".to_string()
        } else {
            model_id
        };
        self.record_event(NoesisEvent::ModelInvocationRecorded {
            record: ModelInvocationRecord {
                invocation_id: ReceiptId::new(),
                model_id: recorded_model_id,
                reason: InvocationReason::SemanticDiagnosis,
                input_tokens: response.usage.input_tokens,
                output_tokens: response.usage.output_tokens,
                latency_ms: invocation_start.elapsed().as_millis() as u64,
                timestamp: chrono::Utc::now(),
            },
        })
        .await?;

        self.set_phase(RunPhase::DecodingActions).await;
        let has_actions = !response.actions.is_empty();
        for action in response.actions {
            match action {
                CognitiveAction::Thought(thought) => {
                    tracing::info!("Model thought: {}", thought);
                }
                CognitiveAction::ToolCall(proposal) => {
                    self.emit_event(HarnessEvent::ToolCall {
                        action_id: proposal.action_id.to_string(),
                        capability: proposal.capability.clone(),
                        target: proposal.target.clone(),
                        status: "proposed".into(),
                        summary: proposal.intent.clone(),
                        output_summary: None,
                    });
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
                        allowed_capabilities: vec![
                            "file.read".into(),
                            "file.write".into(),
                            "semantic.patch".into(),
                            "code.search".into(),
                            "dir.list".into(),
                            "workspace.rollback".into(),
                            "mcp.*".into(),
                        ],
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
                    self.emit_event(HarnessEvent::ToolCall {
                        action_id: proposal.action_id.to_string(),
                        capability: proposal.capability.clone(),
                        target: proposal.target.clone(),
                        status: "executing".into(),
                        summary: proposal.intent.clone(),
                        output_summary: None,
                    });
                    let receipt = match self.runtime.execute_action(&proposal).await {
                        Ok(receipt) => receipt,
                        Err(error) => {
                            self.emit_event(HarnessEvent::ToolCall {
                                action_id: proposal.action_id.to_string(),
                                capability: proposal.capability.clone(),
                                target: proposal.target.clone(),
                                status: "failed".into(),
                                summary: proposal.intent.clone(),
                                output_summary: Some(error.to_string()),
                            });
                            return Err(error);
                        }
                    };
                    self.emit_event(HarnessEvent::ToolCall {
                        action_id: proposal.action_id.to_string(),
                        capability: proposal.capability.clone(),
                        target: proposal.target.clone(),
                        status: if receipt.success {
                            "completed"
                        } else {
                            "failed"
                        }
                        .into(),
                        summary: proposal.intent.clone(),
                        output_summary: Some(receipt.output_summary.clone()),
                    });
                    self.set_phase(RunPhase::Observing).await;
                    self.emit_event(HarnessEvent::Observation {
                        source: proposal.capability.clone(),
                        summary: receipt.output_summary.clone(),
                        evidence_id: Some(receipt.evidence_id.to_string()),
                    });
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
                    let evidence_summary = if let Some(content) = receipt
                        .observations
                        .get("content")
                        .and_then(|v| v.as_str())
                    {
                        format!("{}\n```\n{}\n```", receipt.output_summary, content)
                    } else if let Some(matches) = receipt
                        .observations
                        .get("matches")
                        .and_then(|v| v.as_str())
                    {
                        format!("{}\n```\n{}\n```", receipt.output_summary, matches)
                    } else {
                        receipt.output_summary.clone()
                    };

                    self.record_event(NoesisEvent::EvidenceRecorded {
                        evidence_id: receipt.evidence_id.clone(),
                        source: proposal.capability.clone(),
                        summary: evidence_summary,
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
                    self.emit_event(HarnessEvent::Praxis {
                        obligation_id: request.obligation_id.to_string(),
                        predicate: request.predicate.clone(),
                        status: "running".into(),
                        scope: format!("{:?}", request.target_scope),
                        diagnostics: None,
                        receipt_id: None,
                    });
                    self.set_phase(RunPhase::Verifying).await;
                    let proposal_message = AccpMessage::VerificationRequest(request.clone());
                    AccpEnvelope::from_message(
                        format!("verification-{}", request.obligation_id),
                        accp::ActorRole::CognitiveController,
                        &proposal_message,
                    )?
                    .validate_direction()?;
                    self.run_verification_at(request, view_revision).await?;
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

                    let hard = self.hard_state.lock().await;
                    let can_promote = hard.can_promote_to_supported(&proposal.supporting_evidence);
                    drop(hard);

                    if can_promote {
                        self.record_event(NoesisEvent::ClaimAsserted {
                            claim_id: proposal.claim_id.clone(),
                            proposition: proposal.proposition.clone(),
                            status: EpistemicStatus::Supported,
                            evidence: proposal.supporting_evidence.clone(),
                            depends_on: Vec::new(),
                            scope: proposal.scope.clone(),
                            timestamp: chrono::Utc::now(),
                        })
                        .await?;
                        let mut soft = self.soft_workspace.lock().await;
                        soft.add_hypothesis(format!(
                            "Promoted claim (supported): {}",
                            proposal.proposition
                        ));
                    } else {
                        let mut soft = self.soft_workspace.lock().await;
                        soft.add_hypothesis(format!(
                            "Provisional claim (unpromoted): {}",
                            proposal.proposition
                        ));
                    }
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
                    return Ok(TurnOutcome {
                        text: format!("Task completed: {summary}"),
                        has_actions: true,
                        is_completed: true,
                    });
                }
            }
        }

        if !has_actions
            && (response.text_content.contains("\"action_type\"")
                || response.text_content.contains("tool_call")
                || response.text_content.contains("completion_request"))
        {
            let mut soft = self.soft_workspace.lock().await;
            soft.add_hypothesis(
                "Corrective Guidance: Model output attempted an action proposal but the JSON payload was malformed. Please output valid JSON matching: {\"action_type\": \"tool_call\" | \"completion_request\" | ..., \"payload\": {...}}.",
            );
        }

        self.set_phase(RunPhase::Responding).await;
        Ok(TurnOutcome {
            text: response.text_content,
            has_actions,
            is_completed: false,
        })
    }

    /// Execute a model-requested verification through Runtime and classify its
    /// output with the real Praxis parsers/engine.
    pub async fn run_verification(
        &self,
        request: VerificationRequest,
    ) -> RivetResult<accp::VerificationReceipt> {
        let _cycle_guard = self.cycle_lock.lock().await;
        self.set_phase(RunPhase::Verifying).await;
        let current_revision = self.hard_state.lock().await.revision;
        let result = self.run_verification_at(request, current_revision).await;
        if result.is_err() {
            self.set_phase(RunPhase::Failed).await;
        } else if self.current_phase().await != RunPhase::Stagnated {
            self.set_phase(RunPhase::Idle).await;
        }
        result
    }

    /// Run the canonical Praxis Verity pipeline behind the Harness boundary.
    /// The pipeline's mechanical verdict is converted into a scoped ACCP
    /// receipt before it can affect Noesis obligations.
    pub async fn run_verity_plan(
        &self,
        request: VerificationRequest,
        plan: &PlanSpec,
        ledger: Option<&Ledger>,
        changed_files: &[ChangedFile],
        coverage_file: Option<&std::path::Path>,
        attempt_id: &str,
    ) -> RivetResult<praxis::VerityPipelineResult> {
        let _cycle_guard = self.cycle_lock.lock().await;
        self.set_phase(RunPhase::Verifying).await;
        let result = self
            .run_verity_plan_inner(
                request,
                plan,
                ledger,
                changed_files,
                coverage_file,
                attempt_id,
            )
            .await;
        if result.is_err() {
            self.set_phase(RunPhase::Failed).await;
        } else {
            self.set_phase(RunPhase::Idle).await;
        }
        result
    }

    async fn run_verity_plan_inner(
        &self,
        request: VerificationRequest,
        plan: &PlanSpec,
        ledger: Option<&Ledger>,
        changed_files: &[ChangedFile],
        coverage_file: Option<&std::path::Path>,
        attempt_id: &str,
    ) -> RivetResult<praxis::VerityPipelineResult> {
        let current_revision = self.hard_state.lock().await.revision;
        if request.target_scope.repository != self.repository_id
            || request.target_scope.revision != current_revision
        {
            return Err(RivetError::SemanticViolation(
                "Verity request is outside the current repository or state revision".into(),
            ));
        }
        self.ensure_known_obligation(&request.obligation_id, &request.target_scope)
            .await?;
        let request_message = AccpMessage::VerificationRequest(request.clone());
        AccpEnvelope::from_message(
            format!("verity-verification-{}", request.obligation_id),
            accp::ActorRole::CognitiveController,
            &request_message,
        )?
        .validate_direction()?;

        let mut result = VerityPipeline::new(self.runtime.working_dir())
            .run(plan, ledger, changed_files, coverage_file, attempt_id)
            .await;
        let passed = result.overall_verdict == GateVerdict::Pass;
        let diagnostics = if passed {
            None
        } else {
            Some(
                result
                    .gate_results
                    .iter()
                    .filter(|gate| gate.verdict != GateVerdict::Pass)
                    .map(|gate| format!("{}: {}", gate.gate_name, gate.verdict))
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        };
        let receipt = accp::VerificationReceipt {
            receipt_id: ReceiptId::new(),
            obligation_id: request.obligation_id.clone(),
            passed,
            evidence_id: result
                .final_receipt
                .as_ref()
                .map(|receipt| receipt.evidence_id.clone())
                .unwrap_or_else(EvidenceId::new),
            verified_scope: request.target_scope.clone(),
            diagnostics,
            timestamp: chrono::Utc::now(),
        };
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
        self.emit_event(HarnessEvent::Praxis {
            obligation_id: receipt.obligation_id.to_string(),
            predicate: request.predicate.clone(),
            status: if receipt.passed { "pass" } else { "fail" }.into(),
            scope: format!("{:?}", receipt.verified_scope),
            diagnostics: receipt.diagnostics.clone(),
            receipt_id: Some(receipt.receipt_id.to_string()),
        });
        if passed
            && self
                .hard_state
                .lock()
                .await
                .obligations
                .contains_key(&request.obligation_id)
        {
            self.record_event(NoesisEvent::ObligationClosed {
                obligation_id: request.obligation_id,
                receipt_id: receipt.receipt_id.clone(),
                timestamp: chrono::Utc::now(),
            })
            .await?;
        }
        if passed {
            result.final_receipt = Some(receipt);
        } else {
            result.final_receipt = None;
        }
        Ok(result)
    }

    async fn run_verification_at(
        &self,
        request: VerificationRequest,
        expected_revision: Revision,
    ) -> RivetResult<accp::VerificationReceipt> {
        let current_revision = self.hard_state.lock().await.revision;
        let invocation_revision = expected_revision.next();
        if request.target_scope.repository != self.repository_id
            || request.target_scope.revision != expected_revision
            || (current_revision != expected_revision && current_revision != invocation_revision)
        {
            return Err(RivetError::SemanticViolation(
                "Verification request is outside the current repository or state revision".into(),
            ));
        }
        self.ensure_known_obligation(&request.obligation_id, &request.target_scope)
            .await?;
        let mut parts = request.predicate.split_whitespace();
        let Some(program) = parts.next() else {
            return Err(RivetError::VerificationFailed(
                "verification predicate is empty".into(),
            ));
        };
        let args: Vec<_> = parts.collect();
        self.emit_event(HarnessEvent::Praxis {
            obligation_id: request.obligation_id.to_string(),
            predicate: request.predicate.clone(),
            status: "running".into(),
            scope: format!("{:?}", request.target_scope),
            diagnostics: None,
            receipt_id: None,
        });
        if !is_allowed_verification_program(program, self.runtime.working_dir()) {
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
        self.emit_event(HarnessEvent::Praxis {
            obligation_id: receipt.obligation_id.to_string(),
            predicate: request.predicate.clone(),
            status: if receipt.passed { "pass" } else { "fail" }.into(),
            scope: format!("{:?}", receipt.verified_scope),
            diagnostics: receipt.diagnostics.clone(),
            receipt_id: Some(receipt.receipt_id.to_string()),
        });
        if receipt.passed {
            self.failure_tracker.lock().await.record_success();
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
        } else {
            let mut tracker = self.failure_tracker.lock().await;
            tracker.record_failure(
                &request.predicate,
                receipt
                    .diagnostics
                    .as_deref()
                    .unwrap_or("verification failed"),
            );
            if self.hephaestus.should_intervene(&tracker) {
                let mut soft = self.soft_workspace.lock().await;
                let reframing = self
                    .hephaestus
                    .analyze_and_reframe(&tracker, &soft.hypotheses);
                soft.hypotheses.clear();
                for hyp in &reframing.new_hypothesis_candidates {
                    soft.add_hypothesis(format!("[Hephaestus Reframed] {}", hyp));
                }
                if let Some(repair) = &reframing.suggested_policy_repair {
                    soft.add_hypothesis(format!("[Hephaestus Policy Repair] {}", repair));
                }
                soft.active_focus = reframing.suggested_focus.clone();
                drop(soft);

                let _ = self
                    .record_event(NoesisEvent::ProcessErrorAttributed {
                        record: noesis::ProcessErrorAttributionRecord {
                            attribution_id: ReceiptId::new(),
                            category: format!("{:?}", reframing.strategy),
                            diagnostic: reframing.suggested_frame.clone(),
                            suggested_policy_repair: reframing.suggested_policy_repair.clone(),
                            timestamp: chrono::Utc::now(),
                        },
                    })
                    .await;

                self.set_phase(RunPhase::Stagnated).await;
            }
        }
        Ok(receipt)
    }

    async fn ensure_known_obligation(
        &self,
        obligation_id: &ObligationId,
        target_scope: &Scope,
    ) -> RivetResult<()> {
        let hard = self.hard_state.lock().await;
        if hard.obligations.contains_key(obligation_id)
            || hard.closed_obligations.contains_key(obligation_id)
        {
            if let Some(declared_scope) = hard.obligation_scopes.get(obligation_id)
                && !scope_contains_at_revision(declared_scope, target_scope)
            {
                return Err(RivetError::SemanticViolation(
                    "verification scope is broader than the obligation scope".into(),
                ));
            }
            return Ok(());
        }
        Err(RivetError::SemanticViolation(format!(
            "verification request references unknown obligation {obligation_id}"
        )))
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
            NoesisEvent::ObligationCreated { scope, .. }
                if scope.repository != self.repository_id || scope.revision > hard.revision =>
            {
                return Err(RivetError::SemanticViolation(
                    "obligation scope is outside the active Harness repository revision".into(),
                ));
            }
            NoesisEvent::ObligationClosed {
                obligation_id,
                receipt_id,
                ..
            } => {
                if !hard.obligations.contains_key(obligation_id) {
                    return Err(RivetError::SemanticViolation(
                        "obligation closure requires an open known obligation".into(),
                    ));
                }
                let verified = hard.verification_receipts.values().any(|receipt| {
                    receipt.receipt_id == *receipt_id
                        && receipt.obligation_id == *obligation_id
                        && receipt.passed
                });
                if !verified {
                    return Err(RivetError::VerificationFailed(
                        "obligation closure requires a recorded passing Praxis receipt".into(),
                    ));
                }
            }
            NoesisEvent::VerificationRecorded { receipt, .. } => {
                if !hard.obligations.contains_key(&receipt.obligation_id)
                    && !hard.closed_obligations.contains_key(&receipt.obligation_id)
                {
                    return Err(RivetError::SemanticViolation(
                        "verification receipt requires a known open or closed obligation".into(),
                    ));
                }
                if receipt.verified_scope.repository != self.repository_id
                    || receipt.verified_scope.revision > hard.revision
                {
                    return Err(RivetError::SemanticViolation(
                        "verification receipt scope is outside the active Harness repository revision"
                            .into(),
                    ));
                }
                if let Some(declared_scope) = hard.obligation_scopes.get(&receipt.obligation_id)
                    && !scope_contains_at_revision(declared_scope, &receipt.verified_scope)
                {
                    return Err(RivetError::SemanticViolation(
                        "verification receipt scope is broader than the obligation scope".into(),
                    ));
                }
            }
            NoesisEvent::CompletionAccepted {
                task_id,
                final_receipt,
                ..
            } => {
                if task_id != &self.task_id {
                    return Err(RivetError::SemanticViolation(
                        "completion acceptance is bound to the active Harness task".into(),
                    ));
                }
                let verified = hard
                    .verification_receipts
                    .values()
                    .any(|receipt| receipt.receipt_id == *final_receipt && receipt.passed);
                let closed = hard
                    .closed_obligations
                    .values()
                    .any(|receipt_id| receipt_id == final_receipt);
                if !hard.obligations.is_empty() || !verified || !closed {
                    return Err(RivetError::VerificationFailed(
                        "completion acceptance requires closed obligations and a recorded passing Praxis receipt".into(),
                    ));
                }
            }
            _ => {}
        }
        let (mutation, entity_id, from, to) = match &event {
            NoesisEvent::ObligationCreated { obligation_id, .. } => (
                "obligation created",
                Some(obligation_id.to_string()),
                Some("ABSENT".into()),
                Some("OPEN".into()),
            ),
            NoesisEvent::ObligationClosed { obligation_id, .. } => (
                "obligation closed",
                Some(obligation_id.to_string()),
                Some("OPEN".into()),
                Some("VERIFIED".into()),
            ),
            NoesisEvent::ObligationReopened { obligation_id, .. } => (
                "obligation reopened",
                Some(obligation_id.to_string()),
                Some("VERIFIED".into()),
                Some("OPEN".into()),
            ),
            NoesisEvent::VerificationRecorded { receipt, .. } => (
                "verification receipt recorded",
                Some(receipt.obligation_id.to_string()),
                Some("RUNNING".into()),
                Some(if receipt.passed { "PASS" } else { "FAIL" }.into()),
            ),
            NoesisEvent::ClaimContradicted { claim_id, .. } => (
                "claim contradicted",
                Some(claim_id.to_string()),
                Some("PROVISIONAL".into()),
                Some("CONTRADICTED".into()),
            ),
            NoesisEvent::ClaimRejected { claim_id, .. } => (
                "claim rejected",
                Some(claim_id.to_string()),
                Some("PROVISIONAL".into()),
                Some("REJECTED".into()),
            ),
            NoesisEvent::CompletionAccepted { task_id, .. } => (
                "task completed",
                Some(task_id.to_string()),
                Some("ACTIVE".into()),
                Some("COMPLETED".into()),
            ),
            _ => ("hard state mutation", None, None, None),
        };
        let expected_revision = hard.revision;
        let revision = self.store.append_event(expected_revision, &event).await?;
        if revision != expected_revision.next() {
            return Err(RivetError::Storage(format!(
                "event store revision {} does not match expected {}",
                revision,
                expected_revision.next()
            )));
        }
        hard.apply(&event);
        self.store.save_checkpoint(&hard).await?;
        self.emit_event(HarnessEvent::HardStateMutation {
            revision: revision.0,
            mutation: mutation.into(),
            entity_id,
            from,
            to,
        });
        Ok(revision)
    }
}

fn is_allowed_verification_program(program: &str, working_dir: &std::path::Path) -> bool {
    // 1. Built-in known test runners and build frameworks
    if matches!(
        program,
        "cargo"
            | "pytest"
            | "python"
            | "python3"
            | "go"
            | "npm"
            | "pnpm"
            | "yarn"
            | "npx"
            | "jest"
            | "vitest"
            | "make"
            | "ctest"
            | "cmake"
            | "ninja"
            | "mvn"
            | "gradle"
            | "mix"
            | "dotnet"
            | "deno"
            | "bun"
            | "ruby"
            | "rake"
            | "rspec"
            | "uv"
    ) {
        return true;
    }

    // 2. Project manifest based discovery
    if program == "make" && working_dir.join("Makefile").exists() {
        return true;
    }
    if (program == "mvn" || program == "./mvnw") && working_dir.join("pom.xml").exists() {
        return true;
    }
    if (program == "gradle" || program == "./gradlew")
        && (working_dir.join("build.gradle").exists()
            || working_dir.join("build.gradle.kts").exists())
    {
        return true;
    }

    // 3. Project configuration file (.rivet/config.toml)
    let config_path = working_dir.join(".rivet/config.toml");
    if config_path.exists()
        && let Ok(content) = std::fs::read_to_string(config_path)
        && content.contains(program)
    {
        return true;
    }

    false
}

fn scope_contains_at_revision(outer: &Scope, inner: &Scope) -> bool {
    if outer.repository != inner.repository || outer.revision > inner.revision {
        return false;
    }
    let normalize = |path: &str| {
        path.replace('\\', "/")
            .trim_start_matches("./")
            .trim_matches('/')
            .to_string()
    };
    match (&outer.path_pattern, &inner.path_pattern) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(outer_path), Some(inner_path)) => {
            let outer_path = normalize(outer_path);
            let inner_path = normalize(inner_path);
            outer_path == inner_path
                || outer_path.strip_suffix("/**").is_some_and(|prefix| {
                    inner_path == prefix || inner_path.starts_with(&format!("{prefix}/"))
                })
        }
    }
}

fn parse_report(program: &str, stdout: &str, stderr: &str) -> ParsedTestReport {
    match program {
        "cargo" => CargoTestParser::parse(stdout, stderr),
        "pytest" | "python" | "python3" => PytestParser::parse(stdout, stderr),
        "go" => GoTestParser::parse(stdout, stderr),
        "npm" | "pnpm" | "yarn" | "jest" | "vitest" => JestParser::parse(stdout, stderr),
        _ => CargoTestParser::parse(stdout, stderr),
    }
}
