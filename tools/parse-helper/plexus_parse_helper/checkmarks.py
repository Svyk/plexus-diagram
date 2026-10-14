"""Checkbox and circled-option state on scanned pages.

Docling reads a printed box and the tick in it as letters ("M", "Ef", "Z") and
loses hand-drawn circles around options such as Y / N or Pass / Fail. This pass
renders each scanned page, finds

  * printed square boxes the size of text, and calls one checked when its
    interior (inside the border) holds ink: a tick, an X or a fill;
  * hand-drawn rings that enclose exactly one short token of an option group
    on one OCR line ("Y / N", "Pass Fail", "ACC REJ");

and writes the state into the text it belongs to, in the GitHub task-list form:
`[x] Pass [ ] Fail`, `[x] YES / NO`. The marker goes before the option it marks,
because "[x] Pass" reads as "Pass is ticked" and a trailing marker would read as
belonging to the next option. OCR junk that sits on a box is removed; other text
is left as Docling read it.

Every size is relative to the page's median OCR line height `h` (Docling's own
line cells), so the same constants work at any scan resolution or font size.
Pages with a text layer are never touched.
"""

from __future__ import annotations

import re
import time

import numpy as np

DPI = 300

# Box side as a share of the median OCR line height.
BOX_MIN = 0.45
BOX_MAX = 1.6
# A box stands taller than lowercase letters: at least this many x-heights (printed boxes are
# about cap height, 1.25-1.45 x-heights; n, u, o and their serifs are about one).
XHEIGHT_MIN = 1.12
# Opening kernel for box edges, as a share of h (must stay below BOX_MIN).
EDGE_KERNEL = 0.35
# The top and bottom edges must share all but this share of the shorter one.
EDGE_ALIGN = 0.2
# Height over width of a box.
ASPECT_MIN = 0.7
ASPECT_MAX = 1.4
# Share of the rows between the edges that a left or right side may miss.
SIDE_MISS = 0.2
# Border thicker than this share of the side is a bold glyph, not a printed box.
BORDER_MAX = 0.2
# The sides must sit within this share of the side from the ends of the top and bottom edges.
SIDE_SNAP = 0.08
# Share of a side that its outermost ink line may miss (round glyphs miss their corners).
OUTLINE_MISS = 0.12
# Corner patch (share of the side) and the ink it must hold.
CORNER = 0.15
CORNER_INK = 0.35
# The outermost corner tip (share of the side) must hold this much ink.
CORNER_TIP = 0.08
CORNER_TIP_INK = 0.3
# A box side that runs on past both corners by this share of the side is a table rule.
RUN_ON = 0.35
# Interior ink share (inside the border) that makes a box checked.
CHECKED_INK = 0.06
# A solid square counts as a filled box when its ink share is at least this.
SOLID_FILL = 0.75
# A label token must start within this many h of the box.
LABEL_GAP = 1.6
# A box belongs to an OCR line it overlaps or sits within this many h of.
LINE_REACH = 1.0
# Alignment cost of OCR glyph tokens read on a box (negative: expected there).
GLYPH_REWARD = -0.6
# Cost per character of cutting a box glyph off the front of a word ("MA" = box + "A").
HEAD_COST = 1.0
# Cost of an ink word blob that no OCR token explains.
EMPTY_BLOB = 2.0
# Ink runs closer than this share of h belong to one word blob.
BLOB_GAP = 0.18
# Long-rule kernel for the ring test, in h. Table rules longer than this are ignored.
RULE_LEN = 2.2
# Ring height (and least width) and greatest width, in h.
RING_MIN = 0.9
RING_MAX = 3.0
RING_MAX_W = 6.0
# Share of directions round a ring that its outer pixels may leave open; its ink fills at most
# RING_DENSITY of its box.
RING_OPEN = 0.25
RING_DENSITY = 0.35
# Share of a ring's own pixels that may lie inside its rim (within 0.65 of its half-axes).
RING_INNER = 0.2
# Share of the longer OCR lines that must stand on end before the page counts as sideways.
TURN_SHARE = 0.6
# Option tokens are letters only and at most this long.
OPTION_MAX_CHARS = 12

CHECK = "[x] "
UNCHECK = "[ ] "
_MARKED = re.compile(r"\[\s*[xX ]?\s*\]")
_TOKEN = re.compile(r"[^\s/]+")


# ---- rendering ----

def render_gray(pdf_path, page_no: int, dpi: int = DPI) -> tuple[np.ndarray, float]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        page = pdf[page_no - 1]
        scale = dpi / 72.0
        image = page.render(scale=scale, grayscale=True).to_numpy()
    finally:
        pdf.close()
    if image.ndim == 3:
        image = image[..., 0]
    return np.ascontiguousarray(image, dtype=np.uint8), scale


