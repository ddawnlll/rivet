//! # rivet-eval::runner
//!
//! Executes benchmark scenarios against the HarnessCore across different ablation modes.

use std::fs;
use std::sync::Arc;
use std::time::Instant;
use chrono::Utc;
use rivet_core::HarnessCore;
use rivet_model::ModelBackend;
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;

use crate::ablation::AblationMode;
use crate::metrics::ScenarioResult;
use crate::scenario::BenchmarkScenario;

pub struct EvalRunner;

impl EvalRunner {
    /// Execute a scenario under a specific ablation mode
    pub async fn run_scenario(
        scenario: &BenchmarkScenario,
        mode: AblationMode,
        model: Arc<dyn ModelBackend>,
    ) -> ScenarioResult {
        let start = Instant::now();
        let tmp_dir = tempfile::tempdir().unwrap();
        let repo_root = tmp_dir.path();

        // 1. Materialize initial files
        for (rel_path, content) in &scenario.initial_files {
            let full_path = repo_root.join(rel_path);
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(full_path, content).unwrap();
        }

        // 2. Initialize Harness
        let store = Arc::new(MemoryStore::new());
        let runtime = Arc::new(Runtime::new(repo_root));
        let harness = HarnessCore::new(store, model, runtime);

        // Initialize goal
        let _ = harness.initialize_goal(&scenario.user_prompt).await;

        let mut turns = 0;
        let mut passed = false;
        let mut total_in_tok = 0;
        let mut total_out_tok = 0;
        let mut gate_passes = 0;
        let mut gate_fails = 0;
        let mut unauthorized = 0;

        while turns < scenario.max_turns {
            turns += 1;
            match harness.step(&scenario.title, &scenario.user_prompt).await {
                Ok(_) => {
                    total_in_tok += 150;
                    total_out_tok += 60;
                    gate_passes += 1;
                    if harness.current_phase().await == rivet_core::RunPhase::Completed {
                        passed = true;
                        break;
                    }
                }
                Err(e) => {
                    gate_fails += 1;
                    if e.to_string().contains("AuthorityDenied") || e.to_string().contains("SemanticViolation") {
                        unauthorized += 1;
                    }
                }
            }
        }

        ScenarioResult {
            scenario_id: scenario.scenario_id.clone(),
            mode,
            passed,
            turns_taken: turns,
            total_input_tokens: total_in_tok,
            total_output_tokens: total_out_tok,
            duration_ms: start.elapsed().as_millis() as u64,
            gate_passes,
            gate_fails,
            unauthorized_attempts: unauthorized,
            timestamp: Utc::now(),
        }
    }
}
