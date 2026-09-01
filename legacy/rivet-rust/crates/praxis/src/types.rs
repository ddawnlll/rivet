//! # praxis::types
//!
//! Canonical types for the Verity Truth Kernel, 8-Gate Pipeline,
//! and cryptographic evidence ledger.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Verdict returned by individual gates and the overall pipeline
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum GateVerdict {
    /// Definitive pass: all requirements met
    Pass,
    /// Non-fatal hold: incomplete evidence or requires attention
    Hold,
    /// Definitive failure: invariant or safety rule violated
    Fail,
    /// Informational only (cannot satisfy deterministic criteria)
    Info,
}

impl std::fmt::Display for GateVerdict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pass => write!(f, "PASS"),
            Self::Hold => write!(f, "HOLD"),
            Self::Fail => write!(f, "FAIL"),
            Self::Info => write!(f, "INFO"),
        }
    }
}

/// Diagnostic severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// Diagnostic message emitted by gates during validation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub code: String,
    pub severity: Severity,
    pub message: String,
    pub path: Option<String>,
    pub line: Option<usize>,
    pub col: Option<usize>,
}

impl Diagnostic {
    pub fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            severity: Severity::Error,
            message: message.into(),
            path: None,
            line: None,
            col: None,
        }
    }

    pub fn warning(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            severity: Severity::Warning,
            message: message.into(),
            path: None,
            line: None,
            col: None,
        }
    }

    pub fn info(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            severity: Severity::Info,
            message: message.into(),
            path: None,
            line: None,
            col: None,
        }
    }
}

/// Standard Reason Codes across all Verity Gates
pub mod reason_codes {
    // SchemaGate
    pub const SCHEMA_PASS: &str = "SCHEMA_PASS";
    pub const SCHEMA_INVALID_JSON: &str = "SCHEMA_INVALID_JSON";
    pub const SCHEMA_VALIDATION_ERROR: &str = "SCHEMA_VALIDATION_ERROR";
    pub const MISSING_REQUIRED_FIELD: &str = "MISSING_REQUIRED_FIELD";

    // LockGate
    pub const LOCK_PASS: &str = "LOCK_PASS";
    pub const LOCK_CREATED: &str = "LOCK_CREATED";
    pub const MISSING_PLAN_LOCK: &str = "MISSING_PLAN_LOCK";
    pub const PLAN_LOCK_PARSE_ERROR: &str = "PLAN_LOCK_PARSE_ERROR";
    pub const PLAN_ID_MISMATCH: &str = "PLAN_ID_MISMATCH";
    pub const PLAN_HASH_MISMATCH: &str = "PLAN_HASH_MISMATCH";

    // EvidenceGate
    pub const EVIDENCE_PASS: &str = "EVIDENCE_PASS";
    pub const EVIDENCE_LEDGER_MISSING: &str = "EVIDENCE_LEDGER_MISSING";
    pub const EVIDENCE_LEDGER_PARSE_ERROR: &str = "EVIDENCE_LEDGER_PARSE_ERROR";
    pub const FORBIDDEN_FILE_CHANGED: &str = "FORBIDDEN_FILE_CHANGED";
    pub const CHANGED_FILE_OUTSIDE_ALLOWED_FILES: &str = "CHANGED_FILE_OUTSIDE_ALLOWED_FILES";
    pub const DIFF_EMPTY: &str = "DIFF_EMPTY";
    pub const DIVERGENCE_DETECTED: &str = "DIVERGENCE_DETECTED";
    pub const ATTEMPT_ID_MISMATCH: &str = "ATTEMPT_ID_MISMATCH";
    pub const REQUIRED_EVIDENCE_TYPE_MISSING: &str = "REQUIRED_EVIDENCE_TYPE_MISSING";
    pub const DETERMINISTIC_EVIDENCE_MISSING: &str = "DETERMINISTIC_EVIDENCE_MISSING";
    pub const ATTESTATION_FAILED: &str = "ATTESTATION_FAILED";

    // WiringGate
    pub const WIRING_PASS: &str = "WIRING_PASS";
    pub const CIRCULAR_DEPENDENCY: &str = "CIRCULAR_DEPENDENCY";
    pub const UNRESOLVED_DEPENDENCY: &str = "UNRESOLVED_DEPENDENCY";
    pub const DISCONNECTED_GRAPH: &str = "DISCONNECTED_GRAPH";

