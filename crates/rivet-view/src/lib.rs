//! # rivet-view (Cognitive View Compiler)
//!
//! Multi-stage projection pipeline compiling authoritative Hard State,
//! Soft Workspace, Repository Frontier, and Recent Evidence into task-conditioned
//! model representations.
//!
//! Provides 4 experimental representation modes:
//! - HYBRID (default structured YAML)
//! - RAW_TEXT (linear text)
//! - TRIPLES (Knowledge Graph SPO triples)
//! - PATHS (Hierarchical provenance & dependency paths)

pub mod modes;
pub mod pipeline;

pub use modes::{KnowledgeTriple, ProvenancePath, RepresentationMode};
pub use pipeline::{
    CognitiveViewCompiler, CompilationContext, CompiledViewPayload, OmittedSummary,
};
