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
