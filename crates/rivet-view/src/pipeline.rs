//! # rivet-view::pipeline
//!
//! Multi-stage compilation pipeline:
//! 1. Deterministic Eligibility Filtering
//! 2. Provenance Path Expansion
//! 3. Relevance Ranking
//! 4. Semantic Compression & Token Budgeting
//! 5. Contradiction & Rejected Beliefs Inclusion
//! 6. Model Serialization (RAW_TEXT, TRIPLES, PATHS, HYBRID)

use crate::modes::{KnowledgeTriple, ProvenancePath, RepresentationMode};
use noesis::{ClaimRecord, ContradictionRecord, HardState, RejectionRecord, SoftWorkspace};
use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Summary of elements omitted during semantic compression
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct OmittedSummary {
    pub deferred_trees: usize,
    pub token_budget: u32,
    pub omitted_claims_count: usize,
    pub omitted_evidence_count: usize,
    pub omitted_signals_count: usize,
}

/// Input context for cognitive view compilation
#[derive(Debug, Clone)]
pub struct CompilationContext<'a> {
    pub hard_state: &'a HardState,
    pub soft_workspace: &'a SoftWorkspace,
    pub goal_description: &'a str,
    pub repository_id: &'a str,
    pub relevant_files: &'a [String],
    pub repository_signals: &'a [String],
    pub token_budget: u32,
    pub mode: RepresentationMode,
    pub deferred_trees_count: usize,
}

/// Intermediate compiled projection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledViewPayload {
    pub hard_revision: Revision,
    pub workspace_revision: Revision,
    pub repository_id: String,
    pub goal_description: String,
    pub active_focus: Vec<String>,
    pub hypotheses: Vec<String>,
    pub unknowns: Vec<String>,
    pub candidate_actions: Vec<String>,
    pub active_claims: Vec<ClaimRecord>,
    pub contradictions: Vec<ContradictionRecord>,
    pub rejected_claims: Vec<RejectionRecord>,
    pub open_obligations: Vec<(ObligationId, String, Scope)>,
    pub recent_evidence: Vec<(EvidenceId, String, String)>,
    pub relevant_files: Vec<String>,
    pub repository_signals: Vec<String>,
    pub omitted_summary: OmittedSummary,
    pub triples: Vec<KnowledgeTriple>,
    pub provenance_paths: Vec<ProvenancePath>,
    pub mode: RepresentationMode,
}

type EligibleItems = (
    Vec<ClaimRecord>,
    Vec<(ObligationId, String, Scope)>,
    Vec<(EvidenceId, String, String)>,
);

type CompressedState = (
    Vec<ClaimRecord>,
    Vec<(EvidenceId, String, String)>,
    Vec<String>,
    OmittedSummary,
);

pub struct CognitiveViewCompiler;

impl CognitiveViewCompiler {
    /// Execute the full 6-stage cognitive view compilation pipeline
    pub fn compile(ctx: &CompilationContext<'_>) -> CompiledViewPayload {
        // Stage 1: Deterministic Eligibility Filtering
        let (eligible_claims, eligible_obligations, eligible_evidence) =
            Self::stage_eligibility_filter(ctx);

        // Stage 2: Provenance Path Expansion
        let (triples, provenance_paths) = Self::stage_provenance_expansion(
            ctx,
            &eligible_claims,
            &eligible_obligations,
            &eligible_evidence,
        );

        // Stage 3 & 4: Relevance Ranking & Semantic Compression
        let (compressed_claims, compressed_evidence, compressed_signals, omitted) =
            Self::stage_relevance_and_compression(
                ctx,
                eligible_claims,
                eligible_evidence,
                ctx.repository_signals,
            );

        // Stage 5: Contradiction and Rejected Beliefs Inclusion
        let (contradictions, rejected_claims) = Self::stage_contradiction_inclusion(ctx);

        // Stage 6: Assemble compiled payload ready for serialization
        CompiledViewPayload {
            hard_revision: ctx.hard_state.revision,
            workspace_revision: ctx.soft_workspace.base_hard_revision,
            repository_id: ctx.repository_id.to_string(),
            goal_description: ctx.goal_description.to_string(),
            active_focus: ctx.soft_workspace.active_focus.clone(),
            hypotheses: ctx.soft_workspace.hypotheses.clone(),
            unknowns: ctx.soft_workspace.unknowns.clone(),
            candidate_actions: ctx.soft_workspace.candidate_actions.clone(),
            active_claims: compressed_claims,
            contradictions,
            rejected_claims,
            open_obligations: eligible_obligations,
            recent_evidence: compressed_evidence,
            relevant_files: ctx.relevant_files.to_vec(),
            repository_signals: compressed_signals,
            omitted_summary: omitted,
            triples,
            provenance_paths,
            mode: ctx.mode,
        }
    }

