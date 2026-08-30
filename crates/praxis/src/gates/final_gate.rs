//! # praxis::gates::final_gate
//!
//! Gate 7/8: FinalGate
//! Evaluates all acceptance criteria against evidence gathered by prior gates.
//! Only FinalGate PASS authorizes task completion (Law 1).

use chrono::Utc;
use crate::gates::exec_gate::CommandRunResult;
use crate::types::*;

pub struct FinalGate;

impl FinalGate {
    pub fn evaluate(
        plan: &PlanSpec,
        prior_gate_results: &[GateResult],
        command_results: &[CommandRunResult],
        attempt_id: &str,
    ) -> GateResult {
        let mut reason_codes = Vec::new();
        let mut diagnostics = Vec::new();
        let mut failed_criteria_ids = Vec::new();
        let mut evidence_refs = Vec::new();

        // 1. Safety Rule: Prior Gate FAIL cannot PASS
        let prior_fail = prior_gate_results.iter().find(|g| g.verdict == GateVerdict::Fail);
        let prior_hold = prior_gate_results.iter().any(|g| g.verdict == GateVerdict::Hold);

        if let Some(fail_gate) = prior_fail {
            reason_codes.push(reason_codes::PRIOR_GATE_NOT_PASS.to_string());
            diagnostics.push(Diagnostic::error(
                "PRIOR_GATE_NOT_PASS",
                format!("Prior gate '{}' failed. FinalGate cannot produce PASS.", fail_gate.gate_name),
            ));
            return build_result(GateVerdict::Fail, reason_codes, diagnostics, failed_criteria_ids, evidence_refs, attempt_id);
        }

        // 2. Safety Rule: Zero criteria -> HOLD
        let all_criteria: Vec<&AcceptanceCriterion> = plan.tasks.iter().flat_map(|t| &t.acceptance_criteria).collect();
        if all_criteria.is_empty() {
            reason_codes.push(reason_codes::NO_CRITERIA_DEFINED.to_string());
            diagnostics.push(Diagnostic::warning(
                "NO_CRITERIA_DEFINED",
                "No acceptance criteria defined in plan",
            ));
            return build_result(GateVerdict::Hold, reason_codes, diagnostics, failed_criteria_ids, evidence_refs, attempt_id);
        }

        // 3. Evaluate each criterion
        let mut deterministic_passed = 0;
        let mut deterministic_failed = 0;
        let mut deterministic_total = 0;

        for crit in all_criteria {
            let is_deterministic = crit.verification.deterministic && !crit.verification.advisory_only;
            if is_deterministic {
                deterministic_total += 1;
            }

            // Command / test verification match
            if let Some(ref cmd_id) = crit.verification.command_ref {
                if let Some(cmd_res) = command_results.iter().find(|c| &c.command_id == cmd_id) {
                    if cmd_res.passed {
                        if is_deterministic {
                            deterministic_passed += 1;
                        }
                        evidence_refs.push(format!("crit-pass-{}", crit.id));
                    } else {
                        if is_deterministic {
                            deterministic_failed += 1;
                        }
                        failed_criteria_ids.push(crit.id.clone());
                        evidence_refs.push(format!("crit-fail-{}", crit.id));
                    }
                } else {
                    // Command was not executed or not found
                    if is_deterministic {
                        deterministic_failed += 1;
                    }
                    failed_criteria_ids.push(crit.id.clone());
                }
            } else if is_deterministic {
                // Non-command deterministic verification (e.g. file match)
                deterministic_passed += 1;
            }
        }

        // 4. Safety Rule: No advisory-only PASS
        if deterministic_total == 0 {
            reason_codes.push(reason_codes::NO_DETERMINISTIC_CRITERIA.to_string());
            diagnostics.push(Diagnostic::warning(
                "NO_DETERMINISTIC_CRITERIA",
                "All criteria are advisory. FinalGate requires at least one passing deterministic criterion.",
            ));
            return build_result(GateVerdict::Hold, reason_codes, diagnostics, failed_criteria_ids, evidence_refs, attempt_id);
        }

        // 5. Verdict aggregation
        let verdict = if deterministic_failed > 0 {
            reason_codes.push(reason_codes::CRITERIA_FAILED.to_string());
            GateVerdict::Fail
        } else if deterministic_passed == deterministic_total && !prior_hold {
            reason_codes.push(reason_codes::ALL_CRITERIA_MET.to_string());
            GateVerdict::Pass
        } else {
            reason_codes.push(reason_codes::CRITERIA_PARTIAL.to_string());
            GateVerdict::Hold
        };

        build_result(verdict, reason_codes, diagnostics, failed_criteria_ids, evidence_refs, attempt_id)
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
        gate_name: "FinalGate".into(),
        verdict,
        reason_codes,
        diagnostics,
        failed_criteria_ids,
        evidence_refs,
        attempt_id: attempt_id.to_string(),
        timestamp: Utc::now(),
        repair_hint: if verdict == GateVerdict::Fail {
            Some("Ensure all deterministic verification tests and acceptance criteria pass".into())
        } else if verdict == GateVerdict::Hold {
            Some("Resolve open non-fatal issues or provide deterministic evidence".into())
        } else {
            None
        },
    }
}
