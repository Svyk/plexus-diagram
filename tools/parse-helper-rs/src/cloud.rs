//! Forward one PDF to LlamaParse v2. The API key is used for that request and not stored.
//!
//! Same sequence as `plexus_parse_helper.cloud`: upload, start, poll, expand, then the
//! grounded-cell sidecar when it is https and at most 8 MB. Nothing here writes the key
//! to a log line, an event, or an error string.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::watch;

pub const US: &str = "https://api.cloud.llamaindex.ai";
pub const EU: &str = "https://api.cloud.eu.llamaindex.ai";
pub const TIERS: &[&str] = &["fast", "cost_effective", "agentic", "agentic_plus"];
pub const SIDECAR_CAP: usize = 8 * 1024 * 1024;
pub const DEFAULT_TIMEOUT_S: f64 = 240.0;

const BOUNDARY: &str = "pxdCloud7f3a9c";
const JSON_CAP: usize = 32 * 1024 * 1024;

#[derive(Debug)]
pub struct CloudError {
    pub status: u16,
    pub message: String,
    pub code: String,
}

impl CloudError {
    pub fn new(status: u16, message: impl AsRef<str>, code: &str) -> Self {
        Self {
            status,
            message: truncate(message.as_ref()),
            code: code.to_string(),
        }
    }

    pub fn cancelled() -> Self {
        Self::new(499, "cancelled", "cancelled")
    }

    pub fn timeout() -> Self {
        Self::new(504, "timed out", "timeout")
    }

    pub fn network() -> Self {
        Self::new(502, "provider unreachable", "network")
    }

    pub fn to_json(&self) -> Value {
        json!({
            "code": self.code,
            "message": self.message,
            "status": self.status,
        })
    }
}

impl std::fmt::Display for CloudError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CloudError {}

/// Cooperative cancel. `DELETE /v1/cloud/parse/{id}` sets it; the poll sleep wakes up.
#[derive(Clone)]
pub struct Cancel {
    inner: Arc<CancelInner>,
}

struct CancelInner {
    tx: watch::Sender<bool>,
    // `send` does nothing once the last receiver is gone, so this one stays.
    _rx: watch::Receiver<bool>,
}

impl Cancel {
    pub fn new() -> Self {
        let (tx, rx) = watch::channel(false);
        Self {
            inner: Arc::new(CancelInner { tx, _rx: rx }),
        }
    }

    pub fn cancel(&self) {
        let _ = self.inner.tx.send(true);
    }

    pub fn is_set(&self) -> bool {
        *self.inner.tx.borrow()
    }

    pub fn same(&self, other: &Cancel) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }

    pub async fn cancelled(&self) {
        let mut rx = self.inner.tx.subscribe();
        if *rx.borrow() {
            return;
        }
        loop {
            if rx.changed().await.is_err() {
                return;
            }
            if *rx.borrow() {
                return;
            }
        }
    }

    pub async fn sleep(&self, delay: Duration) {
        if delay.is_zero() || self.is_set() {
            return;
        }
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            _ = self.cancelled() => {}
        }
    }
}

#[derive(Clone)]
pub struct CloudClient {
    http: reqwest::Client,
}

impl CloudClient {
    pub fn new() -> Result<Self, String> {
        // rustls, no OpenSSL, no system proxy. A proxy would see the PDF and the key.
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|err| format!("cloud http client: {err}"))?;
        Ok(Self { http })
    }

    async fn call(
        &self,
        method: &str,
        url: &str,
        headers: &[(&str, &str)],
        body: Option<Vec<u8>>,
        timeout: Duration,
        cancel: &Cancel,
        cap: usize,
    ) -> Result<(u16, Vec<u8>), CloudError> {
        if cancel.is_set() {
            return Err(CloudError::cancelled());
        }
        let method = method
            .parse::<reqwest::Method>()
            .map_err(|_| CloudError::network())?;
        let mut req = self.http.request(method, url).timeout(timeout);
        for (name, value) in headers {
            req = req.header(*name, *value);
        }
        if let Some(body) = body {
            req = req.body(body);
        }
        let send = req.send();
        tokio::pin!(send);
        let response = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(CloudError::cancelled()),
            result = &mut send => result,
        };
        let mut response = match response {
            Ok(response) => response,
            Err(_) if cancel.is_set() => return Err(CloudError::cancelled()),
            Err(_) => return Err(CloudError::network()),
        };
        let status = response.status().as_u16();
        if let Some(len) = response.content_length() {
            if len > cap as u64 {
                return Err(CloudError::new(
                    502,
                    "provider response too large",
                    "provider",
                ));
            }
        }
        let mut buf = Vec::new();
        loop {
            if cancel.is_set() {
                return Err(CloudError::cancelled());
            }
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    if buf.len().saturating_add(chunk.len()) > cap {
                        return Err(CloudError::new(
                            502,
                            "provider response too large",
                            "provider",
                        ));
                    }
                    buf.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(_) if cancel.is_set() => return Err(CloudError::cancelled()),
                Err(_) => return Err(CloudError::network()),
            }
        }
        Ok((status, buf))
    }
}

