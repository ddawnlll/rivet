//! # Rivet CLI
//!
//! Generalist Epistemic Software Engineering Agent Runtime entrypoint.
//! Includes OpenCode-ported Auth & Multi-Provider commands (`rivet auth`, `rivet models`),
//! dynamic model discovery (/v1/models), and interactive TUI Cockpit.

use clap::{Parser, Subcommand};
use rivet_core::{HarnessCore, RunPhase};
use rivet_eval::{AblationMode, AblationScorecard, EvalRunner, ScenarioSuite};
use rivet_mcp::{McpCapabilityBridge, McpConfigFile, StdioProcessTransport};
use rivet_model::ModelBackend;
use rivet_model::auth::AuthStore;
use rivet_model::provider_hub::{
    ProviderRegistry, ResolvedProviderConfig, fetch_remote_models, get_known_providers,
};
use rivet_model_rig::RigBackend;
use rivet_repository::CensusRunner;
use rivet_runtime::Runtime;
use rivet_store::{HardStateStore, RedbStore};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing_subscriber::EnvFilter;
pub mod clipboard;
pub mod tui;

#[derive(Parser)]
#[command(
    name = "rivet",
    version = "0.3.0",
    about = "Generalist Epistemic Software Engineering Agent Runtime"
)]
struct Cli {
    #[arg(default_value = ".")]
    path: PathBuf,

    #[arg(long, help = "Launch full Ratatui interactive cockpit")]
    tui: bool,

    #[arg(
        long,
        help = "Select model provider (openai, anthropic, gemini, deepseek, ollama, custom)"
    )]
    provider: Option<String>,

    #[arg(long, help = "Select model ID")]
    model: Option<String>,

    #[arg(long, help = "Custom API key override")]
    api_key: Option<String>,

    #[arg(long, help = "Custom base URL endpoint")]
    base_url: Option<String>,

    #[arg(long, help = "Enable mechanical trace logging and decision receipts")]
    trace: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Inspect repository census and DEFER classification
    Census {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Start interactive cognitive CLI session
    Chat {
        #[arg(default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        provider: Option<String>,
        #[arg(long)]
        model: Option<String>,
    },
    /// Start interactive developer cockpit (TUI)
    Tui {
        #[arg(default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        provider: Option<String>,
        #[arg(long)]
        model: Option<String>,
    },
    /// Manage API keys, custom endpoints, and provider credentials
    Auth {
        #[command(subcommand)]
        sub: AuthSubcommands,
    },
    /// List available models and providers
    Models {
        /// Optional provider to query models for
        provider: Option<String>,
    },
    /// Start local HTTP API + Web GUI (RivetService projection)
    Serve {
        #[arg(default_value = ".")]
        path: PathBuf,
        #[arg(long, default_value = "127.0.0.1:3000")]
        addr: String,
        #[arg(long)]
        provider: Option<String>,
        #[arg(long)]
        model: Option<String>,
    },
    /// Run empirical ablation evaluation scenarios and scorecards
    Eval {
        /// Suite to evaluate: "v8" (default) or "alien"
        #[arg(long, default_value = "v8")]
        suite: String,
        #[arg(long)]
        provider: Option<String>,
        #[arg(long)]
        model: Option<String>,
        /// Optional path to save the generated markdown scorecard
        #[arg(long, short)]
        output: Option<PathBuf>,
    },
    /// Inspect configured MCP (Model Context Protocol) servers and tools
    Mcp {
        #[command(subcommand)]
        sub: Option<McpSubcommands>,
        #[arg(default_value = ".")]
        path: PathBuf,
    },
}

#[derive(Subcommand)]
enum McpSubcommands {
    /// List configured MCP servers and discovered tools
    List,
}