    // ExecGate
    pub const EXEC_PASS: &str = "EXEC_PASS";
    pub const COMMAND_SUCCEEDED: &str = "COMMAND_SUCCEEDED";
    pub const COMMAND_NOT_ALLOWED: &str = "COMMAND_NOT_ALLOWED";
    pub const COMMAND_DENIED: &str = "COMMAND_DENIED";
    pub const COMMAND_TIMEOUT: &str = "COMMAND_TIMEOUT";
    pub const COMMAND_CRASHED: &str = "COMMAND_CRASHED";
    pub const EXIT_CODE_NONZERO: &str = "EXIT_CODE_NONZERO";
    pub const UNEXPECTED_EXIT_CODE: &str = "UNEXPECTED_EXIT_CODE";
    pub const NO_TESTS_FOUND: &str = "NO_TESTS_FOUND";
    pub const EXPECTED_OUTPUT_MISSING: &str = "EXPECTED_OUTPUT_MISSING";
    pub const WATCH_MODE_DETECTED: &str = "WATCH_MODE_DETECTED";
    pub const POSSIBLE_WATCH_MODE: &str = "POSSIBLE_WATCH_MODE";
    pub const DISCOVERY_COMMAND_CANNOT_SATISFY_FINAL: &str =
        "DISCOVERY_COMMAND_CANNOT_SATISFY_FINAL";

    // CoverageGate
    pub const COVERAGE_PASS: &str = "COVERAGE_PASS";
    pub const COVERAGE_BELOW_THRESHOLD: &str = "COVERAGE_BELOW_THRESHOLD";
    pub const COVERAGE_REPORT_MISSING: &str = "COVERAGE_REPORT_MISSING";
    pub const COVERAGE_PARSE_ERROR: &str = "COVERAGE_PARSE_ERROR";

    // FinalGate
    pub const ALL_CRITERIA_MET: &str = "ALL_CRITERIA_MET";
    pub const CRITERIA_FAILED: &str = "CRITERIA_FAILED";
    pub const CRITERIA_PARTIAL: &str = "CRITERIA_PARTIAL";
    pub const NO_CRITERIA_DEFINED: &str = "NO_CRITERIA_DEFINED";
    pub const NO_DETERMINISTIC_CRITERIA: &str = "NO_DETERMINISTIC_CRITERIA";
    pub const PRIOR_GATE_NOT_PASS: &str = "PRIOR_GATE_NOT_PASS";
    pub const MANUAL_REVIEW_REQUIRED: &str = "MANUAL_REVIEW_REQUIRED";
}

/// Generic gate result emitted by each gate in the pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateResult {
    pub gate_name: String,
    pub verdict: GateVerdict,
    pub reason_codes: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
    pub failed_criteria_ids: Vec<String>,
    pub evidence_refs: Vec<String>,
    pub attempt_id: String,
    pub timestamp: DateTime<Utc>,
    pub repair_hint: Option<String>,
}

/// A changed file record indicating status and path
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String, // "added", "modified", "deleted", "unknown"
}

/// Verification configuration for an acceptance criterion
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CriterionVerification {
    pub r#type: String, // "command", "test", "manual_review", "llm_advisory", "file_match"
    pub command_ref: Option<String>,
    pub deterministic: bool,
    pub advisory_only: bool,
}

/// Single acceptance criterion in a plan
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcceptanceCriterion {
    pub id: String,
    pub description: String,
    pub verification: CriterionVerification,
}

/// Single task in a plan
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanTask {
    pub id: String,
    pub name: String,
    pub description: String,
    pub dependencies: Vec<String>,
    pub acceptance_criteria: Vec<AcceptanceCriterion>,
}

/// Declared allowed command in a plan
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExactAllowedCommand {
    pub id: String,
    pub command: String,
    pub cwd: Option<String>,
    pub kind: String, // "test", "build", "discovery", "lint"
    pub timeout_seconds: Option<u64>,
    pub expected_exit_code: Option<i32>,
    pub shell_allowed: Option<bool>,
    pub no_tests_found_is_failure: Option<bool>,
    pub expected_output_patterns: Vec<String>,
}

/// Workspace boundary specification
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PlanWorkspace {
    pub allowed_files: Vec<String>,
    pub forbidden_files: Vec<String>,
}

/// Commands policy in a plan
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PlanCommands {
    pub exact_allowed_commands: Vec<ExactAllowedCommand>,
    pub hard_denied_commands: Vec<String>,
}

/// Complete PlanSpec metadata
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanMetadata {
    pub plan_id: String,
    pub title: String,
    pub version: String,
}

/// Complete PlanSpec representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanSpec {
    pub metadata: PlanMetadata,
    pub workspace: PlanWorkspace,
    pub commands: PlanCommands,
    pub tasks: Vec<PlanTask>,
}

/// Hashes for plan lock and drift validation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanHashes {
    pub plan_hash: String,
    pub workspace_hash: String,
    pub commands_hash: String,
    pub tasks_hash: String,
}

/// Plan lock record on disk
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanLock {
    pub schema: String,
    pub plan_id: String,
    pub hashes: PlanHashes,
    pub locked_at: DateTime<Utc>,
}
