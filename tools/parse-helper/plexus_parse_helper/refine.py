"""Better-than-Docling pass.

On a born-digital page, replace each block and each table cell with the PDF's
own characters inside the bbox (cells use the geometric column/row, expanded
1 pt). Collapse whitespace, join wrapped codes such as "Z1-" / "014", and
mark superscripts and subscripts. On a scan page, OCR an empty or very short
table cell from a 3x crop.
"""

from __future__ import annotations

import re
import statistics
from pathlib import Path

from plexus_parse_helper.convert import _apply_align, heading_level_from_text
from plexus_parse_helper.schema import norm_text

_SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹"
_SUB = "₀₁₂₃₄₅₆₇₈₉"
_CODE_HYPHEN = re.compile(r"\b([A-Z]\d*)-\s+(\d+)\b")
_UNIT_PAREN = re.compile(r"([A-Za-z])\(([A-Za-z]{1,8}/[A-Za-z0-9]+)\)")
_NUM_HEAD = re.compile(r"^\s*(\d+(?:\.\d+)*)\b")


def repair_text(text: str) -> str:
    """Collapse whitespace, restore 'm (CFU/g)', join 'Z1- 014'."""
    text = (text or "").replace("\u00a0", " ")
    text = _UNIT_PAREN.sub(r"\1 (\2)", text)
    text = _CODE_HYPHEN.sub(r"\1-\2", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _script_char(ch: str, super_: bool) -> str:
    if ch.isdigit():
        return (_SUP if super_ else _SUB)[int(ch)]
    if super_:
        return ch
    return "_" + ch


def _is_upper_code(token: str) -> bool:
    return bool(re.fullmatch(r"[A-Z]\d*-", token))


def join_lines(lines: list[str]) -> str:
    """Join visual lines. A trailing hyphen drops for a lowercase word, and stays
    glued (no space) for a code token such as Z1-."""
    out = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if not out:
            out = line
            continue
        if out.endswith("-") and line[0].isalnum():
            token = out.split()[-1]
            joined_word = token[:-1] + re.split(r"\s", line, maxsplit=1)[0]
            if any(ch.isdigit() for ch in token) or _is_upper_code(token):
                out = out + line
            elif joined_word.isalpha() and joined_word.islower():
                out = out[:-1] + line
            else:
                out = out + line
        else:
            out = out + " " + line
    return repair_text(out)


def _median(values: list[float], default: float = 10.0) -> float:
    vals = [v for v in values if v > 0]
    if not vals:
        return default
    return float(statistics.median(vals))


def cluster_lines(chars: list[dict]) -> list[dict]:
    """Group chars into lines. A raised or lowered glyph attaches to the line
    beside it instead of becoming its own line."""
    usable = [c for c in chars if c.get("ch") not in {"\r", "\n"}]
    if not usable:
        return []
    med = _median([c.get("h") or 0 for c in usable if str(c.get("ch") or "").strip()])
    usable.sort(key=lambda c: (-float(c["baseline"]), float(c["x"])))
    lines: list[dict] = []
    for char in usable:
        baseline = float(char["baseline"])
        height = float(char.get("h") or 0)
        placed = False
        if lines:
            line = lines[-1]
            if abs(baseline - line["baseline"]) <= 0.4 * med:
                line["chars"].append(char)
                placed = True
            else:
                xs = [float(c["x"]) for c in line["chars"]]
                rights = [float(c.get("right") or c["x"]) for c in line["chars"]]
                near = (min(xs) - 2 * med) <= float(char["x"]) <= (max(rights) + 2 * med)
                shifted = abs(baseline - line["baseline"]) <= 0.95 * med
                small = height <= 0.9 * med or height == 0
                if near and shifted and (small or abs(baseline - line["baseline"]) >= 0.2 * med):
                    line["chars"].append(char)
                    placed = True
        if not placed:
            lines.append({"baseline": baseline, "chars": [char]})
    # A script that was seen first (higher baseline) should fold into the body line under it.
    folded: list[dict] = []
    for line in lines:
        if folded:
            prev = folded[-1]
            prev_h = _median([float(c.get("h") or 0) for c in prev["chars"]])
            line_h = _median([float(c.get("h") or 0) for c in line["chars"]])
            gap = prev["baseline"] - line["baseline"]
            xs = [float(c["x"]) for c in line["chars"]]
            prev_xs = [float(c["x"]) for c in prev["chars"]]
            prev_r = [float(c.get("right") or c["x"]) for c in prev["chars"]]
            near = (min(prev_xs) - 2 * med) <= min(xs) <= (max(prev_r) + 2 * med)
            if near and 0 < gap <= 0.95 * max(prev_h, line_h, med) and line_h <= 0.95 * prev_h:
                prev["chars"].extend(line["chars"])
                continue
        folded.append(line)
    return folded


def _render_line(chars: list[dict]) -> tuple[str, list[dict]]:
    chars = sorted(chars, key=lambda c: float(c["x"]))
    heights = [float(c.get("h") or 0) for c in chars if str(c.get("ch") or "").strip() and float(c.get("h") or 0) > 0]
    med = _median(heights)
    body = [c for c in chars if str(c.get("ch") or "").strip() and float(c.get("h") or 0) >= 0.8 * med]
    body_base = _median([float(c["baseline"]) for c in body]) if body else _median([float(c["baseline"]) for c in chars])
    parts: list[str] = []
    notes: list[dict] = []
    prev = None
    for char in chars:
        ch = str(char.get("ch") or "")
        if ch in {"\r", "\n"}:
            continue
        height = float(char.get("h") or 0)
        baseline = float(char["baseline"])
        shift = baseline - body_base
        super_ = shift >= 0.22 * med and (height <= 0.8 * med or (ch.isdigit() and height <= 1.25 * med))
        sub_ = shift <= -0.18 * med and height <= 0.92 * med and height > 0
        if prev is not None and ch not in {" ", "\t"} and prev["ch"] not in {" ", "\t"}:
            gap = float(char["x"]) - float(prev.get("right") or prev["x"])
            # Kerning gaps in this font are ~0.2× the size. A real word space is ~0.6×.
            if gap > 0.5 * med and (not parts or not parts[-1].endswith(" ")):
                parts.append(" ")
        if (super_ or sub_) and ch.isalnum():
            rendered = _script_char(ch, super_)
            if super_ and ch.isdigit():
                prev_text = "".join(parts)
                unit = bool(re.search(r"(?:^|[^A-Za-z])[A-Za-z]{1,3}$", prev_text))
                if not unit:
                    notes.append({"mark": ch, "at": len(prev_text)})
            parts.append(rendered)
        else:
            parts.append(ch)
        prev = char
    return "".join(parts), notes


def assemble_text(chars: list[dict]) -> dict:
    """Turn a synthetic or extracted char list into text.

    Each char is {ch, x, right, baseline, h}. baseline grows upward.
    A digit at <= 0.75× the line size and a raised baseline becomes a
    superscript (unicode for a short unit such as cm², otherwise a footnote
    mark). A lowered letter becomes w_z style text.
    """
    lines = cluster_lines(chars)
    rendered = []
    notes: list[dict] = []
    sizes = []
    for line in lines:
        text, line_notes = _render_line(line["chars"])
        if text.strip():
            for note in line_notes:
                note["at"] = note["at"] + sum(len(piece) + 1 for piece in rendered)
            notes.extend(line_notes)
            rendered.append(text.strip())
        for char in line["chars"]:
            if str(char.get("ch") or "").strip() and float(char.get("h") or 0) > 0:
                sizes.append(float(char["h"]))
    text = join_lines(rendered)
    # Footnote indexes were counted before the final join/repair. Re-find marks.
    notes = _notes_from_text(text, notes)
    return {"text": text, "footnoteRefs": notes, "fontSize": round(_median(sizes, 0), 2) if sizes else 0}


def _notes_from_text(text: str, preliminary: list[dict]) -> list[dict]:
    """Keep footnote marks that survived as unicode superscripts, not unit exponents."""
    if not preliminary:
        return []
    found = []
    for match in re.finditer(r"[⁰¹²³⁴⁵⁶⁷⁸⁹]+", text):
        before = text[: match.start()]
        if re.search(r"(?:^|[^A-Za-z])[A-Za-z]{1,3}$", before):
            continue
        mark = "".join(str(_SUP.index(ch)) for ch in match.group(0))
        found.append({"mark": mark, "at": match.start()})
    return found


def heading_level(text: str, font_size: float | None, *, title_size: float | None) -> int:
    """'N' → 2, 'N.M' → 3, 'N.M.K' → 4. The largest font on page 1 is the title."""
    if font_size and title_size and font_size >= title_size * 0.92 and not _NUM_HEAD.match(text or ""):
        return 1
    return heading_level_from_text(text or "", is_title=False)


def _page_count_chars(pdf) -> dict[int, list[dict]]:
    import pypdfium2 as pdfium  # local: the brew env has it
    del pdfium
    out: dict[int, list[dict]] = {}
    for index in range(len(pdf)):
        page = pdf[index]
        width, height = page.get_size()
        textpage = page.get_textpage()
        chars = []
        try:
            n = textpage.count_chars()
            for i in range(n):
                ch = textpage.get_text_range(i, 1)
                left, bottom, right, top = textpage.get_charbox(i)
                chars.append({
                    "ch": ch,
                    "x": float(left),
                    "right": float(right),
                    "baseline": float(bottom),
                    "top": float(top),
                    "h": max(0.0, float(top) - float(bottom)),
                    "page_h": float(height),
                    "page_w": float(width),
                })
        finally:
            textpage.close()
        out[index + 1] = chars
    return out


def _choose_text(docling: str, assembled: str) -> str:
    """Keep Docling when the PDF pass splits a word. Take the PDF pass when it
    only fixes spacing or restores a clipped tail such as 'Product' → 'Product stage'."""
    d = norm_text(docling)
    a = norm_text(assembled)
    if not a:
        return d
    if not d:
        return a
    letters_d = re.sub(r"\s+", "", d)
    letters_a = re.sub(r"\s+", "", a)
    if letters_d == letters_a:
        return a
    # A clipped tail ("Product" → "Product stage") adds one word of at least 3 letters.
    # "Zone" → "Zone S" is the next column's first letter, so it stays Docling's text.
    extra = a[len(d):].strip()
    if (
        a.startswith(d)
        and len(re.sub(r"\s+", "", d)) >= 4
        and extra
        and len(extra) >= 3
        and " " not in extra
    ):
        return a
    return d


def _chars_in_pdf_rect(chars: list[dict], rect: tuple[float, float, float, float], pad: float = 1.0) -> list[dict]:
    """rect is (left, bottom, right, top) in PDF coordinates, y upward."""
    left, bottom, right, top = rect
    left -= pad
    bottom -= pad
    right += pad
    top += pad
    picked = []
    for char in chars:
        if char.get("ch") in {"\r", "\n"}:
            continue
        cx = (float(char["x"]) + float(char.get("right") or char["x"])) / 2
        cy = (float(char["baseline"]) + float(char.get("top") or char["baseline"])) / 2
        if left <= cx <= right and bottom <= cy <= top:
            picked.append(char)
    return picked


def _tl_to_pdf(bbox: list[float], page_h: float) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = bbox
    return (min(x0, x1), page_h - max(y0, y1), max(x0, x1), page_h - min(y0, y1))


def _median_width(cells: list[dict]) -> float:
    widths = []
    for cell in cells:
        if cell.get("colSpan", 1) != 1:
            continue
        box = cell.get("bbox") or [0, 0, 0, 0]
        widths.append(abs(box[2] - box[0]))
    return _median(widths, 20)


def geometric_edges(table: dict) -> tuple[list[float], list[float]]:
    """Column and row boundaries from span-1 text boxes, ignoring a box that
    swallowed several columns. Outer edges are the table bbox."""
    rows = int(table["rows"])
    cols = int(table["cols"])
    outer = table.get("bbox") or [0, 0, 0, 0]
    cells = table.get("cells") or []
    typical = _median_width(cells)
    lefts = [[] for _ in range(cols)]
    rights = [[] for _ in range(cols)]
    tops = [[] for _ in range(rows)]
    bottoms = [[] for _ in range(rows)]
    for cell in cells:
        box = cell.get("bbox") or [0, 0, 0, 0]
        width = abs(box[2] - box[0])
        height = abs(box[3] - box[1])
        if cell.get("colSpan", 1) == 1 and width <= max(2.5 * typical, typical + 8):
            lefts[cell["c"]].append(box[0])
            rights[cell["c"]].append(box[2])
        if cell.get("rowSpan", 1) == 1 and height <= max(3 * _median([abs(c["bbox"][3] - c["bbox"][1]) for c in cells if c.get("bbox")], 12), 28):
            tops[cell["r"]].append(box[1])
            bottoms[cell["r"]].append(box[3])
    xs = [float(outer[0])]
    for c in range(1, cols):
        prev = max(rights[c - 1]) if rights[c - 1] else None
        nxt = min(lefts[c]) if lefts[c] else None
        if prev is not None and nxt is not None and nxt > prev:
            xs.append((prev + nxt) / 2)
        elif nxt is not None:
            xs.append(nxt)
        elif prev is not None:
            xs.append(prev)
        else:
            xs.append(xs[-1] + 1)
    xs.append(float(outer[2]))
    ys = [float(outer[1])]
    for r in range(1, rows):
        prev = max(bottoms[r - 1]) if bottoms[r - 1] else None
        nxt = min(tops[r]) if tops[r] else None
        if prev is not None and nxt is not None and nxt > prev:
            ys.append((prev + nxt) / 2)
        elif nxt is not None:
            ys.append(nxt)
        elif prev is not None:
            ys.append(prev)
        else:
            ys.append(ys[-1] + 1)
    ys.append(float(outer[3]))
    xs = _spread(xs)
    ys = _spread(ys)
    return xs, ys


def _spread(values: list[float]) -> list[float]:
    out = [values[0]]
    for value in values[1:]:
        out.append(value if value > out[-1] + 0.4 else out[-1] + 0.4)
    return [round(v, 3) for v in out]


def _fill_holes(table: dict, xs: list[float], ys: list[float]) -> None:
    rows = int(table["rows"])
    cols = int(table["cols"])
    covered = [[False] * cols for _ in range(rows)]
    for cell in table["cells"]:
        for rr in range(cell["r"], min(rows, cell["r"] + cell["rowSpan"])):
            for cc in range(cell["c"], min(cols, cell["c"] + cell["colSpan"])):
                covered[rr][cc] = True
    header_rows = int(table.get("headerRows") or 0)
    for r in range(rows):
        for c in range(cols):
            if covered[r][c]:
                continue
            table["cells"].append({
                "r": r,
                "c": c,
                "rowSpan": 1,
                "colSpan": 1,
                "text": "",
                "header": r < header_rows,
                "bbox": [xs[c], ys[r], xs[c + 1], ys[r + 1]],
                "align": "left",
                "numeric": False,
                "_filled": True,
            })
    table["cells"].sort(key=lambda cell: (cell["r"], cell["c"]))


def _assign_geometric(table: dict, xs: list[float], ys: list[float]) -> None:
    for cell in table["cells"]:
        r, c = cell["r"], cell["c"]
        rs, cs = cell["rowSpan"], cell["colSpan"]
        if r + rs < len(ys) and c + cs < len(xs):
            cell["bbox"] = [xs[c], ys[r], xs[c + cs], ys[r + rs]]
    table["grid"] = {"xs": xs, "ys": ys}


def _ocr_crop(page, bbox_tl: list[float], scale: float = 3.0) -> str:
    try:
        from ocrmac import ocrmac as ocrmac_mod
    except Exception:
        return ""
    bitmap = page.render(scale=scale)
    image = bitmap.to_pil()
    width, height = page.get_size()
    x0 = max(0, int(bbox_tl[0] * scale))
    y0 = max(0, int(bbox_tl[1] * scale))
    x1 = min(image.width, int(bbox_tl[2] * scale))
    y1 = min(image.height, int(bbox_tl[3] * scale))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return ""
    crop = image.crop((x0, y0, x1, y1))
    try:
        tokens = ocrmac_mod.OCR(crop, language_preference=["en-US"], recognition_level="accurate").recognize()
    except Exception:
        return ""
    texts = []
    for item in tokens or []:
        if isinstance(item, (list, tuple)) and item:
            texts.append(str(item[0]))
        elif isinstance(item, str):
            texts.append(item)
    return repair_text(" ".join(texts))


def _very_short(text: str) -> bool:
    return len(norm_text(text)) <= 1


def _merge_ocr(current: str, ocr_text: str) -> str:
    """Accept a cell crop only when it does not swallow the next column.

    A one-digit Docling cell stays "1" if Vision reads "1 Blender". An empty
    hole whose crop starts with a bare number keeps that number. A crop that
    is a short slice of a longer Docling string is discarded.
    """
    o = repair_text(ocr_text)
    c = norm_text(current)
    if not o:
        return current
    if not c:
        parts = o.split()
        if len(parts) >= 2 and re.fullmatch(r"\d+", parts[0]):
            return parts[0]
        return o
    if len(o) + 1 < len(c):
        return current
    if c.isdigit() and o.split()[0] == c:
        return c
    if norm_text(o) == c or (norm_text(o).startswith(c) and len(norm_text(o)) <= len(c) + 1):
        return o
    if re.sub(r"\s+", "", c) == re.sub(r"\s+", "", norm_text(o)):
        return o
    return current


def refine_document(doc: dict, pdf_path: str | Path, *, ocr: bool = True) -> dict:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        by_page = _page_count_chars(pdf)
        for page in doc.get("pages") or []:
            chars = by_page.get(int(page["n"])) or []
            real = [c for c in chars if str(c.get("ch") or "").strip()]
            page["kind"] = "text" if len(real) >= 20 else "scan"
        title_size = _title_size(doc, by_page)
        for bid in doc.get("order") or []:
            block = doc["blocks"][bid]
            page_no = int(block.get("page") or 1)
            chars = by_page.get(page_no) or []
            kind = _page_kind(doc, page_no)
            if block.get("type") == "table":
                _refine_table(block, chars, pdf, page_no, kind, ocr=ocr)
            elif block.get("type") in {"para", "heading", "caption", "footnote", "code", "list"}:
                _refine_text_block(block, chars, title_size, kind)
        _link_footnote_refs(doc)
    finally:
        pdf.close()
    return doc


def _page_kind(doc: dict, page_no: int) -> str:
    for page in doc.get("pages") or []:
        if int(page["n"]) == page_no:
            return page.get("kind") or "text"
    return "text"


def _title_size(doc: dict, by_page: dict[int, list[dict]]) -> float | None:
    sizes = []
    for block in (doc.get("blocks") or {}).values():
        if block.get("type") != "heading" or int(block.get("page") or 0) != 1:
            continue
        chars = _block_chars(block, by_page.get(1) or [])
        assembled = assemble_text(chars) if chars else None
        if assembled and assembled["fontSize"]:
            sizes.append(assembled["fontSize"])
    return max(sizes) if sizes else None


def _block_chars(block: dict, chars: list[dict]) -> list[dict]:
    if not chars or not block.get("bbox"):
        return []
    page_h = float(chars[0].get("page_h") or 792)
    rect = _tl_to_pdf(block["bbox"], page_h)
    return _chars_in_pdf_rect(chars, rect, pad=1.0)


def _refine_text_block(block: dict, chars: list[dict], title_size: float | None, kind: str) -> None:
    if block.get("type") == "list":
        return
    if kind == "scan":
        if block.get("text"):
            block["text"] = repair_text(block["text"])
        return
    picked = _block_chars(block, chars)
    if not any(str(c.get("ch") or "").strip() for c in picked):
        if block.get("text"):
            block["text"] = repair_text(block["text"])
        return
    assembled = assemble_text(picked)
    chosen = _choose_text(block.get("text") or "", assembled["text"])
    if chosen:
        block["text"] = chosen
        if assembled["footnoteRefs"] and block.get("type") == "para" and chosen == norm_text(assembled["text"]):
            block["footnoteRefs"] = [
                {"mark": note["mark"], "at": note["at"], "to": None} for note in assembled["footnoteRefs"]
            ]
        if assembled["fontSize"]:
            block.setdefault("spans", [{
                "text": block["text"],
                "bold": False,
                "italic": False,
                "size": assembled["fontSize"],
                "font": "",
            }])
    if block.get("type") == "heading":
        block["level"] = heading_level(block.get("text") or "", assembled.get("fontSize"), title_size=title_size)


def _refine_table(table: dict, chars: list[dict], pdf, page_no: int, kind: str, *, ocr: bool) -> None:
    if not table.get("rows") or not table.get("cols"):
        return
    for cell in table["cells"]:
        box = cell.get("bbox") or [0, 0, 0, 0]
        cell["_text_w"] = abs(box[2] - box[0])
    xs, ys = geometric_edges(table)
    _assign_geometric(table, xs, ys)
    _fill_holes(table, xs, ys)
    page_h = _page_height(pdf, page_no)
    page = pdf[page_no - 1]
    owned = _own_chars(table["cells"], chars, page_h) if kind != "scan" else {}
    for index, cell in enumerate(table["cells"]):
        text = cell.get("text") or ""
        if kind != "scan":
            picked = owned.get(index) or []
            if any(str(c.get("ch") or "").strip() for c in picked):
                assembled = assemble_text(picked)
                if assembled["text"]:
                    text = _choose_text(text, assembled["text"])
        text = repair_text(text)
        geo_w = abs(cell["bbox"][2] - cell["bbox"][0])
        wide = float(cell.get("_text_w") or 0) > max(1.8 * geo_w, geo_w + 24)
        if ocr and kind == "scan" and (_very_short(text) or cell.get("_filled") or wide or not text):
            ocr_text = _ocr_crop(page, cell["bbox"])
            if ocr_text:
                text = _merge_ocr(text, ocr_text)
        cell["text"] = text
        cell.pop("_filled", None)
        cell.pop("_text_w", None)
    _apply_align(table["cells"], int(table["cols"]), int(table.get("headerRows") or 0))


def _own_chars(cells: list[dict], chars: list[dict], page_h: float) -> dict[int, list[dict]]:
    """Each character lands in one cell. The 1 pt slack applies only in the gap
    between cells, so a neighbour's first letter is not copied into a span."""
    rects = [_tl_to_pdf(cell.get("bbox") or [0, 0, 0, 0], page_h) for cell in cells]
    owned: dict[int, list[dict]] = {i: [] for i in range(len(cells))}

    def center(char):
        left = float(char["x"])
        right = float(char.get("right") or left)
        height = float(char.get("h") or 0)
        return (left + right) / 2, float(char["baseline"]) + height / 2

    def contains(rect, x, y, pad):
        left, bottom, right, top = rect
        return left - pad <= x <= right + pad and bottom - pad <= y <= top + pad

    for char in chars:
        if str(char.get("ch") or "") in {"\r", "\n"}:
            continue
        x, y = center(char)
        hits = [i for i, rect in enumerate(rects) if contains(rect, x, y, 0)]
        if not hits:
            hits = [i for i, rect in enumerate(rects) if contains(rect, x, y, 1)]
        if not hits:
            continue
        if len(hits) == 1:
            owned[hits[0]].append(char)
            continue
        def rank(i):
            left, bottom, right, top = rects[i]
            cx = (left + right) / 2
            cy = (bottom + top) / 2
            return (x - cx) ** 2 + (y - cy) ** 2
        owned[min(hits, key=rank)].append(char)
    return owned


def _page_height(pdf, page_no: int) -> float:
    _w, h = pdf[page_no - 1].get_size()
    return float(h)


def _link_footnote_refs(doc: dict) -> None:
    by_mark: dict[str, str] = {}
    for block in (doc.get("blocks") or {}).values():
        if block.get("type") == "footnote" and block.get("mark"):
            by_mark[str(block["mark"])] = block["id"]
    for block in (doc.get("blocks") or {}).values():
        for note in block.get("footnoteRefs") or []:
            note["to"] = by_mark.get(str(note.get("mark")))
