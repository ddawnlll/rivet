//! # praxis::gates::evidence_gate
//!
//! Gate 3: EvidenceGate
//! Validates evidence ledger integrity, namespace boundaries (allowed/forbidden files),
//! and required evidence mappings.

use crate::ledger::Ledger;
use crate::types::*;
use chrono::Utc;
use regex::Regex;

pub struct EvidenceGate;

impl EvidenceGate {
    pub fn evaluate(
        plan: &PlanSpec,
        ledger: Option<&Ledger>,
        changed_files: &[ChangedFile],
        attempt_id: &str,
    ) -> GateResult {
        let mut reason_codes = Vec::new();
        let mut diagnostics = Vec::new();
        let failed_criteria_ids = Vec::new();
        let mut evidence_refs = Vec::new();

        // 1. Check ledger presence
        let Some(ledger) = ledger else {
            reason_codes.push(reason_codes::EVIDENCE_LEDGER_MISSING.to_string());
            diagnostics.push(Diagnostic::error(
                "EVIDENCE_LEDGER_MISSING",
                "Evidence ledger is missing. Run tasks to capture evidence.",
            ));
            return build_result(
                GateVerdict::Hold,
                reason_codes,
                diagnostics,
                failed_criteria_ids,
                evidence_refs,
                attempt_id,
            );
        };

        // 2. Verify ledger cryptographic integrity
        if let Err(e) = ledger.verify_integrity() {
            reason_codes.push(reason_codes::EVIDENCE_LEDGER_PARSE_ERROR.to_string());
            diagnostics.push(Diagnostic::error("LEDGER_CORRUPT", e));
            return build_result(
                GateVerdict::Fail,
                reason_codes,
                diagnostics,
                failed_criteria_ids,
                evidence_refs,
                attempt_id,
            );
        }

        for r in &ledger.current().records {
            evidence_refs.push(r.record_id.clone());
        }

        // 3. Changed file namespace checks (allowedFiles vs forbiddenFiles)
        for cf in changed_files {
            let (is_allowed, is_forbidden) = check_file_boundary(
                &cf.path,
                &plan.workspace.allowed_files,
                &plan.workspace.forbidden_files,
            );

            if is_forbidden {
                reason_codes.push(reason_codes::FORBIDDEN_FILE_CHANGED.to_string());
                diagnostics.push(Diagnostic::error(
                    "FORBIDDEN_FILE_CHANGED",
                    format!("Forbidden file modified: {}", cf.path),
                ));
            } else if !is_allowed && !plan.workspace.allowed_files.is_empty() {
                reason_codes.push(reason_codes::CHANGED_FILE_OUTSIDE_ALLOWED_FILES.to_string());
                diagnostics.push(Diagnostic::error(
                    "CHANGED_FILE_OUTSIDE_ALLOWED_FILES",
                    format!("File modified outside allowed workspace: {}", cf.path),
                ));
            }
        }

        // 4. Check if diff is empty for tasks expecting code modifications
        if changed_files.is_empty() && !plan.tasks.is_empty() {
            reason_codes.push(reason_codes::DIFF_EMPTY.to_string());
            diagnostics.push(Diagnostic::info(
                "DIFF_EMPTY",
                "No changed files recorded in evidence.",
            ));
        }

        let has_errors = diagnostics.iter().any(|d| d.severity == Severity::Error);
        let verdict = if has_errors {
            GateVerdict::Fail
        } else if !diagnostics.is_empty()
            && diagnostics.iter().any(|d| d.severity == Severity::Warning)
        {
            GateVerdict::Hold
        } else {
            reason_codes.push(reason_codes::EVIDENCE_PASS.to_string());
            GateVerdict::Pass
        };

        build_result(
            verdict,
            reason_codes,
            diagnostics,
            failed_criteria_ids,
            evidence_refs,
            attempt_id,
        )
    }
}

fn check_file_boundary(path: &str, allowed: &[String], forbidden: &[String]) -> (bool, bool) {
    let mut is_allowed = allowed.is_empty(); // If allowed is empty, unrestricted unless forbidden
    let mut is_forbidden = false;

    for pattern in allowed {
        if matches_glob(path, pattern) {
            is_allowed = true;
            break;
        }
    }

    for pattern in forbidden {
        if matches_glob(path, pattern) {
            is_forbidden = true;
            break;
        }
    }

    (is_allowed, is_forbidden)
}

pub fn matches_glob(path: &str, pattern: &str) -> bool {
    let norm_path = path.replace('\\', "/");
    let norm_pattern = pattern.replace('\\', "/");

    if norm_path == norm_pattern {
        return true;
    }

    // Convert glob to regex
    let mut regex_str = String::from("^");
    let mut chars = norm_pattern.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '*' => {
                if chars.peek() == Some(&'*') {
                    chars.next();
                    if chars.peek() == Some(&'/') {
                        chars.next();
                        regex_str.push_str("(?:.*/)?");
                    } else {
                        regex_str.push_str(".*");
                    }
                } else {
                    regex_str.push_str("[^/]*");
                }
            }
            '?' => regex_str.push_str("[^/]"),
            '.' | '(' | ')' | '+' | '|' | '^' | '$' | '@' | '%' => {
                regex_str.push('\\');
                regex_str.push(c);
            }
            _ => regex_str.push(c),
        }
    }
    regex_str.push('$');

    if let Ok(re) = Regex::new(&regex_str) {
        re.is_match(&norm_path)
    } else {
        norm_path.contains(&norm_pattern)
    }
}

fn build_result(
    verdict: GateVerdict,
    reason_codes: Vec<String>,
    diagnostics: Vec<Diagnostic>,
    failed_criteria_ids: Vec<String>,
    evidence_refs: Vec<String>,
    attempt_id: &str,
) -> GateResult {
    GateResult {
        gate_name: "EvidenceGate".into(),
        verdict,
        reason_codes,
        diagnostics,
        failed_criteria_ids,
        evidence_refs,
        attempt_id: attempt_id.to_string(),
        timestamp: Utc::now(),
        repair_hint: if verdict == GateVerdict::Fail {
            Some("Check workspace allowed/forbidden file boundaries or ledger integrity".into())
        } else {
            None
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_matching() {
        assert!(matches_glob("src/auth/session.rs", "src/**"));
        assert!(matches_glob("src/main.rs", "src/*.rs"));
        assert!(!matches_glob("tests/test.rs", "src/**"));
        assert!(matches_glob("secret.key", "**/secret.key"));
    }
}