def ink_mask(gray: np.ndarray) -> np.ndarray:
    import cv2

    _, ink = cv2.threshold(gray, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return ink.astype(np.uint8)


def x_height(ink: np.ndarray, lines: list[dict], scale: float) -> float | None:
    """The page's lowercase body height in pixels: the dense middle band of lines with lowercase text."""
    heights = []
    H, W = ink.shape
    for line in lines:
        if sum(ch.islower() for ch in line["text"]) < 5:
            continue
        x0, y0, x1, y1 = (int(round(v * scale)) for v in line["bbox"])
        band = ink[max(0, y0):min(H, y1), max(0, x0):min(W, x1)]
        if band.size == 0:
            continue
        prof = band.sum(axis=1)
        if prof.max() <= 0:
            continue
        body = np.flatnonzero(prof >= 0.5 * prof.max())
        heights.append(int(body.max() - body.min() + 1))
    return float(np.median(heights)) if len(heights) >= 3 else None


def line_height(lines: list[dict]) -> float | None:
    heights = [l["bbox"][3] - l["bbox"][1] for l in lines if len((l.get("text") or "").strip()) >= 2]
    heights = [v for v in heights if v > 0]
    if len(heights) < 3:
        return None
    return float(np.median(heights))


# ---- boxes ----

def _segments(mask: np.ndarray, horizontal: bool, lo: float, hi: float) -> list[tuple[int, int, int, int]]:
    import cv2

    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = []
    for i in range(1, n):
        x, y, w, h, _ = stats[i]
        length, thick = (w, h) if horizontal else (h, w)
        if lo <= length <= hi and thick <= max(2, 0.25 * length):
            out.append((int(x), int(y), int(x + w), int(y + h)))
    return out


def find_boxes(ink: np.ndarray, h_px: float) -> list[dict]:
    """Printed square boxes the size of text. Coordinates are pixels of `ink`."""
    import cv2

    lo, hi = BOX_MIN * h_px, BOX_MAX * h_px
    k = max(3, int(round(EDGE_KERNEL * h_px)))
    horiz = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, k), np.uint8))
    vert = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((k, 1), np.uint8))
    hsegs = sorted(_segments(horiz, True, lo, hi), key=lambda s: (s[1], s[0]))
    _, labels = cv2.connectedComponents(ink, connectivity=8)
    boxes: list[dict] = []
    H, W = ink.shape
    for i, top in enumerate(hsegs):
        for bottom in hsegs[i + 1:]:
            gap = bottom[1] - top[1]
            if gap > ASPECT_MAX * BOX_MAX * h_px + 2:
                break
            # A tick that leaves the box can lengthen one edge: use the span both edges share.
            x0, x1 = max(top[0], bottom[0]), min(top[2], bottom[2])
            side = x1 - x0
            if side < lo or side < (1 - EDGE_ALIGN) * min(top[2] - top[0], bottom[2] - bottom[0]):
                continue
            if not (ASPECT_MIN * side - 2 <= gap <= ASPECT_MAX * side + 2):
                continue
            y0, y1 = top[1], bottom[3]
            box = _verify_box(ink, vert, labels, x0, y0, x1, y1)
            if box is not None:
                boxes.append(box)
                break
    boxes.extend(_solid_squares(ink, h_px, boxes))
    return _dedupe(boxes)


def _max_runs(band: np.ndarray) -> np.ndarray:
    """Longest vertical run of ink in each column of a boolean band."""
    if band.size == 0:
        return np.zeros(band.shape[1] if band.ndim == 2 else 0, dtype=int)
    b = band.astype(np.int32)
    padded = np.vstack([np.zeros((1, b.shape[1]), np.int32), b, np.zeros((1, b.shape[1]), np.int32)])
    d = np.diff(padded, axis=0)
    best = np.zeros(b.shape[1], dtype=int)
    for col in range(b.shape[1]):
        starts = np.flatnonzero(d[:, col] == 1)
        ends = np.flatnonzero(d[:, col] == -1)
        if starts.size:
            best[col] = int((ends - starts).max())
    return best


def _side_column(vert, x: int, y0: int, y1: int, t: int, outer: str) -> int | None:
    """The outermost column near x holding one straight stroke from the top edge to the bottom edge."""
    W = vert.shape[1]
    lo, hi = max(0, x - t), min(W, x + t + 1)
    runs = _max_runs(vert[y0:y1, lo:hi])
    cols = np.flatnonzero(runs >= (1 - SIDE_MISS) * (y1 - y0))
    if cols.size == 0:
        return None
    return lo + int(cols.min() if outer == "left" else cols.max())


def _longest_run(line: np.ndarray, gap: int = 0) -> int:
    """Longest run of ink, bridging holes of up to `gap` pixels (scan dropouts)."""
    best = cur = hole = 0
    for v in line:
        if v:
            cur += hole + 1
            hole = 0
        elif cur and hole < gap:
            hole += 1
        else:
            cur = hole = 0
        best = max(best, cur)
    return best


def _straight_outline(ink, x0, y0, x1, y1, t: int) -> bool:
    """Each side's outermost ink line (two pixels wide, for a slight skew) runs nearly the whole side.
    A printed box passes; a round or bold glyph (O, D, 0) curves away from its outer line."""
    H, W = ink.shape
    hgt, wid = y1 - y0, x1 - x0
    sides = (
        (ink[y0:y1, max(0, x0 - t):min(W, x0 + t + 1)], hgt),
        (ink[y0:y1, max(0, x1 - 1 - t):min(W, x1 + t)][:, ::-1], hgt),
        (ink[max(0, y0 - t):min(H, y0 + t + 1), x0:x1].T, wid),
        (ink[max(0, y1 - 1 - t):min(H, y1 + t), x0:x1].T[:, ::-1], wid),
    )
    for band, length in sides:
        if band.size == 0:
            return False
        counts = band.sum(axis=0)
        cols = np.flatnonzero(counts >= 0.6 * length)
        if cols.size == 0:
            return False
        c = int(cols.min())
        outer = band[:, c:c + 2].any(axis=1)
        if _longest_run(outer, gap=max(1, int(round(0.06 * length)))) < (1 - OUTLINE_MISS) * length:
            return False
    return True


