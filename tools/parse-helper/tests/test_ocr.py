"""OCR geometry (saved Vision result, no Vision needed), rules on a synthetic image, the
numeric-cell re-read glyph check, and /v1/ocr auth + cache."""

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from plexus_parse_helper import ocr
from plexus_parse_helper.cache import ParseCache
from plexus_parse_helper.jobs import JobManager
from plexus_parse_helper.server import create_app

FIX = Path(__file__).resolve().parent / "fixtures"
PDF = Path(__file__).resolve().parents[3] / "test" / "fixtures" / "pdf" / "report.pdf"
TOKEN = "test-token"


def _saved_tiles():
    data = json.loads((FIX / "ocr-table.vision.json").read_text(encoding="utf-8"))
    tiled = []
    for entry in data["tiles"]:
        obs = [ocr.Observation(text=o["text"], conf=o["conf"], box=tuple(o["box"]), words=[(w, tuple(b)) for w, b in o["words"]]) for o in entry["observations"]]
        tiled.append((tuple(entry["tile"]), obs))
    return data, tiled


def test_saved_vision_result_converts_to_word_items_in_points():
    data, tiled = _saved_tiles()
    w, h = data["size"]
    items = ocr.observations_to_items(tiled, data["dpi"] / 72, (w, h))
    words = [i["str"] for i in items]
    assert words == ["Item", "1980", "1979", "Alpha", "0.05", "1.20", "Beta", "12.84", "0.00"]
    for item in items:
        size, a, b, c, x, base = item["transform"]
        assert a == b == 0 and c == size and size > 0
        assert 0 <= x <= w * 72 / data["dpi"] and 0 <= base <= h * 72 / data["dpi"]
        assert item["fontName"] == "ocr" and 0 < item["conf"] <= 1
        assert item["y0"] < base < item["y1"]
    # Row baselines agree inside a row, differ between rows; sizes snapped to one body size.
    rows = {}
    for item in items:
        rows.setdefault(round(item["transform"][5]), []).append(item["str"])
    assert len(rows) == 3
    assert len({item["transform"][0] for item in items}) == 1
    # Duplicates from tile overlap were dropped: every word once.
    assert len(words) == len(set(words))


def test_ink_refinement_moves_baselines_to_the_ink():
    data, tiled = _saved_tiles()
    img = Image.open(FIX / data["image"]).convert("L")
    scale = data["dpi"] / 72
    plain = ocr.observations_to_items(tiled, scale, img.size)
    refined = ocr.observations_to_items(tiled, scale, img.size, image=img)
    assert [i["str"] for i in refined] == [i["str"] for i in plain]
    # Ink-refined baselines of one row are identical (same text line), and the boxes are
    # trimmed to the ink, so they are never wider than Vision's.
    first_row = [i for i in refined if i["str"] in ("Alpha", "0.05", "1.20")]
    assert len({i["transform"][5] for i in first_row}) == 1
    for p, r in zip(plain, refined):
        assert r["width"] <= p["width"] + 0.5


def test_line_metrics_and_baseline_clusters():
    size, base = ocr._line_metrics("1980", 10.0, 15.0)
    assert size == pytest.approx(5 / 0.95) and base == pytest.approx(15 - 0.03 * size)
    size2, base2 = ocr._line_metrics("gyp", 10.0, 15.0)
    assert base2 < 15
    boxes = [{"base": 10.0, "size": 6}, {"base": 10.5, "size": 6}, {"base": 17.0, "size": 6}]
    assert [len(c) for c in ocr._baseline_clusters(boxes)] == [2, 1]
    items = [{"base": 10.0, "size": 6}, {"base": 11.0, "size": 6}, {"base": 16.0, "size": 6}]
    ocr.snap_baselines(items)
    assert [i["base"] for i in items] == [10.0, 10.0, 16.0]


