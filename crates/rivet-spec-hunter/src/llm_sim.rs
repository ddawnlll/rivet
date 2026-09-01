//! LLM Simulation — ported 1:1 from anomalyco/opencode
//! opencode: packages/llm/test/lib/{http,sse,openai-chunks}.ts
//! Rivet: scripted SSE bodies + wiremock HTTP mock for GenAiBackend

use serde_json::json;
use wiremock::{Mock, MockServer, ResponseTemplate, matchers::{method, path_regex}};

const FIXTURE_ID: &str = "chatcmpl_fixture";

/// Mirrors opencode's deltaChunk
pub fn delta_chunk(delta: serde_json::Value, finish_reason: Option<&str>) -> serde_json::Value {
    json!({
        "id": FIXTURE_ID,
        "choices": [{ "delta": delta, "finish_reason": finish_reason }],
        "usage": null
    })
}

pub fn finish_chunk(reason: &str) -> serde_json::Value {
    delta_chunk(json!({}), Some(reason))
}

pub fn tool_call_chunk(id: &str, name: &str, args: &str, index: u32) -> serde_json::Value {
    delta_chunk(json!({
        "role": "assistant",
        "tool_calls": [{ "index": index, "id": id, "function": { "name": name, "arguments": args } }]
    }), None)
}

pub fn usage_chunk(usage: serde_json::Value) -> serde_json::Value {
    json!({ "id": FIXTURE_ID, "choices": [], "usage": usage })
}

/// Mirrors opencode's sseEvents(...chunks)
pub fn sse_events(chunks: Vec<serde_json::Value>) -> String {
    let mut s = String::new();
    for chunk in chunks {
        s.push_str(&format!("data: {}\n\n", chunk));
    }
    s.push_str("data: [DONE]\n\n");
    s
}

/// JSON body for GenAiBackend non-streaming (invoke) — content is AccpEnvelope string
/// GenAiBackend extracts choices[0].message.content and parses it as CognitiveAction
pub fn chat_response_with_content(content: &str) -> String {
    serde_json::json!({
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 10}
    }).to_string()
}
/// Helper for file.read/write envelopes
pub fn chat_response_with_tool_call(id: &str, name: &str, args: &str) -> String {
    // Build a minimal PROPOSAL/ACTION envelope as content string
    let target = serde_json::from_str::<serde_json::Value>(args).ok().and_then(|v| v.get("target").cloned()).and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_else(|| ".".to_string());
    let envelope = serde_json::json!({
        "accp_version": "3.0",
        "sender": "COGNITIVE_CONTROLLER",
        "family": "PROPOSAL",
        "kind": "ACTION",
        "revision": 0,
        "scope": {"repository": "rivet", "revision": 0},
        "payload": {"capability": name, "target": target, "parameters": serde_json::from_str::<serde_json::Value>(args).unwrap_or(serde_json::json!({})), "intent": "test"}
    });
    chat_response_with_content(&envelope.to_string())
}
/// Bodies for scriptedResponses — each entry is a full SSE response body for one HTTP call
/// Opencode: scriptedResponses([sseEvents(toolCallChunk...), sseEvents(deltaChunk...)])
#[derive(Debug, Clone)]
pub struct ScriptedSse(pub Vec<String>);

impl ScriptedSse {
    pub fn single(body: String) -> Self { Self(vec![body]) }
    pub fn multi(bodies: Vec<String>) -> Self { Self(bodies) }
}

/// Spin up a wiremock server that mimics opencode's scriptedResponses
/// Every POST to /v1/chat/completions returns the next body in order
pub async fn mock_opencode_server(scripted: ScriptedSse) -> MockServer {
    let server = MockServer::start().await;
    // We need sequential responses: wiremock's `up_to_n_times` + `with_body` per index
    // Simplest: single mock that returns bodies sequentially via closure would require custom responder
    // For now, we use a single body that contains all chunks for single-turn tests
    // For multi-turn, caller should use `mock_opencode_server_multi`
    let body = scripted.0.first().cloned().unwrap_or_else(|| sse_events(vec![]));
    Mock::given(method("POST"))
        .and(path_regex(".*chat/completions.*"))
        .respond_with(ResponseTemplate::new(200).set_body_string(body).insert_header("content-type", "text/event-stream"))
        .mount(&server)
        .await;
    server
}

/// Multi-turn mock: each request gets next body
pub async fn mock_opencode_server_multi(bodies: Vec<String>) -> MockServer {
    let server = MockServer::start().await;
    // Wiremock doesn't support sequential bodies natively without custom logic,
    // so we mount multiple mocks with `up_to_n_times(1)` in order
    for body in bodies {
        Mock::given(method("POST"))
            .and(path_regex(".*chat/completions.*"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body).insert_header("content-type", "text/event-stream"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
    }
    server
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sse_format_matches_opencode() {
        let body = sse_events(vec![delta_chunk(json!({"role":"assistant","content":"hi"}), None)]);
        assert!(body.contains("data: {"));
        assert!(body.ends_with("data: [DONE]\n\n"));
    }
    #[test]
    fn tool_call_chunk_shape() {
        let chunk = tool_call_chunk("call_1", "file.read", r#"{"target":"src/lib.rs"}"# , 0);
        assert_eq!(chunk["choices"][0]["delta"]["tool_calls"][0]["function"]["name"], "file.read");
    }
}
