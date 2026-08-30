//! # rivet-model-genai (Multi-Provider Model Adapter)
//!
//! Bridges Rivet's ModelBackend trait with the `genai` multi-provider client.

use async_trait::async_trait;
use genai::Client;
use genai::chat::{ChatMessage, ChatOptions, ChatRequest};
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_types::*;

pub struct GenAiBackend {
    client: Client,
}

impl GenAiBackend {
    pub fn new() -> Self {
        Self {
            client: Client::default(),
        }
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

        // Minimal default: wrapped into a thought action until structured tool caller parses it
        let actions = vec![CognitiveAction::Thought(text_content.clone())];

        Ok(ModelResponse {
            text_content,
            actions,
            usage,
        })
    }
}