def _verify_box(ink, vert, labels, x0, y0, x1, y1) -> dict | None:
    H, W = ink.shape
    side = max(x1 - x0, y1 - y0)
    t = max(2, int(round(0.12 * side)))
    snap = max(2, int(round(SIDE_SNAP * side)))
    left = _side_column(vert, x0, y0, y1, t, "left")
    right = _side_column(vert, x1 - 1, y0, y1, t, "right")
    # The sides meet the ends of the top and bottom edges: round glyphs have sides outside their flat tops.
    if left is None or right is None or abs(left - x0) > snap or abs(right - (x1 - 1)) > snap:
        return None
    if not _straight_outline(ink, left, y0, right + 1, y1, t):
        return None
    border = _border_thickness(ink, x0, y0, x1, y1)
    walls = _wall_thickness(ink, left, right, y0, y1)
    if max(border, walls) > BORDER_MAX * side:
        return None
    # Sharp corners exactly where the sides meet the edges: round glyphs (o, O, 0, D) leave one empty.
    c = max(2, int(round(CORNER * side)))
    e = max(2, int(round(CORNER_TIP * side)))
    for cy, cx, ey, ex in ((y0, left, y0, left), (y0, right - c + 1, y0, right - e + 1),
                           (y1 - c, left, y1 - e, left), (y1 - c, right - c + 1, y1 - e, right - e + 1)):
        if ink[cy:cy + c, cx:cx + c].mean() < CORNER_INK or ink[ey:ey + e, ex:ex + e].mean() < CORNER_TIP_INK:
            return None
    # A closed ring: the four edges are one stroke.
    mid_x, mid_y = (x0 + x1) // 2, (y0 + y1) // 2
    probes = [labels[max(0, y0 - t):y0 + c, mid_x], labels[y1 - c:min(H, y1 + t), mid_x],
              labels[mid_y, max(0, x0 - t):x0 + c], labels[mid_y, x1 - c:min(W, x1 + t)]]
    ids = [set(p[p > 0].tolist()) for p in probes]
    if not all(ids) or not set.intersection(*ids):
        return None
    # A grid cell: its sides run on past both corners.
    run = max(2, int(round(RUN_ON * side)))
    for xs in (slice(max(0, x0 - t), x0 + t + 1), slice(max(0, x1 - t - 1), min(W, x1 + t))):
        above = vert[max(0, y0 - run):max(0, y0 - 2), xs].any(axis=1)
        below = vert[min(H, y1 + 2):min(H, y1 + run), xs].any(axis=1)
        if above.size and below.size and above.mean() > 0.8 and below.mean() > 0.8:
            return None
    m = border + max(1, int(round(0.08 * side)))
    inner = ink[y0 + m:y1 - m, x0 + m:x1 - m]
    if inner.size == 0:
        return None
    fill = float(inner.mean())
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "ink": round(fill, 4), "checked": fill >= CHECKED_INK, "solid": False}


def _wall_thickness(ink, left: int, right: int, y0: int, y1: int) -> int:
    """Ink columns of the left and right walls, measured across the middle half of the box."""
    H, W = ink.shape
    rows = ink[y0 + (y1 - y0) // 4:y1 - (y1 - y0) // 4]
    if rows.size == 0:
        return 0
    cols = rows.mean(axis=0) > 0.5
    out = 0
    for x, step in ((left, 1), (right, -1)):
        t = 0
        while 0 <= x < W and cols[x] and t < (right - left):
            t += 1
            x += step
        out = max(out, t)
    return out


def _border_thickness(ink, x0, y0, x1, y1) -> int:
    """Rows of ink at the top edge, measured down the middle half of the box."""
    cx0, cx1 = x0 + (x1 - x0) // 4, x1 - (x1 - x0) // 4
    t = 0
    for y in range(y0, min(y1, y0 + (y1 - y0) // 3)):
        if ink[y, cx0:cx1].mean() > 0.5:
            t += 1
        elif t:
            break
    return max(1, t)


def _solid_squares(ink, h_px: float, hollow: list[dict]) -> list[dict]:
    """A filled-in box. Only next to hollow boxes of the same size in the same row or column,
    so square bullets (which come without hollow neighbours) never count."""
    import cv2

    if len(hollow) < 2:
        return []
    n, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if not (BOX_MIN * h_px <= w <= BOX_MAX * h_px and ASPECT_MIN <= h / max(w, 1) <= ASPECT_MAX):
            continue
        if area / float(w * h) < SOLID_FILL:
            continue
        # Square with straight sides and sharp corners, like the hollow boxes: not a letter or a blot.
        t = max(2, int(round(0.12 * max(w, h))))
        if not _straight_outline(ink, int(x), int(y), int(x + w), int(y + h), t):
            continue
        e = max(2, int(round(CORNER_TIP * max(w, h))))
        tips = ((y, x), (y, x + w - e), (y + h - e, x), (y + h - e, x + w - e))
        if any(ink[ty:ty + e, tx:tx + e].mean() < CORNER_TIP_INK for ty, tx in tips):
            continue
        cx, cy = x + w / 2, y + h / 2
        alike = [b for b in hollow if abs((b["x1"] - b["x0"]) - w) <= 0.25 * w]
        aligned = [b for b in alike
                   if abs((b["y0"] + b["y1"]) / 2 - cy) <= 0.5 * h or abs((b["x0"] + b["x1"]) / 2 - cx) <= 0.5 * w]
        if len(aligned) >= 2:
            out.append({"x0": int(x), "y0": int(y), "x1": int(x + w), "y1": int(y + h),
                        "ink": round(area / float(w * h), 4), "checked": True, "solid": True})
    return out


def _iou(a, b) -> float:
    ix = max(0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    iy = max(0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    inter = ix * iy
    if not inter:
        return 0.0
    area = lambda r: (r["x1"] - r["x0"]) * (r["y1"] - r["y0"])
    return inter / float(min(area(a), area(b)))


def _dedupe(boxes: list[dict]) -> list[dict]:
    out: list[dict] = []
    for box in sorted(boxes, key=lambda b: -(b["x1"] - b["x0"])):
        if all(_iou(box, kept) < 0.5 for kept in out):
            out.append(box)
    return sorted(out, key=lambda b: (b["y0"], b["x0"]))


# ---- OCR line tokens ----

def line_tokens(line: dict, scale: float) -> list[dict]:
    """Tokens of an OCR line with an estimated pixel span (characters share the line width)."""
    text = line["text"]
    x0, y0, x1, y1 = (v * scale for v in line["bbox"])
    n = max(1, len(text))
    step = (x1 - x0) / n
    out = []
    for m in _TOKEN.finditer(text):
        out.append({
            "text": m.group(0),
            "start": m.start(),
            "end": m.end(),
            "x0": x0 + m.start() * step,
            "x1": x0 + m.end() * step,
            "y0": y0,
            "y1": y1,
        })
    return out


# ---- rings ----

def _without_rules(ink: np.ndarray, h_px: float) -> np.ndarray:
    import cv2

    k = max(5, int(round(RULE_LEN * h_px)))
    rules = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, k), np.uint8))
    rules |= cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((k, 1), np.uint8))
    rules = cv2.dilate(rules, np.ones((3, 3), np.uint8))
    clean = ink & (1 - rules)
    return cv2.dilate(clean, np.ones((3, 3), np.uint8))


def _option_text(token: str) -> str:
    return re.sub(r"^[^\w]+|[^\w]+$", "", token)


def ring_candidates(ink_nr: np.ndarray, h_px: float, boxes: list[dict]) -> list[dict]:
    """Hand-drawn rings the size of a short word with ink inside. A ring need not close and may
    touch the glyph it circles: its outer pixels must cover most directions around its centre."""
    import cv2

    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink_nr, connectivity=8)
    out = []
    bins = 24
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[i])
        if not (RING_MIN * h_px <= h <= RING_MAX * h_px and RING_MIN * h_px <= w <= RING_MAX_W * h_px):
            continue
        if area > RING_DENSITY * w * h:
            continue
        if any(_iou({"x0": x, "y0": y, "x1": x + w, "y1": y + h}, b) > 0.3 for b in boxes):
            continue
        ys, xs = np.nonzero(labels[y:y + h, x:x + w] == i)
        cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
        dx, dy = (xs - cx) / max(1.0, w / 2.0), (ys - cy) / max(1.0, h / 2.0)
        r = np.hypot(dx, dy)
        outer = r >= 0.65
        # A ring's own ink lies on its rim; handwriting loops fill their box.
        if outer.mean() < 1 - RING_INNER:
            continue
        angles = ((np.arctan2(dy[outer], dx[outer]) + np.pi) / (2 * np.pi) * bins).astype(int) % bins
        if len(set(angles.tolist())) < (1 - RING_OPEN) * bins:
            continue
        # A printed frame: straight sides fill the bounding box edges.
        edge = (xs <= 1) | (xs >= w - 2) | (ys <= 1) | (ys >= h - 2)
        if edge.sum() >= 0.6 * 2 * (w + h):
            continue
        # Something inside: ink of any component within the inner ellipse.
        gy, gx = np.mgrid[0:h, 0:w]
        inner = np.hypot((gx - cx) / max(1.0, w / 2.0), (gy - cy) / max(1.0, h / 2.0)) <= 0.5
        # Something inside that is not the ring: the circled glyph.
        other = (ink_nr[y:y + h, x:x + w] > 0) & (labels[y:y + h, x:x + w] != i)
        if other[inner].sum() < 0.02 * w * h:
            continue
        hw, hh = 0.7 * w / 2.0, 0.7 * h / 2.0
        out.append({"x0": x, "y0": y, "x1": x + w, "y1": y + h,
                    "hx0": x + cx - hw, "hy0": y + cy - hh, "hx1": x + cx + hw, "hy1": y + cy + hh})
    return out


