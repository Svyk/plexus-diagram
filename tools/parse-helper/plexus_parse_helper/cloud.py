"""Forward one PDF to LlamaParse v2. The API key is used for that request and not stored."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

US = "https://api.cloud.llamaindex.ai"
EU = "https://api.cloud.eu.llamaindex.ai"
TIERS = frozenset({"fast", "cost_effective", "agentic", "agentic_plus"})
SIDECAR_CAP = 8 * 1024 * 1024


class CloudError(Exception):
    def __init__(self, status: int, message: str, code: str = "provider"):
        super().__init__(message)
        self.status = status
        self.code = code


class CloudCancelled(CloudError):
    def __init__(self):
        super().__init__(499, "cancelled", "cancelled")


def base_url(region: str) -> str:
    if region == "us":
        return US
    if region == "eu":
        return EU
    raise CloudError(400, "region must be us or eu", "bad-request")


def multipart_pdf(pdf: bytes) -> tuple[bytes, str]:
    boundary = "pxdCloud7f3a9c"
    head = (
        f"--{boundary}\r\n"
        "Content-Disposition: form-data; name=\"purpose\"\r\n\r\n"
        "parse\r\n"
        f"--{boundary}\r\n"
        "Content-Disposition: form-data; name=\"file\"; filename=\"document.pdf\"\r\n"
        "Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    return head + pdf + tail, f"multipart/form-data; boundary={boundary}"


def default_http(method: str, url: str, headers: dict, body: bytes | None, timeout: float):
    data = body if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def _loads(raw: bytes) -> dict:
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CloudError(502, "provider did not return JSON", "bad-json") from exc
    if not isinstance(body, dict):
        raise CloudError(502, "provider did not return an object", "bad-json")
    return body


def _job(body: dict) -> dict:
    job = body.get("job")
    if isinstance(job, dict):
        return job
    return body


def _raise_for_status(status: int, body: dict) -> None:
    if status in {401, 402, 413, 429}:
        message = body.get("detail") or body.get("error") or body.get("message") or f"provider {status}"
        code = {401: "unauthorized", 402: "credits", 413: "too-large", 429: "rate"}.get(status, "provider")
        raise CloudError(status, str(message)[:300], code)
    if status < 200 or status >= 300:
        raise CloudError(status, f"provider {status}", "provider")


def _call(http, method, url, headers, body, timeout, cancel):
    if cancel is not None and cancel.is_set():
        raise CloudCancelled()
    try:
        status, raw = http(method, url, headers, body, timeout)
    except CloudError:
        raise
    except Exception as exc:
        if cancel is not None and cancel.is_set():
            raise CloudCancelled() from exc
        raise CloudError(502, "provider unreachable", "network") from exc
    if not raw:
        parsed = {}
    else:
        parsed = _loads(raw)
    _raise_for_status(status, parsed)
    return parsed


def run_llamaparse(
    pdf: bytes,
    *,
    api_key: str,
    region: str,
    tier: str,
    on_event,
    cancel,
    http=None,
    sleep=None,
    timeout_s: float = 240,
    clock=None,
) -> dict:
    """Upload, start, poll, and return the provider JSON. `grounded_pages` is added when the sidecar fits."""
    if tier not in TIERS:
        raise CloudError(400, "bad tier", "bad-request")
    key = str(api_key or "").strip()
    if not key:
        raise CloudError(400, "missing cloud key", "bad-request")
    base = base_url(region)
    send = http or default_http
    pause = sleep or time.sleep
    now = clock or time.monotonic
    auth = {"Authorization": f"Bearer {key}"}
    deadline = now() + timeout_s

    def remaining():
        left = deadline - now()
        if left <= 0:
            raise CloudError(504, "timed out", "timeout")
        return min(60, left)

    on_event("progress", {"status": "uploading"})
    body, content_type = multipart_pdf(pdf)
    uploaded = _call(
        send, "POST", f"{base}/api/v1/beta/files",
        {**auth, "Content-Type": content_type}, body, remaining(), cancel,
    )
    file_id = uploaded.get("id")
    if not isinstance(file_id, str) or not file_id:
        raise CloudError(502, "upload did not return a file id", "bad-json")

    on_event("progress", {"status": "starting"})
    created = _call(
        send, "POST", f"{base}/api/v2/parse",
        {**auth, "Content-Type": "application/json"},
        json.dumps({
            "file_id": file_id,
            "tier": tier,
            "version": "latest",
            "output_options": {"granular_bboxes": ["cell"]},
        }).encode("utf-8"),
        remaining(), cancel,
    )
    job = _job(created)
    job_id = job.get("id") or created.get("id")
    if not isinstance(job_id, str) or not job_id:
        raise CloudError(502, "parse did not return a job id", "bad-json")
    on_event("progress", {"status": job.get("status") or "PENDING", "job": job_id})

    delay = 1.0
    status_name = job.get("status") or "PENDING"
    while status_name not in {"COMPLETED", "FAILED", "CANCELLED"}:
        if cancel is not None and cancel.is_set():
            _remote_cancel(send, base, job_id, auth)
            raise CloudCancelled()
        if now() >= deadline:
            raise CloudError(504, "timed out", "timeout")
        pause(min(delay, max(0, deadline - now())))
        delay = min(delay * 2, 8)
        if cancel is not None and cancel.is_set():
            _remote_cancel(send, base, job_id, auth)
            raise CloudCancelled()
        polled = _call(send, "GET", f"{base}/api/v2/parse/{job_id}", auth, None, remaining(), cancel)
        job = _job(polled)
        status_name = str(job.get("status") or "")
        on_event("progress", {"status": status_name, "job": job_id})

    if status_name == "CANCELLED":
        raise CloudCancelled()
    if status_name != "COMPLETED":
        message = job.get("error_message") or "parse failed"
        raise CloudError(502, str(message)[:300], "failed")

    result = _call(
        send, "GET",
        f"{base}/api/v2/parse/{job_id}?expand=items&expand=markdown&expand=usage",
        auth, None, remaining(), cancel,
    )
    _attach_sidecar(result, send, cancel, remaining)
    return result


def _remote_cancel(http, base: str, job_id: str, auth: dict) -> None:
    try:
        http("POST", f"{base}/api/v2/parse/{job_id}/cancel", {**auth, "Content-Type": "application/json"}, b"{}", 15)
    except Exception:
        return


def _attach_sidecar(result: dict, http, cancel, remaining) -> None:
    meta = result.get("result_content_metadata")
    grounded = meta.get("grounded_items") if isinstance(meta, dict) else None
    url = grounded.get("presigned_url") if isinstance(grounded, dict) else None
    if not isinstance(url, str) or not url.startswith("https://"):
        return
    if cancel is not None and cancel.is_set():
        raise CloudCancelled()
    try:
        status, raw = http("GET", url, {}, None, remaining())
    except Exception:
        return
    if status < 200 or status >= 300 or not raw or len(raw) > SIDECAR_CAP:
        return
    pages = []
    for line in raw.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            pages.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if pages:
        result["grounded_pages"] = pages