    /// Stage 1: Filter out superseded / expired / invalid entries
    fn stage_eligibility_filter(ctx: &CompilationContext<'_>) -> EligibleItems {
        // Filter claims: only active supported/verified/hypothetical claims (exclude superseded)
        let mut claims: Vec<ClaimRecord> = ctx
            .hard_state
            .claims
            .values()
            .filter(|c| {
                c.status != EpistemicStatus::Superseded && c.status != EpistemicStatus::Rejected
            })
            .cloned()
            .collect();
        claims.sort_by(|a, b| a.id.cmp(&b.id));

        // Filter obligations: open obligations only
        let mut obligations: Vec<(ObligationId, String, Scope)> = ctx
            .hard_state
            .obligations
            .iter()
            .map(|(id, desc)| {
                let scope = ctx
                    .hard_state
                    .obligation_scopes
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| Scope::global(ctx.repository_id, ctx.hard_state.revision));
                (id.clone(), desc.clone(), scope)
            })
            .collect();
        obligations.sort_by(|a, b| a.0.cmp(&b.0));

        // Filter recent evidence (up to 20 most recent)
        let mut evidence: Vec<(EvidenceId, String, String)> = ctx
            .hard_state
            .evidence
            .iter()
            .map(|(id, summary)| (id.clone(), "observation".to_string(), summary.clone()))
            .collect();
        evidence.sort_by(|a, b| b.0.cmp(&a.0)); // descending order