#[derive(Subcommand)]
enum AuthSubcommands {
    /// Save credentials or custom endpoint for a provider
    Login {
        /// Provider name (openai, anthropic, gemini, deepseek, openrouter, groq, ollama, or custom)
        provider: Option<String>,
        /// API key (if omitted, will prompt interactively)
        #[arg(long)]
        key: Option<String>,
        /// Custom Base URL (e.g. http://localhost:8000/v1)
        #[arg(long)]
        base_url: Option<String>,
        /// Default model ID
        #[arg(long)]
        model: Option<String>,
    },
    /// List configured provider credentials (keys are masked)
    List,
    /// Remove stored credentials for a provider
    Remove {
        /// Provider name to remove
        provider: String,
    },
    /// Set the default active provider
    Use {
        /// Provider name to activate
        provider: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let auth_store = AuthStore::new();

    let filter_level = if cli.trace {
        tracing::Level::DEBUG
    } else {
        tracing::Level::INFO
    };
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive(filter_level.into()))
        .init();

    // Handle Auth and Models commands before opening project state
    if let Some(Commands::Auth { sub }) = cli.command {
        return handle_auth_command(sub, &auth_store).await;
    }

    if let Some(Commands::Models { provider }) = &cli.command {
        return handle_models_command(provider.as_deref(), &auth_store).await;
    }

    if let Some(Commands::Eval {
        suite,
        provider,
        model,
        output,
    }) = &cli.command
    {
        return handle_eval_command(
            suite,
            provider.as_deref(),
            model.as_deref(),
            output.as_deref(),
            &auth_store,
        )
        .await;
    }

    if let Some(Commands::Mcp { sub: _, path }) = &cli.command {
        return handle_mcp_command(path).await;
    }

    let target_dir = cli.path.canonicalize().unwrap_or(cli.path.clone());

    println!("╔══════════════════════════════════════════════════════════════╗");
    println!("║                           RIVET v0.3                         ║");
    println!("║       Epistemic Software Engineering Agent Runtime           ║");
    println!("╚══════════════════════════════════════════════════════════════╝");
    println!("📁 Active Project: {}", target_dir.display());

    // Resolve provider & model credentials
    let (req_p, req_m) = match &cli.command {
        Some(Commands::Chat {
            provider, model, ..
        }) => (
            provider.as_deref().or(cli.provider.as_deref()),
            model.as_deref().or(cli.model.as_deref()),
        ),
        Some(Commands::Tui {
            provider, model, ..
        }) => (
            provider.as_deref().or(cli.provider.as_deref()),
            model.as_deref().or(cli.model.as_deref()),
        ),
        Some(Commands::Serve {
            provider, model, ..
        }) => (
            provider.as_deref().or(cli.provider.as_deref()),
            model.as_deref().or(cli.model.as_deref()),
        ),
        _ => (cli.provider.as_deref(), cli.model.as_deref()),
    };

    let mut resolved = ProviderRegistry::resolve(req_p, req_m, &auth_store)?;
    if let Some(key) = cli.api_key {
        resolved.api_key = Some(key);
    }
    if let Some(base) = cli.base_url {
        resolved.base_url = Some(base);
    }

    println!("🤖 {}", ProviderRegistry::format_status(&resolved));

    if cli.tui {
        return run_tui(&target_dir, resolved, auth_store).await;
    }

    // `rivet serve` — zero-latency WebSocket + REST projection (local, secure)
    if let Some(Commands::Serve { path, addr, .. }) = &cli.command {
        let target = path.canonicalize().unwrap_or(path.clone());
        return run_serve(&target, addr, resolved, auth_store).await;
    }

    match cli.command {
        Some(Commands::Census { path }) => {
            println!("\n🔍 Running deterministic census on {}...", path.display());
            let census = CensusRunner::run_census(&path).await?;
            println!("✅ Total Files: {}", census.total_files);
            println!(
                "📦 Total Size: {:.2} MB",
                census.total_bytes as f64 / 1_048_576.0
            );
            println!("⏸️  Deferred Trees: {}", census.deferred_count);
        }
        Some(Commands::Chat { path, .. }) => run_chat(&path, resolved, cli.trace).await?,
        Some(Commands::Tui { path, .. }) => run_tui(&path, resolved, auth_store).await?,
        _ => {
            run_chat(&target_dir, resolved, cli.trace).await?;
        }
    }

    Ok(())
}

fn create_backend(config: &ResolvedProviderConfig) -> Arc<dyn ModelBackend> {
    Arc::new(RigBackend::from_resolved(config))
}

