//! # rivet-eval::scenario
//!
//! Benchmark coding scenarios and task specifications for evaluating agent capability.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BenchmarkScenario {
    pub scenario_id: String,
    pub title: String,
    pub description: String,
    pub initial_files: Vec<(String, String)>, // (relative_path, content)
    pub user_prompt: String,
    pub verification_command: String,
    pub expected_exit_code: i32,
    pub max_turns: usize,
}

pub struct ScenarioSuite;

impl ScenarioSuite {
    /// Standard suite of V8-style coding and refactoring tasks
    pub fn standard_v8_suite() -> Vec<BenchmarkScenario> {
        vec![
            BenchmarkScenario {
                scenario_id: "v8-auth-bypass-fix".into(),
                title: "Fix Token Verification Bypass in Auth Middleware".into(),
                description: "Ensure JWT validation rejects expired tokens and missing signatures".into(),
                initial_files: vec![
                    (
                        "Cargo.toml".into(),
                        "[package]\nname = \"auth-module\"\nversion = \"0.1.0\"\nedition = \"2024\"\n".into(),
                    ),
                    (
                        "src/lib.rs".into(),
                        "pub mod auth;\n".into(),
                    ),
                    (
                        "src/auth.rs".into(),
                        "pub fn verify_token(token: &str) -> bool { token != \"expired\" }\n".into(),
                    ),
                    (
                        "tests/auth_test.rs".into(),
                        "#[test] fn test_expired() { assert!(!auth_module::auth::verify_token(\"expired\")); }\n".into(),
                    ),
                ],
                user_prompt: "Fix verify_token in src/auth.rs so expired tokens return false. Ensure tests pass.".into(),
                verification_command: "cargo test".into(),
                expected_exit_code: 0,
                max_turns: 5,
            },
            BenchmarkScenario {
                scenario_id: "v8-deadlock-remediation".into(),
                title: "Remediate Concurrency Lock Inversion".into(),
                description: "Fix lock ordering between session manager and user cache".into(),
                initial_files: vec![
                    (
                        "Cargo.toml".into(),
                        "[package]\nname = \"concurrency-module\"\nversion = \"0.1.0\"\nedition = \"2024\"\n".into(),
                    ),
                    (
                        "src/lib.rs".into(),
                        "pub mod concurrency;\n".into(),
                    ),
                    (
                        "src/concurrency.rs".into(),
                        "pub fn transfer() { /* lock A then B */ }\n".into(),
                    ),
                ],
                user_prompt: "Standardize lock acquisition order in src/concurrency.rs to avoid deadlocks.".into(),
                verification_command: "cargo test".into(),
                expected_exit_code: 0,
                max_turns: 6,
            },
            BenchmarkScenario {
                scenario_id: "v8-contract-migration".into(),
                title: "Migrate Deprecated Protocol Envelope to ACCP 3.0".into(),
                description: "Refactor legacy payload structures to typed normative envelopes".into(),
                initial_files: vec![
                    (
                        "Cargo.toml".into(),
                        "[package]\nname = \"protocol-module\"\nversion = \"0.1.0\"\nedition = \"2024\"\n".into(),
                    ),
                    (
                        "src/lib.rs".into(),
                        "pub mod protocol;\n".into(),
                    ),
                    (
                        "src/protocol.rs".into(),
                        "pub struct LegacyMessage { pub text: String }\n".into(),
                    ),
                ],
                user_prompt: "Migrate src/protocol.rs to use strict ACCP 3.0 envelopes.".into(),
                verification_command: "cargo test".into(),
                expected_exit_code: 0,
                max_turns: 5,
            },
        ]
    }

    /// Alien project control scenarios (TypeScript, Python, Greenfield) to prevent overfitting
    pub fn alien_suite() -> Vec<BenchmarkScenario> {
        vec![
            BenchmarkScenario {
                scenario_id: "alien-ts-service".into(),
                title: "TypeScript Service Rate Limiter Fix".into(),
                description: "Fix sliding window counter in TypeScript API gateway".into(),
                initial_files: vec![
                    (
                        "package.json".into(),
                        "{\"name\": \"ts-gateway\", \"version\": \"1.0.0\"}\n".into(),
                    ),
                    (
                        "src/limiter.ts".into(),
                        "export function checkLimit(count: number): boolean { return count < 100; }\n".into(),
                    ),
                ],
                user_prompt: "Fix checkLimit in src/limiter.ts to enforce 100 req/min limit.".into(),
                verification_command: "npm test".into(),
                expected_exit_code: 0,
                max_turns: 4,
            },
            BenchmarkScenario {
                scenario_id: "alien-python-data".into(),
                title: "Python Data Normalization Pipeline Fix".into(),
                description: "Fix pandas dataframe null handling in Python data loader".into(),
                initial_files: vec![
                    (
                        "pyproject.toml".into(),
                        "[project]\nname = \"data-loader\"\nversion = \"0.1.0\"\n".into(),
                    ),
                    (
                        "loader.py".into(),
                        "def clean_data(df): return df.dropna()\n".into(),
                    ),
                ],
                user_prompt: "Update loader.py to drop nulls across columns.".into(),
                verification_command: "pytest".into(),
                expected_exit_code: 0,
                max_turns: 4,
            },
            BenchmarkScenario {
                scenario_id: "alien-greenfield-init".into(),
                title: "Greenfield Project Initialization".into(),
                description: "Initialize minimal verified package structure from scratch".into(),
                initial_files: vec![],
                user_prompt: "Initialize a new Rust library crate with a basic health check function and test.".into(),
                verification_command: "cargo check".into(),
                expected_exit_code: 0,
                max_turns: 5,
            },
        ]
    }

    /// Complete suite including V8 flagship and Alien control benchmarks
    pub fn all_benchmark_scenarios() -> Vec<BenchmarkScenario> {
        let mut all = Self::standard_v8_suite();
        all.extend(Self::alien_suite());
        all
    }
}
