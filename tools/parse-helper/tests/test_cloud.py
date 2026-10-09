"""LlamaParse forwarder. The injected http never leaves the process, and nothing binds port 48765."""

import hashlib
import json
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from plexus_parse_helper.cache import ParseCache
from plexus_parse_helper.cloud import CloudCancelled, CloudError, run_llamaparse
from plexus_parse_helper.jobs import JobManager
from plexus_parse_helper.server import create_app

TOKEN = "test-token"
PDF = b"%PDF-1.4 synthetic"
KEY = "pxd-cloud-test-key"


def _http(script):
    calls = []

    def http(method, url, headers, body, timeout):
        calls.append({"method": method, "url": url, "headers": dict(headers), "body": body, "timeout": timeout})
        status, raw = script(method, url, headers, body, calls)
        return status, raw

    return http, calls


def _ok_script(region_host):
    polls = {"n": 0}

    def script(method, url, headers, body, calls):
        assert url.startswith(region_host) or url.startswith("https://files.example/")
        if url.endswith("/api/v1/beta/files"):
            assert headers["Authorization"] == f"Bearer {KEY}"
            assert PDF in body
            return 200, b'{"id":"file1"}'
        if method == "POST" and url.endswith("/api/v2/parse"):
            sent = json.loads(body)
            assert sent["tier"] == "agentic"
            assert sent["output_options"]["granular_bboxes"] == ["cell"]
            return 200, b'{"id":"job1","status":"PENDING"}'
        if method == "GET" and url.endswith("/job1"):
            polls["n"] += 1
            status = "RUNNING" if polls["n"] == 1 else "COMPLETED"
            return 200, json.dumps({"id": "job1", "status": status}).encode()
        if "expand=items" in url:
            return 200, json.dumps({
                "job": {"id": "job1", "status": "COMPLETED"},
                "items": {"pages": []},
                "result_content_metadata": {"grounded_items": {"presigned_url": "https://files.example/side.jsonl"}},
            }).encode()
        if url.startswith("https://files.example/"):
            assert "Authorization" not in headers
            return 200, b'{"page_number":1,"success":true,"items":[]}\n'
        raise AssertionError(url)

    return script


def test_run_llamaparse_uploads_polls_and_attaches_the_sidecar_without_the_key():
    events = []
    http, calls = _http(_ok_script("https://api.cloud.eu.llamaindex.ai"))
    result = run_llamaparse(
        PDF, api_key=KEY, region="eu", tier="agentic",
        on_event=lambda event, payload: events.append((event, payload)),
        cancel=threading.Event(), http=http, sleep=lambda _delay: None, clock=lambda: 0,
    )
    assert result["grounded_pages"][0]["page_number"] == 1
    assert events[0] == ("progress", {"status": "uploading"})
    assert any(payload.get("status") == "COMPLETED" for _event, payload in events)
    blob = json.dumps(events)
    assert KEY not in blob
    assert any(call["url"].startswith("https://api.cloud.eu.llamaindex.ai") for call in calls)


def test_provider_401_and_402_keep_their_codes():
    def denied(status, code):
        def script(method, url, headers, body, calls):
            if url.endswith("/files"):
                return status, b'{"detail":"no"}'
            raise AssertionError(url)
        return script

    http, _calls = _http(denied(401, "unauthorized"))
    with pytest.raises(CloudError) as unauthorized:
        run_llamaparse(PDF, api_key=KEY, region="us", tier="fast", on_event=lambda *_a: None, cancel=threading.Event(), http=http, sleep=lambda _d: None, clock=lambda: 0)
    assert unauthorized.value.status == 401
    assert unauthorized.value.code == "unauthorized"

    def credits(method, url, headers, body, calls):
        if url.endswith("/files"):
            return 200, b'{"id":"file1"}'
        return 402, b'{"detail":"out"}'

    http, _calls = _http(credits)
    with pytest.raises(CloudError) as out:
        run_llamaparse(PDF, api_key=KEY, region="us", tier="fast", on_event=lambda *_a: None, cancel=threading.Event(), http=http, sleep=lambda _d: None, clock=lambda: 0)
    assert out.value.status == 402
    assert out.value.code == "credits"