async fn run_serve(
    target_dir: &Path,
    addr: &str,
    config: ResolvedProviderConfig,
    auth_store: AuthStore,
) -> anyhow::Result<()> {
    println!("\n🚀 Starting RivetService (zero-latency) on {}...", addr);
    println!(
        "   WS: ws://{}/api/ws  |  REST: http://{}/api/*  |  SSE fallback: /api/stream",
        addr, addr
    );
    println!("   Security: localhost-only bind + optional RIVET_TOKEN bearer");
    // RivetService already wraps model with BroadcastModelBackend for per-token streaming
    let service = rivet_service::RivetServiceImpl::from_dir(target_dir, config, auth_store).await?;
    // Detect web/dist relative to repo root and target_dir
    let candidates = [
        PathBuf::from("web/dist"),
        target_dir.join("web/dist"),
        PathBuf::from("../web/dist"),
    ];
    let web_dist = candidates.into_iter().find(|p| p.exists());
    if let Some(ref p) = web_dist {
        println!("📦 Serving Web GUI from {}", p.display());
    } else {
        println!(
            "ℹ️  Web GUI not built yet (web/dist missing) — API only. Run `cd web && npm run build` after design agent finishes."
        );
    }
    rivet_api::serve(
        service as Arc<dyn rivet_service::RivetService>,
        addr,
        web_dist,
    )
    .await
}

async fn run_tui(
    target_dir: &Path,
    config: ResolvedProviderConfig,
    auth_store: AuthStore,
) -> anyhow::Result<()> {
    let svc =
        rivet_service::RivetServiceImpl::from_dir(target_dir, config.clone(), auth_store.clone())
            .await?;
    let initial_model = create_backend(&config);
    let dynamic_backend = Arc::new(rivet_model::DynamicModelBackend::new(initial_model));

    let mut app = tui::TuiApp::new(
        svc as Arc<dyn rivet_service::RivetService>,
        dynamic_backend,
        auth_store,
        config,
        target_dir.to_path_buf(),
    );
    app.run().await
}

