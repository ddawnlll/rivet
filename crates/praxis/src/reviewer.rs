//! # praxis::reviewer
//!
//! Blind Reviewer Topology and Reviewer Independence.
//! Enforces Invariant I-08 (reviewer is blind to implementer reasoning/transcript)
//! and Invariant I-14 (duplicate reviewer outputs do not inflate evidence).

use chrono::Utc;
use rivet_types::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum VerificationLevel {
    V0Syntax,
    V1StaticDiagnostics,
    V2Compile,
    V3TargetedTest,
    V4Integration,
    V5Regression,
    V6PlatformMatrix,
    V7DomainInvariant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewPayload {
    pub goal_description: String,
    pub obligation_id: ObligationId,
    pub scope: Scope,
    pub diff_content: String,
    pub evidence_refs: Vec<EvidenceId>,
    /// Set to true if implementer reasoning / thought process was leaked into payload
    pub contains_implementer_reasoning: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ReviewVerdict {
    Approved {
        review_receipt_id: ReceiptId,
        confidence: f64,
        rationale: String,
        verified_scope: Scope,
        timestamp: chrono::DateTime<Utc>,
    },
    Rejected {
        review_receipt_id: ReceiptId,
        reasons: Vec<String>,
        suggested_repairs: Vec<String>,
        timestamp: chrono::DateTime<Utc>,
    },
    NeedsMoreEvidence {
        missing_requirements: Vec<String>,
        timestamp: chrono::DateTime<Utc>,
    },
}

impl ReviewVerdict {
    pub fn is_approved(&self) -> bool {
        matches!(self, Self::Approved { .. })
    }
}

pub struct BlindReviewerEngine {
    reviewed_hashes: Arc<Mutex<HashSet<String>>>,
}

impl Default for BlindReviewerEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl BlindReviewerEngine {
    pub fn new() -> Self {
        Self {
            reviewed_hashes: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Perform independent evaluation of a proposed patch
    pub async fn evaluate_review(&self, payload: &ReviewPayload) -> RivetResult<ReviewVerdict> {
        // Enforce Invariant I-08: Reviewer must be blind to implementer reasoning
        if payload.contains_implementer_reasoning {
            return Err(RivetError::AuthorityDenied(
                "Invariant I-08 violation: reviewer payload contains implementer reasoning transcript. Independence compromised.".into(),
            ));
        }

        if payload.diff_content.trim().is_empty() {
            return Ok(ReviewVerdict::NeedsMoreEvidence {
                missing_requirements: vec![
                    "Empty patch diff; no code change presented for review".into(),
                ],
                timestamp: Utc::now(),
            });
        }

        // Check for destructive commands or scope violations
        let mut reasons = Vec::new();
        let mut suggested_repairs = Vec::new();

        if payload.diff_content.contains("git reset --hard")
            || payload.diff_content.contains("rm -rf /")
        {
            reasons.push("Destructive operation detected in patch payload".into());
            suggested_repairs.push("Replace destructive reset with targeted revert".into());
        }

        // Scope check in diff
        for line in payload.diff_content.lines() {
            if let Some(file_path) = line.strip_prefix("+++ b/")
                && !payload.scope.allows_path(
                    &payload.scope.repository,
                    file_path,
                    payload.scope.revision,
                )
            {
                reasons.push(format!(
                    "File '{}' is outside declared write scope {:?}",
                    file_path, payload.scope
                ));
                suggested_repairs.push(format!(
                    "Restrict changes to files inside scope {:?}",
                    payload.scope
                ));
            }
        }

        if !reasons.is_empty() {
            return Ok(ReviewVerdict::Rejected {
                review_receipt_id: ReceiptId::new(),
                reasons,
                suggested_repairs,
                timestamp: Utc::now(),
            });
        }

        // Invariant I-14 check: Calculate review hash to detect duplicate/correlated reviews
        let mut hasher = Sha256::new();
        hasher.update(payload.diff_content.as_bytes());
        hasher.update(payload.obligation_id.as_str().as_bytes());
        let hash = hex::encode(hasher.finalize());

        let mut seen = self.reviewed_hashes.lock().await;
        let is_duplicate = !seen.insert(hash);

        // If duplicate, do not inflate confidence
        let confidence = if is_duplicate { 0.5 } else { 0.95 };

        Ok(ReviewVerdict::Approved {
            review_receipt_id: ReceiptId::new(),
            confidence,
            rationale: if is_duplicate {
                "Approved (Warning: duplicate review detected; evidence confidence not inflated per I-14)".into()
            } else {
                "Independent blind review passed all structural and scope checks".into()
            },
            verified_scope: payload.scope.clone(),
            timestamp: Utc::now(),
        })
    }
}
