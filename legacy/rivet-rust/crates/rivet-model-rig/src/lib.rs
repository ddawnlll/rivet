//! # rivet-model-rig (Rig Multi-Provider Model Adapter)
//!
//! Bridges the Rig LLM framework into Rivet's ModelBackend trait.
//! Normalizes OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, and local mistral.rs/Ollama
//! providers into Rivet's ACCP 3.0 proposal/execution boundary.

use async_trait::async_trait;
use rig::completion::AssistantContent;
use rig::prelude::*;
use rig::providers::{anthropic, openai};
use rivet_model::provider_hub::ResolvedProviderConfig;
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_types::*;

/// Supported providers through Rig
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RigProvider {
    OpenAI {
        api_key: Option<String>,
        base_url: Option<String>,
    },
    Anthropic {
        api_key: Option<String>,
    },
    Gemini {
        api_key: Option<String>,
    },
    DeepSeek {
        api_key: Option<String>,
    },
    OpenRouter {
        api_key: Option<String>,
    },
    /// Local or custom OpenAI-compatible endpoint (e.g. mistral.rs / Ollama / vLLM)
    Local {
        base_url: String,
        api_key: Option<String>,
    },
    /// Mock provider for testing and deterministic offline evaluation
    Mock,
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

    /// Construct backend from a resolved OpenCode-style ProviderConfig
    pub fn from_resolved(config: &ResolvedProviderConfig) -> Self {
        let provider = match config.provider.to_lowercase().as_str() {
            "mock" => RigProvider::Mock,
            "anthropic" | "claude" => RigProvider::Anthropic {
                api_key: config.api_key.clone(),
            },
            "gemini" | "google" => RigProvider::Gemini {
                api_key: config.api_key.clone(),
            },
            "deepseek" => RigProvider::DeepSeek {
                api_key: config.api_key.clone(),
            },
            "openrouter" => RigProvider::OpenRouter {
                api_key: config.api_key.clone(),
            },
            "opencode" | "opencode-go" | "opencode_go" => RigProvider::OpenAI {
                api_key: config.api_key.clone(),
                base_url: config
                    .base_url
                    .clone()
                    .or_else(|| Some("https://opencode.ai/zen/go/v1".into())),
            },
            "ollama" | "local" | "mistral-rs" => RigProvider::Local {
                base_url: config
                    .base_url
                    .clone()
                    .unwrap_or_else(|| "http://localhost:11434/v1".into()),
                api_key: config.api_key.clone(),
            },
            _ => RigProvider::OpenAI {
                api_key: config.api_key.clone(),
                base_url: config.base_url.clone(),
            },
        };

        Self::new(provider, config.model_id.clone())
    }

    /// Auto-detect provider from environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
    pub fn from_env() -> Self {
        if let Ok(key) = std::env::var("OPENAI_API_KEY") {
            Self::new(
                RigProvider::OpenAI {
                    api_key: Some(key),
                    base_url: None,
                },
                "gpt-4o",
            )
        } else if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
            Self::new(
                RigProvider::Anthropic { api_key: Some(key) },
                "claude-3-7-sonnet-latest",
            )
        } else if let Ok(key) = std::env::var("DEEPSEEK_API_KEY") {
            Self::new(
                RigProvider::DeepSeek { api_key: Some(key) },
                "deepseek-chat",
            )
        } else if let Ok(key) =
            std::env::var("GEMINI_API_KEY").or_else(|_| std::env::var("GOOGLE_API_KEY"))
        {
            Self::new(
                RigProvider::Gemini { api_key: Some(key) },
                "gemini-2.0-flash",
            )
        } else if let Ok(base_url) =
            std::env::var("MISTRAL_RS_BASE_URL").or_else(|_| std::env::var("OLLAMA_HOST"))
        {
            Self::new(
                RigProvider::Local {
                    base_url,
                    api_key: std::env::var("MISTRAL_RS_API_KEY").ok(),
                },
                "qwen2.5-coder:7b",
            )
        } else {
            // Default fallback
            Self::new(
                RigProvider::OpenAI {
                    api_key: None,
                    base_url: None,
                },
                "gpt-4o",
            )
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
            "<workspace_context>\n{}\n</workspace_context>\n\nUser Request: {}\n(Instruction: You MUST reply entirely in the exact language used by the user. If the user wrote in Turkish, answer 100% in Turkish without switching to English. Answer naturally in Markdown and do not recite raw internal IDs like oblg_... or rN.)",
            request.cognitive_view.format_prompt_block(),
            request.user_prompt
        );

        let provider = self.provider.clone();
        let sys_prompt = request.system_prompt.to_string();
        let prompt = prompt_payload.clone();
        let m_name = model_name.to_string();

        let response_text = retry_call(3, 500, || {
            let p = provider.clone();
            let sys = sys_prompt.clone();
            let p_load = prompt.clone();
            let m = m_name.clone();
            async move {
                match &p {
                    RigProvider::OpenAI { api_key, base_url } => {
                        let client = if let Some(base) = base_url {
                            let key = api_key.clone().unwrap_or_else(|| "none".into());
                            openai::Client::builder()
                                .api_key(key)
                                .base_url(base.clone())
                                .build()
                                .map_err(|e| RivetError::Model(e.to_string()))?
                        } else if let Some(key) = api_key {
                            openai::Client::new(key)
                                .map_err(|e| RivetError::Model(e.to_string()))?
                        } else {
                            openai::Client::from_env()
                                .map_err(|e| RivetError::Model(e.to_string()))?
                        };
                        let model = client.completion_model(&m);
                        let req = model.completion_request(&p_load).preamble(sys).build();

                        let resp = model
                            .completion(req)
                            .await
                            .map_err(|e| RivetError::Model(e.to_string()))?;
                        Ok(extract_text(resp.choice))
                    }
                    RigProvider::DeepSeek { api_key } => {
                        let key = api_key
                            .clone()
                            .or_else(|| std::env::var("DEEPSEEK_API_KEY").ok())
                            .unwrap_or_default();
                        let client = openai::Client::builder()
                            .api_key(key)
                            .base_url("https://api.deepseek.com/v1")
                            .build()
                            .map_err(|e| RivetError::Model(e.to_string()))?;
                        let model = client.completion_model(&m);
                        let req = model.completion_request(&p_load).preamble(sys).build();

                        let resp = model
                            .completion(req)
                            .await
                            .map_err(|e| RivetError::Model(e.to_string()))?;
                        Ok(extract_text(resp.choice))
                    }
                    RigProvider::OpenRouter { api_key } => {
                        let key = api_key
                            .clone()
                            .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
                            .unwrap_or_default();
                        let client = openai::Client::builder()
                            .api_key(key)
                            .base_url("https://openrouter.ai/api/v1")
                            .build()
                            .map_err(|e| RivetError::Model(e.to_string()))?;
                        let model = client.completion_model(&m);
                        let req = model.completion_request(&p_load).preamble(sys).build();

                        let resp = model
                            .completion(req)
                            .await
                            .map_err(|e| RivetError::Model(e.to_string()))?;
                        Ok(extract_text(resp.choice))
                    }
                    RigProvider::Gemini { api_key } => {
                        let key = api_key
                            .clone()
                            .or_else(|| std::env::var("GEMINI_API_KEY").ok())
                            .or_else(|| std::env::var("GOOGLE_API_KEY").ok())
                            .unwrap_or_default();
                        let client = openai::Client::builder()
                            .api_key(key)
                            .base_url("https://generativelanguage.googleapis.com/v1beta/openai")
                            .build()
                            .map_err(|e| RivetError::Model(e.to_string()))?;
                        let model = client.completion_model(&m);
                        let req = model.completion_request(&p_load).preamble(sys).build();

                        let resp = model
                            .completion(req)
                            .await
                            .map_err(|e| RivetError::Model(e.to_string()))?;
                        Ok(extract_text(resp.choice))
                    }
                    RigProvider::Local { base_url, api_key } => {
                        let key = api_key.clone().unwrap_or_else(|| "local".into());
                        let client = openai::Client::builder()
                            .api_key(key)
                            .base_url(base_url.clone())
                            .build()
                            .map_err(|e| RivetError::Model(e.to_string()))?;

                        let model = client.completion_model(&m);
                        let req = model.completion_request(&p_load).preamble(sys).build();

                        let resp = model
                            .completion(req)
                            .await
                            .map_err(|e| RivetError::Model(e.to_string()))?;
                        Ok(extract_text(resp.choice))
                    }
                    RigProvider::Anthropic { api_key } => {
                        let client = if let Some(key) = api_key {
                            anthropic::Client::new(key.clone())
                                .map_err(|e| RivetError::Model(e.to_string()))?
                        } else {
                            anthropic::Client::from_env()
                                .map_err(|e| RivetError::Model(e.to_string()))?
                        };
                        let model = client.completion_model(&m);
                        let req = model
                            .completion_request(&p_load)
                            .preamble(sys)
                            .max_tokens(2048)
                            .build();

                        let resp = model
                            .completion(req)
                            .await
                            .map_err(|e| RivetError::Model(e.to_string()))?;
                        Ok(extract_text(resp.choice))
                    }
                    RigProvider::Mock => Ok("Step completed successfully".to_string()),
                }
            }
        })
        .await?;

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

async fn retry_call<F, Fut, T>(
    max_retries: usize,
    initial_delay_ms: u64,
    mut op: F,
) -> RivetResult<T>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = RivetResult<T>>,
{
    let mut delay = initial_delay_ms;
    let mut attempts = 0;
    loop {
        attempts += 1;
        match op().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                let err_str = e.to_string();
                let is_transient = err_str.contains("429")
                    || err_str.contains("rate limit")
                    || err_str.contains("RateLimit")
                    || err_str.contains("500")
                    || err_str.contains("502")
                    || err_str.contains("503")
                    || err_str.contains("504")
                    || err_str.contains("overloaded")
                    || err_str.contains("timeout")
                    || err_str.contains("connection reset");
                if is_transient && attempts <= max_retries {
                    tracing::warn!(
                        attempt = attempts,
                        max_retries,
                        delay_ms = delay,
                        error = %err_str,
                        "Retrying LLM invocation"
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                    delay = (delay * 2).min(10_000);
                } else {
                    return Err(e);
                }
            }
        }
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

    #[test]
    fn test_rig_from_resolved_config() {
        let cfg = ResolvedProviderConfig {
            provider: "deepseek".into(),
            model_id: "deepseek-chat".into(),
            api_key: Some("sk-ds-12345".into()),
            base_url: None,
        };
        let backend = RigBackend::from_resolved(&cfg);
        assert_eq!(backend.default_model, "deepseek-chat");
    }

    #[test]
    fn test_rig_from_resolved_anthropic() {
        let cfg = ResolvedProviderConfig {
            provider: "anthropic".into(),
            model_id: "claude-3-7-sonnet-latest".into(),
            api_key: Some("sk-ant-test".into()),
            base_url: None,
        };
        let backend = RigBackend::from_resolved(&cfg);
        assert_eq!(backend.default_model, "claude-3-7-sonnet-latest");
        assert!(matches!(
            backend.provider,
            RigProvider::Anthropic { api_key } if api_key.as_deref() == Some("sk-ant-test")
        ));
    }
}