async fn run_chat(
    target_dir: &Path,
    config: ResolvedProviderConfig,
    trace: bool,
) -> anyhow::Result<()> {
    println!("\n🧠 Initializing Noesis Hard State & ACCP Engine...");
    let state_dir = target_dir.join(".rivet");
    tokio::fs::create_dir_all(&state_dir).await?;
    let store: Arc<dyn HardStateStore> = Arc::new(RedbStore::open(state_dir.join("state.redb"))?);
    let model = create_backend(&config);
    let runtime = Arc::new(Runtime::new(target_dir));
    let repository_id = target_dir
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("rivet");
    let harness = HarnessCore::open(store, model, runtime)
        .await?
        .with_repository_id(repository_id);

    let census = CensusRunner::run_census(target_dir).await?;
    let frontier = census.active_paths(64);
    let repository_signals = census
        .directories
        .iter()
        .take(64)
        .map(|directory| {
            format!(
                "{} files={} bytes={} relevance={:?} signals={:?}",
                directory.relative_path,
                directory.file_count,
                directory.total_bytes,
                directory.relevance,
                directory.signals
            )
        })
        .collect();
    harness.set_relevant_files(frontier.clone()).await;
    harness.set_repository_signals(repository_signals).await;
    println!(
        "📊 Census complete: {} files, {} frontier files, {} directory signals, {} deferred trees.",
        census.total_files,
        frontier.len(),
        census.directories.len(),
        census.deferred_count
    );

    if config.api_key.is_none() && !matches!(config.provider.as_str(), "ollama" | "local") {
        println!(
            "\n⚠️  No API key configured for provider '{}'.",
            config.provider
        );
        println!(
            "👉 Run `rivet auth login {}` or pass `--api-key <key>` to configure.",
            config.provider
        );
    }

    println!("\n💬 Interactive session. Type :quit or /help for options.");
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    loop {
        print!("\nrivet [{}:{}]> ", config.provider, config.model_id);
        std::io::stdout().flush()?;
        let Some(line) = lines.next_line().await? else {
            break;
        };
        let prompt = line.trim();
        if matches!(prompt, ":quit" | ":q" | "exit") {
            break;
        }
        if prompt.is_empty() {
            continue;
        }
        if prompt == "/help" {
            println!("Commands: :quit, /census, /help, /goal <prompt>");
            continue;
        }
        if prompt.starts_with("/goal ") {
            let g = prompt.strip_prefix("/goal ").unwrap().trim();
            match harness.initialize_goal(g).await {
                Ok(spec) => println!(
                    "🎯 Compiled GoalSpec with {} obligations.",
                    spec.graph.nodes.len()
                ),
                Err(e) => println!("⚠️ Goal compilation error: {}", e),
            }
            continue;
        }

        let goal_description = {
            let spec = harness.goal_spec.lock().await;
            spec.as_ref()
                .map(|s| s.summary.clone())
                .unwrap_or_else(|| "Repository engineering session".to_string())
        };

        let max_turns = 25;
        let mut turn = 0;
        let mut current_prompt = prompt.to_string();

        loop {
            turn += 1;
            if turn > max_turns {
                println!(
                    "\n⚠️ Autonomous loop reached maximum turn limit ({max_turns}). Pausing for user interaction."
                );
                break;
            }

            if trace {
                let hard = harness.hard_state.lock().await;
                println!(
                    "🔍 [TRACE Turn {turn}] Pre-step Hard Revision: {}, Active Claims: {}, Contradictions: {}, Open Obligations: {}",
                    hard.revision,
                    hard.claims.len(),
                    hard.contradictions.len(),
                    hard.obligations.len()
                );
            }

            match harness.step(&goal_description, &current_prompt).await {
                Ok(response) => {
                    let phase = harness.current_phase().await;
                    if trace {
                        let hard = harness.hard_state.lock().await;
                        println!(
                            "🔍 [TRACE Turn {turn}] Post-step Phase: {:?}, Revision: {}, Verified Receipts: {}",
                            phase,
                            hard.revision,
                            hard.verification_receipts.len()
                        );
                    }
                    println!("\n🤖 Rivet [Turn {turn}]:\n{response}");

                    if matches!(
                        phase,
                        RunPhase::Completed
                            | RunPhase::Failed
                            | RunPhase::Stagnated
                            | RunPhase::WaitingForUser
                            | RunPhase::Cancelled
                    ) {
                        break;
                    }

                    // Check if model returned pure prose (no tool calls, etc.) and is not asking for another step
                    let hard = harness.hard_state.lock().await;
                    let last_invocation = hard.model_invocations.last();
                    if last_invocation.is_none() {
                        break;
                    }

                    // Next turn continuation prompt
                    current_prompt =
                        "Observation recorded. Proceed with next step or complete the task."
                            .to_string();
                }
                Err(error) => {
                    println!("\n⚠️ Model/session error at turn {turn}: {}", error);
                    break;
                }
            }
        }
    }
    Ok(())
}

