//! MCP E2E tests beyond CRUD: connection test, agent config discovery, OAuth, auth.
//!
//! Covers test-plan sections 2 (connection test error paths), 3 (agent config discovery),
//! 4 (OAuth status), and 6 (authentication).

mod common;

use aionui_app::{AppConfig, AppServices, build_module_states, create_router_with_states};
use aionui_mcp::McpConnectionTestService;
use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use common::{body_json, build_app, get_with_token, json_with_token, setup_and_login};

// ===========================================================================
// CT-3: Connection test — command not found (ENOENT)
// ===========================================================================

#[tokio::test]
async fn connection_test_enoent_command() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let req = json_with_token(
        "POST",
        "/api/mcp/test-connection",
        json!({
            "name": "enoent-test",
            "transport": {
                "type": "stdio",
                "command": "nonexistent-mcp-command-xyz-12345"
            }
        }),
        &token,
        &csrf,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let json = body_json(resp).await;
    assert!(!json["success"].as_bool().unwrap());
    assert_eq!(json["code"], "MCP_COMMAND_NOT_FOUND");
    assert_eq!(json["details"]["command"], "nonexistent-mcp-command-xyz-12345");
    assert!(!json["error"].as_str().unwrap().is_empty());
}

// ===========================================================================
// CT-4: Connection test — TCP peer closes before the HTTP handshake
// ===========================================================================

#[tokio::test]
async fn connection_test_peer_closes_before_http_handshake() {
    let temporary = tempfile::tempdir().unwrap();
    let config = AppConfig {
        data_dir: temporary.path().to_path_buf(),
        work_dir: temporary.path().to_path_buf(),
        ..Default::default()
    };
    let database = aionui_db::init_database_memory().await.unwrap();
    let services = AppServices::from_config(database, &config).await.unwrap();
    let (mut states, _) = build_module_states(&services).await.unwrap();
    let http_client = reqwest::Client::builder().no_proxy().build().unwrap();
    states.mcp.connection_test_service = McpConnectionTestService::new(http_client, services.event_bus.clone());
    let mut app = create_router_with_states(&services, states);
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    // Hold a private port and close the connection before returning any HTTP response.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let close_connection = tokio::spawn(async move {
        let (connection, _) = listener.accept().await.unwrap();
        drop(connection);
    });
    let req = json_with_token(
        "POST",
        "/api/mcp/test-connection",
        json!({
            "name": "closed-peer-test",
            "transport": {
                "type": "http",
                "url": format!("http://{address}/mcp")
            }
        }),
        &token,
        &csrf,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);

    let json = body_json(resp).await;
    assert!(!json["success"].as_bool().unwrap());
    assert_eq!(json["code"], "MCP_CONNECTION_FAILED");
    assert_eq!(json["details"]["transport"], "http");
    assert!(!json["error"].as_str().unwrap().is_empty());
    tokio::time::timeout(std::time::Duration::from_secs(5), close_connection)
        .await
        .expect("the HTTP client should reach the test peer")
        .unwrap();
}

// ===========================================================================
// AS-1: Get agent configs (may return empty in test env)
// ===========================================================================

#[tokio::test]
async fn get_agent_configs() {
    let (mut app, services) = build_app().await;
    let (token, _csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let resp = app
        .clone()
        .oneshot(get_with_token("/api/mcp/agent-configs", &token))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let json = body_json(resp).await;
    assert!(json["success"].as_bool().unwrap());
    // In test env, data is an array (may be empty or contain aionui adapter)
    assert!(json["data"].is_array());
}

// ===========================================================================
// OA-1: OAuth check status — unauthenticated server
// ===========================================================================

#[tokio::test]
async fn oauth_check_status_unauthenticated_server() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let req = json_with_token(
        "POST",
        "/api/mcp/oauth/check-status",
        json!({ "server_url": "https://unknown-server.example.com" }),
        &token,
        &csrf,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let json = body_json(resp).await;
    assert!(json["success"].as_bool().unwrap());
    assert!(!json["data"]["authenticated"].as_bool().unwrap());
}

// ===========================================================================
// OA-3: Get all authenticated servers (empty at start)
// ===========================================================================

#[tokio::test]
async fn oauth_authenticated_servers_empty() {
    let (mut app, services) = build_app().await;
    let (token, _csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let resp = app
        .clone()
        .oneshot(get_with_token("/api/mcp/oauth/authenticated", &token))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let json = body_json(resp).await;
    assert!(json["success"].as_bool().unwrap());
    assert_eq!(json["data"], json!([]));
}

// ===========================================================================
// OA-7: Logout from never-authenticated server (idempotent)
// ===========================================================================

#[tokio::test]
async fn oauth_logout_idempotent() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let req = json_with_token(
        "POST",
        "/api/mcp/oauth/logout",
        json!({ "server_url": "https://never-authed.example.com" }),
        &token,
        &csrf,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let json = body_json(resp).await;
    assert!(json["success"].as_bool().unwrap());
}

// ===========================================================================
// AU-1: Unauthenticated access to various MCP endpoints
// ===========================================================================

#[tokio::test]
async fn unauthenticated_get_servers_rejected() {
    let (app, _services) = build_app().await;

    let req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/mcp/servers")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    // GET bypasses CSRF; auth middleware returns the canonical auth boundary.
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let json = body_json(resp).await;
    assert_eq!(json["code"], "UNAUTHORIZED");
}

#[tokio::test]
async fn unauthenticated_post_server_rejected() {
    let (app, _services) = build_app().await;

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/mcp/servers")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "name": "test",
                "transport": { "type": "stdio", "command": "npx" }
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// AU-3: Valid token accesses MCP routes successfully
#[tokio::test]
async fn authenticated_access_succeeds() {
    let (mut app, services) = build_app().await;
    let (token, _csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;

    let resp = app
        .clone()
        .oneshot(get_with_token("/api/mcp/servers", &token))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

// AU-2: Invalid Bearer token is rejected by auth middleware.
#[tokio::test]
async fn invalid_token_rejected() {
    let (app, _services) = build_app().await;

    // GET bypasses CSRF; auth middleware sees invalid Bearer.
    let req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/mcp/servers")
        .header("authorization", "Bearer invalid-jwt-token-abc123")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let json = body_json(resp).await;
    assert_eq!(json["code"], "UNAUTHORIZED");
}
