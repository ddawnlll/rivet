pub mod auth;
pub mod provider_hub;

pub use auth::{AuthData, AuthInfo, AuthStore};
pub use provider_hub::{
    KnownProvider, ModelCatalogEntry, ProviderRegistry, ResolvedProviderConfig,
    fetch_remote_models, get_known_providers,
};

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
        let mut results = Vec::new();
        let trimmed = text.trim();

        // 1. Scan for all markdown code blocks (```json ... ``` or ``` ... ```)
        let mut cursor = 0;
        while let Some(open_idx) = trimmed[cursor..].find("```") {
            let start = cursor + open_idx;
            let content_start = if let Some(newline) = trimmed[start..].find('\n') {
                start + newline + 1
            } else if trimmed[start..].starts_with("```json") {
                start + 7
            } else {
                start + 3
            };
            if let Some(close_idx) = trimmed[content_start..].find("```") {
                let end = content_start + close_idx;
                let json_slice = trimmed[content_start..end].trim();
                Self::extract_actions_from_str(json_slice, &mut results);
                cursor = end + 3;
            } else {
                let json_slice = trimmed[content_start..].trim();
                Self::extract_actions_from_str(json_slice, &mut results);
                break;
            }
        }

        // 2. If no actions found from markdown blocks, attempt parsing the full or embedded text
        if results.is_empty() {
            Self::extract_actions_from_str(trimmed, &mut results);
        }

        // 3. If still empty, attempt to find first '{' to last '}'
        if results.is_empty()
            && let (Some(first_brace), Some(last_brace)) = (trimmed.find('{'), trimmed.rfind('}'))
            && first_brace < last_brace
        {
            let candidate = &trimmed[first_brace..=last_brace];
            Self::extract_actions_from_str(candidate, &mut results);
        }

        results
    }

    fn extract_actions_from_str(text_str: &str, results: &mut Vec<Self>) {
        if text_str.is_empty() {
            return;
        }
        let parsed_value: Option<serde_json::Value> = serde_json::from_str(text_str)
            .ok()
            .or_else(|| serde_saphyr::from_str(text_str).ok());

        if let Some(value) = parsed_value {
            let values = value
                .get("actions")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_else(|| vec![value]);
            for val in values {
                if let Ok(action) = Self::from_value(&val) {
                    results.push(action);
                }
            }
        }
    }

    fn from_value(value: &serde_json::Value) -> RivetResult<Self> {
        // 0. Canonical ACCP envelope (single wire contract) — preferred path.
        //    Maps PROPOSAL/* and QUERY/* envelopes to CognitiveAction.
        //    This keeps controller output aligned with ACCP SPEC §9 and Controller Profile.
        if (value.get("accp_version").is_some() || value.get("family").is_some())
            && let Some(canonical) = Self::try_parse_canonical_envelope(value)
        {
            return Ok(canonical);
        }
        // If envelope fields present but parse failed, fall through to legacy error
        let action_type = value
            .get("action_type")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| RivetError::Serialization("missing action_type".into()))?;
        let payload = value
            .get("payload")
            .cloned()
            .ok_or_else(|| RivetError::Serialization("missing action payload".into()))?;
        match action_type {
            "thought" => {
                if let Some(s) = payload.as_str() {
                    Ok(Self::Thought(s.to_string()))
                } else if let Some(s) = payload.get("thought").and_then(|v| v.as_str()) {
                    Ok(Self::Thought(s.to_string()))
                } else {
                    serde_json::from_value(payload)
                        .map(Self::Thought)
                        .map_err(|error| RivetError::Serialization(error.to_string()))
                }
            }
            "tool_call" => {
                if let Ok(proposal) =
                    serde_json::from_value::<accp::ActionProposal>(payload.clone())
                {
                    Ok(Self::ToolCall(proposal))
                } else if let Some(tool_name) = payload
                    .get("tool_name")
                    .or_else(|| payload.get("tool"))
                    .or_else(|| payload.get("name"))
                    .or_else(|| payload.get("capability"))
                    .and_then(|v| v.as_str())
                {
                    // Shorthand normalization for various model representations
                    let capability = match tool_name {
                        "grep" | "search" | "find_in_files" => "code.search",
                        "read" | "cat" | "view" | "open" => "file.read",
                        "write" | "edit" | "save" => "file.write",
                        "list" | "ls" | "dir" => "dir.list",
                        other => other,
                    }
                    .to_string();

                    let args = payload
                        .get("tool_arguments")
                        .or_else(|| payload.get("arguments"))
                        .or_else(|| payload.get("parameters"))
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({}));

                    let target = payload
                        .get("target")
                        .or_else(|| payload.get("file_path"))
                        .or_else(|| payload.get("path"))
                        .or_else(|| payload.get("file"))
                        .or_else(|| args.get("target"))
                        .or_else(|| args.get("file_path"))
                        .or_else(|| args.get("path"))
                        .or_else(|| args.get("file"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(".")
                        .to_string();

                    let mut parameters = if args.is_object() {
                        args.clone()
                    } else {
                        serde_json::json!({})
                    };

                    if capability == "code.search" {
                        if let Some(pattern) = payload
                            .get("pattern")
                            .or_else(|| payload.get("query"))
                            .or_else(|| args.get("pattern"))
                            .or_else(|| args.get("query"))
                        {
                            parameters["query"] = pattern.clone();
                        }
                    } else if capability == "file.write"
                        && let Some(content) = payload
                            .get("content")
                            .or_else(|| payload.get("body"))
                            .or_else(|| args.get("content"))
                            .or_else(|| args.get("body"))
                    {
                        parameters["content"] = content.clone();
                    }

                    let risk = if capability == "file.write" || capability == "semantic.patch" {
                        accp::ActionRisk::Material
                    } else {
                        accp::ActionRisk::Inspect
                    };

                    let intent = payload
                        .get("intent")
                        .or_else(|| payload.get("rationale"))
                        .or_else(|| payload.get("description"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Execute tool")
                        .to_string();

                    let scope = payload
                        .get("scope")
                        .and_then(|v| serde_json::from_value::<Scope>(v.clone()).ok())
                        .unwrap_or_else(|| Scope::global("rivet", Revision(0)));

                    Ok(Self::ToolCall(accp::ActionProposal {
                        action_id: ActionId::new(),
                        capability,
                        target,
                        parameters,
                        estimated_risk: risk,
                        intent,
                        scope,
                        idempotency_key: None,
                        timestamp: chrono::Utc::now(),
                    }))
                } else {
                    serde_json::from_value(payload)
                        .map(Self::ToolCall)
                        .map_err(|error| RivetError::Serialization(error.to_string()))
                }
            }
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

    /// Try canonical ACCP envelope: {accp_version, sender, family, kind, revision, scope, payload}
    /// Maps directly to CognitiveAction without the legacy action_type mini-DSL.
    fn try_parse_canonical_envelope(value: &serde_json::Value) -> Option<Self> {
        let family = value
            .get("family")
            .and_then(|v| v.as_str())
            .map(|s| s.to_uppercase())?;
        let kind = value
            .get("kind")
            .and_then(|v| v.as_str())
            .map(|s| s.to_uppercase())?;
        let payload = value
            .get("payload")
            .cloned()
            .unwrap_or(serde_json::json!({}));
        // Merge top-level revision/scope into payload when inner payload lacks them
        // (canonical spec puts revision/scope at envelope level; inner types also carry scope)
        let enrich_payload = |mut inner: serde_json::Value| -> serde_json::Value {
            if inner.is_object() {
                if let Some(rev) = value.get("revision")
                    && inner.get("revision").is_none()
                    && inner.get("base_revision").is_none()
                {
                    inner["revision"] = rev.clone();
                }
                if let Some(scope) = value.get("scope")
                    && inner.get("scope").is_none()
                    && inner.get("target_scope").is_none()
                {
                    inner["scope"] = scope.clone();
                }
            }
            inner
        };
        match (family.as_str(), kind.as_str()) {
            ("PROPOSAL", "ACTION") => {
                let mut p = enrich_payload(payload.clone());
                // Normalize common LLM hallucinations for canonical ACTION payload
                // e.g. {"action":"file.read", "reason":"..."} vs spec {"capability","intent"}
                if p.get("capability").is_none()
                    && let Some(v) = p
                        .get("action")
                        .or_else(|| p.get("tool"))
                        .or_else(|| p.get("name"))
                        .cloned()
                {
                    p["capability"] = v;
                }
                if p.get("intent").is_none()
                    && let Some(v) = p
                        .get("reason")
                        .or_else(|| p.get("rationale"))
                        .or_else(|| p.get("description"))
                        .cloned()
                {
                    p["intent"] = v;
                }
                if p.get("target").is_none()
                    && let Some(v) = p
                        .get("path")
                        .or_else(|| p.get("file"))
                        .or_else(|| p.get("file_path"))
                        .cloned()
                {
                    p["target"] = v;
                }
                // Inject defaults for required ActionProposal fields if LLM omitted them
                if p.get("action_id").is_none() {
                    p["action_id"] =
                        serde_json::json!(format!("act_{}", rivet_types::ActionId::new()));
                }
                if p.get("parameters").is_none() {
                    p["parameters"] = serde_json::json!({});
                }
                if p.get("estimated_risk").is_none() {
                    let cap = p.get("capability").and_then(|v| v.as_str()).unwrap_or("");
                    let risk = if cap == "file.write" || cap == "semantic.patch" {
                        "material"
                    } else {
                        "inspect"
                    };
                    p["estimated_risk"] = serde_json::json!(risk);
                }
                if p.get("timestamp").is_none() {
                    p["timestamp"] = serde_json::json!(chrono::Utc::now().to_rfc3339());
                }
                // Normalize envelope-level scope/revision aliases: "r0" string, "path" vs "path_pattern"
                let mut scope_val = value
                    .get("scope")
                    .cloned()
                    .or_else(|| p.get("scope").cloned());
                if let Some(scope_obj) = scope_val.as_mut().and_then(|v| v.as_object_mut()) {
                    if scope_obj.get("path_pattern").is_none()
                        && let Some(v) = scope_obj.remove("path")
                    {
                        scope_obj.insert("path_pattern".into(), v);
                    }
                    // revision may be "r0" string or number; normalize to integer
                    if let Some(rev) = scope_obj.get("revision")
                        && let Some(s) = rev.as_str()
                        && let Some(num) = s.strip_prefix('r').and_then(|n| n.parse::<u64>().ok())
                    {
                        scope_obj.insert("revision".into(), serde_json::json!(num));
                    }
                    p["scope"] = serde_json::Value::Object(scope_obj.clone());
                }
                if p.get("scope").is_none() {
                    // Fallback to legacy revision field at envelope top-level
                    if let Some(rev) = value.get("revision") {
                        let rev_num = if let Some(n) = rev.as_u64() {
                            n
                        } else if let Some(s) = rev.as_str() {
                            s.strip_prefix('r')
                                .and_then(|n| n.parse().ok())
                                .unwrap_or(0)
                        } else {
                            0
                        };
                        p["scope"] = serde_json::json!({"repository":"rivet","revision": rev_num});
                    }
                }
                serde_json::from_value::<accp::ActionProposal>(p.clone())
                    .ok()
                    .map(Self::ToolCall)
                    .or_else(|| {
                        // Also support raw capability form inside canonical envelope via legacy path
                        Self::from_value(
                            &serde_json::json!({"action_type":"tool_call","payload":p}),
                        )
                        .ok()
                    })
            }
            ("PROPOSAL", "CLAIM") => {
                serde_json::from_value::<ClaimProposal>(enrich_payload(payload))
                    .ok()
                    .map(Self::ClaimProposal)
            }
            ("PROPOSAL", "WORKSPACE_DELTA") => {
                serde_json::from_value::<HypothesisDeltaPayload>(payload)
                    .ok()
                    .map(|payload| Self::HypothesisDelta {
                        add: payload.add,
                        remove: payload.remove,
                    })
            }
            ("PROPOSAL", "VERIFICATION") => {
                serde_json::from_value::<VerificationRequest>(enrich_payload(payload))
                    .ok()
                    .map(Self::VerificationRequest)
            }
            ("PROPOSAL", "STATE_TRANSITION") => {
                serde_json::from_value::<StateTransitionProposal>(enrich_payload(payload))
                    .ok()
                    .map(Self::StateTransitionProposal)
            }
            ("PROPOSAL", "COMPLETION") => {
                // payload may be {summary} or directly string
                if let Some(s) = payload.get("summary").and_then(|v| v.as_str()) {
                    Some(Self::CompletionRequest {
                        summary: s.to_string(),
                    })
                } else if let Some(s) = payload.as_str() {
                    Some(Self::CompletionRequest {
                        summary: s.to_string(),
                    })
                } else {
                    serde_json::from_value::<CompletionPayload>(payload)
                        .ok()
                        .map(|p| Self::CompletionRequest { summary: p.summary })
                }
            }
            ("QUERY", _) => {
                // Queries are not yet a distinct CognitiveAction; surface as Thought with provenance
                let q = format!("QUERY/{kind}: {}", payload);
                Some(Self::Thought(q))
            }
            _ => None,
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
            // If LLM returned literal JSON null or empty, treat as empty Thought (no hardcode)
            // Let the Harness / TUI decide how to render; do not inject fake greeting.
            // Text content stays as original so provenance is preserved, but TUI will filter "null" display.
            let is_null = text_content.trim() == "null" || text_content.trim() == "\"null\"";
            if is_null || text_content.trim().is_empty() {
                // Keep text_content as empty, push empty Thought so it doesn't become "null" spam
                actions.push(CognitiveAction::Thought(String::new()));
            } else {
                actions.push(CognitiveAction::Thought(text_content.clone()));
            }
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

/// Thread-safe dynamic model backend adapter allowing hot-swapping providers and models at runtime.
#[derive(Clone)]
pub struct DynamicModelBackend {
    inner: Arc<tokio::sync::RwLock<Arc<dyn ModelBackend>>>,
}

impl DynamicModelBackend {
    pub fn new(initial: Arc<dyn ModelBackend>) -> Self {
        Self {
            inner: Arc::new(tokio::sync::RwLock::new(initial)),
        }
    }

    pub async fn set_backend(&self, new_backend: Arc<dyn ModelBackend>) {
        let mut w = self.inner.write().await;
        *w = new_backend;
    }
}

#[async_trait]
impl ModelBackend for DynamicModelBackend {
    async fn invoke(&self, request: ModelRequest) -> RivetResult<ModelResponse> {
        let backend = { self.inner.read().await.clone() };
        backend.invoke(request).await
    }

    async fn stream(&self, request: ModelRequest) -> RivetResult<Vec<String>> {
        let backend = { self.inner.read().await.clone() };
        backend.stream(request).await
    }
}
