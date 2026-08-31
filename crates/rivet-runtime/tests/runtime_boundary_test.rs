use accp::{ActionProposal, ActionRisk};
use chrono::Utc;
use rivet_runtime::Runtime;
use rivet_types::*;
use std::sync::Arc;
use std::time::Duration;

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
        serde_json::json!({ "content": "first" }),
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

    let conflicting_retry = proposal(
        "file.write",
        "value.txt",
        serde_json::json!({ "content": "second must be rejected" }),
        "same-action",
    );
    assert!(matches!(
        runtime.execute_action(&conflicting_retry).await,
        Err(RivetError::Runtime(message)) if message.contains("reused")
    ));
}

#[tokio::test]
async fn large_utf8_observation_is_truncated_on_a_character_boundary() {
    let directory = tempfile::tempdir().unwrap();
    tokio::fs::write(directory.path().join("unicode.txt"), "é".repeat(40_000))
        .await
        .unwrap();
    let runtime = Runtime::new(directory.path());
    let read = proposal(
        "file.read",
        "unicode.txt",
        serde_json::json!({}),
        "unicode-read",
    );
    let receipt = runtime.execute_action(&read).await.unwrap();
    assert!(receipt.success);
    assert_eq!(receipt.observations["truncated"], true);
    let observed = receipt.observations["content"].as_str().unwrap();
    assert!(observed.is_char_boundary(observed.len()));
    assert!(observed.len() <= 64 * 1024);
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

#[tokio::test]
async fn command_output_is_bounded_and_marks_truncation() {
    let directory = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(directory.path()).with_command_output_limit(1024);

    #[cfg(windows)]
    let (program, args) = (
        "cmd",
        vec!["/C", "for /L %i in (1,1,10000) do @echo 0123456789"],
    );
    #[cfg(not(windows))]
    let (program, args) = ("sh", vec!["-c", "yes 0123456789 | head -c 200000"]);

    let (_, stdout, stderr, _) = runtime.execute_command(program, &args, 30).await.unwrap();

    assert!(stdout.len() <= 1024);
    assert!(stderr.len() <= 1024);
    assert!(stdout.contains("[output truncated]") || stderr.contains("[output truncated]"));
}

#[tokio::test]
async fn timeout_terminates_the_process_group() {
    let directory = tempfile::tempdir().unwrap();
    let pid_path = directory.path().join("child.pid");

    #[cfg(windows)]
    let (program, args, pid_check) = {
        let escaped_pid_path = pid_path.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$p = Start-Process -FilePath powershell -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 30') -PassThru; Set-Content -LiteralPath '{}' -Value $p.Id; Wait-Process -Id $p.Id",
            escaped_pid_path
        );
        (
            "powershell",
            vec!["-NoProfile".into(), "-Command".into(), script],
            "powershell",
        )
    };
    #[cfg(unix)]
    let (program, args, pid_check) = (
        "sh",
        vec!["-c".into(), "sleep 30 & echo $! > child.pid; wait".into()],
        "kill",
    );

    let runtime = Runtime::new(directory.path());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let timeout_result = runtime.execute_command(program, &arg_refs, 1).await;
    assert!(matches!(
        timeout_result,
        Err(RivetError::Runtime(message)) if message.contains("timed out")
    ));

    let child_pid = {
        let mut found = None;
        for _ in 0..30 {
            if let Ok(pid) = tokio::fs::read_to_string(&pid_path).await
                && let Ok(pid) = pid.trim().parse::<u32>()
            {
                found = Some(pid);
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        found
    };
    let child_pid = child_pid.expect("the child process must publish its pid");

    for _ in 0..30 {
        let running = if cfg!(windows) {
            let filter = format!(
                "if (Get-Process -Id {} -ErrorAction SilentlyContinue) {{ exit 1 }} else {{ exit 0 }}",
                child_pid
            );
            std::process::Command::new(pid_check)
                .args(["-NoProfile", "-NonInteractive", "-Command", &filter])
                .status()
                .map(|status| !status.success())
                .unwrap_or(false)
        } else {
            std::process::Command::new(pid_check)
                .args(["-0", &child_pid.to_string()])
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
        };
        if !running {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let still_running = if cfg!(windows) {
        let filter = format!(
            "if (Get-Process -Id {} -ErrorAction SilentlyContinue) {{ exit 1 }} else {{ exit 0 }}",
            child_pid
        );
        std::process::Command::new(pid_check)
            .args(["-NoProfile", "-NonInteractive", "-Command", &filter])
            .status()
            .map(|status| !status.success())
            .unwrap_or(false)
    } else {
        std::process::Command::new(pid_check)
            .args(["-0", &child_pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    };
    assert!(!still_running, "child process {child_pid} survived timeout");
}
