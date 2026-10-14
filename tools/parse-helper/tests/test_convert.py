"""Convert saved Docling JSON. No Docling runtime."""

import json
from pathlib import Path

from plexus_parse_helper.convert import convert_docling, heading_level_from_text, merge_docling, to_top_left
from plexus_parse_helper.schema import validate_document, validate_table

FIXTURES = Path(__file__).parent / "fixtures"
TRUTH = Path(__file__).resolve().parents[3] / "test" / "fixtures" / "pdf" / "report.truth.json"


def test_bbox_origin_flip():
    bottom = {"l": 10, "r": 20, "t": 100, "b": 80, "coord_origin": "BOTTOMLEFT"}
    assert to_top_left(bottom, 792) == [10.0, 692.0, 20.0, 712.0]
    top = {"l": 10, "r": 40, "t": 12, "b": 30, "coord_origin": "TOPLEFT"}
    assert to_top_left(top, 792) == [10.0, 12.0, 40.0, 30.0]
    swapped = {"l": 20, "r": 10, "t": 80, "b": 100, "coord_origin": "BOTTOMLEFT"}
    assert to_top_left(swapped, 792) == [10.0, 692.0, 20.0, 712.0]


def test_heading_levels_from_numbering():
    assert heading_level_from_text("Environmental Monitoring", is_title=True) == 1
    assert heading_level_from_text("1 Introduction") == 2
    assert heading_level_from_text("2.1 Sampling") == 3
    assert heading_level_from_text("2.1.1 Detail") == 4
    assert heading_level_from_text("Appendix A. Site register (excerpt)") == 2


def test_validate_table_rejects_overlap_and_range():
    ok = {
        "rows": 2, "cols": 2,
        "cells": [
            {"r": 0, "c": 0, "rowSpan": 1, "colSpan": 2, "text": "a"},
            {"r": 1, "c": 0, "rowSpan": 1, "colSpan": 1, "text": "b"},
            {"r": 1, "c": 1, "rowSpan": 1, "colSpan": 1, "text": "c"},
        ],
    }
    assert validate_table(ok) == []
    overlap = {
        "rows": 2, "cols": 2,
        "cells": [
            {"r": 0, "c": 0, "rowSpan": 2, "colSpan": 2, "text": "a"},
            {"r": 1, "c": 1, "rowSpan": 1, "colSpan": 1, "text": "b"},
        ],
    }
    assert any("overlap" in err for err in validate_table(overlap))
    outside = {"rows": 1, "cols": 1, "cells": [{"r": 0, "c": 1, "rowSpan": 1, "colSpan": 1}]}
    assert validate_table(outside)


def test_merge_docling_rebases_refs():
    def part(text_i, page):
        return {
            "texts": [{"self_ref": f"#/texts/{text_i}", "text": f"p{page}", "label": "text"}],
            "tables": [],
            "pictures": [],
            "groups": [],
            "body": {"children": [{"$ref": f"#/texts/{text_i}"}]},
            "pages": {str(page): {"page_no": page, "size": {"width": 10, "height": 10}}},
        }
    merged = merge_docling([part(0, 1), part(0, 2)])
    assert merged["texts"][1]["self_ref"] == "#/texts/1"
    assert merged["body"]["children"][1] == {"$ref": "#/texts/1"}
    assert set(merged["pages"]) == {"1", "2"}


def test_report_json_converts_to_schema():
    docling = json.loads((FIXTURES / "report.json").read_text(encoding="utf-8"))
    doc = convert_docling(docling, sha256="abc", created_at="2026-01-01T00:00:00Z")
    assert doc["schema"] == "pxd-parse/1"
    assert doc["engine"] == "docling"
    assert validate_document(doc) == []
    tables = [doc["blocks"][bid] for bid in doc["order"] if doc["blocks"][bid]["type"] == "table"]
    assert len(tables) == 3
    assert (tables[0]["rows"], tables[0]["cols"], tables[0]["headerRows"]) == (7, 7, 2)
    assert tables[0]["method"] == "tableformer"
    assert tables[0]["grid"]["xs"] and tables[0]["grid"]["ys"]
    reasons = {item["reason"] for item in doc["removed"]}
    assert "running-header" in reasons and "running-footer" in reasons
    headings = [doc["blocks"][bid] for bid in doc["order"] if doc["blocks"][bid]["type"] == "heading"]
    truth = json.loads(TRUTH.read_text(encoding="utf-8"))
    got = [(h["level"], h["text"]) for h in headings]
    expect = [(h["level"], h["text"]) for h in truth["headings"]]
    assert got == expect
    formulas = [doc["blocks"][bid] for bid in doc["order"] if doc["blocks"][bid]["type"] == "formula"]
    assert formulas and formulas[0]["latex"]
    assert formulas[0]["number"] is None
    captions = [b for b in doc["blocks"].values() if b["type"] == "caption" and b.get("for")]
    assert captions
    assert doc["title"].startswith("Environmental Monitoring")


