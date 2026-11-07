use super::{deck, invalid, io};
use aionui_api_types::ApiResponse;
use aionui_common::ApiError;
use axum::{Json, extract::Path, http::header};
use serde_json::{Value, json};
use std::path::{Path as FilePath, PathBuf};
use tokio::fs;

const STYLES: &[(&str, &str)] = &[
    ("clean-professional", "清爽专业风"),
    ("scientific-defense", "科研答辩风"),
    ("handdrawn-technical", "手绘技术解释风"),
    ("creative-magazine", "创意杂志风"),
    ("e-ink-magazine", "电子墨水杂志风"),
    ("data-dashboard", "数据仪表盘风"),
    ("retro-flat-illustration", "复古扁平插画风"),
    ("handdrawn-whiteboard", "手绘白板风"),
    ("warm-handmade", "温暖手工风"),
    ("mckinsey-style", "麦肯锡风格"),
    ("teaching-courseware", "教学课件风"),
    ("party-government-red", "党政红风格"),
];
fn skill() -> PathBuf {
    PathBuf::from(deck::runtime()["design_skill"].as_str().unwrap())
        .parent()
        .unwrap()
        .to_path_buf()
}
pub(super) fn valid(id: &str) -> bool {
    ["international", "domestic"].contains(&id) || STYLES.iter().any(|(key, _)| *key == id)
}
pub(super) async fn catalog() -> Json<ApiResponse<Value>> {
    Json(ApiResponse::ok(json!(
        STYLES
            .iter()
            .map(|(id, name)| json!({
                "id": id, "name": name, "preview": format!("/api/paper-talk/styles/{id}/preview")
            }))
            .collect::<Vec<_>>()
    )))
}
pub(super) async fn preview(
    Path(id): Path<String>,
) -> Result<([(header::HeaderName, &'static str); 1], Vec<u8>), ApiError> {
    if !STYLES.iter().any(|(key, _)| *key == id) {
        return Err(invalid("Unknown style"));
    }
    let path = skill()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("assets/style-previews")
        .join(format!("{id}.png"));
    Ok(([(header::CONTENT_TYPE, "image/png")], fs::read(path).await.map_err(io)?))
}
pub(super) async fn write_selection(id: &str, workspace: &FilePath) -> Result<(), ApiError> {
    let catalog = STYLES
        .iter()
        .map(|(key, name)| json!({"id":key,"name":name}))
        .collect::<Vec<_>>();
    super::write_json(&workspace.join("styles.json"), &json!({"selected":id,"styles":catalog})).await?;
    if let Some((key, name)) = STYLES.iter().find(|(key, _)| *key == id) {
        let reference = fs::read_to_string(skill().join("references").join(format!("{name}.md")))
            .await
            .map_err(io)?;
        fs::write(
            workspace.join("selected-style.md"),
            format!("# Selected style: {key}\n\n{reference}"),
        )
        .await
        .map_err(io)?;
        let path = skill()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("assets/style-previews")
            .join(format!("{key}.png"));
        fs::copy(path, workspace.join("selected-style.png")).await.map_err(io)?;
    }
    Ok(())
}
