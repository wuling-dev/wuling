//! 身份认证和访问控制。HTTP 与本机命令只调用此层，不自行验证密码。

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use rand_core::OsRng;
use std::io;
use tokio_postgres::Client;
use wuling_storage::{
    Result,
    identity::{self, User},
};

fn validate(username: &str, password: &str) -> Result<()> {
    if username.is_empty()
        || username.len() > 80
        || !username
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        || !(12..=1024).contains(&password.len())
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "用户名须为1–80字节字母、数字、下划线或短横线；密码须为12–1024字节",
        )
        .into());
    }
    Ok(())
}

async fn hash_password(password: String) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|_| io::Error::other("密码哈希失败"))
    })
    .await?
    .map_err(Into::into)
}

fn unauthorized() -> Box<dyn std::error::Error + Send + Sync> {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "用户名、密码或账号状态无效",
    )
    .into()
}

/// 只由本机 CLI 调用，不提供 HTTP 引导或公开注册接口。
pub async fn bootstrap(client: &mut Client, username: &str, password: String) -> Result<User> {
    validate(username, &password)?;
    let hash = hash_password(password).await?;
    identity::bootstrap(client, username, &hash).await
}

pub async fn authenticate(client: &Client, username: &str, password: String) -> Result<User> {
    if password.len() > 1024 {
        return Err(unauthorized());
    }
    let credentials = identity::credentials(client, username).await?;
    // 未知账号也执行同等强度的密码哈希，不直接快速返回。
    let Some((user, hash)) = credentials else {
        hash_password(password).await?;
        return Err(unauthorized());
    };
    let valid = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(password.as_bytes(), &hash)
                .is_ok()
        })
    })
    .await?;
    if !valid || !user.active {
        return Err(unauthorized());
    }
    Ok(user)
}

pub async fn create_user(
    client: &mut Client,
    admin_username: &str,
    admin_password: String,
    username: &str,
    password: String,
) -> Result<User> {
    let admin = authenticate(client, admin_username, admin_password).await?;
    if !admin.admin {
        return Err(unauthorized());
    }
    validate(username, &password)?;
    let hash = hash_password(password).await?;
    identity::create_by_admin(client, admin.id, username, &hash).await
}
