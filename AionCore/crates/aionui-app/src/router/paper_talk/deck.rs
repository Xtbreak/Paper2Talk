use super::{
    invalid, io,
    model::{Report, inside},
};
use aionui_common::ApiError;
use aionui_runtime::Builder;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use tokio::fs;

pub(super) fn runtime() -> Value {
    let root = std::env::var_os("PAPER2TALK_SKILLS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .ancestors()
                .nth(4)
                .unwrap()
                .to_path_buf()
        });
    json!({
        "design_skill": root.join("codex-ppt-skill/skills/codex-ppt/SKILL.md"),
        "editable_skill": root.join("image-to-editable-ppt-skill/skills/image-to-editable-ppt/SKILL.md"),
        "editppt": root.join("image-to-editable-ppt-skill/output/.venv/bin/editppt"),
        "python": root.join("image-to-editable-ppt-skill/output/.venv/bin/python"),
        "assembly_python": root.join("codex-ppt-skill/output/.venv/bin/python"),
        "image_model": "gpt-image-2.5-flare",
        "image_backend": "codex-oauth"
    })
}

pub(super) fn artifact_paths(result: &Value, workspace: &Path) -> Result<(PathBuf, PathBuf, PathBuf), ApiError> {
    let artifact = result
        .get("pipeline")
        .ok_or_else(|| invalid("PPT generation artifacts are missing"))?;
    let get = |key: &str| -> Result<PathBuf, ApiError> {
        artifact
            .get(key)
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .ok_or_else(|| invalid(format!("Missing PPT artifact: {key}")))
    };
    let design = get("design_deck")?;
    let editable = get("editable_deck")?;
    let run = get("editable_run")?;
    if !inside(&design, workspace)
        || !inside(&editable, workspace)
        || !inside(&run.join("deck_manifest.json"), workspace)
    {
        return Err(invalid("PPT artifacts must belong to the current task"));
    }
    Ok((design, editable, run))
}

pub(super) async fn build(report: &Report, result: &Value, workspace: &Path, path: &Path) -> Result<(), ApiError> {
    let (design, editable, run) = artifact_paths(result, workspace)?;
    let validation: Value =
        serde_json::from_slice(&fs::read(run.join("final/validation.json")).await.map_err(io)?).map_err(invalid)?;
    if validation.get("passed").and_then(Value::as_bool) != Some(true) {
        return Err(invalid("Editable PPT validation has not passed"));
    }
    let manifest: Value =
        serde_json::from_slice(&fs::read(run.join("deck_manifest.json")).await.map_err(io)?).map_err(invalid)?;
    let output = manifest
        .get("output")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Editable run has no output"))?;
    if fs::canonicalize(run.join(output)).await.map_err(io)? != fs::canonicalize(&editable).await.map_err(io)? {
        return Err(invalid("Editable PPT does not match its run"));
    }
    let config = runtime();
    let python = config["python"].as_str().unwrap();
    let script = workspace.join("publish_deck.py");
    fs::write(&script, include_bytes!("paper-skills/publish_deck.py"))
        .await
        .map_err(io)?;
    let request = workspace.join("publish-request.json");
    super::write_json(&request, &json!({"outline":report.outline,"papers":report.papers})).await?;
    let mut command = Builder::new(python);
    command
        .arg(script)
        .arg("--request")
        .arg(request)
        .arg("--design")
        .arg(design)
        .arg("--editable")
        .arg(editable)
        .arg("--output")
        .arg(path);
    let output = command.output().await.map_err(io)?;
    if !output.status.success() {
        return Err(invalid(format!(
            "PPT publication failed: {}",
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .rev()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("PPT validator exited without an error message")
        )));
    }
    Ok(())
}

pub(super) async fn preview(path: &Path, page: usize) -> Result<Vec<u8>, ApiError> {
    let cli = aionui_office::resolve_officecli_path().ok_or_else(|| invalid("officecli missing"))?;
    let mut render = Builder::new(cli);
    render
        .arg("view")
        .arg(path)
        .args(["svg", "--page"])
        .arg(page.to_string());
    let output = render.output().await.map_err(io)?;
    if !output.status.success() || !output.stdout.starts_with(b"<svg") {
        return Err(invalid("Could not render slide preview"));
    }
    Ok(output.stdout)
}
