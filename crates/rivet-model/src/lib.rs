//! # rivet-model (Model Contracts & Gateway)
//!
//! Provides the provider-agnostic ModelBackend trait, CognitiveAction representations,
//! and invocation receipts for compute accounting.

use accp::ActionProposal;
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
}
