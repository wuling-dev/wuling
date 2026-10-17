use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};
use tokio::process::Command;
use tokio_postgres::Client;
use wuling_storage::identity::User;

type Error = (StatusCode, Json<Value>);
type Result<T> = std::result::Result<T, Error>;
fn error(status: StatusCode, message: &str) -> Error {
    (status, Json(json!({"error": message})))
}
fn internal(_: impl std::fmt::Display) -> Error {
    error(StatusCode::INTERNAL_SERVER_ERROR, "数据库或 Git 操作失败")
}
fn unauthorized() -> Error {
    error(StatusCode::UNAUTHORIZED, "需要有效登录会话")
}

#[derive(Clone)]
struct App {
    db: Arc<Client>,
    root: PathBuf,
    origin: Arc<String>,
    database_url: Arc<String>,
    secure: bool,
    jwt: Arc<iam::web::Jwt>,
    session_days: i32,
}
impl App {
    async fn open(root: PathBuf, url: &str, origin: String) -> wuling_storage::Result<Self> {
        let jwt = iam::web::Jwt::from_config(&std::env::var("WULING_JWT_KEYS")?, &origin)?;
        let days = std::env::var("WULING_WEB_SESSION_DAYS")
            .unwrap_or_else(|_| "30".into())
            .parse()?;
        Self::open_with_jwt(root, url, origin, jwt, days).await
    }
    async fn open_with_jwt(
        root: PathBuf,
        url: &str,
        origin: String,
        jwt: iam::web::Jwt,
        session_days: i32,
    ) -> wuling_storage::Result<Self> {
        if !(1..=90).contains(&session_days) {
            return Err("WULING_WEB_SESSION_DAYS 须为1–90天".into());
        }
        // 配置只接受精确 origin，不信任 Host / X-Forwarded-* 来决定写请求来源。
        let parsed: axum::http::Uri = origin.parse()?;
        let secure = parsed.scheme_str() == Some("https");
        if !valid_origin(&origin) {
            return Err(
                "WULING_WEB_ORIGIN 须为 HTTPS origin 或本机 HTTP origin（无尾斜杠）".into(),
            );
        }
        let db = wuling_storage::connect_local(url).await?;
        // 启动不隐式迁移；缺表时直接失败，不回退 JSON 或管理员令牌。
        db.simple_query("SELECT id FROM web_sessions LIMIT 0; SELECT digest FROM web_refresh_tokens LIMIT 0; SELECT id FROM repositories LIMIT 0; SELECT id FROM historical_items LIMIT 0; SELECT id FROM personal_tokens LIMIT 0")
            .await?;
        tokio::fs::create_dir_all(root.join("repos")).await?;
        Ok(Self {
            db: Arc::new(db),
            root,
            origin: Arc::new(origin),
            database_url: Arc::new(url.into()),
            secure,
            jwt: Arc::new(jwt),
            session_days,
        })
    }

    async fn user(&self, headers: &HeaderMap) -> Result<Option<User>> {
        let Some(token) = cookie(headers) else {
            return Ok(None);
        };
        iam::web::user(self.db.as_ref(), &self.jwt, token)
            .await
            .map_err(internal)?
            .map(Some)
            .ok_or_else(unauthorized)
    }

