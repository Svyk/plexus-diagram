"""Refine joins, scripts, heading levels, and the born-digital report gate."""

import json
import sys
from pathlib import Path

from plexus_parse_helper.convert import convert_docling
from plexus_parse_helper.refine import assemble_text, heading_level, join_lines, refine_document, repair_text

sys.path.insert(0, str(Path(__file__).parent))
from score import score_document

FIXTURES = Path(__file__).parent / "fixtures"
PDF = Path(__file__).resolve().parents[3] / "test" / "fixtures" / "pdf" / "report.pdf"
SCAN = Path(__file__).resolve().parents[3] / "test" / "fixtures" / "pdf" / "report-scan.pdf"
TRUTH = Path(__file__).resolve().parents[3] / "test" / "fixtures" / "pdf" / "report.truth.json"


def _ch(ch, x, baseline, h, width=None):
    width = h * 0.5 if width is None else width
    return {"ch": ch, "x": x, "right": x + width, "baseline": baseline, "h": h}


def test_repair_and_line_joins():
    assert repair_text("m(CFU/g)") == "m (CFU/g)"
    assert repair_text("Z1- 014") == "Z1-014"
    assert join_lines(["environ-", "mental"]) == "environmental"
    assert join_lines(["Z1-", "014"]) == "Z1-014"
    assert join_lines(["dry-", "Blend"]) == "dry-Blend"
    assert join_lines(["alpha", "beta"]) == "alpha beta"


def test_superscript_unit_and_footnote_and_subscript():
    unit = [_ch(c, i * 6, 100, 10) for i, c in enumerate("cm")]
    unit.append(_ch("2", 12, 104, 6, width=4))
    got = assemble_text(unit)
    assert got["text"] == "cm²"
    assert got["footnoteRefs"] == []

    name = [_ch(c, i * 6, 100, 10) for i, c in enumerate("Boyd")]
    name.append(_ch("1", 26, 104, 6, width=4))
    noted = assemble_text(name)
    assert noted["text"].endswith("¹")
    assert noted["footnoteRefs"] and noted["footnoteRefs"][0]["mark"] == "1"

    sub = [_ch("w", 0, 100, 10), _ch("z", 6, 96, 7, width=4)]
    assert assemble_text(sub)["text"] == "w_z"

    digits = [_ch("w", 0, 100, 10), _ch("2", 6, 96, 6, width=4)]
    assert assemble_text(digits)["text"] == "w₂"


def test_heading_level_uses_title_font():
    assert heading_level("Environmental Monitoring", 18, title_size=18) == 1
    assert heading_level("1 Introduction", 12, title_size=18) == 2
    assert heading_level("2.1 Sampling", 12, title_size=18) == 3
    assert heading_level("2.1.1 Sites", 11, title_size=18) == 4
    assert heading_level("Appendix A. Site register (excerpt)", 12, title_size=18) == 2


def test_born_digital_report_hits_cell_target():
    docling = json.loads((FIXTURES / "report.json").read_text(encoding="utf-8"))
    truth = json.loads(TRUTH.read_text(encoding="utf-8"))
    doc = refine_document(convert_docling(docling, created_at="2026-01-01T00:00:00Z"), PDF, ocr=False)
    scored = score_document(doc, truth)
    assert scored["structureF1"] == 1.0, scored
    assert scored["cellF1"] >= 0.98, scored
    assert scored["headingAccuracy"] == 1.0, scored
    assert scored["furnitureRemoved"] is True


def test_scan_report_hits_structure_target():
    docling = json.loads((FIXTURES / "report-scan.json").read_text(encoding="utf-8"))
    truth = json.loads(TRUTH.read_text(encoding="utf-8"))
    doc = refine_document(convert_docling(docling, created_at="2026-01-01T00:00:00Z"), SCAN, ocr=True)
    scored = score_document(doc, truth)
    assert scored["structureF1"] >= 0.95, scored
    assert scored["cellF1"] >= 0.9, scored
