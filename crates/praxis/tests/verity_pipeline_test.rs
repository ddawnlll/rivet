use std::fs;
use chrono::Utc;
use praxis::gates::lock_gate::LockMode;
use praxis::*;

#[tokio::test]
async fn test_full_verity_8_gate_pipeline_success() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let repo_root = tmp_dir.path();

    // 1. Create mock repository files
    let src_dir = repo_root.join("src");
    fs::create_dir_all(&src_dir).unwrap();
    fs::write(src_dir.join("lib.rs"), "pub fn add(a: i32, b: i32) -> i32 { a + b }\n").unwrap();

    // 2. Create an evidence ledger
    let ledger_path = repo_root.join(".praxis").join("evidence.ledger.jsonl");
    let mut ledger = Ledger::open(&ledger_path, "plan-auth-01").unwrap();
    ledger
        .append(LedgerRecord {
            record_id: "rec-test-1".into(),
            captured_at: Utc::now().to_rfc3339(),
            payload: serde_json::json!({
                "type": "command",
                "commandId": "cmd-test",
                "exitCode": 0,
            }),
        })
        .unwrap();

    // 3. Define a PlanSpec
    let plan = PlanSpec {
        metadata: PlanMetadata {
            plan_id: "plan-auth-01".into(),
            title: "Auth Module Fix".into(),
            version: "1.0.0".into(),
        },
        workspace: PlanWorkspace {
            allowed_files: vec!["src/**".into()],
            forbidden_files: vec!["secrets/**".into()],
        },
        commands: PlanCommands {
            exact_allowed_commands: vec![ExactAllowedCommand {
                id: "cmd-check".into(),
                command: "cargo --version".into(),
                cwd: None,
                kind: "test".into(),
                timeout_seconds: Some(30),
                expected_exit_code: Some(0),
                shell_allowed: Some(false),
                no_tests_found_is_failure: Some(false),
                expected_output_patterns: vec!["cargo".into()],
            }],
            hard_denied_commands: vec!["rm -rf".into(), "git reset --hard".into()],
        },
        tasks: vec![PlanTask {
            id: "task-01".into(),
            name: "Verify auth logic".into(),
            description: "Run cargo check command".into(),
            dependencies: vec![],
            acceptance_criteria: vec![AcceptanceCriterion {
                id: "crit-01".into(),
                description: "Cargo command passes".into(),
                verification: CriterionVerification {
                    r#type: "command".into(),
                    command_ref: Some("cmd-check".into()),
                    deterministic: true,
                    advisory_only: false,
                },
            }],
        }],
    };

    let changed_files = vec![ChangedFile {
        path: "src/lib.rs".into(),
        status: "modified".into(),
    }];

    // 4. Run the full Verity Pipeline
    let pipeline = VerityPipeline::new(repo_root).with_lock_mode(LockMode::CreateIfMissing);

    let result = pipeline
        .run(&plan, Some(&ledger), &changed_files, None::<&str>, "attempt-001")
        .await;

    // Verify verdicts
    assert_eq!(result.overall_verdict, GateVerdict::Pass);
    assert_eq!(result.gate_results.len(), 6); // Schema, Lock, Evidence, Wiring, Exec, Final
    assert!(result.final_receipt.is_some());
    let receipt = result.final_receipt.unwrap();
    assert!(receipt.passed);
}

#[tokio::test]
async fn test_verity_pipeline_forbidden_file_security_block() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let repo_root = tmp_dir.path();

    let plan = PlanSpec {
        metadata: PlanMetadata {
            plan_id: "plan-sec-01".into(),
            title: "Security Test".into(),
            version: "1.0.0".into(),
        },
        workspace: PlanWorkspace {
            allowed_files: vec!["src/**".into()],
            forbidden_files: vec!["production.env".into()],
        },
        commands: PlanCommands::default(),
        tasks: vec![PlanTask {
            id: "t1".into(),
            name: "Modify env".into(),
            description: "".into(),
            dependencies: vec![],
            acceptance_criteria: vec![AcceptanceCriterion {
                id: "c1".into(),
                description: "Env check".into(),
                verification: CriterionVerification {
                    r#type: "test".into(),
                    command_ref: None,
                    deterministic: true,
                    advisory_only: false,
                },
            }],
        }],
    };

    let ledger_path = repo_root.join("evidence.ledger.jsonl");
    let ledger = Ledger::open(&ledger_path, "plan-sec-01").unwrap();

    // Agent touched forbidden file
    let changed_files = vec![ChangedFile {
        path: "production.env".into(),
        status: "modified".into(),
    }];

    let pipeline = VerityPipeline::new(repo_root).with_lock_mode(LockMode::CreateIfMissing);

    let result = pipeline
        .run(&plan, Some(&ledger), &changed_files, None::<&str>, "att-sec")
        .await;

    // Must be FAIL due to EvidenceGate security boundary
    assert_eq!(result.overall_verdict, GateVerdict::Fail);
    let evidence_res = result
        .gate_results
        .iter()
        .find(|g| g.gate_name == "EvidenceGate")
        .unwrap();
    assert_eq!(evidence_res.verdict, GateVerdict::Fail);
    assert!(evidence_res
        .reason_codes
        .contains(&reason_codes::FORBIDDEN_FILE_CHANGED.to_string()));
    assert!(result.final_receipt.is_none());
}