def find_rings(ink_nr: np.ndarray, lines: list[dict], scale: float, h_px: float, boxes: list[dict]) -> list[dict]:
    """Circled options: a ring around exactly one token of a 2-4 token option group on one OCR line."""
    out = []
    for ring in ring_candidates(ink_nr, h_px, boxes):
        cy = (ring["hy0"] + ring["hy1"]) / 2
        for li, line in enumerate(lines):
            x0, y0, x1, y1 = (v * scale for v in line["bbox"])
            if not (y0 - 0.3 * h_px <= cy <= y1 + 0.3 * h_px) or x1 < ring["x0"] or x0 > ring["x1"]:
                continue
            text = line["text"]
            cut = max(text.rfind(":"), text.rfind("("))
            tokens = [t for t in line_tokens(line, scale) if t["start"] > cut]
            if not 2 <= len(tokens) <= 4:
                continue
            words = [_option_text(t["text"]) for t in tokens]
            if not all(w and len(w) <= OPTION_MAX_CHARS and w.isalpha() for w in words):
                continue
            inside = [k for k, t in enumerate(tokens) if ring["hx0"] <= (t["x0"] + t["x1"]) / 2 <= ring["hx1"]]
            if len(inside) != 1:
                continue
            tok = tokens[inside[0]]
            out.append({"line": li, "token": inside[0], "start": tok["start"], "end": tok["end"], "text": words[inside[0]],
                        "x0": ring["x0"], "y0": ring["y0"], "x1": ring["x1"], "y1": ring["y1"]})
            break
    return out


# ---- placing marks into the OCR lines ----

def _on_box(line: dict, box: dict) -> bool:
    """An OCR line that is only OCR's reading of this box ("X", "O")."""
    pad = 0.5 * (box["x1"] - box["x0"])
    inside = (line["x0"] >= box["x0"] - pad and line["x1"] <= box["x1"] + pad
              and line["y0"] >= box["y0"] - pad and line["y1"] <= box["y1"] + pad)
    return inside and _glyphish(line["text"])


def _line_of(box: dict, lines_px: list[dict], h_px: float) -> int | None:
    cy = (box["y0"] + box["y1"]) / 2
    best, best_d = None, None
    for i, l in enumerate(lines_px):
        if _on_box(l, box):
            continue
        if not (l["y0"] - 0.3 * h_px <= cy <= l["y1"] + 0.3 * h_px):
            continue
        if l["x1"] + LINE_REACH * h_px < box["x0"] or l["x0"] - LINE_REACH * h_px > box["x1"]:
            continue
        d = abs((l["y0"] + l["y1"]) / 2 - cy)
        if best_d is None or d < best_d:
            best, best_d = i, d
    return best


