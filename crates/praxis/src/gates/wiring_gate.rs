//! # praxis::gates::wiring_gate
//!
//! Gate 4: WiringGate
//! Validates task dependency graphs, detecting cycles and unresolved references.

use std::collections::{HashMap, HashSet};
use chrono::Utc;
use crate::types::*;

pub struct WiringGate;

impl WiringGate {
    pub fn evaluate(plan: &PlanSpec, attempt_id: &str) -> GateResult {
        let mut reason_codes = Vec::new();
        let mut diagnostics = Vec::new();
        let failed_criteria_ids = Vec::new();

        let task_map: HashMap<String, &PlanTask> = plan.tasks.iter().map(|t| (t.id.clone(), t)).collect();

        // 1. Check unresolved dependencies
        for task in &plan.tasks {
            for dep in &task.dependencies {
                if !task_map.contains_key(dep) {
                    reason_codes.push(reason_codes::UNRESOLVED_DEPENDENCY.to_string());
                    diagnostics.push(Diagnostic::error(
                        "UNRESOLVED_DEPENDENCY",
                        format!("Task '{}' depends on non-existent task '{}'", task.id, dep),
                    ));
                }
            }
        }

        // 2. Check circular dependencies using DFS cycle detection
        let mut visited = HashSet::new();
        let mut rec_stack = HashSet::new();

        for task in &plan.tasks {
            if !visited.contains(&task.id) && has_cycle(&task.id, &task_map, &mut visited, &mut rec_stack) {
                reason_codes.push(reason_codes::CIRCULAR_DEPENDENCY.to_string());
                diagnostics.push(Diagnostic::error(
                    "CIRCULAR_DEPENDENCY",
                    format!("Circular dependency detected involving task '{}'", task.id),
                ));
                break;
            }
        }

        let has_errors = diagnostics.iter().any(|d| d.severity == Severity::Error);
        let verdict = if has_errors {
            GateVerdict::Fail
        } else {
            reason_codes.push(reason_codes::WIRING_PASS.to_string());
            GateVerdict::Pass
        };

        GateResult {
            gate_name: "WiringGate".into(),
            verdict,
            reason_codes,
            diagnostics,
            failed_criteria_ids,
            evidence_refs: Vec::new(),
            attempt_id: attempt_id.to_string(),
            timestamp: Utc::now(),
            repair_hint: if verdict == GateVerdict::Fail {
                Some("Fix task dependency cycle or unresolved references in PlanSpec".into())
            } else {
                None
            },
        }
    }
}

fn has_cycle(
    task_id: &str,
    tasks: &HashMap<String, &PlanTask>,
    visited: &mut HashSet<String>,
    rec_stack: &mut HashSet<String>,
) -> bool {
    visited.insert(task_id.to_string());
    rec_stack.insert(task_id.to_string());

    if let Some(task) = tasks.get(task_id) {
        for dep in &task.dependencies {
            if !visited.contains(dep) {
                if has_cycle(dep, tasks, visited, rec_stack) {
                    return true;
                }
            } else if rec_stack.contains(dep) {
                return true;
            }
        }
    }

    rec_stack.remove(task_id);
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wiring_gate_detects_cycle() {
        let plan = PlanSpec {
            metadata: PlanMetadata {
                plan_id: "plan-1".into(),
                title: "Test".into(),
                version: "1.0".into(),
            },
            workspace: PlanWorkspace::default(),
            commands: PlanCommands::default(),
            tasks: vec![
                PlanTask {
                    id: "t1".into(),
                    name: "Task 1".into(),
                    description: "".into(),
                    dependencies: vec!["t2".into()],
                    acceptance_criteria: vec![],
                },
                PlanTask {
                    id: "t2".into(),
                    name: "Task 2".into(),
                    description: "".into(),
                    dependencies: vec!["t1".into()],
                    acceptance_criteria: vec![],
                },
            ],
        };

        let res = WiringGate::evaluate(&plan, "att-1");
        assert_eq!(res.verdict, GateVerdict::Fail);
        assert!(res.reason_codes.contains(&reason_codes::CIRCULAR_DEPENDENCY.to_string()));
    }
}
