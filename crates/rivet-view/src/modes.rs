//! # rivet-view::modes
//!
//! The 4 experimental representation modes for the Cognitive View:
//! - RAW_TEXT: Linear text projection
//! - TRIPLES: SPO Knowledge Graph triples
//! - PATHS: Hierarchical provenance & dependency paths
//! - HYBRID: Canonical structured YAML-like cognitive view

use serde::{Deserialize, Serialize};

/// Representation mode for cognitive serialization
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RepresentationMode {
    #[default]
    Hybrid,
    RawText,
    Triples,
    Paths,
}

impl std::fmt::Display for RepresentationMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Hybrid => write!(f, "HYBRID"),
            Self::RawText => write!(f, "RAW_TEXT"),
            Self::Triples => write!(f, "TRIPLES"),
            Self::Paths => write!(f, "PATHS"),
        }
    }
}

/// SPO Triple for Knowledge Graph representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnowledgeTriple {
    pub subject: String,
    pub predicate: String,
    pub object: String,
}

impl KnowledgeTriple {
    pub fn new(
        subject: impl Into<String>,
        predicate: impl Into<String>,
        object: impl Into<String>,
    ) -> Self {
        Self {
            subject: subject.into(),
            predicate: predicate.into(),
            object: object.into(),
        }
    }

    pub fn to_spo_string(&self) -> String {
        format!("({}, {}, {})", self.subject, self.predicate, self.object)
    }
}

/// Provenance / Dependency Path for PATHS representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvenancePath {
    pub segments: Vec<String>,
}

impl ProvenancePath {
    pub fn new(segments: Vec<String>) -> Self {
        Self { segments }
    }

    pub fn to_path_string(&self) -> String {
        self.segments.join(" -> ")
    }
}
