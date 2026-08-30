//! # rivet-model-genai (Multi-Provider Model Adapter)
//!
//! Bridges Rivet's ModelBackend trait with the `genai` multi-provider client.

use async_trait::async_trait;
use genai::adapter::AdapterKind;
use genai::chat::{ChatMessage, ChatOptions, ChatRequest};
use genai::resolver::{AuthData, Endpoint};
use genai::{Client, ServiceTarget};
use rivet_model::{ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_types::*;

pub struct GenAiBackend {
    client: Client,
}

impl GenAiBackend {
    pub fn new() -> Self {
        if std::env::var_os("OPENCODE_API_KEY").is_some()
            || std::env::var_os("OPENCODE_ZEN_API_KEY").is_some()
        {
            Self::with_opencode_zen()
        } else {
            Self {
                client: Client::default(),
            }
        }
    }

    /// Configure an OpenAI-compatible endpoint such as OpenCode Zen/Go.
    /// `base_url` must end at the provider API root; genai appends
    /// `chat/completions`.
    pub fn with_endpoint(base_url: impl Into<String>, api_key_env: impl Into<String>) -> Self {
        let base_url = base_url.into();
        let api_key_env = api_key_env.into();
        let client = Client::builder()
            .with_service_target_resolver_fn(move |mut target: ServiceTarget| {
                target.endpoint = Endpoint::from_owned(base_url.clone());
                target.auth = AuthData::from_env(api_key_env.clone());
                target.model.adapter_kind = AdapterKind::OpenAI;
                Ok(target)
            })
            .build();
        Self { client }
    }

    pub fn with_opencode_zen() -> Self {
        let key_env = if std::env::var_os("OPENCODE_API_KEY").is_some() {
            "OPENCODE_API_KEY"
        } else {
            "OPENCODE_ZEN_API_KEY"
        };
        Self::with_endpoint("https://opencode.ai/zen/go/v1/", key_env)
    }
}

impl Default for GenAiBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ModelBackend for GenAiBackend {
    async fn invoke(&self, request: ModelRequest) -> RivetResult<ModelResponse> {
        let chat_req = ChatRequest::new(vec![
            ChatMessage::system(request.system_prompt.to_string()),
            ChatMessage::user(format!(
                "{}\n\nUser Request: {}",
                request.cognitive_view.format_prompt_block(),
                request.user_prompt
            )),
        ]);

        let mut chat_options = ChatOptions::default();
        if let Some(t) = request.temperature {
            chat_options = chat_options.with_temperature(t as f64);
        }
        if let Some(max_tokens) = request.max_tokens {
            chat_options = chat_options.with_max_tokens(max_tokens);
        }

        let resp = self
            .client
            .exec_chat(&request.model_id, chat_req, Some(&chat_options))
            .await
            .map_err(|e| RivetError::Model(e.to_string()))?;

        let usage = TokenUsage {
            input_tokens: resp.usage.prompt_tokens.unwrap_or(0) as u32,
            output_tokens: resp.usage.completion_tokens.unwrap_or(0) as u32,
            cached_tokens: None,
        };

        let text_content = resp.content_text_into_string().unwrap_or_default();
        // Keep the adapter's mapping explicit: provider output is only a
        // controller proposal, never an execution/verification receipt.
        Ok(ModelResponse::from_text(text_content, usage))
    }
}
