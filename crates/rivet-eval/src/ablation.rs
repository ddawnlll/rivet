//! # rivet-eval::ablation
//!
//! Defines ablation configurations to scientifically isolate the contribution
//! of each Rivet subsystem (Noesis, ACCP, Praxis, Hephaestus).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AblationMode {
    /// Full Rivet architecture with all subsystems enabled
    FullRivet,
    /// Without Noesis Hard State (no replayable event ledger / revisioning)
    NoHardState,
    /// Without ACCP 3.0 Semantic Gates (proposals bypass authorization check)
    NoACCPGates,
    /// Without Praxis Verity Mechanical Verification (prose completion admitted)
    NoPraxisVerity,
    /// Without Hephaestus Cold-Path Cognition (no stagnation intervention)
    NoHephaestus,
}

impl AblationMode {
    pub fn all_modes() -> Vec<Self> {
        vec![
            Self::FullRivet,
            Self::NoHardState,
            Self::NoACCPGates,
            Self::NoPraxisVerity,
            Self::NoHephaestus,
        ]
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::FullRivet => "Full Rivet (Canonical)",
            Self::NoHardState => "Ablation: -Noesis Hard State",
            Self::NoACCPGates => "Ablation: -ACCP Semantic Gate",
            Self::NoPraxisVerity => "Ablation: -Praxis Verification",
            Self::NoHephaestus => "Ablation: -Hephaestus Cold-Path",
        }
    }
}
