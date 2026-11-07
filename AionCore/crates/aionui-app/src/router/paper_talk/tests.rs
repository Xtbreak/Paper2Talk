use super::*;
use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use tempfile::tempdir;
use tower::ServiceExt;

async fn call(router: &Router, method: Method, path: &str, data: Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(data.to_string()))
        .unwrap();
    let response = router.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 4_000_000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
fn brief() -> Value {
    json!({"direction":"science","intent":"compare methods","count":3,"minutes":10,"region":"international","months":12,"strict_quartile":true,"style":"international","inputs":[]})
}

#[test]
fn slide_design_rejects_outside_annotations_and_misleading_axes() {
    let mut slide: Slide = serde_json::from_value(json!({
        "title":"Evidence","body":"Controlled comparison","notes":"Source notes","seconds":60,
        "table":[],"figure":"/figure.png","evidence":[{"paper":"p1","page":10,"label":"Table 3"}],
        "design":{"layout":"evidence","subtitle":"Same model and test set",
            "annotations":[{"label":"Rows","rect":[0.8,0.1,0.3,0.4]}],
            "metrics":[{"label":"DSC","unit":"0–1","baseline_label":"Point","baseline":0.65,"result_label":"Mask3","result":0.85,"axis_max":1.0,"decimals":2}]}
    })).unwrap();
    assert!(
        matches!(check_design(&slide), Err(ApiError::BadRequest(message)) if message == "Figure annotation must lie inside its source image")
    );
    slide.design.as_mut().unwrap().annotations[0].rect = [0.1, 0.2, 0.8, 0.3];
    assert!(check_design(&slide).is_ok());
    slide.design.as_mut().unwrap().metrics[0].axis_max = 0.7;
    assert!(
        matches!(check_design(&slide), Err(ApiError::BadRequest(message)) if message == "Metric values must fit a positive zero-based axis")
    );
    slide.design = None;
    assert!(check_design(&slide).is_ok());
}
#[tokio::test]
async fn snapshot_survives_source_removal_and_late_jobs_cannot_publish() {
    let tmp = tempdir().unwrap();
    let router = routes(tmp.path().join("reports"));
    let mut input = brief();
    let pdf = tmp.path().join("input.pdf");
    fs::write(&pdf, b"%PDF-1.7 fixture").await.unwrap();
    input["inputs"] = json!([pdf]);
    let (status, reply) = call(&router, Method::POST, "/api/paper-talk", input).await;
    assert_eq!(status, StatusCode::OK);
    let report = &reply["data"];
    let id = report["id"].as_str().unwrap();
    let url = format!("/api/paper-talk/{id}");
    let saved = report["brief"]["inputs"][0].as_str().unwrap();
    fs::remove_file(pdf).await.unwrap();
    assert_eq!(fs::read(saved).await.unwrap(), b"%PDF-1.7 fixture");
    let (status, first) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":1,"stage":"search","instruction":"first"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, next) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":2,"stage":"search","instruction":"changed"}),
    )
    .await;
    let old = &first["data"]["job"];
    let new = &next["data"]["job"];
    assert_ne!(old["workspace"], new["workspace"]);
    let (status, err) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs/{}/collect", old["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(err["code"], "CONFLICT");
    let (status, _) = call(&router, Method::POST, &format!("{url}/export"), json!({"revision":3})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
#[tokio::test]
async fn collection_separates_unverified_articles_and_records_clarifications() {
    let tmp = tempdir().unwrap();
    let router = routes(tmp.path().join("reports"));
    let (_, reply) = call(&router, Method::POST, "/api/paper-talk", brief()).await;
    let url = format!("/api/paper-talk/{}", reply["data"]["id"].as_str().unwrap());
    let (_, first) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":1,"stage":"search","instruction":"strict"}),
    )
    .await;
    let job = &first["data"]["job"];
    let dir = FsPath::new(job["workspace"].as_str().unwrap());
    let pdf = dir.join("research.pdf");
    fs::write(&pdf, b"%PDF-1.7 fixture").await.unwrap();
    write_json(&dir.join("result.json"),&json!({"answer":"Found one candidate","intent":"why","papers":[{"id":"p","title":"Paper","source":"https://example.org/p","journal":"J","date":"2026","finding":"A","role":"B","ranking":"待核验","version":"published","pdf":pdf}],"selected":["p"]})).await.unwrap();
    let (_, result) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs/{}/collect", job["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(result["data"]["selected"], json!([]));
    assert_eq!(result["data"]["papers"][0]["id"], "p");
    assert_eq!(result["data"]["turns"][0]["answer"], "Found one candidate");
    let (_, next) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":3,"stage":"revise","instruction":"keep both"}),
    )
    .await;
    let job = &next["data"]["job"];
    write_json(
        &FsPath::new(job["workspace"].as_str().unwrap()).join("result.json"),
        &json!({"choice":"Move a paper to backup?"}),
    )
    .await
    .unwrap();
    let (_, result) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs/{}/collect", job["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(result["data"]["turns"][1]["answer"], "Move a paper to backup?");
    assert!(result["data"]["job"].is_null());
    let mut relaxed = brief();
    relaxed["strict_quartile"] = json!(false);
    let (_, next) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":5,"stage":"revise","instruction":"Select p; allow conference papers"}),
    )
    .await;
    let job = &next["data"]["job"];
    write_json(
        &FsPath::new(job["workspace"].as_str().unwrap()).join("result.json"),
        &json!({"brief":relaxed,"selected":["p"],"answer":"Selected p"}),
    )
    .await
    .unwrap();
    let (status, selected) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs/{}/collect", job["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(selected["data"]["selected"], json!(["p"]));
    assert_eq!(selected["data"]["papers"], result["data"]["papers"]);
    assert_eq!(selected["data"]["turns"][2]["answer"], "Selected p");
    let (_, next) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":7,"stage":"revise","instruction":"Update the downloaded paper metadata"}),
    )
    .await;
    let job = &next["data"]["job"];
    let mut papers = selected["data"]["papers"].clone();
    papers[0]["version"] = json!("Verified author manuscript");
    write_json(
        &FsPath::new(job["workspace"].as_str().unwrap()).join("result.json"),
        &json!({"papers":papers,"selected":["p"],"summary":"Verified the PDF"}),
    )
    .await
    .unwrap();
    let (status, updated) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs/{}/collect", job["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["data"]["brief"]["intent"], selected["data"]["brief"]["intent"]);
    assert_eq!(updated["data"]["selected"], json!(["p"]));
    assert_eq!(updated["data"]["papers"], papers);
    assert_eq!(updated["data"]["turns"][3]["answer"], "Verified the PDF");
}

