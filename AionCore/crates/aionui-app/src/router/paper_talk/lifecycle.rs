use super::{invalid, io, model::*, write_json};
use aionui_api_types::ApiResponse;
use aionui_auth::CurrentUser;
use aionui_common::ApiError;
use aionui_conversation::ConversationService;
use aionui_db::{ArchiveScope, IConversationRepository};
use aionui_sidebar::{SidebarError, SidebarService};
use axum::{
    Extension, Json,
    extract::{Path, Query, State, rejection::QueryRejection},
};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::{fs, sync::Mutex};
use uuid::Uuid;

#[derive(Clone)]
pub(super) struct Store {
    pub(super) root: PathBuf,
    pub(super) gate: Arc<Mutex<()>>,
    sidebar: Arc<SidebarService>,
    conversations: ConversationService,
    conversation_repo: Arc<dyn IConversationRepository>,
}

type ActionResponse = Result<Json<ApiResponse<()>>, ApiError>;

fn report_not_found() -> ApiError {
    ApiError::NotFound("Report not found".into())
}

fn storage_error(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(%error, "paper talk conversation lookup or lifecycle operation failed");
    ApiError::Internal("Report history is unavailable".into())
}

fn sidebar_error(error: SidebarError) -> ApiError {
    match error {
        SidebarError::ScopeGone => report_not_found(),
        _ => storage_error(error),
    }
}

fn archive_scope(archived: bool) -> ArchiveScope {
    if archived {
        ArchiveScope::Archived
    } else {
        ArchiveScope::Active
    }
}

impl Store {
    pub(super) fn new(
        root: PathBuf,
        sidebar: Arc<SidebarService>,
        conversations: ConversationService,
        conversation_repo: Arc<dyn IConversationRepository>,
    ) -> Self {
        Self {
            root,
            gate: Default::default(),
            sidebar,
            conversations,
            conversation_repo,
        }
    }

    pub(super) fn dir(&self, id: Uuid) -> PathBuf {
        self.root.join(id.to_string())
    }

    async fn load(&self, id: Uuid) -> Result<Report, ApiError> {
        let dir = self.dir(id);
        let bytes = fs::read(dir.join("report.json")).await.map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                report_not_found()
            } else {
                io(err)
            }
        })?;
        let mut report: Report = serde_json::from_slice(&bytes).map_err(invalid)?;
        report.workspace = fs::canonicalize(dir).await.map_err(io)?;
        Ok(report)
    }

    async fn linked_scope(&self, user_id: &str, id: &str) -> Result<ArchiveScope, ApiError> {
        self.sidebar
            .conversation_archive_scopes(user_id, &[id])
            .await
            .map_err(sidebar_error)?
            .into_iter()
            .next()
            .map(|(_, scope)| scope)
            .ok_or_else(report_not_found)
    }

    pub(super) async fn ensure_active(&self, user_id: &str, report: &Report) -> Result<(), ApiError> {
        let scope = match &report.conversation {
            Some(id) => self.linked_scope(user_id, id).await?,
            None => archive_scope(report.archived),
        };
        if scope == ArchiveScope::Archived {
            return Err(ApiError::ConversationArchived(
                "Restore this report before opening it".into(),
            ));
        }
        Ok(())
    }

    pub(super) async fn load_active(&self, user_id: &str, id: Uuid) -> Result<Report, ApiError> {
        let report = self.load(id).await?;
        self.ensure_active(user_id, &report).await?;
        Ok(report)
    }

    pub(super) async fn save(&self, report: Report) -> super::Response {
        write_json(
            &self
                .dir(Uuid::parse_str(&report.id).map_err(invalid)?)
                .join("report.json"),
            &report,
        )
        .await?;
        Ok(Json(ApiResponse::ok(report)))
    }

    pub(super) async fn save_active(&self, user_id: &str, report: Report) -> super::Response {
        self.ensure_active(user_id, &report).await?;
        self.save(report).await
    }

    pub(super) async fn check_binding(&self, user_id: &str, id: &str, report: &Report) -> Result<(), ApiError> {
        let conversation = self
            .conversation_repo
            .get(user_id, id)
            .await
            .map_err(storage_error)?
            .ok_or_else(report_not_found)?;
        // Only the chat created for this report may acquire its lifecycle controls.
        let extra: serde_json::Value = serde_json::from_str(&conversation.extra).map_err(storage_error)?;
        if extra.get("paper_talk_report_id").and_then(|id| id.as_str()) != Some(report.id.as_str()) {
            return Err(ApiError::Conflict("Conversation does not belong to this report".into()));
        }
        Ok(())
    }
}