async fn handle_auth_command(sub: AuthSubcommands, store: &AuthStore) -> anyhow::Result<()> {
    match sub {
        AuthSubcommands::Login {
            provider,
            key,
            base_url,
            model,
        } => {
            let provider = if let Some(p) = provider {
                p.to_lowercase()
            } else {
                print!(
                    "Select Provider [openai, anthropic, gemini, deepseek, openrouter, groq, ollama, custom]: "
                );
                io::stdout().flush()?;
                let mut p = String::new();
                io::stdin().read_line(&mut p)?;
                p.trim().to_lowercase()
            };

            if provider.is_empty() {
                println!("❌ Provider cannot be empty.");
                return Ok(());
            }

            let base_url = if let Some(b) = base_url {
                Some(b)
            } else if provider == "custom" || provider == "ollama" {
                let default_url = if provider == "ollama" {
                    "http://localhost:11434/v1"
                } else {
                    "http://localhost:8000/v1"
                };
                print!("Enter Base URL Endpoint [{}]: ", default_url);
                io::stdout().flush()?;
                let mut b = String::new();
                io::stdin().read_line(&mut b)?;
                let trimmed = b.trim();
                if trimmed.is_empty() {
                    Some(default_url.to_string())
                } else {
                    Some(trimmed.to_string())
                }
            } else {
                None
            };

            let key = if let Some(k) = key {
                k
            } else if provider == "ollama" {
                "none".to_string()
            } else {
                print!("Enter API Key for '{}': ", provider);
                io::stdout().flush()?;
                let mut k = String::new();
                io::stdin().read_line(&mut k)?;
                k.trim().to_string()
            };

            // Attempt remote discovery
            let mut discovered = Vec::new();
            if let Some(ref url) = base_url {
                let k = if key.is_empty() || key == "none" {
                    None
                } else {
                    Some(key.as_str())
                };
                if let Ok(m) = fetch_remote_models(url, k).await {
                    discovered = m;
                }
            }

            let default_model = model.or_else(|| discovered.first().cloned());

            store.set_provider_config(
                &provider,
                &key,
                base_url.as_deref(),
                default_model.as_deref(),
                discovered.clone(),
            )?;

            println!(
                "✅ Successfully saved credentials for '{}' (masked: {}, discovered {} models)",
                provider,
                AuthStore::mask_key(&key),
                discovered.len()
            );
            println!("📍 Stored in: {}", AuthStore::default_auth_path().display());
        }
        AuthSubcommands::List => {
            let all = store.all()?;
            let active = store.get_active_provider()?.unwrap_or_default();
            println!(
                "🔑 Configured Provider Credentials (stored in {}):",
                AuthStore::default_auth_path().display()
            );
            if all.is_empty() {
                println!("  (No credentials configured yet. Run `rivet auth login <provider>`)");
                return Ok(());
            }
            for (p, info) in &all {
                let is_active = if *p == active { " [ACTIVE]" } else { "" };
                let endpoint = info.base_url().unwrap_or("Standard SDK Gateway");
                println!(
                    "  • {:<15} : {:<20} | Endpoint: {} (Models: {}){}",
                    p,
                    AuthStore::mask_key(info.api_key()),
                    endpoint,
                    info.models().len(),
                    is_active
                );
            }
        }
        AuthSubcommands::Remove { provider } => {
            if store.remove(&provider)? {
                println!("✅ Removed credentials for '{}'.", provider);
            } else {
                println!("⚠️ No credentials found for '{}'.", provider);
            }
        }
        AuthSubcommands::Use { provider } => {
            store.set_active_provider(&provider)?;
            println!("✅ Set active default provider to '{}'.", provider);
        }
    }
    Ok(())
}

async fn handle_models_command(
    provider_filter: Option<&str>,
    store: &AuthStore,
) -> anyhow::Result<()> {
    let auth_data = store.load().unwrap_or_default();
    let known = get_known_providers();

    if let Some(provider) = provider_filter {
        println!("🔍 Querying models for provider '{}'...", provider);
        let models = ProviderRegistry::get_available_models(provider, store).await;
        println!("Available Models ({} total):", models.len());
        for m in models {
            println!("  • {}", m);
        }
        return Ok(());
    }

    println!("📚 Configured Providers & Dynamic Models:");
    if auth_data.providers.is_empty() {
        println!(
            "  (No providers connected yet. Run `rivet auth login <provider>` or `rivet tui`)"
        );
    } else {
        for (p_id, info) in &auth_data.providers {
            let active_tag = if auth_data.active_provider.as_deref() == Some(p_id) {
                " [ACTIVE]"
            } else {
                ""
            };
            let models = ProviderRegistry::get_available_models(p_id, store).await;
            println!("\n  📦 Provider: {}{}", p_id, active_tag);
            println!(
                "     Endpoint: {}",
                info.base_url().unwrap_or("Standard API")
            );
            println!("     Models ({}) : {}", models.len(), models.join(", "));
        }
    }

    println!("\n🌐 Known Providers available to connect:");
    for p in known {
        let is_connected = auth_data.providers.contains_key(&p.id);
        let status = if is_connected {
            "✓ Connected"
        } else {
            "+ Available"
        };
        println!("  • {:<12} {:<15} {}", p.id, status, p.description);
    }
    println!(
        "\n💡 Tip: Connect any custom endpoint with `rivet auth login custom --base-url http://localhost:8000/v1`"
    );
    Ok(())
}

