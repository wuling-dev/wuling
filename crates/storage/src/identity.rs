use super::Result;
use serde::Serialize;
use tokio_postgres::{Client, GenericClient};

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

/// 仅供认证内部使用；禁止序列化或记录返回的密码哈希。
pub async fn credentials(
    client: &impl GenericClient,
    username: &str,
) -> Result<Option<(User, String)>> {
    Ok(client
        .query_opt(
            "SELECT id, username, admin, active, password_hash FROM users WHERE lower(username) = lower($1)",
            &[&username],
        )
        .await?
        .map(|row| {
            (
                User {
                    id: row.get(0),
                    username: row.get(1),
                    admin: row.get(2),
                    active: row.get(3),
                },
                row.get(4),
            )
        }))
}

pub async fn bootstrap(client: &mut Client, username: &str, hash: &str) -> Result<User> {
    let tx = client.transaction().await?;
    tx.batch_execute("SELECT pg_advisory_xact_lock(871943203)")
        .await?;
    if tx
        .query_one("SELECT EXISTS (SELECT 1 FROM users WHERE admin)", &[])
        .await?
        .get::<_, bool>(0)
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "管理员已存在，拒绝重复引导",
        )
        .into());
    }
    let id: i64 = tx
        .query_one(
            "INSERT INTO users (username, password_hash, admin) VALUES ($1, $2, true) RETURNING id",
            &[&username, &hash],
        )
        .await?
        .get(0);
    let user = find(&tx, id).await?.expect("刚插入的用户存在");
    tx.commit().await?;
    Ok(user)
}

pub async fn create_by_admin(
    client: &mut Client,
    admin_id: i64,
    username: &str,
    hash: &str,
) -> Result<User> {
    let tx = client.transaction().await?;
    if tx
        .query_opt(
            "SELECT id FROM users WHERE id = $1 AND active AND admin FOR SHARE",
            &[&admin_id],
        )
        .await?
        .is_none()
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "需要启用的管理员身份",
        )
        .into());
    }
    let id: i64 = tx
        .query_one(
            "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
            &[&username, &hash],
        )
        .await?
        .get(0);
    let user = find(&tx, id).await?.expect("刚插入的用户存在");
    tx.commit().await?;
    Ok(user)
}
