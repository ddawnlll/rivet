//! # accp (ACCP 3.0 Protocol Implementation)
//!
//! Strict semantic protocol defining legal commitments, authority boundaries,
//! and event transitions between Cognitive Controller and Authoritative Harness.

use chrono::{DateTime, Utc};
use rivet_types::*;
use serde::{Deserialize, Serialize};

pub const ACCP_VERSION: &str = "3.0";

/// ACCP protocol role. Only the Harness may authoritatively emit decisions,
/// receipts and signals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActorRole {
    CognitiveController,
    Harness,
}

/// ACCP 3.0 core message families and their directionality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MessageFamily {
    View,
    Query,
    Proposal,
    Decision,
    Receipt,
    Signal,
}

/// Action risk level defined by ACCP 3.0
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionRisk {
    /// Read-only / inspection (zero side effects)
    Inspect,
    /// Targeted modification with git checkpoint / easily reversible
    Material,
    /// Irreversible / global mutation (e.g. hard reset, force push, drop db)
    Destructive,
}

/// Action decision verdict emitted by Harness
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionDecisionVerdict {
    Allow,
    Block,
    RequireHumanApproval,
}

/// 1. Action Proposal emitted by Cognitive Controller
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionProposal {
    pub action_id: ActionId,
    pub capability: String,
    pub target: String,
    pub parameters: serde_json::Value,
    pub estimated_risk: ActionRisk,
    pub intent: String,
    pub scope: Scope,
    /// Retries with the same identity must not repeat an authoritative side effect.
    #[serde(default)]
    pub idempotency_key: Option<String>,
    pub timestamp: DateTime<Utc>,
}

impl ActionProposal {
    pub fn idempotency_identity(&self) -> String {
        self.idempotency_key
            .clone()
            .unwrap_or_else(|| self.action_id.to_string())
    }
}

/// 2. Action Decision emitted by Authoritative Harness
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionDecision {
    pub action_id: ActionId,
    pub verdict: ActionDecisionVerdict,
    pub reason: String,
    pub authorized_scope: Scope,
    pub timestamp: DateTime<Utc>,
}

/// 3. Execution Receipt issued after authoritative runtime execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionReceipt {
    pub receipt_id: ReceiptId,
    pub action_id: ActionId,
    pub capability: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub output_summary: String,
    /// Structured observation produced by the Harness/runtime. Model prose is
    /// never copied into this field as an authoritative receipt.
    #[serde(default)]
    pub observations: serde_json::Value,
    pub evidence_id: EvidenceId,
    pub execution_duration_ms: u64,
    pub timestamp: DateTime<Utc>,
}

/// 4. Claim Proposal emitted by Cognitive Controller
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimProposal {
    pub claim_id: ClaimId,
    pub proposition: String,
    pub proposed_status: EpistemicStatus,
    pub supporting_evidence: Vec<EvidenceId>,
    pub scope: Scope,
    pub timestamp: DateTime<Utc>,
}

/// 5. Verification Request emitted to Praxis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationRequest {
    pub obligation_id: ObligationId,
    pub predicate: String,
    pub target_scope: Scope,
    pub timeout_seconds: u32,
    pub timestamp: DateTime<Utc>,
}

/// 6. Verification Receipt issued by Praxis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationReceipt {
    pub receipt_id: ReceiptId,
    pub obligation_id: ObligationId,
    pub passed: bool,
    pub evidence_id: EvidenceId,
    pub verified_scope: Scope,
    pub diagnostics: Option<String>,
    pub timestamp: DateTime<Utc>,
}

/// 7. State Transition Proposal emitted by Controller
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateTransitionProposal {
    pub base_revision: Revision,
    pub claims_to_assert: Vec<ClaimProposal>,
    pub claims_to_reject: Vec<ClaimId>,
    pub obligations_to_create: Vec<String>,
    pub timestamp: DateTime<Utc>,
}

/// 8. Completion Proposal emitted by Controller
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionProposal {
    pub task_id: TaskId,
    pub summary: String,
    pub claims_addressed: Vec<ClaimId>,
    #[serde(default)]
    pub base_revision: Revision,
    pub timestamp: DateTime<Utc>,
}

