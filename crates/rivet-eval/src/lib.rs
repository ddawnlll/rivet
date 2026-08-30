//! # rivet-eval (Benchmark & Scientific Ablation Evaluation Engine)
//!
//! Provides automated evaluation harness, standard V8 coding benchmarks,
//! ablation mode isolation, and empirical comparison scorecard generation.

pub mod scenario;
pub mod ablation;
pub mod metrics;
pub mod runner;

pub use scenario::{BenchmarkScenario, ScenarioSuite};
pub use ablation::AblationMode;
pub use metrics::{ScenarioResult, AblationScorecard};
pub use runner::EvalRunner;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use rivet_model::*;
    use rivet_types::*;

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
            let res = EvalRunner::run_scenario(scenario, AblationMode::FullRivet, model.clone()).await;
            results.push(res);
        }

        let scorecard = AblationScorecard::from_results(AblationMode::FullRivet, &results);
        assert_eq!(scorecard.scenarios_tested, scenarios.len());

        let markdown = AblationScorecard::render_markdown_comparison(&[scorecard]);
        assert!(markdown.contains("Rivet Empirical Evaluation Scorecard"));
        assert!(markdown.contains("Full Rivet (Canonical)"));
    }
}
