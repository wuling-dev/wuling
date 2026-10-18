//! Wire models: these exact types are serialized by handlers and exported to OpenAPI.
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct ApiError {
    pub error: String,
}

#[derive(Serialize, ToSchema)]
pub struct Health {
    pub status: String,
}

#[derive(Serialize, ToSchema)]
pub struct Account {
    pub id: i64,
    pub username: String,
    pub admin: bool,
    pub active: bool,
}

impl From<wuling_storage::identity::User> for Account {
    fn from(user: wuling_storage::identity::User) -> Self {
        Self {
            id: user.id,
            username: user.username,
            admin: user.admin,
            active: user.active,
        }
    }
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct Repository {
    pub id: i64,
    pub owner_id: i64,
    pub name: String,
    pub description: String,
    pub public: bool,
    #[schema(format = DateTime)]
    pub created_at: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct HistoricalItem {
    pub id: i64,
    pub repo_id: i64,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub state: String,
    pub source: Option<String>,
    pub target: Option<String>,
    pub author_id: Option<i64>,
    pub author_origin: String,
    #[schema(format = DateTime)]
    pub imported_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct Blob {
    pub content: String,
}

#[derive(Serialize, ToSchema)]
pub struct Insight {
    pub open_issues: i64,
    pub open_merge_requests: i64,
    pub pipelines_success: i64,
    pub pipelines_failed: i64,
    pub wiki_pages: i64,
    pub historical_import: bool,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TokenScope {
    Read,
    Write,
}

#[derive(Serialize, ToSchema)]
pub struct PersonalToken {
    pub id: i64,
    pub name: String,
    pub scope: TokenScope,
    /// Unix seconds, not milliseconds.
    pub expires_at: i64,
}

#[derive(Serialize, ToSchema)]
pub struct IssuedToken {
    #[serde(flatten)]
    pub metadata: PersonalToken,
    /// Only returned once. Never log or persist this response in browser storage.
    pub token: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum MemberRole {
    Reader,
    Developer,
    Maintainer,
}

impl From<MemberRole> for iam::repository::Role {
    fn from(role: MemberRole) -> Self {
        match role {
            MemberRole::Reader => Self::Reader,
            MemberRole::Developer => Self::Developer,
            MemberRole::Maintainer => Self::Maintainer,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct Member {
    pub user_id: i64,
    pub username: String,
    pub active: bool,
    pub role: MemberRole,
    pub owner: bool,
}