pub struct ParseRequest<'a> {
    pub pdf: &'a [u8],
    pub api_key: &'a str,
    pub region: &'a str,
    pub tier: &'a str,
    pub timeout_s: f64,
    pub base_override: Option<&'a str>,
}

pub fn base_url(region: &str) -> Result<&'static str, CloudError> {
    match region {
        "us" => Ok(US),
        "eu" => Ok(EU),
        _ => Err(CloudError::new(
            400,
            "region must be us or eu",
            "bad-request",
        )),
    }
}

pub fn tier_ok(tier: &str) -> bool {
    TIERS.contains(&tier)
}

fn endpoint(region: &str, base_override: Option<&str>) -> Result<String, CloudError> {
    let regional = base_url(region)?;
    Ok(base_override
        .unwrap_or(regional)
        .trim_end_matches('/')
        .to_string())
}

/// A sidecar on the real API must be https. A loopback base (the test mock, nothing else
/// this binary sets) may also serve its own sidecar over http.
pub fn sidecar_allowed(url: &str, base: &str) -> bool {
    if url.starts_with("https://") {
        return true;
    }
    let base = base.trim_end_matches('/');
    let loopback = base.starts_with("http://127.0.0.1:") || base.starts_with("http://localhost:");
    loopback && (url == base || url.starts_with(&format!("{base}/")))
}

pub fn multipart_pdf(pdf: &[u8]) -> (Vec<u8>, String) {
    let head = format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\nparse\r\n--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"document.pdf\"\r\nContent-Type: application/pdf\r\n\r\n"
    );
    let mut body = Vec::with_capacity(head.len() + pdf.len() + BOUNDARY.len() + 8);
    body.extend_from_slice(head.as_bytes());
    body.extend_from_slice(pdf);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    (body, format!("multipart/form-data; boundary={BOUNDARY}"))
}

pub async fn run_llamaparse<F, N, S, Fut>(
    client: &CloudClient,
    req: ParseRequest<'_>,
    cancel: &Cancel,
    mut on_event: F,
    mut now: N,
    mut sleep: S,
) -> Result<Value, CloudError>
where
    F: FnMut(&str, Value),
    N: FnMut() -> f64,
    S: FnMut(Duration) -> Fut,
    Fut: Future<Output = ()>,
{
    if !tier_ok(req.tier) {
        return Err(CloudError::new(400, "bad tier", "bad-request"));
    }
    let key = req.api_key.trim();
    if key.is_empty() {
        return Err(CloudError::new(400, "missing cloud key", "bad-request"));
    }
    let base = endpoint(req.region, req.base_override)?;
    let deadline = now() + req.timeout_s;
    let auth = format!("Bearer {key}");

    let remaining = |now: &mut N| -> Result<Duration, CloudError> {
        let left = deadline - now();
        if left <= 0.0 {
            return Err(CloudError::timeout());
        }
        Ok(Duration::from_secs_f64(left.min(60.0)))
    };

    on_event("progress", json!({"status": "uploading"}));
    if cancel.is_set() {
        return Err(CloudError::cancelled());
    }
    let (multipart, content_type) = multipart_pdf(req.pdf);
    let uploaded = call_json(
        client,
        "POST",
        &format!("{base}/api/v1/beta/files"),
        &[
            ("Authorization", auth.as_str()),
            ("Content-Type", content_type.as_str()),
        ],
        Some(multipart),
        remaining(&mut now)?,
        cancel,
    )
    .await?;
    let file_id = uploaded
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| CloudError::new(502, "upload did not return a file id", "bad-json"))?;

    on_event("progress", json!({"status": "starting"}));
    if cancel.is_set() {
        return Err(CloudError::cancelled());
    }
    let start_body = serde_json::to_vec(&json!({
        "file_id": file_id,
        "tier": req.tier,
        "version": "latest",
        "output_options": {"granular_bboxes": ["cell"]},
    }))
    .map_err(|_| CloudError::network())?;
    let created = call_json(
        client,
        "POST",
        &format!("{base}/api/v2/parse"),
        &[
            ("Authorization", auth.as_str()),
            ("Content-Type", "application/json"),
        ],
        Some(start_body),
        remaining(&mut now)?,
        cancel,
    )
    .await?;
    let job = job_obj(&created).clone();
    let job_id = text_field(&job, "id")
        .or_else(|| text_field(&created, "id"))
        .ok_or_else(|| CloudError::new(502, "parse did not return a job id", "bad-json"))?;
    let mut status_name = initial_status(&job);
    let mut last_job = job;
    on_event("progress", json!({"status": status_name, "job": job_id}));

    let mut delay = 1.0_f64;
    while !matches!(status_name.as_str(), "COMPLETED" | "FAILED" | "CANCELLED") {
        if cancel.is_set() {
            remote_cancel(client, &base, &job_id, &auth).await;
            return Err(CloudError::cancelled());
        }
        if now() >= deadline {
            return Err(CloudError::timeout());
        }
        let left = (deadline - now()).max(0.0);
        sleep(Duration::from_secs_f64(delay.min(left))).await;
        delay = (delay * 2.0).min(8.0);
        if cancel.is_set() {
            remote_cancel(client, &base, &job_id, &auth).await;
            return Err(CloudError::cancelled());
        }
        let polled = call_json(
            client,
            "GET",
            &format!("{base}/api/v2/parse/{job_id}"),
            &[("Authorization", auth.as_str())],
            None,
            remaining(&mut now)?,
            cancel,
        )
        .await?;
        last_job = job_obj(&polled).clone();
        status_name = polled_status(&last_job);
        on_event("progress", json!({"status": status_name, "job": job_id}));
    }

    if status_name == "CANCELLED" {
        return Err(CloudError::cancelled());
    }
    if status_name != "COMPLETED" {
        return Err(CloudError::new(502, fail_message(&last_job), "failed"));
    }

    let mut result = call_json(
        client,
        "GET",
        &format!("{base}/api/v2/parse/{job_id}?expand=items&expand=markdown&expand=usage"),
        &[("Authorization", auth.as_str())],
        None,
        remaining(&mut now)?,
        cancel,
    )
    .await?;
    attach_sidecar(client, &mut result, &base, cancel, &mut now, deadline).await?;
    Ok(result)
}

