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


def test_spanned_header_empty_column_and_decimal_column():
    raw = (
        "<fcel>Length of channel<fcel>At 2-inch pressure<lcel><fcel><nl>"
        "<ucel><fcel>Rate of flow<fcel>Discharge coefficient (K)<fcel><nl>"
        "<fcel>1<fcel>0.0142<fcel>0.0219<fcel><nl>"
        "<fcel>2<fcel>0.0292<fcel>0.0362<fcel><nl>"
        "<fcel>32.<fcel>0.0430<fcel>0.0500<fcel><nl>"
        "<fcel>A paragraph of prose that is much too long to be a grid cell and should be dropped from the table entirely.<nl>"
    )
    tables = tables_from_text(raw, "html")
    assert len(tables) == 1
    table = tables[0]
    assert table["cols"] == 3
    assert table["rows"] == 5
    by_key = {(c["r"], c["c"]): c for c in table["cells"]}
    assert by_key[(0, 0)]["rowSpan"] == 2
    assert by_key[(0, 1)]["colSpan"] == 2
    assert by_key[(1, 1)]["text"] == "Rate of flow"
    assert by_key[(2, 1)]["text"] == "0.0142"
    assert by_key[(3, 1)]["text"] == ".0292"
    assert by_key[(3, 2)]["text"] == ".0362"
    assert by_key[(4, 0)]["text"] == "32"
    assert all(c["c"] < 3 for c in table["cells"])
    assert not any("paragraph" in c["text"] for c in table["cells"])


def test_table_caption_is_not_a_row_and_math_markup_becomes_print():
    raw = (
        "<fcel>TABLE II. Original values<lcel><nl>"
        "<fcel>mu<fcel>\\(\\mu\\)<nl>"
        "<fcel>log<fcel>\\(\\overline{2.6972}\\)<nl>"
        "<fcel>temp<fcel>22.6\\(^{\\circ}\\)C<nl>"
    )
    tables = tables_from_text(raw, "html")
    assert len(tables) == 1
    by_key = {(c["r"], c["c"]): c for c in tables[0]["cells"]}
    assert tables[0]["rows"] == 3
    assert by_key[(0, 0)]["text"] == "mu"
    assert by_key[(0, 1)]["text"] == "μ"
    assert by_key[(1, 1)]["text"] == "2\u0304.6972"
    assert by_key[(2, 1)]["text"] == "22.6°C"
    assert not any(c["text"].lower().startswith("table") for c in tables[0]["cells"])


def test_crop_is_top_left_and_stacked_boxes_join():
    from plexus_parse_helper.vlm_read import merge_stacked
    from plexus_parse_helper.vlm_tables import crop_pixels

    box = crop_pixels([10, 20, 50, 80], 200, 400, 200, 400, pad=0, top_pad=0)
    assert box == (10, 20, 50, 80)
    joined = merge_stacked([
        {"bbox": [0, 0, 100, 40], "score": 0.9},
        {"bbox": [2, 46, 98, 90], "score": 0.4},
    ])
    assert len(joined) == 1
    assert joined[0]["bbox"] == [0, 0, 100, 90]


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
    missing = client.post("/v1/vlm", content=PDF.read_bytes(), headers=auth)
    assert missing.status_code == 404
    assert missing.json()["error"] == "vlm-layout is not installed"


def test_vlm_route_returns_the_recorded_page(tmp_path):
    recorded = {
        "model": "PaddleOCR-VL-0.9B",
        "layoutModel": "PP-DocLayoutV2",
        "tables": RECORDED["tables"],
        "lines": [{"page": 1, "bbox": [1, 2, 3, 4], "text": "line"}],
        "figures": [],
        "layout": [{"page": 1, "label": "table", "score": 0.9, "bbox": [10, 20, 200, 80]}],
    }
    seen = {}

    def runner(path, options):
        seen["options"] = options
        assert Path(path).stat().st_size > 0
        return recorded

    app = create_app(
        token=TOKEN,
        jobs=JobManager(runner=lambda *a: {}),
        cache=ParseCache(tmp_path / "cache", max_bytes=1_000_000),
        vlm_runner=runner,
    )
    client = TestClient(app)
    health = client.get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert health["engines"] == ["docling", "ocr", "cloud", "vlm-tables", "vlm-layout", "vlm-text"]
    auth = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/pdf"}
    denied = client.post("/v1/vlm", content=PDF.read_bytes())
    assert denied.status_code == 401
    body = client.post(
        "/v1/vlm",
        content=PDF.read_bytes(),
        headers={**auth, "X-Pxd-Options": json.dumps({"pages": [1], "tables": [{"page": 1, "bbox": [1, 2, 3, 4]}], "text": False})},
    )
    assert body.status_code == 200
    assert body.json()["layoutModel"] == "PP-DocLayoutV2"
    assert seen["options"]["pages"] == [1]
    assert seen["options"]["text"] is False
