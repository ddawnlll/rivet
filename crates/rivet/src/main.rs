//! # Rivet CLI
//!
//! Generalist Epistemic Software Engineering Agent Runtime entrypoint.

use clap::{Parser, Subcommand};
use rivet_core::HarnessCore;
use rivet_model_genai::GenAiBackend;
use rivet_repository::CensusRunner;
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use std::path::PathBuf;
use std::sync::Arc;
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
        _ => {
            println!("\n🧠 Initializing Noesis Hard State & ACCP Engine...");
            let store = Arc::new(MemoryStore::new());
            let model = Arc::new(GenAiBackend::new());
            let runtime = Arc::new(Runtime::new(&target_dir));

            let harness = HarnessCore::new(store, model, runtime);

            // Run an initial deterministic census
            let census = CensusRunner::run_census(&target_dir).await?;
            println!(
                "📊 Census complete: {} active files, {} deferred trees.",
                census.total_files, census.deferred_count
            );

            let prompt = "Explain repository status and structure.";
            println!("\n💬 Prompt: {}", prompt);
            let response = harness.step("Understand repository baseline", prompt).await;
            match response {
                Ok(resp) => println!("\n🤖 Rivet Response:\n{}", resp),
                Err(e) => println!("\n⚠️ Note: No active LLM provider configured yet: {}", e),
            }
        }
    }

    Ok(())
}
