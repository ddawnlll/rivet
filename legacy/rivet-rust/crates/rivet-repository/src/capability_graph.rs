//! # rivet-repository::capability_graph
//!
//! Capability mapping and Retrieve-and-Rank provider selection.
//! Discovers and ranks candidate tools and providers based on task shape,
//! cost, effect safety, and reliability.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityEffect {
    ReadOnly,
    ScopedWrite,
    GlobalMutation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityCost {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityProvider {
    pub provider_id: String,
    pub capability_id: String,
    pub description: String,
    pub effect: CapabilityEffect,
    pub cost: CapabilityCost,
    pub confidence: f64,
    pub requires_indexed_workspace: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CapabilityGraph {
    pub providers: HashMap<String, Vec<CapabilityProvider>>,
}

impl CapabilityGraph {
    pub fn new() -> Self {
        let mut graph = Self::default();
        graph.register_builtin_defaults();
        graph
    }

    pub fn register_provider(&mut self, provider: CapabilityProvider) {
        self.providers
            .entry(provider.capability_id.clone())
            .or_default()
            .push(provider);
    }

    /// Retrieve and rank candidate providers for a given capability requirement
    pub fn retrieve_and_rank(
        &self,
        capability_id: &str,
        workspace_indexed: bool,
    ) -> Vec<&CapabilityProvider> {
        let Some(candidates) = self.providers.get(capability_id) else {
            return Vec::new();
        };

        let mut available: Vec<_> = candidates
            .iter()
            .filter(|p| !p.requires_indexed_workspace || workspace_indexed)
            .collect();

        // Sort by confidence (descending) then cost (ascending)
        available.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.cost.cmp(&b.cost))
        });

        available
    }

    fn register_builtin_defaults(&mut self) {
        // symbol.references
        self.register_provider(CapabilityProvider {
            provider_id: "rust-analyzer.references".into(),
            capability_id: "symbol.references".into(),
            description: "High-precision LSP semantic symbol references".into(),
            effect: CapabilityEffect::ReadOnly,
            cost: CapabilityCost::Low,
            confidence: 0.99,
            requires_indexed_workspace: true,
        });
        self.register_provider(CapabilityProvider {
            provider_id: "ripgrep.fallback".into(),
            capability_id: "symbol.references".into(),
            description: "Fast lexical text search fallback".into(),
            effect: CapabilityEffect::ReadOnly,
            cost: CapabilityCost::Low,
            confidence: 0.70,
            requires_indexed_workspace: false,
        });

        // code.modify
        self.register_provider(CapabilityProvider {
            provider_id: "search_replace".into(),
            capability_id: "code.modify".into(),
            description: "Direct targeted search and replace".into(),
            effect: CapabilityEffect::ScopedWrite,
            cost: CapabilityCost::Low,
            confidence: 0.95,
            requires_indexed_workspace: false,
        });
        self.register_provider(CapabilityProvider {
            provider_id: "ast_rewrite".into(),
            capability_id: "code.modify".into(),
            description: "Semantic AST structural replacement".into(),
            effect: CapabilityEffect::ScopedWrite,
            cost: CapabilityCost::Medium,
            confidence: 0.98,
            requires_indexed_workspace: true,
        });

        // test.run
        self.register_provider(CapabilityProvider {
            provider_id: "cargo_test".into(),
            capability_id: "test.run".into(),
            description: "Native cargo test runner".into(),
            effect: CapabilityEffect::ReadOnly,
            cost: CapabilityCost::Medium,
            confidence: 1.0,
            requires_indexed_workspace: false,
        });
    }
}
