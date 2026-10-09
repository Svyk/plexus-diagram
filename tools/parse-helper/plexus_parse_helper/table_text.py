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


def _words(text):
    return re.findall(r"[A-Za-z0-9]+", text or "")


def drop_prose_rows(cells):
    """Drop a leading or trailing row that is one long sentence, not a grid cell.

    A crop that includes the paragraph under a table makes the model emit that
    paragraph as a full-width last row. A section title ("Supercharger Speed")
    stays: it is short.
    """
    if not cells:
        return cells
    rows = {}
    for cell in cells:
        rows.setdefault(cell["r"], []).append(cell)
    ordered = sorted(rows)
    drop = set()
    edges = ordered[:1] + ordered[-1:]
    for r in edges:
        nonempty = [c for c in rows[r] if (c.get("text") or "").strip()]
        if len(nonempty) != 1:
            continue
        if len(_words(nonempty[0]["text"])) >= 16:
            drop.add(r)
    if not drop:
        return cells
    shift = 0
    mapping = {}
    for r in ordered:
        if r in drop:
            shift += 1
            continue
        mapping[r] = r - shift
    return [{**c, "r": mapping[c["r"]]} for c in cells if c["r"] not in drop]


def drop_empty_rows(cells):
    """Drop a row whose cells are all blank, and close the gap.

    A rule across a typewriter table is sometimes emitted as an empty row.
    Leaving it in shifts every row under it by one.
    """
    if not cells:
        return cells
    rows = {}
    for cell in cells:
        rows.setdefault(cell["r"], []).append(cell)
    empty = {r for r, group in rows.items() if all(not (c.get("text") or "").strip() for c in group)}
    if not empty:
        return cells
    shift = 0
    mapping = {}
    for r in sorted(rows):
        if r in empty:
            shift += 1
            continue
        mapping[r] = r - shift
    out = []
    for cell in cells:
        if cell["r"] not in mapping:
            continue
        span = cell.get("rowSpan") or 1
        dropped = sum(1 for i in range(cell["r"], cell["r"] + span) if i in empty)
        out.append({**cell, "r": mapping[cell["r"]], "rowSpan": max(1, span - dropped)})
    return out


def drop_trailing_empty_columns(cells):
    """Drop a run of empty columns on the right, and shorten spans that ran into them.

    The model often closes a row with a spare empty cell. A section title then
    spans one column too many and no longer matches the grid.
    """
    if not cells:
        return cells
    cols = max(c["c"] + (c.get("colSpan") or 1) for c in cells)
    drop_from = cols
    for col in range(cols - 1, -1, -1):
        has_text = any(
            (c.get("text") or "").strip() and c["c"] == col and (c.get("colSpan") or 1) == 1
            for c in cells
        )
        starts_wide = any(
            (c.get("text") or "").strip() and c["c"] == col and (c.get("colSpan") or 1) > 1
            for c in cells
        )
        if has_text or starts_wide:
            break
        drop_from = col
    if drop_from == cols:
        return cells
    out = []
    for cell in cells:
        if cell["c"] >= drop_from:
            continue
        span = cell.get("colSpan") or 1
        if cell["c"] + span > drop_from:
            cell = {**cell, "colSpan": drop_from - cell["c"]}
        out.append(cell)
    return out


_ZERO_DECIMAL = re.compile(r"^0(\.\d+)$")
_INTEGER_PERIOD = re.compile(r"^(\d+)\.$")


def bare_decimal_columns(cells):
    """Write a long decimal column the way these pages print it.

    A factor column prints the leading zero on the first small value only
    (`0.0142`, then `.0219`, `.928`). The model writes `0.` on every one.
    A column with only a couple of readings (`0.294` hp) is left as printed.
    """
    groups = {}
    for cell in cells:
        if (cell.get("colSpan") or 1) != 1:
            continue
        if _ZERO_DECIMAL.match((cell.get("text") or "").strip()):
            groups.setdefault(cell["c"], []).append(cell)
    for group in groups.values():
        if len(group) < 3:
            continue
        group.sort(key=lambda c: c["r"])
        for i, cell in enumerate(group):
            text = cell["text"].strip()
            match = _ZERO_DECIMAL.match(text)
            if i == 0 and text.startswith("0.0"):
                continue
            cell["text"] = match.group(1)
    return cells


def strip_leader_periods(cells):
    """`32.........` is a row of leader dots. The model keeps the first dot."""
    for cell in cells:
        match = _INTEGER_PERIOD.match((cell.get("text") or "").strip())
        if match:
            cell["text"] = match.group(1)
    return cells


def drop_table_captions(cells):
    """Drop a row that is only a 'TABLE N' caption.

    The crop includes the line above the rules. That caption is not a row of
    the grid, and leaving it in shifts every row under it.
    """
    if not cells:
        return cells
    rows = {}
    for cell in cells:
        rows.setdefault(cell["r"], []).append(cell)
    drop = set()
    for r, group in rows.items():
        nonempty = [c for c in group if (c.get("text") or "").strip()]
        if len(nonempty) != 1:
            continue
        if re.match(r"table\b", nonempty[0]["text"].strip(), re.I):
            drop.add(r)
    if not drop:
        return cells
    shift = 0
    mapping = {}
    for r in sorted(rows):
        if r in drop:
            shift += 1
            continue
        mapping[r] = r - shift
    out = []
    for cell in cells:
        if cell["r"] not in mapping:
            continue
        span = cell.get("rowSpan") or 1
        dropped = sum(1 for i in range(cell["r"], cell["r"] + span) if i in drop)
        out.append({**cell, "r": mapping[cell["r"]], "rowSpan": max(1, span - dropped)})
    return out


def plain_math(text):
    """Printed characters for the math markup PaddleOCR-VL emits.

    A barred characteristic (`2̄.6972`) and `μ` are what the page shows.
    """
    text = text or ""
    text = re.sub(r"\\overline\{(\d)\.(\d+)\}", lambda m: m.group(1) + "\u0304." + m.group(2), text)
    text = text.replace(r"\mu", "μ")
    text = text.replace(r"\log", "log")
    text = re.sub(r"\^\{?\\circ\}?", "°", text)
    text = text.replace(r"\(", "").replace(r"\)", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def tidy_cells(cells):
    cells = drop_prose_rows(cells)
    cells = drop_table_captions(cells)
    cells = drop_empty_rows(cells)
    cells = drop_trailing_empty_columns(cells)
    cells = bare_decimal_columns(cells)
    cells = strip_leader_periods(cells)
    for cell in cells:
        cell["text"] = plain_math(cell.get("text") or "")
    return cells


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
        cells = tidy_cells(cells)
        if not cells:
            continue
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