#[tokio::test]
async fn chat_export_requires_the_confirmed_current_revision_without_other_changes() {
    let tmp = tempdir().unwrap();
    let router = routes(tmp.path().join("reports"));
    let (_, reply) = call(&router, Method::POST, "/api/paper-talk", brief()).await;
    let url = format!("/api/paper-talk/{}", reply["data"]["id"].as_str().unwrap());
    let (_, started) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":1,"stage":"revise","instruction":"Confirm the outline and generate PPT"}),
    )
    .await;
    let mut report: Report = serde_json::from_value(started["data"].clone()).unwrap();
    let task = report.job.as_ref().unwrap().clone();
    let confirmation = json!({"export":true,"confirm_revision":report.revision});
    let request: Value = serde_json::from_slice(&fs::read(task.workspace.join("request.json")).await.unwrap()).unwrap();
    assert_eq!(request["revision"], report.revision);
    write_json(&task.workspace.join("result.json"), &confirmation)
        .await
        .unwrap();
    let (status, _) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs/{}/collect", task.id),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    report.outline_current = true;
    report.outline.push(Slide {
        title: "Research question".into(),
        body: "One finding".into(),
        notes: "Explain the finding".into(),
        seconds: 60,
        table: vec![],
        evidence: vec![],
        figure: None,
        design: None,
    });
    assert!(check_export_confirmation(&confirmation, &report, &task).is_ok());
    assert!(matches!(
        check_export_confirmation(
            &json!({"export":true,"confirm_revision":report.revision-1}),
            &report,
            &task
        ),
        Err(ApiError::Conflict(_))
    ));
    assert!(matches!(
        check_export_confirmation(
            &json!({"export":true,"confirm_revision":report.revision,"outline":[]}),
            &report,
            &task
        ),
        Err(ApiError::BadRequest(_))
    ));
    let mut search = task.clone();
    search.stage = Stage::Search;
    assert!(check_export_confirmation(&confirmation, &report, &search).is_err());
    assert!(
        check_export_confirmation(
            &json!({"export":false,"confirm_revision":report.revision}),
            &report,
            &task
        )
        .is_err()
    );
}

