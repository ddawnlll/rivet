use accp::{ActionProposal, ActionRisk};
use chrono::Utc;
use rivet_runtime::Runtime;
use rivet_types::*;
use std::sync::Arc;

fn proposal(
    capability: &str,
    target: &str,
    parameters: serde_json::Value,
    key: &str,
) -> ActionProposal {
    ActionProposal {
        action_id: ActionId::new(),
        capability: capability.into(),
        target: target.into(),
        parameters,
        estimated_risk: if capability == "file.read" {
            ActionRisk::Inspect
        } else {
            ActionRisk::Material
        },
        intent: "runtime boundary test".into(),
        scope: Scope::global("rivet", Revision::ZERO),
        idempotency_key: Some(key.into()),
        timestamp: Utc::now(),
    }
}

#[tokio::test]
async fn traversal_is_rejected_and_atomic_write_is_observable() {
    let directory = tempfile::tempdir().unwrap();
    let outside = directory
        .path()
        .parent()
        .unwrap()
        .join("rivet-runtime-outside.txt");
    let runtime = Runtime::new(directory.path());

    let traversal = proposal(
        "file.write",
        "../rivet-runtime-outside.txt",
        serde_json::json!({ "content": "must not escape" }),
        "traversal",
    );
    let rejected = runtime.execute_action(&traversal).await.unwrap();
    assert!(!rejected.success);
    assert!(!outside.exists());

    let write = proposal(
        "file.write",
        "nested/value.txt",
        serde_json::json!({ "content": "atomic content" }),
        "write-1",
    );
    let receipt = runtime.execute_action(&write).await.unwrap();
    assert!(receipt.success);
    assert_eq!(receipt.observations["kind"], "file.write");
    assert_eq!(
        tokio::fs::read_to_string(directory.path().join("nested/value.txt"))
            .await
            .unwrap(),
        "atomic content"
    );
}

#[tokio::test]
async fn identical_action_identity_returns_prior_receipt_without_reexecution() {
    let directory = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(directory.path());
    let first = proposal(
        "file.write",
        "value.txt",
        serde_json::json!({ "content": "first" }),
        "same-action",
    );
    let first_receipt = runtime.execute_action(&first).await.unwrap();

    let retry = proposal(
        "file.write",
        "value.txt",
        serde_json::json!({ "content": "second must not win" }),
        "same-action",
    );
    let retry_receipt = runtime.execute_action(&retry).await.unwrap();
    assert_eq!(retry_receipt.receipt_id, first_receipt.receipt_id);
    assert_eq!(
        tokio::fs::read_to_string(directory.path().join("value.txt"))
            .await
            .unwrap(),
        "first"
    );
}

#[tokio::test]
async fn concurrent_retries_share_one_authoritative_receipt() {
    let directory = tempfile::tempdir().unwrap();
    let runtime = Arc::new(Runtime::new(directory.path()));
    let write = proposal(
        "file.write",
        "concurrent.txt",
        serde_json::json!({ "content": "first writer only" }),
        "concurrent-action",
    );

    let (left, right) = tokio::join!(
        runtime.execute_action(&write),
        runtime.execute_action(&write)
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert_eq!(left.receipt_id, right.receipt_id);
    assert_eq!(
        tokio::fs::read_to_string(directory.path().join("concurrent.txt"))
            .await
            .unwrap(),
        "first writer only"
    );
}