    async fn repo(&self, id: i64, headers: &HeaderMap) -> Result<Value> {
        let user = self.read_user(headers).await?;
        let uid = user.map(|u| u.id);
        self.db.query_opt(
            "SELECT row_to_json(r) FROM repositories r WHERE r.id=$1 AND
             (r.public OR r.owner_id=$2 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id=r.id AND m.user_id=$2))",
            &[&id, &uid],
        ).await.map_err(internal)?
            .map(|r| r.get::<_, Value>(0))
            .ok_or_else(|| error(StatusCode::NOT_FOUND, "仓库不存在"))
    }

    async fn read_user(&self, headers: &HeaderMap) -> Result<Option<User>> {
        if let Some(token) = headers
            .get(header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer wlp_"))
        {
            return iam::pat::authenticate(self.db.as_ref(), &format!("wlp_{token}"))
                .await
                .map_err(internal)?
                .map(|(u, _)| Some(u))
                .ok_or_else(unauthorized);
        }
        self.user(headers).await
    }

    async fn git(&self, id: i64, args: &[&str]) -> Result<String> {
        let mut command = Command::new("git");
        command
            .arg("--git-dir")
            .arg(self.root.join("repos").join(format!("{id}.git")))
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .kill_on_drop(true);
        let output = tokio::time::timeout(std::time::Duration::from_secs(15), command.output())
            .await
            .map_err(internal)?
            .map_err(internal)?;
        if !output.status.success() {
            return Err(error(
                StatusCode::CONFLICT,
                "Git 操作失败：请检查分支、提交或文件是否存在",
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

fn cookie(headers: &HeaderMap) -> Option<&str> {
    named_cookie(headers, "wuling_session")
}
fn named_cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut matches = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|h| h.to_str().ok())
        .flat_map(|h| h.split(';'))
        .filter_map(|part| part.trim().split_once('='))
        .filter(|(key, _)| *key == name)
        .map(|(_, value)| value);
    let first = matches.next()?;
    if matches.next().is_some() {
        None
    } else {
        Some(first)
    }
}

fn valid_origin(origin: &str) -> bool {
    let Ok(uri) = origin.parse::<axum::http::Uri>() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    // Authority 解析允许非数字或越界端口；显式端口必须能表示为 u16。
    let host = authority.host();
    let Some(suffix) = authority.as_str().strip_prefix(host) else {
        return false;
    };
    let valid_port = suffix.is_empty()
        || suffix.strip_prefix(':').is_some_and(|port| {
            !port.is_empty()
                && port.bytes().all(|byte| byte.is_ascii_digit())
                && port.parse::<u16>().is_ok()
        });
    let allowed = uri.scheme_str() == Some("https")
        || (uri.scheme_str() == Some("http")
            && matches!(uri.host(), Some("localhost" | "127.0.0.1")));
    allowed
        && valid_port
        && !authority.as_str().contains('@')
        && !origin.contains(['?', '#'])
        && origin == format!("{}://{}", uri.scheme_str().unwrap_or_default(), authority)
}

async fn boundary(State(app): State<App>, request: axum::extract::Request, next: Next) -> Response {
    let mut response = if !matches!(
        *request.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) && request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        != Some(app.origin.as_str())
    {
        error(StatusCode::FORBIDDEN, "写请求必须来自 WULING_WEB_ORIGIN").into_response()
    } else {
        next.run(request).await
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "private, no-store".parse().unwrap());
    response
        .headers_mut()
        .insert(header::VARY, "Cookie".parse().unwrap());
    response
}

#[derive(Deserialize)]
struct Login {
    username: String,
    password: String,
}
async fn login(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<Login>,
) -> Result<Response> {
    let user = iam::authenticate(&app.db, &input.username, input.password)
        .await
        .map_err(|_| unauthorized())?;
    let mut db = wuling_storage::connect_local(&app.database_url)
        .await
        .map_err(internal)?;
    let credentials = iam::web::start(
        &mut db,
        &app.jwt,
        user.id,
        app.session_days,
        cookie(&headers),
        named_cookie(&headers, "wuling_refresh"),
    )
    .await
    .map_err(internal)?;
    let mut response = Json(user).into_response();
    credential_cookies(&mut response, &app, Some(&credentials));
    Ok(response)
}
async fn me(State(app): State<App>, headers: HeaderMap) -> Result<Json<User>> {
    Ok(Json(app.user(&headers).await?.ok_or_else(unauthorized)?))
}
async fn logout(State(app): State<App>, headers: HeaderMap) -> Result<Response> {
    iam::web::revoke(
        app.db.as_ref(),
        &app.jwt,
        cookie(&headers),
        named_cookie(&headers, "wuling_refresh"),
    )
    .await
    .map_err(internal)?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    credential_cookies(&mut response, &app, None);
    Ok(response)
}
async fn refresh(State(app): State<App>, headers: HeaderMap) -> Result<Response> {
    let credentials = if let Some(token) = named_cookie(&headers, "wuling_refresh") {
        let mut db = wuling_storage::connect_local(&app.database_url)
            .await
            .map_err(internal)?;
        iam::web::refresh(&mut db, &app.jwt, token)
            .await
            .map_err(internal)?
    } else {
        None
    };
    let mut response = if credentials.is_some() {
        StatusCode::NO_CONTENT.into_response()
    } else {
        unauthorized().into_response()
    };
    credential_cookies(&mut response, &app, credentials.as_ref());
    Ok(response)
}
fn credential_cookies(
    response: &mut Response,
    app: &App,
    credentials: Option<&iam::web::Credentials>,
) {
    let access = credentials.map_or("", |c| c.access.as_str());
    let refresh = credentials.map_or("", |c| c.refresh.as_str());
    let ttl = credentials.map_or(0, |c| c.refresh_seconds);
    let secure = if app.secure { "; Secure" } else { "" };
    for value in [
        format!(
            "wuling_session={access}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{}",
            ttl.min(iam::web::ACCESS_SECONDS),
            secure
        ),
        format!(
            "wuling_refresh={refresh}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age={ttl}{secure}"
        ),
    ] {
        response
            .headers_mut()
            .append(header::SET_COOKIE, value.parse().expect("受控 Cookie 字符"));
    }
}
async fn disable_user(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    let admin = app.user(&headers).await?.ok_or_else(unauthorized)?;
    if !admin.admin {
        return Err(error(StatusCode::FORBIDDEN, "需要管理员身份"));
    }
    // 单 SQL 中更新状态和撤销会话，重新启用也不会恢复旧凭据。
    app.db
        .execute(
            "WITH disabled AS (UPDATE users SET active=false WHERE id=$1
         AND EXISTS (SELECT 1 FROM users WHERE id=$2 AND active AND admin) RETURNING id)
         UPDATE web_sessions SET revoked_at=now() WHERE user_id IN (SELECT id FROM disabled)",
            &[&id, &admin.id],
        )
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn repos(State(app): State<App>, headers: HeaderMap) -> Result<Json<Value>> {
    let uid = app.read_user(&headers).await?.map(|u| u.id);
    let rows = app.db.query(
        "SELECT row_to_json(r) FROM repositories r WHERE r.public OR r.owner_id=$1
         OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id=r.id AND m.user_id=$1) ORDER BY r.id",
        &[&uid],
    ).await.map_err(internal)?;
    Ok(Json(json!(
        rows.iter()
            .map(|r| r.get::<_, Value>(0))
            .collect::<Vec<_>>()
    )))
}
#[derive(Deserialize)]
struct NewRepo {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    public: bool,
}
async fn create_repo(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<NewRepo>,
) -> Result<(StatusCode, Json<Value>)> {
    let user = app.user(&headers).await?.ok_or_else(unauthorized)?;
    if input.name.is_empty()
        || input.name.len() > 80
        || !input
            .name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || input.description.len() > 2000
    {
        return Err(error(StatusCode::BAD_REQUEST, "无效仓库名或描述"));
    }
    let mut db = wuling_storage::connect_local(&app.database_url)
        .await
        .map_err(internal)?;
    let tx = db.transaction().await.map_err(internal)?;
    if tx
        .query_opt(
            "SELECT id FROM users WHERE id=$1 AND active FOR SHARE",
            &[&user.id],
        )
        .await
        .map_err(internal)?
        .is_none()
    {
        return Err(unauthorized());
    }
    let row = tx.query_one(
        "INSERT INTO repositories(owner_id,name,description,public) VALUES($1,$2,$3,$4) RETURNING id",
        &[&user.id,&input.name,&input.description,&input.public],
    ).await.map_err(|e| {
        if e.code()==Some(&tokio_postgres::error::SqlState::UNIQUE_VIOLATION) {
            error(StatusCode::CONFLICT,"仓库名已存在")
        } else { internal(e) }
    })?;
    let id: i64 = row.get(0);
    let path = app.root.join("repos").join(format!("{id}.git"));
    // 不覆盖磁盘已有目录；导入必须先完成，Git/SQL 失败遗留需由部署者核对。
    tokio::fs::create_dir(&path).await.map_err(internal)?;
    let output = Command::new("git")
        .args(["init", "--bare", "--initial-branch=main"])
        .arg(&path)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(internal)?;
    if !output.status.success() {
        return Err(internal("git init"));
    }
    let repo: Value = tx
        .query_one(
            "SELECT row_to_json(r) FROM repositories r WHERE id=$1",
            &[&id],
        )
        .await
        .map_err(internal)?
        .get(0);
    tx.commit().await.map_err(internal)?;
    Ok((StatusCode::CREATED, Json(repo)))
}
async fn repo(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    Ok(Json(app.repo(id, &headers).await?))
}
async fn branches(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    Ok(Json(json!(
        app.git(
            id,
            &["for-each-ref", "--format=%(refname:short)", "refs/heads/"]
        )
        .await?
        .lines()
        .collect::<Vec<_>>()
    )))
}
#[derive(Deserialize)]
struct GitQuery {
    #[serde(default = "main_branch")]
    branch: String,
    #[serde(default)]
    path: String,
}
fn main_branch() -> String {
    "main".into()
}
fn check_ref(branch: &str) -> Result<()> {
    if branch.is_empty()
        || branch.starts_with('-')
        || branch.contains([':', '\\', '\0', '\n'])
        || branch.contains("..")
        || branch.len() > 200
    {
        return Err(error(StatusCode::BAD_REQUEST, "无效分支"));
    }
    Ok(())
}
async fn tree(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<GitQuery>,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    check_ref(&q.branch)?;
    Ok(Json(json!(
        app.git(
            id,
            &[
                "ls-tree",
                "-r",
                "--name-only",
                &format!("refs/heads/{}", q.branch)
            ]
        )
        .await?
        .lines()
        .collect::<Vec<_>>()
    )))
}
async fn blob(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<GitQuery>,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    check_ref(&q.branch)?;
    if q.path.len() > 1024 || q.path.contains('\0') {
        return Err(error(StatusCode::BAD_REQUEST, "无效文件路径"));
    }
    let object = format!("refs/heads/{}:{}", q.branch, q.path);
    if app
        .git(id, &["cat-file", "-s", &object])
        .await?
        .trim()
        .parse::<u64>()
        .unwrap_or(u64::MAX)
        > 1_000_000
    {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "文件超过1MB，请使用Git客户端读取",
        ));
    }
    Ok(Json(
        json!({"content":app.git(id, &["show", &object]).await?}),
    ))
}
fn check_kind(kind: &str) -> Result<()> {
    if ["issues", "merge-requests", "pipelines", "wiki"].contains(&kind) {
        Ok(())
    } else {
        Err(error(StatusCode::NOT_FOUND, "未知资源"))
    }
}
async fn items(
    State(app): State<App>,
    Path((id, kind)): Path<(i64, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    check_kind(&kind)?;
    let rows = app.db.query(
        "SELECT row_to_json(i) FROM historical_items i WHERE repo_id=$1 AND kind=$2 ORDER BY id",
        &[&id, &kind],
    ).await.map_err(internal)?;
    Ok(Json(json!(
        rows.iter()
            .map(|r| r.get::<_, Value>(0))
            .collect::<Vec<_>>()
    )))
}
async fn readonly() -> Error {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "运行时迁移中：历史协作记录暂时只读；不会写入 JSON",
    )
}
async fn insight(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    let rows = app
        .db
        .query(
            "SELECT kind,state,count(*) FROM historical_items WHERE repo_id=$1 GROUP BY kind,state",
            &[&id],
        )
        .await
        .map_err(internal)?;
    let count = |kind: &str, state: Option<&str>| {
        rows.iter()
            .filter(|r| {
                r.get::<_, &str>(0) == kind && state.is_none_or(|s| r.get::<_, &str>(1) == s)
            })
            .map(|r| r.get::<_, i64>(2))
            .sum::<i64>()
    };
    Ok(Json(
        json!({"open_issues":count("issues",Some("open")), "open_merge_requests":count("merge-requests",Some("open")),
        "pipelines_success":count("pipelines",Some("success")), "pipelines_failed":count("pipelines",Some("failed")),
        "wiki_pages":count("wiki",None), "historical_import":true}),
    ))
}
fn router(app: App) -> Router {
    Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({"status":"ok"})) }),
        )
        .route("/api/auth/login", post(login))
        .route("/api/auth/me", get(me))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/refresh", post(refresh))
        .route("/api/auth/tokens", get(tokens).post(create_token))
        .route("/api/auth/tokens/{id}", axum::routing::delete(revoke_token))
        .route("/api/users/{id}/disable", post(disable_user))
        .route("/api/repos", get(repos).post(create_repo))
        .route("/api/repos/{id}", get(repo))
        .route("/api/repos/{id}/branches", get(branches))
        .route("/api/repos/{id}/tree", get(tree))
        .route("/api/repos/{id}/blob", get(blob))
        .route("/api/repos/{id}/insight", get(insight))
        .route("/api/repos/{id}/members", get(members))
        .route(
            "/api/repos/{id}/members/{user_id}",
            axum::routing::put(set_member).delete(remove_member),
        )
        .route(
            "/api/repos/{id}/merge-requests/{item_id}/merge",
            post(readonly),
        )
        .route("/api/repos/{id}/{kind}", get(items).post(readonly))
        .route(
            "/api/repos/{id}/{kind}/{item_id}",
            axum::routing::patch(readonly),
        )
        .layer(middleware::from_fn_with_state(app.clone(), boundary))
        .with_state(app)
}
#[tokio::main]
async fn main() -> wuling_storage::Result<()> {
    let app = App::open(
        std::env::var("WULING_DATA_DIR")
            .unwrap_or_else(|_| "data".into())
            .into(),
        &std::env::var("WULING_DATABASE_URL")?,
        std::env::var("WULING_WEB_ORIGIN")?,
    )
    .await?;
    let addr = std::env::var("WULING_LISTEN").unwrap_or_else(|_| "127.0.0.1:4000".into());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    println!("Wuling API: http://{addr}");
    axum::serve(listener, router(app))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests;

async fn tokens(State(app): State<App>, headers: HeaderMap) -> Result<Json<Value>> {
    let user = app.user(&headers).await?.ok_or_else(unauthorized)?;
    let rows = app.db.query(
        "SELECT id,name,scope,extract(epoch FROM expires_at)::bigint FROM personal_tokens WHERE user_id=$1 ORDER BY id",
        &[&user.id],
    ).await.map_err(internal)?;
    Ok(Json(json!(
        rows.iter()
            .map(|r| json!({"id":r.get::<_,i64>(0),"name":r.get::<_,&str>(1),
        "scope":r.get::<_,&str>(2),"expires_at":r.get::<_,i64>(3)}))
            .collect::<Vec<_>>()
    )))
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum TokenScope {
    Read,
    Write,
}
#[derive(Deserialize)]
struct TokenInput {
    name: String,
    scope: TokenScope,
    expires_in_days: i32,
}
async fn create_token(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<TokenInput>,
) -> Result<(StatusCode, Json<Value>)> {
    let user = app.user(&headers).await?.ok_or_else(unauthorized)?;
    if input.name.trim().is_empty()
        || input.name.len() > 80
        || !(1..=365).contains(&input.expires_in_days)
    {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "名称须为1–80字节；有效期须为1–365天",
        ));
    }
    let scope = match input.scope {
        TokenScope::Read => "read",
        TokenScope::Write => "write",
    };
    let (token, digest) = iam::pat::issue().map_err(internal)?;
    let row = app
        .db
        .query_opt(
            "INSERT INTO personal_tokens(user_id,name,digest,scope,expires_at)
         SELECT id,$2,$3,$4,now()+$5::integer*interval '1 day' FROM users WHERE id=$1 AND active
         RETURNING id,extract(epoch FROM expires_at)::bigint",
            &[
                &user.id,
                &input.name,
                &digest,
                &scope,
                &input.expires_in_days,
            ],
        )
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":row.get::<_,i64>(0),"name":input.name,
        "scope":scope,"expires_at":row.get::<_,i64>(1),"token":token})),
    ))
}
async fn revoke_token(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    let user = app.user(&headers).await?.ok_or_else(unauthorized)?;
    app.db
        .execute(
            "DELETE FROM personal_tokens WHERE id=$1 AND user_id=$2",
            &[&id, &user.id],
        )
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn members(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    let user = app.user(&headers).await?.ok_or_else(unauthorized)?;
    if iam::repository::role(app.db.as_ref(), id, user.id)
        .await
        .map_err(internal)?
        != Some(iam::repository::Role::Maintainer)
    {
        return Err(error(StatusCode::FORBIDDEN, "需要仓库维护者权限"));
    }
    let rows = app.db.query(
        "SELECT u.id,u.username,u.active,CASE WHEN u.id=r.owner_id THEN 'maintainer' ELSE m.role END,
         u.id=r.owner_id FROM repositories r JOIN users u ON u.id=r.owner_id
         OR EXISTS(SELECT 1 FROM repository_members x WHERE x.repo_id=r.id AND x.user_id=u.id)
         LEFT JOIN repository_members m ON m.repo_id=r.id AND m.user_id=u.id WHERE r.id=$1 ORDER BY u.id",
        &[&id],
    ).await.map_err(internal)?;
    Ok(Json(json!(
        rows.iter()
            .map(
                |r| json!({"user_id":r.get::<_,i64>(0),"username":r.get::<_,&str>(1),
        "active":r.get::<_,bool>(2),"role":r.get::<_,&str>(3),"owner":r.get::<_,bool>(4)})
            )
            .collect::<Vec<_>>()
    )))
}

#[derive(Deserialize)]
struct MemberInput {
    role: iam::repository::Role,
}
async fn set_member(
    State(app): State<App>,
    Path((id, target)): Path<(i64, i64)>,
    headers: HeaderMap,
    Json(input): Json<MemberInput>,
) -> Result<StatusCode> {
    change_member(&app, id, target, &headers, Some(input.role)).await
}
async fn remove_member(
    State(app): State<App>,
    Path((id, target)): Path<(i64, i64)>,
    headers: HeaderMap,
) -> Result<StatusCode> {
    change_member(&app, id, target, &headers, None).await
}
async fn change_member(
    app: &App,
    id: i64,
    target: i64,
    headers: &HeaderMap,
    role: Option<iam::repository::Role>,
) -> Result<StatusCode> {
    app.repo(id, headers).await?;
    let actor = app.user(headers).await?.ok_or_else(unauthorized)?;
    let mut db = wuling_storage::connect_local(&app.database_url)
        .await
        .map_err(internal)?;
    let tx = db.transaction().await.map_err(internal)?;
    // 仓库级锁串行化成员变更；锁后重新核对角色，防止并发降权继续修改成员。
    let owner: i64 = tx
        .query_one(
            "SELECT owner_id FROM repositories WHERE id=$1 FOR UPDATE",
            &[&id],
        )
        .await
        .map_err(internal)?
        .get(0);
    if iam::repository::role(&tx, id, actor.id)
        .await
        .map_err(internal)?
        != Some(iam::repository::Role::Maintainer)
    {
        return Err(error(StatusCode::FORBIDDEN, "需要仓库维护者权限"));
    }
    if target == owner {
        return Err(error(
            StatusCode::CONFLICT,
            "不能通过成员接口移除或降权仓库所有者",
        ));
    }
    if let Some(role) = role {
        if tx
            .query_opt(
                "SELECT id FROM users WHERE id=$1 AND active FOR SHARE",
                &[&target],
            )
            .await
            .map_err(internal)?
            .is_none()
        {
            return Err(error(StatusCode::BAD_REQUEST, "目标用户不存在或已停用"));
        }
        tx.execute(
            "INSERT INTO repository_members(repo_id,user_id,role) VALUES($1,$2,$3)
            ON CONFLICT(repo_id,user_id) DO UPDATE SET role=EXCLUDED.role",
            &[&id, &target, &role.as_str()],
        )
        .await
        .map_err(internal)?;
    } else {
        tx.execute(
            "DELETE FROM repository_members WHERE repo_id=$1 AND user_id=$2",
            &[&id, &target],
        )
        .await
        .map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}