def _synthetic(texts, groups=(), pictures=(), tables=(), body=()):
    """Tiny Docling dict. Boxes are BOTTOMLEFT on a 600 x 800 page."""
    def box(x0, y0, x1, y1):
        return {"l": x0, "b": y0, "r": x1, "t": y1, "coord_origin": "BOTTOMLEFT"}

    out_texts = []
    for i, (label, text, bbox, parent) in enumerate(texts):
        out_texts.append({
            "self_ref": f"#/texts/{i}", "parent": {"$ref": parent}, "children": [], "label": label,
            "content_layer": "body", "text": text, "prov": [{"page_no": 1, "bbox": box(*bbox)}],
        })
    return {
        "schema_name": "DoclingDocument",
        "body": {"self_ref": "#/body", "children": [{"$ref": r} for r in body], "label": "unspecified"},
        "groups": list(groups),
        "texts": out_texts,
        "pictures": list(pictures),
        "tables": list(tables),
        "pages": {"1": {"page_no": 1, "size": {"width": 600, "height": 800}}},
    }


def _group(index, label, children, parent="#/body"):
    return {
        "self_ref": f"#/groups/{index}", "parent": {"$ref": parent}, "label": label, "content_layer": "body",
        "children": [{"$ref": c} for c in children],
    }


def _picture(index, children, bbox):
    l, b, r, t = bbox
    return {
        "self_ref": f"#/pictures/{index}", "parent": {"$ref": "#/body"}, "label": "picture", "content_layer": "body",
        "children": [{"$ref": c} for c in children], "captions": [],
        "prov": [{"page_no": 1, "bbox": {"l": l, "b": b, "r": r, "t": t, "coord_origin": "BOTTOMLEFT"}}],
    }


def _texts_of(doc):
    out = []
    for bid in doc["order"]:
        block = doc["blocks"][bid]
        if block["type"] == "list":
            out.extend(f"list:{item['text']}" for item in block["items"])
        elif block["type"] == "table":
            out.append("table:" + "|".join(cell["text"] for cell in block["cells"]))
        elif block["type"] == "figure":
            out.append("figure")
        else:
            out.append(block.get("text") or "")
    return out


def test_form_area_group_keeps_texts_table_and_nested_list():
    table = {
        "self_ref": "#/tables/0", "parent": {"$ref": "#/groups/0"}, "label": "table", "content_layer": "body",
        "children": [], "captions": [], "footnotes": [],
        "prov": [{"page_no": 1, "bbox": {"l": 50, "b": 400, "r": 300, "t": 450, "coord_origin": "BOTTOMLEFT"}}],
        "data": {"num_rows": 1, "num_cols": 2, "table_cells": [
            {"start_row_offset_idx": 0, "end_row_offset_idx": 1, "start_col_offset_idx": 0, "end_col_offset_idx": 1,
             "text": "Item", "bbox": {"l": 50, "t": 450, "r": 150, "b": 400, "coord_origin": "BOTTOMLEFT"}},
            {"start_row_offset_idx": 0, "end_row_offset_idx": 1, "start_col_offset_idx": 1, "end_col_offset_idx": 2,
             "text": "Value", "bbox": {"l": 150, "t": 450, "r": 300, "b": 400, "coord_origin": "BOTTOMLEFT"}},
        ]},
    }
    raw = _synthetic(
        [
            ("text", "Field one: alpha", (50, 700, 300, 720), "#/groups/0"),
            ("text", "Field two: beta", (50, 650, 300, 670), "#/groups/0"),
            ("list_item", "first step", (60, 350, 300, 365), "#/groups/1"),
            ("list_item", "second step", (60, 330, 300, 345), "#/groups/1"),
            ("text", "Closing remark", (50, 200, 300, 220), "#/groups/0"),
        ],
        groups=[
            _group(0, "form_area", ["#/texts/0", "#/texts/1", "#/tables/0", "#/groups/1", "#/texts/4"]),
            _group(1, "list", ["#/texts/2", "#/texts/3"], parent="#/groups/0"),
        ],
        tables=[table],
        body=["#/groups/0"],
    )
    doc = convert_docling(raw)
    assert _texts_of(doc) == [
        "Field one: alpha",
        "Field two: beta",
        "table:Item|Value",
        "list:first step",
        "list:second step",
        "Closing remark",
    ]
    assert doc["stats"]["conserved"] == 0
    assert validate_document(doc) == []


