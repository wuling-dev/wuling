//! 仓库权限的唯一角色判定；管理员身份不提供仓库权限后门。
use serde::{Deserialize, Serialize};
use tokio_postgres::GenericClient;
use wuling_storage::Result;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Reader,
    Developer,
    Maintainer,
}
impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reader => "reader",
            Self::Developer => "developer",
            Self::Maintainer => "maintainer",
        }
    }
}

pub async fn role(db: &impl GenericClient, repo: i64, user: i64) -> Result<Option<Role>> {
    let row = db
        .query_opt(
            "SELECT CASE WHEN r.owner_id=u.id THEN 'maintainer' ELSE m.role END
         FROM repositories r JOIN users u ON u.id=$2 AND u.active
         LEFT JOIN repository_members m ON m.repo_id=r.id AND m.user_id=u.id WHERE r.id=$1",
            &[&repo, &user],
        )
        .await?;
    Ok(row.and_then(|r| match r.get::<_, Option<&str>>(0) {
        Some("reader") => Some(Role::Reader),
        Some("developer") => Some(Role::Developer),
        Some("maintainer") => Some(Role::Maintainer),
        _ => None,
    }))
}
