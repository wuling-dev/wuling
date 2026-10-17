//! PostgreSQL 元数据层。迁移与原型导入显式执行，不隐式覆盖 JSON。

pub mod identity;
pub mod repository;

use std::io;
use tokio_postgres::{Client, NoTls};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "identity_repository",
        include_str!("../migrations/0001_identity_repository.sql"),
    ),
    (
        2,
        "prototype_import",
        include_str!("../migrations/0002_prototype_import.sql"),
    ),
    (
        3,
        "sessions",
        include_str!("../migrations/0003_sessions.sql"),
    ),
    (
        4,
        "personal_tokens",
        include_str!("../migrations/0004_personal_tokens.sql"),
    ),
    (5, "web_jwt", include_str!("../migrations/0005_web_jwt.sql")),
];

/// 本机运维连接；远端数据库必须通过经过验证的 TLS 通道连接。
pub async fn connect_local(url: &str) -> Result<Client> {
    let config: tokio_postgres::Config = url.parse()?;
    if config.get_hosts().is_empty()
        || config.get_hosts().iter().any(|host| match host {
            tokio_postgres::config::Host::Tcp(host) => {
                host != "localhost" && host != "127.0.0.1" && host != "::1"
            }
            #[cfg(unix)]
            tokio_postgres::config::Host::Unix(_) => false,
        })
    {
        return Err(io::Error::other("本机运维连接只允许 Unix socket 或 loopback 地址").into());
    }
    let (client, connection) = config.connect(NoTls).await?;
    tokio::spawn(async move {
        if let Err(error) = connection.await {
            eprintln!("PostgreSQL 连接中断: {error}");
        }
    });
    Ok(client)
}

/// 在同一事务中锁定迁移、执行 DDL 并记录版本；失败时整体回滚。
pub async fn migrate(client: &mut Client) -> Result<()> {
    let tx = client.transaction().await?;
    tx.batch_execute(
        "SELECT pg_advisory_xact_lock(871943201);
         CREATE TABLE IF NOT EXISTS schema_migrations (
             version BIGINT PRIMARY KEY,
             name TEXT NOT NULL,
             sql TEXT NOT NULL,
             applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         );",
    )
    .await?;
    let applied = tx
        .query(
            "SELECT version, name, sql FROM schema_migrations ORDER BY version",
            &[],
        )
        .await?;
    for (index, row) in applied.iter().enumerate() {
        let version: i64 = row.get(0);
        let name: &str = row.get(1);
        let sql: &str = row.get(2);
        if MIGRATIONS.get(index).copied() != Some((version, name, sql)) {
            return Err(io::Error::other("数据库迁移与当前程序不一致，拒绝修改").into());
        }
    }
    for &(version, name, sql) in &MIGRATIONS[applied.len()..] {
        tx.batch_execute(sql).await?;
        tx.execute(
            "INSERT INTO schema_migrations (version, name, sql) VALUES ($1, $2, $3)",
            &[&version, &name, &sql],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
