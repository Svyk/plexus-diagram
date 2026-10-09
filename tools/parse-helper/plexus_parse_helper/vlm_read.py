"""High-accuracy page read: PP-DocLayoutV2 boxes, then PaddleOCR-VL on each one.

Table boxes come from the layout model. A page it does not mark as a table
falls back to the boxes the caller already found (the built-in detector).
Text is optional: each text region is read with the "OCR:" prompt. Figure
boxes are hints only; the caller keeps its own figures when it has any.
"""

from __future__ import annotations

import pypdfium2 as pdfium

from plexus_parse_helper.table_text import plain_lines, tables_from_text
from plexus_parse_helper.vlm_layout import (
    FIGURE_LABELS,
    LAYOUT_MODEL,
    TABLE_LABELS,
    TEXT_LABELS,
    detect_layout,
)
from plexus_parse_helper.vlm_tables import (
    MAX_REGIONS,
    MODEL_LABEL,
    OCR_PROMPT,
    SCALE,
    TABLE_PROMPT,
    TEXT_TOKENS,
    _crop,
    _generate,
)

MAX_PAGES = 40
MAX_TEXT = 24
STACK_GAP = 22.0


def _area(box):
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _iou(a, b):
    ix = min(a[2], b[2]) - max(a[0], b[0])
    iy = min(a[3], b[3]) - max(a[1], b[1])
    if ix <= 0 or iy <= 0:
        return 0.0
    inter = ix * iy
    union = _area(a) + _area(b) - inter
    return inter / union if union else 0.0


def merge_stacked(boxes, gap=STACK_GAP):
    """Join table boxes that sit on top of each other with a small gap.

    A typewritten table often comes back as two grids. One crop reads it as
    one table. `boxes` are `{bbox, ...}` in top-left PDF points.
    """
    items = sorted((dict(b) for b in boxes if b.get("bbox")), key=lambda b: (b["bbox"][1], b["bbox"][0]))
    merged = []
    for box in items:
        if not merged:
            merged.append(box)
            continue
        prev = merged[-1]
        a, c = prev["bbox"], box["bbox"]
        overlap = min(a[2], c[2]) - max(a[0], c[0])
        width = min(a[2] - a[0], c[2] - c[0])
        gap_y = c[1] - a[3]
        if width > 0 and overlap / width >= 0.55 and -6 <= gap_y <= gap:
            prev["bbox"] = [min(a[0], c[0]), min(a[1], c[1]), max(a[2], c[2]), max(a[3], c[3])]
            prev["score"] = max(float(prev.get("score") or 0), float(box.get("score") or 0))
            continue
        merged.append(box)
    return merged


def choose_table_boxes(layout_boxes, fallback_boxes):
    """Layout tables when the page has any. Otherwise the caller's boxes."""
    tables = [b for b in layout_boxes if b.get("label") in TABLE_LABELS]
    chosen = merge_stacked(tables)
    if chosen:
        return chosen
    return merge_stacked(fallback_boxes)


def points_box(pixel_box, scale):
    return [pixel_box[0] / scale, pixel_box[1] / scale, pixel_box[2] / scale, pixel_box[3] / scale]


def _clip(box, pw, ph):
    x0, y0, x1, y1 = box
    return [
        max(0.0, min(pw, x0)),
        max(0.0, min(ph, y0)),
        max(0.0, min(pw, x1)),
        max(0.0, min(ph, y1)),
    ]


def _clean_ocr(raw):
    lines = plain_lines(raw)
    return " ".join(lines).strip()


def read_pages(pdf_path: str, options: dict | None = None) -> dict:
    """`options` is `{pages, tables, text}`. `tables` are caller boxes, top-left points."""
    options = options or {}
    pages = [int(p) for p in (options.get("pages") or [])]
    regions = options.get("tables") or []
    if not isinstance(regions, list):
        raise ValueError("tables must be a list")
    want_text = bool(options.get("text"))
    if not pages:
        pages = sorted({int(r.get("page") or 0) for r in regions if int(r.get("page") or 0) > 0})
    if len(pages) > MAX_PAGES:
        raise ValueError(f"pages cap is {MAX_PAGES}")
    if len(regions) > MAX_REGIONS:
        raise ValueError(f"tables cap is {MAX_REGIONS}")

    tables_out = []
    lines_out = []
    figures_out = []
    layout_out = []
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        n_pages = len(pdf)
        for page_no in pages:
            if page_no < 1 or page_no > n_pages:
                raise ValueError(f"page {page_no} is outside 1..{n_pages}")
            page = pdf[page_no - 1]
            pw, ph = page.get_size()
            bitmap = page.render(scale=SCALE).to_pil().convert("RGB")
            scale = bitmap.width / float(pw) if pw else SCALE
            detected = []
            for item in detect_layout(bitmap):
                box = _clip(points_box(item["bbox"], scale), pw, ph)
                if box[2] - box[0] < 4 or box[3] - box[1] < 4:
                    continue
                detected.append({
                    "page": page_no,
                    "label": item["label"],
                    "score": item["score"],
                    "bbox": [round(v, 2) for v in box],
                })
            layout_out.extend(detected)
            fallback = []
            for region in regions:
                if int(region.get("page") or 0) != page_no:
                    continue
                bbox = region.get("bbox")
                if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
                    raise ValueError("bbox must be [x0, y0, x1, y1]")
                fallback.append({"page": page_no, "label": "table", "score": 0, "bbox": [float(v) for v in bbox]})
            chosen = choose_table_boxes(detected, fallback)
            for box in chosen:
                image = _crop(page, box["bbox"], bitmap)
                parsed = tables_from_text(_generate(image, TABLE_PROMPT), "html")
                if not parsed:
                    continue
                table = parsed[0]
                tables_out.append({
                    "page": page_no,
                    "bbox": box["bbox"],
                    "rows": table["rows"],
                    "cols": table["cols"],
                    "cells": table["cells"],
                })
            for item in detected:
                if item["label"] not in FIGURE_LABELS or item["score"] < 0.5:
                    continue
                if any(_iou(item["bbox"], t["bbox"]) > 0.45 for t in chosen):
                    continue
                if _area(item["bbox"]) < 0.015 * pw * ph:
                    continue
                figures_out.append({
                    "page": page_no,
                    "bbox": item["bbox"],
                    "label": item["label"],
                    "score": item["score"],
                })
            if want_text:
                text_n = 0
                for item in detected:
                    if item["label"] not in TEXT_LABELS:
                        continue
                    if item["bbox"][3] - item["bbox"][1] < 8:
                        continue
                    if text_n >= MAX_TEXT:
                        break
                    text_n += 1
                    image = _crop(page, item["bbox"], bitmap)
                    text = _clean_ocr(_generate(image, OCR_PROMPT, TEXT_TOKENS))
                    if text:
                        lines_out.append({"page": page_no, "bbox": item["bbox"], "text": text})
    finally:
        pdf.close()
    return {
        "model": MODEL_LABEL,
        "layoutModel": LAYOUT_MODEL,
        "tables": tables_out,
        "lines": lines_out,
        "figures": figures_out,
        "layout": layout_out,
    }
