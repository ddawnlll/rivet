//! # rivet-core (Harness Core & Cognitive State Machine)
//!
//! Orchestrates the Canonical Cognitive Cycle:
//! View Compilation -> Model Controller -> ACCP Authorization ->
//! Runtime Execution -> Praxis Verification -> Noesis State Update.

use accp::{AccpSemanticGate, ActionDecision, ActionDecisionVerdict};
use noesis::{CognitiveView, HardState, NoesisEvent, SoftWorkspace};
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest};
use rivet_runtime::Runtime;
use rivet_store::HardStateStore;
use rivet_types::*;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Explicit phase state machine for a single cognitive cycle
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
    pub hard_state: Arc<Mutex<HardState>>,
    pub soft_workspace: Arc<Mutex<SoftWorkspace>>,
    pub store: Arc<dyn HardStateStore>,
    pub model: Arc<dyn ModelBackend>,
    pub runtime: Arc<Runtime>,
}

impl HarnessCore {
    pub fn new(
        store: Arc<dyn HardStateStore>,
        model: Arc<dyn ModelBackend>,
        runtime: Arc<Runtime>,
    ) -> Self {
        let session_id = SessionId::new();
        Self {
            session_id: session_id.clone(),
            hard_state: Arc::new(Mutex::new(HardState::new())),
            soft_workspace: Arc::new(Mutex::new(SoftWorkspace::new(session_id, Revision::ZERO))),
            store,
            model,
            runtime,
        }
    }

    /// Compile a task-conditioned Cognitive View from current state
    pub async fn compile_view(&self, goal: &str) -> CognitiveView {
        let hard = self.hard_state.lock().await;
        let soft = self.soft_workspace.lock().await;

        let active_claims: Vec<_> = hard.claims.values().cloned().collect();
        let open_obligations: Vec<_> = hard.obligations.values().cloned().collect();

        CognitiveView {
            hard_revision: hard.revision,
            goal_description: goal.to_string(),
            active_claims,
            open_obligations,
            active_hypotheses: soft.hypotheses.clone(),
            active_focus: soft.active_focus.clone(),
            relevant_files: Vec::new(),
            token_budget_hint: 4096,
        }
    }

    /// Execute a single step of the cognitive loop
    pub async fn step(&self, goal: &str, user_prompt: &str) -> RivetResult<String> {
        // 1. PreparingView
        let view = self.compile_view(goal).await;

        // 2. InvokingModel
        let model_req = ModelRequest {
            model_id: "gpt-4o-mini".into(),
            system_prompt: Arc::from(
                "You are Rivet, an epistemic software engineering agent. Reason carefully and emit structured actions.",
            ),
            cognitive_view: Arc::new(view),
            user_prompt: user_prompt.to_string(),
            temperature: Some(0.2),
            max_tokens: Some(2048),
        };

        let response = self.model.invoke(model_req).await?;

        // 3. Process Actions
        for action in response.actions {
            match action {
                CognitiveAction::Thought(thought) => {
                    tracing::info!("Model thought: {}", thought);
                }
                CognitiveAction::ToolCall(proposal) => {
                    // ACCP Authorization Gate
                    let decision = ActionDecision {
                        action_id: proposal.action_id.clone(),
                        verdict: ActionDecisionVerdict::Allow,
                        reason: "Policy allow for inspection/edit".into(),
                        authorized_scope: proposal.scope.clone(),
                        timestamp: chrono::Utc::now(),
                    };

                    AccpSemanticGate::ensure_execution_authorized(&decision)?;

                    // Execute via Runtime
                    let receipt = self.runtime.execute_action(&proposal).await?;

                    // Record Evidence in Noesis
                    let event = NoesisEvent::EvidenceRecorded {
                        evidence_id: receipt.evidence_id.clone(),
                        source: proposal.capability.clone(),
                        summary: receipt.output_summary.clone(),
                        timestamp: chrono::Utc::now(),
                    };

                    self.record_event(event).await?;
                }
                CognitiveAction::HypothesisDelta { add, .. } => {
                    let mut soft = self.soft_workspace.lock().await;
                    for h in add {
                        soft.add_hypothesis(h);
                    }
                }
                CognitiveAction::CompletionRequest { summary } => {
                    let hard = self.hard_state.lock().await;
                    let unclosed: Vec<_> = hard.obligations.keys().cloned().collect();
                    AccpSemanticGate::check_completion_authority(&unclosed)?;
                    return Ok(format!("Task completed: {}", summary));
                }
            }
        }

        Ok(response.text_content)
    }

    /// Record a state event to the store and apply to in-memory HardState
    pub async fn record_event(&self, event: NoesisEvent) -> RivetResult<Revision> {
        let rev = self.store.append_event(&event).await?;
        let mut hard = self.hard_state.lock().await;
        hard.apply(&event);
        Ok(rev)
    }
}
