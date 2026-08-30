//! # praxis::pipeline
//!
//! Orchestrates the full 8-Gate Verity Truth Kernel Pipeline.

use std::path::{Path, PathBuf};
use accp::VerificationReceipt;
use chrono::Utc;
use rivet_types::*;
use serde::{Deserialize, Serialize};

use crate::gates::coverage_gate::CoverageGate;
use crate::gates::evidence_gate::EvidenceGate;
use crate::gates::exec_gate::ExecGate;
use crate::gates::final_gate::FinalGate;
use crate::gates::lock_gate::{LockGate, LockMode};
use crate::gates::schema_gate::SchemaGate;
use crate::gates::wiring_gate::WiringGate;
use crate::ledger::Ledger;
use crate::types::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerityPipelineResult {
    pub overall_verdict: GateVerdict,
    pub gate_results: Vec<GateResult>,
    pub final_receipt: Option<VerificationReceipt>,
    pub execution_duration_ms: u64,
    pub timestamp: chrono::DateTime<Utc>,
}

pub struct VerityPipeline {
    repo_root: PathBuf,
    lock_mode: LockMode,
    coverage_threshold_pct: Option<f64>,
}

impl VerityPipeline {
    pub fn new(repo_root: impl AsRef<Path>) -> Self {
        Self {
            repo_root: repo_root.as_ref().to_path_buf(),
            lock_mode: LockMode::CreateIfMissing,
            coverage_threshold_pct: None,
        }
    }

    pub fn with_lock_mode(mut self, mode: LockMode) -> Self {
        self.lock_mode = mode;
        self
    }

    pub fn with_coverage_threshold(mut self, min_pct: f64) -> Self {
        self.coverage_threshold_pct = Some(min_pct);
        self
    }

    /// Execute the full 8-Gate Pipeline against a PlanSpec
    pub async fn run(
        &self,
        plan: &PlanSpec,
        ledger: Option<&Ledger>,
        changed_files: &[ChangedFile],
        coverage_file: Option<impl AsRef<Path>>,
        attempt_id: &str,
    ) -> VerityPipelineResult {
        let start = std::time::Instant::now();
        let mut gate_results = Vec::new();

        // 1. SchemaGate
        let g1 = SchemaGate::evaluate(plan, attempt_id);
        gate_results.push(g1);

        // 2. LockGate
        let lock_path = self.repo_root.join(".praxis").join(format!("{}.lock.json", plan.metadata.plan_id));
        let (g2, _) = LockGate::evaluate(plan, &lock_path, self.lock_mode, attempt_id);
        gate_results.push(g2);

        // 3. EvidenceGate
        let g3 = EvidenceGate::evaluate(plan, ledger, changed_files, attempt_id);
        gate_results.push(g3);

        // 4. WiringGate
        let g4 = WiringGate::evaluate(plan, attempt_id);
        gate_results.push(g4);

        // 5. ExecGate
        let (g5, command_results) = ExecGate::execute_all(plan, &self.repo_root, attempt_id).await;
        gate_results.push(g5);

        // 6. CoverageGate
        if let Some(min_cov) = self.coverage_threshold_pct {
            let g6 = CoverageGate::evaluate(coverage_file.as_ref(), min_cov, attempt_id);
            gate_results.push(g6);
        }

        // 7/8. FinalGate
        let g_final = FinalGate::evaluate(plan, &gate_results, &command_results, attempt_id);
        let overall_verdict = g_final.verdict;
        gate_results.push(g_final);

        let duration_ms = start.elapsed().as_millis() as u64;

        let final_receipt = if overall_verdict == GateVerdict::Pass {
            Some(VerificationReceipt {
                receipt_id: ReceiptId::new(),
                obligation_id: ObligationId::new(),
                passed: true,
                evidence_id: EvidenceId::new(),
                verified_scope: Scope::global("repo", Revision::ZERO),
                diagnostics: None,
                timestamp: Utc::now(),
            })
        } else {
            None
        };

        VerityPipelineResult {
            overall_verdict,
            gate_results,
            final_receipt,
            execution_duration_ms: duration_ms,
            timestamp: Utc::now(),
        }
    }
}
