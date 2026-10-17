use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::get,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};
use tokio::{process::Command, sync::Mutex};

type Error = (StatusCode, Json<Value>);
type Result<T> = std::result::Result<T, Error>;
fn error(status: StatusCode, message: &str) -> Error {
    (status, Json(json!({"error": message})))
}
fn internal(_: impl std::fmt::Display) -> Error {
    error(StatusCode::INTERNAL_SERVER_ERROR, "存储或 Git 操作失败")
}
fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

#[derive(Clone, Serialize, Deserialize)]
struct Repo {
    id: u64,
    name: String,
    description: String,
    public: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct Item {
    id: u64,
    repo_id: u64,
    kind: String,
    title: String,
    body: String,
    state: String,
    source: Option<String>,
    target: Option<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct Database {
    repos: Vec<Repo>,
    items: Vec<Item>,
    next_id: u64,
}
#[derive(Clone)]
struct App {
    db: Arc<Mutex<Database>>,
    root: PathBuf,
    token: Arc<String>,
}
impl App {
    async fn open(root: PathBuf, token: String) -> std::io::Result<Self> {
        tokio::fs::create_dir_all(root.join("repos")).await?;
        let db = match tokio::fs::read(root.join("state.json")).await {
            Ok(data) => serde_json::from_slice(&data)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Database::default(),
            Err(e) => return Err(e),
        };
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            root,
            token: Arc::new(token),
        })
    }
    async fn save(&self, db: &Database) -> Result<()> {
        let tmp = self.root.join("state.json.tmp");
        tokio::fs::write(&tmp, serde_json::to_vec_pretty(db).map_err(internal)?)
            .await
            .map_err(internal)?;
        tokio::fs::rename(tmp, self.root.join("state.json"))
            .await
            .map_err(internal)
    }
    fn authorized(&self, headers: &HeaderMap) -> bool {
        headers.get("authorization").and_then(|h| h.to_str().ok())
            == Some(&format!("Bearer {}", self.token))
    }
    fn write(&self, headers: &HeaderMap) -> Result<()> {
        if self.authorized(headers) {
            Ok(())
        } else {
            Err(error(StatusCode::UNAUTHORIZED, "需要管理员访问令牌"))
        }
    }
    async fn repo(&self, id: u64, headers: &HeaderMap) -> Result<Repo> {
        self.db
            .lock()
            .await
            .repos
            .iter()
            .find(|r| r.id == id && (r.public || self.authorized(headers)))
            .cloned()
            .ok_or_else(|| error(StatusCode::NOT_FOUND, "仓库不存在"))
    }
    async fn git(&self, id: u64, args: &[&str]) -> Result<String> {
        let output = Command::new("git")
            .arg("--git-dir")
            .arg(self.root.join("repos").join(format!("{id}.git")))
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
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

#[derive(Deserialize)]
struct NewRepo {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    public: bool,
}
async fn repos(State(app): State<App>, headers: HeaderMap) -> Json<Value> {
    Json(json!(
        app.db
            .lock()
            .await
            .repos
            .iter()
            .filter(|r| r.public || app.authorized(&headers))
            .collect::<Vec<_>>()
    ))
}
async fn create_repo(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<NewRepo>,
) -> Result<(StatusCode, Json<Repo>)> {
    app.write(&headers)?;
    if !valid_name(&input.name) || input.description.len() > 2000 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "仓库名仅支持字母、数字、下划线和短横线（最多80字符）",
        ));
    }
    let mut db = app.db.lock().await;
    if db
        .repos
        .iter()
        .any(|r| r.name.eq_ignore_ascii_case(&input.name))
    {
        return Err(error(StatusCode::CONFLICT, "仓库名已存在"));
    }
    let id = db.next_id + 1;
    let path = app.root.join("repos").join(format!("{id}.git"));
    let output = Command::new("git")
        .args(["init", "--bare", "--initial-branch=main"])
        .arg(&path)
        .output()
        .await
        .map_err(internal)?;
    if !output.status.success() {
        return Err(internal("git init"));
    }
    let repo = Repo {
        id,
        name: input.name,
        description: input.description,
        public: input.public,
    };
    let mut next = db.clone();
    next.next_id = id;
    next.repos.push(repo.clone());
    app.save(&next).await?;
    *db = next;
    Ok((StatusCode::CREATED, Json(repo)))
}
async fn repo(
    State(app): State<App>,
    Path(id): Path<u64>,
    headers: HeaderMap,
) -> Result<Json<Repo>> {
    Ok(Json(app.repo(id, &headers).await?))
}
async fn branches(
    State(app): State<App>,
    Path(id): Path<u64>,
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
    Path(id): Path<u64>,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<GitQuery>,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    check_ref(&q.branch)?;
    let result = app
        .git(
            id,
            &[
                "ls-tree",
                "-r",
                "--name-only",
                &format!("refs/heads/{}", q.branch),
            ],
        )
        .await?;
    Ok(Json(json!(result.lines().collect::<Vec<_>>())))
}
async fn blob(
    State(app): State<App>,
    Path(id): Path<u64>,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<GitQuery>,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    check_ref(&q.branch)?;
    if q.path.len() > 1024 || q.path.contains('\0') {
        return Err(error(StatusCode::BAD_REQUEST, "无效文件路径"));
    }
    let object = format!("refs/heads/{}:{}", q.branch, q.path);
    let size = app.git(id, &["cat-file", "-s", &object]).await?;
    if size.trim().parse::<u64>().unwrap_or(u64::MAX) > 1_000_000 {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "文件超过1MB，请使用Git客户端读取",
        ));
    }
    Ok(Json(
        json!({"content": app.git(id, &["show", &object]).await?}),
    ))
}
async fn items(
    State(app): State<App>,
    Path((id, kind)): Path<(u64, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    check_kind(&kind)?;
    Ok(Json(json!(
        app.db
            .lock()
            .await
            .items
            .iter()
            .filter(|i| i.repo_id == id && i.kind == kind)
            .collect::<Vec<_>>()
    )))
}
fn check_kind(kind: &str) -> Result<()> {
    if ["issues", "merge-requests", "pipelines", "wiki"].contains(&kind) {
        Ok(())
    } else {
        Err(error(StatusCode::NOT_FOUND, "未知资源"))
    }
}
#[derive(Deserialize)]
struct NewItem {
    title: String,
    #[serde(default)]
    body: String,
    source: Option<String>,
    target: Option<String>,
}
async fn create_item(
    State(app): State<App>,
    Path((id, kind)): Path<(u64, String)>,
    headers: HeaderMap,
    Json(input): Json<NewItem>,
) -> Result<(StatusCode, Json<Item>)> {
    app.write(&headers)?;
    app.repo(id, &headers).await?;
    check_kind(&kind)?;
    if input.title.trim().is_empty() || input.title.len() > 300 || input.body.len() > 100_000 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "标题必填（最多300字符），正文最多100KB",
        ));
    }
    if kind == "merge-requests" {
        let source = input
            .source
            .as_deref()
            .ok_or_else(|| error(StatusCode::BAD_REQUEST, "需要源分支"))?;
        let target = input
            .target
            .as_deref()
            .ok_or_else(|| error(StatusCode::BAD_REQUEST, "需要目标分支"))?;
        check_ref(source)?;
        check_ref(target)?;
        if source == target {
            return Err(error(StatusCode::BAD_REQUEST, "源分支和目标分支不能相同"));
        }
        app.git(
            id,
            &["rev-parse", "--verify", &format!("refs/heads/{source}")],
        )
        .await?;
        app.git(
            id,
            &["rev-parse", "--verify", &format!("refs/heads/{target}")],
        )
        .await?;
    }
    let mut db = app.db.lock().await;
    let item = Item {
        id: db.next_id + 1,
        repo_id: id,
        kind: kind.clone(),
        title: input.title,
        body: input.body,
        state: if kind == "pipelines" {
            "queued"
        } else {
            "open"
        }
        .into(),
        source: input.source,
        target: input.target,
    };
    let mut next = db.clone();
    next.next_id = item.id;
    next.items.push(item.clone());
    app.save(&next).await?;
    *db = next;
    Ok((StatusCode::CREATED, Json(item)))
}
#[derive(Deserialize)]
struct EditItem {
    state: Option<String>,
    body: Option<String>,
}
async fn edit_item(
    State(app): State<App>,
    Path((id, kind, item_id)): Path<(u64, String, u64)>,
    headers: HeaderMap,
    Json(edit): Json<EditItem>,
) -> Result<Json<Item>> {
    app.write(&headers)?;
    app.repo(id, &headers).await?;
    check_kind(&kind)?;
    let mut db = app.db.lock().await;
    let mut next = db.clone();
    let item = next
        .items
        .iter_mut()
        .find(|i| i.id == item_id && i.repo_id == id && i.kind == kind)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "资源不存在"))?;
    if let Some(body) = edit.body {
        if body.len() > 100_000 {
            return Err(error(StatusCode::BAD_REQUEST, "正文过长"));
        }
        item.body = body;
    }
    if let Some(state) = edit.state {
        let allowed = match kind.as_str() {
            "pipelines" => matches!(
                (item.state.as_str(), state.as_str()),
                ("queued", "running" | "canceled") | ("running", "success" | "failed" | "canceled")
            ),
            "merge-requests" => matches!(state.as_str(), "open" | "closed"),
            _ => matches!(state.as_str(), "open" | "closed"),
        };
        if !allowed {
            return Err(error(
                StatusCode::BAD_REQUEST,
                "无效状态转换；合并请使用 merge 接口",
            ));
        }
        item.state = state;
    }
    let result = item.clone();
    app.save(&next).await?;
    *db = next;
    Ok(Json(result))
}
async fn merge(
    State(app): State<App>,
    Path((id, item_id)): Path<(u64, u64)>,
    headers: HeaderMap,
) -> Result<Json<Item>> {
    app.write(&headers)?;
    app.repo(id, &headers).await?;
    let mut db = app.db.lock().await;
    let mut next = db.clone();
    let item = next
        .items
        .iter_mut()
        .find(|i| i.id == item_id && i.repo_id == id && i.kind == "merge-requests")
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "合并请求不存在"))?;
    if item.state != "open" {
        return Err(error(StatusCode::CONFLICT, "仅可合并打开的请求"));
    }
    let source = format!("refs/heads/{}", item.source.as_deref().unwrap_or(""));
    let target = format!("refs/heads/{}", item.target.as_deref().unwrap_or(""));
    let old = app.git(id, &["rev-parse", "--verify", &target]).await?;
    let new = app.git(id, &["rev-parse", "--verify", &source]).await?;
    app.git(id, &["merge-base", "--is-ancestor", old.trim(), new.trim()])
        .await?;
    app.git(id, &["update-ref", &target, new.trim(), old.trim()])
        .await?;
    item.state = "merged".into();
    let result = item.clone();
    app.save(&next).await?;
    *db = next;
    Ok(Json(result))
}
async fn insight(
    State(app): State<App>,
    Path(id): Path<u64>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    app.repo(id, &headers).await?;
    let db = app.db.lock().await;
    let count = |kind: &str, state: &str| {
        db.items
            .iter()
            .filter(|i| i.repo_id == id && i.kind == kind && i.state == state)
            .count()
    };
    Ok(Json(
        json!({"open_issues": count("issues", "open"), "open_merge_requests": count("merge-requests", "open"), "pipelines_success": count("pipelines", "success"), "pipelines_failed": count("pipelines", "failed"), "wiki_pages": db.items.iter().filter(|i| i.repo_id == id && i.kind == "wiki").count()}),
    ))
}
fn router(app: App) -> Router {
    Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({"status":"ok"})) }),
        )
        .route("/api/repos", get(repos).post(create_repo))
        .route("/api/repos/{id}", get(repo))
        .route("/api/repos/{id}/branches", get(branches))
        .route("/api/repos/{id}/tree", get(tree))
        .route("/api/repos/{id}/blob", get(blob))
        .route("/api/repos/{id}/insight", get(insight))
        .route(
            "/api/repos/{id}/merge-requests/{item_id}/merge",
            axum::routing::post(merge),
        )
        .route("/api/repos/{id}/{kind}", get(items).post(create_item))
        .route(
            "/api/repos/{id}/{kind}/{item_id}",
            axum::routing::patch(edit_item),
        )
        .with_state(app)
}
#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let token =
        std::env::var("WULING_ADMIN_TOKEN").expect("请设置 WULING_ADMIN_TOKEN（至少32字符）");
    assert!(token.len() >= 32, "WULING_ADMIN_TOKEN 至少32字符");
    let app = App::open(
        std::env::var("WULING_DATA_DIR")
            .unwrap_or_else(|_| "data".into())
            .into(),
        token,
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
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;
    async fn call(
        app: &App,
        method: &str,
        uri: &str,
        payload: Value,
        auth: bool,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json");
        if auth {
            request = request.header("authorization", "Bearer test-token");
        }
        let response = router(app.clone())
            .oneshot(request.body(Body::from(payload.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), 1_000_000).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }
    #[tokio::test]
    async fn rejects_public_registration_and_remote_bootstrap() {
        let dir =
            std::env::temp_dir().join(format!("wuling-no-registration-{}", std::process::id()));
        let app = App::open(dir.clone(), "test-token".into()).await.unwrap();
        for uri in [
            "/api/register",
            "/api/auth/register",
            "/api/bootstrap",
            "/api/auth/bootstrap",
            "/api/users",
        ] {
            for auth in [false, true] {
                let (status, _) =
                    call(&app, "POST", uri, json!({"username": "intruder"}), auth).await;
                assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
            }
        }
        tokio::fs::remove_dir_all(dir).await.unwrap();
    }

    #[tokio::test]
    async fn collaboration_lifecycle_and_scope() {
        let dir = std::env::temp_dir().join(format!("wuling-collaboration-{}", std::process::id()));
        let app = App::open(dir.clone(), "test-token".into()).await.unwrap();
        let (status, repo) = call(
            &app,
            "POST",
            "/api/repos",
            json!({"name":"public", "public":true}),
            true,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let id = repo["id"].as_u64().unwrap();
        let base = format!("/api/repos/{id}");
        for kind in ["issues", "wiki", "pipelines"] {
            let (_, item) = call(
                &app,
                "POST",
                &format!("{base}/{kind}"),
                json!({"title":"first", "body":"content"}),
                true,
            )
            .await;
            let item_id = item["id"].as_u64().unwrap();
            let uri = format!("{base}/{kind}/{item_id}");
            assert_eq!(
                call(&app, "PATCH", &uri, json!({"body":"stolen"}), false)
                    .await
                    .0,
                StatusCode::UNAUTHORIZED
            );
            assert_eq!(
                call(
                    &app,
                    "PATCH",
                    &format!("/api/repos/999/{kind}/{item_id}"),
                    json!({"body":"wrong repo"}),
                    true
                )
                .await
                .0,
                StatusCode::NOT_FOUND
            );
            if kind == "pipelines" {
                assert_eq!(
                    call(&app, "PATCH", &uri, json!({"state":"success"}), true)
                        .await
                        .0,
                    StatusCode::BAD_REQUEST
                );
                assert_eq!(
                    call(&app, "PATCH", &uri, json!({"state":"running"}), true)
                        .await
                        .0,
                    StatusCode::OK
                );
                assert_eq!(
                    call(&app, "PATCH", &uri, json!({"state":"success"}), true)
                        .await
                        .0,
                    StatusCode::OK
                );
            } else {
                let (status, updated) = call(
                    &app,
                    "PATCH",
                    &uri,
                    json!({"state":"closed", "body":"edited"}),
                    true,
                )
                .await;
                assert_eq!(status, StatusCode::OK);
                assert_eq!(updated["body"], "edited");
            }
        }
        let (_, summary) = call(&app, "GET", &format!("{base}/insight"), Value::Null, false).await;
        assert_eq!(summary["pipelines_success"], 1);
        assert_eq!(summary["open_issues"], 0);
        assert_eq!(summary["wiki_pages"], 1);
        assert_eq!(
            call(
                &app,
                "POST",
                &format!("{base}/merge-requests"),
                json!({"title":"bad", "source":"main", "target":"main"}),
                true
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        tokio::fs::remove_dir_all(dir).await.unwrap();
    }
    #[test]
    fn rejects_unsafe_names_and_refs() {
        assert!(!valid_name("../escape"));
        assert!(valid_name("my-repo"));
        assert!(check_ref("--all").is_err());
        assert!(check_ref("feature/one").is_ok());
    }
    #[tokio::test]
    async fn real_git_browse_and_fast_forward_merge() {
        let dir = std::env::temp_dir().join(format!("wuling-git-{}", std::process::id()));
        let app = App::open(dir.clone(), "test-token".into()).await.unwrap();
        let (_, repo) = call(
            &app,
            "POST",
            "/api/repos",
            json!({"name":"git-test", "public":true}),
            true,
        )
        .await;
        let id = repo["id"].as_u64().unwrap();
        let work = dir.join("work");
        tokio::fs::create_dir_all(&work).await.unwrap();
        async fn git(work: &std::path::Path, args: &[&str]) {
            let output = Command::new("git")
                .current_dir(work)
                .args([
                    "-c",
                    "user.name=Wuling Test",
                    "-c",
                    "user.email=test@example.invalid",
                ])
                .args(args)
                .output()
                .await
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        git(&work, &["init", "--initial-branch=main"]).await;
        tokio::fs::write(work.join("README.md"), "first\n")
            .await
            .unwrap();
        git(&work, &["add", "README.md"]).await;
        git(&work, &["commit", "-m", "first"]).await;
        git(&work, &["checkout", "-b", "feature"]).await;
        tokio::fs::write(work.join("README.md"), "second\n")
            .await
            .unwrap();
        git(&work, &["commit", "-am", "second"]).await;
        let remote = dir.join("repos").join(format!("{id}.git"));
        git(
            &work,
            &["push", remote.to_str().unwrap(), "main", "feature"],
        )
        .await;
        let base = format!("/api/repos/{id}");
        let (status, tree) = call(&app, "GET", &format!("{base}/tree"), Value::Null, false).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(tree[0], "README.md");
        let (_, blob) = call(
            &app,
            "GET",
            &format!("{base}/blob?path=README.md"),
            Value::Null,
            false,
        )
        .await;
        assert_eq!(blob["content"], "first\n");
        let (status, mr) = call(
            &app,
            "POST",
            &format!("{base}/merge-requests"),
            json!({"title":"merge feature", "source":"feature", "target":"main"}),
            true,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let uri = format!("{base}/merge-requests/{}/merge", mr["id"]);
        let (status, merged) = call(&app, "POST", &uri, json!({}), true).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(merged["state"], "merged");
        let (_, blob) = call(
            &app,
            "GET",
            &format!("{base}/blob?path=README.md"),
            Value::Null,
            false,
        )
        .await;
        assert_eq!(blob["content"], "second\n");
        assert_eq!(
            call(&app, "POST", &uri, json!({}), true).await.0,
            StatusCode::CONFLICT
        );
        tokio::fs::remove_dir_all(dir).await.unwrap();
    }
    #[tokio::test]
    async fn api_persists_and_protects_private_repos() {
        let dir = std::env::temp_dir().join(format!("wuling-test-{}", std::process::id()));
        let app = App::open(dir.clone(), "test-token".into()).await.unwrap();
        let request = |auth: bool| {
            let mut r = Request::builder()
                .method("POST")
                .uri("/api/repos")
                .header("content-type", "application/json");
            if auth {
                r = r.header("authorization", "Bearer test-token");
            }
            r.body(Body::from(r#"{"name":"private"}"#)).unwrap()
        };
        assert_eq!(
            router(app.clone())
                .oneshot(request(false))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            router(app.clone())
                .oneshot(request(true))
                .await
                .unwrap()
                .status(),
            StatusCode::CREATED
        );
        let response = router(app)
            .oneshot(
                Request::builder()
                    .uri("/api/repos")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            &to_bytes(response.into_body(), 1000).await.unwrap()[..],
            b"[]"
        );
        assert_eq!(
            App::open(dir.clone(), "test-token".into())
                .await
                .unwrap()
                .db
                .lock()
                .await
                .repos
                .len(),
            1
        );
        tokio::fs::remove_dir_all(dir).await.unwrap();
    }
}
