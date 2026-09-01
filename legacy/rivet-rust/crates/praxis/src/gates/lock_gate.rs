//! # praxis::gates::lock_gate
//!
//! Gate 2: LockGate
//! Verifies hash consistency against an existing lock file or creates a new lock.

use crate::types::*;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockMode {
    VerifyExisting,
    CreateIfMissing,
    RefreshExplicit,
}

pub struct LockGate;

impl LockGate {
    pub fn compute_hashes(plan: &PlanSpec) -> PlanHashes {
        let plan_json = serde_json::to_string(plan).unwrap_or_default();
        let ws_json = serde_json::to_string(&plan.workspace).unwrap_or_default();
        let cmd_json = serde_json::to_string(&plan.commands).unwrap_or_default();
        let tasks_json = serde_json::to_string(&plan.tasks).unwrap_or_default();

        PlanHashes {
            plan_hash: sha256_hex(&plan_json),
            workspace_hash: sha256_hex(&ws_json),
            commands_hash: sha256_hex(&cmd_json),
            tasks_hash: sha256_hex(&tasks_json),
        }
    }

    pub fn evaluate(
        plan: &PlanSpec,
        lock_path: impl AsRef<Path>,
        mode: LockMode,
        attempt_id: &str,
    ) -> (GateResult, Option<PlanLock>) {
        let path = lock_path.as_ref();
        let hashes = Self::compute_hashes(plan);
        let mut reason_codes = Vec::new();
        let mut diagnostics = Vec::new();

        let lock_exists = path.exists();

        match mode {
            LockMode::VerifyExisting => {
                if !lock_exists {
                    reason_codes.push(reason_codes::MISSING_PLAN_LOCK.to_string());
                    diagnostics.push(Diagnostic::error(
                        "MISSING_PLAN_LOCK",
                        format!(
                            "Lock file not found at {}. Use CreateIfMissing mode to create one.",
                            path.display()
                        ),
                    ));
                    return (
                        build_result(GateVerdict::Hold, reason_codes, diagnostics, attempt_id),
                        None,
                    );
                }

                match read_lock_file(path) {
                    Ok(lock) => {
                        if lock.plan_id != plan.metadata.plan_id {
                            reason_codes.push(reason_codes::PLAN_ID_MISMATCH.to_string());
                            diagnostics.push(Diagnostic::error(
                                "PLAN_ID_MISMATCH",
                                format!(
                                    "Lock planId '{}' does not match '{}'",
                                    lock.plan_id, plan.metadata.plan_id
                                ),
                            ));
                        }

                        if lock.hashes.plan_hash != hashes.plan_hash {
                            reason_codes.push(reason_codes::PLAN_HASH_MISMATCH.to_string());
                            diagnostics.push(Diagnostic::error(
                                "PLAN_HASH_MISMATCH",
                                "Plan content has changed since lock was created",
                            ));
                        }

                        let verdict = if diagnostics.iter().any(|d| d.severity == Severity::Error) {
                            GateVerdict::Fail
                        } else {
                            reason_codes.push(reason_codes::LOCK_PASS.to_string());
                            GateVerdict::Pass
                        };

                        (
                            build_result(verdict, reason_codes, diagnostics, attempt_id),
                            Some(lock),
                        )
                    }
                    Err(e) => {
                        reason_codes.push(reason_codes::PLAN_LOCK_PARSE_ERROR.to_string());
                        diagnostics.push(Diagnostic::error("PLAN_LOCK_PARSE_ERROR", e));
                        (
                            build_result(GateVerdict::Fail, reason_codes, diagnostics, attempt_id),
                            None,
                        )
                    }
                }
            }
            LockMode::CreateIfMissing => {
                if lock_exists {
                    // Fallback to verify
                    return Self::evaluate(plan, path, LockMode::VerifyExisting, attempt_id);
                }

                let lock = PlanLock {
                    schema: "praxis-lock/v0.1".into(),
                    plan_id: plan.metadata.plan_id.clone(),
                    hashes,
                    locked_at: Utc::now(),
                };

                if let Err(e) = write_lock_file(path, &lock) {
                    reason_codes.push(reason_codes::PLAN_LOCK_PARSE_ERROR.to_string());
                    diagnostics.push(Diagnostic::error("LOCK_WRITE_FAILED", e));
                    return (
                        build_result(GateVerdict::Fail, reason_codes, diagnostics, attempt_id),
                        None,
                    );
                }

                reason_codes.push(reason_codes::LOCK_CREATED.to_string());
                diagnostics.push(Diagnostic::info(
                    "LOCK_CREATED",
                    format!("Created lock file at {}", path.display()),
                ));
                (
                    build_result(GateVerdict::Pass, reason_codes, diagnostics, attempt_id),
                    Some(lock),
                )
            }
            LockMode::RefreshExplicit => {
                let lock = PlanLock {
                    schema: "praxis-lock/v0.1".into(),
                    plan_id: plan.metadata.plan_id.clone(),
                    hashes,
                    locked_at: Utc::now(),
                };

                if let Err(e) = write_lock_file(path, &lock) {
                    reason_codes.push(reason_codes::PLAN_LOCK_PARSE_ERROR.to_string());
                    diagnostics.push(Diagnostic::error("LOCK_WRITE_FAILED", e));
                    return (
                        build_result(GateVerdict::Fail, reason_codes, diagnostics, attempt_id),
                        None,
                    );
                }

                reason_codes.push(reason_codes::LOCK_PASS.to_string());
                diagnostics.push(Diagnostic::info(
                    "LOCK_REFRESHED",
                    format!("Refreshed lock file at {}", path.display()),
                ));
                (
                    build_result(GateVerdict::Pass, reason_codes, diagnostics, attempt_id),
                    Some(lock),
                )
            }
        }
    }
}

fn sha256_hex(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

fn read_lock_file(path: &Path) -> Result<PlanLock, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_lock_file(path: &Path, lock: &PlanLock) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(lock).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn build_result(
    verdict: GateVerdict,
    reason_codes: Vec<String>,
    diagnostics: Vec<Diagnostic>,
    attempt_id: &str,
) -> GateResult {
    GateResult {
        gate_name: "LockGate".into(),
        verdict,
        reason_codes,
        diagnostics,
        failed_criteria_ids: Vec::new(),
        evidence_refs: Vec::new(),
        attempt_id: attempt_id.to_string(),
        timestamp: Utc::now(),
        repair_hint: if verdict == GateVerdict::Fail {
            Some("Check plan changes against lock file".into())
        } else {
            None
        },
    }
}
