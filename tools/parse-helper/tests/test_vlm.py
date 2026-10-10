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


def test_text_reader_pin_names_every_file():
    from plexus_parse_helper.vlm_weights import TEXT_FILES, TEXT_LABEL, TEXT_LICENCE, TEXT_REVISION

    assert TEXT_LABEL == "Qwen3-VL-8B-Instruct-4bit"
    assert TEXT_LICENCE == "Apache-2.0"
    assert len(TEXT_REVISION) == 40
    assert "model.safetensors.index.json" in TEXT_FILES
    total = 0
    for spec in TEXT_FILES.values():
        assert len(spec["sha256"]) == 64
        assert spec["bytes"] > 0
        total += spec["bytes"]
    assert total > 5_000_000_000


def test_fit_page_caps_the_long_side_and_leaves_a_small_page():
    from PIL import Image

    from plexus_parse_helper.vlm_text import MAX_SIDE, fit_page

    small = Image.new("RGB", (100, 80))
    assert fit_page(small).size == (100, 80)
    fitted = fit_page(Image.new("RGB", (4000, 2000)))
    assert max(fitted.size) == MAX_SIDE
    assert fitted.size[0] >= fitted.size[1]
    # A letter-size page at the helper's 200 dpi render goes in as rendered.
    letter = Image.new("RGB", (1700, 2200))
    assert fit_page(letter).size == (1700, 2200)
    assert MAX_SIDE >= 2548, "a 600 x 917 pt letter rendered at 200 dpi must not be shrunk"


def test_page_text_decode_is_greedy(monkeypatch):
    from PIL import Image

    from plexus_parse_helper.vlm_tables import greedy_sampler
    from plexus_parse_helper.vlm_text import read_page_text

    class Model:
        class config:
            eos_token_id = 1

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

    monkeypatch.setattr("plexus_parse_helper.vlm_text._get_model", lambda: (Model(), Proc(), Mx))
    monkeypatch.setattr("plexus_parse_helper.vlm_text._RepeatStop", Stop)
    seen = []

    def generate(*args, **kwargs):
        seen.append(kwargs)
        return type("Out", (), {"text": "Dear reader"})()

    import mlx_vlm

    monkeypatch.setattr(mlx_vlm, "generate", generate)
    monkeypatch.setattr("mlx_vlm.prompt_utils.apply_chat_template", lambda *args, **kwargs: "PROMPT")
    assert read_page_text(Image.new("RGB", (32, 32))) == "Dear reader"
    assert seen[0]["temperature"] == 0.0
    assert seen[0]["seed"] == 0
    assert seen[0]["sampler"] is greedy_sampler
    assert seen[0]["max_tokens"] == 2048
    assert Mx.seeded == 0


def _page_layout(kind):
    def layout(bitmap):
        w, h = bitmap.size
        if kind == "empty":
            return []
        boxes = []
        if kind != "plate":
            boxes.append({"label": "text", "score": 0.9, "bbox": [8, 8, w - 8, int(h * 0.4)]})
        if kind != "text":
            boxes.append({"label": "image", "score": 0.95, "bbox": [0, 0, w, int(h * 0.85)]})
        return boxes

    return layout


def test_body_text_uses_the_page_model_and_a_strip_stays_on_paddle(monkeypatch):
    from plexus_parse_helper.vlm_read import read_pages
    from plexus_parse_helper.vlm_tables import OCR_PROMPT
    from plexus_parse_helper.vlm_weights import TEXT_LABEL

    calls = {"page": 0, "prompts": []}
    monkeypatch.setattr("plexus_parse_helper.vlm_read.detect_layout", _page_layout("both"))
    monkeypatch.setattr(
        "plexus_parse_helper.vlm_read.read_page_text",
        lambda image: calls.__setitem__("page", calls["page"] + 1) or "Dear reader one line",
    )

    def generate(image, prompt, tokens):
        calls["prompts"].append(prompt)
        return "printed credit"

    monkeypatch.setattr("plexus_parse_helper.vlm_read._generate", generate)
    out = read_pages(str(PDF), {"pages": [1], "text": True})
    assert calls["page"] == 1
    assert calls["prompts"] == [OCR_PROMPT]
    assert out["model"] == "PaddleOCR-VL-0.9B"
    assert out["textModel"] == TEXT_LABEL
    page_lines = [line for line in out["lines"] if line.get("pageText")]
    strips = [line for line in out["lines"] if not line.get("pageText")]
    assert len(page_lines) == 1 and page_lines[0]["text"] == "Dear reader one line"
    assert len(strips) == 1 and strips[0]["text"] == "printed credit"


def test_a_caption_plate_does_not_call_the_page_model(monkeypatch):
    from plexus_parse_helper.vlm_read import read_pages

    calls = {"page": 0}
    monkeypatch.setattr("plexus_parse_helper.vlm_read.detect_layout", _page_layout("plate"))
    monkeypatch.setattr(
        "plexus_parse_helper.vlm_read.read_page_text",
        lambda image: calls.__setitem__("page", calls["page"] + 1) or "should not run",
    )
    monkeypatch.setattr("plexus_parse_helper.vlm_read._generate", lambda image, prompt, tokens: "printed credit")
    out = read_pages(str(PDF), {"pages": [1], "text": True})
    assert calls["page"] == 0
    assert out["textModel"] is None
    assert out["lines"] and not any(line.get("pageText") for line in out["lines"])


