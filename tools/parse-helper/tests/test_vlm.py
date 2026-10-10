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


def test_caption_strip_is_the_gap_under_a_full_width_plate():
    from plexus_parse_helper.vlm_read import caption_strips

    plate = {"page": 1, "label": "image", "score": 0.94, "bbox": [1, 4, 1025, 684]}
    strips = caption_strips([plate], 1025, 735)
    assert len(strips) == 1
    assert strips[0]["captionStrip"] is True
    assert strips[0]["bbox"][1] == 684
    assert strips[0]["bbox"][3] == 735
    covered = caption_strips([
        plate,
        {"page": 1, "label": "text", "score": 0.9, "bbox": [0, 684, 1025, 735]},
    ], 1025, 735)
    assert covered == []


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


def test_tables_route_returns_the_recorded_runner(tmp_path, monkeypatch):
    # Layout on this machine must not turn a tables-only runner into a high-accuracy engine.
    monkeypatch.setattr("plexus_parse_helper.server.layout_available", lambda: False)
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


def _col(x, ys, text="1.0", width=12):
    return [{"text": text, "x0": x, "y0": y, "x1": x + width, "y1": y + 8} for y in ys]


def test_union_keeps_a_second_table_and_the_layout_rectangle():
    from plexus_parse_helper.vlm_boxes import choose_table_boxes

    chosen = choose_table_boxes(
        [{"label": "table", "score": 0.9, "bbox": [10, 10, 80, 40]}],
        [{"label": "table", "score": 0, "bbox": [10, 120, 80, 180]}],
        page_size=(200, 300),
    )
    assert len(chosen) == 2
    assert {box["source"] for box in chosen} == {"layout", "caller"}
    top = next(box for box in chosen if box["source"] == "layout")
    assert top["bbox"] == [10.0, 10.0, 80.0, 40.0]
    overlapped = choose_table_boxes(
        [{"label": "table", "score": 0.8, "bbox": [10, 10, 100, 80]}],
        [{"label": "table", "score": 0, "bbox": [12, 40, 110, 140]}],
        page_size=(200, 200),
    )
    assert len(overlapped) == 1
    assert overlapped[0]["source"] == "union"
    # The layout rectangle. The caller box hangs below it and is not the crop.
    assert overlapped[0]["bbox"] == [10.0, 10.0, 100.0, 80.0]
    halves = choose_table_boxes(
        [
            {"label": "table", "score": 0.8, "bbox": [10, 10, 100, 50]},
            {"label": "table", "score": 0.7, "bbox": [20, 30, 120, 80]},
        ],
        [],
        page_size=(200, 200),
    )
    assert len(halves) == 1
    assert halves[0]["source"] == "layout"
    assert halves[0]["bbox"] == [10.0, 10.0, 120.0, 80.0]


