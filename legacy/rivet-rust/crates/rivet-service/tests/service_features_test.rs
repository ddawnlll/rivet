use rivet_model::auth::AuthStore;
use rivet_model::provider_hub::ResolvedProviderConfig;
use rivet_service::{RivetService, RivetServiceImpl, SaveAuthRequest, StepRequest, UiEvent};

#[tokio::test]
async fn test_service_auth_crud_and_model_catalog() {
    let tmp = tempfile::tempdir().unwrap();
    let auth_path = tmp.path().join("auth.json");
    let auth_store = AuthStore::with_path(&auth_path);

    let config = ResolvedProviderConfig {
        provider: "mock".into(),
        model_id: "mock-model".into(),
        api_key: None,
        base_url: None,
    };

    let svc = RivetServiceImpl::from_dir(tmp.path(), config, auth_store.clone())
        .await
        .unwrap();

    let models = svc.get_models().await.unwrap();
    assert_eq!(models.active_provider, "mock");

    // 1. Save new provider configuration
    let save_req = SaveAuthRequest {
        provider: "anthropic".into(),
        key: "sk-ant-api03-12345678901234567890".into(),
        base_url: None,
        default_model: Some("claude-3-5-sonnet-20241022".into()),
        models: vec!["claude-3-5-sonnet-20241022".into()],
    };
    let updated = svc.save_auth(save_req).await.unwrap();
    let anthropic_p = updated
        .providers
        .iter()
        .find(|p| p.id == "anthropic")
        .unwrap();
    assert!(anthropic_p.configured);
    assert!(anthropic_p.masked_key.as_ref().unwrap().contains("..."));

    // 2. Remove provider
    let removed = svc.remove_auth("anthropic").await.unwrap();
    let anthropic_after = removed
        .providers
        .iter()
        .find(|p| p.id == "anthropic")
        .unwrap();
    assert!(!anthropic_after.configured);
    assert!(anthropic_after.masked_key.is_none());
}

#[tokio::test]
async fn test_service_project_switching_and_history_persistence() {
    let tmp_dir1 = tempfile::tempdir().unwrap();
    let tmp_dir2 = tempfile::tempdir().unwrap();

    let auth_path = tmp_dir1.path().join("auth.json");
    let auth_store = AuthStore::with_path(&auth_path);

    let config = ResolvedProviderConfig {
        provider: "mock".into(),
        model_id: "mock-model".into(),
        api_key: None,
        base_url: None,
    };

    let svc = RivetServiceImpl::from_dir(tmp_dir1.path(), config.clone(), auth_store.clone())
        .await
        .unwrap();

    let p1 = svc.get_project().await.unwrap();
    assert_eq!(p1.path, tmp_dir1.path().display().to_string());

    // Execute step on Project 1
    let step_res = svc
        .step(StepRequest {
            prompt: "First step on project 1".into(),
            goal: None,
            attachments: vec![],
        })
        .await;
    assert!(step_res.is_ok());

    let history1 = svc.get_history().await.unwrap();
    assert_eq!(history1.len(), 1);
    assert_eq!(history1[0].prompt, "First step on project 1");

    // Switch to Project 2
    let p2 = svc.open_project(tmp_dir2.path()).await.unwrap();
    assert_eq!(
        p2.path,
        tmp_dir2
            .path()
            .canonicalize()
            .unwrap()
            .display()
            .to_string()
    );

    let history2 = svc.get_history().await.unwrap();
    assert_eq!(history2.len(), 0); // Clean project 2 has no past history yet

    // Switch back to Project 1 and verify persistent history reloaded from store
    let p1_reopen = svc.open_project(tmp_dir1.path()).await.unwrap();
    assert_eq!(
        p1_reopen.path,
        tmp_dir1
            .path()
            .canonicalize()
            .unwrap()
            .display()
            .to_string()
    );

    let history1_restored = svc.get_history().await.unwrap();
    assert_eq!(history1_restored.len(), 1);
    assert_eq!(history1_restored[0].prompt, "First step on project 1");
}