def test_empty_page_text_falls_back_to_paddle_crops(monkeypatch):
    from plexus_parse_helper.vlm_read import read_pages

    monkeypatch.setattr("plexus_parse_helper.vlm_read.detect_layout", _page_layout("text"))
    monkeypatch.setattr("plexus_parse_helper.vlm_read.read_page_text", lambda image: "")
    monkeypatch.setattr("plexus_parse_helper.vlm_read._generate", lambda image, prompt, tokens: "crop text")
    out = read_pages(str(PDF), {"pages": [1], "text": True})
    assert out["textModel"] is None
    assert len(out["lines"]) == 1
    assert out["lines"][0]["text"] == "crop text"
    assert "pageText" not in out["lines"][0]


def test_text_mask_boxes_skip_without_body_and_drop_a_box_over_text():
    from plexus_parse_helper.vlm_read import text_mask_boxes

    table = {"bbox": [10, 300, 300, 500], "source": "layout"}
    whole = {"bbox": [0, 0, 612, 792], "source": "page"}
    figure = {"page": 1, "label": "image", "score": 0.9, "bbox": [320, 300, 600, 500]}
    weak_figure = {"page": 1, "label": "image", "score": 0.3, "bbox": [320, 520, 600, 700]}
    text = {"page": 1, "label": "text", "score": 0.9, "bbox": [10, 10, 600, 280]}
    assert text_mask_boxes([table, whole], [figure, weak_figure, text], []) == []
    assert text_mask_boxes([table, whole], [figure, weak_figure, text], [text]) == [table["bbox"], figure["bbox"]]
    # A figure box that covers most of a text box is a contradiction: the text stays.
    over = {"page": 1, "label": "image", "score": 0.9, "bbox": [0, 0, 612, 300]}
    assert text_mask_boxes([], [over, text], [text]) == []


def test_mask_boxes_paints_paper_colour_inside_and_leaves_the_rest():
    from PIL import Image

    from plexus_parse_helper.vlm_read import mask_boxes, paper_colour

    page = Image.new("RGB", (200, 300), (240, 236, 220))
    for x in range(20, 180):
        for y in range(150, 250):
            page.putpixel((x, y), (20, 20, 20))
    page.putpixel((50, 50), (0, 0, 0))
    assert paper_colour(page) == (240, 236, 220)
    out = mask_boxes(page, [[10.0, 75.0, 90.0, 125.0]], 2.0)
    assert out.size == page.size
    assert out.getpixel((100, 200)) == (240, 236, 220)
    assert out.getpixel((50, 50)) == (0, 0, 0)
    assert page.getpixel((100, 200)) == (20, 20, 20)


def test_page_text_reads_a_masked_page(monkeypatch):
    from plexus_parse_helper.vlm_read import read_pages

    def layout(bitmap):
        w, h = bitmap.size
        return [
            {"label": "text", "score": 0.9, "bbox": [8, 8, w - 8, int(h * 0.4)]},
            {"label": "table", "score": 0.9, "bbox": [8, int(h * 0.5), w - 8, int(h * 0.9)]},
        ]

    seen = {}

    def page_text(image):
        seen["image"] = image
        return "Dear reader one line"

    monkeypatch.setattr("plexus_parse_helper.vlm_read.detect_layout", layout)
    monkeypatch.setattr("plexus_parse_helper.vlm_read.read_page_text", page_text)
    monkeypatch.setattr("plexus_parse_helper.vlm_read._generate", lambda image, prompt, tokens=None: "<table><tr><td>1</td></tr></table>")
    out = read_pages(str(PDF), {"pages": [1], "text": True})
    image = seen["image"]
    w, h = image.size
    colour = image.getpixel((w // 2, int(h * 0.7)))
    # Everything inside the table box is one colour: the paper.
    assert image.getpixel((w // 4, int(h * 0.6))) == colour
    assert image.getpixel((3 * w // 4, int(h * 0.85))) == colour
    assert [line for line in out["lines"] if line.get("pageText")][0]["text"] == "Dear reader one line"


def test_a_wide_span_row_is_not_a_loop():
    from plexus_parse_helper.vlm_tables import SPAN_RUN, _RepeatStop

    class Tok:
        def decode(self, ids, skip_special_tokens=False):
            return "".join({1: "<lcel>", 2: "x", 3: "<nl>"}[i] for i in ids)

        def convert_tokens_to_ids(self, name):
            return -1

    stop = _RepeatStop([], Tok())
    stop.reset()
    # A thirteen-column caption: twelve span tokens after the text.
    assert all(not stop(2) for _ in range(3))
    assert all(not stop(1) for _ in range(12))
    # Twelve ordinary tokens in a row are still a loop.
    loop = _RepeatStop([], Tok())
    loop.reset()
    assert any(loop(2) for _ in range(12))
    # Span tokens that run past any table width stop too.
    run = _RepeatStop([], Tok())
    run.reset()
    assert any(run(1) for _ in range(SPAN_RUN))
