//! # rivet-types
//!
//! Strongly typed shared identifiers, revision counters, epistemic classes,
//! and fundamental value objects used across Rivet.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;
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
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
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

    /// Return whether this scope admits a concrete repository path at a revision.
    ///
    /// Scope matching is intentionally conservative: repository and revision must
    /// match exactly, and an absent path pattern means the whole repository.
    pub fn allows_path(&self, repository: &str, path: &str, revision: Revision) -> bool {
        if self.repository != repository || self.revision != revision {
            return false;
        }

        let normalized = normalize_relative_path(path);
        match &self.path_pattern {
            None => true,
            Some(pattern) => {
                let norm_pattern = normalize_relative_path(pattern);
                if let Some(prefix) = norm_pattern.strip_suffix("/**")
                    && normalized == prefix
                {
                    return true;
                }
                glob_matches(&norm_pattern, &normalized)
            }
        }
    }

    /// Return whether `narrower` is contained by this scope.
    pub fn contains_scope(&self, narrower: &Scope) -> bool {
        if self.repository != narrower.repository || self.revision != narrower.revision {
            return false;
        }

        match (&self.path_pattern, &narrower.path_pattern) {
            (None, _) => true,
            (Some(outer), Some(inner)) => {
                outer == inner
                    || outer.strip_suffix("/**").is_some_and(|prefix| {
                        inner == prefix || inner.starts_with(&format!("{prefix}/"))
                    })
            }
            (Some(_), None) => false,
        }
    }
}

fn normalize_relative_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_start_matches("./")
        .trim_matches('/')
        .to_string()
}

fn glob_matches(pattern: &str, value: &str) -> bool {
    let Ok(glob) = globset::GlobBuilder::new(pattern)
        .literal_separator(true)
        .build()
    else {
        return false;
    };
    glob.compile_matcher().is_match(value)
}

/// Reject absolute paths and parent traversal before a runtime joins a target
/// with its working directory.
pub fn is_safe_relative_path(path: impl AsRef<Path>) -> bool {
    let path_ref = path.as_ref();
    if path_ref.is_absolute() || path_ref.has_root() {
        return false;
    }
    let s = path_ref.to_string_lossy();
    if s.starts_with('/') || s.starts_with('\\') {
        return false;
    }
    // Check for Windows drive letter like C: or c:
    if s.len() >= 2
        && s.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && s.chars().nth(1) == Some(':')
    {
        return false;
    }
    // Normalize separators so Unix checks catch backslash parent traversals
    let normalized = s.replace('\\', "/");
    let norm_path = Path::new(&normalized);
    if norm_path.is_absolute() || norm_path.has_root() {
        return false;
    }
    !norm_path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
}

/// Tokenize a shell command string respecting single and double quotes and escapes.
pub fn shlex_split(cmd: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;

    for c in cmd.chars() {
        if escaped {
            current.push(c);
            escaped = false;
        } else if c == '\\' && !in_single_quote {
            escaped = true;
        } else if c == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
        } else if c == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
        } else if c.is_whitespace() && !in_single_quote && !in_double_quote {
            if !current.is_empty() {
                args.push(current);
                current = String::new();
            }
        } else {
            current.push(c);
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
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

    #[error("STALE_STATE: expected current revision {expected}, actual {actual}")]
    StaleState {
        expected: Revision,
        actual: Revision,
    },

    #[error("Model provider error: {0}")]
    Model(String),

    #[error("Runtime execution error: {0}")]
    Runtime(String),

    #[error("Repository error: {0}")]
    Repository(String),

    #[error("Protocol serialization error: {0}")]
    Serialization(String),

    #[error("Operation timed out: {0}")]
    Timeout(String),

    #[error("Invalid or unsafe path: {0}")]
    InvalidPath(String),
}

pub type RivetResult<T> = Result<T, RivetError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_matching_is_revision_and_path_bound() {
        let scope = Scope::path("repo", "src/**", Revision(3));
        assert!(scope.allows_path("repo", "src", Revision(3)));
        assert!(scope.allows_path("repo", "src/lib.rs", Revision(3)));
        assert!(scope.allows_path("repo", "src/nested/mod.rs", Revision(3)));
        assert!(!scope.allows_path("repo", "tests/lib.rs", Revision(3)));
        assert!(!scope.allows_path("repo", "src/lib.rs", Revision(4)));
        assert!(!scope.allows_path("other", "src/lib.rs", Revision(3)));
        let shallow = Scope::path("repo", "src/*", Revision(3));
        assert!(shallow.allows_path("repo", "src/lib.rs", Revision(3)));
        assert!(!shallow.allows_path("repo", "src/private/lib.rs", Revision(3)));

        let mid_glob = Scope::path("repo", "src/**/test.rs", Revision(3));
        assert!(mid_glob.allows_path("repo", "src/test.rs", Revision(3)));
        assert!(mid_glob.allows_path("repo", "src/nested/test.rs", Revision(3)));
    }

    #[test]
    fn unsafe_relative_paths_are_rejected() {
        assert!(is_safe_relative_path("src/lib.rs"));
        assert!(!is_safe_relative_path("../secrets.env"));
        assert!(!is_safe_relative_path("..\\secrets.env"));
        assert!(!is_safe_relative_path("foo\\..\\..\\secrets.env"));
        assert!(!is_safe_relative_path("C:\\secrets.env"));
        assert!(!is_safe_relative_path("/etc/passwd"));
        assert!(!is_safe_relative_path("\\windows\\system32"));
    }

    #[test]
    fn test_shlex_split() {
        let args = shlex_split(
            "cargo test -p rivet-core -- \"my test name\" 'another arg' test\\ with\\ space",
        );
        assert_eq!(
            args,
            vec![
                "cargo",
                "test",
                "-p",
                "rivet-core",
                "--",
                "my test name",
                "another arg",
                "test with space"
            ]
        );
    }
}