/// 9. Completion Decision issued by Harness (Praxis gate enforced)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionDecision {
    pub task_id: TaskId,
    pub completed: bool,
    pub required_obligations_satisfied: bool,
    pub unclosed_obligations: Vec<ObligationId>,
    pub final_receipt: Option<ReceiptId>,
    pub timestamp: DateTime<Utc>,
}

/// All 9 Normative ACCP 3.0 Message Classes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "class", content = "payload", rename_all = "snake_case")]
pub enum AccpMessage {
    ActionProposal(ActionProposal),
    ActionDecision(ActionDecision),
    ExecutionReceipt(ExecutionReceipt),
    ClaimProposal(ClaimProposal),
    VerificationRequest(VerificationRequest),
    VerificationReceipt(VerificationReceipt),
    StateTransitionProposal(StateTransitionProposal),
    CompletionProposal(CompletionProposal),
    CompletionDecision(CompletionDecision),
}

impl AccpMessage {
    /// Return the normative family/kind pair without relying on provider text.
    pub fn family_kind(&self) -> (MessageFamily, &'static str) {
        match self {
            Self::ActionProposal(_) => (MessageFamily::Proposal, "ACTION"),
            Self::ActionDecision(_) => (MessageFamily::Decision, "ACTION"),
            Self::ExecutionReceipt(_) => (MessageFamily::Receipt, "EXECUTION"),
            Self::ClaimProposal(_) => (MessageFamily::Proposal, "CLAIM"),
            Self::VerificationRequest(_) => (MessageFamily::Proposal, "VERIFICATION"),
            Self::VerificationReceipt(_) => (MessageFamily::Receipt, "VERIFICATION"),
            Self::StateTransitionProposal(_) => (MessageFamily::Proposal, "STATE_TRANSITION"),
            Self::CompletionProposal(_) => (MessageFamily::Proposal, "COMPLETION"),
            Self::CompletionDecision(_) => (MessageFamily::Decision, "COMPLETION"),
        }
    }
}

/// Canonical JSON interchange envelope. Internal Rust calls may remain typed,
/// but crossing the controller/harness boundary always carries this metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccpEnvelope {
    pub accp_version: String,
    pub message_id: String,
    pub sender: ActorRole,
    pub family: MessageFamily,
    pub kind: String,
    pub payload: serde_json::Value,
    #[serde(default)]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub scope: Option<Scope>,
    #[serde(default)]
    pub revision: Option<Revision>,
}

impl AccpEnvelope {
    pub fn from_message(
        message_id: impl Into<String>,
        sender: ActorRole,
        message: &AccpMessage,
    ) -> RivetResult<Self> {
        let (family, kind) = message.family_kind();
        let payload = serde_json::to_value(message)
            .map_err(|error| RivetError::Serialization(error.to_string()))?;
        Ok(Self {
            accp_version: ACCP_VERSION.into(),
            message_id: message_id.into(),
            sender,
            family,
            kind: kind.into(),
            payload,
            correlation_id: None,
            scope: None,
            revision: None,
        })
    }

    /// Enforce the producer matrix in ACCP 3.0.
    pub fn validate_direction(&self) -> RivetResult<()> {
        if self.accp_version != ACCP_VERSION {
            return Err(RivetError::SemanticViolation(format!(
                "Unsupported ACCP version '{}', expected {}",
                self.accp_version, ACCP_VERSION
            )));
        }
        if self.message_id.trim().is_empty() || self.kind.trim().is_empty() {
            return Err(RivetError::SemanticViolation(
                "ACCP envelope requires message_id and kind".into(),
            ));
        }
        if !self.payload.is_object() {
            return Err(RivetError::SemanticViolation(
                "ACCP envelope payload must be a JSON object".into(),
            ));
        }
        if !kind_is_valid_for_family(self.family, &self.kind) {
            return Err(RivetError::SemanticViolation(format!(
                "ACCP kind '{}' is not valid for family {:?}",
                self.kind, self.family
            )));
        }

        let controller_allowed =
            matches!(self.family, MessageFamily::Query | MessageFamily::Proposal);
        let harness_allowed = matches!(
            self.family,
            MessageFamily::View
                | MessageFamily::Decision
                | MessageFamily::Receipt
                | MessageFamily::Signal
        );
        let allowed = match self.sender {
            ActorRole::CognitiveController => controller_allowed,
            ActorRole::Harness => harness_allowed,
        };
        if !allowed {
            return Err(RivetError::SemanticViolation(format!(
                "{} cannot emit {} message",
                match self.sender {
                    ActorRole::CognitiveController => "COGNITIVE_CONTROLLER",
                    ActorRole::Harness => "HARNESS",
                },
                match self.family {
                    MessageFamily::View => "VIEW",
                    MessageFamily::Query => "QUERY",
                    MessageFamily::Proposal => "PROPOSAL",
                    MessageFamily::Decision => "DECISION",
                    MessageFamily::Receipt => "RECEIPT",
                    MessageFamily::Signal => "SIGNAL",
                }
            )));
        }
        Ok(())
    }
}