def line_blobs(text_ink: np.ndarray, line: dict, boxes: list[dict], scale: float, h_px: float) -> list[tuple[float, float]]:
    """Ink runs (word blobs) along an OCR line in points, with the boxes cut out.
    Runs closer than BLOB_GAP * h join; the box columns are not ink."""
    H, W = text_ink.shape
    x0, y0, x1, y1 = (int(round(v * scale)) for v in line["bbox"])
    pad = int(round(0.3 * h_px))
    lo, hi = max(0, x0 - pad), min(W, x1 + pad)
    mid0, mid1 = y0 + (y1 - y0) // 4, y1 - (y1 - y0) // 4
    band = text_ink[max(0, mid0):min(H, mid1), lo:hi]
    if band.size == 0:
        return []
    cols = band.any(axis=0)
    for box in boxes:
        b0 = int(round(box["x0"] * scale)) - lo - 2
        b1 = int(round(box["x1"] * scale)) - lo + 2
        cols[max(0, b0):max(0, b1)] = False
    xs = np.flatnonzero(cols)
    if xs.size == 0:
        return []
    gap = max(2, int(round(BLOB_GAP * h_px)))
    runs = []
    start = prev = int(xs[0])
    for x in xs[1:]:
        x = int(x)
        if x - prev > gap:
            runs.append((start, prev + 1))
            start = x
        prev = x
    runs.append((start, prev + 1))
    # Specks (dust, a tick's tail) narrower than a fifth of h are not words.
    runs = [r for r in runs if r[1] - r[0] >= 0.2 * h_px]
    return [((lo + r0) / scale, (lo + r1) / scale) for r0, r1 in runs]


def _can_cut(token: str, head: int) -> bool:
    """A box glyph can be cut off the front of a token, but never inside a Capitalized word (F|ail)."""
    if len(token) <= head:
        return False
    # A two-character reading of a box is the box plus a stroke read as I, l, | or 1, or punctuation.
    if head == 2 and token[1].isalnum() and token[1] not in "Il|1":
        return False
    rest = token[head:]
    if not any(ch.isalnum() for ch in rest):
        return False
    return not (token[head - 1].isupper() and rest[0].islower())


def _can_tail(token: str, tail: int) -> bool:
    """A box glyph glued to the end of the word before the box ("destroyedO"): never a lowercase tail."""
    if len(token) <= tail:
        return False
    rest, end = token[:-tail], token[-tail:]
    if not rest[-1].islower() or end[0].islower() or end[0] in ".,:;)'\"":
        return False
    return True


def char_width(lines: list[dict]) -> float | None:
    """The page's width of one text_width unit (points): median over the longer OCR lines."""
    widths = [(l["bbox"][2] - l["bbox"][0]) / text_width(l["text"]) for l in lines if len(l["text"]) >= 6]
    return float(np.median(widths)) if widths else None


_NARROW = set("iljftrI1!|.,:;'/()[]")
_WIDE = set("mwMW@%")


def text_width(text: str) -> float:
    """Width of text in units of an average lowercase letter (a rough sans-serif model)."""
    total = 0.0
    for ch in text:
        if ch.isspace():
            total += 0.55
        elif ch in _NARROW:
            total += 0.55
        elif ch in _WIDE:
            total += 1.5
        elif ch.isupper():
            total += 1.45
        elif ch.isdigit():
            total += 1.1
        else:
            total += 1.0
    return total


def _glyphish(token: str) -> bool:
    word = _option_text(token)
    return len(word) <= 2 or not any(ch.isalnum() for ch in token)


def align_tokens(tokens: list[str], slots: list[dict], cw: float) -> list[tuple[int, int, int]] | None:
    """Assign OCR tokens to slots in reading order.

    `slots` are boxes ({"box": i}) and ink blobs ({"w": width}). Returns a list of
    (slot, token, head): the token goes to the slot. For a box slot, 0 < head < 100 means
    only the first `head` characters are the box's glyph ("MA" = box + "A"), and
    head >= 100 means the characters from head - 100 on are (a glyph glued to the word
    before the box). Blob entries carry minus the characters already cut off.
    A box takes zero or more glyph tokens (OCR's reading of the box); a blob takes the
    tokens whose estimated width matches its ink.
    """
    T, S = len(tokens), len(slots)
    INF = float("inf")
    # State: (slot j, token i, chars already consumed of token i)
    best: dict[tuple[int, int, int], tuple[float, tuple | None, list]] = {(0, 0, 0): (0.0, None, [])}
    # Every move goes to the next slot, so the states can be settled one slot at a time.
    for state in (st for layer in range(S + 1) for st in sorted(k for k in list(best) if k[0] == layer)):
        j, i, off = state
        cost, _, _ = best[state]
        if j == S:
            continue
        slot = slots[j]

        def push(nstate, add, assign):
            total = cost + add
            if total < best.get(nstate, (INF,))[0]:
                best[nstate] = (total, state, assign)

        if "box" in slot:
            if off > 0:
                # the rest of a token whose head the previous blob took ("destroyedO")
                rest = tokens[i][off:]
                push((j + 1, i + 1, 0), HEAD_COST * sum(ch.isalnum() for ch in rest) + 0.1, [(j, i, 100 + off)])
                continue
            # zero tokens: the box was not read
            push((j + 1, i, off), 0.0, [])
            if off == 0:
                taken = []
                c = 0.0
                for k in range(i, min(T, i + 2)):
                    tok = tokens[k]
                    if sum(ch.isalnum() for ch in tok) <= 1:
                        c += GLYPH_REWARD
                    elif _glyphish(tok):
                        c += 0.0
                    else:
                        c += 1.0 + len(_option_text(tok))
                    taken.append((j, k, 0))
                    push((j + 1, k + 1, 0), c, list(taken))
                if i < T:
                    for head in (1, 2):
                        if _can_cut(tokens[i], head):
                            alnum = sum(ch.isalnum() for ch in tokens[i][:head])
                            cost_head = HEAD_COST * alnum - 0.5 * (head - alnum) + 0.1
                            push((j + 1, i, head), cost_head, [(j, i, head)])
        else:
            width = slot["w"]
            # zero tokens: unexplained ink (a stroke, a smudge)
            if off == 0:
                push((j + 1, i, 0), EMPTY_BLOB + 0.5 * width / cw, [])
            letters = 0.0
            taken = []
            next_box = j + 1 < S and "box" in slots[j + 1]
            for k in range(i, T):
                piece = tokens[k][off:] if k == i else tokens[k]
                letters += text_width(piece) + (0.55 if k > i else 0.0)
                taken.append((j, k, -(off if k == i else 0)))
                miss = abs(letters * cw - width) / cw
                push((j + 1, k + 1, 0), miss, list(taken))
                if next_box:
                    for tail in (1, 2):
                        if _can_tail(piece, tail):
                            short = abs((letters - text_width(piece[-tail:])) * cw - width) / cw
                            push((j + 1, k, len(tokens[k]) - tail), short, list(taken))
                if letters * cw > width + 6 * cw:
                    break
    end = best.get((S, T, 0))
    if end is None:
        return None
    out = []
    state = (S, T, 0)
    while state is not None and state in best:
        _, prev, assign = best[state]
        out = assign + out
        state = prev
    return out


