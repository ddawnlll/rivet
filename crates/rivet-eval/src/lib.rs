//! # rivet-eval (Benchmark & Scientific Ablation Evaluation Engine)
//!
//! Provides automated evaluation harness, standard V8 coding benchmarks,
//! ablation mode isolation, and empirical comparison scorecard generation.

pub mod ablation;
pub mod metrics;
pub mod runner;
pub mod scenario;

pub use ablation::AblationMode;
pub use metrics::{AblationScorecard, ScenarioResult};
pub use runner::EvalRunner;
pub use scenario::{BenchmarkScenario, ScenarioSuite};

#[cfg(test)]
mod tests {
    use super::*;
    use rivet_model::*;
    use rivet_types::*;
    use std::sync::Arc;

    struct MockEvalModel;

    #[async_trait::async_trait]
    impl ModelBackend for MockEvalModel {
        async fn invoke(&self, _req: ModelRequest) -> RivetResult<ModelResponse> {
            Ok(ModelResponse {
                text_content: "Refactor completed".into(),
                actions: vec![CognitiveAction::Thought("Analyzing scenario".into())],
                usage: TokenUsage {
                    input_tokens: 120,
                    output_tokens: 45,
                    cached_tokens: None,
                },
            })
        }
    }

    #[tokio::test]
    async fn test_benchmark_runner_and_scorecard_generation() {
        let scenarios = ScenarioSuite::standard_v8_suite();
        assert!(!scenarios.is_empty());

        let model = Arc::new(MockEvalModel);
        let mut results = Vec::new();

        for scenario in &scenarios {
            let res =
                EvalRunner::run_scenario(scenario, AblationMode::FullRivet, model.clone()).await;
            results.push(res);
        }

        let scorecard = AblationScorecard::from_results(AblationMode::FullRivet, &results);
        assert_eq!(scorecard.scenarios_tested, scenarios.len());

        let markdown = AblationScorecard::render_markdown_comparison(&[scorecard]);
        assert!(markdown.contains("Rivet Empirical Evaluation Scorecard"));
        assert!(markdown.contains("Full Rivet (Canonical)"));
    }

    #[tokio::test]
    async fn test_alien_suite_and_ablation_matrix() {
        let alien_scenarios = ScenarioSuite::alien_suite();
        assert_eq!(alien_scenarios.len(), 3);

        let model = Arc::new(MockEvalModel);
        let mut scorecards = Vec::new();

        for mode in [
            AblationMode::FullRivet,
            AblationMode::NoHardState,
            AblationMode::NoPraxisVerity,
            AblationMode::NoHephaestus,
        ] {
            let mut results = Vec::new();
            for scenario in &alien_scenarios {
                let res = EvalRunner::run_scenario(scenario, mode, model.clone()).await;
                results.push(res);
            }
            let scorecard = AblationScorecard::from_results(mode, &results);
            scorecards.push(scorecard);
        }

        assert_eq!(scorecards.len(), 4);
        let table = AblationScorecard::render_markdown_comparison(&scorecards);
        assert!(table.contains("Noesis Hard State"));
        assert!(table.contains("Praxis Verification"));
        assert!(table.contains("Hephaestus"));
    }
}
