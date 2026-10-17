use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use tower::ServiceExt;

mod web_jwt;

fn test_jwt(origin: &str) -> iam::web::Jwt {
    // 公开测试夹具，不是部署密钥。
    iam::web::Jwt::from_config(
        &json!({"active_kid":"test","keys":[
            {"kid":"test","secret_hex":"11".repeat(32)}
        ]})
        .to_string(),
        origin,
    )
    .unwrap()
}
async fn test_app(root: PathBuf, url: &str, origin: String) -> wuling_storage::Result<App> {
    let jwt = test_jwt(&origin);
    App::open_with_jwt(root, url, origin, jwt, 30).await
}

async fn call(
    app: &App,
    method: &str,
    uri: &str,
    payload: Value,
    cookie: Option<&str>,
    origin: Option<&str>,
) -> (StatusCode, HeaderMap, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(cookie) = cookie {
        req = req.header("cookie", cookie);
    }
    if let Some(origin) = origin {
        req = req.header("origin", origin);
    }
    // 即使携带旧管理员令牌也不能绕过仓库授权。
    req = req.header("authorization", "Bearer former-admin-token");
    let response = router(app.clone())
        .oneshot(req.body(Body::from(payload.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (
        status,
        headers,
        serde_json::from_slice(&body).unwrap_or(Value::Null),
    )
}

#[tokio::test]
#[ignore = "需要 WULING_TEST_DATABASE_URL 指向空的隔离 PostgreSQL 数据库"]
async fn postgres_runtime_sessions_and_readonly_history() -> wuling_storage::Result<()> {
    let url = std::env::var("WULING_TEST_DATABASE_URL")?;
    let mut db = wuling_storage::connect_local(&url).await?;
    wuling_storage::migrate(&mut db).await?;
    let admin = iam::bootstrap(&mut db, "admin", "a-long-test-password".into()).await?;
    let member = iam::create_user(
        &mut db,
        "admin",
        "a-long-test-password".into(),
        "member",
        "another-long-password".into(),
    )
    .await?;
    db.execute("INSERT INTO repositories(id,owner_id,name,public) VALUES (10,$1,'private',false),(11,$1,'public',true)", &[&admin.id]).await?;
    db.execute(
        "INSERT INTO repository_members VALUES(10,$1,'reader')",
        &[&member.id],
    )
    .await?;
    db.execute("INSERT INTO historical_items(id,repo_id,kind,title,body,state) VALUES(20,10,'issues','imported','private body','open')", &[]).await?;
    let root = PathBuf::from(std::env::var("WULING_TEST_DATA_DIR")?);
    tokio::fs::create_dir_all(&root).await?;
    tokio::fs::write(root.join("state.json"), "not valid JSON; must not be read").await?;
    let origin = "https://wuling.example";
    let app = test_app(root.clone(), &url, origin.into()).await?;
    assert_eq!(
        call(&app, "GET", "/api/repos/10", Value::Null, None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let (_, _, list) = call(&app, "GET", "/api/repos", Value::Null, None, None).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    let payload = json!({"username":"member","password":"another-long-password"});
    for invalid in [None, Some("https://evil.example"), Some("null")] {
        assert_eq!(
            call(
                &app,
                "POST",
                "/api/auth/login",
                payload.clone(),
                None,
                invalid
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    let (status, headers, _) = call(
        &app,
        "POST",
        "/api/auth/login",
        payload.clone(),
        None,
        Some(origin),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let set = headers[header::SET_COOKIE].to_str()?;
    assert!(set.contains("HttpOnly") && set.contains("SameSite=Strict") && set.contains("Secure"));
    assert_eq!(headers[header::CACHE_CONTROL], "private, no-store");
    let cookie = set.split(';').next().unwrap();
    let stored: Vec<u8> = db
        .query_one(
            "SELECT r.digest FROM web_refresh_tokens r JOIN web_sessions s ON s.id=r.session_id WHERE s.user_id=$1",
            &[&member.id],
        )
        .await?
        .get(0);
    assert_eq!(stored.len(), 32);
    assert!(!cookie.contains(&format!("{stored:x?}")));
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/repos/10",
            Value::Null,
            Some(cookie),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, _, history) = call(
        &app,
        "GET",
        "/api/repos/10/issues",
        Value::Null,
        Some(cookie),
        None,
    )
    .await;
    assert_eq!(history[0]["body"], "private body");
    for (method, path) in [
        ("POST", "/api/repos/10/issues"),
        ("PATCH", "/api/repos/10/issues/20"),
        ("POST", "/api/repos/10/merge-requests/20/merge"),
    ] {
        assert_eq!(
            call(
                &app,
                method,
                path,
                json!({"body":"overwrite"}),
                Some(cookie),
                Some(origin)
            )
            .await
            .0,
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
    db.execute(
        "DELETE FROM repository_members WHERE user_id=$1",
        &[&member.id],
    )
    .await?;
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/repos/10/issues",
            Value::Null,
            Some(cookie),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/logout",
            Value::Null,
            Some(cookie),
            Some(origin)
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&app, "GET", "/api/auth/me", Value::Null, Some(cookie), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (_, h, _) = call(
        &app,
        "POST",
        "/api/auth/login",
        payload.clone(),
        None,
        Some(origin),
    )
    .await;
    let expired = h[header::SET_COOKIE].to_str()?.split(';').next().unwrap();
    db.execute(
        "UPDATE web_sessions SET expires_at=now()-interval '1 second'",
        &[],
    )
    .await?;
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/auth/me",
            Value::Null,
            Some(expired),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (_, h, _) = call(&app, "POST", "/api/auth/login", payload, None, Some(origin)).await;
    let disabled = h[header::SET_COOKIE].to_str()?.split(';').next().unwrap();
    let (_, a, _) = call(
        &app,
        "POST",
        "/api/auth/login",
        json!({"username":"admin","password":"a-long-test-password"}),
        None,
        Some(origin),
    )
    .await;
    let admin_cookie = a[header::SET_COOKIE].to_str()?.split(';').next().unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/users/{}/disable", member.id),
            Value::Null,
            Some(admin_cookie),
            Some(origin)
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/auth/me",
            Value::Null,
            Some(disabled),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        db.query_one(
            "SELECT count(*) FROM web_sessions WHERE user_id=$1 AND revoked_at IS NULL",
            &[&member.id]
        )
        .await?
        .get::<_, i64>(0),
        0
    );
    assert_eq!(
        tokio::fs::read_to_string(root.join("state.json")).await?,
        "not valid JSON; must not be read"
    );
    // 重启后仍使用 PostgreSQL，不重新读取 JSON。
    let reopened = test_app(root.clone(), &url, origin.into()).await?;
    assert_eq!(
        call(
            &reopened,
            "GET",
            "/api/repos/10",
            Value::Null,
            Some(admin_cookie),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, _, created) = call(
        &app,
        "POST",
        "/api/repos",
        json!({"name":"new-repo","public":true}),
        Some(admin_cookie),
        Some(origin),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["owner_id"], admin.id);
    let id = created["id"].as_i64().unwrap();
    let work = root.join("work");
    tokio::fs::create_dir_all(&work).await?;
    async fn git(work: &std::path::Path, args: &[&str]) -> wuling_storage::Result<()> {
        let output = Command::new("git")
            .current_dir(work)
            .args([
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
            ])
            .args(args)
            .output()
            .await?;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(())
    }
    git(&work, &["init", "--initial-branch=main"]).await?;
    tokio::fs::write(work.join("README.md"), "runtime migration\n").await?;
    git(&work, &["add", "README.md"]).await?;
    git(&work, &["commit", "-m", "fixture"]).await?;
    let remote = root.join("repos").join(format!("{id}.git"));
    git(&work, &["push", remote.to_str().unwrap(), "main"]).await?;
    let (_, _, tree) = call(
        &app,
        "GET",
        &format!("/api/repos/{id}/tree"),
        Value::Null,
        None,
        None,
    )
    .await;
    assert_eq!(tree, json!(["README.md"]));
    let (_, _, blob) = call(
        &app,
        "GET",
        &format!("/api/repos/{id}/blob?path=README.md"),
        Value::Null,
        None,
        None,
    )
    .await;
    assert_eq!(blob["content"], "runtime migration\n");
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/login",
            json!({"username":"member","password":"another-long-password"}),
            None,
            Some(origin)
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/auth/login",
            json!({"username":"admin","password":"wrong"}),
            None,
            Some(origin)
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    for path in [
        "/api/register",
        "/api/auth/register",
        "/api/bootstrap",
        "/api/auth/bootstrap",
        "/api/users",
    ] {
        assert_eq!(
            call(&app, "POST", path, Value::Null, None, Some(origin))
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }
    Ok(())
}

#[test]
fn rejects_unsafe_refs() {
    for reference in ["", "--all", "../main", "main:file", "main\n"] {
        assert!(check_ref(reference).is_err());
    }
    assert!(check_ref("feature/one").is_ok());
}

#[tokio::test]
#[ignore = "需要 WULING_TEST_DATABASE_URL 指向空的隔离 PostgreSQL 数据库"]
async fn repository_member_roles() -> wuling_storage::Result<()> {
    let url = std::env::var("WULING_TEST_DATABASE_URL")?;
    let mut db = wuling_storage::connect_local(&url).await?;
    wuling_storage::migrate(&mut db).await?;
    let owner = iam::bootstrap(&mut db, "owner", "a-long-test-password".into()).await?;
    let member = iam::create_user(
        &mut db,
        "owner",
        "a-long-test-password".into(),
        "member",
        "another-long-password".into(),
    )
    .await?;
    let outsider = iam::create_user(
        &mut db,
        "owner",
        "a-long-test-password".into(),
        "outsider",
        "another-long-password".into(),
    )
    .await?;
    db.execute(
        "INSERT INTO repositories(id,owner_id,name) VALUES(10,$1,'private'),(11,$2,'other')",
        &[&owner.id, &outsider.id],
    )
    .await?;
    let app = test_app(
        std::env::var("WULING_TEST_DATA_DIR")?.into(),
        &url,
        "https://wuling.example".into(),
    )
    .await?;
    let origin = Some("https://wuling.example");
    async fn session(app: &App, username: &str, password: &str) -> String {
        let (status, h, _) = call(
            app,
            "POST",
            "/api/auth/login",
            json!({"username":username,"password":password}),
            None,
            Some("https://wuling.example"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        h[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .into()
    }
    let owner_cookie = session(&app, "owner", "a-long-test-password").await;
    let member_cookie = session(&app, "member", "another-long-password").await;
    let outsider_cookie = session(&app, "outsider", "another-long-password").await;
    let member_url = format!("/api/repos/10/members/{}", member.id);
    assert_eq!(
        call(
            &app,
            "PUT",
            &member_url,
            json!({"role":"reader"}),
            Some(&owner_cookie),
            origin
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        iam::repository::role(&db, 10, member.id).await?,
        Some(iam::repository::Role::Reader)
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/repos/10",
            Value::Null,
            Some(&member_cookie),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/repos/10/members",
            Value::Null,
            Some(&member_cookie),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            &member_url,
            json!({"role":"maintainer"}),
            Some(&member_cookie),
            origin
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for (name, role) in [
        ("developer", iam::repository::Role::Developer),
        ("maintainer", iam::repository::Role::Maintainer),
    ] {
        assert_eq!(
            call(
                &app,
                "PUT",
                &member_url,
                json!({"role":name}),
                Some(&owner_cookie),
                origin
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
        assert_eq!(iam::repository::role(&db, 10, member.id).await?, Some(role));
    }
    let (_, _, list) = call(
        &app,
        "GET",
        "/api/repos/10/members",
        Value::Null,
        Some(&member_cookie),
        None,
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 2);
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/api/repos/10/members/{}", owner.id),
            Value::Null,
            Some(&member_cookie),
            origin
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    // 管理员也不拥有未加入的私有仓库。
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/repos/11",
            Value::Null,
            Some(&owner_cookie),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            &member_url,
            json!({"role":"reader"}),
            Some(&outsider_cookie),
            origin
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            &member_url,
            json!({"role":"admin"}),
            Some(&owner_cookie),
            origin
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            "/api/repos/10/members/99999",
            json!({"role":"reader"}),
            Some(&owner_cookie),
            origin
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            &member_url,
            json!({"role":"reader"}),
            Some(&owner_cookie),
            origin
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/repos/10/members",
            Value::Null,
            Some(&member_cookie),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "DELETE",
            &member_url,
            Value::Null,
            Some(&owner_cookie),
            origin
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    for path in [
        "/api/repos/10",
        "/api/repos/10/branches",
        "/api/repos/10/issues",
        "/api/repos/10/insight",
    ] {
        assert_eq!(
            call(&app, "GET", path, Value::Null, Some(&member_cookie), None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(iam::repository::role(&db, 10, member.id).await?, None);
    // PAT scope 与实时角色取交集；只在创建响应中返回原文。
    use iam::repository::Role;
    let mut issued = Vec::new();
    for scope in ["read", "write"] {
        let (status, _, result) = call(
            &app,
            "POST",
            "/api/auth/tokens",
            json!({"name":"test","scope":scope,"expires_in_days":30}),
            Some(&member_cookie),
            origin,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        issued.push((
            result["id"].as_i64().unwrap(),
            result["token"].as_str().unwrap().to_owned(),
        ));
    }
    let (_, _, list) = call(
        &app,
        "GET",
        "/api/auth/tokens",
        Value::Null,
        Some(&member_cookie),
        None,
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 2);
    assert!(!list.to_string().contains("wlp_"));
    let digest: Vec<u8> = db
        .query_one(
            "SELECT digest FROM personal_tokens WHERE id=$1",
            &[&issued[0].0],
        )
        .await?
        .get(0);
    assert_eq!(digest.len(), 32);
    assert_eq!(
        call(
            &app,
            "PUT",
            &member_url,
            json!({"role":"developer"}),
            Some(&owner_cookie),
            origin
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert!(iam::pat::authorize(&db, &issued[0].1, 10, Role::Reader).await?);
    assert!(!iam::pat::authorize(&db, &issued[0].1, 10, Role::Developer).await?);
    assert!(iam::pat::authorize(&db, &issued[1].1, 10, Role::Developer).await?);
    assert!(!iam::pat::authorize(&db, &issued[1].1, 10, Role::Maintainer).await?);
    assert!(!iam::pat::authorize(&db, &issued[1].1, 11, Role::Reader).await?);
    let response = router(app.clone())
        .oneshot(
            Request::builder()
                .uri("/api/repos/10")
                .header("authorization", format!("Bearer {}", issued[0].1))
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    // PAT 无权管理令牌或成员，不能将 scope 放大为登录会话。
    let response = router(app.clone())
        .oneshot(
            Request::builder()
                .uri("/api/auth/tokens")
                .header("authorization", format!("Bearer {}", issued[1].1))
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        call(
            &app,
            "PUT",
            &member_url,
            json!({"role":"reader"}),
            Some(&owner_cookie),
            origin
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert!(!iam::pat::authorize(&db, &issued[1].1, 10, Role::Developer).await?);
    assert_eq!(
        call(
            &app,
            "DELETE",
            &member_url,
            Value::Null,
            Some(&owner_cookie),
            origin
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert!(!iam::pat::authorize(&db, &issued[1].1, 10, Role::Reader).await?);
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/api/auth/tokens/{}", issued[0].0),
            Value::Null,
            Some(&outsider_cookie),
            origin
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert!(iam::pat::authenticate(&db, &issued[0].1).await?.is_some());
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/api/auth/tokens/{}", issued[0].0),
            Value::Null,
            Some(&member_cookie),
            origin
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert!(iam::pat::authenticate(&db, &issued[0].1).await?.is_none());
    db.execute(
        "UPDATE personal_tokens SET expires_at=now()-interval '1 second'",
        &[],
    )
    .await?;
    assert!(iam::pat::authenticate(&db, &issued[1].1).await?.is_none());
    for days in [0, 366, -1] {
        assert_eq!(
            call(
                &app,
                "POST",
                "/api/auth/tokens",
                json!({"name":"invalid","scope":"read","expires_in_days":days}),
                Some(&member_cookie),
                origin
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    Ok(())
}

#[test]
fn validates_exact_origins() {
    for origin in [
        "https://wuling.example",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://wuling.example:443",
        "https://[::1]:8443",
        "http://localhost:65535",
    ] {
        assert!(valid_origin(origin), "{origin}");
    }
    for origin in [
        "http://public.example",
        "https://wuling.example/",
        "https://wuling.example/path",
        "https://user@wuling.example",
        "https://wuling.example?query",
        "http://localhost:3000.evil",
        "http://localhost:",
        "http://localhost:abc",
        "http://localhost:65536",
        "http://localhost:+3000",
        "https://wuling.example:443.evil",
        "https://wuling.example:65536",
        "https://[::1]:invalid",
    ] {
        assert!(!valid_origin(origin), "{origin}");
    }
}