def plan_line(line: dict, boxes: list[dict], blobs: list[tuple[float, float]], ring: dict | None, h_pt: float) -> tuple[str, int]:
    """New text for one OCR line (coordinates in points) and the number of marks placed in it."""
    text = line["text"]
    matches = list(re.finditer(r"\S+", text))
    tokens = [m.group(0) for m in matches]
    edits: list[tuple[int, int, str]] = []
    placed = 0
    if boxes:
        slots = [{"box": i, "x0": b["x0"], "x1": b["x1"]} for i, b in enumerate(boxes)]
        slots += [{"w": b1 - b0, "x0": b0, "x1": b1} for b0, b1 in blobs]
        slots.sort(key=lambda s: s["x0"])
        words = [t for t in tokens if not _glyphish(t)]
        blob_w = sum(sl["w"] for sl in slots if "w" in sl)
        units = sum(text_width(t) for t in words)
        if units >= 12 and blob_w:
            cw = blob_w / units
        else:
            cw = float(line.get("cw") or 0) or max(1e-6, (line["bbox"][2] - line["bbox"][0]) / max(1.0, text_width(text)))
        plan = align_tokens(tokens, slots, cw)
        if plan is None:
            return text, 0
        tok_slot: dict[int, int] = {}
        heads: dict[int, int] = {}
        read: set[int] = set()
        for j, k, head in plan:
            if "box" in slots[j]:
                read.add(j)
            if "box" in slots[j] and head >= 100:
                edits.append((matches[k].start() + head - 100, matches[k].end(), ""))
                continue
            if "box" in slots[j]:
                if head > 0:
                    heads[k] = head
                else:
                    edits.append((matches[k].start(), matches[k].end(), ""))
            elif k not in tok_slot:
                tok_slot[k] = j
        for k, head in heads.items():
            edits.append((matches[k].start(), matches[k].start() + head, ""))
        # Where each slot's text starts: a token, or the rest of a token after a cut head.
        starts: dict[int, int] = {}
        for k in sorted(tok_slot):
            starts.setdefault(tok_slot[k], matches[k].start() + heads.get(k, 0))
        for j, slot in enumerate(slots):
            if "box" not in slot:
                continue
            box = boxes[slot["box"]]
            marker = CHECK if box["checked"] else UNCHECK
            after = [starts[jj] for jj in range(j + 1, len(slots)) if jj in starts]
            right = next((jj for jj in range(j + 1, len(slots)) if "w" in slots[jj]), None)
            left = next((jj for jj in range(j - 1, -1, -1) if "w" in slots[jj] and jj in starts), None)
            label_right = right is not None and slots[right]["x0"] - box["x1"] <= LABEL_GAP * h_pt
            if label_right and right not in starts:
                # The ink beside the "box" is part of a word OCR read across it: a letter, not a box.
                continue
            if label_right and j not in read and text[starts[right]:starts[right] + 1].islower():
                # OCR read no glyph here and the word after starts in lowercase: the box is its first letter.
                continue
            if label_right and after:
                target = after[0]
            elif not label_right and left is not None and box["x0"] - slots[left]["x1"] <= LABEL_GAP * h_pt:
                # Label before the box ("Fail ☐"): the marker still leads its label.
                target = starts[left]
            elif after:
                target = after[0]
            else:
                edits.append((len(text), len(text), " " + marker.strip()))
                placed += 1
                continue
            edits.append((target, target, marker))
            placed += 1
    if ring is not None:
        edits.append((ring["start"], ring["start"], CHECK))
        placed += 1
    if not edits:
        return text, 0
    out = text
    for start, end, repl in sorted(edits, key=lambda e: (e[0], e[1] - e[0]), reverse=True):
        out = out[:start] + repl + out[end:]
    # A tick's tail read as punctuation just before its marker ("/ [x] Pass", "#/[x] Pass").
    out = re.sub(r"(^|\s)[^\w\s\[\]]{1,2}\s*(?=\[[x ]\] )", r"\1", out)
    out = re.sub(r"(\[[x ]\] )[^\w\s\[\]]{1,2}\s+", r"\1", out)
    out = re.sub(r"(\[[x ]\] )(?!\[[x ]\] )[^\w\s]{1,2}(?=\w)", r"\1", out)
    return re.sub(r"\s+", " ", out).strip(), placed


# ---- writing into the document ----

def _units(doc: dict, page_no: int) -> list[tuple[dict, str | None, int | None]]:
    """Text holders on a page: (block, "text", None), (table, "cell", i), (list, "item", i)."""
    out = []
    for bid in doc.get("order") or []:
        block = doc["blocks"][bid]
        if int(block.get("page") or 0) != page_no:
            continue
        if block.get("type") == "table":
            for i, _cell in enumerate(block.get("cells") or []):
                out.append((block, "cell", i))
        elif block.get("type") == "list":
            for i, _item in enumerate(block.get("items") or []):
                out.append((block, "item", i))
        elif block.get("type") in {"para", "heading", "caption", "footnote"}:
            out.append((block, "text", None))
    return out


def _unit_box(unit) -> list[float]:
    block, kind, index = unit
    return block["cells"][index]["bbox"] if kind == "cell" else block["bbox"]


def _unit_key(unit):
    return (id(unit[0]), unit[1], unit[2])