        (claims, obligations, evidence)
    }

    /// Stage 2: Trace provenance paths and knowledge triples
    fn stage_provenance_expansion(
        ctx: &CompilationContext<'_>,
        claims: &[ClaimRecord],
        obligations: &[(ObligationId, String, Scope)],
        evidence: &[(EvidenceId, String, String)],
    ) -> (Vec<KnowledgeTriple>, Vec<ProvenancePath>) {
        let mut triples = Vec::new();
        let mut paths = Vec::new();

        // Triples for Goal -> Obligations
        for (ob_id, desc, scope) in obligations {
            triples.push(KnowledgeTriple::new(
                format!("Goal#{}", ctx.repository_id),
                "requires_obligation",
                format!("Obligation#{}", ob_id),
            ));
            triples.push(KnowledgeTriple::new(
                format!("Obligation#{}", ob_id),
                "has_scope",
                format!("Scope({}@{})", scope.repository, scope.revision),
            ));
            triples.push(KnowledgeTriple::new(
                format!("Obligation#{}", ob_id),
                "description",
                desc.clone(),
            ));

            paths.push(ProvenancePath::new(vec![
                format!("Goal({})", ctx.goal_description),
                format!("Obligation({}: {})", ob_id, desc),
                format!("Scope({}@{})", scope.repository, scope.revision),
            ]));
        }

        // Triples for Claims -> Supporting Evidence
        let evidence_map: HashMap<EvidenceId, (String, String)> = evidence
            .iter()
            .map(|(id, src, sum)| (id.clone(), (src.clone(), sum.clone())))
            .collect();

        for claim in claims {
            triples.push(KnowledgeTriple::new(
                format!("Claim#{}", claim.id),
                "epistemic_status",
                claim.status.to_string(),
            ));
            triples.push(KnowledgeTriple::new(
                format!("Claim#{}", claim.id),
                "proposition",
                claim.proposition.clone(),
            ));

            for evid_id in &claim.supporting_evidence {
                triples.push(KnowledgeTriple::new(
                    format!("Claim#{}", claim.id),
                    "supported_by",
                    format!("Evidence#{}", evid_id),
                ));

                if let Some((src, summary)) = evidence_map.get(evid_id) {
                    paths.push(ProvenancePath::new(vec![
                        format!("Claim({}: {})", claim.id, claim.proposition),
                        format!("Status({})", claim.status),
                        format!("Evidence({}: {})", evid_id, summary),
                        format!("Source({})", src),
                    ]));
                }
            }
        }

        // Triples for Contradictions
        for (claim_id, c_rec) in &ctx.hard_state.contradictions {
            triples.push(KnowledgeTriple::new(
                format!("Claim#{}", claim_id),
                "contradicted_by",
                format!("{:?}", c_rec.contradicted_by),
            ));
            triples.push(KnowledgeTriple::new(
                format!("Claim#{}", claim_id),
                "contradiction_reason",
                c_rec.reason.clone(),
            ));
        }

        (triples, paths)
    }

    /// Stage 3 & 4: Relevance Ranking & Semantic Compression
    fn stage_relevance_and_compression(
        ctx: &CompilationContext<'_>,
        mut claims: Vec<ClaimRecord>,
        mut evidence: Vec<(EvidenceId, String, String)>,
        signals: &[String],
    ) -> CompressedState {
        let goal_lower = ctx.goal_description.to_lowercase();
        let focus_lower: Vec<String> = ctx
            .soft_workspace
            .active_focus
            .iter()
            .map(|f| f.to_lowercase())
            .collect();

        // Score claims
        claims.sort_by_cached_key(|c| {
            let mut score: i32 = 0;
            let prop = c.proposition.to_lowercase();
            if focus_lower.iter().any(|f| prop.contains(f)) {
                score += 50;
            }
            if goal_lower
                .split_whitespace()
                .any(|w| w.len() > 3 && prop.contains(w))
            {
                score += 30;
            }
            if c.status == EpistemicStatus::Verified {
                score += 20;
            }
            -score // descending
        });

        // Bounded selection based on budget
        let max_claims = ((ctx.token_budget / 200).clamp(5, 30)) as usize;
        let total_claims = claims.len();
        claims.truncate(max_claims);
        let omitted_claims = total_claims.saturating_sub(claims.len());

        let max_evidence = ((ctx.token_budget / 300).clamp(3, 15)) as usize;
        let total_evidence = evidence.len();
        evidence.truncate(max_evidence);
        let omitted_evidence = total_evidence.saturating_sub(evidence.len());

        let max_signals = 10;
        let mut bounded_signals = signals.to_vec();
        let total_signals = bounded_signals.len();
        bounded_signals.truncate(max_signals);
        let omitted_signals = total_signals.saturating_sub(bounded_signals.len());

        let omitted = OmittedSummary {
            deferred_trees: ctx.deferred_trees_count,
            token_budget: ctx.token_budget,
            omitted_claims_count: omitted_claims,
            omitted_evidence_count: omitted_evidence,
            omitted_signals_count: omitted_signals,
        };

        (claims, evidence, bounded_signals, omitted)
    }

    /// Stage 5: Contradiction and Rejection extraction
    fn stage_contradiction_inclusion(
        ctx: &CompilationContext<'_>,
    ) -> (Vec<ContradictionRecord>, Vec<RejectionRecord>) {
        let mut contradictions: Vec<ContradictionRecord> =
            ctx.hard_state.contradictions.values().cloned().collect();
        contradictions.sort_by(|a, b| a.claim_id.cmp(&b.claim_id));

        let mut rejections: Vec<RejectionRecord> =
            ctx.hard_state.rejected_claims.values().cloned().collect();
        rejections.sort_by(|a, b| a.claim_id.cmp(&b.claim_id));

        (contradictions, rejections)
    }
}

impl CompiledViewPayload {
    /// Render formatted string according to the configured RepresentationMode
    pub fn render(&self) -> String {
        match self.mode {
            RepresentationMode::RawText => self.render_raw_text(),
            RepresentationMode::Triples => self.render_triples(),
            RepresentationMode::Paths => self.render_paths(),
            RepresentationMode::Hybrid => self.render_hybrid(),
        }
    }

