use std::path::Path;

use aionui_app::{AppConfig, AppServices, build_module_states, create_router_with_states};
use aionui_auth::CurrentUser;
use aionui_db::{IAcpSessionRepository, SqliteAcpSessionRepository, models::MessageRow};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn app(root: &Path) -> (Router, AppServices) {
    let db = aionui_db::init_database_memory().await.unwrap();
    let config = AppConfig {
        data_dir: root.join("data"),
        work_dir: root.join("work"),
        local: true,
        ..Default::default()
    };
    tokio::fs::create_dir_all(&config.data_dir).await.unwrap();
    tokio::fs::create_dir_all(&config.work_dir).await.unwrap();
    let services = AppServices::from_config(db, &config).await.unwrap();
    let (states, _) = build_module_states(&services).await.unwrap();
    (create_router_with_states(&services, states), services)
}

async fn request(router: &Router, method: Method, path: &str, body: Value, expected: StatusCode) -> Value {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(method.clone())
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 4_000_000).await.unwrap();
    assert_eq!(status, expected, "{method} {path}: {}", String::from_utf8_lossy(&bytes));
    serde_json::from_slice(&bytes).unwrap()
}

async fn get(router: &Router, path: &str) -> Value {
    request(router, Method::GET, path, Value::Null, StatusCode::OK).await["data"].clone()
}

async fn post(router: &Router, path: &str, body: Value) -> Value {
    request(router, Method::POST, path, body, StatusCode::OK).await["data"].clone()
}

async fn delete(router: &Router, path: &str) {
    request(router, Method::DELETE, path, Value::Null, StatusCode::OK).await;
}

async fn error(router: &Router, method: Method, path: &str, body: Value, status: StatusCode, code: &str) {
    assert_eq!(request(router, method, path, body, status).await["code"], code);
}

async fn create_report(router: &Router, inputs: &[&Path]) -> Value {
    post(
        router,
        "/api/paper-talk",
        json!({"direction":"Graph learning","intent":"compare methods","count":3,"minutes":10,
               "region":"international","months":12,"strict_quartile":true,"style":"international","inputs":inputs}),
    )
    .await
}