fn kind_is_valid_for_family(family: MessageFamily, kind: &str) -> bool {
    let core_kinds: &[&str] = match family {
        MessageFamily::View => &["COGNITIVE", "STATE", "CAPABILITY", "CONSTRAINT"],
        MessageFamily::Query => &["STATE", "EVIDENCE", "ARTIFACT", "CAPABILITY"],
        MessageFamily::Proposal => &[
            "CLAIM",
            "ACTION",
            "WORKSPACE_DELTA",
            "STATE_TRANSITION",
            "VERIFICATION",
            "COMPLETION",
        ],
        MessageFamily::Decision => &["ACTION", "STATE_TRANSITION", "COMPLETION"],
        MessageFamily::Receipt => &[
            "EXECUTION",
            "OBSERVATION",
            "EVIDENCE",
            "VERIFICATION",
            "STATE_TRANSITION",
        ],
        MessageFamily::Signal => &["INVALIDATION", "CONTRADICTION", "REPLAN", "LIFECYCLE"],
    };
    core_kinds.contains(&kind) || kind.starts_with("EXT_")
}

/// Harness-owned action authorization policy. A model proposal cannot widen it.
#[derive(Debug, Clone)]
pub struct ActionAuthorizationPolicy {
    pub repository: String,
    pub current_revision: Revision,
    pub allowed_scope: Scope,
    pub allowed_capabilities: Vec<String>,
    pub allow_material: bool,
    pub human_approved: bool,
}

impl ActionAuthorizationPolicy {
    pub fn read_only(repository: impl Into<String>, revision: Revision, scope: Scope) -> Self {
        Self {
            repository: repository.into(),
            current_revision: revision,
            allowed_scope: scope,
            allowed_capabilities: vec!["file.read".into()],
            allow_material: false,
            human_approved: false,
        }
    }
}

/// Invariant Gate Enforcement
pub struct AccpSemanticGate;

impl AccpSemanticGate {
    /// Validate a message before it is interpreted by the Harness.
    pub fn validate_message(message: &AccpEnvelope) -> RivetResult<()> {
        message.validate_direction()
    }

    /// A controller may propose evidence-backed support, but it cannot mint a
    /// mechanically verified claim by setting a status field.
    pub fn validate_claim_proposal(proposal: &ClaimProposal) -> RivetResult<()> {
        if proposal.proposition.trim().is_empty() {
            return Err(RivetError::SemanticViolation(
                "Claim proposal proposition must not be empty".into(),
            ));
        }
        if proposal.proposed_status == EpistemicStatus::Verified {
            return Err(RivetError::SemanticViolation(
                "Controller cannot mint VERIFIED claim status".into(),
            ));
        }
        Ok(())
    }

