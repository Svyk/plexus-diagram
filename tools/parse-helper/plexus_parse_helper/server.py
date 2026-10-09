"""FastAPI on 127.0.0.1:48765. Origin is checked before the body is read."""

from __future__ import annotations

import json
import os
import queue
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from plexus_parse_helper import HELPER_NAME, HELPER_VERSION, SCHEMA_ID
from plexus_parse_helper.auth import token_matches
from plexus_parse_helper.cache import ParseCache
from plexus_parse_helper.cloud import TIERS, CloudCancelled, CloudError, run_llamaparse
from plexus_parse_helper.jobs import JobCancelled, JobManager, expand_pages
from plexus_parse_helper.models import model_report, start_download, stop_download
from plexus_parse_helper.ocr import ocr_cells, ocr_options_hash, ocr_pdf
from plexus_parse_helper.pair import close_window, window_open
from plexus_parse_helper.schema import normalize_options, options_hash, sha256_bytes
from plexus_parse_helper.vlm_tables import read_tables, vlm_tables_available

MAX_BODY = 200 * 1024 * 1024
_ALLOW_HEADERS = "Authorization, Content-Type, X-Pxd-Options, X-Pxd-Cloud-Key"
_ALLOW_METHODS = "GET, POST, DELETE, HEAD, OPTIONS"