def _unit_text(unit) -> str:
    block, kind, index = unit
    if kind == "cell":
        return block["cells"][index].get("text") or ""
    if kind == "item":
        return block["items"][index].get("text") or ""
    return block.get("text") or ""


def _set_unit_text(unit, text: str) -> None:
    block, kind, index = unit
    if kind == "cell":
        block["cells"][index]["text"] = text
    elif kind == "item":
        block["items"][index]["text"] = text
    else:
        block["text"] = text


def _inside(pt, box, pad: float = 0.0) -> bool:
    return box[0] - pad <= pt[0] <= box[2] + pad and box[1] - pad <= pt[1] <= box[3] + pad


def _owner(units, center_pt, pad: float, line_text: str = ""):
    """The text holder of a mark: the smallest table cell around it, else a text block or
    list item near it (list items share their list's box; the one holding the line wins)."""
    cells = [u for u in units if u[1] == "cell" and _inside(center_pt, _unit_box(u))]
    if cells:
        return min(cells, key=lambda u: (_unit_box(u)[2] - _unit_box(u)[0]) * (_unit_box(u)[3] - _unit_box(u)[1]))
    texts = [u for u in units if u[1] in {"text", "item"} and _inside(center_pt, _unit_box(u), pad)]
    if line_text:
        holding = [u for u in texts if _replace_line(_unit_text(u), line_text, line_text) is not None]
        if holding:
            return holding[0]
    texts = [u for u in texts if u[1] == "text"]
    return texts[0] if texts else None


def _replace_line(unit_text: str, old: str, new: str) -> str | None:
    norm = lambda s: re.sub(r"\s+", " ", s).strip()
    t, o = norm(unit_text), norm(old)
    if o and o in t:
        return t.replace(o, new, 1)
    ttoks, otoks = t.split(" "), o.split(" ")
    for i in range(0, len(ttoks) - len(otoks) + 1):
        if ttoks[i:i + len(otoks)] == otoks:
            return " ".join(ttoks[:i] + [new] + ttoks[i + len(otoks):])
    return None


def _is_junk(text: str) -> bool:
    """Only what OCR makes of a box: one or two characters, or no letters and digits at all."""
    toks = text.split()
    return all(len(_option_text(t)) <= 2 or not any(ch.isalnum() for ch in t) for t in toks)


def mark_page(doc: dict, page_no: int, lines: list[dict], boxes_pt: list[dict], rings: list[dict], h_pt: float, stats: dict) -> None:
    units = _units(doc, page_no)
    by_unit: dict[int, dict] = {}
    unit_list = []

    def slot(unit):
        for i, u in enumerate(unit_list):
            if _unit_key(u) == _unit_key(unit):
                return i
        unit_list.append(unit)
        by_unit[len(unit_list) - 1] = {"boxes": {}, "rings": {}, "lone": []}
        return len(unit_list) - 1

    for box in boxes_pt:
        pb = box.get("page_bbox") or [box["x0"], box["y0"], box["x1"], box["y1"]]
        center = ((pb[0] + pb[2]) / 2, (pb[1] + pb[3]) / 2)
        li = box.get("line")
        unit = _owner(units, center, pad=1.5 * (box["x1"] - box["x0"]), line_text=lines[li]["text"] if li is not None else "")
        if unit is None:
            stats["orphans"] += 1
            continue
        entry = by_unit[slot(unit)]
        if li is None:
            entry["lone"].append(box)
        else:
            entry["boxes"].setdefault(li, []).append(box)
    for ring in rings:
        pb = ring.get("page_bbox") or [ring["x0"], ring["y0"], ring["x1"], ring["y1"]]
        center = ((pb[0] + pb[2]) / 2, (pb[1] + pb[3]) / 2)
        unit = _owner(units, center, pad=0.5 * h_pt, line_text=lines[ring["line"]]["text"])
        if unit is None:
            stats["orphans"] += 1
            continue
        by_unit[slot(unit)]["rings"][ring["line"]] = ring

    for i, unit in enumerate(unit_list):
        entry = by_unit[i]
        text = _unit_text(unit)
        if _MARKED.search(text):
            stats["skipped"] += 1
            continue
        new = text
        ok = True
        placed = 0
        for li in sorted(set(entry["boxes"]) | set(entry["rings"]), key=lambda k: (lines[k]["bbox"][1], lines[k]["bbox"][0])):
            line = lines[li]
            line_new, n = plan_line(line, entry["boxes"].get(li, []), line.get("blobs") or [], entry["rings"].get(li), h_pt)
            if line_new == line["text"]:
                continue
            replaced = _replace_line(new, line["text"], line_new)
            if replaced is None:
                ok = False
                break
            new = replaced
            placed += n
        if not ok:
            stats["skipped"] += 1
            continue
        if entry["lone"]:
            lone = sorted(entry["lone"], key=lambda b: (b["y0"], b["x0"]))
            if new.strip() and not _is_junk(new):
                stats["skipped"] += 1
                continue
            new = " ".join(("[x]" if b["checked"] else "[ ]") for b in lone)
            placed += len(lone)
        if new != text:
            _set_unit_text(unit, new)
            stats["placed"] += placed


def page_turn(ink: np.ndarray, lines: list[dict], scale: float) -> int | None:
    """Quarter turns (numpy rot90 k) that make the text upright: 0, 1 or 3. None when unsure.

    Sideways lines are taller than wide. Their reading direction comes from the
    ascender side of lowercase lines: more ink sticks out of the x-height body there.
    """
    long = [l for l in lines if len(l["text"]) >= 4]
    tall = [l for l in long if (l["bbox"][3] - l["bbox"][1]) > 1.5 * (l["bbox"][2] - l["bbox"][0])]
    if not long or len(tall) < TURN_SHARE * len(long):
        return 0
    right = left = 0
    for l in tall:
        if len(l["text"]) < 5 or not any(ch.islower() for ch in l["text"]):
            continue
        x0, y0, x1, y1 = (int(v * scale) for v in l["bbox"])
        band = ink[y0:y1, x0:x1]
        w = band.shape[1]
        if w < 6:
            continue
        # The x-height body is the dense middle; ascenders (b d f h k l t and capitals) stick out
        # of it far more often than descenders (g j p q y), whatever margins the OCR box has.
        prof = band.sum(axis=0).astype(float)
        if prof.max() <= 0:
            continue
        body = np.flatnonzero(prof >= 0.5 * prof.max())
        lo, hi = prof[:body.min()].sum(), prof[body.max() + 1:].sum()
        if hi > 1.2 * lo:
            right += 1
        elif lo > 1.2 * hi:
            left += 1
    if right + left < 4:
        return None
    if right >= 2 * left:
        return 1  # ascenders point right: the page was turned clockwise
    if left >= 2 * right:
        return 3
    return None


