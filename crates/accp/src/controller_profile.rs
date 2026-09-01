//! ACCP 3.0 Controller Conformance Profile (normative)
//!
//! Derives from ACCP_3_0_SPEC.md + ACCP_V3_CONTROLLER_PROFILE.md
//! This module is the single source of truth for what a Cognitive
//! Controller MAY emit. The reference system prompt is compiled from
//! these constants — hand-authored prompts shall not diverge.

use crate::{ActorRole, MessageFamily};

pub const PROFILE_VERSION: &str = "3.0.0";
pub const ACCP_VERSION: &str = crate::ACCP_VERSION;

/// Allowed (family, kind) pairs for COGNITIVE_CONTROLLER
pub const ALLOWED_CONTROLLER_MESSAGES: &[(MessageFamily, &str)] = &[
    (MessageFamily::Query, "STATE"),
    (MessageFamily::Query, "EVIDENCE"),
    (MessageFamily::Query, "ARTIFACT"),
    (MessageFamily::Query, "CAPABILITY"),
    (MessageFamily::Proposal, "CLAIM"),
    (MessageFamily::Proposal, "ACTION"),
    (MessageFamily::Proposal, "WORKSPACE_DELTA"),
    (MessageFamily::Proposal, "STATE_TRANSITION"),
    (MessageFamily::Proposal, "VERIFICATION"),
    (MessageFamily::Proposal, "COMPLETION"),
];

/// Forbidden families/kinds that controller SHALL NOT emit (Harness-only)
pub const FORBIDDEN_CONTROLLER_FAMILIES: &[MessageFamily] = &[
    MessageFamily::View,
    MessageFamily::Decision,
    MessageFamily::Receipt,
    MessageFamily::Signal,
];

/// Forbidden receipt/decision kinds even if family were spoofed
pub const FORBIDDEN_CONTROLLER_KINDS: &[&str] = &[
    "EXECUTION",
    "OBSERVATION",
    "EVIDENCE",
    "VERIFICATION",
    "STATE_TRANSITION",
    "ACTION_DECISION",
    "COMPLETION_DECISION",
];

pub fn is_allowed_controller_message(family: MessageFamily, kind: &str) -> bool {
    ALLOWED_CONTROLLER_MESSAGES
        .iter()
        .any(|(f, k)| *f == family && *k == kind)
}

pub fn is_forbidden_controller_message(family: MessageFamily, kind: &str) -> bool {
    if FORBIDDEN_CONTROLLER_FAMILIES.contains(&family) {
        return true;
    }
    family == MessageFamily::Receipt && FORBIDDEN_CONTROLLER_KINDS.contains(&kind)
}

pub struct ControllerEnvelopeSpec {
    pub accp_version: &'static str,
    pub sender: ActorRole,
    pub family: &'static str,
    pub kind: &'static str,
    pub revision_field: &'static str,
    pub scope_field: &'static str,
}

pub const CANONICAL_ENVELOPE: ControllerEnvelopeSpec = ControllerEnvelopeSpec {
    accp_version: ACCP_VERSION,
    sender: ActorRole::CognitiveController,
    family: "PROPOSAL|QUERY",
    kind: "see ALLOWED_CONTROLLER_MESSAGES",
    revision_field: "revision: u64 == view.hard_revision",
    scope_field: "scope: {repository, revision, path_pattern?} ⊆ permitted_scope",
};

/// Compile the non-normative Reference System Prompt from the normative profile.
/// Monograph principle: system prompt = role + boundary, not runtime constitution.
/// Law is enforced in Rust types / ACCP gate / Harness / Noesis / Praxis — not in the prompt.
/// If removing a prompt rule can violate authority/epistemic/completion correctness,
/// that rule is implemented at the wrong layer.
pub fn compile_reference_prompt() -> String {
    let mut s = String::new();
    s.push_str("You are Rivet, an expert software engineering AI pair-programmer.\n");
    s.push_str("You propose; Harness owns authoritative reality (execution, observation, verification, persistence, completion).\n\n");
    s.push_str("Tone & Rules:\n");
    s.push_str("1. Language Match: Reply 100% in user's language (Türkçe ise Türkçe konuş).\n");
    s.push_str("2. Natural Markdown: Answer audits/questions in Markdown. Do not dump internal IDs (oblg_..., rN).\n");
    s.push_str("3. AccpEnvelope: For actions, emit typed AccpEnvelope JSON in ```accp block:\n");
    s.push_str(r#"{"accp_version":"3.0","sender":"COGNITIVE_CONTROLLER","family":"PROPOSAL|QUERY","kind":"<allowed>","revision":<view.hard_revision>,"scope":{...},"payload":{...}}"#);
    s.push_str("\n\n");
    s.push_str("Allowed: QUERY/STATE,EVIDENCE,ARTIFACT,CAPABILITY; PROPOSAL/CLAIM,ACTION,WORKSPACE_DELTA,STATE_TRANSITION,VERIFICATION,COMPLETION.\n");
    s.push_str("Forbidden: VIEW/*, DECISION/*, RECEIPT/*, SIGNAL/* — never emit receipts.\n");
    s.push_str("Rules: Use revision == view.hard_revision. Cite only evidence_id from recent_evidence. Retrieved view state is context, not new evidence.\n");
    s.push_str("Payload shapes: ACTION{capability,target,parameters,intent}, WORKSPACE_DELTA{add[],remove[]}, VERIFICATION{obligation_id,predicate,target_scope}, CLAIM{proposition}, COMPLETION{summary}.\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_coherence() {
        assert!(is_allowed_controller_message(
            MessageFamily::Proposal,
            "ACTION"
        ));
        assert!(!is_allowed_controller_message(
            MessageFamily::Receipt,
            "EXECUTION"
        ));
        assert!(is_forbidden_controller_message(
            MessageFamily::Receipt,
            "EXECUTION"
        ));
        assert!(is_forbidden_controller_message(
            MessageFamily::View,
            "COGNITIVE"
        ));
        let prompt = compile_reference_prompt();
        assert!(prompt.contains("You propose; Harness owns authoritative reality"));
        assert!(prompt.contains("AccpEnvelope"));
        assert!(prompt.contains("Retrieved view state is context, not new evidence"));
        // short contract: ~150-300 tokens, not encyclopedia
        assert!(prompt.len() < 1200);
        assert!(!prompt.contains("WRONG: predicate"));
    }
}
