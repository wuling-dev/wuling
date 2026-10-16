use super::Result;
use serde::Serialize;
use tokio_postgres::GenericClient;

/// 对外模型不携带密码哈希。
#[derive(Debug, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub admin: bool,
    pub active: bool,
}

pub async fn find(client: &impl GenericClient, id: i64) -> Result<Option<User>> {
    Ok(client
        .query_opt(
            "SELECT id, username, admin, active FROM users WHERE id = $1",
            &[&id],
        )
        .await?
        .map(|row| User {
            id: row.get(0),
            username: row.get(1),
            admin: row.get(2),
            active: row.get(3),
        }))
}
