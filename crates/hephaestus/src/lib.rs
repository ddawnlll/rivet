//! # hephaestus (Cold-Path Cognition & Reframing)
//!
//! Activates when the fast cognitive loop stagnates, detects failure clusters,
//! and proposes new problem framings to unblock the agent without mutating Hard State directly.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Stagnation signal triggering cold-path cognition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagnationSignal {
    pub consecutive_failures: usize,
    pub failure_cluster_id: Option<String>,
    pub failed_targets: Vec<String>,
    pub timestamp: DateTime<Utc>,
}

/// Reframing strategy classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReframingStrategy {
    /// Discard local hypothesis and inspect underlying interface contracts
    InterfaceContractMismatch,
    /// Target file corrupted or unpatchable; clean rewrite required
    CleanRewrite,
    /// Broaden scope to include caller or dependent crates
    ScopeExpansion,
    /// Environmental / dependency failure (rebuild or re-install)
    EnvironmentRebuild,
}

/// Reframing proposal emitted by Hephaestus
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReframingProposal {
    pub strategy: ReframingStrategy,
    pub suggested_frame: String,
    pub discarded_approaches: Vec<String>,
    pub new_hypothesis_candidates: Vec<String>,
    pub suggested_focus: Vec<String>,
    pub suggested_policy_repair: Option<String>,
    pub timestamp: DateTime<Utc>,
}

/// Tracks failure history across turns
#[derive(Debug, Clone, Default)]
pub struct FailureClusterTracker {
    pub consecutive_failures: usize,
    pub target_failure_counts: HashMap<String, usize>,
    pub last_errors: Vec<String>,
}

impl FailureClusterTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_failure(&mut self, target: &str, error_msg: &str) {
        self.consecutive_failures += 1;
        *self
            .target_failure_counts
            .entry(target.to_string())
            .or_insert(0) += 1;
        if self.last_errors.len() >= 5 {
            self.last_errors.remove(0);
        }
        self.last_errors.push(error_msg.to_string());
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.target_failure_counts.clear();
        self.last_errors.clear();
    }
}

#[derive(Debug, Clone)]
pub struct HephaestusEngine {
    pub enabled: bool,
    pub failure_threshold: usize,
}

impl HephaestusEngine {
    pub fn new(threshold: usize) -> Self {
        Self {
            enabled: false,
            failure_threshold: threshold,
        }
    }

    pub fn enabled(threshold: usize) -> Self {
        Self {
            enabled: true,
            failure_threshold: threshold,
        }
    }

    pub fn disabled() -> Self {
        Self {
            enabled: false,
            failure_threshold: 3,
        }
    }

    pub fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    /// Check if consecutive failures warrant cold-path intervention
    pub fn should_intervene(&self, tracker: &FailureClusterTracker) -> bool {
        self.enabled && tracker.consecutive_failures >= self.failure_threshold
    }

    /// Analyze failure patterns and generate an optimal ReframingProposal
    pub fn analyze_and_reframe(
        &self,
        tracker: &FailureClusterTracker,
        current_hypotheses: &[String],
    ) -> ReframingProposal {
        let (strategy, frame, new_hyps) = if tracker
            .last_errors
            .iter()
            .any(|e| e.contains("cannot find") || e.contains("mismatched types"))
        {
            (
                ReframingStrategy::InterfaceContractMismatch,
                "Repeated type or contract errors detected. Reset local assumptions and inspect upstream trait definitions.",
                vec![
                    "Upstream trait or struct definition does not match local usage".into(),
                    "Missing import or feature flag in dependency declaration".into(),
                ],
            )
        } else if tracker
            .last_errors
            .iter()
            .any(|e| e.contains("timed out") || e.contains("timeout"))
        {
            (
                ReframingStrategy::EnvironmentRebuild,
                "Command execution timeout detected. Step back from full test suite to targeted unit tests.",
                vec!["Test suite is hanging on an infinite loop or external I/O call".into()],
            )
        } else {
            (
                ReframingStrategy::ScopeExpansion,
                "Repeated local failure. Expand search scope beyond current target files.",
                vec![
                    "Root cause is in an adjacent module, not the current target".into(),
                    "Clean rebuild and fresh test run needed".into(),
                ],
            )
        };

        let suggested_focus: Vec<String> = tracker.target_failure_counts.keys().cloned().collect();
        let suggested_policy_repair = match strategy {
            ReframingStrategy::InterfaceContractMismatch => {
                Some("Restrict action capability to inspect and search until upstream trait interfaces are verified".into())
            }
            ReframingStrategy::EnvironmentRebuild => {
                Some("Enforce reduced command timeout bounds and require unit test scope before full suite execution".into())
            }
            _ => None,
        };

        ReframingProposal {
            strategy,
            suggested_frame: frame.into(),
            discarded_approaches: current_hypotheses.to_vec(),
            new_hypothesis_candidates: new_hyps,
            suggested_focus,
            suggested_policy_repair,
            timestamp: Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hephaestus_stagnation_detection_and_reframing() {
        let engine = HephaestusEngine::enabled(3);
        let mut tracker = FailureClusterTracker::new();

        tracker.record_failure("src/auth.rs", "error[E0308]: mismatched types");
        assert!(!engine.should_intervene(&tracker));

        tracker.record_failure("src/auth.rs", "error[E0308]: mismatched types");
        tracker.record_failure("src/auth.rs", "error[E0412]: cannot find type");
        assert!(engine.should_intervene(&tracker));

        let reframing = engine.analyze_and_reframe(&tracker, &["Patch auth in-place".into()]);
        assert_eq!(
            reframing.strategy,
            ReframingStrategy::InterfaceContractMismatch
        );
        assert!(!reframing.new_hypothesis_candidates.is_empty());
    }

    #[test]
    fn test_hephaestus_disabled_by_default() {
        let engine = HephaestusEngine::new(3);
        let mut tracker = FailureClusterTracker::new();
        for _ in 0..10 {
            tracker.record_failure("src/lib.rs", "error");
        }
        assert!(!engine.should_intervene(&tracker));
    }
}
