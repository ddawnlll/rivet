//! # praxis::parsers
//!
//! Pluggable test output parsers for multi-language mechanical verification.

pub mod cargo;
pub mod pytest;
pub mod jest;
pub mod go;

pub use cargo::CargoTestParser;
pub use pytest::PytestParser;
pub use jest::JestParser;
pub use go::GoTestParser;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedTestReport {
    pub framework: String,
    pub passed_count: usize,
    pub failed_count: usize,
    pub skipped_count: usize,
    pub total_count: usize,
    pub duration_ms: Option<u64>,
    pub raw_stdout: String,
    pub raw_stderr: String,
}

impl ParsedTestReport {
    pub fn is_success(&self) -> bool {
        self.failed_count == 0 && self.passed_count > 0
    }
}