async fn remote_cancel(client: &CloudClient, base: &str, job_id: &str, auth: &str) {
    let url = format!("{base}/api/v2/parse/{job_id}/cancel");
    let _ = client
        .call(
            "POST",
            &url,
            &[
                ("Authorization", auth),
                ("Content-Type", "application/json"),
            ],
            Some(b"{}".to_vec()),
            Duration::from_secs(15),
            &Cancel::new(),
            JSON_CAP,
        )
        .await;
}

async fn attach_sidecar<N>(
    client: &CloudClient,
    result: &mut Value,
    base: &str,
    cancel: &Cancel,
    now: &mut N,
    deadline: f64,
) -> Result<(), CloudError>
where
    N: FnMut() -> f64,
{
    let url = result
        .get("result_content_metadata")
        .and_then(|meta| meta.get("grounded_items"))
        .and_then(|grounded| grounded.get("presigned_url"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !sidecar_allowed(url, base) {
        return Ok(());
    }
    if cancel.is_set() {
        return Err(CloudError::cancelled());
    }
    let left = deadline - now();
    if left <= 0.0 {
        return Err(CloudError::timeout());
    }
    let timeout = Duration::from_secs_f64(left.min(60.0));
    let (status, raw) = match client
        .call("GET", url, &[], None, timeout, cancel, SIDECAR_CAP)
        .await
    {
        Ok(pair) => pair,
        Err(err) if err.code == "cancelled" && cancel.is_set() => return Ok(()),
        Err(_) => return Ok(()),
    };
    if !(200..300).contains(&status) || raw.is_empty() || raw.len() > SIDECAR_CAP {
        return Ok(());
    }
    let pages = decode_sidecar(&raw);
    if !pages.is_empty() {
        if let Some(obj) = result.as_object_mut() {
            obj.insert("grounded_pages".into(), Value::Array(pages));
        }
    }
    Ok(())
}

fn decode_sidecar(raw: &[u8]) -> Vec<Value> {
    let text = String::from_utf8_lossy(raw);
    let mut pages = Vec::new();
    for line in text.split('\n') {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            pages.push(value);
        }
    }
    pages
}

async fn call_json(
    client: &CloudClient,
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body: Option<Vec<u8>>,
    timeout: Duration,
    cancel: &Cancel,
) -> Result<Value, CloudError> {
    if cancel.is_set() {
        return Err(CloudError::cancelled());
    }
    let (status, raw) = match client
        .call(method, url, headers, body, timeout, cancel, JSON_CAP)
        .await
    {
        Ok(pair) => pair,
        Err(err) if err.code == "cancelled" || cancel.is_set() => {
            return Err(CloudError::cancelled())
        }
        Err(err) => return Err(err),
    };
    let parsed = if raw.is_empty() {
        json!({})
    } else {
        loads(&raw)?
    };
    raise_for_status(status, &parsed)?;
    Ok(parsed)
}

fn loads(raw: &[u8]) -> Result<Value, CloudError> {
    let text = std::str::from_utf8(raw)
        .map_err(|_| CloudError::new(502, "provider did not return JSON", "bad-json"))?;
    let value: Value = serde_json::from_str(text)
        .map_err(|_| CloudError::new(502, "provider did not return JSON", "bad-json"))?;
    if !value.is_object() {
        return Err(CloudError::new(
            502,
            "provider did not return an object",
            "bad-json",
        ));
    }
    Ok(value)
}

fn raise_for_status(status: u16, body: &Value) -> Result<(), CloudError> {
    if matches!(status, 401 | 402 | 413 | 429) {
        let message = message_field(body).unwrap_or_else(|| format!("provider {status}"));
        let code = match status {
            401 => "unauthorized",
            402 => "credits",
            413 => "too-large",
            429 => "rate",
            _ => "provider",
        };
        return Err(CloudError::new(status, message, code));
    }
    if !(200..300).contains(&status) {
        return Err(CloudError::new(
            status,
            format!("provider {status}"),
            "provider",
        ));
    }
    Ok(())
}

fn message_field(body: &Value) -> Option<String> {
    for key in ["detail", "error", "message"] {
        let Some(value) = body.get(key) else { continue };
        if value.is_null() {
            continue;
        }
        let text = if let Some(text) = value.as_str() {
            text.to_string()
        } else {
            value.to_string()
        };
        if text.is_empty() {
            continue;
        }
        return Some(text);
    }
    None
}

fn job_obj(body: &Value) -> &Value {
    body.get("job")
        .filter(|job| job.is_object())
        .unwrap_or(body)
}

fn text_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn initial_status(job: &Value) -> String {
    match job.get("status") {
        Some(Value::String(text)) if !text.is_empty() => text.clone(),
        _ => "PENDING".to_string(),
    }
}

fn polled_status(job: &Value) -> String {
    match job.get("status") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
    }
}

