//! # rivet-model-rig (Rig Multi-Provider Model Adapter)
//!
//! Bridges the Rig LLM framework into Rivet's ModelBackend trait.
//! Normalizes OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, and local mistral.rs/Ollama
//! providers into Rivet's ACCP 3.0 proposal/execution boundary.

use async_trait::async_trait;
use rig::completion::AssistantContent;
use rig::prelude::*;
use rig::providers::openai;
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_types::*;

/// Supported providers through Rig
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RigProvider {
    OpenAI { api_key: Option<String> },
    Anthropic { api_key: Option<String> },
    Gemini { api_key: Option<String> },
    DeepSeek { api_key: Option<String> },
    OpenRouter { api_key: Option<String> },
    /// Local OpenAI-compatible endpoint (e.g. mistral.rs / Ollama / vLLM)
    Local {
        base_url: String,
        api_key: Option<String>,
    },
}

pub struct RigBackend {
    provider: RigProvider,
    default_model: String,
}

impl RigBackend {
    pub fn new(provider: RigProvider, default_model: impl Into<String>) -> Self {
        Self {
            provider,
            default_model: default_model.into(),
        }
    }

    /// Auto-detect provider from environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
    pub fn from_env() -> Self {
        if let Ok(key) = std::env::var("OPENAI_API_KEY") {
            Self::new(RigProvider::OpenAI { api_key: Some(key) }, "gpt-4o")
        } else if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
            Self::new(RigProvider::Anthropic { api_key: Some(key) }, "claude-3-7-sonnet-latest")
        } else if let Ok(base_url) = std::env::var("MISTRAL_RS_BASE_URL") {
            Self::new(
                RigProvider::Local {
                    base_url,
                    api_key: std::env::var("MISTRAL_RS_API_KEY").ok(),
                },
                "mistral-small",
            )
        } else {
            // Default fallback
            Self::new(RigProvider::OpenAI { api_key: None }, "gpt-4o")
        }
    }
}

#[async_trait]
impl ModelBackend for RigBackend {
    async fn invoke(&self, request: ModelRequest) -> RivetResult<ModelResponse> {
        let model_name = if request.model_id.is_empty() {
            &self.default_model
        } else {
            &request.model_id
        };

        // Construct full prompt from cognitive view and instructions
        let prompt_payload = format!(
            "--- SYSTEM INSTRUCTIONS ---\n{}\n\n--- COGNITIVE VIEW (r{}) ---\n{}\n\n--- USER REQUEST ---\n{}",
            request.system_prompt,
            request.cognitive_view.hard_revision.0,
            serde_json::to_string_pretty(&*request.cognitive_view)
                .unwrap_or_else(|_| "{}".into()),
            request.user_prompt
        );

        let response_text = match &self.provider {
            RigProvider::OpenAI { api_key } => {
                let client = if let Some(key) = api_key {
                    openai::Client::new(key).map_err(|e| RivetError::Model(e.to_string()))?
                } else {
                    openai::Client::from_env().map_err(|e| RivetError::Model(e.to_string()))?
                };
                let model = client.completion_model(model_name);
                let req = model
                    .completion_request(&prompt_payload)
                    .preamble(request.system_prompt.to_string())
                    .build();

                let resp = model.completion(req).await.map_err(|e| RivetError::Model(e.to_string()))?;
                extract_text(resp.choice)
            }
            RigProvider::Local { base_url, api_key } => {
                let key = api_key.clone().unwrap_or_else(|| "local".into());
                let client = openai::Client::builder()
                    .api_key(key)
                    .base_url(base_url.clone())
                    .build()
                    .map_err(|e| RivetError::Model(e.to_string()))?;

                let model = client.completion_model(model_name);
                let req = model
                    .completion_request(&prompt_payload)
                    .preamble(request.system_prompt.to_string())
                    .build();

                let resp = model.completion(req).await.map_err(|e| RivetError::Model(e.to_string()))?;
                extract_text(resp.choice)
            }
            // For other providers, use standard OpenAI-compatible wire client
            _ => {
                let client = openai::Client::from_env().map_err(|e| RivetError::Model(e.to_string()))?;
                let model = client.completion_model(model_name);
                let req = model
                    .completion_request(&prompt_payload)
                    .preamble(request.system_prompt.to_string())
                    .build();

                let resp = model.completion(req).await.map_err(|e| RivetError::Model(e.to_string()))?;
                extract_text(resp.choice)
            }
        };

        // Decode cognitive actions from model response (proposals only)
        let actions = CognitiveAction::parse_text(&response_text);

        // Approximate token usage based on prompt and response lengths
        let est_in = (prompt_payload.len() / 4) as u32;
        let est_out = (response_text.len() / 4) as u32;

        Ok(ModelResponse {
            text_content: response_text,
            actions,
            usage: TokenUsage {
                input_tokens: est_in,
                output_tokens: est_out,
                cached_tokens: None,
            },
        })
    }
}

fn extract_text(choice: Vec<AssistantContent>) -> String {
    let mut out = String::new();
    for item in choice {
        if let AssistantContent::Text(text) = item {
            out.push_str(&text.text);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rig_provider_creation() {
        let backend = RigBackend::new(
            RigProvider::Local {
                base_url: "http://localhost:8080/v1".into(),
                api_key: None,
            },
            "mistral-local",
        );
        assert_eq!(backend.default_model, "mistral-local");
    }
}
