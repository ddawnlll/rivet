//! # rivet-model (Model Contracts & Gateway)
//!
//! Provides the provider-agnostic ModelBackend trait, CognitiveAction representations,
//! and invocation receipts for compute accounting.

use accp::{ActionProposal, ClaimProposal, StateTransitionProposal, VerificationRequest};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use noesis::CognitiveView;
use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Concrete cognitive action emitted by the model controller
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action_type", content = "payload", rename_all = "snake_case")]
pub enum CognitiveAction {
    /// Thought / reasoning reflection
    Thought(String),
    /// Proposed tool or capability execution
    ToolCall(ActionProposal),
    /// Proposed addition/mutation to working hypothesis
    HypothesisDelta {
        add: Vec<String>,
        remove: Vec<String>,
    },
    /// Request to complete the task with explanation
    CompletionRequest { summary: String },
    /// Request for Harness/Praxis to execute a bounded verification predicate.
    VerificationRequest(VerificationRequest),
    /// Proposal to add or update a claim; never an authoritative observation.
    ClaimProposal(ClaimProposal),
    /// Proposal to mutate Noesis state at an expected base revision.
    StateTransitionProposal(StateTransitionProposal),
}

impl CognitiveAction {
    /// Decode only typed proposal forms from model output. Unknown or malformed
    /// JSON remains prose and therefore cannot silently gain authority.
    pub fn parse_text(text: &str) -> Vec<Self> {
        let trimmed = text.trim();
        let candidate = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .map(|value| value.trim_end_matches('`').trim())
            .unwrap_or(trimmed);
        let Ok(value) = serde_json::from_str::<serde_json::Value>(candidate) else {
            return Vec::new();
        };

        let values = value
            .get("actions")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_else(|| vec![value]);
        values
            .into_iter()
            .filter_map(|value| Self::from_value(&value).ok())
            .collect()
    }

    fn from_value(value: &serde_json::Value) -> RivetResult<Self> {
        let action_type = value
            .get("action_type")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| RivetError::Serialization("missing action_type".into()))?;
        let payload = value
            .get("payload")
            .cloned()
            .ok_or_else(|| RivetError::Serialization("missing action payload".into()))?;
        match action_type {
            "tool_call" => serde_json::from_value(payload)
                .map(Self::ToolCall)
                .map_err(|error| RivetError::Serialization(error.to_string())),
            "hypothesis_delta" => serde_json::from_value::<HypothesisDeltaPayload>(payload)
                .map(|payload| Self::HypothesisDelta {
                    add: payload.add,
                    remove: payload.remove,
                })
                .map_err(|error| RivetError::Serialization(error.to_string())),
            "completion_request" => serde_json::from_value(payload)
                .map(|payload: CompletionPayload| Self::CompletionRequest {
                    summary: payload.summary,
                })
                .map_err(|error| RivetError::Serialization(error.to_string())),
            "verification_request" => serde_json::from_value(payload)
                .map(Self::VerificationRequest)
                .map_err(|error| RivetError::Serialization(error.to_string())),
            "claim_proposal" => serde_json::from_value(payload)
                .map(Self::ClaimProposal)
                .map_err(|error| RivetError::Serialization(error.to_string())),
            "state_transition_proposal" => serde_json::from_value(payload)
                .map(Self::StateTransitionProposal)
                .map_err(|error| RivetError::Serialization(error.to_string())),
            _ => Err(RivetError::SemanticViolation(format!(
                "unsupported cognitive action type '{action_type}'"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HypothesisDeltaPayload {
    add: Vec<String>,
    remove: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CompletionPayload {
    summary: String,
}

/// Request sent to the active model backend
#[derive(Debug, Clone)]
pub struct ModelRequest {
    pub model_id: String,
    pub system_prompt: Arc<str>,
    pub cognitive_view: Arc<CognitiveView>,
    pub user_prompt: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

/// Response returned from a model backend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelResponse {
    pub text_content: String,
    pub actions: Vec<CognitiveAction>,
    pub usage: TokenUsage,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cached_tokens: Option<u32>,
}

impl ModelResponse {
    pub fn from_text(text_content: impl Into<String>, usage: TokenUsage) -> Self {
        let text_content = text_content.into();
        let mut actions = CognitiveAction::parse_text(&text_content);
        if actions.is_empty() {
            actions.push(CognitiveAction::Thought(text_content.clone()));
        }
        Self {
            text_content,
            actions,
            usage,
        }
    }
}

/// Invocation receipt for verifiable token and latency accounting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvocationReceipt {
    pub receipt_id: ReceiptId,
    pub session_id: SessionId,
    pub model_id: String,
    pub reason: String,
    pub usage: TokenUsage,
    pub latency_ms: u64,
    pub timestamp: DateTime<Utc>,
}

#[async_trait]
pub trait ModelBackend: Send + Sync {
    async fn invoke(&self, request: ModelRequest) -> RivetResult<ModelResponse>;

    /// Streaming boundary. Native streaming backends may override this;
    /// simple providers retain the same semantic contract via one chunk.
    async fn stream(&self, request: ModelRequest) -> RivetResult<Vec<String>> {
        Ok(vec![self.invoke(request).await?.text_content])
    }
}
