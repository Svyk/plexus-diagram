"""High-accuracy page read: PP-DocLayoutV2 boxes, then a reader on each one.

Table regions are the layout model's table boxes plus caller boxes it missed.
Where both found the same grid, the layout rectangle is the crop. A page the
layout model does not mark as a table, and that has aligned numeric columns,
is read as a whole page. Tables stay on PaddleOCR-VL.
Text is optional. A page asked for text is transcribed once by the page-text
model and poured into the text regions. Table and figure boxes are painted
paper colour first, so the transcription holds the prose only. A caption strip under a plate stays
a crop, read with PaddleOCR-VL, so a one-line credit is not replaced by the
whole page. Figure boxes are hints only; the caller keeps its own figures
when it has any. Decoding is greedy with a fixed seed.
"""

from __future__ import annotations

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageStat

from plexus_parse_helper.table_text import plain_lines, tables_from_text
from plexus_parse_helper.vlm_boxes import choose_table_boxes, drop_layout_inside_figures, merge_stacked
from plexus_parse_helper.vlm_layout import (
    FIGURE_LABELS,
    LAYOUT_MODEL,
    TEXT_LABELS,
    detect_layout,
)
from plexus_parse_helper.vlm_tables import (
    DECODE_SEED,
    DECODE_TEMPERATURE,
    MAX_REGIONS,
    MODEL_LABEL,
    OCR_PROMPT,
    SCALE,
    TABLE_PROMPT,
    TEXT_TOKENS,
    _crop,
    _generate,
)
from plexus_parse_helper.vlm_text import label as text_label
from plexus_parse_helper.vlm_text import read_page_text

MAX_PAGES = 40
MAX_TEXT = 24


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


def _append_ocr(lines_out, page, page_no, items, bitmap):
    """PaddleOCR-VL on each crop. Used for caption strips and as a fallback."""
    for item in items:
        if len(lines_out) >= MAX_TEXT:
            break
        if item["bbox"][3] - item["bbox"][1] < 8:
            continue
        top_pad = 0.0 if item.get("captionStrip") else None
        image = _crop(page, item["bbox"], bitmap) if top_pad is None else _crop(page, item["bbox"], bitmap, pad=2.0, top_pad=0.0)
        text = _clean_ocr(_generate(image, OCR_PROMPT, TEXT_TOKENS))
        if text:
            lines_out.append({"page": page_no, "bbox": item["bbox"], "text": text})


def caption_strips(detected, pw, ph):
    """The band a full-width plate left empty, when layout did not call it text.

    A caption under an engraving sits in that gap. Reading the plate as one
    image never returns the line.
    """
    if not pw or not ph:
        return []
    texts = [item["bbox"] for item in detected or [] if item.get("label") in TEXT_LABELS and item.get("bbox")]
    strips = []
    seen = []
    for item in detected or []:
        if item.get("label") not in FIGURE_LABELS or item.get("score", 0) < 0.5:
            continue
        box = item.get("bbox")
        if not box:
            continue
        if _area(box) < 0.55 * pw * ph or (box[2] - box[0]) < 0.7 * pw:
            continue
        gaps = []
        below = ph - box[3]
        if 8 <= below <= 0.2 * ph:
            gaps.append([0.0, float(box[3]), float(pw), float(ph)])
        above = box[1]
        if 8 <= above <= 0.2 * ph:
            gaps.append([0.0, 0.0, float(pw), float(box[1])])
        for gap in gaps:
            if any(_iou(gap, prev) > 0.5 for prev in seen):
                continue
            if any(_area(gap) and _inter(gap, text) / _area(gap) >= 0.5 for text in texts):
                continue
            seen.append(gap)
            strips.append({
                "page": item.get("page"),
                "label": "text",
                "score": 1.0,
                "bbox": [round(v, 2) for v in gap],
                "captionStrip": True,
            })
    return strips


def _inter(a, b):
    ix = min(a[2], b[2]) - max(a[0], b[0])
    iy = min(a[3], b[3]) - max(a[1], b[1])
    if ix <= 0 or iy <= 0:
        return 0.0
    return ix * iy


def text_plan(detected, pw, ph):
    """Which text boxes are one page transcription, and which stay crops.

    A caption strip stays a crop. Body text, or a page with no text box, is
    one transcription. A plate whose only text is the strip is crops only.
    """
    text_items = [item for item in detected or [] if item.get("label") in TEXT_LABELS]
    text_items.extend(caption_strips(detected, pw, ph))
    body = [item for item in text_items if not item.get("captionStrip")]
    strips = [item for item in text_items if item.get("captionStrip")]
    return {"body": body, "strips": strips, "pageRead": bool(body) or not text_items}


def text_mask_boxes(chosen, detected, body):
    """Table and figure boxes to paint over before the page transcription.

    The page model is asked for the text of the page; a table's cells and a
    figure's labels are read by their own passes and must not be poured into
    prose. A page with no body text box reads whole: layout may have called a
    handwritten page an image. A box that covers half of a body text box
    contradicts the text box and is left on the paper. The whole-page table
    fallback is the read for a missed grid, not a mask.
    """
    if not body:
        return []
    texts = [item["bbox"] for item in body if item.get("bbox")]
    out = []
    for item in chosen or []:
        if item.get("source") == "page" or not item.get("bbox"):
            continue
        out.append(item["bbox"])
    for item in detected or []:
        if item.get("label") not in FIGURE_LABELS or item.get("score", 0) < 0.5 or not item.get("bbox"):
            continue
        out.append(item["bbox"])
    kept = []
    for box in out:
        if any(_area(text) and _inter(box, text) / _area(text) >= 0.5 for text in texts):
            continue
        kept.append(box)
    return kept


