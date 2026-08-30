//! # praxis (Mechanical Verification Engine)
//!
//! Executes bounded verification predicates (unit tests, linter, typecheck)
//! and emits authoritative, signed VerificationReceipt objects.

use accp::{VerificationReceipt, VerificationRequest};
use chrono::Utc;
use rivet_types::*;
use serde::{Deserialize, Serialize};

/// Parsed output of a mechanical test run
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TestRunReport {
    pub passed_count: usize,
    pub failed_count: usize,
    pub ignored_count: usize,
    pub raw_stdout: String,
    pub raw_stderr: String,
}

pub struct TestOutputParser;

impl TestOutputParser {
    /// Parse standard cargo test / generic test output lines
    pub fn parse_cargo_test(stdout: &str) -> TestRunReport {
        let mut passed = 0;
        let mut failed = 0;
        let ignored = 0;

        for line in stdout.lines() {
            if line.contains("test result: ok.") {
                // "test result: ok. 5 passed; 0 failed; 0 ignored;"
                if let Some(p) = Self::extract_num_before(line, "passed") {
                    passed = p;
                }
            } else if line.contains("test result: FAILED.") {
                if let Some(p) = Self::extract_num_before(line, "passed") {
                    passed = p;
                }
                if let Some(f) = Self::extract_num_before(line, "failed") {
                    failed = f;
                }
            } else if line.starts_with("test ") && line.ends_with("... ok") {
                passed += 1;
            } else if line.starts_with("test ") && line.ends_with("... FAILED") {
                failed += 1;
            }
        }

        TestRunReport {
            passed_count: passed,
            failed_count: failed,
            ignored_count: ignored,
            raw_stdout: stdout.to_string(),
            raw_stderr: String::new(),
        }
    }

    fn extract_num_before(line: &str, marker: &str) -> Option<usize> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        for (i, &word) in parts.iter().enumerate() {
            if word.starts_with(marker) && i > 0 {
                let num_str = parts[i - 1].trim_matches(|c: char| !c.is_numeric());
                return num_str.parse().ok();
            }
        }
        None
    }
}

/// Verification engine executing bounded predicates
pub struct PraxisEngine;

impl PraxisEngine {
    pub fn evaluate_test_result(
        req: &VerificationRequest,
        report: &TestRunReport,
    ) -> VerificationReceipt {
        let passed = report.failed_count == 0 && report.passed_count > 0;
        let diagnostics = if !passed {
            Some(format!(
                "Test verification failed: {} passed, {} failed",
                report.passed_count, report.failed_count
            ))
        } else {
            None
        };

        VerificationReceipt {
            receipt_id: ReceiptId::new(),
            obligation_id: req.obligation_id.clone(),
            passed,
            evidence_id: EvidenceId::new(),
            verified_scope: req.target_scope.clone(),
            diagnostics,
            timestamp: Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cargo_output_parser() {
        let sample = "\
running 2 tests
test tests::test_one ... ok
test tests::test_two ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
";
        let report = TestOutputParser::parse_cargo_test(sample);
        assert_eq!(report.passed_count, 2);
        assert_eq!(report.failed_count, 0);

        let req = VerificationRequest {
            obligation_id: ObligationId::new(),
            predicate: "cargo test".into(),
            target_scope: Scope::global("repo", Revision::ZERO),
            timeout_seconds: 30,
            timestamp: Utc::now(),
        };

        let receipt = PraxisEngine::evaluate_test_result(&req, &report);
        assert!(receipt.passed);
    }
}
