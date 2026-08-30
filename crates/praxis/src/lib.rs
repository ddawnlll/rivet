//! # praxis (Verity Mechanical Verification Engine)
//!
//! 100% Rust implementation of the Praxis Verity Truth Kernel.
//! Provides:
//! - Domain-separated SHA-256 Merkle tree with RFC 6962 inclusion proofs
//! - Append-only NDJSON cryptographic evidence ledger
//! - 8-Gate Pipeline: SchemaGate -> LockGate -> EvidenceGate -> WiringGate -> ExecGate -> CoverageGate -> FinalGate
//! - Multi-framework test output parsers (Cargo, Pytest, Jest, Go)
//! - Circuit breaker and failure rate tracking
//! - LCOV and Istanbul coverage report analysis

pub mod types;
pub mod merkle;
pub mod ledger;
pub mod coverage;
pub mod circuit_breaker;
pub mod parsers;
pub mod gates;
pub mod pipeline;

pub use types::*;
pub use merkle::{MerkleProof, MerkleProofStep, hash_leaf, hash_node, root_from_hashes, root_from_records, inclusion_proof, verify_proof};
pub use ledger::{Ledger, LedgerRecord, LedgerHeader, LedgerState};
pub use coverage::{CoverageParser, CoverageResult, CoverageTotals, FileCoverage};
pub use circuit_breaker::{CircuitBreaker, CircuitBreakerConfig, CircuitBreakerState};
pub use parsers::{CargoTestParser, PytestParser, JestParser, GoTestParser, ParsedTestReport};
pub use gates::{SchemaGate, LockGate, EvidenceGate, WiringGate, ExecGate, CoverageGate, FinalGate};
pub use pipeline::{VerityPipeline, VerityPipelineResult};

use accp::{VerificationReceipt, VerificationRequest};
use chrono::Utc;
use rivet_types::*;

/// Legacy compatibility test report
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TestRunReport {
    pub passed_count: usize,
    pub failed_count: usize,
    pub ignored_count: usize,
    pub raw_stdout: String,
    pub raw_stderr: String,
}

pub struct TestOutputParser;

impl TestOutputParser {
    pub fn parse_cargo_test(stdout: &str) -> TestRunReport {
        let parsed = CargoTestParser::parse(stdout, "");
        TestRunReport {
            passed_count: parsed.passed_count,
            failed_count: parsed.failed_count,
            ignored_count: parsed.skipped_count,
            raw_stdout: parsed.raw_stdout,
            raw_stderr: parsed.raw_stderr,
        }
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