    fn render_raw_text(&self) -> String {
        let mut out = String::new();
        out.push_str("=== COGNITIVE STATE (RAW TEXT) ===\n");
        out.push_str(&format!(
            "Repository: {} | Revision: {}\n",
            self.repository_id, self.hard_revision
        ));
        out.push_str(&format!("Goal: {}\n\n", self.goal_description));

        if !self.active_focus.is_empty() {
            out.push_str(&format!("Active Focus: {}\n", self.active_focus.join(", ")));
        }
        if !self.hypotheses.is_empty() {
            out.push_str(&format!("Hypotheses: {}\n", self.hypotheses.join("; ")));
        }
        if !self.unknowns.is_empty() {
            out.push_str(&format!("Unknowns: {}\n", self.unknowns.join("; ")));
        }

        out.push_str("\n--- Active Claims ---\n");
        for c in &self.active_claims {
            out.push_str(&format!(
                "- [{}] {}: {} (support: {:?})\n",
                c.id, c.status, c.proposition, c.supporting_evidence
            ));
        }

        if !self.contradictions.is_empty() {
            out.push_str("\n--- Contradictions ---\n");
            for c in &self.contradictions {
                out.push_str(&format!(
                    "- Contradiction on [{}]: {} (contradicted by: {:?})\n",
                    c.claim_id, c.reason, c.contradicted_by
                ));
            }
        }

        if !self.rejected_claims.is_empty() {
            out.push_str("\n--- Rejected Beliefs ---\n");
            for r in &self.rejected_claims {
                out.push_str(&format!(
                    "- Rejected [{}]: {} (evidence: {:?})\n",
                    r.claim_id, r.reason, r.evidence
                ));
            }
        }

        out.push_str("\n--- Open Obligations ---\n");
        for (id, desc, scope) in &self.open_obligations {
            out.push_str(&format!(
                "- [{}] {} (scope: {}@{})\n",
                id, desc, scope.repository, scope.revision
            ));
        }

        if !self.recent_evidence.is_empty() {
            out.push_str("\n--- Recent Evidence ---\n");
            for (id, src, sum) in &self.recent_evidence {
                out.push_str(&format!("- [{}] {}: {}\n", id, src, sum));
            }
        }

        if !self.relevant_files.is_empty() {
            out.push_str(&format!(
                "\nRelevant Files: {}\n",
                self.relevant_files.join(", ")
            ));
        }

        out.push_str(&format!(
            "\nOmitted Summary: {} deferred trees, token budget: {}\n",
            self.omitted_summary.deferred_trees, self.omitted_summary.token_budget
        ));

        out
    }

    fn render_triples(&self) -> String {
        let mut out = String::new();
        out.push_str("# COGNITIVE VIEW (TRIPLES MODE - KNOWLEDGE GRAPH)\n");
        out.push_str(&format!(
            "# Revision: {} | Repo: {}\n\n",
            self.hard_revision, self.repository_id
        ));

        for triple in &self.triples {
            out.push_str(&triple.to_spo_string());
            out.push('\n');
        }

        out.push_str(&format!(
            "\n# (Meta#Omitted, deferred_trees, {})\n",
            self.omitted_summary.deferred_trees
        ));
        out.push_str(&format!(
            "# (Meta#Omitted, token_budget, {})\n",
            self.omitted_summary.token_budget
        ));
        out
    }

    fn render_paths(&self) -> String {
        let mut out = String::new();
        out.push_str("# COGNITIVE VIEW (PATHS MODE - PROVENANCE GRAPH)\n");
        out.push_str(&format!(
            "# Revision: {} | Repo: {}\n\n",
            self.hard_revision, self.repository_id
        ));

        for path in &self.provenance_paths {
            out.push_str(&path.to_path_string());
            out.push('\n');
        }

        out.push_str(&format!(
            "\n[OmittedSummary: deferred_trees={}, token_budget={}]\n",
            self.omitted_summary.deferred_trees, self.omitted_summary.token_budget
        ));
        out
    }