def test_whole_page_when_the_layout_model_misses_a_numeric_grid():
    from plexus_parse_helper.vlm_boxes import aligned_numeric_columns, choose_table_boxes

    rows = [20, 36, 52, 68, 84]
    grid = _col(40, rows) + _col(90, rows, "2.5")
    assert aligned_numeric_columns(grid) is True
    assert aligned_numeric_columns(_col(40, rows)) is False
    prose = [
        {"text": "The", "x0": 20, "y0": 20, "x1": 40, "y1": 28},
        {"text": "yield", "x0": 44, "y0": 20, "x1": 70, "y1": 28},
        {"text": "1913", "x0": 20, "y0": 40, "x1": 40, "y1": 48},
    ]
    assert aligned_numeric_columns(prose) is False
    sentence = "The combination of the draw bench and the die"
    ys = [20, 36, 52, 68, 84]

    def prose_row(y, left, right):
        return [
            {"text": sentence, "x0": 40, "y0": y, "x1": 220, "y1": y + 8},
            {"text": left, "x0": 230, "y0": y, "x1": 246, "y1": y + 8},
            {"text": right, "x0": 280, "y0": y, "x1": 296, "y1": y + 8},
        ]

    claim = []
    decimals = []
    short = []
    for y in ys:
        claim.extend(prose_row(y, "1", "70"))
        decimals.extend(prose_row(y, "1.2", "3.4"))
        short.extend([
            {"text": "North", "x0": 20, "y0": y, "x1": 52, "y1": y + 8},
            {"text": "12", "x0": 80, "y0": y, "x1": 92, "y1": y + 8},
            {"text": "14", "x0": 120, "y0": y, "x1": 132, "y1": y + 8},
        ])
    assert aligned_numeric_columns(claim) is False
    assert aligned_numeric_columns(decimals) is True
    assert aligned_numeric_columns(short) is True
    contents = []
    for i, y in enumerate(ys):
        contents.extend([
            {"text": f"{280 + i}.", "x0": 28, "y0": y, "x1": 48, "y1": y + 8},
            {"text": "Cooling", "x0": 52, "y0": y, "x1": 100, "y1": y + 8},
            {"text": "by", "x0": 104, "y0": y, "x1": 120, "y1": y + 8},
            {"text": str(250 + i), "x0": 300, "y0": y, "x1": 320, "y1": y + 8},
        ])
    assert aligned_numeric_columns(contents) is False
    scattered = []
    for y in (20, 140, 260, 400):
        scattered.extend([
            {"text": "12", "x0": 40, "y0": y, "x1": 52, "y1": y + 8},
            {"text": "40", "x0": 200, "y0": y, "x1": 212, "y1": y + 8},
        ])
    assert aligned_numeric_columns(scattered) is False
    from plexus_parse_helper.vlm_boxes import labeled_decimal_column

    names = ["Methane", "Ethane", "Propane", "Butane", "Nitrogen"]
    values = ["84.7", "9.4", "3.0", "1.3", "1.6"]
    column = []
    integers = []
    for i, y in enumerate(ys):
        column.extend([
            {"text": names[i], "x0": 40, "y0": y, "x1": 90, "y1": y + 8},
            {"text": values[i], "x0": 200, "y0": y, "x1": 224, "y1": y + 8},
        ])
        integers.extend([
            {"text": names[i], "x0": 40, "y0": y, "x1": 90, "y1": y + 8},
            {"text": str(i + 1), "x0": 200, "y0": y, "x1": 212, "y1": y + 8},
        ])
    assert aligned_numeric_columns(column) is False
    assert labeled_decimal_column(column) is True
    assert labeled_decimal_column(integers) is False
    assert labeled_decimal_column([
        {"text": "1.5", "x0": 200, "y0": y, "x1": 220, "y1": y + 8} for y in ys
    ]) is False
    prose_decimals = []
    for y in ys:
        prose_decimals.extend([
            {"text": sentence, "x0": 40, "y0": y, "x1": 280, "y1": y + 8},
            {"text": "1.5", "x0": 300, "y0": y, "x1": 320, "y1": y + 8},
        ])
    assert labeled_decimal_column(prose_decimals) is False
    page = choose_table_boxes(
        [],
        [{"label": "table", "score": 0, "bbox": [10, 10, 40, 30]}],
        page_size=(200, 300),
        numeric=True,
    )
    assert len(page) == 1
    assert page[0]["source"] == "page"
    assert page[0]["bbox"] == [0, 0, 200, 300]
    kept = choose_table_boxes(
        [],
        [{"label": "table", "score": 0, "bbox": [10, 10, 40, 30]}],
        page_size=(200, 300),
        numeric=False,
    )
    assert kept[0]["source"] == "caller"
    layout_only = choose_table_boxes(
        [{"label": "table", "score": 0.9, "bbox": [10, 10, 80, 40]}],
        [{"label": "table", "score": 0, "bbox": [10, 120, 80, 180]}],
        page_size=(200, 300),
        box_mode="layout",
    )
    assert len(layout_only) == 1 and layout_only[0]["source"] == "layout"
    caller_only = choose_table_boxes(
        [{"label": "table", "score": 0.9, "bbox": [10, 10, 80, 40]}],
        [{"label": "table", "score": 0, "bbox": [10, 120, 80, 180]}],
        page_size=(200, 300),
        box_mode="caller",
    )
    assert len(caller_only) == 1 and caller_only[0]["source"] == "caller"


