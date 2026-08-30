//! # Rivet CLI
//!
//! Generalist Epistemic Software Engineering Agent Runtime entrypoint.

use clap::{Parser, Subcommand};
use rivet_core::HarnessCore;
use rivet_model_genai::GenAiBackend;
use rivet_repository::CensusRunner;
use rivet_runtime::Runtime;
use rivet_store::{HardStateStore, RedbStore};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(
    name = "rivet",
    version = "0.3.0",
    about = "Generalist Epistemic Software Engineering Agent Runtime"
)]
struct Cli {
    #[arg(default_value = ".")]
    path: PathBuf,

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
    /// Start interactive cognitive session
    Chat {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .init();

    let cli = Cli::parse();
    let target_dir = cli.path.canonicalize().unwrap_or(cli.path.clone());

    println!("╔══════════════════════════════════════════════════════════════╗");
    println!("║                           RIVET v0.3                         ║");
    println!("║       Epistemic Software Engineering Agent Runtime           ║");
    println!("╚══════════════════════════════════════════════════════════════╝");
    println!("📁 Active Project: {}", target_dir.display());

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
        Some(Commands::Chat { path }) => run_chat(&path).await?,
        _ => {
            run_chat(&target_dir).await?;
        }
    }

    Ok(())
}

async fn run_chat(target_dir: &Path) -> anyhow::Result<()> {
    println!("\n🧠 Initializing Noesis Hard State & ACCP Engine...");
    let state_dir = target_dir.join(".rivet");
    tokio::fs::create_dir_all(&state_dir).await?;
    let store: Arc<dyn HardStateStore> = Arc::new(RedbStore::open(state_dir.join("state.redb"))?);
    let model = Arc::new(GenAiBackend::new());
    let runtime = Arc::new(Runtime::new(target_dir));
    let repository_id = target_dir
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("rivet");
    let harness = HarnessCore::open(store, model, runtime)
        .await?
        .with_repository_id(repository_id);

    let census = CensusRunner::run_census(&target_dir).await?;
    let frontier = census.active_paths(64);
    harness.set_relevant_files(frontier.clone()).await;
    println!(
        "📊 Census complete: {} files, {} frontier files, {} deferred trees.",
        census.total_files,
        frontier.len(),
        census.deferred_count
    );

    println!("\n💬 Interactive session. Type :quit to exit.");
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    loop {
        print!("\nrivet> ");
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
        match harness.step("Repository engineering session", prompt).await {
            Ok(response) => println!("\n🤖 Rivet Response:\n{}", response),
            Err(error) => println!("\n⚠️ Model/session error: {}", error),
        }
    }
    Ok(())
}