#[tokio::test]
async fn test_service_mcp_config_discovery() {
    let tmp = tempfile::tempdir().unwrap();
    let rivet_dir = tmp.path().join(".rivet");
    std::fs::create_dir_all(&rivet_dir).unwrap();
    let mcp_json = rivet_dir.join("mcp.json");

    let content = r#"{
        "mcpServers": {
            "mock_server": {
                "command": "python3",
                "args": ["-c", "import sys; sys.exit(0)"],
                "disabled": true
            }
        }
    }"#;
    std::fs::write(&mcp_json, content).unwrap();

    let auth_store = AuthStore::with_path(tmp.path().join("auth.json"));
    let config = ResolvedProviderConfig {
        provider: "mock".into(),
        model_id: "mock-model".into(),
        api_key: None,
        base_url: None,
    };

    let svc = RivetServiceImpl::from_dir(tmp.path(), config, auth_store)
        .await
        .unwrap();

    let mcp_status = svc.get_mcp_status().await.unwrap();
    assert_eq!(mcp_status.len(), 1);
    assert_eq!(mcp_status[0].name, "mock_server");
    assert_eq!(mcp_status[0].status, "disabled");
}

#[tokio::test]
async fn step_events_are_correlated_and_plain_text_uses_one_turn() {
    let tmp = tempfile::tempdir().unwrap();
    let auth_store = AuthStore::with_path(tmp.path().join("auth.json"));
    let config = ResolvedProviderConfig {
        provider: "mock".into(),
        model_id: "mock-model".into(),
        api_key: None,
        base_url: None,
    };
    let service = RivetServiceImpl::from_dir(tmp.path(), config, auth_store)
        .await
        .unwrap();
    let mut events = service.subscribe();

    let response = service
        .step(StepRequest {
            prompt: "naber".into(),
            goal: None,
            attachments: vec![],
        })
        .await
        .unwrap();

    assert_eq!(response.text, "Step completed successfully");
    let mut run_id = None;
    let mut turn_starts = 0;
    let mut deltas = 0;
    let mut completed = 0;
    while let Ok(envelope) = events.try_recv() {
        let event_run_id = envelope
            .run_id
            .clone()
            .expect("every event emitted during a run must carry run_id");
        if let Some(expected) = &run_id {
            assert_eq!(expected, &event_run_id);
        } else {
            run_id = Some(event_run_id);
        }
        match envelope.event {
            UiEvent::AssistantTurnStarted => {
                turn_starts += 1;
                assert_eq!(envelope.turn, Some(1));
            }
            UiEvent::AssistantDelta { .. } => {
                deltas += 1;
                assert_eq!(envelope.turn, Some(1));
            }
            UiEvent::Completed { phase, .. } => {
                completed += 1;
                assert_eq!(phase, rivet_core::RunPhase::Idle);
            }
            _ => {}
        }
    }

    assert!(run_id.is_some());
    assert_eq!(turn_starts, 1);
    assert_eq!(deltas, 1);
    assert_eq!(completed, 1);
}

#[tokio::test]
async fn cancelling_when_idle_does_not_poison_the_next_run() {
    let tmp = tempfile::tempdir().unwrap();
    let auth_store = AuthStore::with_path(tmp.path().join("auth.json"));
    let config = ResolvedProviderConfig {
        provider: "mock".into(),
        model_id: "mock-model".into(),
        api_key: None,
        base_url: None,
    };
    let service = RivetServiceImpl::from_dir(tmp.path(), config, auth_store)
        .await
        .unwrap();

    service.cancel().await.unwrap();
    assert_eq!(service.current_phase().await.unwrap(), rivet_core::RunPhase::Idle);

    let response = service
        .step(StepRequest {
            prompt: "Selam".into(),
            goal: None,
            attachments: vec![],
        })
        .await
        .unwrap();

    assert_eq!(response.text, "Step completed successfully");
}