async fn create_conversation(router: &Router, report: &Value) -> String {
    request(
        router,
        Method::POST,
        "/api/conversations",
        json!({"type":"acp","name":"Graph learning","extra":{
            "backend":"codex","workspace":report["workspace"],"paper_talk_report_id":report["id"]
        }}),
        StatusCode::CREATED,
    )
    .await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn fork_conversation(router: &Router, services: &AppServices, conversation: &str) -> Value {
    let user = CurrentUser::local_default();
    let acp = SqliteAcpSessionRepository::new(services.database.pool().clone());
    assert!(
        acp.update_session_id_for_user(&user.id, conversation, "parent-session-fixture")
            .await
            .unwrap()
    );
    let message = MessageRow {
        id: "msg-fork-point".into(),
        conversation_id: conversation.into(),
        msg_id: None,
        r#type: "text".into(),
        content: json!({"content":"Saved turn"}).to_string(),
        position: Some("right".into()),
        status: Some("finish".into()),
        hidden: false,
        created_at: aionui_common::now_ms(),
        backend_turn_id: None,
    };
    services
        .conversation_repo
        .insert_message(&user.id, &message)
        .await
        .unwrap();
    request(
        router,
        Method::POST,
        &format!("/api/conversations/{conversation}/fork"),
        json!({"message_id":message.id}),
        StatusCode::CREATED,
    )
    .await["data"]
        .clone()
}

fn report_path(report: &Value) -> String {
    format!("/api/paper-talk/{}", report["id"].as_str().unwrap())
}

async fn assert_report_slice(router: &Router, report: &Value, conversation: Value, archived: bool) {
    let active = get(router, "/api/paper-talk").await;
    let archive = get(router, "/api/paper-talk?archived=true").await;
    let row = json!([{"id":report["id"],"direction":"Graph learning","conversation":conversation}]);
    if archived {
        assert_eq!(active, json!([]));
        assert_eq!(archive, row);
    } else {
        assert_eq!(active, row);
        assert_eq!(archive, json!([]));
    }
}

async fn assert_sidebar_slice(router: &Router, conversation: &str, archived: bool) {
    for (path, present) in [("/api/sidebar", !archived), ("/api/sidebar?archived=true", archived)] {
        let sidebar = get(router, path).await;
        let found = sidebar["groups"].as_array().unwrap().iter().any(|group| {
            group["items"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["conversation"]["id"] == conversation)
        });
        assert_eq!(found, present, "{path}");
    }
}

async fn assert_archived(router: &Router, report: &str) {
    error(
        router,
        Method::GET,
        report,
        Value::Null,
        StatusCode::GONE,
        "CONVERSATION_ARCHIVED",
    )
    .await;
}

#[tokio::test]
async fn report_archive_and_restore_publish_conversation_updates() {
    let temp = tempfile::tempdir().unwrap();
    let (router, services) = app(temp.path()).await;
    let report = create_report(&router, &[]).await;
    let path = report_path(&report);
    let conversation = create_conversation(&router, &report).await;
    post(
        &router,
        &format!("{path}/conversation"),
        json!({"conversation":conversation}),
    )
    .await;

    let mut events = services.event_bus.subscribe();
    for action in ["archive", "unarchive"] {
        post(&router, &format!("{path}/{action}"), Value::Null).await;
        let event = events.try_recv().unwrap();
        assert_eq!(event.name, "conversation.listChanged");
        assert_eq!(event.data["action"], "updated");
        assert_eq!(event.data["conversation_id"], conversation);
        assert_eq!(event.data["user_id"], CurrentUser::local_default().id);
    }
}

#[tokio::test]
async fn report_and_sidebar_archive_restore_and_delete_share_the_conversation_state() {
    let temp = tempfile::tempdir().unwrap();
    let (router, services) = app(temp.path()).await;
    let original = temp.path().join("original.pdf");
    tokio::fs::write(&original, b"%PDF-1.7 source").await.unwrap();
    let report = create_report(&router, &[&original]).await;
    let conversation = create_conversation(&router, &report).await;
    let path = report_path(&report);
    let sidebar = format!("/api/sidebar/conversation/{conversation}");
    post(
        &router,
        &format!("{path}/conversation"),
        json!({"conversation":conversation}),
    )
    .await;

    post(&router, &format!("{path}/archive"), Value::Null).await;
    assert_report_slice(&router, &report, json!(conversation), true).await;
    assert_sidebar_slice(&router, &conversation, true).await;
    assert_archived(&router, &path).await;

    post(&router, &format!("{sidebar}/unarchive"), Value::Null).await;
    assert_report_slice(&router, &report, json!(conversation), false).await;
    let restored = get(&router, &path).await;
    assert_eq!(restored["brief"], report["brief"]);
    assert_eq!(restored["revision"], report["revision"]);

    post(&router, &format!("{sidebar}/archive"), Value::Null).await;
    assert_report_slice(&router, &report, json!(conversation), true).await;
    post(&router, &format!("{path}/unarchive"), Value::Null).await;
    assert_sidebar_slice(&router, &conversation, false).await;
    assert_report_slice(&router, &report, json!(conversation), false).await;

    let fork = fork_conversation(&router, &services, &conversation).await;
    assert_eq!(fork["extra"]["workspace"], report["workspace"]);
    let moved_workspace = temp.path().join("moved-workspace");
    tokio::fs::create_dir(&moved_workspace).await.unwrap();
    let updated = request(
        &router,
        Method::PATCH,
        &format!("/api/conversations/{conversation}"),
        json!({"extra":{"workspace":moved_workspace}}),
        StatusCode::OK,
    )
    .await;
    assert_ne!(updated["data"]["extra"]["workspace"], fork["extra"]["workspace"]);

    let workspace = Path::new(report["workspace"].as_str().unwrap());
    let inside_export = workspace.join("report.pptx");
    tokio::fs::write(&inside_export, b"report export").await.unwrap();
    let outside_export = temp.path().join("export.pptx");
    tokio::fs::write(&outside_export, b"external export").await.unwrap();
    delete(&router, &path).await;
    assert_eq!(tokio::fs::read(&original).await.unwrap(), b"%PDF-1.7 source");
    assert_eq!(tokio::fs::read(&outside_export).await.unwrap(), b"external export");
    assert_eq!(tokio::fs::read(&inside_export).await.unwrap(), b"report export");
    assert!(!workspace.join("report.json").exists());
    let fork_path = format!("/api/conversations/{}", fork["id"].as_str().unwrap());
    assert_eq!(
        get(&router, &fork_path).await["extra"]["workspace"],
        report["workspace"]
    );
    error(
        &router,
        Method::GET,
        &path,
        Value::Null,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
    )
    .await;
    error(
        &router,
        Method::GET,
        &format!("/api/conversations/{conversation}"),
        Value::Null,
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
    )
    .await;
}

#[tokio::test]
async fn deleting_from_conversation_archive_invalidates_report_links_and_stale_jobs() {
    let temp = tempfile::tempdir().unwrap();
    let (router, _) = app(temp.path()).await;
    let report = create_report(&router, &[]).await;
    let path = report_path(&report);
    let conversation = create_conversation(&router, &report).await;
    let binding = json!({"conversation":conversation});
    post(&router, &format!("{path}/conversation"), binding.clone()).await;
    let task = post(
        &router,
        &format!("{path}/jobs"),
        json!({"revision":1,"stage":"search","instruction":"find a paper"}),
    )
    .await;
    let job = task["job"]["id"].as_str().unwrap();

    post(
        &router,
        &format!("/api/sidebar/conversation/{conversation}/archive"),
        Value::Null,
    )
    .await;
    delete(&router, "/api/sidebar/archived").await;
    assert_eq!(get(&router, "/api/paper-talk").await, json!([]));
    assert_eq!(get(&router, "/api/paper-talk?archived=true").await, json!([]));

    let job_workspace = Path::new(task["job"]["workspace"].as_str().unwrap());
    tokio::fs::write(job_workspace.join("result.json"), br#"{"answer":"late output"}"#)
        .await
        .unwrap();
    for (method, path, body) in [
        (Method::GET, path.clone(), Value::Null),
        (Method::POST, format!("{path}/conversation"), binding),
        (Method::POST, format!("{path}/jobs/{job}/collect"), Value::Null),
        (Method::POST, format!("{path}/export"), json!({"revision":2})),
        (Method::POST, format!("{path}/unarchive"), Value::Null),
        (Method::DELETE, path, Value::Null),
    ] {
        error(&router, method, &path, body, StatusCode::NOT_FOUND, "NOT_FOUND").await;
    }
}

#[tokio::test]
async fn legacy_unbound_reports_can_be_managed_without_a_conversation() {
    let temp = tempfile::tempdir().unwrap();
    let (router, _) = app(temp.path()).await;
    let report = create_report(&router, &[]).await;
    let path = report_path(&report);
    let manifest = Path::new(report["workspace"].as_str().unwrap()).join("report.json");
    let mut legacy: Value = serde_json::from_slice(&tokio::fs::read(&manifest).await.unwrap()).unwrap();
    legacy.as_object_mut().unwrap().remove("archived");
    tokio::fs::write(&manifest, serde_json::to_vec(&legacy).unwrap())
        .await
        .unwrap();
    assert_report_slice(&router, &report, Value::Null, false).await;

    post(&router, &format!("{path}/archive"), Value::Null).await;
    assert_report_slice(&router, &report, Value::Null, true).await;
    assert_archived(&router, &path).await;
    error(
        &router,
        Method::POST,
        &format!("{path}/conversation"),
        json!({"conversation":"missing"}),
        StatusCode::GONE,
        "CONVERSATION_ARCHIVED",
    )
    .await;
    post(&router, &format!("{path}/unarchive"), Value::Null).await;
    assert_report_slice(&router, &report, Value::Null, false).await;
    error(
        &router,
        Method::POST,
        &format!("{path}/conversation"),
        json!({"conversation":"missing"}),
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
    )
    .await;
    post(&router, &format!("{path}/archive"), Value::Null).await;
    let artifact = manifest.with_file_name("retained.pptx");
    tokio::fs::write(&artifact, b"retained export").await.unwrap();
    delete(&router, &path).await;
    assert_eq!(get(&router, "/api/paper-talk?archived=true").await, json!([]));
    assert!(!manifest.exists());
    assert_eq!(tokio::fs::read(artifact).await.unwrap(), b"retained export");
}
