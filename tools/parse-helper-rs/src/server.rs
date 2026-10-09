//! HTTP contract of the Python helper, for `/v1/health`, `/v1/pair`, `/v1/ocr`, and `/v1/cloud/parse`.
//! `/v1/jobs` answers 501: Docling / TableFormer is not in this process.

use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::{from_fn_with_state, Next};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use futures_core::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc::{self, UnboundedReceiver};

use crate::auth::token_matches;
use crate::cache::ParseCache;
use crate::cloud::{
    run_llamaparse, target_pages, Cancel, CloudClient, ParseRequest, DEFAULT_TIMEOUT_S, TIERS,
};
use crate::hashutil::{ocr_options_hash, sha256_hex};
use crate::ocr::{run_cells, run_pdf};
use crate::pair::{close_window, window_open};
use crate::pdf;

pub const HELPER_NAME: &str = "plexus-parse-helper";
pub const HELPER_VERSION: &str = "0.1.0-rs";
pub const SCHEMA_ID: &str = "pxd-parse/1";
pub const MAX_BODY: usize = 200 * 1024 * 1024;

const ALLOW_HEADERS: &str = "Authorization, Content-Type, X-Pxd-Options, X-Pxd-Cloud-Key";
const ALLOW_METHODS: &str = "GET, POST, DELETE, HEAD, OPTIONS";

pub struct App {
    pub token: String,
    pub allow: HashSet<String>,
    pub pair_path: PathBuf,
    pub cache: ParseCache,
    pub pdfium_path: PathBuf,
    pub ocr_lock: Mutex<()>,
    pub busy: AtomicU32,
    pub pair_lock: Mutex<()>,
    pub cloud: CloudClient,
    /// Empty in `serve`. Tests point LlamaParse at a local mock.
    pub cloud_base: Option<String>,
    pub cloud_jobs: Mutex<HashMap<String, Cancel>>,
}

impl App {
    pub fn new(
        token: impl Into<String>,
        allow: HashSet<String>,
        pair_path: PathBuf,
        cache: ParseCache,
        pdfium_path: PathBuf,
    ) -> Result<Self, String> {
        Ok(Self {
            token: token.into(),
            allow,
            pair_path,
            cache,
            pdfium_path,
            ocr_lock: Mutex::new(()),
            busy: AtomicU32::new(0),
            pair_lock: Mutex::new(()),
            cloud: CloudClient::new()?,
            cloud_base: None,
            cloud_jobs: Mutex::new(HashMap::new()),
        })
    }
}

pub fn router(state: Arc<App>) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/pair", get(pair_route))
        .route("/v1/models", get(models))
        .route(
            "/v1/models/download",
            post(download_models).delete(cancel_download),
        )
        .route("/v1/cache/{sha256}", get(get_cache).head(head_cache))
        .route("/v1/ocr", post(post_ocr))
        .route("/v1/jobs", post(post_job))
        .route("/v1/jobs/{job_id}", get(get_job).delete(delete_job))
        .route("/v1/jobs/{job_id}/events", get(job_events))
        .route("/v1/cloud/parse", post(post_cloud))
        .route("/v1/cloud/parse/{job_id}", delete(delete_cloud))
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .layer(from_fn_with_state(state.clone(), origin_guard))
        .with_state(state)
}

async fn origin_guard(State(state): State<Arc<App>>, request: Request, next: Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    if let Some(origin) = origin.as_deref() {
        if !state.allow.contains(origin) {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "forbidden", "origin": origin})),
            )
                .into_response();
        }
    }
    if let Some(len) = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok())
    {
        if len > MAX_BODY {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({"error": "too large"})),
            )
                .into_response();
        }
    }
    if request.method() == Method::OPTIONS {
        let mut response = StatusCode::NO_CONTENT.into_response();
        if let Some(origin) = origin.as_deref() {
            apply_cors(response.headers_mut(), origin);
        }
        return response;
    }
    let mut response = next.run(request).await;
    if let Some(origin) = origin.as_deref() {
        apply_cors(response.headers_mut(), origin);
    }
    response
}