def turn_box(box: list[float], k: int, w: float, h: float) -> list[float]:
    """A top-left box on a w x h page, in the frame of np.rot90(page, k)."""
    x0, y0, x1, y1 = box
    if k == 1:
        return [y0, w - x1, y1, w - x0]
    if k == 3:
        return [h - y1, x0, h - y0, x1]
    return [x0, y0, x1, y1]


def unturn_box(box: list[float], k: int, w: float, h: float) -> list[float]:
    x0, y0, x1, y1 = box
    if k == 1:
        return [w - y1, x0, w - y0, x1]
    if k == 3:
        return [y0, h - x1, y1, h - x0]
    return [x0, y0, x1, y1]


def detect_page(gray: np.ndarray, scale: float, lines: list[dict], page_w: float, page_h: float) -> dict | None:
    """Boxes and rings on one page. Marks carry `bbox` in the upright frame of `lines` (points)
    and `page_bbox` in page points. None when the page has too little OCR text or no clear orientation."""
    ink = ink_mask(gray)
    k = page_turn(ink, lines, scale)
    if k is None:
        return None
    if k:
        ink = np.ascontiguousarray(np.rot90(ink, k))
        lines = [{**l, "bbox": turn_box(l["bbox"], k, page_w, page_h)} for l in lines]
    h_pt = line_height(lines)
    if h_pt is None:
        return None
    h_px = h_pt * scale
    boxes_px = find_boxes(ink, h_px)
    xh = x_height(ink, lines, scale)
    if xh:
        boxes_px = [b for b in boxes_px if (b["y1"] - b["y0"]) >= XHEIGHT_MIN * xh]
    lines_px = [{**l, "x0": l["bbox"][0] * scale, "y0": l["bbox"][1] * scale,
                 "x1": l["bbox"][2] * scale, "y1": l["bbox"][3] * scale} for l in lines]
    for box in boxes_px:
        box["line"] = _line_of(box, lines_px, h_px)
    boxes_px = gate_boxes(boxes_px, lines_px, h_px)
    rings = find_rings(_without_rules(ink, h_px), lines, scale, h_px, boxes_px)

    def to_pt(mark):
        bbox = [round(mark[key] / scale, 3) for key in ("x0", "y0", "x1", "y1")]
        out = {**mark, "x0": bbox[0], "y0": bbox[1], "x1": bbox[2], "y1": bbox[3]}
        out["page_bbox"] = [round(v, 3) for v in unturn_box(bbox, k, page_w, page_h)]
        return out

    boxes = [to_pt(b) for b in boxes_px]
    text_ink = _text_ink(ink, h_px)
    cw = char_width(lines)
    for li in {b["line"] for b in boxes if b.get("line") is not None}:
        on_line = [b for b in boxes if b.get("line") == li]
        lines[li] = {**lines[li], "blobs": line_blobs(text_ink, lines[li], on_line, scale, h_px), "cw": cw}
    return {"boxes": boxes, "rings": [to_pt(r) for r in rings], "lines": lines, "h": h_pt, "turn": k}


def _text_ink(ink: np.ndarray, h_px: float) -> np.ndarray:
    """Ink without long rules (cell borders), so word blobs stop at the cell edge."""
    import cv2

    k = max(5, int(round(RULE_LEN * h_px)))
    rules = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((k, 1), np.uint8))
    rules |= cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, k), np.uint8))
    return ink & (1 - cv2.dilate(rules, np.ones((3, 3), np.uint8)))


def gate_boxes(boxes: list[dict], lines_px: list[dict], h_px: float) -> list[dict]:
    """Drop what looks like a square-bullet list: every box empty, each one alone at the start of its line."""
    if not boxes:
        return boxes
    if any(b["checked"] for b in boxes):
        return boxes
    inline = 0
    for box in boxes:
        li = box.get("line")
        if li is None:
            continue
        line = lines_px[li]
        if line["x0"] < box["x0"] - 0.5 * h_px:
            inline += 1
        elif sum(1 for b in boxes if b.get("line") == li) >= 2:
            inline += 1
    return boxes if inline else []


def apply_checkmarks(doc: dict, pdf_path, ocr_lines: dict) -> dict:
    """Write box and ring state into the text of scanned pages. Counts go to stats.checkmarks."""
    started = time.perf_counter()
    stats = {"boxes": 0, "checked": 0, "circles": 0, "placed": 0, "skipped": 0, "orphans": 0, "ms": 0}
    for page in doc.get("pages") or []:
        if page.get("kind") != "scan":
            continue
        n = int(page["n"])
        lines = [l for l in (ocr_lines.get(n) or ocr_lines.get(str(n)) or []) if l.get("ocr", True)]
        try:
            gray, scale = render_gray(pdf_path, n)
        except Exception:
            continue
        found = detect_page(gray, scale, lines, float(page.get("w") or gray.shape[1] / scale), float(page.get("h") or gray.shape[0] / scale))
        if found is None:
            continue
        stats["boxes"] += len(found["boxes"])
        stats["checked"] += sum(1 for b in found["boxes"] if b["checked"])
        stats["circles"] += len(found["rings"])
        mark_page(doc, n, found["lines"], found["boxes"], found["rings"], found["h"], stats)
    stats["ms"] = int((time.perf_counter() - started) * 1000)
    doc.setdefault("stats", {})["checkmarks"] = stats
    return doc
