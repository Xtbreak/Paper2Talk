mod deck;
mod import;
mod model;
mod styles;

use aionui_api_types::ApiResponse;
use aionui_common::ApiError;
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use model::*;
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};
use tokio::{fs, sync::Mutex};
use uuid::Uuid;

#[derive(Clone)]
struct Store {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
}
type Response = Result<Json<ApiResponse<Report>>, ApiError>;

pub(super) fn routes(root: PathBuf) -> Router {
    Router::new()
        .route("/api/paper-talk", get(list).post(create))
        .route("/api/paper-talk/styles", get(styles::catalog))
        .route("/api/paper-talk/styles/{style}/preview", get(styles::preview))
        .route("/api/paper-talk/{id}", get(get_report).put(edit))
        .route("/api/paper-talk/{id}/conversation", post(bind_conversation))
        .route("/api/paper-talk/{id}/jobs", post(start))
        .route("/api/paper-talk/{id}/jobs/{job}/bind", post(bind))
        .route("/api/paper-talk/{id}/jobs/{job}/collect", post(collect))
        .route("/api/paper-talk/{id}/export", post(export))
        .route("/api/paper-talk/{id}/preview/{revision}/{page}", get(slide_preview))
        .with_state(Store {
            root,
            gate: Default::default(),
        })
}

fn invalid(e: impl std::fmt::Display) -> ApiError {
    ApiError::BadRequest(e.to_string())
}
fn io(e: std::io::Error) -> ApiError {
    if e.kind() == std::io::ErrorKind::NotFound {
        ApiError::NotFound(e.to_string())
    } else {
        tracing::error!(error=%e,"paper talk storage operation failed");
        ApiError::Internal(e.to_string())
    }
}
async fn write_json(path: &FsPath, value: &impl Serialize) -> Result<(), ApiError> {
    let bytes = serde_json::to_vec_pretty(value).map_err(invalid)?;
    let tmp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    fs::write(&tmp, bytes).await.map_err(io)?;
    fs::rename(tmp, path).await.map_err(io)
}
impl Store {
    fn dir(&self, id: Uuid) -> PathBuf {
        self.root.join(id.to_string())
    }
    async fn load(&self, id: Uuid) -> Result<Report, ApiError> {
        let mut report: Report =
            serde_json::from_slice(&fs::read(self.dir(id).join("report.json")).await.map_err(io)?).map_err(invalid)?;
        report.workspace = fs::canonicalize(self.dir(id)).await.map_err(io)?;
        Ok(report)
    }
    async fn save(&self, r: Report) -> Response {
        write_json(
            &self.dir(Uuid::parse_str(&r.id).map_err(invalid)?).join("report.json"),
            &r,
        )
        .await?;
        Ok(Json(ApiResponse::ok(r)))
    }
}
async fn list(State(s): State<Store>) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    fs::create_dir_all(&s.root).await.map_err(io)?;
    let mut entries = fs::read_dir(&s.root).await.map_err(io)?;
    let mut rows = vec![];
    while let Some(entry) = entries.next_entry().await.map_err(io)? {
        if let Ok(id) = Uuid::parse_str(&entry.file_name().to_string_lossy()) {
            if fs::try_exists(entry.path().join("report.json")).await.map_err(io)? {
                let r = s.load(id).await?;
                let modified = entry
                    .path()
                    .join("report.json")
                    .metadata()
                    .and_then(|m| m.modified())
                    .map_err(io)?;
                rows.push((
                    modified,
                    json!({"id":id,"direction":r.brief.direction,"conversation":r.conversation}),
                ));
            }
        }
    }
    rows.sort_by_key(|(time, _)| std::cmp::Reverse(*time));
    Ok(Json(ApiResponse::ok(rows.into_iter().map(|(_, r)| r).collect())))
}
async fn create(State(s): State<Store>, Json(mut brief): Json<Brief>) -> Response {
    check_brief(&brief)?;
    let id = Uuid::new_v4();
    fs::create_dir_all(s.dir(id)).await.map_err(io)?;
    import::snapshot(&mut brief, &s.dir(id)).await?;
    s.save(Report {
        id: id.to_string(),
        workspace: fs::canonicalize(s.dir(id)).await.map_err(io)?,
        conversation: None,
        revision: 1,
        brief,
        papers: vec![],
        selected: vec![],
        outline: vec![],
        outline_current: false,
        deck: None,
        published: None,
        job: None,
        turns: Vec::new(),
        cards: Vec::new(),
    })
    .await
}
async fn get_report(State(s): State<Store>, Path(id): Path<Uuid>) -> Response {
    Ok(Json(ApiResponse::ok(s.load(id).await?)))
}
async fn bind_conversation(State(s): State<Store>, Path(id): Path<Uuid>, Json(b): Json<Binding>) -> Response {
    if b.conversation.is_empty()
        || b.conversation.len() > 128
        || !b
            .conversation
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(invalid("Invalid conversation identity"));
    }
    let _guard = s.gate.lock().await;
    let mut r = s.load(id).await?;
    if r.conversation
        .as_ref()
        .is_some_and(|existing| existing != &b.conversation)
    {
        return Err(ApiError::Conflict("Report already belongs to a conversation".into()));
    }
    r.conversation = Some(b.conversation);
    s.save(r).await
}
fn revision(r: &Report, expected: u64) -> Result<(), ApiError> {
    if r.revision != expected {
        return Err(ApiError::Conflict("Report was updated; reload latest revision".into()));
    }
    Ok(())
}