fn apply_cors(headers: &mut HeaderMap, origin: &str) {
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        origin
            .parse()
            .unwrap_or(header::HeaderValue::from_static("null")),
    );
    headers.insert(header::VARY, header::HeaderValue::from_static("Origin"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        header::HeaderValue::from_static(ALLOW_HEADERS),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        header::HeaderValue::from_static(ALLOW_METHODS),
    );
    headers.insert(
        "access-control-allow-private-network",
        header::HeaderValue::from_static("true"),
    );
}

fn authed(headers: &HeaderMap, token: &str) -> bool {
    token_matches(
        headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok()),
        token,
    )
}

async fn health(State(state): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"helper": HELPER_NAME, "auth": "required"})),
        )
            .into_response();
    }
    Json(json!({
        "helper": HELPER_NAME,
        "version": HELPER_VERSION,
        "schema": SCHEMA_ID,
        "engines": ["ocr", "cloud"],
        "models": {"layout": "missing", "tableformer": "missing", "ocr": "ready"},
        "busy": state.busy.load(Ordering::Relaxed),
        "warm": false,
    }))
    .into_response()
}

async fn pair_route(State(state): State<Arc<App>>, headers: HeaderMap) -> Response {
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    let Some(origin) = origin else {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not found"}))).into_response();
    };
    if !state.allow.contains(origin) {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not found"}))).into_response();
    }
    let _guard = state
        .pair_lock
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if !window_open(&state.pair_path) || !close_window(&state.pair_path) {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not found"}))).into_response();
    }
    let mut response = Json(json!({
        "token": state.token,
        "helper": HELPER_NAME,
        "version": HELPER_VERSION,
    }))
    .into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

async fn models(State(state): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    Json(json!({
        "state": "missing",
        "items": [
            {"name": "layout", "state": "missing", "bytes": 0, "done": 0},
            {"name": "tableformer", "state": "missing", "bytes": 0, "done": 0},
            {"name": "ocr", "state": "ready", "bytes": 0, "done": 0}
        ],
        "bytes": 0,
        "done": 0,
        "fraction": 1.0
    }))
    .into_response()
}

async fn download_models(State(state): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({"error": "layout models are not bundled; OCR uses Apple Vision"})),
    )
        .into_response()
}

async fn cancel_download(State(state): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    Json(json!({"stopped": false})).into_response()
}

#[derive(Deserialize)]
struct OptsQuery {
    opts: Option<String>,
}

async fn head_cache(
    State(state): State<Arc<App>>,
    headers: HeaderMap,
    Path(sha): Path<String>,
    Query(query): Query<OptsQuery>,
) -> Response {
    if !authed(&headers, &state.token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let opts = query.opts.unwrap_or_default();
    if state.cache.get(&sha, &opts).is_some() {
        StatusCode::OK.into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn get_cache(
    State(state): State<Arc<App>>,
    headers: HeaderMap,
    Path(sha): Path<String>,
    Query(query): Query<OptsQuery>,
) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    let opts = query.opts.unwrap_or_default();
    match state.cache.get(&sha, &opts) {
        Some(doc) => Json(doc).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "miss"}))).into_response(),
    }
}

async fn post_job(State(state): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": "layout model is not wired; this helper serves /v1/ocr only",
            "code": "no-docling"
        })),
    )
        .into_response()
}

async fn get_job(State(state): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    (StatusCode::NOT_FOUND, Json(json!({"error": "missing"}))).into_response()
}

async fn delete_job(State(state): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    (StatusCode::NOT_FOUND, Json(json!({"error": "missing"}))).into_response()
}

async fn job_events(State(state): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    (StatusCode::NOT_FOUND, Json(json!({"error": "missing"}))).into_response()
}

