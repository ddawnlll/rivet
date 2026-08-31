//! # Rivet CLI
//!
//! Generalist Epistemic Software Engineering Agent Runtime entrypoint.
//! Includes OpenCode-ported Auth & Multi-Provider commands (`rivet auth`, `rivet models`),
//! dynamic model discovery (/v1/models), and interactive TUI Cockpit.

use clap::{Parser, Subcommand};
use rivet_core::HarnessCore;
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
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .init();

    let cli = Cli::parse();
    let auth_store = AuthStore::new();

    // Handle Auth and Models commands before opening project state
    if let Some(Commands::Auth { sub }) = cli.command {
        return handle_auth_command(sub, &auth_store).await;
    }

    if let Some(Commands::Models { provider }) = cli.command {
        return handle_models_command(provider.as_deref(), &auth_store).await;
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
        Some(Commands::Chat { path, .. }) => run_chat(&path, resolved).await?,
        Some(Commands::Tui { path, .. }) => run_tui(&path, resolved, auth_store).await?,
        _ => {
            run_chat(&target_dir, resolved).await?;
        }
    }

    Ok(())
}

fn create_backend(config: &ResolvedProviderConfig) -> Arc<dyn ModelBackend> {
    Arc::new(RigBackend::from_resolved(config))
}

async fn run_tui(
    target_dir: &Path,
    config: ResolvedProviderConfig,
    auth_store: AuthStore,
) -> anyhow::Result<()> {
    let state_dir = target_dir.join(".rivet");
    tokio::fs::create_dir_all(&state_dir).await?;
    let store: Arc<dyn HardStateStore> = Arc::new(RedbStore::open(state_dir.join("state.redb"))?);
    let initial_model = create_backend(&config);
    let dynamic_backend = Arc::new(rivet_model::DynamicModelBackend::new(initial_model));
    let runtime = Arc::new(Runtime::new(target_dir));
    let repository_id = target_dir
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("rivet");
    let harness = Arc::new(
        HarnessCore::open(store, dynamic_backend.clone(), runtime)
            .await?
            .with_repository_id(repository_id),
    );

    let mut app = tui::TuiApp::new(
        harness,
        dynamic_backend,
        auth_store,
        config,
        target_dir.to_path_buf(),
    );
    app.run().await
}

async fn run_chat(target_dir: &Path, config: ResolvedProviderConfig) -> anyhow::Result<()> {
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

        match harness.step("Repository engineering session", prompt).await {
            Ok(response) => println!("\n🤖 Rivet Response:\n{}", response),
            Err(error) => println!("\n⚠️ Model/session error: {}", error),
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