async fn edit(State(s): State<Store>, Path(id): Path<Uuid>, Json(mut e): Json<Edit>) -> Response {
    let _guard = s.gate.lock().await;
    let mut r = s.load(id).await?;
    revision(&r, e.revision)?;
    check_brief(&e.brief)?;
    import::snapshot(&mut e.brief, &s.dir(id)).await?;
    if e.selected.iter().collect::<HashSet<_>>().len() != e.selected.len()
        || e.selected.iter().any(|id| !r.papers.iter().any(|p| &p.id == id))
    {
        return Err(invalid("Unknown or duplicate paper"));
    }
    let mut old = r.brief.clone();
    old.style = e.brief.style.clone();
    let changed = old != e.brief || r.selected != e.selected;
    remember_export(&mut r);
    r.selected = e.selected;
    if changed {
        r.outline_current = false;
    } else if !e.outline.is_empty() && r.outline_current {
        check_outline(&e.outline, &r, &s.dir(id))?;
    }
    r.brief = e.brief;
    r.outline = e.outline;
    r.deck = None;
    r.job = None;
    r.revision += 1;
    s.save(r).await
}

async fn start(State(s): State<Store>, Path(id): Path<Uuid>, Json(req): Json<Start>) -> Response {
    let _guard = s.gate.lock().await;
    let mut r = s.load(id).await?;
    revision(&r, req.revision)?;
    if req.stage == Stage::Search && r.brief.direction.trim().is_empty() {
        return Err(invalid("Provide a research direction first"));
    }
    if req.stage == Stage::Outline && r.selected.is_empty() {
        return Err(invalid("Select papers first"));
    }
    let job = Uuid::new_v4();
    let workspace = s.dir(id).join(job.to_string());
    fs::create_dir(&workspace).await.map_err(io)?;
    let workspace = fs::canonicalize(workspace).await.map_err(io)?;
    write_json(&workspace.join("request.json"),&json!({"revision":r.revision+1,"outline_current":r.outline_current,"brief":r.brief,"papers":r.papers,"selected":r.selected,"outline":r.outline,"instruction":req.instruction,"turns":r.turns,"files":req.files})).await?;
    fs::write(
        workspace.join("pdf_snap.py"),
        include_bytes!("paper-skills/pdf_snap.py"),
    )
    .await
    .map_err(io)?;
    if req.stage != Stage::Search {
        fs::write(
            workspace.join("approved-style.png"),
            include_bytes!("paper-skills/approved-style.png"),
        )
        .await
        .map_err(io)?;
        fs::write(
            workspace.join("approved-style.md"),
            include_str!("paper-skills/approved-style.md"),
        )
        .await
        .map_err(io)?;
        fs::write(
            workspace.join("slide-guide.md"),
            include_str!("paper-skills/academic-slide-distillation.md"),
        )
        .await
        .map_err(io)?;
    }
    fs::write(workspace.join("generate.md"), include_str!("paper-skills/generate.md"))
        .await
        .map_err(io)?;
    write_json(&workspace.join("pipeline.json"), &deck::runtime()).await?;
    let instructions = match req.stage {
        Stage::Search => include_str!("search.md"),
        Stage::Outline => include_str!("outline.md"),
        Stage::Revise => include_str!("revise.md"),
    };
    if req.stage == Stage::Revise {
        fs::write(workspace.join("search.md"), include_str!("search.md"))
            .await
            .map_err(io)?;
        fs::write(workspace.join("outline.md"), include_str!("outline.md"))
            .await
            .map_err(io)?;
    }
    fs::write(
        workspace.join("task.md"),
        format!(
            "对话面向研究生。过程提示只说明正在检索论文、阅读原文、整理大纲、设计页面或生成可编辑 PPT，每次一两句话，不宣告技能名称，不展示内部文件、配置和执行命令。需要用户处理的错误或确认必须明确说明。\n\n{instructions}"
        ),
    )
    .await
    .map_err(io)?;
    write_json(
        &s.dir(id).join("active-task.json"),
        &json!({"id":job,"workspace":workspace}),
    )
    .await?;
    styles::write_selection(&r.brief.style, &workspace).await?;
    r.revision += 1;
    r.job = Some(Job {
        id: job.to_string(),
        stage: req.stage,
        workspace,
        conversation: r.conversation.clone(),
        instruction: req.instruction,
    });
    s.save(r).await
}
fn current(r: &Report, id: Uuid) -> Result<&Job, ApiError> {
    r.job
        .as_ref()
        .filter(|j| j.id == id.to_string())
        .ok_or_else(|| ApiError::Conflict("Superseded task".into()))
}

