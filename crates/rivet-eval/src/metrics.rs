//! # rivet-eval::metrics
//!
//! Scientific metrics collection and scorecard generation for ablation runs.

use crate::ablation::AblationMode;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioResult {
    pub scenario_id: String,
    pub mode: AblationMode,
    pub passed: bool,
    pub turns_taken: usize,
    pub total_input_tokens: u32,
    pub total_output_tokens: u32,
    pub duration_ms: u64,
    pub gate_passes: usize,
    pub gate_fails: usize,
    pub unauthorized_attempts: usize,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AblationScorecard {
    pub mode: AblationMode,
    pub scenarios_tested: usize,
    pub scenarios_passed: usize,
    pub pass_rate_pct: f64,
    pub avg_turns: f64,
    pub avg_tokens: u32,
    pub total_unauthorized_actions_blocked: usize,
    pub timestamp: DateTime<Utc>,
}

impl AblationScorecard {
    pub fn from_results(mode: AblationMode, results: &[ScenarioResult]) -> Self {
        let matching: Vec<&ScenarioResult> = results.iter().filter(|r| r.mode == mode).collect();
        let total = matching.len();
        if total == 0 {
            return Self {
                mode,
                scenarios_tested: 0,
                scenarios_passed: 0,
                pass_rate_pct: 0.0,
                avg_turns: 0.0,
                avg_tokens: 0,
                total_unauthorized_actions_blocked: 0,
                timestamp: Utc::now(),
            };
        }

        let passed = matching.iter().filter(|r| r.passed).count();
        let total_turns: usize = matching.iter().map(|r| r.turns_taken).sum();
        let total_tokens: u32 = matching.iter().map(|r| r.total_input_tokens + r.total_output_tokens).sum();
        let blocked: usize = matching.iter().map(|r| r.unauthorized_attempts).sum();

        Self {
            mode,
            scenarios_tested: total,
            scenarios_passed: passed,
            pass_rate_pct: (passed as f64 / total as f64) * 100.0,
            avg_turns: total_turns as f64 / total as f64,
            avg_tokens: total_tokens / total as u32,
            total_unauthorized_actions_blocked: blocked,
            timestamp: Utc::now(),
        }
    }

    /// Render a clean Markdown summary table comparing multiple scorecards
    pub fn render_markdown_comparison(scorecards: &[Self]) -> String {
        let mut out = String::new();
        out.push_str("# 🧪 Rivet Empirical Evaluation Scorecard\n\n");
        out.push_str("| Configuration | Tested | Passed | Pass Rate | Avg Turns | Avg Tokens | Blocked Unauthorized |\n");
        out.push_str("| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n");

        for sc in scorecards {
            out.push_str(&format!(
                "| **{}** | {} | {} | **{:.1}%** | {:.1} | {} | {} |\n",
                sc.mode.display_name(),
                sc.scenarios_tested,
                sc.scenarios_passed,
                sc.pass_rate_pct,
                sc.avg_turns,
                sc.avg_tokens,
                sc.total_unauthorized_actions_blocked,
            ));
        }

        out
    }
}
