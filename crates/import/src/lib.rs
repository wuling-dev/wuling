//! 原型迁移边界：只读源文件和备份，原子写入 PostgreSQL，不接触 Git。

use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    path::Path,
};
use tokio_postgres::Client;
use wuling_storage::Result;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    repos: Vec<Repo>,
    items: Vec<Item>,
    next_id: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Repo {
    id: i64,
    name: String,
    description: String,
    public: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Item {
    id: i64,
    repo_id: i64,
    kind: String,
    title: String,
    body: String,
    state: String,
    source: Option<String>,
    target: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Imported { repositories: usize, items: usize },
    AlreadyImported,
}

/// 验证备份与源文件逐字节一致后才连接写事务。归属表格式为 {"仓库ID": 用户ID}。
pub async fn import(
    client: &mut Client,
    source: &Path,
    backup: &Path,
    ownership: &Path,
) -> Result<Outcome> {
    let source = source.canonicalize()?;
    let backup = backup.canonicalize()?;
    if source == backup {
        return Err(io::Error::other("备份必须是独立文件").into());
    }
    let bytes = std::fs::read(&source)?;
    if bytes != std::fs::read(&backup)? {
        return Err(io::Error::other("备份与原型 JSON 不一致，拒绝导入").into());
    }
    let snapshot: Snapshot = serde_json::from_slice(&bytes)?;
    let owners: BTreeMap<i64, i64> = serde_json::from_slice(&std::fs::read(ownership)?)?;
    validate(&snapshot, &owners)?;
    let text = String::from_utf8(bytes)?;
    let mapping = serde_json::to_string(&owners)?;

    let tx = client.transaction().await?;
    tx.batch_execute("SELECT pg_advisory_xact_lock(871943202)")
        .await?;
    if let Some(previous) = tx
        .query_opt(
            "SELECT snapshot, ownership FROM prototype_import WHERE id = 1",
            &[],
        )
        .await?
    {
        if previous.get::<_, String>(0) != text || previous.get::<_, String>(1) != mapping {
            return Err(io::Error::other("已导入其他快照或归属表，拒绝覆盖").into());
        }
        tx.rollback().await?;
        return Ok(Outcome::AlreadyImported);
    }
    // 阻止在线写入与导入交错；不覆盖目标库的既有仓库。
    tx.batch_execute("LOCK TABLE repositories, historical_items IN EXCLUSIVE MODE")
        .await?;
    if tx
        .query_one(
            "SELECT EXISTS (SELECT 1 FROM repositories) OR EXISTS (SELECT 1 FROM historical_items)",
            &[],
        )
        .await?
        .get::<_, bool>(0)
    {
        return Err(io::Error::other("目标数据库已有仓库或历史记录，拒绝导入").into());
    }
    for owner in owners.values().collect::<BTreeSet<_>>() {
        if tx
            .query_opt(
                "SELECT id FROM users WHERE id = $1 AND active FOR SHARE",
                &[owner],
            )
            .await?
            .is_none()
        {
            return Err(io::Error::other("归属表引用了不存在或停用的用户").into());
        }
    }
    for repo in &snapshot.repos {
        tx.execute(
            "INSERT INTO repositories (id, owner_id, name, description, public)
             VALUES ($1, $2, $3, $4, $5)",
            &[
                &repo.id,
                &owners[&repo.id],
                &repo.name,
                &repo.description,
                &repo.public,
            ],
        )
        .await?;
    }
    for item in &snapshot.items {
        tx.execute(
            "INSERT INTO historical_items (id, repo_id, kind, title, body, state, source, target)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            &[
                &item.id,
                &item.repo_id,
                &item.kind,
                &item.title,
                &item.body,
                &item.state,
                &item.source,
                &item.target,
            ],
        )
        .await?;
    }
    // ALTER SEQUENCE 的 RESTART 是事务性的，不使用不能回滚的 setval。
    let next = snapshot.next_id + 1;
    tx.batch_execute(&format!(
        "ALTER SEQUENCE repositories_id_seq RESTART WITH {next}"
    ))
    .await?;
    tx.execute(
        "INSERT INTO prototype_import (id, snapshot, ownership, next_id) VALUES (1, $1, $2, $3)",
        &[&text, &mapping, &snapshot.next_id],
    )
    .await?;
    tx.commit().await?;
    Ok(Outcome::Imported {
        repositories: snapshot.repos.len(),
        items: snapshot.items.len(),
    })
}

fn validate(snapshot: &Snapshot, owners: &BTreeMap<i64, i64>) -> Result<()> {
    let repo_ids: BTreeSet<_> = snapshot.repos.iter().map(|repo| repo.id).collect();
    let mut ids = repo_ids.clone();
    if repo_ids.len() != snapshot.repos.len()
        || repo_ids != owners.keys().copied().collect()
        || owners.values().any(|id| *id <= 0)
    {
        return Err(io::Error::other("仓库 ID 重复或显式归属表未精确覆盖全部仓库").into());
    }
    for item in &snapshot.items {
        if !repo_ids.contains(&item.repo_id)
            || !ids.insert(item.id)
            || !["issues", "merge-requests", "pipelines", "wiki"].contains(&item.kind.as_str())
        {
            return Err(io::Error::other("历史记录存在重复 ID、未知仓库或未知类型").into());
        }
    }
    if snapshot.next_id < 0
        || snapshot.next_id == i64::MAX
        || ids.iter().any(|id| *id <= 0 || *id > snapshot.next_id)
    {
        return Err(io::Error::other("原型 ID 或 next_id 无效").into());
    }
    Ok(())
}