def test_merge_corrected_takes_text_words_only_and_joins_split_words():
    raw = [
        {"str": "0.00", "transform": [6, 0, 0, 6, 10, 20], "width": 12, "conf": 1.0, "y0": 15, "y1": 21},
        {"str": "Anth", "transform": [6, 0, 0, 6, 30, 20], "width": 12, "conf": 1.0, "y0": 15, "y1": 21},
        {"str": "rax", "transform": [6, 0, 0, 6, 43, 20], "width": 9, "conf": 1.0, "y0": 15, "y1": 21},
        {"str": "Laprosy", "transform": [6, 0, 0, 6, 60, 20], "width": 20, "conf": 1.0, "y0": 15, "y1": 21},
    ]
    corrected = [
        {"str": "o.oo", "transform": [6, 0, 0, 6, 10, 20], "width": 12, "conf": 1.0, "y0": 15, "y1": 21},
        {"str": "Anthrax", "transform": [6, 0, 0, 6, 30, 20], "width": 22, "conf": 1.0, "y0": 15, "y1": 21},
        {"str": "Leprosy", "transform": [6, 0, 0, 6, 60, 20], "width": 20, "conf": 1.0, "y0": 15, "y1": 21},
    ]
    out = ocr.merge_corrected(raw, corrected)
    assert [i["str"] for i in out] == ["0.00", "Anthrax", "Leprosy"]
    assert out[2]["raw"] == "Laprosy"


def test_rules_from_synthetic_image_and_deskew():
    img = Image.new("L", (600, 400), 255)
    arr = np.asarray(img).copy()
    arr[100:103, 40:560] = 0      # horizontal rule
    arr[300:302, 40:560] = 0
    arr[20:380, 200:203] = 0      # vertical rule
    arr[150:170, 60:120] = 0      # a text-like blob: not a rule
    scale = 300 / 72
    rules = ocr.rules_from_image(arr, scale)
    axes = sorted((("h" if r["y0"] == r["y1"] else "v"), round(r["x1"] - r["x0"] + r["y1"] - r["y0"])) for r in rules)
    assert axes == [("h", round(520 / scale)), ("h", round(520 / scale)), ("v", round(360 / scale))]
    assert all(r["x0"] >= 0 and r["y0"] >= 0 for r in rules)
    assert ocr.deskew_angle(arr) == 0.0
    # A rotated copy reads back its skew (within a tenth of a degree) and deskew undoes it.
    tilted = np.asarray(ocr.deskew(Image.fromarray(arr), -1.5))
    angle = ocr.deskew_angle(tilted)
    assert abs(angle - 1.5) < 0.15
    straight = np.asarray(ocr.deskew(Image.fromarray(tilted), angle))
    assert abs(ocr.deskew_angle(straight)) < 0.1


def test_ink_glyph_dash_star_and_nothing():
    dash = np.full((30, 120), 255, dtype=np.uint8)
    dash[14:17, 50:70] = 0
    assert ocr.ink_glyph(dash) == "—"
    star = np.full((30, 120), 255, dtype=np.uint8)
    star[8:16, 60:68] = 0
    assert ocr.ink_glyph(star) == "*"
    blank = np.full((30, 120), 255, dtype=np.uint8)
    assert ocr.ink_glyph(blank) is None
    dots = np.full((30, 120), 255, dtype=np.uint8)
    for x in range(10, 110, 12):
        dots[15:17, x:x + 2] = 0
    assert ocr.ink_glyph(dots) is None, "leader dots are not a dash"
    ruled = dash.copy()
    ruled[:, 2:5] = 0
    assert ocr.ink_glyph(ruled) == "—", "a rule along the crop edge is ignored"


def test_tile_grid_covers_the_image_with_overlap():
    tiles = ocr.tile_grid(1000, 600)
    assert len(tiles) == ocr.TILE_COLS * ocr.TILE_ROWS
    assert tiles[0][:2] == (0, 0) and tiles[-1][2:] == (1000, 600)
    assert tiles[1][0] < tiles[0][2], "neighbours overlap"


def test_page_record_shape_and_options_hash():
    rec = ocr.page_record(3, [], [], 612.0, 792.0, deskew_deg=0.4)
    assert rec["n"] == 3 and rec["scan"] is True and rec["transform"] == [1, 0, 0, 1, 0, 0]
    assert rec["w"] == 612.0 and rec["h"] == 792.0 and rec["deskew"] == 0.4
    assert ocr.ocr_options_hash(None) != ocr.ocr_options_hash([1])
    assert ocr.ocr_options_hash([1, [3, 5]]) == ocr.ocr_options_hash([1, [3, 5]])


def _app(tmp_path, ocr_runner, cell_runner=None):
    jobs = JobManager(runner=lambda *a: {})
    cache = ParseCache(tmp_path / "cache", max_bytes=5_000_000)
    return create_app(token=TOKEN, jobs=jobs, cache=cache, ocr_runner=ocr_runner, cell_runner=cell_runner)


