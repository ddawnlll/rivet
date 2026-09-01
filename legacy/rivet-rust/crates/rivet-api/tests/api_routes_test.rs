use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use rivet_api::build_router;
use rivet_model::auth::AuthStore;
use rivet_model::provider_hub::ResolvedProviderConfig;
use rivet_service::{RivetServiceImpl, SaveAuthRequest};
use serde_json::Value;
use tempfile::tempdir;
use tower::ServiceExt;

#[tokio::test]
async fn test_api_rest_endpoints() {
    let tmp = tempdir().unwrap();
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
    let app = build_router(svc, None);

    // 1. Health check
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");

    // 2. State check
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/state")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 3. Models list
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/models")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["active_provider"], "mock");

    // 4. Save auth provider
    let save_payload = serde_json::to_vec(&SaveAuthRequest {
        provider: "openai".into(),
        key: "sk-test-mock-key-for-test".into(),
        base_url: None,
        default_model: Some("gpt-4o".into()),
        models: vec!["gpt-4o".into()],
    })
    .unwrap();

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/save")
                .header("content-type", "application/json")
                .body(Body::from(save_payload))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 5. Open/switch project
    let tmp2 = tempdir().unwrap();
    let open_payload = serde_json::json!({
        "path": tmp2.path().to_str().unwrap()
    });

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/project/open")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&open_payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert!(
        json["path"]
            .as_str()
            .unwrap()
            .contains(tmp2.path().file_name().unwrap().to_str().unwrap())
    );

    // 6. History check
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/history")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}