    fn render_hybrid(&self) -> String {
        let mut out = String::new();
        out.push_str("```yaml\n");
        out.push_str("cognitive_view:\n");
        out.push_str(&format!("  hard_revision: {}\n", self.hard_revision.0));
        out.push_str(&format!(
            "  workspace_revision: {}\n",
            self.workspace_revision.0
        ));
        out.push_str(&format!("  repository_id: \"{}\"\n", self.repository_id));
        out.push_str(&format!(
            "  goal: \"{}\"\n",
            escape_yaml_string(&self.goal_description)
        ));

        if !self.active_focus.is_empty() {
            out.push_str("  active_focus:\n");
            for f in &self.active_focus {
                out.push_str(&format!("    - \"{}\"\n", escape_yaml_string(f)));
            }
        }

        if !self.hypotheses.is_empty() {
            out.push_str("  active_hypotheses:\n");
            for h in &self.hypotheses {
                out.push_str(&format!("    - \"{}\"\n", escape_yaml_string(h)));
            }
        }

        if !self.unknowns.is_empty() {
            out.push_str("  unknowns:\n");
            for u in &self.unknowns {
                out.push_str(&format!("    - \"{}\"\n", escape_yaml_string(u)));
            }
        }

        if !self.candidate_actions.is_empty() {
            out.push_str("  candidate_actions:\n");
            for a in &self.candidate_actions {
                out.push_str(&format!("    - \"{}\"\n", escape_yaml_string(a)));
            }
        }

        if !self.active_claims.is_empty() {
            out.push_str("  durable_claims:\n");
            for c in &self.active_claims {
                out.push_str(&format!("    - id: \"{}\"\n", c.id));
                out.push_str(&format!("      status: \"{}\"\n", c.status));
                out.push_str(&format!(
                    "      proposition: \"{}\"\n",
                    escape_yaml_string(&c.proposition)
                ));
                out.push_str(&format!(
                    "      evidence_refs: {:?}\n",
                    c.supporting_evidence
                        .iter()
                        .map(|e| e.to_string())
                        .collect::<Vec<_>>()
                ));
            }
        }

        if !self.contradictions.is_empty() {
            out.push_str("  contradictions:\n");
            for c in &self.contradictions {
                out.push_str(&format!("    - claim_id: \"{}\"\n", c.claim_id));
                out.push_str(&format!(
                    "      reason: \"{}\"\n",
                    escape_yaml_string(&c.reason)
                ));
                out.push_str(&format!(
                    "      contradicted_by: {:?}\n",
                    c.contradicted_by
                        .iter()
                        .map(|e| e.to_string())
                        .collect::<Vec<_>>()
                ));
            }
        }

        if !self.rejected_claims.is_empty() {
            out.push_str("  rejected_paths:\n");
            for r in &self.rejected_claims {
                out.push_str(&format!("    - claim_id: \"{}\"\n", r.claim_id));
                out.push_str(&format!(
                    "      reason: \"{}\"\n",
                    escape_yaml_string(&r.reason)
                ));
                out.push_str(&format!(
                    "      evidence: {:?}\n",
                    r.evidence.iter().map(|e| e.to_string()).collect::<Vec<_>>()
                ));
            }
        }

        if !self.open_obligations.is_empty() {
            out.push_str("  open_obligations:\n");
            for (id, desc, scope) in &self.open_obligations {
                out.push_str(&format!("    - id: \"{}\"\n", id));
                out.push_str(&format!(
                    "      description: \"{}\"\n",
                    escape_yaml_string(desc)
                ));
                out.push_str(&format!(
                    "      scope: \"{}@{}\"\n",
                    scope.repository, scope.revision
                ));
            }
        }

        if !self.recent_evidence.is_empty() {
            out.push_str("  recent_evidence:\n");
            for (id, src, sum) in &self.recent_evidence {
                out.push_str(&format!("    - id: \"{}\"\n", id));
                out.push_str(&format!("      source: \"{}\"\n", escape_yaml_string(src)));
                out.push_str(&format!("      summary: \"{}\"\n", escape_yaml_string(sum)));
            }
        }

        if !self.relevant_files.is_empty() {
            out.push_str("  repo_frontier:\n");
            for f in &self.relevant_files {
                out.push_str(&format!("    - \"{}\"\n", escape_yaml_string(f)));
            }
        }

        if !self.repository_signals.is_empty() {
            out.push_str("  repository_signals:\n");
            for s in &self.repository_signals {
                out.push_str(&format!("    - \"{}\"\n", escape_yaml_string(s)));
            }
        }

        out.push_str("  omitted_summary:\n");
        out.push_str(&format!(
            "    deferred_trees: {}\n",
            self.omitted_summary.deferred_trees
        ));
        out.push_str(&format!(
            "    token_budget: {}\n",
            self.omitted_summary.token_budget
        ));
        out.push_str(&format!(
            "    omitted_claims: {}\n",
            self.omitted_summary.omitted_claims_count
        ));
        out.push_str(&format!(
            "    omitted_evidence: {}\n",
            self.omitted_summary.omitted_evidence_count
        ));

        out.push_str("```\n");
        out
    }
}

pub struct TokenCounter;

impl TokenCounter {
    /// Count exact BPE tokens using cl100k_base tokenizer (GPT-4 / modern standard)
    pub fn count_tokens(text: &str) -> usize {
        if let Ok(bpe) = tiktoken_rs::cl100k_base() {
            bpe.encode_ordinary(text).len()
        } else {
            text.len().div_ceil(4)
        }
    }
}

fn escape_yaml_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
}
