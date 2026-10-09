"""Scanned pages: Apple Vision word boxes plus OpenCV ruling lines, as pdf.js-like page records.

Coordinates in the output are PDF points with the origin at the top-left of the rendered page
(after deskew). Each item is one OCR word:

    {"str": "0.05", "transform": [size, 0, 0, size, x, baselineY], "width": w, "height": size,
     "fontName": "ocr", "conf": 0.5..1}

`transform[4]` is the left edge, `transform[5]` the baseline, both top-left points, so the page
record carries `transform: [1, 0, 0, 1, 0, 0]` and the engine maps the items without a flip.
Rules are `{x0, y0, x1, y1}` segments in the same frame. Vision caps the number of observations
it returns for one image (about 250), so the page is read in overlapping tiles that split again
when a tile comes back full.
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field

DPI = 300
TILE_COLS = 3
TILE_ROWS = 2
TILE_OVERLAP_PX = 160
TILE_EDGE_PX = 10        # a word this close to an inner tile edge is the neighbour tile's
TILE_FULL = 180          # observations per tile that mean "Vision ran out", so split the tile
TILE_MAX_DEPTH = 2
MAX_PAGES = 50
CELL_SCALE = 3
CELL_PAD_PT = 1.5

_DESCENDER_RE = re.compile(r"[gjpqy,;()\[\]{}|/_@]")
_TALL_RE = re.compile(r"[A-Z0-9bdfhklt'\"!?$%&*#/\\|\[\]{}()]")


@dataclass
class Observation:
    """One Vision text observation: normalized box (x, y, w, h, origin bottom-left) and words."""

    text: str
    conf: float
    box: tuple[float, float, float, float]
    words: list[tuple[str, tuple[float, float, float, float]]] = field(default_factory=list)


# ---------------------------------------------------------------- rendering


def render_page(pdf_path: str, page_no: int, dpi: int = DPI):
    """Gray PIL image of page `page_no` (1-based) and its size in points."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(pdf_path)
    try:
        page = pdf[page_no - 1]
        bitmap = page.render(scale=dpi / 72, grayscale=True)
        img = bitmap.to_pil().convert("L")
    finally:
        pdf.close()
    w_pt = img.width * 72 / dpi
    h_pt = img.height * 72 / dpi
    return img, w_pt, h_pt


def page_count(pdf_path: str) -> int:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(pdf_path)
    try:
        return len(pdf)
    finally:
        pdf.close()


# ---------------------------------------------------------------- deskew


def _ink(gray):
    """Binary image with ink as 255 (Otsu on the inverted page)."""
    import cv2

    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    return binary


def deskew_angle(gray) -> float:
    """Dominant text-line angle in degrees (positive = counter-clockwise), from long horizontal
    ink runs: ruling lines when the page has them, else text lines closed into bars."""
    import cv2
    import numpy as np

    ink = _ink(gray)
    h, w = ink.shape
    angles: list[tuple[float, float]] = []
    for kernel_w, min_w in ((max(40, w // 30), w // 8), (max(15, w // 120), w // 20)):
        if kernel_w == max(15, w // 120):
            bars = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_w, 1)))
        else:
            bars = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_w, 1)))
        contours, _ = cv2.findContours(bars, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, cw, ch = cv2.boundingRect(contour)
            if cw < min_w or ch > max(40, h // 25):
                continue
            vx, vy, _, _ = cv2.fitLine(contour, cv2.DIST_L2, 0, 0.01, 0.01).ravel()
            angle = math.degrees(math.atan2(float(vy), float(vx)))
            if angle > 90:
                angle -= 180
            if angle < -90:
                angle += 180
            if abs(angle) <= 6:
                angles.append((angle, float(cw)))
        if len(angles) >= 3:
            break
    if not angles:
        return 0.0
    angles.sort()
    weights = np.array([a[1] for a in angles])
    values = np.array([a[0] for a in angles])
    half = weights.sum() / 2
    median = float(values[np.searchsorted(np.cumsum(weights), half)])
    return 0.0 if abs(median) < 0.05 else round(-median, 3)


def deskew(img, angle: float):
    """Rotate a PIL image by `angle` degrees about its centre (white fill, same size)."""
    if abs(angle) < 0.05:
        return img
    import cv2
    import numpy as np

    arr = np.asarray(img)
    h, w = arr.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), -angle, 1.0)
    rotated = cv2.warpAffine(arr, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=255)
    from PIL import Image

    return Image.fromarray(rotated)


