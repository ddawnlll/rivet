//! # rivet-runtime::roles
//!
//! Least-Capability Worker Role Policies & Granular Action Filtering.
//! Enforces allow/deny matrices based on assigned agent roles.

use rivet_types::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerRole {
    MechanicalRefactor,
    Explorer,
    Tester,
    LeadPlanner,
    BlindReviewer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityPolicy {
    pub role: WorkerRole,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
}

impl CapabilityPolicy {
    pub fn for_role(role: WorkerRole) -> Self {
        match role {
            WorkerRole::MechanicalRefactor => Self {
                role,
                allow: vec![
                    "file.read".into(),
                    "file.write".into(),
                    "semantic.patch".into(),
                    "git.diff".into(),
                    "test.targeted".into(),
                ],
                deny: vec![
                    "git.reset_hard".into(),
                    "git.push".into(),
                    "secrets.read".into(),
                    "network.unrestricted".into(),
                ],
            },
            WorkerRole::Explorer => Self {
                role,
                allow: vec![
                    "file.read".into(),
                    "repo.census".into(),
                    "git.diff".into(),
                    "git.status".into(),
                ],
                deny: vec![
                    "file.write".into(),
                    "semantic.patch".into(),
                    "git.reset_hard".into(),
                    "git.push".into(),
                    "secrets.read".into(),
                ],
            },
            WorkerRole::Tester => Self {
                role,
                allow: vec![
                    "file.read".into(),
                    "test.targeted".into(),
                    "test.integration".into(),
                    "git.diff".into(),
                ],
                deny: vec![
                    "git.reset_hard".into(),
                    "git.push".into(),
                    "secrets.read".into(),
                ],
            },
            WorkerRole::LeadPlanner => Self {
                role,
                allow: vec![
                    "file.read".into(),
                    "repo.census".into(),
                    "goal.compile".into(),
                    "obligation.create".into(),
                ],
                deny: vec![
                    "git.reset_hard".into(),
                    "git.push".into(),
                    "secrets.read".into(),
                ],
            },
            WorkerRole::BlindReviewer => Self {
                role,
                allow: vec![
                    "file.read".into(),
                    "review.evaluate".into(),
                    "praxis.verify".into(),
                ],
                deny: vec![
                    "file.write".into(),
                    "semantic.patch".into(),
                    "git.reset_hard".into(),
                    "git.push".into(),
                    "secrets.read".into(),
                ],
            },
        }
    }

    pub fn is_allowed(&self, capability: &str) -> bool {
        // Explicit deny always takes precedence
        if self
            .deny
            .iter()
            .any(|d| d == capability || capability.starts_with(&format!("{d}.")))
        {
            return false;
        }
        // Check allow list
        self.allow
            .iter()
            .any(|a| a == capability || capability.starts_with(&format!("{a}.")))
    }

    pub fn enforce(&self, capability: &str) -> RivetResult<()> {
        if !self.is_allowed(capability) {
            Err(RivetError::AuthorityDenied(format!(
                "Worker role '{:?}' is not permitted to execute capability '{}'",
                self.role, capability
            )))
        } else {
            Ok(())
        }
    }
}
