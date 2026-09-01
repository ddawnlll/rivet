//! # rivet-service
//!
//! UI-agnostic Harness facade shared by TUI / Web / Tauri.
//! Zero-latency design: model streaming is broadcast per-token via WebSocket/WS,
//! no polling, TCP_NODELAY, async no-blocking.
//!
//! Monograph alignment:
//! - `agent ≠ frontend`, `chat = projection of persistent Rivet state`
//! - `INTERACTION_MODEL.md` chat-only surface
//! - `TECHNICAL_ARCHITECTURE_V03.md` UiEvent contract
//! - Display priority: Tier1 Hard (Obligations/Verification/Contradictions) > Tier2 Soft > Tier3 on-demand

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use noesis::{CognitiveView, HardState, SoftWorkspace};
use rivet_core::{HarnessCore, HarnessEvent, RunPhase};
use rivet_mcp::{McpCapabilityBridge, McpConfigFile, McpServerStatusDto, StdioProcessTransport};
use rivet_model::auth::AuthStore;
use rivet_model::provider_hub::{ProviderRegistry, ResolvedProviderConfig, get_known_providers};
use rivet_model::{ModelBackend, ModelRequest, ModelResponse};
use rivet_repository::CensusRunner;
use rivet_store::StoredSessionEntry;
use rivet_store::{HardStateStore, RedbStore};
use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::broadcast;

// =============================================================================
// UI Events
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UiEvent {
    RunStarted {
        run_id: String,
        prompt: String,
        goal: String,
    },
    AssistantDelta {
        delta: String,
    },
    AssistantReasoningDelta {
        delta: String,
    },
    Status {
        phase: RunPhase,
        message: String,
    },
    AuthorityPrompt {
        request_id: String,
        capability: String,
        target: String,
    },
    VerificationUpdate {
        obligation_id: String,
        passed: bool,
        diagnostics: Option<String>,
    },
    CognitiveState {
        focus: String,
        hypothesis: Option<String>,
        status: String,
        evidence_count: usize,
        counter_signal: Option<String>,
    },
    ToolActivity {
        action_id: String,
        capability: String,
        target: String,
        status: String,
        summary: String,
        output_summary: Option<String>,
    },
    Observation {
        source: String,
        summary: String,
        evidence_id: Option<String>,
    },
    PraxisUpdate {
        obligation_id: String,
        predicate: String,
        status: String,
        scope: String,
        diagnostics: Option<String>,
        receipt_id: Option<String>,
    },
    HardStateMutation {
        revision: u64,
        mutation: String,
        entity_id: Option<String>,
        from: Option<String>,
        to: Option<String>,
    },
    SteerAccepted {
        prompt: String,
    },
    Cancelled {
        message: String,
    },
    Completed {
        summary: String,
    },
    Error {
        message: String,
    },
}

