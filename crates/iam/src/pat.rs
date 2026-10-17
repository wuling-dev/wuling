//! PAT 的密码学边界和当前权限交集；不授予账号/成员管理权限。
use super::repository::{self, Role};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use tokio_postgres::GenericClient;
use wuling_storage::{
    Result,
    identity::{self, User},
};

pub fn issue() -> Result<(String, Vec<u8>)> {
    let mut bytes = [0u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| std::io::Error::other("令牌生成失败"))?;
    let token = format!(
        "wlp_{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    );
    let digest = Sha256::digest(token.as_bytes()).to_vec();
    Ok((token, digest))
}

pub async fn authenticate(db: &impl GenericClient, token: &str) -> Result<Option<(User, Role)>> {
    if !token.starts_with("wlp_")
        || token.len() != 68
        || !token.as_bytes()[4..].iter().all(u8::is_ascii_hexdigit)
    {
        return Ok(None);
    }
    let digest = Sha256::digest(token.as_bytes()).to_vec();
    let Some(row) = db
        .query_opt(
            "SELECT p.user_id,p.scope FROM personal_tokens p JOIN users u ON u.id=p.user_id
         WHERE p.digest=$1 AND p.expires_at>now() AND u.active",
            &[&digest],
        )
        .await?
    else {
        return Ok(None);
    };
    let user = identity::find(db, row.get(0)).await?;
    let cap = if row.get::<_, &str>(1) == "write" {
        Role::Developer
    } else {
        Role::Reader
    };
    Ok(user.filter(|u| u.active).map(|u| (u, cap)))
}

pub async fn authorize(
    db: &impl GenericClient,
    token: &str,
    repo: i64,
    required: Role,
) -> Result<bool> {
    let Some((user, cap)) = authenticate(db, token).await? else {
        return Ok(false);
    };
    Ok(cap >= required
        && repository::role(db, repo, user.id)
            .await?
            .is_some_and(|role| role >= required))
}
