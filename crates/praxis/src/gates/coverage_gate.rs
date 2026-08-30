//! # praxis::gates::coverage_gate
//!
//! Gate 6: CoverageGate
//! Evaluates code coverage metrics from reports against threshold requirements.

use std::path::Path;
use chrono::Utc;
use crate::coverage::CoverageParser;
use crate::types::*;

pub struct CoverageGate;

impl CoverageGate {
    pub fn evaluate(
        report_path: Option<impl AsRef<Path>>,
        min_line_pct: f64,
        attempt_id: &str,
    ) -> GateResult {
        let mut reason_codes = Vec::new();
        let mut diagnostics = Vec::new();
        let mut evidence_refs = Vec::new();

        let Some(path) = report_path else {
            // No coverage report requested -> pass
            reason_codes.push(reason_codes::COVERAGE_PASS.to_string());
            return build_result(GateVerdict::Pass, reason_codes, diagnostics, evidence_refs, attempt_id);
        };

        let path = path.as_ref();
        let coverage = CoverageParser::parse_file(path);

        if !coverage.parse_success {
            reason_codes.push(reason_codes::COVERAGE_PARSE_ERROR.to_string());
            diagnostics.push(Diagnostic::error(
                "COVERAGE_PARSE_ERROR",
                format!("Failed to parse coverage report at {}", path.display()),
            ));
            return build_result(GateVerdict::Fail, reason_codes, diagnostics, evidence_refs, attempt_id);
        }

        evidence_refs.push(format!("cov-{}", path.display()));

        if coverage.total.lines.pct < min_line_pct {
            reason_codes.push(reason_codes::COVERAGE_BELOW_THRESHOLD.to_string());
            diagnostics.push(Diagnostic::error(
                "COVERAGE_BELOW_THRESHOLD",
                format!(
                    "Line coverage ({:.1}%) is below minimum threshold ({:.1}%)",
                    coverage.total.lines.pct, min_line_pct
                ),
            ));
            return build_result(GateVerdict::Fail, reason_codes, diagnostics, evidence_refs, attempt_id);
        }

        reason_codes.push(reason_codes::COVERAGE_PASS.to_string());
        diagnostics.push(Diagnostic::info(
            "COVERAGE_MET",
            format!("Coverage requirement satisfied: {:.1}% >= {:.1}%", coverage.total.lines.pct, min_line_pct),
        ));

        build_result(GateVerdict::Pass, reason_codes, diagnostics, evidence_refs, attempt_id)
    }
}

fn build_result(
    verdict: GateVerdict,
    reason_codes: Vec<String>,
    diagnostics: Vec<Diagnostic>,
    evidence_refs: Vec<String>,
    attempt_id: &str,
) -> GateResult {
    GateResult {
        gate_name: "CoverageGate".into(),
        verdict,
        reason_codes,
        diagnostics,
        failed_criteria_ids: Vec::new(),
        evidence_refs,
        attempt_id: attempt_id.to_string(),
        timestamp: Utc::now(),
        repair_hint: if verdict == GateVerdict::Fail {
            Some("Increase test coverage for modified files".into())
        } else {
            None
        },
    }
}
