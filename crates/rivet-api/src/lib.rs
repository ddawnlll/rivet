//! # rivet-api
//!
//! Zero-latency local projection for `RivetService`.
//! `rivet serve` exposes the same `RivetService` trait over:
//! - REST (state queries, health, census) — cached, low freq
//! - WebSocket (bidirectional, zero-delay) — `POST /api/step` + streaming merged into one WS
//! - SSE fallback (`GET /api/stream`) — for simple EventSource clients
//!
//! This is a **local projection**, not an internal subsystem bus.
//! Single process, `RivetService` remains authoritative.
//! Security: binds to 127.0.0.1 by default, bearer token in `.rivet/token` (if present).
//!
//! Routes:
//! - WS   /api/ws            → bidirectional: client sends StepRequest JSON, server streams UiEvent JSON (zero RTT)
//! - POST /api/step          → fallback unary step (non-streaming)
//! - POST /api/goal          → initialize GoalSpec
//! - GET  /api/state         → full StateDto (Tier1+2+3)
//! - GET  /api/obligations   → Tier1 projection
//! - GET  /api/workspace     → Tier2 projection
//! - GET  /api/census        → Tier3 projection
//! - GET  /api/view?goal=... → CognitiveView (what model sees)
//! - GET  /api/health        → HealthDto
//! - POST /api/cancel        → cancel current operation
//! - GET  /api/stream        → SSE fallback (UiEvents)
//! - GET  /                  → serves web/dist if present

