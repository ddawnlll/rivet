use rivet_model::CognitiveAction;

#[test]
fn test_multiblock_markdown_json_parsing() {
    let output = r#"
Here is my analysis of the codebase.

```json
{
  "action_type": "thought",
  "payload": "I will search for the configuration parser."
}
```

Now let's run the search:

```json
{
  "action_type": "tool_call",
  "payload": {
    "action_id": "act-123",
    "capability": "code.search",
    "target": "config",
    "parameters": {
      "query": "struct Config"
    },
    "estimated_risk": "Inspect",
    "scope": {
      "repository": "rivet",
      "revision": 0
    },
    "rationale": "Locate config struct",
    "timestamp": "2026-09-01T00:00:00Z"
  }
}
```
"#;

    let actions = CognitiveAction::parse_text(output);
    assert_eq!(actions.len(), 2);
    assert!(matches!(&actions[0], CognitiveAction::Thought(_)));
    assert!(matches!(&actions[1], CognitiveAction::ToolCall(p) if p.capability == "code.search"));
}

#[test]
fn test_embedded_raw_json_parsing() {
    let output = r#"I think we are done. {"action_type": "completion_request", "payload": {"summary": "All obligations satisfied."}} Let's wrap up."#;
    let actions = CognitiveAction::parse_text(output);
    assert_eq!(actions.len(), 1);
    assert!(
        matches!(&actions[0], CognitiveAction::CompletionRequest { summary } if summary.contains("All obligations"))
    );
}

#[test]
fn test_markdown_native_accp_fenced_blocks_json_and_yaml() {
    let output = r#"
# Project Diagnosis

I reviewed the repository and identified the issue in `crates/praxis`.
Here is the proposed action to inspect the file:

```accp
{
  "accp_version": "3.0",
  "family": "PROPOSAL",
  "kind": "ACTION",
  "revision": 3,
  "payload": {
    "capability": "file.read",
    "target": "crates/praxis/src/lib.rs",
    "intent": "Inspect verification gates"
  }
}
```

We also record our hypothesis in YAML format:

```accp
family: PROPOSAL
kind: WORKSPACE_DELTA
revision: 3
payload:
  add:
    - "Praxis gates are deterministic"
  remove: []
```
"#;

    let actions = CognitiveAction::parse_text(output);
    assert_eq!(actions.len(), 2);
    assert!(
        matches!(&actions[0], CognitiveAction::ToolCall(p) if p.capability == "file.read" && p.target == "crates/praxis/src/lib.rs")
    );
    assert!(
        matches!(&actions[1], CognitiveAction::HypothesisDelta { add, .. } if add.contains(&"Praxis gates are deterministic".to_string()))
    );
}
