//! # rivet-model::provider_hub
//!
//! Unified Provider Registry & Model Catalog ported 1-to-1 from OpenCode.
//! Supports all OpenCode predefined providers (OpenAI, Anthropic, Gemini, DeepSeek,
//! OpenRouter, Groq, xAI, Mistral, Together AI, Cerebras, DeepInfra, Cohere,
//! Perplexity, Alibaba DashScope, NVIDIA NIM, Ollama, Azure, Bedrock, Vertex,
//! Cloudflare, Copilot, GitLab Duo, Venice, OpenCode Zen, Custom Endpoint).
//! Supports dynamic endpoint discovery (/v1/models & /api/tags), custom provider addition,
//! and OpenCode-style configuration resolution.

use crate::auth::{normalize_provider_id, AuthStore};
use crate::RivetResult;
use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Metadata for standard well-known providers ported from OpenCode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownProvider {
    pub id: String,
    pub name: String,
    pub default_base_url: Option<String>,
    pub env_vars: Vec<String>,
    pub default_model: String,
    pub description: String,
    pub standard_models: Vec<String>,
    pub requires_api_key: bool,
    pub is_popular: bool,
}

pub fn get_known_providers() -> Vec<KnownProvider> {
    vec![
        KnownProvider {
            id: "openai".into(),
            name: "OpenAI".into(),
            default_base_url: Some("https://api.openai.com/v1".into()),
            env_vars: vec!["OPENAI_API_KEY".into()],
            default_model: "gpt-4o".into(),
            description: "ChatGPT Plus/Pro or API key".into(),
            standard_models: vec![
                "gpt-4o".into(),
                "gpt-4o-mini".into(),
                "o3-mini".into(),
                "o1".into(),
                "gpt-4-turbo".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "anthropic".into(),
            name: "Anthropic Claude".into(),
            default_base_url: Some("https://api.anthropic.com/v1".into()),
            env_vars: vec!["ANTHROPIC_API_KEY".into()],
            default_model: "claude-3-7-sonnet-latest".into(),
            description: "State-of-the-art coding & reasoning".into(),
            standard_models: vec![
                "claude-3-7-sonnet-latest".into(),
                "claude-3-5-sonnet-latest".into(),
                "claude-3-5-haiku-latest".into(),
                "claude-3-opus-latest".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "gemini".into(),
            name: "Google Gemini".into(),
            default_base_url: Some("https://generativelanguage.googleapis.com/v1beta/openai".into()),
            env_vars: vec!["GEMINI_API_KEY".into(), "GOOGLE_API_KEY".into()],
            default_model: "gemini-2.0-flash".into(),
            description: "Next-gen speed, reasoning & 2M context".into(),
            standard_models: vec![
                "gemini-2.0-flash".into(),
                "gemini-1.5-pro".into(),
                "gemini-2.0-pro-exp-02-05".into(),
                "gemini-1.5-flash".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "deepseek".into(),
            name: "DeepSeek".into(),
            default_base_url: Some("https://api.deepseek.com/v1".into()),
            env_vars: vec!["DEEPSEEK_API_KEY".into()],
            default_model: "deepseek-chat".into(),
            description: "DeepSeek V3 / R1 reasoning MoE".into(),
            standard_models: vec![
                "deepseek-chat".into(),
                "deepseek-reasoner".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "openrouter".into(),
            name: "OpenRouter".into(),
            default_base_url: Some("https://openrouter.ai/api/v1".into()),
            env_vars: vec!["OPENROUTER_API_KEY".into()],
            default_model: "anthropic/claude-3.7-sonnet".into(),
            description: "Universal multi-model API gateway".into(),
            standard_models: vec![
                "anthropic/claude-3.7-sonnet".into(),
                "openai/gpt-4o".into(),
                "deepseek/deepseek-r1".into(),
                "google/gemini-2.0-flash-001".into(),
                "meta-llama/llama-3.3-70b-instruct".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "groq".into(),
            name: "Groq".into(),
            default_base_url: Some("https://api.groq.com/openai/v1".into()),
            env_vars: vec!["GROQ_API_KEY".into()],
            default_model: "llama-3.3-70b-versatile".into(),
            description: "Ultra-fast LPU inference".into(),
            standard_models: vec![
                "llama-3.3-70b-versatile".into(),
                "deepseek-r1-distill-llama-70b".into(),
                "llama-3.1-8b-instant".into(),
                "mixtral-8x7b-32768".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "xai".into(),
            name: "xAI Grok".into(),
            default_base_url: Some("https://api.x.ai/v1".into()),
            env_vars: vec!["XAI_API_KEY".into()],
            default_model: "grok-2-latest".into(),
            description: "xAI frontier reasoning and coding models".into(),
            standard_models: vec![
                "grok-2-latest".into(),
                "grok-2-vision-latest".into(),
                "grok-beta".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "mistral".into(),
            name: "Mistral AI".into(),
            default_base_url: Some("https://api.mistral.ai/v1".into()),
            env_vars: vec!["MISTRAL_API_KEY".into()],
            default_model: "codestral-latest".into(),
            description: "Specialized European frontier models".into(),
            standard_models: vec![
                "codestral-latest".into(),
                "mistral-large-latest".into(),
                "mistral-small-latest".into(),
                "pixtral-large-latest".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "togetherai".into(),
            name: "Together AI".into(),
            default_base_url: Some("https://api.together.xyz/v1".into()),
            env_vars: vec!["TOGETHER_API_KEY".into(), "TOGETHERAI_API_KEY".into()],
            default_model: "meta-llama/Llama-3.3-70B-Instruct-Turbo".into(),
            description: "Fast cloud open-source model inference".into(),
            standard_models: vec![
                "meta-llama/Llama-3.3-70B-Instruct-Turbo".into(),
                "deepseek-ai/DeepSeek-R1".into(),
                "Qwen/Qwen2.5-Coder-32B-Instruct".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "cerebras".into(),
            name: "Cerebras".into(),
            default_base_url: Some("https://api.cerebras.ai/v1".into()),
            env_vars: vec!["CEREBRAS_API_KEY".into()],
            default_model: "llama3.3-70b".into(),
            description: "Ultra-fast CS-3 wafer scale inference".into(),
            standard_models: vec![
                "llama3.3-70b".into(),
                "llama3.1-8b".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "deepinfra".into(),
            name: "DeepInfra".into(),
            default_base_url: Some("https://api.deepinfra.com/v1/openai".into()),
            env_vars: vec!["DEEPINFRA_API_KEY".into()],
            default_model: "meta-llama/Llama-3.3-70B-Instruct".into(),
            description: "Cost-efficient serverless model hosting".into(),
            standard_models: vec![
                "meta-llama/Llama-3.3-70B-Instruct".into(),
                "deepseek-ai/DeepSeek-V3".into(),
                "deepseek-ai/DeepSeek-R1".into(),
                "Qwen/Qwen2.5-Coder-32B-Instruct".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "cohere".into(),
            name: "Cohere".into(),
            default_base_url: Some("https://api.cohere.com/v2".into()),
            env_vars: vec!["COHERE_API_KEY".into()],
            default_model: "command-r-plus".into(),
            description: "Enterprise search, RAG, and reasoning".into(),
            standard_models: vec![
                "command-r-plus".into(),
                "command-r".into(),
                "command-light".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "perplexity".into(),
            name: "Perplexity".into(),
            default_base_url: Some("https://api.perplexity.ai".into()),
            env_vars: vec!["PERPLEXITY_API_KEY".into()],
            default_model: "sonar-pro".into(),
            description: "Real-time web search and citation reasoning".into(),
            standard_models: vec![
                "sonar-pro".into(),
                "sonar".into(),
                "sonar-reasoning".into(),
                "sonar-reasoning-pro".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "alibaba".into(),
            name: "Alibaba DashScope".into(),
            default_base_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1".into()),
            env_vars: vec!["DASHSCOPE_API_KEY".into(), "ALIBABA_API_KEY".into()],
            default_model: "qwen2.5-coder-32b-instruct".into(),
            description: "Alibaba frontier Qwen models".into(),
            standard_models: vec![
                "qwen2.5-coder-32b-instruct".into(),
                "qwen2.5-72b-instruct".into(),
                "qwen-max".into(),
                "qwen-plus".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "nvidia".into(),
            name: "NVIDIA NIM".into(),
            default_base_url: Some("https://integrate.api.nvidia.com/v1".into()),
            env_vars: vec!["NVIDIA_API_KEY".into()],
            default_model: "meta/llama-3.3-70b-instruct".into(),
            description: "Accelerated GPU-optimized model catalog".into(),
            standard_models: vec![
                "meta/llama-3.3-70b-instruct".into(),
                "deepseek-ai/deepseek-r1".into(),
                "nvidia/llama-3.1-nemotron-70b-instruct".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "ollama".into(),
            name: "Ollama (Local)".into(),
            default_base_url: Some("http://localhost:11434/v1".into()),
            env_vars: vec!["OLLAMA_HOST".into(), "OLLAMA_API_URL".into()],
            default_model: "qwen2.5-coder:7b".into(),
            description: "Local open weights runner on your machine".into(),
            standard_models: vec![
                "qwen2.5-coder:7b".into(),
                "llama3.3:70b".into(),
                "deepseek-r1:14b".into(),
                "mistral:7b".into(),
            ],
            requires_api_key: false,
            is_popular: true,
        },
        KnownProvider {
            id: "azure".into(),
            name: "Azure OpenAI".into(),
            default_base_url: None,
            env_vars: vec!["AZURE_OPENAI_API_KEY".into(), "AZURE_API_KEY".into()],
            default_model: "gpt-4o".into(),
            description: "Microsoft Azure Enterprise OpenAI Service".into(),
            standard_models: vec![
                "gpt-4o".into(),
                "gpt-4o-mini".into(),
                "o1-mini".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "amazon-bedrock".into(),
            name: "Amazon Bedrock".into(),
            default_base_url: None,
            env_vars: vec!["AWS_ACCESS_KEY_ID".into(), "AWS_SECRET_ACCESS_KEY".into()],
            default_model: "anthropic.claude-3-7-sonnet-20250219-v1:0".into(),
            description: "AWS managed foundation model service".into(),
            standard_models: vec![
                "anthropic.claude-3-7-sonnet-20250219-v1:0".into(),
                "anthropic.claude-3-5-sonnet-20241022-v2:0".into(),
                "meta.llama3-3-70b-instruct-v1:0".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "google-vertex".into(),
            name: "Google Vertex AI".into(),
            default_base_url: None,
            env_vars: vec!["GOOGLE_APPLICATION_CREDENTIALS".into(), "VERTEX_API_KEY".into()],
            default_model: "gemini-2.0-flash".into(),
            description: "Google Cloud Enterprise Vertex AI Platform".into(),
            standard_models: vec![
                "gemini-2.0-flash".into(),
                "gemini-1.5-pro".into(),
                "claude-3-7-sonnet@20250219".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "cloudflare-workers-ai".into(),
            name: "Cloudflare Workers AI".into(),
            default_base_url: None,
            env_vars: vec!["CLOUDFLARE_API_KEY".into(), "CLOUDFLARE_API_TOKEN".into()],
            default_model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast".into(),
            description: "Serverless edge GPU inference on Cloudflare".into(),
            standard_models: vec![
                "@cf/meta/llama-3.3-70b-instruct-fp8-fast".into(),
                "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "github-copilot".into(),
            name: "GitHub Copilot".into(),
            default_base_url: Some("https://api.githubcopilot.com".into()),
            env_vars: vec!["GITHUB_COPILOT_TOKEN".into(), "GITHUB_TOKEN".into()],
            default_model: "gpt-4o".into(),
            description: "GitHub Copilot individual/business subscription".into(),
            standard_models: vec![
                "gpt-4o".into(),
                "claude-3.5-sonnet".into(),
                "o3-mini".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "gitlab".into(),
            name: "GitLab Duo".into(),
            default_base_url: Some("https://gitlab.com/api/v4/ai/llm".into()),
            env_vars: vec!["GITLAB_TOKEN".into(), "GITLAB_API_KEY".into()],
            default_model: "duo-chat".into(),
            description: "GitLab Duo AI developer platform".into(),
            standard_models: vec![
                "duo-chat".into(),
                "code-suggestions".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "venice".into(),
            name: "Venice AI".into(),
            default_base_url: Some("https://api.venice.ai/api/v1".into()),
            env_vars: vec!["VENICE_API_KEY".into()],
            default_model: "llama-3.3-70b".into(),
            description: "Privacy-first uncensored AI inference".into(),
            standard_models: vec![
                "llama-3.3-70b".into(),
                "deepseek-r1-llama-70b".into(),
                "qwen-2.5-coder-32b".into(),
            ],
            requires_api_key: true,
            is_popular: false,
        },
        KnownProvider {
            id: "opencode".into(),
            name: "OpenCode Zen".into(),
            default_base_url: Some("https://opencode.ai/zen/go/v1".into()),
            env_vars: vec!["OPENCODE_API_KEY".into(), "OPENCODE_ZEN_API_KEY".into()],
            default_model: "muse-spark-1.2-contributor-free".into(),
            description: "OpenCode community developer models".into(),
            standard_models: vec![
                "muse-spark-1.2-contributor-free".into(),
            ],
            requires_api_key: true,
            is_popular: true,
        },
        KnownProvider {
            id: "custom".into(),
            name: "Custom OpenAI-compatible Endpoint".into(),
            default_base_url: Some("http://localhost:8000/v1".into()),
            env_vars: vec!["CUSTOM_API_KEY".into()],
            default_model: "default".into(),
            description: "Connect any custom vLLM, LMStudio, LocalAI, or gateway".into(),
            standard_models: vec!["default".into()],
            requires_api_key: false,
            is_popular: false,
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCatalogEntry {
    pub provider: String,
    pub model_id: String,
    pub display_name: String,
    pub description: String,
    pub is_custom: bool,
}

/// Dynamic Model discovery from standard OpenAI-compatible `/v1/models` and Ollama endpoints
pub async fn fetch_remote_models(base_url: &str, api_key: Option<&str>) -> RivetResult<Vec<String>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| RivetError::Model(e.to_string()))?;

    let clean_base = base_url.trim_end_matches('/');
    let url = if clean_base.ends_with("/v1") {
        format!("{}/models", clean_base)
    } else {
        format!("{}/v1/models", clean_base)
    };

    let mut req = client.get(&url);
    if let Some(key) = api_key
        && !key.trim().is_empty()
        && key != "none"
    {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| RivetError::Model(format!("Failed to connect to model endpoint {url}: {e}")))?;

    if !resp.status().is_success() {
        // Fallback for native Ollama /api/tags if /v1/models is not supported
        let ollama_tags_url = format!("{}/api/tags", clean_base);
        if let Ok(tags_resp) = client.get(&ollama_tags_url).send().await
            && tags_resp.status().is_success()
            && let Ok(json) = tags_resp.json::<serde_json::Value>().await
            && let Some(models) = json.get("models").and_then(|m| m.as_array())
        {
            let ids: Vec<String> = models
                .iter()
                .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(str::to_string))
                .collect();
            if !ids.is_empty() {
                return Ok(ids);
            }
        }

        return Err(RivetError::Model(format!(
            "Model discovery endpoint returned status {}",
            resp.status()
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| RivetError::Model(format!("Failed to parse model list JSON: {e}")))?;

    let mut model_ids = Vec::new();
    if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|s| s.as_str()) {
                model_ids.push(id.to_string());
            }
        }
    } else if let Some(models) = json.get("models").and_then(|m| m.as_array()) {
        for item in models {
            if let Some(name) = item.get("name").and_then(|s| s.as_str()) {
                model_ids.push(name.to_string());
            }
        }
    }

    model_ids.sort();
    Ok(model_ids)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedProviderConfig {
    pub provider: String,
    pub model_id: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

pub struct ProviderRegistry;

impl ProviderRegistry {
    /// Resolve provider and model based on hierarchy:
    /// 1. Explicit arguments
    /// 2. Active selection / stored credentials in AuthStore
    /// 3. Ambient environment variables
    /// 4. Sensible local defaults
    pub fn resolve(
        requested_provider: Option<&str>,
        requested_model: Option<&str>,
        auth_store: &AuthStore,
    ) -> RivetResult<ResolvedProviderConfig> {
        let auth_data = auth_store.load().unwrap_or_default();
        let known_list = get_known_providers();

        // 1. Determine Provider ID
        let provider_name = if let Some(p) = requested_provider {
            normalize_provider_id(p)
        } else if let Ok(env_p) = std::env::var("RIVET_PROVIDER") {
            normalize_provider_id(&env_p)
        } else if let Some(ref active) = auth_data.active_provider {
            active.clone()
        } else if let Some(first_saved) = auth_data.providers.keys().next() {
            first_saved.clone()
        } else if std::env::var("OPENAI_API_KEY").is_ok() {
            "openai".into()
        } else if std::env::var("ANTHROPIC_API_KEY").is_ok() {
            "anthropic".into()
        } else if std::env::var("GEMINI_API_KEY").is_ok() || std::env::var("GOOGLE_API_KEY").is_ok() {
            "gemini".into()
        } else if std::env::var("DEEPSEEK_API_KEY").is_ok() {
            "deepseek".into()
        } else if std::env::var("OPENROUTER_API_KEY").is_ok() {
            "openrouter".into()
        } else if std::env::var("GROQ_API_KEY").is_ok() {
            "groq".into()
        } else if std::env::var("XAI_API_KEY").is_ok() {
            "xai".into()
        } else if std::env::var("MISTRAL_API_KEY").is_ok() {
            "mistral".into()
        } else {
            "ollama".into()
        };

        // 2. Determine API Key and Base URL
        let saved_info = auth_data.providers.get(&provider_name);
        let mut api_key = saved_info.map(|info| info.api_key().to_string());
        let mut base_url = saved_info.and_then(|info| info.base_url().map(str::to_string));

        let known_match = known_list.iter().find(|k| k.id == provider_name);

        if api_key.is_none()
            && let Some(k) = known_match
        {
            for env_key in &k.env_vars {
                if let Ok(key) = std::env::var(env_key)
                    && !key.trim().is_empty()
                {
                    api_key = Some(key);
                    break;
                }
            }
        }

        if base_url.is_none()
            && let Some(k) = known_match
        {
            base_url = k.default_base_url.clone();
        }

        // 3. Determine Model ID
        let model_id = if let Some(m) = requested_model {
            m.trim().to_string()
        } else if let Ok(env_m) = std::env::var("RIVET_MODEL_ID") {
            env_m.trim().to_string()
        } else if let Some(saved_model) = saved_info.and_then(|info| info.default_model()) {
            saved_model.to_string()
        } else if let Some(ref active_m) = auth_data.active_model {
            active_m.clone()
        } else if let Some(k) = known_match {
            k.default_model.clone()
        } else {
            "default".into()
        };

        Ok(ResolvedProviderConfig {
            provider: provider_name,
            model_id,
            api_key,
            base_url,
        })
    }

    /// Retrieve available models for a given provider (from auth storage, discovery, or defaults)
    pub async fn get_available_models(provider_id: &str, auth_store: &AuthStore) -> Vec<String> {
        let norm = normalize_provider_id(provider_id);
        let saved_models = auth_store.get_models(&norm).unwrap_or_default();
        if !saved_models.is_empty() {
            return saved_models;
        }

        // Attempt remote discovery if base_url is available
        if let Ok(Some(base_url)) = auth_store.get_base_url(&norm) {
            let api_key = auth_store.get_api_key(&norm).unwrap_or_default();
            if let Ok(models) = fetch_remote_models(&base_url, api_key.as_deref()).await
                && !models.is_empty()
            {
                let _ = auth_store.save_models_for_provider(&norm, models.clone());
                return models;
            }
        }

        // If local Ollama without saved config, attempt localhost discovery
        if norm == "ollama"
            && let Ok(models) = fetch_remote_models("http://localhost:11434/v1", None).await
            && !models.is_empty()
        {
            return models;
        }

        // Check known provider standard models
        let known = get_known_providers();
        if let Some(p) = known.iter().find(|k| k.id == norm)
            && !p.standard_models.is_empty()
        {
            return p.standard_models.clone();
        }

        vec!["default".into()]
    }

    pub fn format_status(config: &ResolvedProviderConfig) -> String {
        let key_status = if let Some(ref k) = config.api_key {
            format!("Key: {}", AuthStore::mask_key(k))
        } else if matches!(config.provider.as_str(), "ollama" | "local" | "custom") {
            "Local / No Key required".into()
        } else {
            "No Key configured".into()
        };

        let endpoint = config.base_url.as_deref().unwrap_or("Standard SDK Gateway");

        format!(
            "Provider: {} | Model: {} | {} | Endpoint: {}",
            config.provider, config.model_id, key_status, endpoint
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_known_providers_list() {
        let list = get_known_providers();
        assert!(list.iter().any(|p| p.id == "openai"));
        assert!(list.iter().any(|p| p.id == "anthropic"));
        assert!(list.iter().any(|p| p.id == "gemini"));
        assert!(list.iter().any(|p| p.id == "deepseek"));
        assert!(list.iter().any(|p| p.id == "groq"));
        assert!(list.iter().any(|p| p.id == "xai"));
        assert!(list.iter().any(|p| p.id == "mistral"));
        assert!(list.iter().any(|p| p.id == "togetherai"));
        assert!(list.iter().any(|p| p.id == "cerebras"));
        assert!(list.iter().any(|p| p.id == "deepinfra"));
        assert!(list.iter().any(|p| p.id == "cohere"));
        assert!(list.iter().any(|p| p.id == "perplexity"));
        assert!(list.iter().any(|p| p.id == "alibaba"));
        assert!(list.iter().any(|p| p.id == "nvidia"));
        assert!(list.iter().any(|p| p.id == "ollama"));
        assert!(list.iter().any(|p| p.id == "azure"));
        assert!(list.iter().any(|p| p.id == "amazon-bedrock"));
        assert!(list.iter().any(|p| p.id == "google-vertex"));
        assert!(list.iter().any(|p| p.id == "cloudflare-workers-ai"));
        assert!(list.iter().any(|p| p.id == "github-copilot"));
        assert!(list.iter().any(|p| p.id == "gitlab"));
        assert!(list.iter().any(|p| p.id == "venice"));
        assert!(list.iter().any(|p| p.id == "opencode"));
        assert!(list.iter().any(|p| p.id == "custom"));
    }

    #[test]
    fn test_provider_resolution() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("auth.json");
        let store = AuthStore::with_path(&path);

        store.set_provider_config(
            "cerebras",
            "csk-test1234",
            Some("https://api.cerebras.ai/v1"),
            Some("llama3.3-70b"),
            vec!["llama3.3-70b".into()],
        ).unwrap();
        store.set_active_provider("cerebras").unwrap();

        let resolved = ProviderRegistry::resolve(None, None, &store).unwrap();
        assert_eq!(resolved.provider, "cerebras");
        assert_eq!(resolved.model_id, "llama3.3-70b");
        assert_eq!(resolved.base_url.as_deref(), Some("https://api.cerebras.ai/v1"));
    }
}
