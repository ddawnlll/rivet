//! # hephaestus (Cold-Path Cognition & Reframing)
//!
//! Activates only when the cognitive loop stagnates, detects repeated failure clusters,
//! and proposes new problem framings without mutating Hard State directly.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Stagnation signal triggering cold-path cognition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagnationSignal {
    pub consecutive_failures: usize,
    pub failure_cluster_id: Option<String>,
    pub timestamp: DateTime<Utc>,
}

/// Reframing proposal emitted by Hephaestus
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReframingProposal {
    pub suggested_frame: String,
    pub discarded_approaches: Vec<String>,
    pub new_hypothesis_candidates: Vec<String>,
    pub timestamp: DateTime<Utc>,
}

pub struct HephaestusEngine {
    pub failure_threshold: usize,
}

impl HephaestusEngine {
    pub fn new(threshold: usize) -> Self {
        Self {
            failure_threshold: threshold,
        }
    }

    /// Check if consecutive failures warrant cold-path intervention
    pub fn should_intervene(&self, consecutive_fails: usize) -> bool {
        consecutive_fails >= self.failure_threshold
    }

    /// Produce a reframing proposal to unblock the agent
    pub fn propose_reframing(&self, failed_actions: &[String]) -> ReframingProposal {
        ReframingProposal {
            suggested_frame:
                "Reset local working assumptions; step back to higher-level contracts.".into(),
            discarded_approaches: failed_actions.to_vec(),
            new_hypothesis_candidates: vec![
                "Underlying interface contract might be mismatching".into(),
                "Target file may require clean rebuild instead of in-place patch".into(),
            ],
            timestamp: Utc::now(),
        }
    }
}
