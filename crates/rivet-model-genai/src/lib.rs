//! # rivet-model-genai (OpenCode HTTP Model Backend)
//!
//! Direct OpenAI-compatible HTTP/SSE integration for OpenCode Go/Zen. The
//! provider response remains untrusted model content until `rivet-model`
//! decodes it into a controller proposal and the Harness applies ACCP policy.

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::{Client, RequestBuilder, Response};
use rivet_model::{ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_types::*;
use serde_json::{Value, json};

const DEFAULT_OPENCODE_ENDPOINT: &str = "https://opencode.ai/zen/go/v1/chat/completions";

pub struct GenAiBackend {
    client: Client,
    endpoint: String,
    api_key_env: String,
}

impl GenAiBackend {
    pub fn new() -> Self {
        let _ = dotenvy::dotenv();
        let endpoint =
            std::env::var("OPENCODE_API_URL").unwrap_or_else(|_| DEFAULT_OPENCODE_ENDPOINT.into());
        let api_key_env = if std::env::var_os("OPENCODE_API_KEY").is_some() {
            "OPENCODE_API_KEY"
        } else {
            "OPENCODE_ZEN_API_KEY"
        };
        Self::with_endpoint(endpoint, api_key_env)
    }

    /// Configure an OpenAI-compatible chat-completions endpoint. The URL is
    /// used verbatim; no SDK or provider-specific path rewriting is involved.
    pub fn with_endpoint(endpoint: impl Into<String>, api_key_env: impl Into<String>) -> Self {
        Self {
            client: Client::new(),
            endpoint: endpoint.into(),
            api_key_env: api_key_env.into(),
        }
    }

    pub fn with_opencode_zen() -> Self {
        Self::new()
    }

    fn api_key(&self) -> RivetResult<String> {
        std::env::var(&self.api_key_env).map_err(|_| {
            RivetError::Model(format!(
                "missing OpenCode API key in environment variable {}",
                self.api_key_env
            ))
        })
    }

    fn request_builder(&self, request: &ModelRequest, stream: bool) -> RivetResult<RequestBuilder> {
        let user_content = format!(
            "{}\n\nUser Request: {}",
            request.cognitive_view.format_prompt_block(),
            request.user_prompt
        );
        let mut body = json!({
            "model": request.model_id,
            "messages": [
                {"role": "system", "content": request.system_prompt.to_string()},
                {"role": "user", "content": user_content},
            ],
            "stream": stream,
        });
        if let Some(temperature) = request.temperature {
            body["temperature"] = json!(temperature);
        }
        if let Some(max_tokens) = request.max_tokens {
            body["max_tokens"] = json!(max_tokens);
        }

        Ok(self
            .client
            .post(&self.endpoint)
            .bearer_auth(self.api_key()?)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&body))
    }

    async fn send(&self, request: &ModelRequest, stream: bool) -> RivetResult<Response> {
        let response = self
            .request_builder(request, stream)?
            .send()
            .await
            .map_err(|error| RivetError::Model(format!("OpenCode HTTP request failed: {error}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(RivetError::Model(format!("OpenCode HTTP {status}: {body}")));
        }
        Ok(response)
    }
}

#[async_trait]
impl ModelBackend for GenAiBackend {
    async fn invoke(&self, request: ModelRequest) -> RivetResult<ModelResponse> {
        let response = self.send(&request, false).await?;
        let body: Value = response.json().await.map_err(|error| {
            RivetError::Model(format!("invalid OpenCode JSON response: {error}"))
        })?;
        let text_content = response_content(&body).ok_or_else(|| {
            RivetError::Model("OpenCode response contained no assistant content".into())
        })?;
        let usage = TokenUsage {
            input_tokens: json_u32(body.pointer("/usage/prompt_tokens")),
            output_tokens: json_u32(body.pointer("/usage/completion_tokens")),
            cached_tokens: json_optional_u32(
                body.pointer("/usage/prompt_tokens_details/cached_tokens"),
            ),
        };
        Ok(ModelResponse::from_text(text_content, usage))
    }

    async fn stream(&self, request: ModelRequest) -> RivetResult<Vec<String>> {
        let response = self.send(&request, true).await?;
        let mut body_stream = response.bytes_stream();
        let mut buffer = Vec::new();
        let mut chunks = Vec::new();
        while let Some(chunk) = body_stream.next().await {
            let chunk = chunk.map_err(|error| {
                RivetError::Model(format!("OpenCode SSE stream failed: {error}"))
            })?;
            buffer.extend_from_slice(&chunk);
            while let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
                let line: Vec<u8> = buffer.drain(..=newline).collect();
                if let Some(content) = parse_sse_line(&String::from_utf8_lossy(&line))? {
                    chunks.push(content);
                }
            }
        }
        if !buffer.is_empty() {
            if let Some(content) = parse_sse_line(&String::from_utf8_lossy(&buffer))? {
                chunks.push(content);
            }
        }
        if chunks.is_empty() {
            return Err(RivetError::Model(
                "OpenCode stream contained no assistant content".into(),
            ));
        }
        Ok(chunks)
    }
}

fn response_content(body: &Value) -> Option<String> {
    body.pointer("/choices/0/message/content")
        .and_then(content_value)
        .or_else(|| {
            body.pointer("/choices/0/delta/content")
                .and_then(content_value)
        })
}

fn content_value(value: &Value) -> Option<String> {
    if let Some(content) = value.as_str() {
        return Some(content.to_string());
    }
    value.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .or_else(|| part.get("content"))
                    .and_then(Value::as_str)
            })
            .collect::<String>()
    })
}

fn json_u32(value: Option<&Value>) -> u32 {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(0)
}

fn json_optional_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn parse_sse_line(line: &str) -> RivetResult<Option<String>> {
    let Some(data) = line.trim_end_matches('\r').strip_prefix("data:") else {
        return Ok(None);
    };
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return Ok(None);
    }
    let payload: Value = serde_json::from_str(data)
        .map_err(|error| RivetError::Model(format!("invalid OpenCode SSE JSON: {error}")))?;
    Ok(response_content(&payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chat_completion_content_and_usage() {
        let body = json!({
            "choices": [{"message": {"content": "READY"}}],
            "usage": {
                "prompt_tokens": 11,
                "completion_tokens": 7,
                "prompt_tokens_details": {"cached_tokens": 3}
            }
        });
        assert_eq!(response_content(&body).as_deref(), Some("READY"));
        assert_eq!(json_u32(body.pointer("/usage/prompt_tokens")), 11);
        assert_eq!(
            json_optional_u32(body.pointer("/usage/prompt_tokens_details/cached_tokens")),
            Some(3)
        );
    }

    #[test]
    fn parses_sse_delta_and_ignores_done() {
        let line = r#"data: {"choices":[{"delta":{"content":"hello"}}]}"#;
        assert_eq!(parse_sse_line(line).unwrap().as_deref(), Some("hello"));
        assert_eq!(parse_sse_line("data: [DONE]").unwrap(), None);
        assert_eq!(parse_sse_line(": keep-alive").unwrap(), None);
    }

    #[test]
    fn rejects_malformed_sse_data() {
        assert!(parse_sse_line("data: not-json").is_err());
    }
}