# ---------------------------------------------------------------- rules


def rules_from_image(gray, scale: float, min_len_pt: float = 18.0) -> list[dict]:
    """Horizontal and vertical ruling segments in points via morphological opening."""
    import cv2

    ink = _ink(gray)
    h, w = ink.shape
    out: list[dict] = []
    min_len = max(8, int(min_len_pt * scale))
    for axis, kernel in (("h", (max(20, w // 60), 1)), ("v", (1, max(20, h // 60)))):
        opened = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, kernel))
        # Bridge the small breaks a scan leaves in a rule.
        bridge = (kernel[0] // 2 or 1, kernel[1] // 2 or 1)
        opened = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, bridge))
        count, _, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
        for i in range(1, count):
            x, y, cw, ch, _area = stats[i]
            length = cw if axis == "h" else ch
            thick = ch if axis == "h" else cw
            if length < min_len or thick > max(6, 4 * scale):
                continue
            if axis == "h":
                out.append({"x0": round(float(x) / scale, 2), "y0": round(float(y + ch / 2) / scale, 2), "x1": round(float(x + cw) / scale, 2), "y1": round(float(y + ch / 2) / scale, 2), "thick": round(float(ch) / scale, 2)})
            else:
                out.append({"x0": round(float(x + cw / 2) / scale, 2), "y0": round(float(y) / scale, 2), "x1": round(float(x + cw / 2) / scale, 2), "y1": round(float(y + ch) / scale, 2), "thick": round(float(cw) / scale, 2)})
    out.sort(key=lambda r: (r["y0"], r["x0"]))
    return out


# ---------------------------------------------------------------- Vision


def _png_bytes(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def vision_observations(img, *, language_correction: bool = False) -> list[Observation]:
    """Run VNRecognizeTextRequest (accurate) on one PIL image. Word boxes come from
    `boundingBoxForRange` on the top candidate; a word that has no box is apportioned by
    character offsets inside the observation box."""
    import Vision
    import objc
    from Foundation import NSData, NSRange

    data = _png_bytes(img)
    out: list[Observation] = []
    with objc.autorelease_pool():
        req = Vision.VNRecognizeTextRequest.alloc().init()
        req.setRecognitionLevel_(0)
        req.setUsesLanguageCorrection_(bool(language_correction))
        req.setMinimumTextHeight_(0.0)
        handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(NSData.dataWithBytes_length_(data, len(data)), None)
        handler.performRequests_error_([req], None)
        for obs in req.results() or []:
            candidates = obs.topCandidates_(1)
            if not candidates:
                continue
            cand = candidates[0]
            text = str(cand.string())
            box = obs.boundingBox()
            obox = (float(box.origin.x), float(box.origin.y), float(box.size.width), float(box.size.height))
            words: list[tuple[str, tuple[float, float, float, float]]] = []
            pos = 0
            for word in text.split():
                start = text.index(word, pos)
                pos = start + len(word)
                got = cand.boundingBoxForRange_error_(NSRange(start, len(word)), None)
                rect = got[0] if isinstance(got, tuple) else got
                if rect is None:
                    words.append((word, _apportion(obox, text, start, len(word))))
                    continue
                bb = rect.boundingBox()
                words.append((word, (float(bb.origin.x), float(bb.origin.y), float(bb.size.width), float(bb.size.height))))
            out.append(Observation(text=text, conf=float(cand.confidence()), box=obox, words=words))
    return out


def _apportion(box, text, start, length):
    n = max(1, len(text))
    x, y, w, h = box
    return (x + w * start / n, y, w * length / n, h)


# ---------------------------------------------------------------- tiles


def tile_grid(width: int, height: int, cols: int = TILE_COLS, rows: int = TILE_ROWS, overlap: int = TILE_OVERLAP_PX) -> list[tuple[int, int, int, int]]:
    tiles = []
    for r in range(rows):
        for c in range(cols):
            x0 = max(0, int(c * width / cols) - overlap)
            x1 = min(width, int((c + 1) * width / cols) + overlap)
            y0 = max(0, int(r * height / rows) - overlap)
            y1 = min(height, int((r + 1) * height / rows) + overlap)
            tiles.append((x0, y0, x1, y1))
    return tiles


def ocr_tiles(img, recognize=vision_observations, *, depth: int = 0, tiles=None) -> list[tuple[tuple[int, int, int, int], list[Observation]]]:
    """Recognize every tile; a full tile is split 2x2 and read again (up to TILE_MAX_DEPTH)."""
    tiles = tiles if tiles is not None else tile_grid(img.width, img.height)
    out = []
    for tile in tiles:
        x0, y0, x1, y1 = tile
        obs = recognize(img.crop(tile))
        if len(obs) >= TILE_FULL and depth < TILE_MAX_DEPTH and (x1 - x0) > 200 and (y1 - y0) > 200:
            sub = tile_grid(x1 - x0, y1 - y0, 2, 2, TILE_OVERLAP_PX)
            shifted = [(x0 + a, y0 + b, x0 + c, y0 + d) for a, b, c, d in sub]
            out.extend(ocr_tiles(img, recognize, depth=depth + 1, tiles=shifted))
            continue
        out.append((tile, obs))
    return out


# ---------------------------------------------------------------- conversion (pure)


def _line_metrics(text: str, y0: float, y1: float) -> tuple[float, float]:
    """Font size and baseline (top-left y) for a Vision box of height y1 - y0. Vision boxes
    are padded: a line of capitals or digits without descenders measures about 0.95 em,
    with descenders about 1.15 em, lowercase without ascenders about 0.75 em."""
    height = max(0.5, y1 - y0)
    descender = bool(_DESCENDER_RE.search(text))
    tall = bool(_TALL_RE.search(text))
    if descender and tall:
        size = height / 1.15
        base = y1 - 0.22 * size
    elif descender:
        size = height / 0.95
        base = y1 - 0.22 * size
    elif tall:
        size = height / 0.95
        base = y1 - 0.03 * size
    else:
        size = height / 0.75
        base = y1 - 0.03 * size
    return size, base


def refine_by_ink(cands: list[dict], image, scale: float, *, pad_px: int = 2) -> None:
    """Baseline from the ink inside each word box. Rows of the crop with at least a
    quarter of the densest row's ink form runs; the run nearest the box centre is the word's
    body (descenders are thinner and fall out), its bottom the baseline. Vision's boxes are
    padded unevenly and can reach into the next row; the ink does not."""
    import numpy as np

    arr = np.asarray(image)
    h, w = arr.shape[:2]
    for c in cands:
        x0 = max(0, int(c["x0"] * scale) - pad_px)
        x1 = min(w, int(math.ceil(c["x1"] * scale)) + pad_px)
        y0 = max(0, int(c["y0"] * scale) - pad_px)
        y1 = min(h, int(math.ceil(c["y1"] * scale)) + pad_px)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        crop = arr[y0:y1, x0:x1]
        ink = (crop < 160).sum(axis=1)
        peak = int(ink.max()) if ink.size else 0
        if peak < 2:
            continue
        dense = ink >= max(2, 0.25 * peak)
        runs = []
        start = None
        for i, on in enumerate(dense):
            if on and start is None:
                start = i
            elif not on and start is not None:
                runs.append((start, i - 1))
                start = None
        if start is not None:
            runs.append((start, len(dense) - 1))
        runs = [r for r in runs if r[1] - r[0] >= 2]
        if not runs:
            continue
        centre = (y1 - y0) / 2
        top, bottom = min(runs, key=lambda r: abs((r[0] + r[1]) / 2 - centre))
        # Size stays Vision's (consistent across a page once snapped); the ink gives the baseline.
        c["base"] = (y0 + bottom + 1) / scale
        # Vision pads boxes sideways too; the ink columns of the body rows give the real gaps.
        cols = np.flatnonzero((crop[max(0, top - 2):bottom + 3] < 160).sum(axis=0) > 0)
        if cols.size >= 2:
            c["x0"] = (x0 + int(cols[0])) / scale
            c["x1"] = (x0 + int(cols[-1]) + 1) / scale


def snap_baselines(items: list[dict], tolerance: float = 0.3) -> list[dict]:
    """Words whose baselines sit within `tolerance` of the size of a row's first baseline take
    that baseline: Vision's observations jitter by a point across one table row."""
    ordered = sorted(items, key=lambda c: c["base"])
    anchor = None
    for c in ordered:
        if anchor is None or c["base"] - anchor > tolerance * c["size"]:
            anchor = c["base"]
        c["base"] = anchor
    return items


def observations_to_items(tiled, scale: float, image_size: tuple[int, int], image=None) -> list[dict]:
    """Tiled observations -> word items in top-left points. Duplicates from tile overlap keep the
    copy farthest from its tile edge. Word sizes within 0.7-1.4x of the page's median body size
    snap to that median: the engine reads a size step as a super/subscript or a heading."""
    width_px, height_px = image_size
    candidates: list[dict] = []
    for (tx0, ty0, tx1, ty1), observations in tiled:
        tw = tx1 - tx0
        th = ty1 - ty0
        for obs in observations:
            # Baselines come from clusters of the observation's word boxes: Vision's per-word
            # boxes jitter by a point inside one line (which would stack the rows of a tightly
            # set table), and an observation sometimes holds two short lines.
            boxes = []
            for word, (bx, by, bw, bh) in obs.words:
                px0 = tx0 + bx * tw
                px1 = tx0 + (bx + bw) * tw
                py0 = ty0 + (1 - by - bh) * th
                py1 = ty0 + (1 - by) * th
                size, base = _line_metrics(word, py0 / scale, py1 / scale)
                boxes.append({"word": word, "px0": px0, "px1": px1, "py0": py0, "py1": py1, "size": size, "base": base})
            for cluster in _baseline_clusters(boxes):
                base = sorted(b["base"] for b in cluster)[len(cluster) // 2]
                for b in cluster:
                    b["base"] = base
            for b in boxes:
                px0, px1, py0, py1, size, base, word = b["px0"], b["px1"], b["py0"], b["py1"], b["size"], b["base"], b["word"]
                margin = min(px0 - tx0, tx1 - px1, py0 - ty0, ty1 - py1)
                # A word near an inner tile edge may be cut: the neighbour tile reads it whole.
                if (tx0 > 0 and px0 - tx0 < TILE_EDGE_PX) or (tx1 < width_px and tx1 - px1 < TILE_EDGE_PX) or (ty0 > 0 and py0 - ty0 < TILE_EDGE_PX) or (ty1 < height_px and ty1 - py1 < TILE_EDGE_PX):
                    margin = -1
                candidates.append({
                    "str": word,
                    "x0": px0 / scale, "y0": py0 / scale, "x1": px1 / scale, "y1": py1 / scale,
                    "size": size, "base": base, "conf": obs.conf, "margin": margin,
                })
    candidates.sort(key=lambda c: -c["margin"])
    kept: list[dict] = []
    for cand in candidates:
        if cand["margin"] < 0:
            continue
        dup = False
        for other in kept:
            if _iou(cand, other) > 0.4:
                dup = True
                break
        if not dup:
            kept.append(cand)
    if image is not None:
        refine_by_ink(kept, image, scale)
    if kept:
        # The body size comes from words with capitals or digits and no descender: their box
        # height is the most reliable size estimate on a scan.
        plain = [c["size"] for c in kept if _TALL_RE.search(c["str"]) and not _DESCENDER_RE.search(c["str"])]
        sizes = sorted(plain or [c["size"] for c in kept])
        body = sizes[len(sizes) // 2]
        for c in kept:
            # A word with no ascender is sized as height/0.75. Vision's box is the line
            # box, not the x-height, so "is" / "as" land near 1.7× body and just past the
            # 1.5 snap. They are body text; a capital heading above 1.5× stays a heading.
            limit = 1.85 * body if not _TALL_RE.search(c["str"]) else 1.5 * body
            if 0.45 * body <= c["size"] <= limit + 1e-3:
                c["size"] = body
        # Specks Vision reads as text (a smudge "SAA" a quarter of the body size) are noise.
        kept = [c for c in kept if c["size"] >= 0.45 * body or c["conf"] >= 1.0 and _NUMBERISH_RE.match(c["str"])]
    snap_baselines(kept)
    kept.sort(key=lambda c: (round(c["base"], 1), c["x0"]))
    items = []
    for c in kept:
        size = round(c["size"], 2)
        items.append({
            "str": c["str"],
            "transform": [size, 0, 0, size, round(c["x0"], 2), round(c["base"], 2)],
            "width": round(c["x1"] - c["x0"], 2),
            "height": size,
            # Engine box: the same extents a born-digital word gets from its font size; rows
            # of a tightly set scan are told apart by baseline in the engine.
            "y0": round(c["base"] - 0.8 * size, 2),
            "y1": round(c["base"] + 0.22 * size, 2),
            "fontName": "ocr",
            "conf": round(c["conf"], 3),
        })
    return items


def _baseline_clusters(boxes: list[dict]) -> list[list[dict]]:
    """Group an observation's words by baseline: a gap above 0.45 of the size starts a line."""
    ordered = sorted(boxes, key=lambda b: b["base"])
    clusters: list[list[dict]] = []
    for b in ordered:
        if clusters and b["base"] - clusters[-1][-1]["base"] <= 0.45 * b["size"]:
            clusters[-1].append(b)
        else:
            clusters.append([b])
    return clusters


def _iou(a, b) -> float:
    ix = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
    iy = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"])
    if ix <= 0 or iy <= 0:
        return 0.0
    inter = ix * iy
    area = (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]) + (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]) - inter
    return inter / area if area > 0 else 0.0


_LETTERS_RE = re.compile(r"[A-Za-z]{2,}")
_NUMBERISH_RE = re.compile(r"^[\d.,()%+\-–—OoDQBSslIZG|]+$")


def merge_corrected(raw: list[dict], corrected: list[dict], *, min_iou: float = 0.7) -> list[dict]:
    """Second pass with language correction: a word with letters takes the corrected reading
    at the same place when the corrected pass was at least as confident. Numbers keep the raw
    reading (language correction turns 0.00 into words)."""
    out = []
    boxes = [(_item_box(c), c) for c in corrected]
    raw = _merge_split_words(raw, boxes)
    for item in raw:
        text = item["str"]
        if not _LETTERS_RE.search(text) or _NUMBERISH_RE.match(text):
            out.append(item)
            continue
        box = _item_box(item)
        best = None
        best_iou = min_iou
        for cbox, c in boxes:
            iou = _iou(box, cbox)
            if iou > best_iou:
                best_iou = iou
                best = c
        if best is not None and best["str"] != text and best["conf"] >= item["conf"] and _LETTERS_RE.search(best["str"]):
            merged = dict(item)
            merged["str"] = best["str"]
            merged["conf"] = best["conf"]
            merged["raw"] = text
            out.append(merged)
        else:
            out.append(item)
    return out


def _merge_split_words(raw: list[dict], boxes) -> list[dict]:
    """Two raw words that one corrected word covers, and that spell it when joined
    ("Anth" + "rax" = "Anthrax"), become that one word."""
    raw = sorted(raw, key=lambda i: (round(i["transform"][5], 1), i["transform"][4]))
    out = []
    i = 0
    while i < len(raw):
        a = raw[i]
        b = raw[i + 1] if i + 1 < len(raw) else None
        merged = None
        if b is not None and abs(a["transform"][5] - b["transform"][5]) <= 0.3 * a["transform"][0] and _LETTERS_RE.search(a["str"] + b["str"]):
            ab = _item_box(a)
            bb = _item_box(b)
            union = {"x0": min(ab["x0"], bb["x0"]), "x1": max(ab["x1"], bb["x1"]), "y0": min(ab["y0"], bb["y0"]), "y1": max(ab["y1"], bb["y1"])}
            for cbox, c in boxes:
                if _iou(union, cbox) >= 0.7 and c["str"].replace(" ", "") == (a["str"] + b["str"]):
                    merged = dict(a)
                    merged["str"] = c["str"]
                    merged["width"] = round(union["x1"] - union["x0"], 2)
                    merged["conf"] = min(a["conf"], b["conf"], c["conf"])
                    break
        if merged is not None:
            out.append(merged)
            i += 2
        else:
            out.append(a)
            i += 1
    return out


def _item_box(item: dict) -> dict:
    size, _a, _b, _c, x, base = item["transform"]
    return {"x0": x, "x1": x + item["width"], "y0": item.get("y0", base - 0.5 * size), "y1": item.get("y1", base + 0.05 * size)}


def page_record(n: int, items: list[dict], rules: list[dict], w: float, h: float, *, dpi: int = DPI, deskew_deg: float = 0.0) -> dict:
    return {
        "n": n,
        "w": round(w, 2),
        "h": round(h, 2),
        "rotation": 0,
        "transform": [1, 0, 0, 1, 0, 0],
        "scan": True,
        "dpi": dpi,
        "deskew": deskew_deg,
        "fonts": {"ocr": {"name": "ocr"}},
        "items": items,
        "rules": rules,
        "ops": {"fnArray": [], "argsArray": []},
    }


# ---------------------------------------------------------------- page and cell OCR


def ocr_page(pdf_path: str, n: int, *, dpi: int = DPI, recognize=vision_observations, correct_text: bool = True) -> dict:
    import numpy as np

    img, w_pt, h_pt = render_page(pdf_path, n, dpi)
    scale = dpi / 72
    angle = deskew_angle(np.asarray(img))
    img = deskew(img, angle)
    rules = rules_from_image(np.asarray(img), scale)
    tiled = ocr_tiles(img, recognize)
    items = observations_to_items(tiled, scale, (img.width, img.height), image=img)
    if correct_text and recognize is vision_observations:
        corrected = ocr_tiles(img, lambda im: vision_observations(im, language_correction=True))
        items = merge_corrected(items, observations_to_items(corrected, scale, (img.width, img.height), image=img))
    return page_record(n, items, rules, w_pt, h_pt, dpi=dpi, deskew_deg=angle)


def ocr_pdf(pdf_path: str, pages=None, *, dpi: int = DPI, recognize=vision_observations, on_page=None) -> dict:
    from plexus_parse_helper.jobs import expand_pages

    count = page_count(pdf_path)
    selected = expand_pages(pages, count)
    if len(selected) > MAX_PAGES:
        raise ValueError(f"ocr page cap is {MAX_PAGES}")
    out = []
    for n in selected:
        rec = ocr_page(pdf_path, n, dpi=dpi, recognize=recognize)
        out.append(rec)
        if on_page:
            on_page(n, len(selected))
    return {"schema": "pxd-ocr/1", "pageCount": count, "pages": out}


def ocr_cells(pdf_path: str, cells: list[dict], *, dpi: int = DPI, recognize=vision_observations) -> dict:
    """Re-read single cells: crop `bbox` (top-left points, deskewed frame) from the page render,
    upscale 3x, OCR alone. Returns {cells: [{page, bbox, text, conf}]} in the request order."""
    import numpy as np
    from PIL import Image

    pages: dict[int, object] = {}
    out = []
    scale = dpi / 72
    for cell in cells:
        n = int(cell["page"])
        if n not in pages:
            img, _w, _h = render_page(pdf_path, n, dpi)
            pages[n] = deskew(img, deskew_angle(np.asarray(img)))
        img = pages[n]
        x0, y0, x1, y1 = cell["bbox"]
        crop = img.crop((
            max(0, int((x0 - CELL_PAD_PT) * scale)), max(0, int((y0 - CELL_PAD_PT) * scale)),
            min(img.width, int(math.ceil((x1 + CELL_PAD_PT) * scale))), min(img.height, int(math.ceil((y1 + CELL_PAD_PT) * scale))),
        ))
        if crop.width < 2 or crop.height < 2:
            out.append({"page": n, "bbox": cell["bbox"], "text": "", "conf": 0})
            continue
        big = crop.resize((crop.width * CELL_SCALE, crop.height * CELL_SCALE), Image.BICUBIC)
        # Padding keeps Vision from treating a tight crop as a texture.
        canvas = Image.new("L", (big.width + 2 * 24, big.height + 2 * 24), 255)
        canvas.paste(big, (24, 24))
        observations = recognize(canvas)
        observations.sort(key=lambda o: (-o.box[1], o.box[0]))
        text = " ".join(o.text for o in observations).strip()
        conf = min((o.conf for o in observations), default=0.0)
        # The ink check runs on every cell: a dash or star is accepted from it, never from
        # Vision's reading of a mark (a leader-dot run reads as "-").
        tight = img.crop((
            max(0, int((x0 - 0.5) * scale)), max(0, int((y0 - 0.5) * scale)),
            min(img.width, int(math.ceil((x1 + 0.5) * scale))), min(img.height, int(math.ceil((y1 + 0.5) * scale))),
        ))
        glyph = ink_glyph(np.asarray(tight)) if tight.width >= 2 and tight.height >= 2 else None
        out.append({"page": n, "bbox": cell["bbox"], "text": text, "conf": round(conf, 3), "glyph": glyph})
    return {"cells": out}


def ink_glyph(gray) -> str | None:
    """A placeholder glyph Vision skips: one thin wide ink run is a dash, one small roundish
    blob is a star. Ruling lines along the crop edge and leader dots are ignored; anything
    else (nothing, or several marks) is None."""
    import cv2

    ink = _ink(gray)
    h, w = ink.shape
    count, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    marks = []
    for i in range(1, count):
        x, y, bw, bh, area = (int(v) for v in stats[i][:5])
        if bw >= 0.8 * w or bh >= 0.8 * h:
            continue  # a rule crossing the crop (two rules joined count once)
        if area < 16 or (bw <= 4 and bh <= 5):
            continue  # noise, leader dots
        if y + bh >= h - 1 and bh <= 0.3 * h:
            continue  # the tops of the next row's glyphs
        marks.append((x, y, bw, bh, area))
    if len(marks) != 1:
        return None
    _x, _y, bw, bh, area = marks[0]
    # A dash is a solid run; a stretch of leader dots that touch is not (low fill).
    if bw >= 3 * bh and bw >= 8 and bh <= 0.3 * h and area >= 0.6 * bw * bh:
        return "—"
    if 0.6 <= bw / max(1, bh) <= 1.6 and bw <= 0.5 * h and bh <= 0.5 * h and bw >= 5:
        return "*"
    return None


def ocr_options_hash(pages) -> str:
    """Cache key beside the Docling options hash: {"engine":"vision","op":"ocr"[,"pages"]}."""
    import hashlib
    import json

    body = {"engine": "vision", "op": "ocr"}
    if pages:
        body["pages"] = pages
    blob = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
