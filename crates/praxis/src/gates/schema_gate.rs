//! # praxis::gates::schema_gate
//!
//! Gate 1: SchemaGate
//! Validates structural correctness, required fields, and unique IDs in the PlanSpec.

use crate::types::*;
use chrono::Utc;

pub struct SchemaGate;

impl SchemaGate {
    pub fn evaluate(plan: &PlanSpec, attempt_id: &str) -> GateResult {
        let mut reason_codes = Vec::new();
        let mut diagnostics = Vec::new();
        let mut failed_criteria_ids = Vec::new();

        // 1. Check PlanMetadata
        if plan.metadata.plan_id.trim().is_empty() {
            diagnostics.push(Diagnostic::error(
                "MISSING_PLAN_ID",
                "PlanSpec missing metadata.plan_id",
            ));
            reason_codes.push(reason_codes::MISSING_REQUIRED_FIELD.to_string());
        }

        if plan.metadata.version.trim().is_empty() {
            diagnostics.push(Diagnostic::error(
                "MISSING_VERSION",
                "PlanSpec missing metadata.version",
            ));
            reason_codes.push(reason_codes::MISSING_REQUIRED_FIELD.to_string());
        }

        // 2. Check Tasks and Unique IDs
        let mut seen_task_ids = std::collections::HashSet::new();
        let mut seen_criterion_ids = std::collections::HashSet::new();

        if plan.tasks.is_empty() {
            diagnostics.push(Diagnostic::warning(
                "EMPTY_TASKS",
                "PlanSpec contains no tasks",
            ));
            reason_codes.push(reason_codes::SCHEMA_VALIDATION_ERROR.to_string());
        }

        for task in &plan.tasks {
            if !seen_task_ids.insert(task.id.clone()) {
                diagnostics.push(Diagnostic::error(
                    "DUPLICATE_TASK_ID",
                    format!("Duplicate task id '{}'", task.id),
                ));
                reason_codes.push(reason_codes::SCHEMA_VALIDATION_ERROR.to_string());
            }

            for crit in &task.acceptance_criteria {
                if !seen_criterion_ids.insert(crit.id.clone()) {
                    diagnostics.push(Diagnostic::error(
                        "DUPLICATE_CRITERION_ID",
                        format!("Duplicate criterion id '{}'", crit.id),
                    ));
                    reason_codes.push(reason_codes::SCHEMA_VALIDATION_ERROR.to_string());
                    failed_criteria_ids.push(crit.id.clone());
                }
            }
        }

        let has_errors = diagnostics.iter().any(|d| d.severity == Severity::Error);
        let verdict = if has_errors {
            GateVerdict::Fail
        } else if !diagnostics.is_empty() {
            GateVerdict::Hold
        } else {
            reason_codes.push(reason_codes::SCHEMA_PASS.to_string());
            GateVerdict::Pass
        };

        GateResult {
            gate_name: "SchemaGate".into(),
            verdict,
            reason_codes,
            diagnostics,
            failed_criteria_ids,
            evidence_refs: Vec::new(),
            attempt_id: attempt_id.to_string(),
            timestamp: Utc::now(),
            repair_hint: if verdict == GateVerdict::Fail {
                Some("Fix schema validation errors in PlanSpec".into())
            } else {
                None
            },
        }
    }
}
