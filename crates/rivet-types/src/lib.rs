//! # rivet-types
//!
//! Strongly typed shared identifiers, revision counters, epistemic classes,
//! and fundamental value objects used across Rivet.

use std::fmt;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Macro to generate type-safe prefixed string IDs
macro_rules! define_id {
    ($name:ident, $prefix:expr) => {
        #[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn new() -> Self {
                Self(format!("{}_{}", $prefix, Uuid::new_v4().simple()))
            }

            pub fn from_string(s: impl Into<String>) -> Self {
                Self(s.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", stringify!($name), self.0)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }
    };
}

define_id!(SessionId, "sess");
define_id!(TaskId, "task");
define_id!(ObligationId, "oblg");
define_id!(ClaimId, "claim");
define_id!(EvidenceId, "evid");
define_id!(ArtifactId, "artf");
define_id!(WorkspaceId, "ws");
define_id!(ActionId, "act");
define_id!(ReceiptId, "rcpt");

/// Monotonically increasing revision counter bound to mutable state
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
pub struct Revision(pub u64);

impl Revision {
    pub const ZERO: Self = Self(0);

    pub fn next(&self) -> Self {
        Self(self.0 + 1)
    }
}

impl fmt::Display for Revision {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "r{}", self.0)
    }
}

/// Epistemic status of a belief or claim in Noesis / ACCP
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EpistemicStatus {
    /// Inferred or hypothesized by cognitive controller (non-authoritative)
    Hypothetical,
    /// Supported by unverified evidence references
    Supported,
    /// Mechanically verified by Praxis execution gates
    Verified,
    /// Rejected by contradiction or falsification
    Rejected,
    /// Deprecated due to base revision / repository change
    Superseded,
}

impl fmt::Display for EpistemicStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Hypothetical => write!(f, "hypothetical"),
            Self::Supported => write!(f, "supported"),
            Self::Verified => write!(f, "verified"),
            Self::Rejected => write!(f, "rejected"),
            Self::Superseded => write!(f, "superseded"),
        }
    }
}

/// Scope boundary for claims, evidence, actions, and verification
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Scope {
    pub repository: String,
    pub path_pattern: Option<String>,
    pub revision: Revision,
}

impl Scope {
    pub fn global(repo: impl Into<String>, rev: Revision) -> Self {
        Self {
            repository: repo.into(),
            path_pattern: None,
            revision: rev,
        }
    }

    pub fn path(repo: impl Into<String>, pattern: impl Into<String>, rev: Revision) -> Self {
        Self {
            repository: repo.into(),
            path_pattern: Some(pattern.into()),
            revision: rev,
        }
    }
}

/// Standard error taxonomy for Rivet
#[derive(thiserror::Error, Debug)]
pub enum RivetError {
    #[error("ACCP semantic invariant violation: {0}")]
    SemanticViolation(String),

    #[error("Authority error: {0}")]
    AuthorityDenied(String),

    #[error("Praxis verification failure: {0}")]
    VerificationFailed(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Model provider error: {0}")]
    Model(String),

    #[error("Runtime execution error: {0}")]
    Runtime(String),

    #[error("Repository error: {0}")]
    Repository(String),

    #[error("Protocol serialization error: {0}")]
    Serialization(String),
}

pub type RivetResult<T> = Result<T, RivetError>;
