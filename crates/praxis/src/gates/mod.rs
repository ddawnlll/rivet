//! # praxis::gates
//!
//! 8-Gate Truth Kernel Pipeline implementations.

pub mod schema_gate;
pub mod lock_gate;
pub mod evidence_gate;
pub mod wiring_gate;
pub mod exec_gate;
pub mod coverage_gate;
pub mod final_gate;

pub use schema_gate::SchemaGate;
pub use lock_gate::LockGate;
pub use evidence_gate::EvidenceGate;
pub use wiring_gate::WiringGate;
pub use exec_gate::ExecGate;
pub use coverage_gate::CoverageGate;
pub use final_gate::FinalGate;