def test_key_value_area_is_walked_in_docling_order():
    raw = _synthetic(
        [
            ("text", "Lot", (50, 700, 100, 720), "#/groups/0"),
            ("text", "1234", (120, 700, 200, 720), "#/groups/0"),
        ],
        groups=[_group(0, "key_value_area", ["#/texts/0", "#/texts/1"])],
        body=["#/groups/0"],
    )
    doc = convert_docling(raw)
    assert _texts_of(doc) == ["Lot", "1234"]


def test_checkbox_labels_become_marked_paragraphs():
    raw = _synthetic(
        [
            ("checkbox_selected", "· Accept as is", (50, 700, 300, 720), "#/body"),
            ("checkbox_unselected", "☐ Reject", (50, 670, 300, 690), "#/body"),
            ("checkbox_selected", "Hold", (50, 640, 300, 660), "#/body"),
        ],
        body=["#/texts/0", "#/texts/1", "#/texts/2"],
    )
    doc = convert_docling(raw)
    assert _texts_of(doc) == ["[x] Accept as is", "[ ] Reject", "[x] Hold"]


def test_picture_that_is_a_text_region_emits_its_text_after_the_figure():
    raw = _synthetic(
        [
            ("text", "Date 05 MAR", (110, 705, 290, 735), "#/pictures/0"),
            ("text", "Lot code 7788", (110, 665, 290, 695), "#/pictures/0"),
        ],
        pictures=[_picture(0, ["#/texts/0", "#/texts/1"], (100, 650, 300, 750))],
        body=["#/pictures/0"],
    )
    doc = convert_docling(raw)
    assert _texts_of(doc) == ["figure", "Date 05 MAR", "Lot code 7788"]
    assert doc["stats"]["pictureText"] == 0


def test_chart_tick_labels_stay_on_the_figure_but_caption_is_kept():
    ticks = [
        ("text", str(v), (60 + 90 * i, 410, 80 + 90 * i, 420), "#/pictures/0") for i, v in enumerate([0, 20, 40, 60, 80])
    ]
    raw = _synthetic(
        ticks + [("caption", "Figure 3: Accuracy by size.", (60, 380, 500, 395), "#/pictures/0")],
        pictures=[_picture(0, [f"#/texts/{i}" for i in range(6)], (50, 400, 550, 750))],
        body=["#/pictures/0"],
    )
    doc = convert_docling(raw)
    assert _texts_of(doc) == ["figure", "Figure 3: Accuracy by size."]
    figure = next(b for b in doc["blocks"].values() if b["type"] == "figure")
    caption = next(b for b in doc["blocks"].values() if b["type"] == "caption")
    assert figure["caption"] == caption["id"]
    assert doc["stats"]["pictureText"] == len("0204060" "80")
    assert doc["stats"]["conserved"] == 0


def test_classified_chart_keeps_dense_text_on_the_figure():
    raw = _synthetic(
        [("text", "Dense label that fills the box", (110, 655, 290, 745), "#/pictures/0")],
        pictures=[_picture(0, ["#/texts/0"], (100, 650, 300, 750))],
        body=["#/pictures/0"],
    )
    raw["pictures"][0]["annotations"] = [{"kind": "classification", "predicted_classes": [{"class_name": "bar_chart", "confidence": 0.9}]}]
    doc = convert_docling(raw)
    assert _texts_of(doc) == ["figure"]


