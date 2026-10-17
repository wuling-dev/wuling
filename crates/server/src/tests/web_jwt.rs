use super::*;

fn cookies(headers: &HeaderMap) -> String {
    headers
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|h| h.to_str().unwrap().split(';').next().unwrap())
        .collect::<Vec<_>>()
        .join("; ")
}
async fn session(app: &App, username: &str, password: &str) -> (HeaderMap, Value) {
    let (status, h, body) = call(
        app,
        "POST",
        "/api/auth/login",
        json!({"username":username,"password":password}),
        None,
        Some(app.origin.as_str()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    (h, body)
}
async fn renew(app: &App, cookie: &str) -> (StatusCode, HeaderMap, Value) {
    call(
        app,
        "POST",
        "/api/auth/refresh",
        Value::Null,
        Some(cookie),
        Some(app.origin.as_str()),
    )
    .await
}
async fn me_status(app: &App, cookie: &str) -> StatusCode {
    call(app, "GET", "/api/auth/me", Value::Null, Some(cookie), None)
        .await
        .0
}

#[tokio::test]
#[ignore = "需要 WULING_TEST_DATABASE_URL 指向空的隔离 PostgreSQL 数据库"]
async fn jwt_cookie_refresh_rotation_and_replay() -> wuling_storage::Result<()> {
    let url = std::env::var("WULING_TEST_DATABASE_URL")?;
    let mut db = wuling_storage::connect_local(&url).await?;
    wuling_storage::migrate(&mut db).await?;
    let admin = iam::bootstrap(&mut db, "admin", "a-long-test-password".into()).await?;
    let victim = iam::create_user(
        &mut db,
        "admin",
        "a-long-test-password".into(),
        "victim",
        "another-long-password".into(),
    )
    .await?;
    let root = PathBuf::from(std::env::var("WULING_TEST_DATA_DIR")?);
    let app = test_app(root.clone(), &url, "https://wuling.example".into()).await?;
    let (h, body) = session(&app, "admin", "a-long-test-password").await;
    let original = cookies(&h);
    let (independent_headers, _) = session(&app, "admin", "a-long-test-password").await;
    let unrelated = cookies(&independent_headers);
    assert_eq!(h.get_all(header::SET_COOKIE).iter().count(), 2);
    for cookie in h.get_all(header::SET_COOKIE) {
        let text = cookie.to_str()?;
        assert!(
            text.contains("HttpOnly")
                && text.contains("SameSite=Strict")
                && text.contains("; Secure")
        );
    }
    assert!(!body.to_string().contains("token") && !body.to_string().contains("wuling_session"));
    assert_eq!(me_status(&app, &original).await, StatusCode::OK);
    let jwt = original
        .split(';')
        .next()
        .unwrap()
        .strip_prefix("wuling_session=")
        .unwrap();
    assert_eq!(jwt.split('.').count(), 3);
    assert_eq!(app.jwt.verify(jwt)?.sub, admin.id.to_string());
    let sid = app.jwt.verify(jwt)?.sid;
    let hash: Vec<u8> = db
        .query_one(
            "SELECT digest FROM web_refresh_tokens WHERE session_id=$1",
            &[&sid],
        )
        .await?
        .get(0);
    assert_eq!(hash.len(), 32);
    let before: i64 = db
        .query_one(
            "SELECT extract(epoch FROM expires_at)::bigint FROM web_sessions WHERE id=$1",
            &[&sid],
        )
        .await?
        .get(0);
    for origin in [None, Some("null"), Some("https://evil.example")] {
        assert_eq!(
            call(
                &app,
                "POST",
                "/api/auth/refresh",
                Value::Null,
                Some(&original),
                origin
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(
                &app,
                "POST",
                "/api/auth/logout",
                Value::Null,
                Some(&original),
                origin
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    let (status, next, _) = renew(&app, &original).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let next = cookies(&next);
    assert_ne!(original, next);
    assert_eq!(me_status(&app, &next).await, StatusCode::OK);
    let after: i64 = db
        .query_one(
            "SELECT extract(epoch FROM expires_at)::bigint FROM web_sessions WHERE id=$1",
            &[&sid],
        )
        .await?
        .get(0);
    assert_eq!(before, after);
    let used: bool = db
        .query_one(
            "SELECT used_at IS NOT NULL FROM web_refresh_tokens WHERE digest=$1",
            &[&hash],
        )
        .await?
        .get(0);
    assert!(used);
    let (replay, h, _) = renew(&app, &original).await;
    assert_eq!(replay, StatusCode::UNAUTHORIZED);
    assert!(
        h.get_all(header::SET_COOKIE)
            .iter()
            .all(|h| h.to_str().unwrap().contains("Max-Age=0"))
    );
    assert_eq!(me_status(&app, &next).await, StatusCode::UNAUTHORIZED);
    assert_eq!(renew(&app, &next).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(me_status(&app, &unrelated).await, StatusCode::OK);
    assert_eq!(renew(&app, &unrelated).await.0, StatusCode::NO_CONTENT);
    // 两个真实独立 SQL 连接竞争同一刷新凭据：一个消费成功，另一个重放撤销整条链。
    let (h, _) = session(&app, "admin", "a-long-test-password").await;
    let concurrent = cookies(&h);
    let (a, b) = tokio::join!(renew(&app, &concurrent), renew(&app, &concurrent));
    assert!(matches!(
        (a.0, b.0),
        (StatusCode::NO_CONTENT, StatusCode::UNAUTHORIZED)
            | (StatusCode::UNAUTHORIZED, StatusCode::NO_CONTENT)
    ));
    let winner = if a.0 == StatusCode::NO_CONTENT {
        cookies(&a.1)
    } else {
        cookies(&b.1)
    };
    assert_eq!(me_status(&app, &winner).await, StatusCode::UNAUTHORIZED);
    // 独立会话不受另一刷新链重放影响；无 access Cookie 时仍可续期和退出。
    let (h, _) = session(&app, "admin", "a-long-test-password").await;
    let independent = cookies(&h);
    let refresh_only = independent
        .split("; ")
        .find(|s| s.starts_with("wuling_refresh="))
        .unwrap();
    assert_eq!(renew(&app, refresh_only).await.0, StatusCode::NO_CONTENT);
    let (h, _) = session(&app, "admin", "a-long-test-password").await;
    let logout_cookie = cookies(&h);
    let refresh_only = logout_cookie
        .split("; ")
        .find(|s| s.starts_with("wuling_refresh="))
        .unwrap();
    let (status, h, _) = call(
        &app,
        "POST",
        "/api/auth/logout",
        Value::Null,
        Some(refresh_only),
        Some(app.origin.as_str()),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(h.get_all(header::SET_COOKIE).iter().count(), 2);
    assert!(
        h.get_all(header::SET_COOKIE)
            .iter()
            .all(|h| h.to_str().unwrap().contains("Max-Age=0"))
    );
    assert_eq!(
        me_status(&app, &logout_cookie).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        renew(&app, &logout_cookie).await.0,
        StatusCode::UNAUTHORIZED
    );
    // 绝对期限不延长；旧 Cookie、JWT Bearer 和刷新原文不能充当网页 access JWT。
    let (h, _) = session(&app, "admin", "a-long-test-password").await;
    let expired = cookies(&h);
    let mut hm = HeaderMap::new();
    hm.insert(header::COOKIE, expired.parse()?);
    let sid = app.jwt.verify(cookie(&hm).unwrap())?.sid;
    db.execute(
        "UPDATE web_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
        &[&sid],
    )
    .await?;
    assert_eq!(renew(&app, &expired).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(
        me_status(&app, &format!("wuling_session={}", "a".repeat(64))).await,
        StatusCode::UNAUTHORIZED
    );
    let (h, _) = session(&app, "admin", "a-long-test-password").await;
    let active = cookies(&h);
    let response = router(app.clone())
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header(
                    "authorization",
                    format!(
                        "Bearer {}",
                        h[header::SET_COOKIE]
                            .to_str()?
                            .split(';')
                            .next()
                            .unwrap()
                            .strip_prefix("wuling_session=")
                            .unwrap()
                    ),
                )
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let reopened = test_app(root, &url, "https://wuling.example".into()).await?;
    assert_eq!(me_status(&reopened, &active).await, StatusCode::OK);
    // 停用撤销持久会话，重新启用也不会复活旧刷新链。
    let (h, _) = session(&app, "victim", "another-long-password").await;
    let disabled = cookies(&h);
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/users/{}/disable", victim.id),
            Value::Null,
            Some(&active),
            Some(app.origin.as_str())
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(me_status(&app, &disabled).await, StatusCode::UNAUTHORIZED);
    assert_eq!(renew(&app, &disabled).await.0, StatusCode::UNAUTHORIZED);
    db.execute("UPDATE users SET active=true WHERE id=$1", &[&victim.id])
        .await?;
    assert_eq!(renew(&app, &disabled).await.0, StatusCode::UNAUTHORIZED);
    // HTTP 开发 Cookie 无 Secure，缺少密钥配置仍须拒绝加载而非生成临时密钥。
    let local = test_app(app.root.clone(), &url, "http://localhost:3000".into()).await?;
    let (h, _) = session(&local, "admin", "a-long-test-password").await;
    assert!(
        h.get_all(header::SET_COOKIE)
            .iter()
            .all(|h| !h.to_str().unwrap().contains("; Secure"))
    );
    Ok(())
}