    /// Apply Harness-owned capability, scope, revision and risk policy.
    pub fn authorize_action(
        proposal: &ActionProposal,
        policy: &ActionAuthorizationPolicy,
    ) -> ActionDecision {
        let blocked = |verdict: ActionDecisionVerdict, reason: &str| ActionDecision {
            action_id: proposal.action_id.clone(),
            verdict,
            reason: reason.into(),
            authorized_scope: policy.allowed_scope.clone(),
            timestamp: Utc::now(),
        };

        if proposal.scope.revision != policy.current_revision {
            return blocked(
                ActionDecisionVerdict::Block,
                "Action proposal is stale for the current state revision",
            );
        }
        if proposal.scope.repository != policy.repository
            || !policy.allowed_scope.contains_scope(&proposal.scope)
            || !policy.allowed_scope.allows_path(
                &policy.repository,
                &proposal.target,
                policy.current_revision,
            )
        {
            return blocked(
                ActionDecisionVerdict::Block,
                "Action target or declared scope is outside Harness authority",
            );
        }
        if !policy
            .allowed_capabilities
            .iter()
            .any(|capability| capability == &proposal.capability)
        {
            return blocked(
                ActionDecisionVerdict::Block,
                "Requested capability is not exposed for this task",
            );
        }
        match proposal.estimated_risk {
            ActionRisk::Inspect => ActionDecision {
                action_id: proposal.action_id.clone(),
                verdict: ActionDecisionVerdict::Allow,
                reason: "Read-only capability allowed within declared scope".into(),
                authorized_scope: policy.allowed_scope.clone(),
                timestamp: Utc::now(),
            },
            ActionRisk::Material if policy.allow_material => ActionDecision {
                action_id: proposal.action_id.clone(),
                verdict: ActionDecisionVerdict::Allow,
                reason: "Material capability allowed within Harness policy".into(),
                authorized_scope: policy.allowed_scope.clone(),
                timestamp: Utc::now(),
            },
            ActionRisk::Destructive if !policy.human_approved => blocked(
                ActionDecisionVerdict::RequireHumanApproval,
                "Destructive action requires explicit human approval",
            ),
            _ => blocked(
                ActionDecisionVerdict::Block,
                "Action risk is not authorized",
            ),
        }
    }

    /// Invariant 6.2: Proposal is not execution
    pub fn ensure_execution_authorized(decision: &ActionDecision) -> RivetResult<()> {
        match decision.verdict {
            ActionDecisionVerdict::Allow => Ok(()),
            ActionDecisionVerdict::Block => Err(RivetError::AuthorityDenied(format!(
                "Action blocked by policy: {}",
                decision.reason
            ))),
            ActionDecisionVerdict::RequireHumanApproval => Err(RivetError::AuthorityDenied(
                "Action requires explicit human approval".into(),
            )),
        }
    }

    /// Invariant 6.12: Controller prose is not completion
    pub fn check_completion_authority(unclosed_obligations: &[ObligationId]) -> RivetResult<()> {
        if !unclosed_obligations.is_empty() {
            return Err(RivetError::SemanticViolation(format!(
                "Cannot complete task: {} obligations remain unverified",
                unclosed_obligations.len()
            )));
        }
        Ok(())
    }

    /// Completion is a Harness decision and requires at least one passing Praxis
    /// receipt in addition to closed obligations.
    pub fn evaluate_completion(
        proposal: &CompletionProposal,
        current_revision: Revision,
        unclosed_obligations: Vec<ObligationId>,
        passing_receipts: &[ReceiptId],
    ) -> CompletionDecision {
        let obligations_satisfied = unclosed_obligations.is_empty();
        let revision_matches = proposal.base_revision == current_revision;
        let completed = obligations_satisfied && revision_matches && !passing_receipts.is_empty();
        CompletionDecision {
            task_id: proposal.task_id.clone(),
            completed,
            required_obligations_satisfied: obligations_satisfied && revision_matches,
            unclosed_obligations,
            final_receipt: passing_receipts.last().cloned(),
            timestamp: Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_completion_invariant() {
        let unclosed = vec![ObligationId::new()];
        assert!(AccpSemanticGate::check_completion_authority(&unclosed).is_err());
        assert!(AccpSemanticGate::check_completion_authority(&[]).is_ok());
    }

    #[test]
    fn test_action_decision_invariant() {
        let block_decision = ActionDecision {
            action_id: ActionId::new(),
            verdict: ActionDecisionVerdict::Block,
            reason: "destructive action without authority".into(),
            authorized_scope: Scope::global("test", Revision::ZERO),
            timestamp: Utc::now(),
        };
        assert!(AccpSemanticGate::ensure_execution_authorized(&block_decision).is_err());
    }
}