def _dense_picture():
    """One text box covering most of the picture. Coverage alone would emit it."""
    raw = _synthetic(
        [
            ("text", "0", (60, 410, 160, 540), "#/pictures/0"),
            ("text", "20", (170, 410, 270, 540), "#/pictures/0"),
            ("text", "40", (280, 410, 380, 540), "#/pictures/0"),
            ("text", "60", (390, 410, 490, 540), "#/pictures/0"),
            ("caption", "Figure 3: Accuracy by size.", (60, 380, 500, 395), "#/pictures/0"),
        ],
        pictures=[_picture(0, [f"#/texts/{i}" for i in range(5)], (50, 400, 550, 750))],
        body=["#/pictures/0"],
    )
    return raw


def test_meta_classification_keeps_chart_tick_labels_on_the_figure():
    raw = _dense_picture()
    plain = convert_docling(raw)
    assert "0" in _texts_of(plain) and "60" in _texts_of(plain)
    raw["pictures"][0]["meta"] = {
        "classification": {
            "predictions": [
                {"class_name": "bar_chart", "confidence": 0.93, "created_by": "DocumentPictureClassifier"},
                {"class_name": "other", "confidence": 0.04, "created_by": "DocumentPictureClassifier"},
            ]
        }
    }
    doc = convert_docling(raw)
    assert _texts_of(doc) == ["figure", "Figure 3: Accuracy by size."]
    assert doc["stats"]["pictureText"] == len("0204060")
    assert doc["stats"]["conserved"] == 0


def test_text_region_class_emits_its_text():
    raw = _dense_picture()
    raw["pictures"][0]["meta"] = {
        "classification": {
            "predictions": [
                {"class_name": "other", "confidence": 0.81, "created_by": "DocumentPictureClassifier"},
                {"class_name": "bar_chart", "confidence": 0.1, "created_by": "DocumentPictureClassifier"},
            ]
        }
    }
    doc = convert_docling(raw)
    assert _texts_of(doc) == ["figure", "Figure 3: Accuracy by size.", "0", "20", "40", "60"]
    assert doc["stats"]["pictureText"] == 0


def test_unclassified_picture_uses_the_coverage_fallback():
    raw = _dense_picture()
    assert "annotations" not in raw["pictures"][0]
    assert "meta" not in raw["pictures"][0]
    doc = convert_docling(raw)
    assert _texts_of(doc) == ["figure", "Figure 3: Accuracy by size.", "0", "20", "40", "60"]
    sparse = _synthetic(
        [("text", "0", (60, 410, 80, 420), "#/pictures/0")],
        pictures=[_picture(0, ["#/texts/0"], (50, 400, 550, 750))],
        body=["#/pictures/0"],
    )
    kept = convert_docling(sparse)
    assert _texts_of(kept) == ["figure"]
    assert kept["stats"]["pictureText"] == 1


def test_conservation_emits_unreached_text_at_its_reading_position_once():
    raw = _synthetic(
        [
            ("text", "Top line", (50, 750, 300, 770), "#/body"),
            ("text", "Bottom line", (50, 100, 300, 120), "#/body"),
            ("text", "Orphan between", (50, 400, 300, 420), "#/body"),
            ("page_footer", "Page 1 of 1", (50, 10, 300, 20), "#/body"),
        ],
        body=["#/texts/0", "#/texts/1"],
    )
    doc = convert_docling(raw)
    assert _texts_of(doc) == ["Top line", "Orphan between", "Bottom line"]
    assert doc["stats"]["conserved"] == len("Orphan between")
    assert doc["stats"]["conservedBlocks"] == 1
    assert [r["text"] for r in doc["removed"]] == ["Page 1 of 1"]


def test_ordinary_document_conserves_nothing():
    docling = json.loads((FIXTURES / "report.json").read_text(encoding="utf-8"))
    doc = convert_docling(docling)
    assert doc["stats"]["conserved"] == 0