async fn handle_eval_command(
    suite: &str,
    requested_provider: Option<&str>,
    requested_model: Option<&str>,
    output_path: Option<&Path>,
    auth_store: &AuthStore,
) -> anyhow::Result<()> {
    println!("🔬 Rivet Empirical Evaluation Runner");
    println!("--------------------------------------");

    let scenarios = if suite == "alien" {
        println!("📋 Loaded Suite: Alien Benchmark Suite (3 scenarios)");
        ScenarioSuite::alien_suite()
    } else {
        println!(
            "📋 Loaded Suite: Standard V8 Transformation Suite ({} scenarios)",
            ScenarioSuite::standard_v8_suite().len()
        );
        ScenarioSuite::standard_v8_suite()
    };

    let resolved_config =
        ProviderRegistry::resolve(requested_provider, requested_model, auth_store).unwrap_or_else(
            |_| ResolvedProviderConfig {
                provider: "mock".into(),
                model_id: "mock-eval-model".into(),
                api_key: None,
                base_url: None,
            },
        );

    println!(
        "🤖 Evaluation Backend: {} ({})
",
        resolved_config.provider, resolved_config.model_id
    );

    let model: Arc<dyn ModelBackend> = if resolved_config.provider == "opencode" {
        Arc::new(rivet_model_genai::GenAiBackend::with_config(
            "https://opencode.ai/zen/go/v1/chat/completions",
            resolved_config.api_key.clone(),
        ))
    } else {
        Arc::new(RigBackend::from_resolved(&resolved_config))
    };

    let modes = [
        AblationMode::FullRivet,
        AblationMode::NoHardState,
        AblationMode::NoPraxisVerity,
        AblationMode::NoHephaestus,
    ];

    let mut scorecards = Vec::new();
    for mode in modes {
        print!("Running ablation mode {:<25} ... ", format!("{:?}", mode));
        io::stdout().flush()?;
        let mut results = Vec::new();
        for scenario in &scenarios {
            let res = EvalRunner::run_scenario(scenario, mode, model.clone()).await;
            results.push(res);
        }
        let card = AblationScorecard::from_results(mode, &results);
        println!(
            "PASS: {}/{} ({:.1}%, avg {} turns, avg {} tokens)",
            card.scenarios_passed,
            card.scenarios_tested,
            card.pass_rate_pct,
            card.avg_turns,
            card.avg_tokens
        );
        scorecards.push(card);
    }

    let markdown = AblationScorecard::render_markdown_comparison(&scorecards);
    println!("\n{markdown}");

    if let Some(path) = output_path {
        std::fs::write(path, &markdown)?;
        println!("💾 Scorecard saved to {}", path.display());
    }

    Ok(())
}

async fn handle_mcp_command(path: &Path) -> anyhow::Result<()> {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    println!("🔌 Rivet Model Context Protocol (MCP) Manager");
    println!("📁 Target directory: {}", canonical.display());

    let Some(config) = McpConfigFile::load_from_workspace(&canonical)? else {
        println!("\n⚠️  No .rivet/mcp.json found in this directory.");
        println!("💡 Create a .rivet/mcp.json file to configure external MCP servers.");
        println!("Example:");
        println!(
            r#"{{
  "mcpServers": {{
    "sqlite": {{
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "app.db"]
    }}
  }}
}}"#
        );
        return Ok(());
    };

    println!(
        "\nConfigured MCP Servers ({} total):",
        config.mcp_servers.len()
    );
    for (name, srv) in &config.mcp_servers {
        let status = if srv.disabled {
            "[DISABLED]"
        } else {
            "[ENABLED]"
        };
        println!("\n  🔹 Server: {} {}", name, status);
        println!("     Command: {} {}", srv.command, srv.args.join(" "));
        if !srv.disabled {
            let transport = StdioProcessTransport::new(srv.command.clone(), srv.args.clone())
                .with_working_dir(canonical.clone());
            let bridge = McpCapabilityBridge::new(name.clone(), Arc::new(transport));
            match bridge.discover_capabilities().await {
                Ok(tools) => {
                    println!("     Tools ({}) :", tools.len());
                    for t in tools {
                        println!("       • {:<35} {}", t.capability_id, t.description);
                    }
                }
                Err(e) => {
                    println!("     Discovery status: ⚠️  Could not connect ({})", e);
                }
            }
        }
    }
    Ok(())
}
