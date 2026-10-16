use wuling_storage::{self as storage, identity, repository};

// 必须指向可丢弃的独立测试数据库；不静默跳过数据库验收。
#[tokio::test]
#[ignore = "需要 WULING_TEST_DATABASE_URL 指向空的隔离 PostgreSQL 数据库"]
async fn migrations_are_atomic_and_repeatable() -> storage::Result<()> {
    let url = std::env::var("WULING_TEST_DATABASE_URL")?;
    let mut client = storage::connect_local(&url).await?;
    let mut concurrent = storage::connect_local(&url).await?;
    let (a, b) = tokio::join!(
        storage::migrate(&mut client),
        storage::migrate(&mut concurrent)
    );
    a?;
    b?;
    storage::migrate(&mut client).await?;
    assert_eq!(
        client
            .query_one("SELECT count(*) FROM schema_migrations", &[])
            .await?
            .get::<_, i64>(0),
        1
    );
    let tx = client.transaction().await?;
    let user_id: i64 = tx
        .query_one(
            "INSERT INTO users (username, password_hash) VALUES ('alice', 'test-only') RETURNING id",
            &[],
        )
        .await?
        .get(0);
    let repo_id: i64 = tx
        .query_one(
            "INSERT INTO repositories (owner_id, name) VALUES ($1, 'private') RETURNING id",
            &[&user_id],
        )
        .await?
        .get(0);
    assert_eq!(
        identity::find(&tx, user_id).await?.unwrap().username,
        "alice"
    );
    let repo = repository::find(&tx, repo_id).await?.unwrap();
    assert_eq!(repo.owner_id, user_id);
    assert!(!repo.public);
    tx.rollback().await?;
    assert!(identity::find(&client, user_id).await?.is_none());
    assert!(repository::find(&client, repo_id).await?.is_none());

    client
        .execute(
            "UPDATE schema_migrations SET sql = 'modified' WHERE version = 1",
            &[],
        )
        .await?;
    assert!(storage::migrate(&mut client).await.is_err());
    client
        .execute(
            "UPDATE schema_migrations SET sql = $1 WHERE version = 1",
            &[&include_str!("../migrations/0001_identity_repository.sql")],
        )
        .await?;
    storage::migrate(&mut client).await?;
    Ok(())
}
