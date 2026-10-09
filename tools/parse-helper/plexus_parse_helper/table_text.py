"""Turn DocTags / OTSL / HTML / markdown into pxd table cells. No scorer edits."""
import re
from html.parser import HTMLParser

CELL_TAGS = {"fcel", "ecel", "ched", "rhed", "srow"}
SPAN_TAGS = {"lcel", "ucel", "xcel"}
TAG_RE = re.compile(r"<(/?)([A-Za-z0-9_]+)>")
LOC_RE = re.compile(r"^loc_(\d+)$")


def _clean(text):
    text = re.sub(r"<loc_\d+>", "", text or "")
    text = text.replace("\\n", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_otsl(otsl):
    """One OTSL string -> cells [{r,c,rowSpan,colSpan,text,header}]."""
    rows = []
    row = []
    buf = []
    locs = []
    current = None

    def flush_text():
        if current is not None:
            current["text"] += "".join(buf)
        buf.clear()

    for match in TAG_RE.finditer(otsl):
        buf.append(otsl[match.start(0) and 0:0] if False else "")
    # Walk with positions so text between tags is kept.
    pos = 0
    for match in TAG_RE.finditer(otsl):
        between = otsl[pos:match.start()]
        if between:
            buf.append(between)
        pos = match.end()
        closing, name = match.group(1), match.group(2).lower()
        if closing:
            continue
        loc = LOC_RE.match(name)
        if loc:
            locs.append(int(loc.group(1)))
            continue
        if name == "nl":
            flush_text()
            if row:
                rows.append(row)
            row = []
            current = None
            locs = []
            continue
        if name in CELL_TAGS or name in SPAN_TAGS:
            flush_text()
            current = {"tag": name, "text": "", "locs": locs[-4:] if len(locs) >= 4 else []}
            locs = []
            row.append(current)
            continue
        # unknown tag: keep as text
        buf.append(match.group(0))
    if pos < len(otsl):
        buf.append(otsl[pos:])
    flush_text()
    if row:
        rows.append(row)
    rows = [r for r in rows if r]
    if not rows:
        return []
    width = max(len(r) for r in rows)
    grid = []
    for r in rows:
        padded = r + [{"tag": "ecel", "text": "", "locs": []} for _ in range(width - len(r))]
        grid.append(padded[:width])
    cells = []
    for r, line in enumerate(grid):
        for c, slot in enumerate(line):
            tag = slot["tag"]
            if tag not in CELL_TAGS:
                continue
            col_span = 1
            while c + col_span < width and grid[r][c + col_span]["tag"] == "lcel":
                col_span += 1
            row_span = 1
            while r + row_span < len(grid) and grid[r + row_span][c]["tag"] in {"ucel", "xcel"}:
                row_span += 1
            cells.append({
                "r": r,
                "c": c,
                "rowSpan": row_span,
                "colSpan": col_span,
                "text": _clean(slot["text"]),
                "header": tag in {"ched", "rhed", "srow"},
                "locs": slot["locs"],
            })
    return cells


def otsl_blocks(raw):
    blocks = re.findall(r"<otsl>(.*?)</otsl>", raw or "", flags=re.I | re.S)
    if blocks:
        return blocks
    # Truncated generation: an opening tag and no close.
    m = re.search(r"<otsl>(.*)$", raw or "", flags=re.I | re.S)
    return [m.group(1)] if m else []


class _HTMLTables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.cur = None
        self.row = -1
        self.cell = None
        self.occupied = set()

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attrs = dict(attrs)
        if tag == "table":
            self.cur = []
            self.row = -1
            self.occupied = set()
            self.tables.append(self.cur)
        elif tag == "tr" and self.cur is not None:
            self.row += 1
        elif tag in {"td", "th"} and self.cur is not None:
            if self.row < 0:
                self.row = 0
            rs = int(attrs.get("rowspan") or 1)
            cs = int(attrs.get("colspan") or 1)
            c = 0
            while (self.row, c) in self.occupied:
                c += 1
            for rr in range(self.row, self.row + rs):
                for cc in range(c, c + cs):
                    self.occupied.add((rr, cc))
            self.cell = {"r": self.row, "c": c, "rowSpan": rs, "colSpan": cs, "text": "", "header": tag == "th"}
            self.cur.append(self.cell)
        elif tag == "br" and self.cell is not None:
            self.cell["text"] += " "

    def handle_endtag(self, tag):
        if tag.lower() in {"td", "th"}:
            if self.cell is not None:
                self.cell["text"] = _clean(self.cell["text"])
            self.cell = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"] += data


def parse_html_tables(raw):
    parser = _HTMLTables()
    parser.feed(raw or "")
    return [cells for cells in parser.tables if cells]


def parse_markdown_tables(raw):
    tables = []
    rows = []
    for line in (raw or "").splitlines():
        if "|" in line and re.search(r"\|.+\|", line):
            if re.match(r"^\s*\|?\s*:?-{3,}", line):
                continue
            parts = [p.strip() for p in line.strip().strip("|").split("|")]
            rows.append(parts)
        elif rows:
            tables.append(rows)
            rows = []
    if rows:
        tables.append(rows)
    out = []
    for table in tables:
        width = max(len(r) for r in table)
        cells = []
        for r, line in enumerate(table):
            for c in range(width):
                text = line[c] if c < len(line) else ""
                cells.append({"r": r, "c": c, "rowSpan": 1, "colSpan": 1, "text": _clean(text), "header": r == 0})
        out.append(cells)
    return out


def _collapse_repeat_rows(cells):
    """Drop a generation loop: the same row of cells copied over and over."""
    if not cells:
        return cells
    rows = {}
    for c in cells:
        rows.setdefault(c["r"], []).append(c)
    kept = []
    prev = None
    repeats = 0
    shift = 0
    mapping = {}
    for r in sorted(rows):
        sig = tuple((c["c"], c["colSpan"], c["rowSpan"], c["text"]) for c in sorted(rows[r], key=lambda c: c["c"]))
        if sig == prev:
            repeats += 1
            if repeats >= 2:
                shift += 1
                continue
        else:
            prev = sig
            repeats = 0
        mapping[r] = r - shift
        for c in rows[r]:
            kept.append({**c, "r": r - shift})
    return kept


def table_from_locs(raw):
    """DocTags <text><loc_*4>…</text> boxes, clustered into a grid. 0–500 image space."""
    pat = re.compile(r"<text>((?:<loc_\d+>)+)(.*?)</text>", re.I | re.S)
    boxes = []
    for m in pat.finditer(raw or ""):
        nums = [int(x) for x in re.findall(r"loc_(\d+)", m.group(1))]
        if len(nums) < 4:
            continue
        text = _clean(m.group(2))
        if not text:
            continue
        box = {"x0": nums[0], "y0": nums[1], "x1": nums[2], "y1": nums[3], "text": text}
        if boxes and boxes[-1]["text"] == text and abs(boxes[-1]["y0"] - box["y0"]) < 4 and abs(boxes[-1]["x0"] - box["x0"]) < 4:
            continue
        boxes.append(box)
    if len(boxes) < 2:
        return []
    boxes.sort(key=lambda b: ((b["y0"] + b["y1"]) / 2, b["x0"]))
    rows = []
    for b in boxes:
        cy = (b["y0"] + b["y1"]) / 2
        h = max(4, b["y1"] - b["y0"])
        if rows and abs(cy - rows[-1]["cy"]) <= max(8, 0.6 * h):
            rows[-1]["items"].append(b)
            rows[-1]["cy"] = sum((it["y0"] + it["y1"]) / 2 for it in rows[-1]["items"]) / len(rows[-1]["items"])
        else:
            rows.append({"cy": cy, "items": [b]})
    # Column centers from boxes that are not full-width titles.
    xs = []
    for b in boxes:
        if b["x1"] - b["x0"] < 350:
            xs.append((b["x0"] + b["x1"]) / 2)
    xs.sort()
    cols = []
    for x in xs:
        if cols and abs(x - cols[-1]) <= 18:
            cols[-1] = (cols[-1] + x) / 2
        else:
            cols.append(x)
    if not cols:
        cols = [250]
    cells = []
    for r, row in enumerate(rows):
        items = sorted(row["items"], key=lambda b: b["x0"])
        if len(items) == 1 and items[0]["x1"] - items[0]["x0"] >= 300 and len(cols) > 1:
            cells.append({"r": r, "c": 0, "rowSpan": 1, "colSpan": len(cols), "text": items[0]["text"], "header": r == 0})
            continue
        used = set()
        for b in items:
            cx = (b["x0"] + b["x1"]) / 2
            c = min(range(len(cols)), key=lambda i: abs(cols[i] - cx))
            if c in used:
                # same column: append
                for cell in cells:
                    if cell["r"] == r and cell["c"] == c:
                        cell["text"] = (cell["text"] + " " + b["text"]).strip()
                continue
            used.add(c)
            cells.append({"r": r, "c": c, "rowSpan": 1, "colSpan": 1, "text": b["text"], "header": r == 0 and c == 0})
    return cells


def clip_generation(raw):
    """Drop the dialogue a docling model appends after the document."""
    text = raw or ""
    cuts = []
    for marker in ("</doctag>", "<end_of_utterance>", "\nUser:", "\nuser:"):
        at = text.find(marker)
        if at >= 0:
            cuts.append(at if marker.startswith("<") or marker.startswith("\n") else at)
    if not cuts:
        return text
    end = min(cuts)
    if text.find("</doctag>") == end:
        end += len("</doctag>")
    return text[:end]


def tables_from_text(raw, kind):
    raw = clip_generation(raw)
    found = []
    if kind in {"doctags", "otsl", "auto"}:
        for block in otsl_blocks(raw):
            cells = _collapse_repeat_rows(parse_otsl(block))
            nonempty = [c for c in cells if c["text"]]
            if cells and (nonempty or len(cells) <= 40):
                found.append(cells[:400] if len(cells) > 400 else cells)
    if kind in {"html", "auto"} or (kind == "doctags" and not found):
        for cells in parse_html_tables(raw):
            found.append(cells)
    if not found and kind in {"html", "markdown", "auto", "doctags"}:
        found.extend(parse_markdown_tables(raw))
    # PaddleOCR-VL emits OTSL tags with no <otsl> wrapper.
    if not found and re.search(r"<(?:fcel|ecel|ched|rhed|srow)>", raw, flags=re.I):
        cells = _collapse_repeat_rows(parse_otsl(raw))
        nonempty = [c for c in cells if c["text"]]
        if cells and (nonempty or len(cells) <= 40):
            found.append(cells[:400] if len(cells) > 400 else cells)
    if not found and kind in {"doctags", "auto"}:
        loc_cells = table_from_locs(raw)
        if loc_cells:
            found.append(loc_cells)
    tables = []
    for cells in found:
        rows = max((c["r"] + c["rowSpan"] for c in cells), default=0)
        cols = max((c["c"] + c["colSpan"] for c in cells), default=0)
        tables.append({"rows": rows, "cols": cols, "cells": [{k: c[k] for k in ("r", "c", "rowSpan", "colSpan", "text", "header")} for c in cells]})
    return tables


def plain_lines(raw):
    text = clip_generation(raw)
    text = re.sub(r"<loc_\d+>", "", text)
    text = re.sub(r"<nl>", "\n", text, flags=re.I)
    text = re.sub(r"</?(doctag|otsl|fcel|ecel|lcel|ucel|xcel|ched|rhed|srow|text|caption|section_header_level_\d|section_header|page_header|page_footer|list_item|title|paragraph|footnote|formula|picture|table)[^>]*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    lines = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if line and line.lower() not in {"doctag", "assistant"}:
            lines.append(line)
    return lines

