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
                        "src/auth.rs".into(),
                        "pub fn verify_token(token: &str) -> bool { true }\n".into(),
                    ),
                    (
                        "tests/auth_test.rs".into(),
                        "#[test] fn test_expired() { assert!(!src::auth::verify_token(\"expired\")); }\n".into(),
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
}