def paper_colour(image):
    """Per-channel median of a thumbnail: the paper, on a page that is mostly paper."""
    small = image.convert("RGB").resize((32, 32), Image.Resampling.BOX)
    return tuple(int(v) for v in ImageStat.Stat(small).median[:3])


def mask_boxes(bitmap, boxes, scale, pad=2):
    """A copy of the page bitmap with `boxes` (top-left points) filled with paper colour."""
    out = bitmap.copy()
    draw = ImageDraw.Draw(out)
    colour = paper_colour(bitmap)
    w, h = out.size
    for box in boxes:
        x0 = max(0, int(box[0] * scale) - pad)
        y0 = max(0, int(box[1] * scale) - pad)
        x1 = min(w, int(box[2] * scale) + pad)
        y1 = min(h, int(box[3] * scale) + pad)
        if x1 <= x0 or y1 <= y0:
            continue
        draw.rectangle([x0, y0, x1 - 1, y1 - 1], fill=colour)
    return out


def union_box(boxes):
    return [
        round(min(box[0] for box in boxes), 2),
        round(min(box[1] for box in boxes), 2),
        round(max(box[2] for box in boxes), 2),
        round(max(box[3] for box in boxes), 2),
    ]


def covered_by_table(box, chosen, min_iou=0.45) -> bool:
    """True when a figure sits on a real table crop.

    A whole-page fallback covers every figure on the page. It is the table
    read for a missed grid, not a reason to drop the figure.
    """
    for item in chosen or []:
        if item.get("source") == "page":
            continue
        bbox = item.get("bbox")
        if bbox and _iou(box, bbox) > min_iou:
            return True
    return False


def _box_mode(options) -> str:
    mode = options.get("boxMode") or "union"
    if mode not in {"union", "caller", "layout"}:
        raise ValueError("boxMode must be union, caller, or layout")
    return mode


def _page_numeric(options, page_no) -> bool:
    from plexus_parse_helper.vlm_boxes import aligned_numeric_columns

    flagged = options.get("numericPages") or []
    if not isinstance(flagged, list):
        raise ValueError("numericPages must be a list")
    for page in flagged:
        if int(page) == page_no:
            return True
    words = options.get("words") or []
    if not isinstance(words, list):
        raise ValueError("words must be a list")
    page_words = [word for word in words if isinstance(word, dict) and int(word.get("page") or 0) == page_no]
    if not page_words:
        return False
    return aligned_numeric_columns(page_words)


def read_pages(pdf_path: str, options: dict | None = None) -> dict:
    """`options` is `{pages, tables, text, numericPages, words, boxMode}`.

    `tables` are caller boxes, top-left points. `numericPages` are pages whose
    words form aligned numeric columns. `boxMode` is `union` unless a caller
    asks for `caller` or `layout`.
    """
    options = options or {}
    pages = [int(p) for p in (options.get("pages") or [])]
    regions = options.get("tables") or []
    if not isinstance(regions, list):
        raise ValueError("tables must be a list")
    mode = _box_mode(options)
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
    boxes_out = []
    text_model = None
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
            chosen = choose_table_boxes(
                detected,
                fallback,
                page_size=(pw, ph),
                numeric=_page_numeric(options, page_no),
                box_mode=mode,
            )
            figure_hints = [item for item in detected if item["label"] in FIGURE_LABELS]
            chosen = drop_layout_inside_figures(chosen, figure_hints)
            for box in chosen:
                boxes_out.append({
                    "page": page_no,
                    "bbox": box["bbox"],
                    "source": box.get("source") or "union",
                })
            for box in chosen:
                # Pad at crop time only. The bbox stored on the table stays the grid,
                # so a later comparison still lines up with the rule table.
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
                if covered_by_table(item["bbox"], chosen):
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
                plan = text_plan(detected, pw, ph)
                body = plan["body"]
                strips = plan["strips"]
                masks = text_mask_boxes(chosen, detected, body) if plan["pageRead"] else []
                page_image = mask_boxes(bitmap, masks, scale) if masks else bitmap
                page_text = read_page_text(page_image) if plan["pageRead"] else ""
                if page_text:
                    text_model = text_label()
                    boxes = [item["bbox"] for item in body] or [[0.0, 0.0, float(pw), float(ph)]]
                    lines_out.append({
                        "page": page_no,
                        "bbox": union_box(boxes),
                        "text": page_text,
                        "pageText": True,
                    })
                else:
                    _append_ocr(lines_out, page, page_no, body, bitmap)
                _append_ocr(lines_out, page, page_no, strips, bitmap)
    finally:
        pdf.close()
    return {
        "model": MODEL_LABEL,
        "textModel": text_model,
        "layoutModel": LAYOUT_MODEL,
        "tables": tables_out,
        "lines": lines_out,
        "figures": figures_out,
        "layout": layout_out,
        "boxes": boxes_out,
        "decode": {"temperature": DECODE_TEMPERATURE, "seed": DECODE_SEED, "greedy": True},
    }