def test_weight_sha256_rejects_a_mismatch_and_accepts_a_match(tmp_path):
    import hashlib

    from plexus_parse_helper.vlm_weights import verify_tree

    path = tmp_path / "model.safetensors"
    path.write_bytes(b"weights")
    digest = hashlib.sha256(b"weights").hexdigest()
    verify_tree(tmp_path, {"model.safetensors": {"sha256": digest, "bytes": 7}})
    try:
        verify_tree(tmp_path, {"model.safetensors": {"sha256": "0" * 64, "bytes": 7}})
    except ValueError as exc:
        assert "sha256" in str(exc)
    else:
        raise AssertionError("a mismatched weight was accepted")


def test_layout_table_inside_a_figure_is_not_read():
    from plexus_parse_helper.vlm_boxes import drop_layout_inside_figures

    figure = {"bbox": [20, 40, 180, 220], "label": "chart"}
    axis = {"bbox": [40, 60, 160, 180], "source": "layout"}
    beside = {"bbox": [20, 240, 180, 290], "source": "layout"}
    asked = {"bbox": [40, 60, 160, 180], "source": "caller"}
    union = {"bbox": [40, 60, 160, 180], "source": "union"}
    kept = drop_layout_inside_figures([axis, beside, asked, union], [figure])
    assert axis not in kept
    assert beside in kept
    assert asked in kept
    assert union in kept


def test_whole_page_read_does_not_hide_a_figure():
    from plexus_parse_helper.vlm_read import covered_by_table

    page = {"bbox": [0, 0, 200, 300], "source": "page"}
    table = {"bbox": [10, 10, 80, 40], "source": "layout"}
    on_table = [12, 12, 70, 36]
    aside = [100, 200, 140, 240]
    assert covered_by_table(on_table, [page]) is False
    assert covered_by_table(on_table, [table]) is True
    assert covered_by_table(aside, [table]) is False


def test_generate_is_greedy_and_repeatable(monkeypatch):
    import mlx.core as mx

    from plexus_parse_helper.vlm_tables import _generate, greedy_sampler

    assert int(greedy_sampler(mx.array([[0.1, 3.0, 0.2]])).item()) == 1

    class Config:
        eos_token_id = []

    class Model:
        config = Config()

    class Proc:
        tokenizer = type("Tok", (), {"stopping_criteria": None})()

    class Mx:
        seeded = None

        class random:
            @staticmethod
            def seed(value):
                Mx.seeded = value

        @staticmethod
        def reset_peak_memory():
            pass

    class Stop:
        def __init__(self, *args, **kwargs):
            pass

    monkeypatch.setattr("plexus_parse_helper.vlm_tables._get_model", lambda: (Model(), Proc(), "", Mx))
    monkeypatch.setattr("plexus_parse_helper.vlm_tables._RepeatStop", Stop)
    seen = []

    def generate(*args, **kwargs):
        seen.append(kwargs)
        return type("Out", (), {"text": "<fcel>Year<nl>"})()

    import mlx_vlm

    monkeypatch.setattr(mlx_vlm, "generate", generate)
    monkeypatch.setattr(
        "mlx_vlm.prompt_utils.apply_chat_template",
        lambda *args, **kwargs: "PROMPT",
    )
    first = _generate(None, "Table Recognition:", 8)
    second = _generate(None, "Table Recognition:", 8)
    assert first == second == "<fcel>Year<nl>"
    assert len(seen) == 2
    assert seen[0]["temperature"] == 0.0
    assert seen[0]["seed"] == 0
    assert seen[0]["sampler"] is greedy_sampler
    assert seen[0] == seen[1]
    assert Mx.seeded == 0