// =============================================================================
// DTOs
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepRequest {
    pub prompt: String,
    pub goal: Option<String>,
    #[serde(default)]
    pub attachments: Vec<AttachmentDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentDto {
    pub name: String,
    pub mime_type: String,
    pub content: String,
    pub size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResponse {
    pub text: String,
    pub phase: RunPhase,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    #[serde(flatten)]
    pub event: UiEvent,
    pub revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateDto {
    pub revision: u64,
    pub phase: RunPhase,
    pub session_id: String,
    pub task_id: String,
    pub repository_id: String,
    pub hard_state: HardStateSummary,
    pub soft_workspace: SoftWorkspaceSummary,
    pub cognitive_view: Option<CognitiveView>,
    pub model_invocation_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardStateSummary {
    pub revision: u64,
    pub open_obligations: Vec<ObligationDto>,
    pub closed_obligations: Vec<ObligationDto>,
    pub claims: Vec<ClaimDto>,
    pub contradictions: Vec<ContradictionDto>,
    pub rejected_claims: Vec<RejectedDto>,
    pub recent_evidence: Vec<EvidenceDto>,
    pub verification_receipts: Vec<VerificationDto>,
    pub completed_tasks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObligationDto {
    pub id: String,
    pub description: String,
    pub scope: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimDto {
    pub id: String,
    pub proposition: String,
    pub status: String,
    pub supporting_evidence: Vec<String>,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContradictionDto {
    pub claim_id: String,
    pub reason: String,
    pub contradicted_by: Vec<String>,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RejectedDto {
    pub claim_id: String,
    pub reason: String,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceDto {
    pub id: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationDto {
    pub receipt_id: String,
    pub obligation_id: String,
    pub passed: bool,
    pub diagnostics: Option<String>,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoftWorkspaceSummary {
    pub workspace_id: String,
    pub session_id: String,
    pub base_hard_revision: u64,
    pub active_focus: Vec<String>,
    pub hypotheses: Vec<String>,
    pub unknowns: Vec<String>,
    pub candidate_actions: Vec<String>,
    pub item_count: usize,
    pub max_capacity: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CensusDto {
    pub total_files: usize,
    pub total_bytes: u64,
    pub deferred_count: usize,
    pub directories: Vec<DirectoryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryDto {
    pub relative_path: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub relevance: String,
    pub signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthDto {
    pub status: String,
    pub version: String,
    pub harness_phase: RunPhase,
    pub hard_revision: u64,
    pub provider: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalSummaryDto {
    pub summary: String,
    pub obligations_created: usize,
    pub graph_nodes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub branch: Option<String>,
    pub revision: Option<String>,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDto {
    pub id: String,
    pub name: String,
    pub models: Vec<String>,
    pub configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub masked_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveAuthRequest {
    pub provider: String,
    pub key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenProjectRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCatalogDto {
    pub active_provider: String,
    pub active_model: String,
    pub providers: Vec<ProviderDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntryDto {
    pub id: String,
    pub prompt: String,
    pub status: String,
    pub revision: Option<u64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffDto {
    pub status: String,
    pub text: String,
    pub files: Vec<String>,
}

// =============================================================================
// Zero-latency streaming wrapper — broadcasts per-token with no blocking
// =============================================================================

/// Wraps any `ModelBackend` and broadcasts streaming chunks as `UiEvent::AssistantDelta`
/// with zero additional latency. When `HarnessCore` calls `invoke`, this wrapper
/// actually calls `stream` on the inner backend if available, emitting each chunk
/// immediately via `try_send` (non-blocking, never waits).
struct BroadcastModelBackend {
    inner: Arc<dyn ModelBackend>,
    tx: broadcast::Sender<UiEvent>,
}

#[async_trait]
impl ModelBackend for BroadcastModelBackend {
    async fn invoke(&self, request: ModelRequest) -> RivetResult<ModelResponse> {
        // Try streaming path first for zero-latency token delivery
        // We attempt `stream` and broadcast each chunk; on failure fall back to `invoke`
        let stream_result = self.inner.stream(request.clone()).await;
        match stream_result {
            Ok(chunks) if !chunks.is_empty() && chunks.len() > 1 => {
                // True streaming path: broadcast each chunk immediately (non-blocking)
                let mut full = String::new();
                for chunk in &chunks {
                    // Non-blocking broadcast — never stalls model
                    let _ = self.tx.send(UiEvent::AssistantDelta {
                        delta: chunk.clone(),
                    });
                    full.push_str(chunk);
                }
                // Also handle reasoning chunks if model embedded <think> tags
                // We detect by simple heuristic: if chunk contains "<think>"
                // For now, broadcast as delta; frontend will split
                Ok(ModelResponse::from_text(
                    full,
                    rivet_model::TokenUsage::default(),
                ))
            }
            Ok(chunks) if chunks.len() == 1 => {
                // Single chunk = no real streaming; still broadcast once (still zero extra RTT)
                let text = chunks.into_iter().next().unwrap_or_default();
                let _ = self.tx.send(UiEvent::AssistantDelta {
                    delta: text.clone(),
                });
                Ok(ModelResponse::from_text(
                    text,
                    rivet_model::TokenUsage::default(),
                ))
            }
            _ => {
                // Fallback: direct invoke (no streaming support)
                let resp = self.inner.invoke(request).await?;
                let _ = self.tx.send(UiEvent::AssistantDelta {
                    delta: resp.text_content.clone(),
                });
                // Also split reasoning if present
                if resp.text_content.contains("<think>") {
                    // naive split for immediate reasoning feedback
                    if let Some(start) = resp.text_content.find("<think>")
                        && let Some(end) = resp.text_content.find("</think>")
                    {
                        let reasoning = resp.text_content[start + 7..end].to_string();
                        let _ = self
                            .tx
                            .send(UiEvent::AssistantReasoningDelta { delta: reasoning });
                    }
                }
                Ok(resp)
            }
        }
    }

    async fn stream(&self, request: ModelRequest) -> RivetResult<Vec<String>> {
        // Direct stream also broadcasts
        let chunks = self.inner.stream(request).await?;
        for chunk in &chunks {
            let _ = self.tx.send(UiEvent::AssistantDelta {
                delta: chunk.clone(),
            });
        }
        Ok(chunks)
    }
}

// =============================================================================
// RivetService trait
// =============================================================================

#[async_trait]
pub trait RivetService: Send + Sync {
    async fn step(&self, req: StepRequest) -> RivetResult<StepResponse>;
    fn subscribe(&self) -> broadcast::Receiver<UiEvent>;
    async fn initialize_goal(&self, prompt: &str) -> RivetResult<GoalSummaryDto>;
    async fn get_state(&self) -> RivetResult<StateDto>;
    async fn get_obligations(&self) -> RivetResult<Vec<ObligationDto>>;
    async fn get_workspace(&self) -> RivetResult<SoftWorkspaceSummary>;
    async fn get_census(&self) -> RivetResult<CensusDto>;
    async fn get_cognitive_view(&self, goal: &str) -> RivetResult<CognitiveView>;
    async fn health(&self) -> RivetResult<HealthDto>;
    async fn cancel(&self) -> RivetResult<()>;
    async fn steer(&self, req: StepRequest) -> RivetResult<StepResponse>;
    async fn get_project(&self) -> RivetResult<ProjectDto>;
    async fn get_models(&self) -> RivetResult<ModelCatalogDto>;
    async fn select_model(&self, provider: &str, model: &str) -> RivetResult<ModelCatalogDto>;
    async fn save_auth(&self, req: SaveAuthRequest) -> RivetResult<ModelCatalogDto>;
    async fn remove_auth(&self, provider: &str) -> RivetResult<ModelCatalogDto>;
    async fn open_project(&self, path: &Path) -> RivetResult<ProjectDto>;
    async fn get_mcp_status(&self) -> RivetResult<Vec<McpServerStatusDto>>;
    async fn get_history(&self) -> RivetResult<Vec<HistoryEntryDto>>;
    async fn get_diff(&self) -> RivetResult<DiffDto>;
    async fn current_phase(&self) -> RivetResult<RunPhase>;
    async fn clear_hypotheses(&self) -> RivetResult<()>;
    async fn add_hypothesis(&self, hypothesis: &str) -> RivetResult<()>;
}

// =============================================================================
// Concrete implementation — TUI/Web/Tauri all share this
// =============================================================================

pub struct RivetServiceImpl {
    pub harness: Arc<tokio::sync::RwLock<Arc<HarnessCore>>>,
    pub root_dir: Arc<tokio::sync::RwLock<PathBuf>>,
    pub store: Arc<tokio::sync::RwLock<Arc<dyn HardStateStore>>>,
    pub auth_store: AuthStore,
    pub active_config: Arc<tokio::sync::RwLock<ResolvedProviderConfig>>,
    pub dynamic_backend: Arc<rivet_model::DynamicModelBackend>,
    pub event_tx: broadcast::Sender<UiEvent>,
    pub default_goal: String,
    pub history: Arc<tokio::sync::Mutex<Vec<HistoryEntryDto>>>,
    pub active_cancel: Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}

impl RivetServiceImpl {
    pub fn new(
        harness: Arc<HarnessCore>,
        root_dir: PathBuf,
        store: Arc<dyn HardStateStore>,
        auth_store: AuthStore,
        active_config: ResolvedProviderConfig,
    ) -> Self {
        let (event_tx, _) = broadcast::channel(1024);
        Self {
            harness: Arc::new(tokio::sync::RwLock::new(harness.clone())),
            root_dir: Arc::new(tokio::sync::RwLock::new(root_dir)),
            store: Arc::new(tokio::sync::RwLock::new(store)),
            auth_store,
            dynamic_backend: Arc::new(rivet_model::DynamicModelBackend::new(harness.model.clone())),
            active_config: Arc::new(tokio::sync::RwLock::new(active_config)),
            event_tx,
            default_goal: "Repository engineering session".to_string(),
            history: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            active_cancel: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    /// Factory: create HarnessCore + RivetService from a directory.
    pub async fn from_dir(
        target_dir: &Path,
        config: ResolvedProviderConfig,
        auth_store: AuthStore,
    ) -> anyhow::Result<Arc<Self>> {
        use rivet_model_rig::RigBackend;
        use rivet_runtime::Runtime;

        let state_dir = target_dir.join(".rivet");
        tokio::fs::create_dir_all(&state_dir).await?;
        let store: Arc<dyn HardStateStore> =
            Arc::new(RedbStore::open(state_dir.join("state.redb"))?);

        let (event_tx, _) = broadcast::channel(1024);

        let inner_backend: Arc<dyn ModelBackend> = if config.provider == "opencode" {
            Arc::new(rivet_model_genai::GenAiBackend::with_config(
                opencode_endpoint(config.base_url.as_deref()),
                config.api_key.clone(),
            ))
        } else {
            Arc::new(RigBackend::from_resolved(&config))
        };
        let streaming_backend: Arc<dyn ModelBackend> = Arc::new(BroadcastModelBackend {
            inner: inner_backend.clone(),
            tx: event_tx.clone(),
        });
        let dynamic = Arc::new(rivet_model::DynamicModelBackend::new(streaming_backend));

        let runtime = Arc::new(Runtime::new(target_dir));
        let repository_id = target_dir
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|n| !n.is_empty())
            .unwrap_or("rivet")
            .to_string();

        let event_tx_for_harness = event_tx.clone();
        let harness = Arc::new(
            HarnessCore::open(store.clone(), dynamic.clone(), runtime)
                .await?
                .with_repository_id(repository_id)
                .with_event_sink(Arc::new(move |event| {
                    if let Some(ui_event) = harness_event_to_ui(event) {
                        let _ = event_tx_for_harness.send(ui_event);
                    }
                })),
        );

        if let Ok(census) = CensusRunner::run_census(target_dir).await {
            let frontier = census.active_paths(64);
            let signals = census
                .directories
                .iter()
                .take(64)
                .map(|d| {
                    format!(
                        "{} files={} bytes={} relevance={:?} signals={:?}",
                        d.relative_path, d.file_count, d.total_bytes, d.relevance, d.signals
                    )
                })
                .collect();
            harness.set_relevant_files(frontier).await;
            harness.set_repository_signals(signals).await;
        }

        // Auto-load past session history from store
        let history_entries: Vec<HistoryEntryDto> = store
            .list_session_entries()
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|s| HistoryEntryDto {
                id: s.id,
                prompt: s.prompt,
                status: s.status,
                revision: s.revision,
                created_at: s.created_at,
            })
            .collect();

        Ok(Arc::new(Self {
            harness: Arc::new(tokio::sync::RwLock::new(harness)),
            root_dir: Arc::new(tokio::sync::RwLock::new(target_dir.to_path_buf())),
            store: Arc::new(tokio::sync::RwLock::new(store)),
            auth_store,
            active_config: Arc::new(tokio::sync::RwLock::new(config)),
            dynamic_backend: dynamic,
            event_tx,
            default_goal: "Repository engineering session".to_string(),
            history: Arc::new(tokio::sync::Mutex::new(history_entries)),
            active_cancel: Arc::new(tokio::sync::Mutex::new(None)),
        }))
    }

    fn emit(&self, event: UiEvent) {
        let _ = self.event_tx.send(event);
    }

    async fn current_goal(&self) -> String {
        let harness = self.harness.read().await.clone();
        let spec = harness.goal_spec.lock().await;
        spec.as_ref()
            .map(|s| s.summary.clone())
            .unwrap_or_else(|| self.default_goal.clone())
    }

    async fn build_state_dto(&self) -> RivetResult<StateDto> {
        let harness = self.harness.read().await.clone();
        let hard = harness.hard_state.lock().await.clone();
        let soft = harness.soft_workspace.lock().await.clone();
        let phase = harness.current_phase().await;
        Ok(StateDto {
            revision: hard.revision.0,
            phase,
            session_id: harness.session_id.to_string(),
            task_id: harness.task_id.to_string(),
            repository_id: soft.session_id.to_string(),
            hard_state: summarize_hard(&hard),
            soft_workspace: summarize_soft(&soft),
            cognitive_view: None,
            model_invocation_count: hard.model_invocations.len(),
        })
    }
}

#[async_trait]
impl RivetService for RivetServiceImpl {
    async fn step(&self, req: StepRequest) -> RivetResult<StepResponse> {
        let goal = if let Some(g) = req.goal.clone() {
            g
        } else {
            self.current_goal().await
        };
        let run_id = uuid::Uuid::new_v4().to_string();
        let created_at = Utc::now();
        self.emit(UiEvent::RunStarted {
            run_id: run_id.clone(),
            prompt: req.prompt.clone(),
            goal: goal.clone(),
        });

        let history_entry = HistoryEntryDto {
            id: run_id.clone(),
            prompt: req.prompt.clone(),
            status: "running".into(),
            revision: None,
            created_at,
        };
        self.history.lock().await.push(history_entry);

        // Save persistent record to store
        let store = self.store.read().await.clone();
        let _ = store
            .save_session_entry(&StoredSessionEntry {
                id: run_id.clone(),
                prompt: req.prompt.clone(),
                status: "running".into(),
                revision: None,
                created_at,
            })
            .await;

        self.emit(UiEvent::Status {
            phase: RunPhase::PreparingView,
            message: "Compiling cognitive view...".into(),
        });
        self.emit(UiEvent::Status {
            phase: RunPhase::InvokingModel,
            message: format!(
                "Invoking model {}...",
                self.active_config.read().await.model_id
            ),
        });

        let runtime_prompt = if req.attachments.is_empty() {
            req.prompt.clone()
        } else {
            let context = req
                .attachments
                .iter()
                .map(|attachment| {
                    format!(
                        "

--- attached context: {} ---
{}
--- end attached context ---",
                        attachment.name, attachment.content
                    )
                })
                .collect::<String>();
            format!("{}{}", req.prompt, context)
        };
        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel();
        *self.active_cancel.lock().await = Some(cancel_tx);

        let harness = self.harness.read().await.clone();
        let result = tokio::select! {
            result = harness.step(&goal, &runtime_prompt) => result,
            Ok(()) = &mut cancel_rx => {
                harness.cancel().await;
                Err(RivetError::Runtime("cancelled by user".into()))
            }
        };
        *self.active_cancel.lock().await = None;
        let phase_after = harness.current_phase().await;
        let hard = harness.hard_state.lock().await;

        match result {
            Ok(text) => {
                self.emit(UiEvent::Status {
                    phase: phase_after,
                    message: "Step completed".into(),
                });
                for (oid, receipt) in &hard.verification_receipts {
                    self.emit(UiEvent::VerificationUpdate {
                        obligation_id: oid.to_string(),
                        passed: receipt.passed,
                        diagnostics: receipt.diagnostics.clone(),
                    });
                }
                if phase_after == RunPhase::Completed {
                    self.emit(UiEvent::Completed {
                        summary: text.clone(),
                    });
                }
                let status_str = format!("{:?}", phase_after).to_lowercase();
                if let Some(entry) = self.history.lock().await.last_mut() {
                    entry.status = status_str.clone();
                    entry.revision = Some(hard.revision.0);
                }
                let _ = store
                    .save_session_entry(&StoredSessionEntry {
                        id: run_id,
                        prompt: req.prompt,
                        status: status_str,
                        revision: Some(hard.revision.0),
                        created_at,
                    })
                    .await;

                Ok(StepResponse {
                    text,
                    phase: phase_after,
                    revision: hard.revision.0,
                })
            }
            Err(e) => {
                let msg = e.to_string();
                let is_cancel = msg == "Runtime execution error: cancelled by user";
                let final_status = if is_cancel { "cancelled" } else { "failed" };

                if !is_cancel {
                    self.emit(UiEvent::Error {
                        message: msg.clone(),
                    });
                    self.emit(UiEvent::Status {
                        phase: RunPhase::Failed,
                        message: msg.clone(),
                    });
                }

                if let Some(entry) = self.history.lock().await.last_mut() {
                    entry.status = final_status.into();
                }
                let _ = store
                    .save_session_entry(&StoredSessionEntry {
                        id: run_id,
                        prompt: req.prompt,
                        status: final_status.into(),
                        revision: None,
                        created_at,
                    })
                    .await;

                Err(e)
            }
        }
    }

    fn subscribe(&self) -> broadcast::Receiver<UiEvent> {
        self.event_tx.subscribe()
    }

    async fn initialize_goal(&self, prompt: &str) -> RivetResult<GoalSummaryDto> {
        self.emit(UiEvent::Status {
            phase: RunPhase::PreparingView,
            message: "Compiling GoalSpec...".into(),
        });
        let harness = self.harness.read().await.clone();
        let spec = harness.initialize_goal(prompt).await?;
        self.emit(UiEvent::Status {
            phase: RunPhase::Idle,
            message: format!(
                "Goal '{}' compiled with {} obligations",
                spec.summary,
                spec.graph.nodes.len()
            ),
        });
        Ok(GoalSummaryDto {
            summary: spec.summary.clone(),
            obligations_created: spec.graph.nodes.len(),
            graph_nodes: spec.graph.nodes.values().map(|n| n.title.clone()).collect(),
        })
    }

    async fn get_state(&self) -> RivetResult<StateDto> {
        self.build_state_dto().await
    }

    async fn get_obligations(&self) -> RivetResult<Vec<ObligationDto>> {
        let harness = self.harness.read().await.clone();
        let hard = harness.hard_state.lock().await;
        let mut out = Vec::new();
        for (id, desc) in &hard.obligations {
            out.push(ObligationDto {
                id: id.to_string(),
                description: desc.clone(),
                scope: hard
                    .obligation_scopes
                    .get(id)
                    .map(|s| format!("{:?}", s))
                    .unwrap_or_default(),
                status: "open".into(),
            });
        }
        for (id, receipt) in &hard.closed_obligations {
            out.push(ObligationDto {
                id: id.to_string(),
                description: hard
                    .obligations
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| format!("closed by {}", receipt)),
                scope: hard
                    .obligation_scopes
                    .get(id)
                    .map(|s| format!("{:?}", s))
                    .unwrap_or_default(),
                status: "closed".into(),
            });
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }

    async fn get_workspace(&self) -> RivetResult<SoftWorkspaceSummary> {
        let harness = self.harness.read().await.clone();
        Ok(summarize_soft(&harness.soft_workspace.lock().await.clone()))
    }

    async fn get_census(&self) -> RivetResult<CensusDto> {
        let root = self.root_dir.read().await.clone();
        let census = CensusRunner::run_census(&root)
            .await
            .map_err(|e| RivetError::Storage(format!("census failed: {}", e)))?;
        Ok(CensusDto {
            total_files: census.total_files,
            total_bytes: census.total_bytes,
            deferred_count: census.deferred_count,
            directories: census
                .directories
                .iter()
                .take(128)
                .map(|d| DirectoryDto {
                    relative_path: d.relative_path.clone(),
                    file_count: d.file_count,
                    total_bytes: d.total_bytes,
                    relevance: format!("{:?}", d.relevance),
                    signals: d.signals.iter().map(|s| format!("{:?}", s)).collect(),
                })
                .collect(),
        })
    }

    async fn get_cognitive_view(&self, goal: &str) -> RivetResult<CognitiveView> {
        let harness = self.harness.read().await.clone();
        Ok(harness.compile_view(goal).await)
    }

    async fn health(&self) -> RivetResult<HealthDto> {
        let harness = self.harness.read().await.clone();
        let hard = harness.hard_state.lock().await;
        let phase = harness.current_phase().await;
        let config = self.active_config.read().await;
        Ok(HealthDto {
            status: "ok".into(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            harness_phase: phase,
            hard_revision: hard.revision.0,
            provider: config.provider.clone(),
            model_id: config.model_id.clone(),
        })
    }

    async fn cancel(&self) -> RivetResult<()> {
        if let Some(cancel) = self.active_cancel.lock().await.take() {
            let _ = cancel.send(());
        }
        let harness = self.harness.read().await.clone();
        harness.cancel().await;
        self.emit(UiEvent::Status {
            phase: RunPhase::Cancelled,
            message: "Cancelled by user".into(),
        });
        self.emit(UiEvent::Cancelled {
            message: "Cancellation requested by user".into(),
        });
        Ok(())
    }

    async fn steer(&self, req: StepRequest) -> RivetResult<StepResponse> {
        self.emit(UiEvent::SteerAccepted {
            prompt: req.prompt.clone(),
        });
        let harness = self.harness.read().await.clone();
        let current_phase = harness.current_phase().await;
        if current_phase != RunPhase::Idle
            && current_phase != RunPhase::Completed
            && current_phase != RunPhase::Failed
            && current_phase != RunPhase::Cancelled
        {
            harness.steer(&req.prompt).await;
            let hard = harness.hard_state.lock().await;
            Ok(StepResponse {
                text: format!(
                    "Steering directive '{}' injected into active run",
                    req.prompt
                ),
                phase: current_phase,
                revision: hard.revision.0,
            })
        } else {
            self.step(req).await
        }
    }

    async fn get_project(&self) -> RivetResult<ProjectDto> {
        let root = self.root_dir.read().await.clone();
        let harness = self.harness.read().await.clone();
        let branch = git_output(&root, &["branch", "--show-current"]);
        let revision = git_output(&root, &["rev-parse", "--short", "HEAD"]);
        let dirty = git_output(&root, &["status", "--porcelain"])
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        Ok(ProjectDto {
            id: harness.repository_id().to_string(),
            name: harness.repository_id().to_string(),
            path: root.display().to_string(),
            branch,
            revision,
            dirty,
        })
    }

    async fn get_models(&self) -> RivetResult<ModelCatalogDto> {
        let config = self.active_config.read().await.clone();
        let auth_data = self.auth_store.load().unwrap_or_default();
        let mut providers = Vec::new();
        for provider in get_known_providers() {
            let models = if provider.id == config.provider {
                ProviderRegistry::get_available_models(&provider.id, &self.auth_store).await
            } else {
                provider.standard_models.clone()
            };

            let auth_entry = auth_data.providers.get(&provider.id);
            let masked_key = auth_entry.map(|a| AuthStore::mask_key(a.api_key()));
            let base_url = auth_entry.and_then(|a| a.base_url().map(str::to_string));
            let is_configured =
                auth_entry.is_some() || provider.id == "ollama" || provider.id == "mock";

            providers.push(ProviderDto {
                id: provider.id.clone(),
                name: provider.name,
                models,
                configured: is_configured,
                masked_key,
                base_url,
            });
        }
        Ok(ModelCatalogDto {
            active_provider: config.provider,
            active_model: config.model_id,
            providers,
        })
    }

    async fn select_model(&self, provider: &str, model: &str) -> RivetResult<ModelCatalogDto> {
        let resolved = ProviderRegistry::resolve(Some(provider), Some(model), &self.auth_store)
            .map_err(|e| RivetError::Model(e.to_string()))?;
        let backend: Arc<dyn ModelBackend> = if resolved.provider == "opencode" {
            Arc::new(rivet_model_genai::GenAiBackend::with_config(
                opencode_endpoint(resolved.base_url.as_deref()),
                resolved.api_key.clone(),
            ))
        } else {
            Arc::new(rivet_model_rig::RigBackend::from_resolved(&resolved))
        };
        self.dynamic_backend.set_backend(backend).await;
        *self.active_config.write().await = resolved.clone();
        self.get_models().await
    }

    async fn save_auth(&self, req: SaveAuthRequest) -> RivetResult<ModelCatalogDto> {
        self.auth_store
            .set_provider_config(
                &req.provider,
                &req.key,
                req.base_url.as_deref(),
                req.default_model.as_deref(),
                req.models,
            )
            .map_err(|e| RivetError::Storage(format!("Failed to save auth: {e}")))?;

        // If saved provider is current active, re-resolve
        let active_cfg = self.active_config.read().await.clone();
        if active_cfg.provider == req.provider {
            let model = req.default_model.as_deref().unwrap_or(&active_cfg.model_id);
            let _ = self.select_model(&req.provider, model).await;
        }

        self.get_models().await
    }

    async fn remove_auth(&self, provider: &str) -> RivetResult<ModelCatalogDto> {
        self.auth_store
            .remove(provider)
            .map_err(|e| RivetError::Storage(format!("Failed to remove auth: {e}")))?;
        self.get_models().await
    }

    async fn open_project(&self, path: &Path) -> RivetResult<ProjectDto> {
        use rivet_runtime::Runtime;

        if !path.exists() || !path.is_dir() {
            return Err(RivetError::Runtime(format!(
                "Directory does not exist: {}",
                path.display()
            )));
        }

        let canonical = path
            .canonicalize()
            .map_err(|e| RivetError::Runtime(format!("Failed to canonicalize path: {e}")))?;

        let state_dir = canonical.join(".rivet");
        tokio::fs::create_dir_all(&state_dir)
            .await
            .map_err(|e| RivetError::Storage(e.to_string()))?;
        let store: Arc<dyn HardStateStore> =
            Arc::new(RedbStore::open(state_dir.join("state.redb"))?);

        let runtime = Arc::new(Runtime::new(&canonical));
        let repository_id = canonical
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|n| !n.is_empty())
            .unwrap_or("rivet")
            .to_string();

        let event_tx_for_harness = self.event_tx.clone();
        let harness = Arc::new(
            HarnessCore::open(store.clone(), self.dynamic_backend.clone(), runtime)
                .await?
                .with_repository_id(repository_id)
                .with_event_sink(Arc::new(move |event| {
                    if let Some(ui_event) = harness_event_to_ui(event) {
                        let _ = event_tx_for_harness.send(ui_event);
                    }
                })),
        );

        if let Ok(census) = CensusRunner::run_census(&canonical).await {
            let frontier = census.active_paths(64);
            let signals = census
                .directories
                .iter()
                .take(64)
                .map(|d| {
                    format!(
                        "{} files={} bytes={} relevance={:?} signals={:?}",
                        d.relative_path, d.file_count, d.total_bytes, d.relevance, d.signals
                    )
                })
                .collect();
            harness.set_relevant_files(frontier).await;
            harness.set_repository_signals(signals).await;
        }

        // Restore history for new project
        let history_entries: Vec<HistoryEntryDto> = store
            .list_session_entries()
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|s| HistoryEntryDto {
                id: s.id,
                prompt: s.prompt,
                status: s.status,
                revision: s.revision,
                created_at: s.created_at,
            })
            .collect();

        *self.harness.write().await = harness;
        *self.root_dir.write().await = canonical.clone();
        *self.store.write().await = store;
        *self.history.lock().await = history_entries;

        self.emit(UiEvent::Status {
            phase: RunPhase::Idle,
            message: format!("Opened project {}", canonical.display()),
        });

        self.get_project().await
    }

    async fn get_mcp_status(&self) -> RivetResult<Vec<McpServerStatusDto>> {
        let root = self.root_dir.read().await.clone();
        let Some(config) = McpConfigFile::load_from_workspace(&root)? else {
            return Ok(Vec::new());
        };

        let mut out = Vec::new();
        for (name, srv) in config.mcp_servers {
            let (tools, status) = if srv.disabled {
                (Vec::new(), "disabled".to_string())
            } else {
                let transport = StdioProcessTransport::new(srv.command.clone(), srv.args.clone())
                    .with_working_dir(root.clone());
                let bridge = McpCapabilityBridge::new(name.clone(), Arc::new(transport));
                match bridge.discover_capabilities().await {
                    Ok(t) => (t, "connected".to_string()),
                    Err(e) => (Vec::new(), format!("error: {e}")),
                }
            };

            out.push(McpServerStatusDto {
                name,
                command: srv.command,
                args: srv.args,
                disabled: srv.disabled,
                tools_count: tools.len(),
                tools,
                status,
            });
        }
        Ok(out)
    }

    async fn get_history(&self) -> RivetResult<Vec<HistoryEntryDto>> {
        Ok(self.history.lock().await.clone())
    }

    async fn get_diff(&self) -> RivetResult<DiffDto> {
        let root = self.root_dir.read().await.clone();
        let text = git_output_raw(&root, &["diff", "HEAD"]).unwrap_or_default();
        let files = text
            .lines()
            .filter_map(|line| line.strip_prefix("diff --git a/"))
            .filter_map(|line| line.split_once(" b/").map(|(_, path)| path.to_string()))
            .collect();
        Ok(DiffDto {
            status: if text.trim().is_empty() {
                "clean".into()
            } else {
                "modified".into()
            },
            text,
            files,
        })
    }

    async fn current_phase(&self) -> RivetResult<RunPhase> {
        let harness = self.harness.read().await.clone();
        Ok(harness.current_phase().await)
    }

    async fn clear_hypotheses(&self) -> RivetResult<()> {
        let harness = self.harness.read().await.clone();
        harness.soft_workspace.lock().await.hypotheses.clear();
        Ok(())
    }

    async fn add_hypothesis(&self, hypothesis: &str) -> RivetResult<()> {
        let harness = self.harness.read().await.clone();
        harness
            .soft_workspace
            .lock()
            .await
            .add_hypothesis(hypothesis.to_string());
        Ok(())
    }
}

fn harness_event_to_ui(event: HarnessEvent) -> Option<UiEvent> {
    Some(match event {
        HarnessEvent::Phase { phase, message } => UiEvent::Status { phase, message },
        HarnessEvent::CognitiveState {
            focus,
            hypothesis,
            status,
            evidence_count,
            counter_signal,
        } => UiEvent::CognitiveState {
            focus,
            hypothesis,
            status,
            evidence_count,
            counter_signal,
        },
        HarnessEvent::ToolCall {
            action_id,
            capability,
            target,
            status,
            summary,
            output_summary,
        } => UiEvent::ToolActivity {
            action_id,
            capability,
            target,
            status,
            summary,
            output_summary,
        },
        HarnessEvent::Observation {
            source,
            summary,
            evidence_id,
        } => UiEvent::Observation {
            source,
            summary,
            evidence_id,
        },
        HarnessEvent::Praxis {
            obligation_id,
            predicate,
            status,
            scope,
            diagnostics,
            receipt_id,
        } => UiEvent::PraxisUpdate {
            obligation_id,
            predicate,
            status,
            scope,
            diagnostics,
            receipt_id,
        },
        HarnessEvent::HardStateMutation {
            revision,
            mutation,
            entity_id,
            from,
            to,
        } => UiEvent::HardStateMutation {
            revision,
            mutation,
            entity_id,
            from,
            to,
        },
    })
}

fn git_output(root: &Path, args: &[&str]) -> Option<String> {
    git_output_raw(root, args)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn git_output_raw(root: &Path, args: &[&str]) -> Option<String> {
    std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
}

fn opencode_endpoint(base_url: Option<&str>) -> String {
    let base = base_url
        .unwrap_or("https://opencode.ai/zen/go/v1")
        .trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

fn summarize_hard(hard: &HardState) -> HardStateSummary {
    HardStateSummary {
        revision: hard.revision.0,
        open_obligations: hard
            .obligations
            .iter()
            .map(|(id, desc)| ObligationDto {
                id: id.to_string(),
                description: desc.clone(),
                scope: hard
                    .obligation_scopes
                    .get(id)
                    .map(|s| format!("{:?}", s))
                    .unwrap_or_default(),
                status: "open".into(),
            })
            .collect(),
        closed_obligations: hard
            .closed_obligations
            .iter()
            .map(|(id, receipt)| ObligationDto {
                id: id.to_string(),
                description: format!("closed by {}", receipt),
                scope: hard
                    .obligation_scopes
                    .get(id)
                    .map(|s| format!("{:?}", s))
                    .unwrap_or_default(),
                status: "closed".into(),
            })
            .collect(),
        claims: hard
            .claims
            .values()
            .map(|c| ClaimDto {
                id: c.id.to_string(),
                proposition: c.proposition.clone(),
                status: format!("{:?}", c.status),
                supporting_evidence: c
                    .supporting_evidence
                    .iter()
                    .map(|e| e.to_string())
                    .collect(),
                scope: format!("{:?}", c.scope),
            })
            .collect(),
        contradictions: hard
            .contradictions
            .values()
            .map(|c| ContradictionDto {
                claim_id: c.claim_id.to_string(),
                reason: c.reason.clone(),
                contradicted_by: c.contradicted_by.iter().map(|e| e.to_string()).collect(),
                scope: format!("{:?}", c.scope),
            })
            .collect(),
        rejected_claims: hard
            .rejected_claims
            .values()
            .map(|r| RejectedDto {
                claim_id: r.claim_id.to_string(),
                reason: r.reason.clone(),
                evidence: r.evidence.iter().map(|e| e.to_string()).collect(),
            })
            .collect(),
        recent_evidence: hard
            .evidence
            .iter()
            .map(|(id, summary)| EvidenceDto {
                id: id.to_string(),
                summary: summary.clone(),
            })
            .collect(),
        verification_receipts: hard
            .verification_receipts
            .values()
            .map(|r| VerificationDto {
                receipt_id: r.receipt_id.to_string(),
                obligation_id: r.obligation_id.to_string(),
                passed: r.passed,
                diagnostics: r.diagnostics.clone(),
                scope: format!("{:?}", r.verified_scope),
            })
            .collect(),
        completed_tasks: hard.completed_tasks.keys().map(|k| k.to_string()).collect(),
    }
}
fn summarize_soft(soft: &SoftWorkspace) -> SoftWorkspaceSummary {
    SoftWorkspaceSummary {
        workspace_id: soft.workspace_id.to_string(),
        session_id: soft.session_id.to_string(),
        base_hard_revision: soft.base_hard_revision.0,
        active_focus: soft.active_focus.clone(),
        hypotheses: soft.hypotheses.clone(),
        unknowns: soft.unknowns.clone(),
        candidate_actions: soft.candidate_actions.clone(),
        item_count: soft.item_count(),
        max_capacity: soft.max_capacity_items,
    }
}
/// Convert HardStateSummary back to noesis::HardState for TUI compatibility.
/// Lossy: obligations map is reconstructed from the DTO.
impl HardStateSummary {
    pub fn to_hard_state(&self) -> noesis::HardState {
        use std::collections::HashMap;
        let default_scope = rivet_types::Scope::global("rivet", rivet_types::Revision(0));
        let mut obligations = HashMap::new();
        let mut obligation_scopes = HashMap::new();
        for o in &self.open_obligations {
            let id = rivet_types::ObligationId(o.id.clone());
            obligations.insert(id.clone(), o.description.clone());
            obligation_scopes.insert(id, default_scope.clone());
        }
        let mut claims = HashMap::new();
        for c in &self.claims {
            let id = rivet_types::ClaimId(c.id.clone());
            claims.insert(
                id,
                noesis::ClaimRecord {
                    id: rivet_types::ClaimId(c.id.clone()),
                    proposition: c.proposition.clone(),
                    status: match c.status.as_str() {
                        "Verified" => rivet_types::EpistemicStatus::Verified,
                        "Supported" => rivet_types::EpistemicStatus::Supported,
                        "Rejected" => rivet_types::EpistemicStatus::Rejected,
                        "Superseded" => rivet_types::EpistemicStatus::Superseded,
                        _ => rivet_types::EpistemicStatus::Hypothetical,
                    },
                    supporting_evidence: c
                        .supporting_evidence
                        .iter()
                        .map(|e| rivet_types::EvidenceId(e.clone()))
                        .collect(),
                    scope: default_scope.clone(),
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                },
            );
        }
        let mut evidence = HashMap::new();
        for e in &self.recent_evidence {
            evidence.insert(rivet_types::EvidenceId(e.id.clone()), e.summary.clone());
        }
        let mut verification_receipts = HashMap::new();
        for r in &self.verification_receipts {
            let receipt = accp::VerificationReceipt {
                receipt_id: rivet_types::ReceiptId(r.receipt_id.clone()),
                obligation_id: rivet_types::ObligationId(r.obligation_id.clone()),
                passed: r.passed,
                evidence_id: rivet_types::EvidenceId(r.receipt_id.clone()),
                verified_scope: default_scope.clone(),
                diagnostics: r.diagnostics.clone(),
                timestamp: chrono::Utc::now(),
            };
            verification_receipts
                .insert(rivet_types::ObligationId(r.obligation_id.clone()), receipt);
        }
        let mut closed_obligations = HashMap::new();
        for o in &self.closed_obligations {
            closed_obligations.insert(
                rivet_types::ObligationId(o.id.clone()),
                rivet_types::ReceiptId::new(),
            );
        }
        let mut completed_tasks = HashMap::new();
        for t in &self.completed_tasks {
            completed_tasks.insert(
                rivet_types::TaskId(t.clone()),
                rivet_types::ReceiptId(t.clone()),
            );
        }
        noesis::HardState {
            revision: rivet_types::Revision(self.revision),
            obligations,
            obligation_scopes,
            claims,
            contradictions: HashMap::new(),
            rejected_claims: HashMap::new(),
            evidence,
            execution_receipts: vec![],
            verification_receipts,
            closed_obligations,
            completed_tasks,
            model_invocations: vec![],
            active_task_id: None,
        }
    }
}

impl SoftWorkspaceSummary {
    pub fn to_soft_workspace(&self) -> noesis::SoftWorkspace {
        let mut ws = noesis::SoftWorkspace::new(
            rivet_types::SessionId(self.session_id.clone()),
            rivet_types::Revision(self.base_hard_revision),
        );
        ws.active_focus = self.active_focus.clone();
        ws.hypotheses = self.hypotheses.clone();
        ws.unknowns = self.unknowns.clone();
        ws.candidate_actions = self.candidate_actions.clone();
        ws
    }
}

pub async fn create_service(
    target_dir: &Path,
    config: ResolvedProviderConfig,
) -> anyhow::Result<Arc<dyn RivetService>> {
    let auth_store = AuthStore::new();
    let svc = RivetServiceImpl::from_dir(target_dir, config, auth_store).await?;
    Ok(svc as Arc<dyn RivetService>)
}