async fn bind(State(s): State<Store>, Path((id, job)): Path<(Uuid, Uuid)>, Json(b): Json<Binding>) -> Response {
    let _guard = s.gate.lock().await;
    let mut r = s.load(id).await?;
    if current(&r, job)?
        .conversation
        .as_ref()
        .is_some_and(|v| v != &b.conversation)
    {
        return Err(ApiError::Conflict("Task already bound".into()));
    }
    if let Some(j) = r.job.as_mut() {
        j.conversation = Some(b.conversation);
    }
    s.save(r).await
}

async fn collect(State(s): State<Store>, Path((id, job)): Path<(Uuid, Uuid)>) -> Response {
    let guard = s.gate.lock().await;
    let mut r = s.load(id).await?;
    let task = current(&r, job)?.clone();
    let file = task.workspace.join("result.json");
    if !fs::try_exists(&file).await.map_err(io)? {
        return Ok(Json(ApiResponse::ok(r)));
    }
    if !inside(&file, &task.workspace) || fs::metadata(&file).await.map_err(io)?.len() > 4_000_000 {
        return Err(invalid("Invalid task output"));
    }
    let mut result: Value = serde_json::from_slice(&fs::read(file).await.map_err(io)?).map_err(invalid)?;
    if result.get("export").is_some() {
        check_export_confirmation(&result, &r, &task)?;
        drop(guard);
        return publish_deck(s, id, r, task, &result).await;
    }
    let request_text = task.instruction.clone();
    let previous_style = r.brief.style.clone();
    if let Some(brief) = result.get("brief") {
        let mut brief: Brief = serde_json::from_value(brief.clone()).map_err(invalid)?;
        check_brief(&brief)?;
        import::snapshot(&mut brief, &s.dir(id)).await?;
        if brief != r.brief {
            remember_export(&mut r);
            let mut prior = r.brief.clone();
            prior.style = brief.style.clone();
            if prior != brief {
                r.outline_current = false;
            }
            r.deck = None;
            r.brief = brief;
        }
    }
    let changes_material = ["papers", "selected", "outline"]
        .iter()
        .any(|key| result.get(key).is_some());
    if let Some(answer) = result
        .get("choice")
        .or_else(|| {
            (!changes_material)
                .then(|| result.get("answer").or_else(|| result.get("summary")))
                .flatten()
        })
        .and_then(Value::as_str)
    {
        r.turns.push(Turn {
            user: request_text,
            answer: answer.to_string(),
        });
        r.revision += 1;
        r.job = None;
        if previous_style != r.brief.style && !r.outline.is_empty() && r.outline_current {
            record_card(&mut r, "outline");
        }
        return s.save(r).await;
    }
    if result.get("selected").is_some() && result.get("papers").is_none() && result.get("outline").is_none() {
        result["papers"] = serde_json::to_value(&r.papers).map_err(invalid)?;
    }
    if result.get("papers").is_some() && result.get("intent").is_none() {
        result["intent"] = json!(r.brief.intent);
    }
    let stage = if task.stage == Stage::Revise {
        match (result.get("papers"), result.get("outline")) {
            (Some(_), None) => Stage::Search,
            (None, Some(_)) => Stage::Outline,
            _ => return Err(invalid("Expected one report update")),
        }
    } else {
        task.stage.clone()
    };
    if let Some(minutes) = result.get("minutes") {
        r.brief.minutes = minutes
            .as_u64()
            .and_then(|n| u16::try_from(n).ok())
            .filter(|n| (1..=180).contains(n))
            .ok_or_else(|| invalid("Invalid duration"))?;
    }
    if let Some(count) = result.get("count") {
        r.brief.count = count
            .as_u64()
            .and_then(|n| u16::try_from(n).ok())
            .filter(|n| (1..=20).contains(n))
            .ok_or_else(|| invalid("Invalid paper count"))?;
    }
    let summary = result
        .get("summary")
        .or_else(|| result.get("answer"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    remember_export(&mut r);
    let answer = match stage {
        Stage::Search => {
            let mut sel: Selection = serde_json::from_value(result).map_err(invalid)?;
            let ids: HashSet<_> = sel.papers.iter().map(|p| &p.id).collect();
            if ids.len() != sel.papers.len() || sel.selected.iter().any(|id| !ids.contains(id)) {
                return Err(invalid("Invalid paper identity"));
            }
            for p in &sel.papers {
                if let Some(file) = &p.pdf {
                    if !(inside(file, &s.dir(id)) || r.brief.inputs.contains(file))
                        || !file.is_file()
                        || !file.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
                    {
                        return Err(invalid(format!("Invalid PDF: {}", p.title)));
                    }
                    use tokio::io::AsyncReadExt;
                    let mut signature = [0u8; 5];
                    fs::File::open(file)
                        .await
                        .map_err(io)?
                        .read_exact(&mut signature)
                        .await
                        .map_err(io)?;
                    if &signature != b"%PDF-" {
                        return Err(invalid(format!("Not a PDF: {}", p.title)));
                    }
                }
            }
            let mut seen = HashSet::new();
            sel.selected.retain(|id| {
                let paper = sel
                    .papers
                    .iter()
                    .find(|paper| &paper.id == id)
                    .expect("validated identity");
                seen.insert(id.clone())
                    && paper.pdf.as_ref().is_some_and(|file| {
                        r.brief.inputs.contains(file)
                            || !r.brief.strict_quartile
                            || (paper.ranking_source.starts_with("https://")
                                && (paper.ranking.contains("Q1") || paper.ranking.contains("Q2"))
                                && paper.ranking.contains("SCIE"))
                    })
            });
            r.brief.intent = sel.intent;
            r.papers = sel.papers;
            r.selected = sel.selected;
            r.outline_current = false;
            r.brief.intent.clone()
        }
        Stage::Outline => {
            if let Some(value) = result.get("selected") {
                let selected: Vec<String> = serde_json::from_value(value.clone()).map_err(invalid)?;
                if selected.is_empty() || selected.iter().collect::<HashSet<_>>().len() != selected.len() {
                    return Err(invalid("Unknown or duplicate paper"));
                }
                for selected_id in &selected {
                    let paper = r
                        .papers
                        .iter()
                        .find(|paper| &paper.id == selected_id)
                        .ok_or_else(|| invalid("Unknown or duplicate paper"))?;
                    if !paper.pdf.as_ref().is_some_and(|file| {
                        file.is_file()
                            && (r.brief.inputs.contains(file)
                                || (!r.brief.strict_quartile
                                    || (paper.ranking_source.starts_with("https://")
                                        && (paper.ranking.contains("Q1") || paper.ranking.contains("Q2"))
                                        && paper.ranking.contains("SCIE"))))
                    }) {
                        return Err(invalid(
                            "Selected paper does not meet full-text and ranking requirements",
                        ));
                    }
                }
                r.selected = selected;
            }
            let outline: Vec<Slide> = serde_json::from_value(result["outline"].clone()).map_err(invalid)?;
            if outline.iter().any(|slide| slide.design.is_none()) {
                return Err(invalid(
                    "Each generated slide needs the design defined in approved-style.md",
                ));
            }
            check_outline(&outline, &r, &s.dir(id))?;
            r.outline = outline;
            r.outline_current = true;
            format!("{} 页 · {} 分钟", r.outline.len(), r.brief.minutes)
        }
        Stage::Revise => unreachable!(),
    };
    r.turns.push(Turn {
        user: request_text,
        answer: summary.unwrap_or(answer),
    });
    r.revision += 1;
    r.job = None;
    r.deck = None;
    let kind = if r.outline_current && !r.outline.is_empty() {
        "outline"
    } else {
        "papers"
    };
    record_card(&mut r, kind);
    s.save(r).await
}

async fn export(State(s): State<Store>, Path(id): Path<Uuid>, Json(req): Json<Confirm>) -> Response {
    let r = s.load(id).await?;
    revision(&r, req.revision)?;
    if r.job.is_some() || !r.outline_current {
        return Err(invalid("Confirm the current outline first"));
    }
    Err(invalid("请在聊天中确认当前大纲并生成 PPT"))
}

async fn publish_deck(s: Store, id: Uuid, r: Report, task: Job, result: &Value) -> Response {
    check_outline(&r.outline, &r, &s.dir(id))?;
    tracing::info!(report_id = %id, revision = r.revision, via_chat = true, "paper talk export started");
    let path = s.dir(id).join(format!("Paper2Talk-{}.pptx", Uuid::new_v4()));
    deck::build(&r, result, &task.workspace, &path).await?;
    let _guard = s.gate.lock().await;
    let mut latest = s.load(id).await?;
    revision(&latest, r.revision)?;
    {
        current(&latest, Uuid::parse_str(&task.id).map_err(invalid)?)?;
        latest.job = None;
        latest.turns.push(Turn {
            user: task.instruction,
            answer: format!("PPT 已生成，共 {} 页，可在右侧预览。", latest.outline.len()),
        });
    }
    latest.deck = Some(path);
    latest.revision += 1;
    latest.published = None;
    remember_export(&mut latest);
    record_card(&mut latest, "deck");
    tracing::info!(report_id = %id, revision = latest.revision, "paper talk export published");
    s.save(latest).await
}

fn record_card(report: &mut Report, kind: &str) {
    if kind == "outline" {
        if let Some(previous) = report.cards.last_mut().filter(|card| card.kind == "papers") {
            previous.selected = report
                .selected
                .iter()
                .filter(|id| previous.papers.iter().any(|paper| &paper.id == *id))
                .cloned()
                .collect();
        }
    }
    report.cards.push(ChoiceCard {
        id: Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        revision: report.revision,
        kind: kind.into(),
        brief: report.brief.clone(),
        papers: report.papers.clone(),
        selected: report.selected.clone(),
        outline: report.outline.clone(),
        deck: report.deck.clone(),
    });
}

fn remember_export(r: &mut Report) {
    let Some(path) = &r.deck else { return };
    if let Some(published) = &mut r.published {
        if published.papers.is_empty() && published.path == *path {
            published.papers.clone_from(&r.papers);
        }
    } else {
        r.published = Some(Published {
            path: path.clone(),
            revision: r.revision,
            slides: r.outline.clone(),
            papers: r.papers.clone(),
        });
    }
}

async fn slide_preview(
    State(s): State<Store>,
    Path((id, version, page)): Path<(Uuid, u64, usize)>,
) -> Result<impl axum::response::IntoResponse, ApiError> {
    let r = s.load(id).await?;
    let (path, page_count) = if let Some(old) = r.published.as_ref().filter(|p| p.revision == version) {
        (old.path.clone(), old.slides.len())
    } else if let Some(card) = r
        .cards
        .iter()
        .find(|card| card.revision == version && card.deck.is_some())
    {
        (card.deck.clone().unwrap(), card.outline.len())
    } else {
        revision(&r, version)?;
        (
            r.deck
                .ok_or_else(|| ApiError::NotFound("Report has no exported deck".into()))?,
            r.outline.len(),
        )
    };
    if page == 0 || page > page_count {
        return Err(invalid("Slide number outside range"));
    }
    if !inside(&path, &s.dir(id)) {
        return Err(invalid("Export is missing"));
    }
    let cache = path.with_extension(format!("slide-{page}.svg"));
    let bytes = if fs::try_exists(&cache).await.map_err(io)? {
        fs::read(&cache).await.map_err(io)?
    } else {
        let bytes = deck::preview(&path, page).await?;
        let tmp = cache.with_extension(format!("{}.tmp", Uuid::new_v4()));
        fs::write(&tmp, &bytes).await.map_err(io)?;
        fs::rename(tmp, cache).await.map_err(io)?;
        bytes
    };
    Ok((
        [
            ("Content-Type", "image/svg+xml"),
            ("X-Content-Type-Options", "nosniff"),
            ("Cache-Control", "private, max-age=86400"),
        ],
        bytes,
    ))
}

#[cfg(test)]
mod tests;