async fn post_ocr(State(state): State<Arc<App>>, headers: HeaderMap, body: Bytes) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "empty body"})),
        )
            .into_response();
    }
    if body.len() > MAX_BODY {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": "too large"})),
        )
            .into_response();
    }
    let raw = headers
        .get("x-pxd-options")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("{}");
    let options: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "bad X-Pxd-Options"})),
            )
                .into_response()
        }
    };
    let pages = options.get("pages").filter(|v| !v.is_null()).cloned();
    let cells = options.get("cells").cloned();
    let sha = sha256_hex(&body);
    let ohash = ocr_options_hash(pages.as_ref());
    let cell_list = match &cells {
        Some(Value::Array(items)) if !items.is_empty() => Some(items.clone()),
        _ => None,
    };
    let cells_request = cell_list.is_some();
    if !cells_request {
        if let Some(mut hit) = state.cache.get(&sha, &ohash) {
            if let Some(obj) = hit.as_object_mut() {
                obj.insert("cached".into(), Value::Bool(true));
            }
            return Json(hit).into_response();
        }
    }
    let pdfium_path = state.pdfium_path.clone();
    let state_bg = state.clone();
    let started = std::time::Instant::now();
    let joined = tokio::task::spawn_blocking(move || {
        let _guard = state_bg
            .ocr_lock
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        state_bg.busy.fetch_add(1, Ordering::Relaxed);
        let result = run_ocr_blocking(&pdfium_path, &body, pages.as_ref(), cell_list.as_deref());
        state_bg.busy.fetch_sub(1, Ordering::Relaxed);
        result
    })
    .await;
    let result = match joined {
        Ok(result) => result,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("ocr failed: {err}")})),
            )
                .into_response()
        }
    };
    let mut doc = match result {
        Ok(doc) => doc,
        Err(err) => {
            let status = if err.starts_with("not a pdf")
                || err.contains("page cap")
                || err.contains("cells cap")
                || err.contains("bad page")
                || err.contains("no pages")
                || err.contains("missing")
                || err.contains("bbox")
            {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
                format!("ocr failed: {err}")
            } else {
                err
            };
            return (status, Json(json!({"error": message}))).into_response();
        }
    };
    if let Some(obj) = doc.as_object_mut() {
        obj.insert("sha256".into(), Value::String(sha.clone()));
        obj.insert(
            "elapsedMs".into(),
            json!(started.elapsed().as_millis() as u64),
        );
        obj.insert("cached".into(), Value::Bool(false));
    }
    if !cells_request {
        let _ = state.cache.put(&sha, &ohash, &doc);
    }
    Json(doc).into_response()
}

fn run_ocr_blocking(
    pdfium_path: &std::path::Path,
    bytes: &[u8],
    pages: Option<&Value>,
    cells: Option<&[Value]>,
) -> Result<Value, String> {
    let mut tmp = std::env::temp_dir();
    tmp.push(format!(
        "pxd-ocr-{}-{}.pdf",
        std::process::id(),
        sha256_hex(bytes).split_at(8).0
    ));
    std::fs::write(&tmp, bytes).map_err(|err| err.to_string())?;
    let pdfium = pdf::bind(pdfium_path)?;
    let result = if let Some(cells) = cells {
        run_cells(&pdfium, &tmp, cells)
    } else {
        run_pdf(&pdfium, &tmp, pages, |_n, _of| {})
    };
    let _ = std::fs::remove_file(&tmp);
    result
}

