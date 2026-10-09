"""POST /v1/tables with an injected runner. No model download."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from plexus_parse_helper.cache import ParseCache
from plexus_parse_helper.jobs import JobManager
from plexus_parse_helper.server import create_app
from plexus_parse_helper.table_text import tables_from_text

PDF = Path(__file__).resolve().parents[3] / "test" / "fixtures" / "pdf" / "report.pdf"
TOKEN = "test-token"
RECORDED = {
    "model": "PaddleOCR-VL-0.9B",
    "tables": [{
        "page": 1,
        "bbox": [10, 20, 200, 80],
        "rows": 2,
        "cols": 2,
        "cells": [
            {"r": 0, "c": 0, "rowSpan": 1, "colSpan": 1, "text": "Year", "header": True},
            {"r": 0, "c": 1, "rowSpan": 1, "colSpan": 1, "text": "Yield", "header": True},
            {"r": 1, "c": 0, "rowSpan": 1, "colSpan": 1, "text": "1913", "header": False},
            {"r": 1, "c": 1, "rowSpan": 1, "colSpan": 1, "text": "0.98", "header": False},
        ],
    }],
}


def test_bare_otsl_parses_without_a_wrapper():
    raw = "<fcel>Year<fcel>Yield<nl><fcel>1913<fcel>0.98<nl>"
    tables = tables_from_text(raw, "html")
    assert len(tables) == 1
    assert tables[0]["rows"] == 2 and tables[0]["cols"] == 2
    assert tables[0]["cells"][0]["text"] == "Year"
    assert tables[0]["cells"][3]["text"] == "0.98"


def test_tables_route_returns_the_recorded_runner(tmp_path):
    seen = {}

    def runner(path, regions):
        seen["regions"] = regions
        assert Path(path).stat().st_size > 0
        return RECORDED

    app = create_app(
        token=TOKEN,
        jobs=JobManager(runner=lambda *a: {}),
        cache=ParseCache(tmp_path / "cache", max_bytes=1_000_000),
        table_runner=runner,
    )
    client = TestClient(app)
    health = client.get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert health["engines"] == ["docling", "ocr", "cloud", "vlm-tables"]
    auth = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/pdf"}
    denied = client.post("/v1/tables", content=PDF.read_bytes())
    assert denied.status_code == 401
    body = client.post(
        "/v1/tables",
        content=PDF.read_bytes(),
        headers={**auth, "X-Pxd-Options": json.dumps({"pages": [1], "tables": [{"page": 1, "bbox": [10, 20, 200, 80]}]})},
    )
    assert body.status_code == 200
    assert body.json()["model"] == "PaddleOCR-VL-0.9B"
    assert body.json()["tables"][0]["cells"][3]["text"] == "0.98"
    assert seen["regions"] == [{"page": 1, "bbox": [10, 20, 200, 80]}]
    bad = client.post("/v1/tables", content=PDF.read_bytes(), headers={**auth, "X-Pxd-Options": "{nope"})
    assert bad.status_code == 400