def test_cancel_during_sleep_posts_the_remote_cancel():
    cancel = threading.Event()
    calls = []

    def http(method, url, headers, body, timeout):
        calls.append((method, url))
        if url.endswith("/files"):
            return 200, b'{"id":"file1"}'
        if method == "POST" and url.endswith("/parse"):
            return 200, b'{"id":"job1","status":"PENDING"}'
        if url.endswith("/cancel"):
            return 200, b"{}"
        return 200, b'{"status":"RUNNING"}'

    with pytest.raises(CloudCancelled):
        run_llamaparse(
            PDF, api_key=KEY, region="us", tier="agentic",
            on_event=lambda *_a: None, cancel=cancel, http=http,
            sleep=lambda _delay: cancel.set(), clock=lambda: 0,
        )
    assert ("POST", "https://api.cloud.llamaindex.ai/api/v2/parse/job1/cancel") in calls


def test_clock_past_the_deadline_is_a_timeout():
    ticks = {"n": 0}

    def http(method, url, headers, body, timeout):
        if url.endswith("/files"):
            return 200, b'{"id":"file1"}'
        if method == "POST":
            return 200, b'{"id":"job1","status":"PENDING"}'
        return 200, b'{"status":"RUNNING"}'

    with pytest.raises(CloudError) as exc:
        run_llamaparse(
            PDF, api_key=KEY, region="us", tier="agentic",
            on_event=lambda *_a: None, cancel=threading.Event(), http=http,
            sleep=lambda _delay: ticks.__setitem__("n", 1000),
            clock=lambda: ticks["n"], timeout_s=10,
        )
    assert exc.value.status == 504
    assert exc.value.code == "timeout"


def _app(tmp_path: Path, runner):
    jobs = JobManager(runner=lambda *args, **kwargs: {})
    cache = ParseCache(tmp_path / "cache", max_bytes=1_000_000)
    return create_app(token=TOKEN, jobs=jobs, cache=cache, cloud_runner=runner)


def test_cloud_route_auth_key_and_sse_omit_the_provider_key(tmp_path):
    seen = {}

    def runner(pdf, *, api_key, region, tier, on_event, cancel):
        seen.update(pdf=pdf, api_key=api_key, region=region, tier=tier)
        on_event("progress", {"status": "RUNNING"})
        return {"items": {"pages": []}, "marker": "ok"}

    app = _app(tmp_path, runner)
    client = TestClient(app)
    bare = client.post("/v1/cloud/parse", content=PDF)
    assert bare.status_code == 401
    missing = client.post("/v1/cloud/parse", headers={"Authorization": f"Bearer {TOKEN}"}, content=PDF)
    assert missing.status_code == 400
    unknown = client.delete("/v1/cloud/parse/missing", headers={"Authorization": f"Bearer {TOKEN}"})
    assert unknown.status_code == 404

    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "X-Pxd-Cloud-Key": KEY,
        "X-Pxd-Options": '{"region":"eu","tier":"agentic"}',
    }
    response = client.post("/v1/cloud/parse", headers=headers, content=PDF)
    assert response.status_code == 200
    body = response.text
    assert "event: progress" in body
    assert "event: result" in body
    assert KEY not in body
    assert seen["api_key"] == KEY
    assert seen["pdf"] == PDF
    assert seen["region"] == "eu"
    assert seen["tier"] == "agentic"
    job = "c_" + hashlib.sha256(PDF).hexdigest()[:8]
    assert f'"job": "{job}"' in body or f'"job":"{job}"' in body


def test_delete_cloud_sets_the_cancel_event(tmp_path):
    started = threading.Event()
    saw = {}

    def runner(pdf, *, api_key, region, tier, on_event, cancel):
        on_event("progress", {"status": "RUNNING"})
        started.set()
        cancel.wait(3)
        saw["set"] = cancel.is_set()
        if cancel.is_set():
            raise CloudCancelled()
        return {"items": {"pages": []}}

    app = _app(tmp_path, runner)
    reader = TestClient(app)
    killer = TestClient(app)
    held = {}

    def consume():
        held["response"] = reader.post(
            "/v1/cloud/parse",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "X-Pxd-Cloud-Key": KEY,
                "X-Pxd-Options": '{"region":"us","tier":"fast"}',
            },
            content=PDF,
        )

    thread = threading.Thread(target=consume)
    thread.start()
    assert started.wait(2)
    job = "c_" + hashlib.sha256(PDF).hexdigest()[:8]
    gone = killer.delete(f"/v1/cloud/parse/{job}", headers={"Authorization": f"Bearer {TOKEN}"})
    assert gone.status_code == 204
    thread.join(3)
    assert thread.is_alive() is False
    assert saw["set"] is True
    assert "event: error" in held["response"].text
    assert KEY not in held["response"].text