#[tokio::test]
async fn native_conversation_survives_intake_and_task_changes() {
    let tmp = tempdir().unwrap();
    let router = routes(tmp.path().join("reports"));
    let mut input = brief();
    input["direction"] = json!("");
    let (status, reply) = call(&router, Method::POST, "/api/paper-talk", input.clone()).await;
    assert_eq!(status, StatusCode::OK);
    let url = format!("/api/paper-talk/{}", reply["data"]["id"].as_str().unwrap());
    let workspace = FsPath::new(reply["data"]["workspace"].as_str().unwrap());
    let conversation = "7465919e";
    let (status, _) = call(
        &router,
        Method::POST,
        &format!("{url}/conversation"),
        json!({"conversation":conversation}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(
        &router,
        Method::POST,
        &format!("{url}/conversation"),
        json!({"conversation":Uuid::new_v4()}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":1,"stage":"search","instruction":"find"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, intake) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":1,"stage":"revise","instruction":"NLP, two papers"}),
    )
    .await;
    let job = &intake["data"]["job"];
    assert_eq!(job["conversation"], conversation);
    let active: Value = serde_json::from_slice(&fs::read(workspace.join("active-task.json")).await.unwrap()).unwrap();
    assert_eq!(active["workspace"], job["workspace"]);
    input["direction"] = json!("NLP");
    input["count"] = json!(2);
    write_json(
        &FsPath::new(job["workspace"].as_str().unwrap()).join("result.json"),
        &json!({"brief":input,"answer":"Find two papers?"}),
    )
    .await
    .unwrap();
    let (_, collected) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs/{}/collect", job["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(collected["data"]["brief"]["count"], 2);
    assert_eq!(collected["data"]["conversation"], conversation);
    let (_, next) = call(
        &router,
        Method::POST,
        &format!("{url}/jobs"),
        json!({"revision":3,"stage":"search","instruction":"yes"}),
    )
    .await;
    assert_eq!(next["data"]["job"]["conversation"], conversation);
    assert_ne!(next["data"]["job"]["workspace"], job["workspace"]);
}

#[cfg(unix)]
#[tokio::test]
async fn report_and_task_workspaces_resolve_symlinked_data_roots() {
    let tmp = tempdir().unwrap();
    let actual = tmp.path().join("actual");
    fs::create_dir(&actual).await.unwrap();
    let alias = tmp.path().join("alias");
    std::os::unix::fs::symlink(&actual, &alias).unwrap();
    let router = routes(alias);
    let (_, reply) = call(&router, Method::POST, "/api/paper-talk", brief()).await;
    let r = &reply["data"];
    let id = r["id"].as_str().unwrap();
    let expected = fs::canonicalize(actual.join(id)).await.unwrap();
    assert_eq!(r["workspace"], json!(expected));
    let (_, loaded) = call(&router, Method::GET, &format!("/api/paper-talk/{id}"), Value::Null).await;
    assert_eq!(loaded["data"]["workspace"], json!(expected));
    let (_, started) = call(
        &router,
        Method::POST,
        &format!("/api/paper-talk/{id}/jobs"),
        json!({"revision":1,"stage":"revise","instruction":"explain"}),
    )
    .await;
    let job = &started["data"]["job"];
    assert_eq!(job["workspace"], json!(expected.join(job["id"].as_str().unwrap())));
}

#[tokio::test]
async fn generation_requires_current_task_artifacts_instead_of_fixed_layout_export() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("job");
    fs::create_dir(&workspace).await.unwrap();
    let result = deck::artifact_paths(&json!({"export":true}), &workspace);
    assert!(matches!(result, Err(ApiError::BadRequest(message)) if message == "PPT generation artifacts are missing"));
    let outside = tmp.path().join("outside.pptx");
    fs::write(&outside, b"outside").await.unwrap();
    let result = deck::artifact_paths(
        &json!({"pipeline":{"design_deck":outside,"editable_deck":outside,"editable_run":workspace}}),
        &workspace,
    );
    assert!(
        matches!(result, Err(ApiError::BadRequest(message)) if message == "PPT artifacts must belong to the current task")
    );
}

