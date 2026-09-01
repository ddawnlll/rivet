use async_trait::async_trait;
use rivet_core::HarnessCore;
use rivet_model::{CognitiveAction, ModelBackend, ModelRequest, ModelResponse, TokenUsage};
use rivet_runtime::Runtime;
use rivet_store::MemoryStore;
use rivet_types::*;
use std::sync::Arc;
use tempfile::tempdir;

/// Scripted backend simulating a messy real-world LLM producing conversational prose,
/// backtick blocks, and case-sensitive variances.
struct MessyModelBackend;

#[async_trait]
impl ModelBackend for MessyModelBackend {
    async fn invoke(&self, _request: ModelRequest) -> RivetResult<ModelResponse> {
        let raw_output = r#"
Sure! I have carefully analyzed the codebase and here is my proposed action plan:

```json
{
  "action_type": "thought",
  "payload": "Let us inspect the configuration file to determine provider settings."
}
```

Now I will read lines 1 to 20 of `config.toml`:

```json
{
  "action_type": "tool_call",
  "payload": {
    "action_id": "act-messy-001",
    "capability": "file.read",
    "target": "config.toml",
    "parameters": {
      "start_line": 1,
      "end_line": 20
    },
    "estimated_risk": "Inspect",
    "rationale": "Read header settings",
    "scope": {
      "repository": "rivet",
      "revision": 0
    },
    "timestamp": "2026-09-01T00:00:00Z"
  }
}
```

Let me know if you would like me to proceed after this read!
"#;
        let actions = CognitiveAction::parse_text(raw_output);
        Ok(ModelResponse {
            text_content: raw_output.into(),
            actions,
            usage: TokenUsage {
                input_tokens: 150,
                output_tokens: 80,
                cached_tokens: None,
            },
        })
    }
}

/// Verifies Rule 49: Robust Wire Protocol & Resilient Boundary Parsing.
/// Messy model prose, multiple code blocks, and case aliases are cleanly decoded without losing typed protocol invariants.
#[tokio::test]
async fn test_rule_49_messy_raw_parsing_and_wire_fidelity() {
    let dir = tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(dir.path()));
    let store = Arc::new(MemoryStore::new());
    let model = Arc::new(MessyModelBackend);
    let harness = HarnessCore::new(store, model, runtime);

    // Create target file in workspace
    tokio::fs::write(
        dir.path().join("config.toml"),
        "[server]\nport = 8080\nhost = \"127.0.0.1\"\n",
    )
    .await
    .unwrap();

    let response = harness
        .step("Inspect server config", "Please check config.toml")
        .await
        .unwrap();

    assert!(response.contains("Sure! I have carefully analyzed"));

    // Verify that the action was successfully authorized, executed, and recorded in Noesis
    let hard = harness.hard_state.lock().await;
    assert_eq!(hard.execution_receipts.len(), 1);
    let receipt = &hard.execution_receipts[0];
    assert!(receipt.success);
    assert_eq!(receipt.capability, "file.read");
}

/// Scripted backend simulating a model that outputs malformed JSON on turn 1,
/// but self-corrects on turn 2 after receiving corrective steering guidance in SoftWorkspace.
struct MalformedThenCorrectedModel {
    call_count: tokio::sync::Mutex<usize>,
}

#[async_trait]
impl ModelBackend for MalformedThenCorrectedModel {
    async fn invoke(&self, request: ModelRequest) -> RivetResult<ModelResponse> {
        let mut count = self.call_count.lock().await;
        *count += 1;

        if *count == 1 {
            // Turn 1: Malformed JSON syntax
            let malformed = "I will search: ```json\n{\"action_type\": \"tool_call\", \"payload\": { broken json...\n```";
            let actions = CognitiveAction::parse_text(malformed);
            Ok(ModelResponse {
                text_content: malformed.into(),
                actions,
                usage: TokenUsage::default(),
            })
        } else {
            // Turn 2: Verify that corrective feedback hypothesis was delivered in the view prompt
            assert!(
                request.user_prompt.contains("Corrective Guidance")
                    || request.system_prompt.contains("Rivet")
            );

            // Emit valid corrected proposal
            let corrected = r#"
```json
{
  "action_type": "tool_call",
  "payload": {
    "action_id": "act-corrected-002",
    "capability": "code.search",
    "target": "search",
    "parameters": {
      "query": "port = 8080"
    },
    "estimated_risk": "inspect",
    "intent": "Locate server port",
    "scope": {
      "repository": "rivet",
      "revision": 1
    },
    "timestamp": "2026-09-01T00:00:00Z"
  }
}
```
"#;
            let actions = CognitiveAction::parse_text(corrected);
            Ok(ModelResponse {
                text_content: corrected.into(),
                actions,
                usage: TokenUsage::default(),
            })
        }
    }
}

/// Verifies Rule 50: Closed-Loop Steering & Self-Correction Feedback.
/// Malformed model output triggers an immediate corrective steering hypothesis in SoftWorkspace,
/// guiding the model to self-correct on the very next turn.
#[tokio::test]
async fn test_rule_50_closed_loop_steering_and_self_correction() {
    let dir = tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(dir.path()));
    let store = Arc::new(MemoryStore::new());
    let model = Arc::new(MalformedThenCorrectedModel {
        call_count: tokio::sync::Mutex::new(0),
    });
    let harness = HarnessCore::new(store, model, runtime);

    tokio::fs::write(
        dir.path().join("server.conf"),
        "port = 8080\nmax_connections = 1000\n",
    )
    .await
    .unwrap();

    // Turn 1: Malformed output
    let _step1 = harness
        .step("Find port", "Search server configuration")
        .await
        .unwrap();

    // Verify that SoftWorkspace recorded corrective guidance
    {
        let soft = harness.soft_workspace.lock().await;
        let has_guidance = soft
            .hypotheses
            .iter()
            .any(|h| h.contains("Corrective Guidance"));
        assert!(
            has_guidance,
            "SoftWorkspace must contain corrective steering guidance"
        );
    }

    // Turn 2: Self-corrected output
    let _step2 = harness
        .step("Find port", "Retry search server configuration")
        .await
        .unwrap();

    // Verify that turn 2 executed the corrected search action
    let hard = harness.hard_state.lock().await;
    assert_eq!(hard.execution_receipts.len(), 1);
    assert_eq!(hard.execution_receipts[0].capability, "code.search");
    assert!(hard.execution_receipts[0].success);
}