fn fail_message(job: &Value) -> String {
    match job.get("error_message") {
        Some(Value::String(text)) if !text.is_empty() => text.clone(),
        Some(Value::Null) | None => "parse failed".to_string(),
        Some(other) => other.to_string(),
    }
}

fn truncate(text: &str) -> String {
    text.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;

    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::{header, HeaderMap, StatusCode};
    use axum::response::IntoResponse;
    use axum::routing::{get, post};
    use axum::{Json, Router};
    use tokio::net::TcpListener;
    use tokio::sync::Notify;

    const PDF: &[u8] = b"%PDF-1.4 synthetic";
    const KEY: &str = "pxd-cloud-test-key";

    #[derive(Clone, Copy)]
    enum Script {
        Poll,
        Immediate,
        Upload401,
        Parse402,
        OffOrigin,
        TooBig,
        BadLine,
    }

    struct MockInner {
        base: String,
        script: Script,
        calls: Mutex<Vec<MockCall>>,
        polls: AtomicU32,
        started: Notify,
    }

    #[derive(Clone)]
    struct MockCall {
        method: String,
        path_and_query: String,
        auth: Option<String>,
        content_type: Option<String>,
        body: Vec<u8>,
    }

    struct Mock {
        base: String,
        inner: Arc<MockInner>,
        server: tokio::task::JoinHandle<()>,
    }

    impl Drop for Mock {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    impl Mock {
        fn calls(&self) -> Vec<MockCall> {
            self.inner
                .calls
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone()
        }
    }

    async fn spawn_mock(script: Script) -> Mock {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        assert_ne!(addr.port(), 48765, "the logged-in helper stays on 48765");
        let base = format!("http://{addr}");
        let inner = Arc::new(MockInner {
            base: base.clone(),
            script,
            calls: Mutex::new(Vec::new()),
            polls: AtomicU32::new(0),
            started: Notify::new(),
        });
        let app = mock_router(inner.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Mock {
            base,
            inner,
            server,
        }
    }

    fn mock_router(state: Arc<MockInner>) -> Router {
        Router::new()
            .route("/api/v1/beta/files", post(files))
            .route("/api/v2/parse", post(start_parse))
            .route("/api/v2/parse/{id}", get(poll_or_result))
            .route("/api/v2/parse/{id}/cancel", post(cancel_job))
            .route("/sidecar", get(sidecar))
            .with_state(state)
    }

    fn record(
        state: &MockInner,
        method: &str,
        path_and_query: &str,
        headers: &HeaderMap,
        body: &[u8],
    ) {
        let auth = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let content_type = headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        state
            .calls
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .push(MockCall {
                method: method.to_string(),
                path_and_query: path_and_query.to_string(),
                auth,
                content_type,
                body: body.to_vec(),
            });
    }

    async fn files(
        State(state): State<Arc<MockInner>>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        record(&state, "POST", "/api/v1/beta/files", &headers, &body);
        if matches!(state.script, Script::Upload401) {
            return (StatusCode::UNAUTHORIZED, Json(json!({"detail": "no"}))).into_response();
        }
        Json(json!({"id": "file1"})).into_response()
    }

    async fn start_parse(
        State(state): State<Arc<MockInner>>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        record(&state, "POST", "/api/v2/parse", &headers, &body);
        state.started.notify_waiters();
        if matches!(state.script, Script::Parse402) {
            return (StatusCode::PAYMENT_REQUIRED, Json(json!({"detail": "out"}))).into_response();
        }
        let status = if matches!(state.script, Script::Immediate) {
            "COMPLETED"
        } else {
            "PENDING"
        };
        Json(json!({"id": "job1", "status": status})).into_response()
    }

    async fn poll_or_result(
        State(state): State<Arc<MockInner>>,
        request: axum::extract::Request,
    ) -> impl IntoResponse {
        let path_and_query = request
            .uri()
            .path_and_query()
            .map(|p| p.as_str().to_string())
            .unwrap_or_default();
        let headers = request.headers().clone();
        record(&state, "GET", &path_and_query, &headers, b"");
        if path_and_query.contains("expand=items") {
            return Json(result_body(&state)).into_response();
        }
        let n = state.polls.fetch_add(1, Ordering::Relaxed);
        let status = if n == 0 { "RUNNING" } else { "COMPLETED" };
        Json(json!({"id": "job1", "status": status})).into_response()
    }

    fn result_body(state: &MockInner) -> Value {
        let url = match state.script {
            Script::OffOrigin => Some("http://example.invalid/side.jsonl".to_string()),
            Script::Poll | Script::Immediate | Script::TooBig | Script::BadLine => {
                Some(format!("{}/sidecar", state.base))
            }
            Script::Upload401 | Script::Parse402 => None,
        };
        let mut body = json!({
            "job": {"id": "job1", "status": "COMPLETED"},
            "items": {"pages": []},
        });
        if let Some(url) = url {
            body["result_content_metadata"] = json!({"grounded_items": {"presigned_url": url}});
        }
        body
    }

    async fn cancel_job(
        State(state): State<Arc<MockInner>>,
        headers: HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        record(&state, "POST", "/api/v2/parse/job1/cancel", &headers, &body);
        Json(json!({}))
    }

    async fn sidecar(State(state): State<Arc<MockInner>>, headers: HeaderMap) -> impl IntoResponse {
        record(&state, "GET", "/sidecar", &headers, b"");
        let body = match state.script {
            Script::TooBig => vec![b'x'; SIDECAR_CAP + 1],
            Script::BadLine => {
                b"not-json\n{\"page_number\":1,\"success\":true,\"items\":[]}\n".to_vec()
            }
            _ => b"{\"page_number\":1,\"success\":true,\"items\":[]}\n".to_vec(),
        };
        ([(header::CONTENT_TYPE, "application/x-ndjson")], body)
    }

    fn instant_sleep(_: Duration) -> std::future::Ready<()> {
        std::future::ready(())
    }

    async fn run_against(
        mock: &Mock,
        region: &str,
        tier: &str,
        cancel: &Cancel,
        timeout_s: f64,
        now: impl FnMut() -> f64,
        sleep: impl FnMut(Duration) -> std::future::Ready<()>,
    ) -> (Result<Value, CloudError>, Vec<(String, Value)>) {
        let client = CloudClient::new().unwrap();
        let events = std::sync::Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        let result = run_llamaparse(
            &client,
            ParseRequest {
                pdf: PDF,
                api_key: KEY,
                region,
                tier,
                timeout_s,
                base_override: Some(&mock.base),
            },
            cancel,
            move |event, payload| seen.lock().unwrap().push((event.to_string(), payload)),
            now,
            sleep,
        )
        .await;
        let events = events.lock().unwrap().clone();
        (result, events)
    }

    fn assert_key_stays_in_the_header(calls: &[MockCall]) {
        assert!(calls
            .iter()
            .any(|call| call.auth.as_deref() == Some(&format!("Bearer {KEY}"))));
        for call in calls {
            assert!(
                !call.path_and_query.contains(KEY),
                "{}",
                call.path_and_query
            );
            assert!(!call
                .body
                .windows(KEY.len())
                .any(|window| window == KEY.as_bytes()));
            if let Some(kind) = &call.content_type {
                assert!(!kind.contains(KEY));
            }
            if call.path_and_query.contains("sidecar") {
                assert!(call.auth.is_none(), "the sidecar must not carry the key");
            }
        }
    }

    #[test]
    fn regions_tiers_and_sidecar_scheme() {
        assert_eq!(base_url("us").unwrap(), US);
        assert_eq!(base_url("eu").unwrap(), EU);
        assert_eq!(base_url("ap").unwrap_err().status, 400);
        assert!(tier_ok("agentic_plus"));
        assert!(!tier_ok("deluxe"));
        assert!(sidecar_allowed("https://files.example/side.jsonl", US));
        assert!(!sidecar_allowed("http://files.example/side.jsonl", US));
        assert!(sidecar_allowed(
            "http://127.0.0.1:9/sidecar",
            "http://127.0.0.1:9"
        ));
        assert!(!sidecar_allowed(
            "http://example.invalid/side",
            "http://127.0.0.1:9"
        ));
        let err = CloudError::new(401, format!("detail {KEY}"), "unauthorized");
        let rendered = format!("{err} {}", serde_json::to_string(&err.to_json()).unwrap());
        assert!(
            rendered.contains(KEY),
            "a provider message is passed through"
        );
        let local = format!(
            "{} {}",
            CloudError::network(),
            CloudError::timeout().to_json()
        );
        assert!(!local.contains(KEY));
    }

    #[tokio::test]
    async fn uploads_polls_and_attaches_the_sidecar_without_the_key() {
        let mock = spawn_mock(Script::Poll).await;
        let cancel = Cancel::new();
        let (result, events) = run_against(
            &mock,
            "eu",
            "agentic",
            &cancel,
            DEFAULT_TIMEOUT_S,
            || 0.0,
            instant_sleep,
        )
        .await;
        let result = result.unwrap();
        assert_eq!(result["grounded_pages"][0]["page_number"], 1);
        assert_eq!(
            events[0],
            ("progress".into(), json!({"status": "uploading"}))
        );
        assert!(events.iter().any(
            |(_, payload)| payload.get("status").and_then(|v| v.as_str()) == Some("COMPLETED")
        ));
        let blob = serde_json::to_string(&events).unwrap();
        assert!(!blob.contains(KEY));
        assert!(!serde_json::to_string(&result).unwrap().contains(KEY));
        let calls = mock.calls();
        assert_key_stays_in_the_header(&calls);
        let start = calls
            .iter()
            .find(|call| call.method == "POST" && call.path_and_query == "/api/v2/parse")
            .unwrap();
        let sent: Value = serde_json::from_slice(&start.body).unwrap();
        assert_eq!(sent["tier"], "agentic");
        assert_eq!(sent["version"], "latest");
        assert_eq!(sent["output_options"]["granular_bboxes"], json!(["cell"]));
        assert_eq!(sent["file_id"], "file1");
        let upload = calls
            .iter()
            .find(|call| call.path_and_query == "/api/v1/beta/files")
            .unwrap();
        assert!(upload.body.windows(PDF.len()).any(|window| window == PDF));
        assert!(upload
            .content_type
            .as_deref()
            .unwrap()
            .contains("boundary=pxdCloud7f3a9c"));
        assert!(calls
            .iter()
            .any(|call| call.path_and_query.contains("expand=items")
                && call.path_and_query.contains("expand=markdown")));
    }

    #[tokio::test]
    async fn provider_401_and_402_keep_their_codes() {
        let denied = spawn_mock(Script::Upload401).await;
        let (err, _) = run_against(
            &denied,
            "us",
            "fast",
            &Cancel::new(),
            DEFAULT_TIMEOUT_S,
            || 0.0,
            instant_sleep,
        )
        .await;
        let err = err.unwrap_err();
        assert_eq!(err.status, 401);
        assert_eq!(err.code, "unauthorized");
        assert_eq!(err.message, "no");

        let credits = spawn_mock(Script::Parse402).await;
        let (err, events) = run_against(
            &credits,
            "us",
            "fast",
            &Cancel::new(),
            DEFAULT_TIMEOUT_S,
            || 0.0,
            instant_sleep,
        )
        .await;
        let err = err.unwrap_err();
        assert_eq!(err.status, 402);
        assert_eq!(err.code, "credits");
        assert!(!serde_json::to_string(&events).unwrap().contains(KEY));
    }

    #[tokio::test]
    async fn cancel_during_sleep_posts_the_remote_cancel() {
        let mock = spawn_mock(Script::Poll).await;
        let cancel = Cancel::new();
        let flag = cancel.clone();
        let (err, _) = run_against(
            &mock,
            "us",
            "agentic",
            &cancel,
            DEFAULT_TIMEOUT_S,
            || 0.0,
            move |_| {
                flag.cancel();
                std::future::ready(())
            },
        )
        .await;
        let err = err.unwrap_err();
        assert_eq!(err.status, 499);
        assert_eq!(err.code, "cancelled");
        let calls = mock.calls();
        assert!(calls.iter().any(
            |call| call.method == "POST" && call.path_and_query == "/api/v2/parse/job1/cancel"
        ));
        let remote = calls
            .iter()
            .find(|call| call.path_and_query.ends_with("/cancel"))
            .unwrap();
        assert_eq!(remote.body, b"{}");
        assert_eq!(
            remote.auth.as_deref(),
            Some(format!("Bearer {KEY}").as_str())
        );
        assert_key_stays_in_the_header(&calls);
    }

    #[tokio::test]
    async fn clock_past_the_deadline_is_a_timeout() {
        let mock = spawn_mock(Script::Poll).await;
        let ticks = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let sleep_ticks = ticks.clone();
        let now_ticks = ticks.clone();
        let (err, _) = run_against(
            &mock,
            "us",
            "agentic",
            &Cancel::new(),
            10.0,
            move || now_ticks.load(Ordering::Relaxed) as f64,
            move |_| {
                sleep_ticks.store(1000, Ordering::Relaxed);
                std::future::ready(())
            },
        )
        .await;
        let err = err.unwrap_err();
        assert_eq!(err.status, 504);
        assert_eq!(err.code, "timeout");
        assert!(!mock
            .calls()
            .iter()
            .any(|call| call.method == "GET" && !call.path_and_query.contains("expand=")));
    }

    #[tokio::test]
    async fn sidecar_over_the_cap_is_left_off_and_a_bad_line_is_skipped() {
        let huge = spawn_mock(Script::TooBig).await;
        let (result, _) = run_against(
            &huge,
            "us",
            "fast",
            &Cancel::new(),
            DEFAULT_TIMEOUT_S,
            || 0.0,
            instant_sleep,
        )
        .await;
        let result = result.unwrap();
        assert!(result.get("grounded_pages").is_none());
        assert_eq!(result["items"]["pages"], json!([]));

        let messy = spawn_mock(Script::BadLine).await;
        let (result, events) = run_against(
            &messy,
            "us",
            "fast",
            &Cancel::new(),
            DEFAULT_TIMEOUT_S,
            || 0.0,
            instant_sleep,
        )
        .await;
        let result = result.unwrap();
        assert_eq!(result["grounded_pages"].as_array().unwrap().len(), 1);
        assert_eq!(result["grounded_pages"][0]["page_number"], 1);
        assert!(!serde_json::to_string(&events).unwrap().contains(KEY));

        let foreign = spawn_mock(Script::OffOrigin).await;
        let (result, _) = run_against(
            &foreign,
            "us",
            "fast",
            &Cancel::new(),
            DEFAULT_TIMEOUT_S,
            || 0.0,
            instant_sleep,
        )
        .await;
        assert!(result.unwrap().get("grounded_pages").is_none());
        assert!(!foreign
            .calls()
            .iter()
            .any(|call| call.path_and_query.contains("sidecar")));
    }

    async fn spawn_helper(base: Option<String>) -> String {
        let dir = std::env::temp_dir().join(format!(
            "pxd-cloud-route-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mut app = crate::server::App::new(
            "test-token",
            std::collections::HashSet::from(["https://roamresearch.com".into()]),
            dir.join("pair-until"),
            crate::cache::ParseCache::new(dir.join("cache"), 1_000_000),
            std::path::PathBuf::from("/missing"),
        )
        .unwrap();
        app.cloud_base = base;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        assert_ne!(addr.port(), 48765, "the logged-in helper stays on 48765");
        let app = crate::server::router(std::sync::Arc::new(app));
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    fn helper_client() -> reqwest::Client {
        reqwest::Client::new()
    }

    async fn post_cloud(helper: &str, options: &str, body: &'static [u8]) -> reqwest::Response {
        helper_client()
            .post(format!("{helper}/v1/cloud/parse"))
            .header("authorization", "Bearer test-token")
            .header("x-pxd-cloud-key", KEY)
            .header("x-pxd-options", options)
            .body(body.to_vec())
            .send()
            .await
            .unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cloud_route_auth_key_and_sse_omit_the_provider_key() {
        let mock = spawn_mock(Script::Immediate).await;
        let helper = spawn_helper(Some(mock.base.clone())).await;
        let client = helper_client();
        let bare = client
            .post(format!("{helper}/v1/cloud/parse"))
            .body(PDF.to_vec())
            .send()
            .await
            .unwrap();
        assert_eq!(bare.status(), 401);
        let missing = client
            .post(format!("{helper}/v1/cloud/parse"))
            .header("authorization", "Bearer test-token")
            .body(PDF.to_vec())
            .send()
            .await
            .unwrap();
        assert_eq!(missing.status(), 400);
        assert_eq!(missing.text().await.unwrap().contains(KEY), false);
        let unknown = client
            .delete(format!("{helper}/v1/cloud/parse/missing"))
            .header("authorization", "Bearer test-token")
            .send()
            .await
            .unwrap();
        assert_eq!(unknown.status(), 404);

        let bad_tier = post_cloud(&helper, r#"{"region":"us","tier":"nope"}"#, PDF).await;
        assert_eq!(bad_tier.status(), 400);
        let bad_region = post_cloud(&helper, r#"{"region":"ap","tier":"fast"}"#, PDF).await;
        assert_eq!(bad_region.status(), 400);
        let empty = client
            .post(format!("{helper}/v1/cloud/parse"))
            .header("authorization", "Bearer test-token")
            .header("x-pxd-cloud-key", KEY)
            .body(Vec::<u8>::new())
            .send()
            .await
            .unwrap();
        assert_eq!(empty.status(), 400);

        let response = post_cloud(&helper, r#"{"region":"eu","tier":"agentic"}"#, PDF).await;
        assert_eq!(response.status(), 200);
        let kind = response
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(kind.starts_with("text/event-stream"), "{kind}");
        let body = response.text().await.unwrap();
        assert!(body.contains("event: progress"));
        assert!(body.contains("event: result"));
        assert!(body.contains("event: started"));
        assert!(!body.contains(KEY));
        let job = format!("c_{}", &crate::hashutil::sha256_hex(PDF)[..8]);
        assert!(body.contains(&format!("\"job\":\"{job}\"")), "{body}");
        assert!(body.contains("\"page_number\":1"));
        assert_key_stays_in_the_header(&mock.calls());
        let start = mock
            .calls()
            .into_iter()
            .find(|call| call.path_and_query == "/api/v2/parse")
            .unwrap();
        let sent: Value = serde_json::from_slice(&start.body).unwrap();
        assert_eq!(sent["tier"], "agentic");
        assert_eq!(sent["version"], "latest");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn route_keeps_provider_401_and_402_inside_the_stream() {
        let denied = spawn_mock(Script::Upload401).await;
        let helper = spawn_helper(Some(denied.base.clone())).await;
        let response = post_cloud(&helper, r#"{"region":"us","tier":"fast"}"#, PDF).await;
        assert_eq!(response.status(), 200);
        let body = response.text().await.unwrap();
        assert!(body.contains("event: error"));
        assert!(body.contains("\"code\":\"unauthorized\""));
        assert!(body.contains("\"status\":401"));
        assert!(!body.contains(KEY));

        let credits = spawn_mock(Script::Parse402).await;
        let helper = spawn_helper(Some(credits.base.clone())).await;
        let response = post_cloud(&helper, r#"{"region":"us","tier":"fast"}"#, PDF).await;
        assert_eq!(response.status(), 200);
        let body = response.text().await.unwrap();
        assert!(body.contains("\"code\":\"credits\""));
        assert!(body.contains("\"status\":402"));
        assert!(!body.contains(KEY));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn delete_cloud_cancels_the_helper_job_and_the_upstream_id() {
        let mock = spawn_mock(Script::Poll).await;
        let helper = spawn_helper(Some(mock.base.clone())).await;
        let client = helper_client();
        let mut response = post_cloud(&helper, r#"{"region":"us","tier":"fast"}"#, PDF).await;
        assert_eq!(response.status(), 200);
        let job = format!("c_{}", &crate::hashutil::sha256_hex(PDF)[..8]);
        let mut text = String::new();
        loop {
            let chunk = tokio::time::timeout(Duration::from_secs(5), response.chunk())
                .await
                .expect("sse")
                .unwrap();
            let Some(chunk) = chunk else { break };
            text.push_str(&String::from_utf8_lossy(&chunk));
            if text.contains("event: started") {
                break;
            }
        }
        let gone = client
            .delete(format!("{helper}/v1/cloud/parse/{job}"))
            .header("authorization", "Bearer test-token")
            .send()
            .await
            .unwrap();
        assert_eq!(gone.status(), 204);
        while let Some(chunk) = tokio::time::timeout(Duration::from_secs(5), response.chunk())
            .await
            .expect("sse tail")
            .unwrap()
        {
            text.push_str(&String::from_utf8_lossy(&chunk));
        }
        assert!(text.contains("event: error"), "{text}");
        assert!(text.contains("\"code\":\"cancelled\""), "{text}");
        assert!(!text.contains(KEY));

        let mock = spawn_mock(Script::Poll).await;
        let helper = spawn_helper(Some(mock.base.clone())).await;
        let mut response = post_cloud(&helper, r#"{"region":"us","tier":"fast"}"#, PDF).await;
        let mut text = String::new();
        loop {
            let chunk = tokio::time::timeout(Duration::from_secs(5), response.chunk())
                .await
                .expect("sse")
                .unwrap();
            let Some(chunk) = chunk else { break };
            text.push_str(&String::from_utf8_lossy(&chunk));
            if text.contains("\"job\":\"job1\"") {
                break;
            }
        }
        assert!(text.contains("\"job\":\"job1\""), "{text}");
        let gone = helper_client()
            .delete(format!("{helper}/v1/cloud/parse/job1"))
            .header("authorization", "Bearer test-token")
            .send()
            .await
            .unwrap();
        assert_eq!(gone.status(), 204);
        while let Some(chunk) = tokio::time::timeout(Duration::from_secs(5), response.chunk())
            .await
            .expect("sse tail")
            .unwrap()
        {
            text.push_str(&String::from_utf8_lossy(&chunk));
        }
        assert!(text.contains("\"code\":\"cancelled\""), "{text}");
        assert!(!text.contains(KEY));
        assert!(mock
            .calls()
            .iter()
            .any(|call| call.path_and_query == "/api/v2/parse/job1/cancel"));
    }

    #[tokio::test]
    async fn immediate_complete_skips_the_poll() {
        let mock = spawn_mock(Script::Immediate).await;
        let (result, events) = run_against(
            &mock,
            "eu",
            "cost_effective",
            &Cancel::new(),
            DEFAULT_TIMEOUT_S,
            || 0.0,
            instant_sleep,
        )
        .await;
        assert_eq!(result.unwrap()["grounded_pages"][0]["page_number"], 1);
        assert!(!events
            .iter()
            .any(|(_, payload)| payload.get("status").and_then(|v| v.as_str()) == Some("RUNNING")));
        assert!(!mock.calls().iter().any(|call| {
            call.method == "GET"
                && call.path_and_query.starts_with("/api/v2/parse/")
                && !call.path_and_query.contains("expand")
        }));
    }
}