async fn post_cloud(State(state): State<Arc<App>>, headers: HeaderMap, body: Bytes) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    let api_key = match headers.get("x-pxd-cloud-key") {
        None => String::new(),
        Some(value) => match value.to_str() {
            Ok(text) => text.trim().to_string(),
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "missing cloud key"})),
                )
                    .into_response()
            }
        },
    };
    if api_key.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "missing cloud key"})),
        )
            .into_response();
    }
    let raw = match headers.get("x-pxd-options") {
        None => "{}",
        Some(value) => match value.to_str() {
            Ok(text) => text,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "bad X-Pxd-Options"})),
                )
                    .into_response()
            }
        },
    };
    let options: Value = match serde_json::from_str::<Value>(raw) {
        Ok(value) if value.is_object() => value,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "bad X-Pxd-Options"})),
            )
                .into_response()
        }
    };
    let region = match options.get("region") {
        None | Some(Value::Null) => "us".to_string(),
        Some(Value::String(text)) if text.is_empty() => "us".to_string(),
        Some(Value::String(text)) => text.clone(),
        Some(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "region must be us or eu"})),
            )
                .into_response()
        }
    };
    if region != "us" && region != "eu" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "region must be us or eu"})),
        )
            .into_response();
    }
    let tier = match options.get("tier") {
        None | Some(Value::Null) => "agentic".to_string(),
        Some(Value::String(text)) if text.is_empty() => "agentic".to_string(),
        Some(Value::String(text)) => text.clone(),
        Some(_) => {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad tier"}))).into_response()
        }
    };
    if !TIERS.contains(&tier.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad tier"}))).into_response();
    }
    let pages = target_pages(options.get("pages"));
    if body.len() > MAX_BODY {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": "too large"})),
        )
            .into_response();
    }
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "empty body"})),
        )
            .into_response();
    }

    let mut job_id = format!("c_{}", &sha256_hex(&body)[..8]);
    let cancel = Cancel::new();
    {
        let mut jobs = state
            .cloud_jobs
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        if jobs.contains_key(&job_id) {
            job_id = format!("{job_id}_{}", jobs.len());
        }
        jobs.insert(job_id.clone(), cancel.clone());
    }

    let (tx, rx) = mpsc::unbounded_channel();
    let tx_events = tx.clone();
    let state_task = state.clone();
    let cancel_task = cancel.clone();
    let helper_id = job_id.clone();
    let pdf = body.to_vec();
    let base = state.cloud_base.clone();
    let client = state.cloud.clone();
    let pages_owned = pages;
    tokio::spawn(async move {
        let _guard = JobGuard {
            state: state_task.clone(),
            cancel: cancel_task.clone(),
        };
        let tx_done = tx;
        let alias_state = state_task;
        let alias_cancel = cancel_task.clone();
        let on_event = move |event: &str, payload: Value| {
            if let Some(upstream) = payload.get("job").and_then(|value| value.as_str()) {
                if upstream != helper_id {
                    let mut jobs = alias_state
                        .cloud_jobs
                        .lock()
                        .unwrap_or_else(|err| err.into_inner());
                    jobs.entry(upstream.to_string())
                        .or_insert_with(|| alias_cancel.clone());
                }
            }
            if tx_events.send(Some((event.to_string(), payload))).is_err() {
                alias_cancel.cancel();
            }
        };
        let sleeper = cancel_task.clone();
        let outcome = run_llamaparse(
            &client,
            ParseRequest {
                pdf: &pdf,
                api_key: &api_key,
                region: &region,
                tier: &tier,
                timeout_s: DEFAULT_TIMEOUT_S,
                base_override: base.as_deref(),
                pages: pages_owned.as_deref(),
            },
            &cancel_task,
            on_event,
            {
                let started = std::time::Instant::now();
                move || started.elapsed().as_secs_f64()
            },
            move |delay| {
                let sleeper = sleeper.clone();
                async move { sleeper.sleep(delay).await }
            },
        )
        .await;
        match outcome {
            Ok(result) => {
                let _ = tx_done.send(Some(("result".into(), result)));
            }
            Err(err) => {
                let _ = tx_done.send(Some(("error".into(), err.to_json())));
            }
        }
        let _ = tx_done.send(None);
    });

    Sse::new(CloudStream {
        job_id,
        started: false,
        done: false,
        rx,
        cancel,
    })
    .into_response()
}

async fn delete_cloud(
    State(state): State<Arc<App>>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Response {
    if !authed(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    let cancel = {
        let jobs = state
            .cloud_jobs
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        jobs.get(&job_id).cloned()
    };
    match cancel {
        Some(cancel) => {
            cancel.cancel();
            StatusCode::NO_CONTENT.into_response()
        }
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "missing"}))).into_response(),
    }
}

struct JobGuard {
    state: Arc<App>,
    cancel: Cancel,
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        let mut jobs = self
            .state
            .cloud_jobs
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        jobs.retain(|_, cancel| !cancel.same(&self.cancel));
    }
}

struct CloudStream {
    job_id: String,
    started: bool,
    done: bool,
    rx: UnboundedReceiver<Option<(String, Value)>>,
    cancel: Cancel,
}

