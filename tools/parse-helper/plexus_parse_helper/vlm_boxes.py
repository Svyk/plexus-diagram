"""Table regions for a high-accuracy read.

The layout model and the caller's rule or stream boxes each miss tables the
other finds. A page keeps both. Where they are the same grid, the layout
rectangle is the crop: a rule box often covers the column around the grid.
Two fragments from the same detector grow to cover both. The reader pads the
image; the box stays the grid. When the layout model marks no table and the
page still has two aligned numeric columns, the whole page is the crop.
"""

from __future__ import annotations

import re

from plexus_parse_helper.vlm_layout import TABLE_LABELS

STACK_GAP = 22.0
# Two detections of one grid. A lower bar merges neighbouring tables.
UNION_IOU = 0.2
UNION_COVER = 0.55
# A column of numbers, not a list: at least two alignments of four rows.
MIN_NUMERIC_ROWS = 4
MIN_NUMERIC_COLS = 2
ROW_GAP = 4.0
# A column of page numbers scattered down a contents list is not a table.
# Table rows sit about a line apart. Same rule as vlm-boxes.js.
ROW_PITCH_MAX = 36.0
# A claim number, a margin line number, or an equation number sits on a
# sentence. A short label beside a count does not. Same rule as vlm-boxes.js.
PROSE_LETTERS = 8
# A row label beside a measured value ("Methane" / "84.7") is a few words.
# A full sentence is not a table row. Same rule as vlm-boxes.js.
LABEL_LETTERS_MAX = 24

# A number, a decimal, or a thousands group. A letter in the token is not a number.
_NUMERIC = re.compile(
    r"^[\$£€]?\(?[+-]?(?:\d{1,3}(?:[, ]\d{3})+|\d+)(?:\.\d+)?\)?%?$|^\.\d+%?$"
)


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


def _cover(inner, outer):
    ix = min(inner[2], outer[2]) - max(inner[0], outer[0])
    iy = min(inner[3], outer[3]) - max(inner[1], outer[1])
    if ix <= 0 or iy <= 0:
        return 0.0
    area = _area(inner)
    return (ix * iy) / area if area else 0.0


def _same_region(a, b):
    if _iou(a, b) >= UNION_IOU:
        return True
    return _cover(a, b) >= UNION_COVER or _cover(b, a) >= UNION_COVER


def _union_rect(a, b):
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def _merge_same_grid(a, b):
    """One crop for one grid.

    Two layout fragments, or two caller fragments, grow to cover both.
    A layout box and a caller box of the same grid keep the layout rectangle:
    the rule box is often the column, and stretching the crop to it pulls in
    the paragraph above the rules.
    """
    kept = dict(a)
    if a.get("source") == "layout" and b.get("source") != "layout":
        pass
    elif b.get("source") == "layout" and a.get("source") != "layout":
        kept = dict(b)
    else:
        kept["bbox"] = _union_rect(a["bbox"], b["bbox"])
    kept["score"] = max(float(a.get("score") or 0), float(b.get("score") or 0))
    kept["source"] = _join_source(a.get("source"), b.get("source"))
    if kept.get("page") is None:
        kept["page"] = b.get("page")
    return kept


def _join_source(a, b):
    if not a:
        return b or "union"
    if not b or a == b:
        return a
    return "union"


def is_numeric_token(text) -> bool:
    token = re.sub(r"\s+", "", str(text or "")).strip(".,;:")
    return bool(token) and _NUMERIC.match(token) is not None


def _word_box(word):
    bbox = word.get("bbox") if isinstance(word, dict) else None
    if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        return [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])]
    if not isinstance(word, dict):
        return None
    keys = ("x0", "y0", "x1", "y1")
    if any(word.get(key) is None for key in keys):
        return None
    return [float(word["x0"]), float(word["y0"]), float(word["x1"]), float(word["y1"])]


def _letter_count(text) -> int:
    return sum(1 for ch in str(text or "") if ("A" <= ch <= "Z") or ("a" <= ch <= "z"))


def _list_marker(text) -> bool:
    token = re.sub(r"\s+", "", str(text or "")).rstrip(".,;:")
    return bool(re.fullmatch(r"\d{1,4}", token))


