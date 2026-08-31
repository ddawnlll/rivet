//! # rivet-eval::runner
//!
//! Executes benchmark scenarios against the HarnessCore across different ablation modes.

use chrono::Utc;
use rivet_core::HarnessCore;
use rivet_model::ModelBackend;
use rivet_runtime::Runtime;
use rivet_store::{HardStateStore, MemoryStore};
use std::fs;
use std::sync::Arc;
use std::time::Instant;

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
        let harness = HarnessCore::new(store.clone(), model, runtime);

        // Initialize goal
        let _ = harness.initialize_goal(&scenario.user_prompt).await;

        let mut turns = 0;
        let mut passed = false;
        let mut gate_passes = 0;
        let mut gate_fails = 0;
        let mut unauthorized = 0;

        while turns < scenario.max_turns {
            turns += 1;
            match harness.step(&scenario.title, &scenario.user_prompt).await {
                Ok(_) => {
                    gate_passes += 1;
                    if harness.current_phase().await == rivet_core::RunPhase::Completed {
                        if !scenario.verification_command.is_empty() {
                            let mut parts = scenario.verification_command.split_whitespace();
                            let prog = parts.next().unwrap_or("cargo");
                            let args: Vec<&str> = parts.collect();
                            let output = tokio::process::Command::new(prog)
                                .args(&args)
                                .current_dir(repo_root)
                                .output()
                                .await;
                            if let Ok(out) = output
                                && out.status.code() == Some(scenario.expected_exit_code)
                            {
                                passed = true;
                            }
                        } else {
                            passed = true;
                        }
                        break;
                    }
                }
                Err(e) => {
                    gate_fails += 1;
                    if e.to_string().contains("AuthorityDenied")
                        || e.to_string().contains("SemanticViolation")
                    {
                        unauthorized += 1;
                    }
                }
            }
        }

        let events = store
            .read_events(rivet_types::Revision::ZERO)
            .await
            .unwrap_or_default();
        let hard_state = noesis::HardState::replay(&events);
        let mut total_in_tok = 0;
        let mut total_out_tok = 0;
        for inv in &hard_state.model_invocations {
            total_in_tok += inv.input_tokens;
            total_out_tok += inv.output_tokens;
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
