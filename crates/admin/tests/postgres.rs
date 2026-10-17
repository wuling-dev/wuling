use std::{
    io::Write,
    process::{Child, Command, Output, Stdio},
};
use wuling_storage::{self as storage, Result};

// 仅用于本测试创建的可丢弃账号，不是部署凭据。
const PASSWORD: &str = "disposable-test-password";

fn spawn(url: &str, args: &[&str], input: &str) -> Result<Child> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_wuling-admin"))
        .args(args)
        .env("WULING_DATABASE_URL", url)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child.stdin.take().unwrap().write_all(input.as_bytes())?;
    Ok(child)
}

fn check_output(output: &Output, success: bool) {
    assert_eq!(
        output.status.success(),
        success,
        "stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    for bytes in [&output.stdout, &output.stderr] {
        assert!(!String::from_utf8_lossy(bytes).contains(PASSWORD));
        assert!(!String::from_utf8_lossy(bytes).contains("$argon2"));
    }
}

#[tokio::test]
#[ignore = "需要 WULING_TEST_DATABASE_URL 指向空的隔离 PostgreSQL 数据库"]
async fn local_admin_bootstrap_and_user_creation() -> Result<()> {
    let url = std::env::var("WULING_TEST_DATABASE_URL")?;
    let mut client = storage::connect_local(&url).await?;
    storage::migrate(&mut client).await?;

    // 两个实际进程同时引导，数据库事务保证只有一个成功。
    let first = spawn(&url, &["bootstrap", "admin_a"], &format!("{PASSWORD}\n"))?;
    let second = spawn(&url, &["bootstrap", "admin_b"], &format!("{PASSWORD}\n"))?;
    let first = first.wait_with_output()?;
    let second = second.wait_with_output()?;
    assert_ne!(first.status.success(), second.status.success());
    check_output(&first, first.status.success());
    check_output(&second, second.status.success());
    let admin = client
        .query_one(
            "SELECT id, username, password_hash FROM users WHERE admin",
            &[],
        )
        .await?;
    let admin_id: i64 = admin.get(0);
    let admin_name: String = admin.get(1);
    let admin_hash: String = admin.get(2);
    assert!(admin_hash.starts_with("$argon2id$"));
    assert_ne!(admin_hash, PASSWORD);
    check_output(
        &spawn(
            &url,
            &["bootstrap", "another_admin"],
            &format!("{PASSWORD}\n"),
        )?
        .wait_with_output()?,
        false,
    );
    check_output(
        &spawn(
            &url,
            &["create-user", &admin_name, "alice"],
            &format!("wrong-password\n{PASSWORD}\n"),
        )?
        .wait_with_output()?,
        false,
    );
    for name in ["alice", "bob"] {
        check_output(
            &spawn(
                &url,
                &["create-user", &admin_name, name],
                &format!("{PASSWORD}\n{PASSWORD}\n"),
            )?
            .wait_with_output()?,
            true,
        );
    }
    check_output(
        &spawn(
            &url,
            &["create-user", "alice", "unauthorized"],
            &format!("{PASSWORD}\n{PASSWORD}\n"),
        )?
        .wait_with_output()?,
        false,
    );
    check_output(
        &spawn(
            &url,
            &["create-user", &admin_name, "ALICE"],
            &format!("{PASSWORD}\n{PASSWORD}\n"),
        )?
        .wait_with_output()?,
        false,
    );
    check_output(
        &spawn(
            &url,
            &["create-user", &admin_name, "weak"],
            &format!("{PASSWORD}\nshort\n"),
        )?
        .wait_with_output()?,
        false,
    );
    let hashes = client
        .query(
            "SELECT password_hash FROM users WHERE NOT admin ORDER BY username",
            &[],
        )
        .await?;
    assert_eq!(hashes.len(), 2);
    assert_ne!(hashes[0].get::<_, String>(0), hashes[1].get::<_, String>(0));
    assert!(
        iam::authenticate(&client, "alice", PASSWORD.into())
            .await
            .is_ok()
    );
    client
        .execute(
            "UPDATE users SET active = false WHERE id = $1",
            &[&admin_id],
        )
        .await?;
    check_output(
        &spawn(
            &url,
            &["bootstrap", "replacement"],
            &format!("{PASSWORD}\n"),
        )?
        .wait_with_output()?,
        false,
    );
    check_output(
        &spawn(
            &url,
            &["create-user", &admin_name, "disabled_admin_child"],
            &format!("{PASSWORD}\n{PASSWORD}\n"),
        )?
        .wait_with_output()?,
        false,
    );
    assert_eq!(
        client
            .query_one("SELECT count(*) FROM users", &[])
            .await?
            .get::<_, i64>(0),
        3
    );
    Ok(())
}