impl Drop for CloudStream {
    fn drop(&mut self) {
        if !self.done {
            self.cancel.cancel();
        }
    }
}

impl Stream for CloudStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        if !this.started {
            this.started = true;
            let event = Event::default()
                .event("started")
                .json_data(json!({"job": this.job_id}))
                .expect("started event");
            return Poll::Ready(Some(Ok(event)));
        }
        if this.done {
            return Poll::Ready(None);
        }
        match this.rx.poll_recv(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(None) | Poll::Ready(Some(None)) => {
                this.done = true;
                Poll::Ready(None)
            }
            Poll::Ready(Some(Some((name, payload)))) => {
                if name == "result" || name == "error" {
                    this.done = true;
                }
                let event = Event::default()
                    .event(name)
                    .json_data(&payload)
                    .expect("sse json");
                Poll::Ready(Some(Ok(event)))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pair;
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use tower::ServiceExt;

    fn test_app() -> Router {
        let dir = std::env::temp_dir().join(format!("pxd-rs-http-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        router(Arc::new(
            App::new(
                "test-token",
                HashSet::from(["https://roamresearch.com".into()]),
                dir.join("pair-until"),
                ParseCache::new(dir.join("cache"), 5_000_000),
                PathBuf::from("/missing/libpdfium.dylib"),
            )
            .unwrap(),
        ))
    }

    async fn body_json(response: Response) -> Value {
        let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn health_pair_cors_and_job_stub() {
        let app = test_app();
        let unauth = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(body_json(unauth).await["helper"], "plexus-parse-helper");

        let auth = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/health")
                    .header("authorization", "Bearer test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(auth.status(), StatusCode::OK);
        let health = body_json(auth).await;
        assert_eq!(health["engines"], json!(["ocr", "cloud"]));
        assert_eq!(health["models"]["ocr"], "ready");
        assert_eq!(health["models"]["tableformer"], "missing");

        let forbidden = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/ocr")
                    .method("POST")
                    .header("origin", "https://evil.example")
                    .header("authorization", "Bearer test-token")
                    .body(Body::from("not-empty"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let options = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/ocr")
                    .method("OPTIONS")
                    .header("origin", "https://roamresearch.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(options.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            options
                .headers()
                .get("access-control-allow-origin")
                .unwrap(),
            "https://roamresearch.com"
        );
        assert_eq!(
            options
                .headers()
                .get("access-control-allow-private-network")
                .unwrap(),
            "true"
        );
        assert_eq!(
            options
                .headers()
                .get("access-control-allow-headers")
                .unwrap(),
            "Authorization, Content-Type, X-Pxd-Options, X-Pxd-Cloud-Key"
        );

        let closed = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/pair")
                    .header("origin", "https://roamresearch.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(closed.status(), StatusCode::NOT_FOUND);

        let jobs = app
            .oneshot(
                Request::builder()
                    .uri("/v1/jobs")
                    .method("POST")
                    .header("authorization", "Bearer test-token")
                    .body(Body::from("%PDF"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(jobs.status(), StatusCode::NOT_IMPLEMENTED);
        assert_eq!(body_json(jobs).await["code"], "no-docling");
    }

    #[tokio::test]
    async fn pair_hands_the_token_once() {
        let dir = std::env::temp_dir().join(format!("pxd-rs-pair-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let pair_path = dir.join("pair-until");
        pair::open_window(&pair_path, pair::PAIR_SECONDS).unwrap();
        let app = router(Arc::new(
            App::new(
                "once",
                HashSet::from(["https://roamresearch.com".into()]),
                pair_path,
                ParseCache::new(dir.join("cache"), 1_000_000),
                PathBuf::from("/missing"),
            )
            .unwrap(),
        ));
        let first = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/pair")
                    .header("origin", "https://roamresearch.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(first.headers().get("cache-control").unwrap(), "no-store");
        assert_eq!(body_json(first).await["token"], "once");
        let second = app
            .oneshot(
                Request::builder()
                    .uri("/v1/pair")
                    .header("origin", "https://roamresearch.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(second.status(), StatusCode::NOT_FOUND);
    }
}