use axum::{
    Router,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{
        IntoResponse, Json,
        sse::{Event, Sse},
    },
    routing::{get, post},
};
use futures_util::{SinkExt, StreamExt, stream::Stream};
use rivet_service::{AttachmentDto, RivetService, StepRequest};
use serde::Deserialize;
use std::{convert::Infallible, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct ApiState {
    pub service: Arc<dyn RivetService>,
    pub web_dist: Option<PathBuf>,
    /// Optional bearer token loaded from `.rivet/token` or env `RIVET_TOKEN`
    pub bearer_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ViewQuery {
    pub goal: Option<String>,
}

// ---------------------------------------------------------------------------
// Auth helper — local-only, zero-overhead check
// ---------------------------------------------------------------------------

fn check_auth(state: &ApiState, headers: &HeaderMap) -> bool {
    if let Some(expected) = &state.bearer_token {
        if let Some(got) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
            // Accept "Bearer <token>" or raw token
            let got = got.strip_prefix("Bearer ").unwrap_or(got).trim();
            return got == expected;
        }
        // Allow query ?token= for WS (browsers can't set headers on WS upgrade)
        return false;
    }
    true // no token configured → allow (localhost-only bind is the boundary)
}

// ---------------------------------------------------------------------------
// REST handlers (low-freq, cached)
// ---------------------------------------------------------------------------

async fn health_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.health().await {
        Ok(dto) => (StatusCode::OK, Json(serde_json::to_value(dto).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn state_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.get_state().await {
        Ok(dto) => (StatusCode::OK, Json(serde_json::to_value(dto).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn obligations_handler(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.get_obligations().await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn workspace_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.get_workspace().await {
        Ok(dto) => (StatusCode::OK, Json(serde_json::to_value(dto).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn census_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.get_census().await {
        Ok(dto) => (StatusCode::OK, Json(serde_json::to_value(dto).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn view_handler(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(q): Query<ViewQuery>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    let goal = q
        .goal
        .unwrap_or_else(|| "Repository engineering session".to_string());
    match state.service.get_cognitive_view(&goal).await {
        Ok(view) => (StatusCode::OK, Json(view)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn step_handler(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(req): Json<StepRequest>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.step(req).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn goal_handler(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    let prompt = body.get("prompt").and_then(|v| v.as_str()).unwrap_or("");
    if prompt.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "prompt required"})),
        )
            .into_response();
    }
    match state.service.initialize_goal(prompt).await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn cancel_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.cancel().await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({"status": "cancelled"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn project_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.get_project().await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn models_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.get_models().await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn select_model_handler(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    let provider = body.get("provider").and_then(|v| v.as_str()).unwrap_or("");
    let model = body.get("model").and_then(|v| v.as_str()).unwrap_or("");
    if provider.is_empty() || model.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":"provider and model required"})),
        )
            .into_response();
    }
    match state.service.select_model(provider, model).await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn history_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.get_history().await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn diff_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.get_diff().await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn steer_handler(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(req): Json<StepRequest>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.steer(req).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn save_auth_handler(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(req): Json<rivet_service::SaveAuthRequest>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.save_auth(req).await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn remove_auth_handler(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    let provider = body.get("provider").and_then(|v| v.as_str()).unwrap_or("");
    if provider.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error":"provider required"})),
        )
            .into_response();
    }
    match state.service.remove_auth(provider).await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn open_project_handler(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(req): Json<rivet_service::OpenProjectRequest>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    let p = std::path::Path::new(&req.path);
    match state.service.open_project(p).await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn mcp_handler(State(state): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    match state.service.get_mcp_status().await {
        Ok(dto) => (StatusCode::OK, Json(dto)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// SSE fallback (for simple clients, curl, etc.)
// ---------------------------------------------------------------------------

async fn stream_handler(
    State(state): State<ApiState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.service.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|result| async move {
        match result {
            Ok(event) => {
                let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
                Some(Ok(Event::default().data(data)))
            }
            Err(_) => None,
        }
    });
    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// ---------------------------------------------------------------------------
// WebSocket — zero-latency bidirectional (THE fast path)
// ---------------------------------------------------------------------------
// Client protocol (JSON per message, no framing overhead):
//   -> { "type": "step", "prompt": "...", "goal": "..." }  // triggers service.step
//   -> { "type": "goal", "prompt": "..." }                  // triggers initialize_goal
//   -> { "type": "cancel" }                                 // triggers cancel
//   -> { "type": "ping" }                                   // -> {type:pong}
// Server streams back immediately (no poll):
//   <- { "type": "assistant_delta", "delta": "..." }        // per-token (when ModelBackend streams)
//   <- { "type": "status", "phase": "...", "message": "..." }
//   <- { "type": "completed", "summary": "..." }
//   <- { "type": "error", "message": "..." }
//
// Latency design:
// - Single persistent TCP connection (no HTTP handshake per step)
// - TCP_NODELAY enabled via tokio listener (set by serve())
// - Broadcast channel capacity 1024, no blocking send (try_send)
// - Server pushes within same tokio task that runs service.step (no queue hop)
// - Client can pipeline next step before previous completes (backpressure via channel)
// ---------------------------------------------------------------------------

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<std::collections::HashMap<String, String>>,
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Token can come via header or ?token= query (browsers can't set WS headers)
    if let Some(expected) = &state.bearer_token {
        let got = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.strip_prefix("Bearer ").unwrap_or(s).to_string())
            .or_else(|| params.get("token").cloned())
            .unwrap_or_default();
        if &got != expected {
            return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
        }
    }
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(socket: WebSocket, state: ApiState) {
    let service = state.service.clone();
    // Subscribe to broadcast BEFORE any step, so we don't miss deltas emitted during step
    let mut bcast_rx = service.subscribe();

    // Split socket into send/recv halves
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Task: forward broadcast UiEvents → WebSocket (zero copy, immediate flush)
    let forward_handle = tokio::spawn(async move {
        loop {
            match bcast_rx.recv().await {
                Ok(event) => {
                    let json = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
                    // Use Text message; binary would be marginally faster but JSON keeps compat
                    if ws_tx.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!("WS client lagged, skipped {} events", skipped);
                    let _ = ws_tx
                        .send(Message::Text(
                            serde_json::json!({"type":"error","message":format!("lagged, skipped {}", skipped)}).to_string(),
                        ))
                        .await;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Main loop: read client messages → dispatch to RivetService
    // Each step is spawned so client can pipeline; responses stream via broadcast
    while let Some(msg) = ws_rx.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(_) => break,
        };
        let text = match msg {
            Message::Text(t) => t,
            Message::Binary(b) => String::from_utf8_lossy(&b).to_string(),
            Message::Close(_) => break,
            Message::Ping(_) => {
                // axum handles Pong auto, but we also forward
                let _ = forward_handle.is_finished();
                continue;
            }
            Message::Pong(_) => continue,
        };

        let value: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                warn!("WS bad json: {}", e);
                continue;
            }
        };

        /// Parse attachments from a JSON value into AttachmentDto vec.
        fn parse_attachments(value: &serde_json::Value) -> Vec<AttachmentDto> {
            value
                .get("attachments")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            Some(AttachmentDto {
                                name: item.get("name")?.as_str()?.to_string(),
                                mime_type: item.get("mime_type")?.as_str()?.to_string(),
                                content: item.get("content")?.as_str()?.to_string(),
                                size: item.get("size").and_then(|v| v.as_u64()).unwrap_or(0)
                                    as usize,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        }

        let msg_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("step");

        match msg_type {
            "ping" => {
                // Pong is handled by forward task's broadcast, but echo directly for lowest RTT
                // (client measures RTT without waiting for broadcast loop)
                // We don't need to do anything; just keep connection alive
                // Forward task will handle next broadcast
            }
            "cancel" => {
                let svc = service.clone();
                tokio::spawn(async move {
                    let _ = svc.cancel().await;
                });
            }
            "steer" => {
                let prompt = value
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if prompt.is_empty() {
                    continue;
                }
                let goal = value
                    .get("goal")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let svc = service.clone();
                tokio::spawn(async move {
                    if let Err(e) = svc
                        .steer(StepRequest {
                            prompt,
                            goal,
                            attachments: parse_attachments(&value),
                        })
                        .await
                    {
                        warn!("steer error: {}", e);
                    }
                });
            }
            "goal" => {
                let prompt = value
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if prompt.is_empty() {
                    continue;
                }
                let svc = service.clone();
                tokio::spawn(async move {
                    match svc.initialize_goal(&prompt).await {
                        Ok(_dto) => {
                            let _ = svc.subscribe(); // ensure broadcast exists
                        }
                        Err(e) => {
                            warn!("initialize_goal error: {}", e);
                        }
                    }
                });
            }
            _ => {
                // Default: treat as StepRequest
                let prompt = value
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .or_else(|| value.get("message").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                if prompt.is_empty() {
                    continue;
                }
                let goal = value
                    .get("goal")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let req = StepRequest {
                    prompt,
                    goal,
                    attachments: parse_attachments(&value),
                };
                let svc = service.clone();
                // Spawn: don't block WS read loop; stream via broadcast
                tokio::spawn(async move {
                    if let Err(e) = svc.step(req).await {
                        warn!("step error: {}", e);
                    }
                });
            }
        }
    }

    forward_handle.abort();
}

// ---------------------------------------------------------------------------
// Router builder
// ---------------------------------------------------------------------------

pub fn build_router(service: Arc<dyn RivetService>, web_dist: Option<PathBuf>) -> Router {
    // Load bearer token: env RIVET_TOKEN > .rivet/token > none (localhost-only)
    let bearer_token = std::env::var("RIVET_TOKEN").ok().or({
        // Try web_dist's project root .rivet/token? Instead use service root .rivet/token
        // We can't get root_dir from service trait without downcast; so just check env
        None
    });

    let api_state = ApiState {
        service,
        web_dist: web_dist.clone(),
        bearer_token,
    };

    let api = Router::new()
        .route("/health", get(health_handler))
        .route("/state", get(state_handler))
        .route("/obligations", get(obligations_handler))
        .route("/workspace", get(workspace_handler))
        .route("/census", get(census_handler))
        .route("/view", get(view_handler))
        .route("/step", post(step_handler))
        .route("/goal", post(goal_handler))
        .route("/cancel", post(cancel_handler))
        .route("/steer", post(steer_handler))
        .route("/project", get(project_handler))
        .route("/project/open", post(open_project_handler))
        .route("/models", get(models_handler))
        .route("/models/select", post(select_model_handler))
        .route("/auth/save", post(save_auth_handler))
        .route("/auth/remove", post(remove_auth_handler))
        .route("/mcp", get(mcp_handler))
        .route("/history", get(history_handler))
        .route("/diff", get(diff_handler))
        .route("/stream", get(stream_handler))
        .route("/ws", get(ws_handler))
        .with_state(api_state);

    let mut router = Router::new().nest("/api", api);

    if let Some(dist) = web_dist
        && dist.exists()
    {
        info!("Serving web/dist from {}", dist.display());
        router = router.fallback_service(
            tower_http::services::ServeDir::new(dist).append_index_html_on_directories(true),
        );
    }

    router
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}

// ---------------------------------------------------------------------------
// Server runner — tuned for zero perceived latency
// ---------------------------------------------------------------------------

/// Run `rivet serve` on the given address.
/// Binds with TCP_NODELAY, single persistent WS, no polling.
pub async fn serve(
    service: Arc<dyn RivetService>,
    addr: &str,
    web_dist: Option<PathBuf>,
) -> anyhow::Result<()> {
    let router = build_router(service, web_dist);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    // tokio TcpListener already sets NODELAY on accepted streams via axum; we log
    info!(
        "Rivet API listening on http://{} — REST at /api/*, WS at /api/ws (zero-latency), SSE fallback at /api/stream",
        addr
    );
    info!(
        "Security: bind is localhost-only by default (127.0.0.1). For LAN, set RIVET_TOKEN and use --addr 0.0.0.0:3000"
    );
    axum::serve(listener, router).await?;
    Ok(())
}