class OriginGuard:
    """403 for a disallowed Origin, before the route reads the body."""

    def __init__(self, app, allow: set[str]):
        self.app = app
        self.allow = allow

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin1").lower(): v.decode("latin1") for k, v in scope.get("headers") or []}
        origin = headers.get("origin")
        if origin and origin not in self.allow:
            body = json.dumps({"error": "forbidden", "origin": origin}).encode("utf-8")
            await send({
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return
        if scope.get("method") == "OPTIONS":
            await send({
                "type": "http.response.start",
                "status": 204,
                "headers": _cors_header_list(origin),
            })
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_cors(message):
            if message.get("type") == "http.response.start" and origin:
                raw = list(message.get("headers") or [])
                raw.extend(_cors_header_list(origin))
                message["headers"] = raw
            await send(message)

        await self.app(scope, receive, send_cors)


def _cors_header_list(origin: str | None) -> list[tuple[bytes, bytes]]:
    if not origin:
        return []
    return [
        (b"access-control-allow-origin", origin.encode("latin1")),
        (b"vary", b"Origin"),
        (b"access-control-allow-headers", _ALLOW_HEADERS.encode("latin1")),
        (b"access-control-allow-methods", _ALLOW_METHODS.encode("latin1")),
        (b"access-control-allow-private-network", b"true"),
    ]


class _Job:
    def __init__(self, job_id: str, sha: str, opts_hash: str, pages: int, cached: bool):
        self.id = job_id
        self.sha256 = sha
        self.opts_hash = opts_hash
        self.pages = pages
        self.cached = cached
        self.state = "running"
        self.document = None
        self.error = None
        self.events: list[tuple[str, dict]] = []
        self.cond = threading.Condition()
        self.cancel = threading.Event()


class JobBook:
    def __init__(self, manager: JobManager, cache: ParseCache):
        self.manager = manager
        self.cache = cache
        self.jobs: dict[str, _Job] = {}
        self.running: str | None = None
        self._lock = threading.Lock()

    def submit(self, data: bytes, options: dict, page_count: int) -> tuple[int, dict]:
        norm = normalize_options(options)
        scope = norm.get("scope")
        ohash = options_hash(norm)
        sha = sha256_bytes(data)
        selected = expand_pages(norm.get("pages"), page_count)
        with self._lock:
            if self.running:
                return 409, {"running": self.running}
            cached = None if scope else self.cache.get(sha, ohash)
            job_id = "j_" + sha[:8] + ohash[:4]
            # Keep ids unique when the same file is posted twice in one process.
            if job_id in self.jobs:
                job_id = job_id + f"_{len(self.jobs)}"
            job = _Job(job_id, sha, ohash, page_count, cached is not None)
            self.jobs[job_id] = job
            if cached is None:
                self.running = job_id
        if cached is not None:
            job.document = cached
            job.state = "done"
            self._push(job, "done", {"sha256": sha, "optsHash": ohash, "elapsedMs": cached.get("stats", {}).get("ms", 0)})
            return 202, {"job": job_id, "sha256": sha, "pages": page_count, "cached": True}
        fd, name = tempfile.mkstemp(suffix=".pdf", prefix="pxd-")
        try:
            os.write(fd, data)
        finally:
            os.close(fd)

        def work():
            started = time.perf_counter()

            def on_event(event, payload):
                self._push(job, event, payload)

            try:
                doc = self.manager.run(name, norm, on_event, job.cancel)
                doc["sha256"] = sha
                if not scope:
                    self.cache.put(sha, ohash, doc)
                job.document = doc
                job.state = "done"
                self._push(job, "done", {
                    "sha256": sha,
                    "optsHash": ohash,
                    "elapsedMs": int((time.perf_counter() - started) * 1000),
                })
            except JobCancelled:
                job.state = "cancelled"
                self._push(job, "error", {"code": "cancelled", "message": "cancelled"})
            except Exception as exc:
                job.state = "error"
                job.error = {"code": "convert", "message": str(exc)}
                self._push(job, "error", job.error)
            finally:
                Path(name).unlink(missing_ok=True)
                with self._lock:
                    if self.running == job_id:
                        self.running = None

        threading.Thread(target=work, daemon=True).start()
        return 202, {"job": job_id, "sha256": sha, "pages": page_count, "cached": False}

    def _push(self, job: _Job, event: str, data: dict) -> None:
        with job.cond:
            job.events.append((event, data))
            job.cond.notify_all()

    def cancel(self, job_id: str) -> int:
        job = self.jobs.get(job_id)
        if job is None or job.state != "running":
            return 404
        job.cancel.set()
        job.state = "cancelled"
        return 204


def create_app(*, token: str, allow_origins: list[str] | None = None, jobs: JobManager | None = None, cache: ParseCache | None = None, ocr_runner=None, cell_runner=None, pair_file=None, cloud_runner=None, table_runner=None) -> FastAPI:
    allow = set(allow_origins or ["https://roamresearch.com"])
    manager = jobs or JobManager()
    store = cache or ParseCache()
    book = JobBook(manager, store)
    app = FastAPI(title=HELPER_NAME, version=HELPER_VERSION)
    app.state.book = book
    app.state.token = token
    app.state.manager = manager
    run_ocr = ocr_runner or ocr_pdf
    run_cells = cell_runner or ocr_cells
    run_cloud = cloud_runner or run_llamaparse
    ocr_lock = threading.Lock()
    table_lock = threading.Lock()
    pair_lock = threading.Lock()
    run_tables = table_runner or read_tables

    def engine_names():
        names = ["docling", "ocr", "cloud"]
        # Present only when a runner was injected or mlx-vlm is installed. The default
        # test environment has neither, so health stays docling/ocr/cloud.
        if table_runner is not None or vlm_tables_available():
            names.append("vlm-tables")
        return names
    cloud_jobs: dict[str, threading.Event] = {}
    cloud_lock = threading.Lock()

    def authed(request: Request) -> bool:
        return token_matches(request.headers.get("authorization"), token)

    @app.get("/v1/health")
    def health(request: Request):
        if not authed(request):
            return JSONResponse({"helper": HELPER_NAME, "auth": "required"}, status_code=401)
        report = model_report()
        return {
            "helper": HELPER_NAME,
            "version": HELPER_VERSION,
            "schema": SCHEMA_ID,
            "engines": engine_names(),
            "models": report["health"],
            "busy": manager.busy,
            "warm": bool(manager.warm),
        }

    @app.get("/v1/pair")
    def pair(request: Request):
        """No bearer: this route is how a browser gets it. 404 unless the pairing window is
        open and the Origin is on the allow list; the first caller in the window gets the token."""
        origin = request.headers.get("origin")
        if not origin or origin not in allow:
            return JSONResponse({"error": "not found"}, status_code=404)
        with pair_lock:
            if not window_open(pair_file) or not close_window(pair_file):
                return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(
            {"token": token, "helper": HELPER_NAME, "version": HELPER_VERSION},
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/v1/models")
    def models(request: Request):
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        report = model_report()
        return {
            "state": report["state"],
            "items": report["items"],
            "bytes": report["bytes"],
            "done": report["done"],
            "fraction": report["fraction"],
        }

    @app.post("/v1/models/download")
    def download(request: Request):
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return JSONResponse(start_download(), status_code=202)

    @app.delete("/v1/models/download")
    def cancel_download(request: Request):
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return JSONResponse(stop_download(), status_code=200)

    @app.head("/v1/cache/{sha256}")
    def head_cache(sha256: str, request: Request):
        if not authed(request):
            return Response(status_code=401)
        opts = request.query_params.get("opts") or ""
        if store.has(sha256, opts):
            return Response(status_code=200)
        return Response(status_code=404)

    @app.get("/v1/cache/{sha256}")
    def get_cache(sha256: str, request: Request):
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        opts = request.query_params.get("opts") or ""
        doc = store.get(sha256, opts)
        if doc is None:
            return JSONResponse({"error": "miss"}, status_code=404)
        return doc

    @app.post("/v1/jobs")
    async def post_job(request: Request):
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        length = request.headers.get("content-length")
        if length and int(length) > MAX_BODY:
            return JSONResponse({"error": "too large"}, status_code=413)
        data = await request.body()
        if len(data) > MAX_BODY:
            return JSONResponse({"error": "too large"}, status_code=413)
        if not data:
            return JSONResponse({"error": "empty body"}, status_code=400)
        raw = request.headers.get("x-pxd-options") or "{}"
        try:
            options = json.loads(raw)
        except json.JSONDecodeError:
            return JSONResponse({"error": "bad X-Pxd-Options"}, status_code=400)
        import pypdfium2 as pdfium
        fd, name = tempfile.mkstemp(suffix=".pdf")
        try:
            os.write(fd, data)
            os.close(fd)
            fd = None
            pdf = pdfium.PdfDocument(name)
            try:
                page_count = len(pdf)
            finally:
                pdf.close()
        except Exception as exc:
            return JSONResponse({"error": f"not a pdf: {exc}"}, status_code=400)
        finally:
            if fd is not None:
                os.close(fd)
            Path(name).unlink(missing_ok=True)
        try:
            status, body = book.submit(data, options, page_count)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        return JSONResponse(body, status_code=status)

    @app.post("/v1/ocr")
    async def post_ocr(request: Request):
        """Body is the PDF. X-Pxd-Options {pages, cells}. Page records are cached by
        sha256 + pages; a cells request (re-read of single cells) is never cached."""
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        length = request.headers.get("content-length")
        if length and int(length) > MAX_BODY:
            return JSONResponse({"error": "too large"}, status_code=413)
        data = await request.body()
        if len(data) > MAX_BODY:
            return JSONResponse({"error": "too large"}, status_code=413)
        if not data:
            return JSONResponse({"error": "empty body"}, status_code=400)
        raw = request.headers.get("x-pxd-options") or "{}"
        try:
            options = json.loads(raw)
        except json.JSONDecodeError:
            return JSONResponse({"error": "bad X-Pxd-Options"}, status_code=400)
        pages = options.get("pages") or None
        cells = options.get("cells") or None
        sha = sha256_bytes(data)
        ohash = ocr_options_hash(pages)
        if not cells:
            hit = store.get(sha, ohash)
            if hit is not None:
                hit["cached"] = True
                return hit
        fd, name = tempfile.mkstemp(suffix=".pdf", prefix="pxd-ocr-")
        try:
            os.write(fd, data)
            os.close(fd)
            started = time.perf_counter()
            with ocr_lock:
                if cells:
                    if len(cells) > 400:
                        return JSONResponse({"error": "cells cap is 400"}, status_code=400)
                    out = run_cells(name, cells)
                else:
                    out = run_ocr(name, pages)
            out["sha256"] = sha
            out["elapsedMs"] = int((time.perf_counter() - started) * 1000)
            out["cached"] = False
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse({"error": f"ocr failed: {exc}"}, status_code=500)
        finally:
            Path(name).unlink(missing_ok=True)
        if not cells:
            store.put(sha, ohash, out)
        return out

    @app.post("/v1/tables")
    async def post_tables(request: Request):
        """PDF body. X-Pxd-Options {pages, tables:[{page, bbox}]}. bbox is PDF points,
        origin bottom-left, the same boxes the built-in parser stores on a table.
        One model crop per box. The model downloads the first time this runs."""
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        if "vlm-tables" not in engine_names():
            return JSONResponse({"error": "vlm-tables is not installed"}, status_code=404)
        length = request.headers.get("content-length")
        if length and int(length) > MAX_BODY:
            return JSONResponse({"error": "too large"}, status_code=413)
        data = await request.body()
        if len(data) > MAX_BODY:
            return JSONResponse({"error": "too large"}, status_code=413)
        if not data:
            return JSONResponse({"error": "empty body"}, status_code=400)
        raw = request.headers.get("x-pxd-options") or "{}"
        try:
            options = json.loads(raw)
        except json.JSONDecodeError:
            return JSONResponse({"error": "bad X-Pxd-Options"}, status_code=400)
        regions = options.get("tables") or []
        if not isinstance(regions, list):
            return JSONResponse({"error": "tables must be a list"}, status_code=400)
        fd, name = tempfile.mkstemp(suffix=".pdf", prefix="pxd-vlm-")
        try:
            os.write(fd, data)
            os.close(fd)
            fd = None
            with table_lock:
                out = run_tables(name, regions)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse({"error": f"tables failed: {exc}"}, status_code=500)
        finally:
            if fd is not None:
                os.close(fd)
            Path(name).unlink(missing_ok=True)
        if not isinstance(out, dict):
            return JSONResponse({"error": "tables runner returned no object"}, status_code=500)
        return out

    @app.get("/v1/jobs/{job_id}/events")
    def events(job_id: str, request: Request):
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        job = book.jobs.get(job_id)
        if job is None:
            return JSONResponse({"error": "missing"}, status_code=404)

        def stream():
            index = 0
            while True:
                with job.cond:
                    while index >= len(job.events):
                        if job.state in {"done", "error", "cancelled"}:
                            return
                        job.cond.wait(timeout=0.5)
                    event, data = job.events[index]
                    index += 1
                yield f"event: {event}\ndata: {json.dumps(data)}\n\n"
                if event in {"done", "error"}:
                    return

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.get("/v1/jobs/{job_id}")
    def get_job(job_id: str, request: Request):
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        job = book.jobs.get(job_id)
        if job is None:
            return JSONResponse({"error": "missing"}, status_code=404)
        if job.state == "done" and job.document is not None:
            return job.document
        body = {"state": job.state}
        if job.error:
            body["error"] = job.error
        return body

    @app.post("/v1/cloud/parse")
    async def post_cloud(request: Request):
        """PDF body. Helper bearer plus X-Pxd-Cloud-Key. SSE: started, progress, result | error.
        The provider key is not written to the cache and is not copied into the events."""
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        api_key = (request.headers.get("x-pxd-cloud-key") or "").strip()
        if not api_key:
            return JSONResponse({"error": "missing cloud key"}, status_code=400)
        raw = request.headers.get("x-pxd-options") or "{}"
        try:
            options = json.loads(raw)
        except json.JSONDecodeError:
            return JSONResponse({"error": "bad X-Pxd-Options"}, status_code=400)
        region = options.get("region") or "us"
        tier = options.get("tier") or "agentic"
        if region not in {"us", "eu"}:
            return JSONResponse({"error": "region must be us or eu"}, status_code=400)
        if tier not in TIERS:
            return JSONResponse({"error": "bad tier"}, status_code=400)
        length = request.headers.get("content-length")
        if length and int(length) > MAX_BODY:
            return JSONResponse({"error": "too large"}, status_code=413)
        data = await request.body()
        if len(data) > MAX_BODY:
            return JSONResponse({"error": "too large"}, status_code=413)
        if not data:
            return JSONResponse({"error": "empty body"}, status_code=400)
        job_id = "c_" + sha256_bytes(data)[:8]
        cancel = threading.Event()
        with cloud_lock:
            if job_id in cloud_jobs:
                job_id = f"{job_id}_{len(cloud_jobs)}"
            cloud_jobs[job_id] = cancel
        events: queue.Queue = queue.Queue()

        def on_event(event, payload):
            events.put((event, payload))

        def work():
            try:
                result = run_cloud(
                    data, api_key=api_key, region=region, tier=tier,
                    pages=options.get("pages"), on_event=on_event, cancel=cancel,
                )
                events.put(("result", result))
            except CloudCancelled:
                events.put(("error", {"code": "cancelled", "message": "cancelled", "status": 499}))
            except CloudError as exc:
                events.put(("error", {"code": exc.code, "message": str(exc), "status": exc.status}))
            except Exception as exc:
                events.put(("error", {"code": "cloud", "message": str(exc), "status": 500}))
            finally:
                events.put(None)
                with cloud_lock:
                    cloud_jobs.pop(job_id, None)

        threading.Thread(target=work, daemon=True).start()

        def stream():
            yield f"event: started\ndata: {json.dumps({'job': job_id})}\n\n"
            while True:
                item = events.get()
                if item is None:
                    return
                event, payload = item
                yield f"event: {event}\ndata: {json.dumps(payload)}\n\n"
                if event in {"result", "error"}:
                    return

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.delete("/v1/cloud/parse/{job_id}")
    def delete_cloud(job_id: str, request: Request):
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        with cloud_lock:
            cancel = cloud_jobs.get(job_id)
        if cancel is None:
            return JSONResponse({"error": "missing"}, status_code=404)
        cancel.set()
        return Response(status_code=204)

    @app.delete("/v1/jobs/{job_id}")
    def delete_job(job_id: str, request: Request):
        if not authed(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        status = book.cancel(job_id)
        if status == 404:
            return JSONResponse({"error": "missing"}, status_code=404)
        return Response(status_code=204)

    wrapped = OriginGuard(app, allow)
    # FastAPI's middleware stack is the app the server should mount.
    wrapped.state = app.state
    return wrapped