def _same_line_letters(words, y) -> int:
    total = 0
    for word in words or []:
        if not isinstance(word, dict):
            continue
        text = word.get("text")
        if _list_marker(text) or is_numeric_token(text):
            continue
        box = _word_box(word)
        if not box:
            continue
        cy = (box[1] + box[3]) / 2
        if abs(cy - y) > ROW_GAP:
            continue
        total += _letter_count(text)
    return total


def _row_centers(ys, gap=ROW_GAP):
    if not ys:
        return []
    ordered = sorted(ys)
    rows = [ordered[0]]
    for y in ordered[1:]:
        if y - rows[-1] > gap:
            rows.append(y)
    return rows


def _table_pitch(ys) -> float:
    rows = _row_centers(ys)
    if len(rows) < 2:
        return float("inf")
    gaps = sorted(rows[i] - rows[i - 1] for i in range(1, len(rows)))
    return gaps[len(gaps) // 2]


def aligned_numeric_columns(words, *, min_rows=MIN_NUMERIC_ROWS, min_cols=MIN_NUMERIC_COLS) -> bool:
    """True when numbers line up in at least two columns of several rows.

    One column is a list or a margin of page numbers, not a table. The same
    rule is implemented in src/model/parse/vlm-boxes.js; the constants match.
    """
    nums = []
    for word in words or []:
        if not isinstance(word, dict) or not is_numeric_token(word.get("text")):
            continue
        box = _word_box(word)
        if not box:
            continue
        cy = (box[1] + box[3]) / 2
        if _list_marker(word.get("text")) and _same_line_letters(words, cy) >= PROSE_LETTERS:
            continue
        width = box[2] - box[0]
        nums.append(((box[0] + box[2]) / 2, cy, width))
    if len(nums) < min_rows * min_cols:
        return False
    widths = sorted(width for _, _, width in nums if width > 0)
    median = widths[len(widths) // 2] if widths else 8.0
    tol = max(8.0, median * 0.6)
    nums.sort(key=lambda item: item[0])
    columns = []
    for x, y, _width in nums:
        if columns and abs(x - columns[-1]["x"]) <= tol:
            columns[-1]["ys"].append(y)
            n = len(columns[-1]["ys"])
            columns[-1]["x"] = columns[-1]["x"] + (x - columns[-1]["x"]) / n
        else:
            columns.append({"x": x, "ys": [y]})
    good = [
        col for col in columns
        if len(_row_centers(col["ys"])) >= min_rows and _table_pitch(col["ys"]) <= ROW_PITCH_MAX
    ]
    if len(good) < min_cols:
        return False
    for i, left in enumerate(good):
        a0, a1 = min(left["ys"]), max(left["ys"])
        for right in good[i + 1:]:
            b0, b1 = min(right["ys"]), max(right["ys"])
            overlap = min(a1, b1) - max(a0, b0)
            shorter = min(a1 - a0, b1 - b0)
            if shorter > 0 and overlap / shorter >= 0.5:
                return True
    return False


def _decimal_token(text) -> bool:
    if not is_numeric_token(text):
        return False
    token = re.sub(r"\s+", "", str(text or "")).strip(".,;:")
    return "." in token or "%" in token


def labeled_decimal_column(words) -> bool:
    """One column of measured values with a short label on the same rows.

    Two numeric columns are aligned_numeric_columns, which may read the whole
    page. This signal only marks the page so the layout model can run. The
    same rule is implemented in src/model/parse/vlm-boxes.js.
    """
    nums = []
    for word in words or []:
        if not isinstance(word, dict) or not _decimal_token(word.get("text")):
            continue
        box = _word_box(word)
        if not box:
            continue
        nums.append(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, box[2] - box[0]))
    if len(nums) < MIN_NUMERIC_ROWS:
        return False
    widths = sorted(width for _, _, width in nums if width > 0)
    median = widths[len(widths) // 2] if widths else 8.0
    tol = max(8.0, median * 0.6)
    nums.sort(key=lambda item: item[0])
    columns = []
    for x, y, _width in nums:
        if columns and abs(x - columns[-1]["x"]) <= tol:
            columns[-1]["ys"].append(y)
            n = len(columns[-1]["ys"])
            columns[-1]["x"] = columns[-1]["x"] + (x - columns[-1]["x"]) / n
        else:
            columns.append({"x": x, "ys": [y]})
    for col in columns:
        rows = _row_centers(col["ys"])
        if len(rows) < MIN_NUMERIC_ROWS or _table_pitch(col["ys"]) > ROW_PITCH_MAX:
            continue
        labeled = 0
        for y in rows:
            letters = _same_line_letters(words, y)
            if 2 <= letters <= LABEL_LETTERS_MAX:
                labeled += 1
        if labeled >= MIN_NUMERIC_ROWS:
            return True
    return False


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
            prev["source"] = _join_source(prev.get("source"), box.get("source"))
            continue
        merged.append(box)
    return merged


def union_regions(boxes):
    """Join boxes that are the same grid. Side-by-side tables stay apart."""
    items = []
    for box in boxes:
        bbox = box.get("bbox") if isinstance(box, dict) else None
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        items.append({
            "bbox": [float(v) for v in bbox],
            "score": float(box.get("score") or 0),
            "source": box.get("source") or "union",
            "label": box.get("label") or "table",
            "page": box.get("page"),
        })
    guard = 0
    changed = True
    while changed and guard < 64:
        guard += 1
        changed = False
        i = 0
        while i < len(items):
            j = i + 1
            while j < len(items):
                if _same_region(items[i]["bbox"], items[j]["bbox"]):
                    items[i] = _merge_same_grid(items[i], items[j])
                    del items[j]
                    changed = True
                    continue
                j += 1
            i += 1
    return merge_stacked(items)


def _round_box(box):
    return [round(float(v), 2) for v in box]


def _as_region(box, source):
    item = dict(box)
    item["label"] = item.get("label") or "table"
    item["source"] = source
    item["bbox"] = [float(v) for v in item["bbox"]]
    return item


def choose_table_boxes(layout_boxes, fallback_boxes, *, page_size=None, numeric=False, box_mode="union"):
    """Regions to read, top-left PDF points.

    `union` (the read) keeps layout tables and caller boxes together.
    `layout` is the previous rule: layout tables, or the caller when there
    are none. `caller` reads only the boxes it was given (an oracle crop).
    `numeric` with no layout table replaces those fragments with the page.
    Boxes are the grid, not the crop: the reader pads when it renders.
    """
    if box_mode not in {"union", "layout", "caller"}:
        raise ValueError("boxMode must be union, caller, or layout")
    layout = [_as_region(b, "layout") for b in layout_boxes or [] if b.get("label") in TABLE_LABELS and b.get("bbox")]
    caller = [_as_region(b, "caller") for b in fallback_boxes or [] if b.get("bbox")]
    pw = ph = None
    if page_size and len(page_size) >= 2:
        pw, ph = float(page_size[0]), float(page_size[1])
    if box_mode == "caller":
        chosen = merge_stacked(caller)
    elif box_mode == "layout":
        chosen = merge_stacked(layout) or merge_stacked(caller)
    elif not layout and numeric and pw and ph:
        chosen = [{
            "bbox": [0.0, 0.0, pw, ph],
            "score": 0,
            "source": "page",
            "label": "table",
        }]
    else:
        chosen = union_regions(layout + caller)
    for box in chosen:
        box["bbox"] = _round_box(box["bbox"])
    return chosen


def drop_layout_inside_figures(boxes, figures, min_cover=0.6):
    """A layout table inside a figure is the figure, not a grid to read.

    A caller box, a union of caller and layout, and a whole-page crop stay.
    The caller asked for those.
    """
    fig_boxes = []
    for fig in figures or []:
        bbox = fig.get("bbox") if isinstance(fig, dict) else None
        if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
            fig_boxes.append([float(v) for v in bbox])
    kept = []
    for box in boxes or []:
        bbox = box.get("bbox") if isinstance(box, dict) else None
        if (
            isinstance(box, dict)
            and box.get("source") == "layout"
            and isinstance(bbox, (list, tuple))
            and len(bbox) == 4
            and any(_cover(bbox, fig) >= min_cover for fig in fig_boxes)
        ):
            continue
        kept.append(box)
    return kept