#[tokio::test]
async fn selecting_an_existing_paper_and_outlining_it_is_atomic() {
    for strict in [false, true] {
        let tmp = tempdir().unwrap();
        let router = routes(tmp.path().to_path_buf());
        let mut input = brief();
        input["strict_quartile"] = json!(strict);
        let (_, reply) = call(&router, Method::POST, "/api/paper-talk", input).await;
        let mut report = reply["data"].clone();
        let id = report["id"].as_str().unwrap().to_owned();
        let dir = tmp.path().join(&id);
        let pdf = dir.join("paper.pdf");
        fs::write(&pdf, b"%PDF-1.7 fixture").await.unwrap();
        report["papers"] = json!([{"id":"p1","title":"Paper","source":"https://example.org/p","journal":"","date":"2026","finding":"Finding","role":"Main","ranking":"preprint","version":"preprint","pdf":pdf}]);
        write_json(&dir.join("report.json"), &report).await.unwrap();
        let url = format!("/api/paper-talk/{id}");
        let (_, started) = call(
            &router,
            Method::POST,
            &format!("{url}/jobs"),
            json!({"revision":1,"stage":"revise","instruction":"Use this paper and outline it"}),
        )
        .await;
        let job = &started["data"]["job"];
        write_json(&FsPath::new(job["workspace"].as_str().unwrap()).join("result.json"), &json!({"selected":["p1"],"outline":[{"title":"Discussion","body":"Next steps","notes":"Detailed explanation","seconds":60,"figure":null,"evidence":[{"paper":"p1","page":1,"label":"Abstract"}],"design":{"layout":"discussion","subtitle":"Implications","points":[{"title":"A","text":"A step"},{"title":"B","text":"B step"}]}}]})).await.unwrap();
        let (status, result) = call(
            &router,
            Method::POST,
            &format!("{url}/jobs/{}/collect", job["id"].as_str().unwrap()),
            Value::Null,
        )
        .await;
        if strict {
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert_eq!(
                result["error"],
                "Selected paper does not meet full-text and ranking requirements"
            );
            let (_, unchanged) = call(&router, Method::GET, &url, Value::Null).await;
            assert_eq!(unchanged["data"]["selected"], json!([]));
            assert_eq!(unchanged["data"]["outline"], json!([]));
        } else {
            assert_eq!(status, StatusCode::OK, "{result}");
            assert_eq!(result["data"]["selected"], json!(["p1"]));
            assert_eq!(result["data"]["outline_current"], true);
        }
    }
}

#[tokio::test]
async fn visual_cards_preserve_history_and_styles_reach_the_task() {
    let tmp = tempdir().unwrap();
    let router = routes(tmp.path().join("reports"));
    let (_, reply) = call(&router, Method::POST, "/api/paper-talk", brief()).await;
    let mut report: Report = serde_json::from_value(reply["data"].clone()).unwrap();
    record_card(&mut report, "papers");
    report.brief.direction = "Changed direction".into();
    assert_eq!(report.cards[0].brief.direction, "science");
    assert!(report.cards[0].created_at > 0);
    assert!(styles::valid("handdrawn-technical"));
    assert!(!styles::valid("../../secret"));
    styles::write_selection("handdrawn-technical", tmp.path()).await.unwrap();
    assert!(fs::read_to_string(tmp.path().join("selected-style.md")).await.unwrap().contains("手绘"));
    assert!(fs::read(tmp.path().join("selected-style.png")).await.unwrap().starts_with(b"\x89PNG"));
    let (status, catalog) = call(&router, Method::GET, "/api/paper-talk/styles", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(catalog["data"].as_array().unwrap().len(), 12);
}

#[tokio::test]
async fn style_choice_accepts_a_brief_with_summary_without_rebuilding_the_outline() {
    let tmp = tempdir().unwrap();
    let router = routes(tmp.path().join("reports"));
    let (_, created) = call(&router, Method::POST, "/api/paper-talk", brief()).await;
    let url = format!("/api/paper-talk/{}", created["data"]["id"].as_str().unwrap());
    let (_, started) = call(&router, Method::POST, &format!("{url}/jobs"), json!({"revision":1,"stage":"revise","instruction":"手绘技术解释风"})).await;
    let job = &started["data"]["job"];
    let mut chosen = brief();
    chosen["style"] = json!("handdrawn-technical");
    write_json(&PathBuf::from(job["workspace"].as_str().unwrap()).join("result.json"), &json!({"brief":chosen,"summary":"已选择手绘技术解释风"})).await.unwrap();
    let (status, saved) = call(&router, Method::POST, &format!("{url}/jobs/{}/collect", job["id"].as_str().unwrap()), Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["data"]["brief"]["style"], "handdrawn-technical");
    assert_eq!(saved["data"]["outline"], json!([]));
    assert!(saved["data"]["job"].is_null());
}
