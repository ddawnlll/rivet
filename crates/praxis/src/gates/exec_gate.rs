//! # praxis::gates::exec_gate
//!
//! Gate 5: ExecGate
//! Validates allowed commands, executes them with timeouts and sandbox constraints,
//! and records stdout/stderr evidence.

use std::path::Path;
use std::time::Instant;
use chrono::Utc;
use tokio::process::Command;
use crate::types::*;

#[derive(Debug, Clone)]
pub struct CommandRunResult {
    pub command_id: String,
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub passed: bool,
    pub reason_codes: Vec<String>,
}

pub struct ExecGate;

impl ExecGate {
    pub async fn execute_all(
        plan: &PlanSpec,
        repo_root: impl AsRef<Path>,
        attempt_id: &str,
    ) -> (GateResult, Vec<CommandRunResult>) {
        let repo_root = repo_root.as_ref();
        let mut reason_codes = Vec::new();
        let mut diagnostics = Vec::new();
        let failed_criteria_ids = Vec::new();
        let mut evidence_refs = Vec::new();
        let mut run_results = Vec::new();

        // 1. Validate commands against policy before running
        for cmd in &plan.commands.exact_allowed_commands {
            // Check hard denied
            let is_denied = plan.commands.hard_denied_commands.iter().any(|d| cmd.command.contains(d));
            if is_denied {
                reason_codes.push(reason_codes::COMMAND_DENIED.to_string());
                diagnostics.push(Diagnostic::error(
                    "COMMAND_DENIED",
                    format!("Command '{}' matches hardDeniedCommands policy", cmd.command),
                ));
                run_results.push(CommandRunResult {
                    command_id: cmd.id.clone(),
                    command: cmd.command.clone(),
                    exit_code: None,
                    stdout: String::new(),
                    stderr: "Command denied by policy".into(),
                    duration_ms: 0,
                    timed_out: false,
                    passed: false,
                    reason_codes: vec![reason_codes::COMMAND_DENIED.to_string()],
                });
                continue;
            }

            // Check watch mode flags
            if cmd.command.contains("--watch") || cmd.command.contains("-w") {
                reason_codes.push(reason_codes::WATCH_MODE_DETECTED.to_string());
                diagnostics.push(Diagnostic::error(
                    "WATCH_MODE_DETECTED",
                    format!("Command '{}' contains watch-mode flags", cmd.command),
                ));
            }

            // Execute command
            let timeout_secs = cmd.timeout_seconds.unwrap_or(300);
            let cwd = if let Some(ref sub) = cmd.cwd {
                repo_root.join(sub)
            } else {
                repo_root.to_path_buf()
            };

            let start = Instant::now();
            let mut parts = cmd.command.split_whitespace();
            let program = parts.next().unwrap_or("");
            let args: Vec<&str> = parts.collect();

            let res = tokio::time::timeout(
                std::time::Duration::from_secs(timeout_secs),
                Command::new(program).args(&args).current_dir(&cwd).output(),
            )
            .await;

            let duration_ms = start.elapsed().as_millis() as u64;

            let (exit_code, stdout, stderr, timed_out) = match res {
                Ok(Ok(output)) => {
                    let code = output.status.code();
                    let out = String::from_utf8_lossy(&output.stdout).to_string();
                    let err = String::from_utf8_lossy(&output.stderr).to_string();
                    (code, out, err, false)
                }
                Ok(Err(e)) => (Some(-1), String::new(), e.to_string(), false),
                Err(_) => (Some(-1), String::new(), "Command timed out".into(), true),
            };

            let mut cmd_reasons = Vec::new();
            let mut passed = true;

            if timed_out {
                passed = false;
                cmd_reasons.push(reason_codes::COMMAND_TIMEOUT.to_string());
                reason_codes.push(reason_codes::COMMAND_TIMEOUT.to_string());
                diagnostics.push(Diagnostic::error(
                    "COMMAND_TIMEOUT",
                    format!("Command '{}' timed out after {}s", cmd.command, timeout_secs),
                ));
            } else if let Some(code) = exit_code {
                let expected = cmd.expected_exit_code.unwrap_or(0);
                if code != expected {
                    passed = false;
                    cmd_reasons.push(reason_codes::EXIT_CODE_NONZERO.to_string());
                    reason_codes.push(reason_codes::EXIT_CODE_NONZERO.to_string());
                    diagnostics.push(Diagnostic::error(
                        "EXIT_CODE_NONZERO",
                        format!("Command '{}' exited with code {} (expected {})", cmd.command, code, expected),
                    ));
                }
            }

            // Expected patterns check
            for pattern in &cmd.expected_output_patterns {
                if !stdout.contains(pattern) && !stderr.contains(pattern) {
                    passed = false;
                    cmd_reasons.push(reason_codes::EXPECTED_OUTPUT_MISSING.to_string());
                    diagnostics.push(Diagnostic::warning(
                        "EXPECTED_OUTPUT_MISSING",
                        format!("Command output missing expected pattern '{}'", pattern),
                    ));
                }
            }

            if passed {
                cmd_reasons.push(reason_codes::COMMAND_SUCCEEDED.to_string());
            }

            evidence_refs.push(format!("cmd-{}", cmd.id));

            run_results.push(CommandRunResult {
                command_id: cmd.id.clone(),
                command: cmd.command.clone(),
                exit_code,
                stdout,
                stderr,
                duration_ms,
                timed_out,
                passed,
                reason_codes: cmd_reasons,
            });
        }

        let has_fails = run_results.iter().any(|r| !r.passed);
        let verdict = if has_fails {
            GateVerdict::Fail
        } else {
            reason_codes.push(reason_codes::EXEC_PASS.to_string());
            GateVerdict::Pass
        };

        let result = GateResult {
            gate_name: "ExecGate".into(),
            verdict,
            reason_codes,
            diagnostics,
            failed_criteria_ids,
            evidence_refs,
            attempt_id: attempt_id.to_string(),
            timestamp: Utc::now(),
            repair_hint: if verdict == GateVerdict::Fail {
                Some("Fix failing command execution, syntax, or exit code mismatches".into())
            } else {
                None
            },
        };

        (result, run_results)
    }
}
