use serde_json::json;
use wuling_import::{Outcome, import};
use wuling_storage::{self as storage, Result};

#[tokio::test]
#[ignore = "需要 WULING_TEST_DATABASE_URL 指向空的隔离 PostgreSQL 数据库"]
async fn import_preserves_history_and_recovers_from_disconnect() -> Result<()> {
    let url = std::env::var("WULING_TEST_DATABASE_URL")?;
    let mut client = storage::connect_local(&url).await?;
    storage::migrate(&mut client).await?;
    client
        .execute(
            "INSERT INTO users (id, username, password_hash) VALUES (1, 'owner', 'test-only')",
            &[],
        )
        .await?;
    let root = std::env::current_dir()?
        .join("../../data")
        .join(format!("import-test-{}", std::process::id()));
    std::fs::create_dir_all(&root)?;
    let source = root.join("state.json");
    let backup = root.join("state.backup.json");
    let mapping = root.join("owners.json");
    let original = serde_json::to_vec(&json!({
        "repos": [{"id": 10, "name": "example", "description": "原型仓库", "public": false}],
        "items": [
            {"id": 20, "repo_id": 10, "kind": "issues", "title": "历史讨论", "body": "正文", "state": "closed", "source": null, "target": null},
            {"id": 21, "repo_id": 10, "kind": "merge-requests", "title": "历史合并", "body": "", "state": "merged", "source": "feature", "target": "main"},
            {"id": 22, "repo_id": 10, "kind": "pipelines", "title": "原型流水线", "body": "", "state": "success", "source": null, "target": null},
            {"id": 23, "repo_id": 10, "kind": "wiki", "title": "文档", "body": "正文", "state": "open", "source": null, "target": null}
        ],
        "next_id": 30
    }))?;
    std::fs::write(&source, &original)?;
    std::fs::write(&backup, b"wrong backup")?;
    std::fs::write(&mapping, br#"{"10":1}"#)?;
    assert!(
        import(&mut client, &source, &backup, &mapping)
            .await
            .is_err()
    );
    std::fs::write(&backup, &original)?;
    assert!(
        import(&mut client, &source, &source, &mapping)
            .await
            .is_err()
    );
    std::fs::write(&mapping, b"{}")?;
    assert!(
        import(&mut client, &source, &backup, &mapping)
            .await
            .is_err()
    );
    std::fs::write(&mapping, br#"{"10":999}"#)?;
    assert!(
        import(&mut client, &source, &backup, &mapping)
            .await
            .is_err()
    );
    std::fs::write(&mapping, br#"{"10":1}"#)?;

    // 在仓库已插入、历史记录写入时断开连接，覆盖真正的中断而不只是校验失败。
    client
        .batch_execute(
            "CREATE FUNCTION interrupt_import() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
             PERFORM pg_terminate_backend(pg_backend_pid());
             RETURN NEW;
         END $$;
         CREATE TRIGGER interrupt_import BEFORE INSERT ON historical_items
             FOR EACH ROW EXECUTE FUNCTION interrupt_import();",
        )
        .await?;
    assert!(
        import(&mut client, &source, &backup, &mapping)
            .await
            .is_err()
    );
    let mut client = storage::connect_local(&url).await?;
    for table in ["repositories", "historical_items", "prototype_import"] {
        assert_eq!(
            client
                .query_one(&format!("SELECT count(*) FROM {table}"), &[])
                .await?
                .get::<_, i64>(0),
            0
        );
    }
    client
        .batch_execute(
            "DROP TRIGGER interrupt_import ON historical_items; DROP FUNCTION interrupt_import();",
        )
        .await?;
    assert_eq!(
        import(&mut client, &source, &backup, &mapping).await?,
        Outcome::Imported {
            repositories: 1,
            items: 4
        }
    );
    assert_eq!(
        import(&mut client, &source, &backup, &mapping).await?,
        Outcome::AlreadyImported
    );
    let row = client
        .query_one(
            "SELECT id, owner_id, public FROM repositories WHERE id = 10",
            &[],
        )
        .await?;
    assert_eq!(row.get::<_, i64>(0), 10);
    assert_eq!(row.get::<_, i64>(1), 1);
    assert!(!row.get::<_, bool>(2));
    let rows = client
        .query(
            "SELECT id, author_id, author_origin FROM historical_items ORDER BY id",
            &[],
        )
        .await?;
    assert_eq!(rows.len(), 4);
    for (row, expected) in rows.iter().zip(20..=23) {
        assert_eq!(row.get::<_, i64>(0), expected);
        assert_eq!(row.get::<_, Option<i64>>(1), None);
        assert_eq!(row.get::<_, &str>(2), "historical_import");
    }
    assert_eq!(
        client
            .query_one(
                "INSERT INTO repositories (owner_id, name) VALUES (1, 'next') RETURNING id",
                &[],
            )
            .await?
            .get::<_, i64>(0),
        31
    );
    std::fs::write(&mapping, br#"{"10":2}"#)?;
    assert!(
        import(&mut client, &source, &backup, &mapping)
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(&source)?, original);
    assert_eq!(std::fs::read(&backup)?, original);
    Ok(())
}
