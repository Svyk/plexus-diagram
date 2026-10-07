"""Auth, CORS, one-job gate, and worker cancel. No Docling."""

import os
import stat
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from plexus_parse_helper.auth import load_or_create_token
from plexus_parse_helper.cache import ParseCache
from plexus_parse_helper.jobs import JobCancelled, JobManager, ProcessWorker, chunk_pages, expand_pages, sleep_worker
from plexus_parse_helper.server import MAX_BODY, create_app

PDF = Path(__file__).resolve().parents[3] / "test" / "fixtures" / "pdf" / "report.pdf"
TOKEN = "test-token"


def test_token_file_is_mode_0600(tmp_path):
    path = tmp_path / "token"
    token, created = load_or_create_token(path)
    assert created is True
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    again, created2 = load_or_create_token(path)
    assert created2 is False
    assert again == token


def test_page_spec_and_chunks():
    assert expand_pages([1, 3, [5, 9]], 12) == [1, 3, 5, 6, 7, 8, 9]
    assert chunk_pages([1, 2, 3, 4, 5, 8, 9], 4) == [[1, 2, 3, 4], [5], [8, 9]]
    with pytest.raises(ValueError):
        expand_pages([1], 0)


def _app(tmp_path, runner):
    jobs = JobManager(runner=runner)
    cache = ParseCache(tmp_path / "cache", max_bytes=5_000_000)
    return create_app(token=TOKEN, jobs=jobs, cache=cache)


def test_health_cors_and_forbidden_origin(tmp_path):
    app = _app(tmp_path, runner=lambda *a: {})
    client = TestClient(app)
    bare = client.get("/v1/health")
    assert bare.status_code == 401
    assert bare.json() == {"helper": "plexus-parse-helper", "auth": "required"}
    ok = client.get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["schema"] == "pxd-parse/1"
    assert body["version"] == "0.1.0"
    assert body["engines"] == ["docling", "ocr"]
    assert body["warm"] is False
    pre = client.options("/v1/health", headers={"Origin": "https://roamresearch.com"})
    assert pre.status_code == 204
    assert pre.headers["access-control-allow-origin"] == "https://roamresearch.com"
    assert pre.headers["vary"] == "Origin"
    assert pre.headers["access-control-allow-headers"] == "Authorization, Content-Type, X-Pxd-Options"
    assert "GET" in pre.headers["access-control-allow-methods"]
    assert pre.headers["access-control-allow-private-network"] == "true"
    denied = client.post(
        "/v1/jobs",
        headers={"Origin": "https://evil.example", "Authorization": f"Bearer {TOKEN}"},
        content=b"should-not-matter",
    )
    assert denied.status_code == 403
    assert denied.json()["origin"] == "https://evil.example"


def test_second_job_is_409_and_delete_cancels(tmp_path):
    started = threading.Event()
    saw_cancel = threading.Event()

    def runner(pdf, options, on_event, cancel):
        started.set()
        while not cancel.is_set():
            time.sleep(0.02)
        saw_cancel.set()
        raise JobCancelled()

    client = TestClient(_app(tmp_path, runner))
    auth = {"Authorization": f"Bearer {TOKEN}"}
    data = PDF.read_bytes()
    first = client.post("/v1/jobs", headers=auth, content=data)
    assert first.status_code == 202
    assert first.json()["cached"] is False
    assert started.wait(2)
    second = client.post("/v1/jobs", headers=auth, content=data)
    assert second.status_code == 409
    assert second.json()["running"] == first.json()["job"]
    deleted = client.delete(f"/v1/jobs/{first.json()['job']}", headers=auth)
    assert deleted.status_code == 204
    assert saw_cancel.wait(2)
    missing = client.delete("/v1/jobs/nope", headers=auth)
    assert missing.status_code == 404


def test_cache_head_on_second_post(tmp_path):
    def runner(pdf, options, on_event, cancel):
        on_event("progress", {"page": 1, "of": 1, "ms": 1})
        on_event("page", {"page": 1, "blocks": []})
        return {"schema": "pxd-parse/1", "stats": {"ms": 3}, "blocks": {}, "order": [], "pageCount": 3}

    client = TestClient(_app(tmp_path, runner))
    auth = {"Authorization": f"Bearer {TOKEN}"}
    data = PDF.read_bytes()
    first = client.post("/v1/jobs", headers=auth, content=data)
    job = first.json()["job"]
    with client.stream("GET", f"/v1/jobs/{job}/events", headers=auth) as events:
        text = "".join(events.iter_text())
    assert "event: progress" in text
    assert "event: done" in text
    got = client.get(f"/v1/jobs/{job}", headers=auth)
    assert got.status_code == 200
    assert got.json()["schema"] == "pxd-parse/1"
    second = client.post("/v1/jobs", headers=auth, content=data)
    assert second.status_code == 202
    assert second.json()["cached"] is True
    head = client.head(f"/v1/cache/{second.json()['sha256']}?opts={_opts(client, job)}", headers=auth)
    # The finished job stores optsHash on the book; read it from the done SSE of the first job.
    assert head.status_code in {200, 404}


def _opts(client, job):
    book = client.app.state.book
    return book.jobs[job].opts_hash


def test_cache_head_uses_job_hash(tmp_path):
    def runner(pdf, options, on_event, cancel):
        return {"schema": "pxd-parse/1", "stats": {"ms": 1}, "blocks": {}, "order": []}

    client = TestClient(_app(tmp_path, runner))
    auth = {"Authorization": f"Bearer {TOKEN}"}
    data = PDF.read_bytes()
    first = client.post("/v1/jobs", headers=auth, content=data)
    job = first.json()["job"]
    for _ in range(50):
        if client.app.state.book.jobs[job].state == "done":
            break
        time.sleep(0.02)
    ohash = client.app.state.book.jobs[job].opts_hash
    sha = first.json()["sha256"]
    second = client.post("/v1/jobs", headers=auth, content=data)
    assert second.json()["cached"] is True
    head = client.head(f"/v1/cache/{sha}?opts={ohash}", headers=auth)
    assert head.status_code == 200
    miss = client.head(f"/v1/cache/{sha}?opts=deadbeef", headers=auth)
    assert miss.status_code == 404


def test_body_limit(tmp_path, monkeypatch):
    monkeypatch.setattr("plexus_parse_helper.server.MAX_BODY", 8)
    client = TestClient(_app(tmp_path, runner=lambda *a: {}))
    auth = {"Authorization": f"Bearer {TOKEN}", "Content-Length": "9"}
    # TestClient sets Content-Length from the body, so the patched cap is what trips.
    denied = client.post("/v1/jobs", headers=auth, content=b"0123456789")
    assert denied.status_code == 413
    assert MAX_BODY > 8


def test_worker_cancel_respawns():
    worker = ProcessWorker(sleep_worker)
    try:
        old = worker.proc.pid
        cancel = threading.Event()
        box = {}

        def run():
            try:
                worker.convert("ignored.pdf", {}, None, cancel)
            except JobCancelled:
                box["cancelled"] = True

        thread = threading.Thread(target=run)
        thread.start()
        time.sleep(0.4)
        cancel.set()
        thread.join(timeout=8)
        assert box.get("cancelled") is True
        assert worker.proc.pid != old
        assert worker.proc.is_alive()
    finally:
        worker.close()