def test_ocr_endpoint_auth_cache_and_cells(tmp_path):
    calls = []

    def fake_ocr(path, pages):
        calls.append(("ocr", pages))
        return {"schema": "pxd-ocr/1", "pageCount": 3, "pages": [ocr.page_record(p, [], [], 100.0, 100.0) for p in (pages or [1])]}

    def fake_cells(path, cells):
        calls.append(("cells", len(cells)))
        return {"cells": [{"page": c["page"], "bbox": c["bbox"], "text": "0.01", "conf": 1.0, "glyph": None} for c in cells]}

    client = TestClient(_app(tmp_path, fake_ocr, fake_cells))
    body = PDF.read_bytes()
    auth = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/pdf"}
    assert client.post("/v1/ocr", content=body).status_code == 401
    assert client.post("/v1/ocr", content=body, headers={**auth, "Origin": "https://evil.example"}).status_code == 403
    first = client.post("/v1/ocr", content=body, headers={**auth, "X-Pxd-Options": json.dumps({"pages": [2]})})
    assert first.status_code == 200
    doc = first.json()
    assert doc["pages"][0]["n"] == 2 and doc["cached"] is False and doc["sha256"]
    second = client.post("/v1/ocr", content=body, headers={**auth, "X-Pxd-Options": json.dumps({"pages": [2]})})
    assert second.json()["cached"] is True
    assert calls == [("ocr", [2])], "the second call came from the cache"
    other = client.post("/v1/ocr", content=body, headers={**auth, "X-Pxd-Options": json.dumps({"pages": [3]})})
    assert other.json()["cached"] is False and calls[-1] == ("ocr", [3])
    cells = client.post("/v1/ocr", content=body, headers={**auth, "X-Pxd-Options": json.dumps({"cells": [{"page": 2, "bbox": [1, 2, 3, 4]}]})})
    assert cells.status_code == 200
    assert cells.json()["cells"][0]["text"] == "0.01" and cells.json()["cached"] is False
    again = client.post("/v1/ocr", content=body, headers={**auth, "X-Pxd-Options": json.dumps({"cells": [{"page": 2, "bbox": [1, 2, 3, 4]}]})})
    assert again.json()["cached"] is False, "cell re-reads are never cached"
    assert calls[-2:] == [("cells", 1), ("cells", 1)]
    bad = client.post("/v1/ocr", content=body, headers={**auth, "X-Pxd-Options": "{nope"})
    assert bad.status_code == 400
    assert client.post("/v1/ocr", content=b"", headers=auth).status_code == 400
    health = client.get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"}).json()
    assert health["engines"] == ["docling", "ocr", "cloud"]


def _spell_item(text, x, y):
    return {"str": text, "transform": [10, 0, 0, 10, x, y], "width": 48, "y0": y - 8, "y1": y + 2}


def test_prefer_spellings_matches_the_page_consensus_and_skips_ruled_cells():
    words = {"pressure", "form", "from"}
    items = [
        _spell_item("prossure", 40, 200),
        _spell_item("pressure", 100, 200),
        _spell_item("pressure", 180, 200),
        _spell_item("form", 260, 200),
        _spell_item("from", 320, 200),
        _spell_item("from", 380, 200),
    ]
    out = ocr.prefer_spellings(items, words)
    assert [i["str"] for i in out] == ["pressure", "pressure", "pressure", "form", "from", "from"]
    assert [i["str"] for i in ocr.prefer_spellings(out, words)] == ["pressure", "pressure", "pressure", "form", "from", "from"]
    rules = [
        {"x0": 20, "y0": 30, "x1": 200, "y1": 30},
        {"x0": 20, "y0": 80, "x1": 200, "y1": 80},
        {"x0": 20, "y0": 30, "x1": 20, "y1": 80},
        {"x0": 200, "y0": 30, "x1": 200, "y1": 80},
    ]
    body = [
        _spell_item("suporcharger", 40, 200),
        _spell_item("supercharger", 140, 200),
        _spell_item("supercharger", 240, 200),
        _spell_item("supercharger", 340, 200),
        _spell_item("suporcharger", 80, 50),
    ]
    spelled = ocr.prefer_spellings(body, {"pressure"}, rules, 612, 792)
    assert spelled[0]["str"] == "supercharger"
    assert spelled[4]["str"] == "suporcharger"
    assert "pressure" in ocr.lexicon()
    assert "prossure" not in ocr.lexicon()