pub(super) async fn list(
    State(store): State<Store>,
    Extension(user): Extension<CurrentUser>,
    query: Result<Query<HistoryQuery>, QueryRejection>,
) -> Result<Json<ApiResponse<Vec<HistoryRow>>>, ApiError> {
    let Query(query) = query.map_err(|_| invalid("Invalid report history query"))?;
    let expected = archive_scope(query.archived);
    let _guard = store.gate.lock().await;
    fs::create_dir_all(&store.root).await.map_err(io)?;
    let mut entries = fs::read_dir(&store.root).await.map_err(io)?;
    let mut reports = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(io)? {
        let Ok(id) = Uuid::parse_str(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        let modified = match fs::metadata(entry.path().join("report.json")).await {
            Ok(metadata) => metadata.modified().map_err(io)?,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => return Err(io(err)),
        };
        reports.push((modified, store.load(id).await?));
    }
    let ids: Vec<&str> = reports
        .iter()
        .filter_map(|(_, report)| report.conversation.as_deref())
        .collect();
    let scopes: HashMap<_, _> = store
        .sidebar
        .conversation_archive_scopes(&user.id, &ids)
        .await
        .map_err(sidebar_error)?
        .into_iter()
        .collect();
    reports.sort_by_key(|(time, _)| std::cmp::Reverse(*time));
    let rows = reports
        .into_iter()
        .filter_map(|(_, report)| {
            let scope = match &report.conversation {
                Some(id) => *scopes.get(id)?,
                None => archive_scope(report.archived),
            };
            (scope == expected).then_some(HistoryRow {
                id: report.id,
                direction: report.brief.direction,
                conversation: report.conversation,
            })
        })
        .collect();
    Ok(Json(ApiResponse::ok(rows)))
}

pub(super) async fn archive(
    State(store): State<Store>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> ActionResponse {
    set_archived(store, &user.id, id, true).await
}

pub(super) async fn unarchive(
    State(store): State<Store>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> ActionResponse {
    set_archived(store, &user.id, id, false).await
}

async fn set_archived(store: Store, user_id: &str, id: Uuid, archived: bool) -> ActionResponse {
    let _guard = store.gate.lock().await;
    let mut report = store.load(id).await?;
    if let Some(conversation) = report.conversation {
        let sidebar = &store.sidebar;
        if archived {
            sidebar.archive_conversation(user_id, &conversation).await
        } else {
            sidebar.unarchive_conversation(user_id, &conversation).await
        }
        .map_err(sidebar_error)?;
    } else if report.archived != archived {
        report.archived = archived;
        let _ = store.save(report).await?;
    }
    Ok(Json(ApiResponse::success()))
}

pub(super) async fn delete(
    State(store): State<Store>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<Uuid>,
) -> ActionResponse {
    let _guard = store.gate.lock().await;
    let report = store.load(id).await?;
    if let Some(conversation) = &report.conversation {
        store
            .conversations
            .delete(&user.id, conversation)
            .await
            .map_err(ApiError::from)?;
    }

    // Unlink the report record atomically. The workspace can contain files that
    // users still need or that other conversations still reference.
    let directory = store.dir(id);
    let unlinked = match fs::symlink_metadata(&directory).await {
        Ok(metadata) if metadata.is_dir() => fs::remove_file(directory.join("report.json")).await.map_err(io),
        Ok(_) => Err(ApiError::Conflict(
            "Report workspace is not an application directory".into(),
        )),
        Err(error) => Err(io(error)),
    };
    if let Err(error) = unlinked {
        if report.conversation.is_some() {
            // The linked conversation already committed its deletion.
            tracing::warn!(report_id = %id, %error, "Failed to unlink deleted report manifest");
        } else {
            return Err(error);
        }
    }
    Ok(Json(ApiResponse::success()))
}
