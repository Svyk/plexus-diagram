"""DoclingDocument dict → pxd-parse/1.

Reading order is body.children. List groups become one list block.
page_header / page_footer go to removed[]. Bboxes become top-left PDF points.
Text prov is BOTTOMLEFT; table cell bboxes are often TOPLEFT. Both are read
from coord_origin.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from plexus_parse_helper import SCHEMA_ID
from plexus_parse_helper.schema import (
    column_is_numeric,
    normalize_options,
    validate_document,
)

_LABEL = {
    "section_header": "heading",
    "title": "heading",
    "text": "para",
    "paragraph": "para",
    "caption": "caption",
    "formula": "formula",
    "footnote": "footnote",
    "picture": "figure",
    "table": "table",
    "code": "code",
    "list_item": "list_item",
}

_PREFIX = {
    "heading": "b",
    "para": "b",
    "caption": "c",
    "formula": "e",
    "footnote": "n",
    "figure": "f",
    "table": "t",
    "code": "k",
    "list": "l",
}

_NUM_HEAD = re.compile(r"^\s*(\d+(?:\.\d+)*)\b")
_FOOT_MARK = re.compile(r"^\s*(\d+|[¹²³⁴⁵⁶⁷⁸⁹⁰*†‡])\s+")


def to_top_left(bbox: dict | None, page_height: float) -> list[float]:
    """Return [x0, y0, x1, y1] with origin at the top-left of the page."""
    if not bbox:
        return [0.0, 0.0, 0.0, 0.0]
    left = float(bbox.get("l") or 0)
    right = float(bbox.get("r") or 0)
    top = float(bbox.get("t") or 0)
    bottom = float(bbox.get("b") or 0)
    x0, x1 = (left, right) if left <= right else (right, left)
    origin = (bbox.get("coord_origin") or "BOTTOMLEFT").upper()
    if origin == "TOPLEFT":
        y0, y1 = (top, bottom) if top <= bottom else (bottom, top)
    else:
        pdf_top = top if top >= bottom else bottom
        pdf_bottom = bottom if top >= bottom else top
        y0 = float(page_height) - pdf_top
        y1 = float(page_height) - pdf_bottom
        if y0 > y1:
            y0, y1 = y1, y0
    return [round(x0, 3), round(y0, 3), round(x1, 3), round(y1, 3)]


def heading_level_from_text(text: str, *, is_title: bool = False) -> int:
    """Numbered 'N' → 2, 'N.M' → 3, 'N.M.K' → 4. Title is 1. Other unnumbered are 2."""
    if is_title:
        return 1
    match = _NUM_HEAD.match(text or "")
    if match:
        depth = len(match.group(1).split("."))
        return min(depth + 1, 6)
    return 2


def _page_size(doc: dict, page_no: int) -> tuple[float, float]:
    pages = doc.get("pages") or {}
    page = pages.get(str(page_no)) or pages.get(page_no) or {}
    size = page.get("size") or {}
    return float(size.get("width") or 612), float(size.get("height") or 792)


def _prov(item: dict) -> dict | None:
    prov = item.get("prov") or []
    return prov[0] if prov else None


def _resolve(doc: dict, ref: str) -> dict | None:
    if not isinstance(ref, str) or not ref.startswith("#/"):
        return None
    parts = ref[2:].split("/")
    if len(parts) != 2:
        return None
    bucket, index = parts
    try:
        return (doc.get(bucket) or [])[int(index)]
    except (IndexError, ValueError, TypeError):
        return None


def _ref_of(node: dict | str | None) -> str | None:
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        return node.get("$ref") or node.get("self_ref")
    return None


class _Ids:
    def __init__(self):
        self.n = {prefix: 0 for prefix in set(_PREFIX.values())}

    def take(self, kind: str) -> str:
        prefix = _PREFIX[kind]
        self.n[prefix] += 1
        return f"{prefix}{self.n[prefix]}"


def _union(boxes: list[list[float]]) -> list[float]:
    boxes = [b for b in boxes if b and (b[2] > b[0] or b[3] > b[1])]
    if not boxes:
        return [0.0, 0.0, 0.0, 0.0]
    return [
        round(min(b[0] for b in boxes), 3),
        round(min(b[1] for b in boxes), 3),
        round(max(b[2] for b in boxes), 3),
        round(max(b[3] for b in boxes), 3),
    ]


def _header_row_count(cells: list[dict], rows: int) -> int:
    by_row: dict[int, list[dict]] = {r: [] for r in range(rows)}
    for cell in cells:
        for rr in range(cell["r"], cell["r"] + cell["rowSpan"]):
            if rr in by_row:
                by_row[rr].append(cell)
    count = 0
    for r in range(rows):
        group = by_row[r]
        if group and all(c.get("_column_header") for c in group):
            count += 1
        else:
            break
    return count


def _header_col_count(cells: list[dict], cols: int) -> int:
    by_col: dict[int, list[dict]] = {c: [] for c in range(cols)}
    for cell in cells:
        for cc in range(cell["c"], cell["c"] + cell["colSpan"]):
            if cc in by_col:
                by_col[cc].append(cell)
    count = 0
    for c in range(cols):
        group = by_col[c]
        if group and all(c.get("_row_header") for c in group):
            count += 1
        else:
            break
    return count


def _grid_from_cells(cells: list[dict], rows: int, cols: int, outer: list[float]) -> dict:
    xs = [outer[0]]
    ys = [outer[1]]
    for c in range(cols):
        rights = [cell["bbox"][2] for cell in cells if cell["c"] == c]
        xs.append(max(rights) if rights else xs[-1])
    for r in range(rows):
        bottoms = [cell["bbox"][3] for cell in cells if cell["r"] == r]
        ys.append(max(bottoms) if bottoms else ys[-1])
    if outer[2] > xs[-1]:
        xs[-1] = outer[2]
    if outer[3] > ys[-1]:
        ys[-1] = outer[3]
    # Keep the line count even when a text box sits past the table edge.
    xs = _monotone(xs, cols + 1)
    ys = _monotone(ys, rows + 1)
    return {"xs": [round(v, 3) for v in xs], "ys": [round(v, 3) for v in ys]}


def _monotone(values: list[float], n: int) -> list[float]:
    if len(values) < n:
        values = values + [values[-1]] * (n - len(values))
    out = [values[0]]
    for value in values[1:n]:
        out.append(value if value > out[-1] else round(out[-1] + 0.01, 3))
    return out


def _apply_align(cells: list[dict], cols: int, header_rows: int) -> None:
    numeric_cols = {c for c in range(cols) if column_is_numeric(cells, c, header_rows)}
    for cell in cells:
        cell["numeric"] = is_cell_numeric(cell)
        cell["align"] = "right" if cell["c"] in numeric_cols else "left"


def is_cell_numeric(cell: dict) -> bool:
    from plexus_parse_helper.schema import is_numeric_text
    return is_numeric_text(cell.get("text"))


def _table_block(item: dict, doc: dict, ids: _Ids) -> dict:
    prov = _prov(item) or {}
    page = int(prov.get("page_no") or 1)
    _, height = _page_size(doc, page)
    outer = to_top_left(prov.get("bbox"), height)
    data = item.get("data") or {}
    rows = int(data.get("num_rows") or 0)
    cols = int(data.get("num_cols") or 0)
    cells = []
    for raw in data.get("table_cells") or []:
        r = int(raw.get("start_row_offset_idx") or 0)
        c = int(raw.get("start_col_offset_idx") or 0)
        rs = int(raw.get("row_span") or max(1, int(raw.get("end_row_offset_idx") or r + 1) - r))
        cs = int(raw.get("col_span") or max(1, int(raw.get("end_col_offset_idx") or c + 1) - c))
        cells.append({
            "r": r,
            "c": c,
            "rowSpan": rs,
            "colSpan": cs,
            "text": raw.get("text") or "",
            "bbox": to_top_left(raw.get("bbox"), height),
            "_column_header": bool(raw.get("column_header")),
            "_row_header": bool(raw.get("row_header")),
        })
    header_rows = _header_row_count(cells, rows) if rows else 0
    header_cols = _header_col_count(cells, cols) if cols else 0
    for cell in cells:
        cell["header"] = bool(cell["_column_header"] or cell["_row_header"] or cell["r"] < header_rows)
    if rows and cols:
        _apply_align(cells, cols, header_rows)
    for cell in cells:
        cell.pop("_column_header", None)
        cell.pop("_row_header", None)
    block = {
        "id": ids.take("table"),
        "type": "table",
        "page": page,
        "bbox": outer,
        "rows": rows,
        "cols": cols,
        "headerRows": header_rows,
        "headerCols": header_cols,
        "cells": cells,
        "method": "tableformer",
        "grid": _grid_from_cells(cells, rows, cols, outer) if rows and cols else {"xs": [], "ys": []},
        "confidence": 0.9,
        "engine": "docling",
        "_captions": [_ref_of(c) for c in (item.get("captions") or [])],
        "_self": item.get("self_ref"),
    }
    return block


def _list_block(group: dict, doc: dict, ids: _Ids) -> dict | None:
    items = _list_items(group, doc, 0)
    if not items:
        return None
    ordered = any(item.get("ordered") for item in items)
    boxes = [item["bbox"] for item in items]
    pages = [item["page"] for item in items]
    clean = []
    for item in items:
        clean.append({
            "text": item["text"],
            "level": item["level"],
            "marker": item["marker"],
        })
    return {
        "id": ids.take("list"),
        "type": "list",
        "ordered": ordered,
        "items": clean,
        "page": pages[0],
        "bbox": _union(boxes),
        "confidence": 0.9,
        "engine": "docling",
    }


def _list_items(group: dict, doc: dict, level: int) -> list[dict]:
    items = []
    for child in group.get("children") or []:
        ref = _ref_of(child)
        node = _resolve(doc, ref) if ref else None
        if not node:
            continue
        label = node.get("label")
        if label == "list" or (isinstance(node.get("self_ref"), str) and node["self_ref"].startswith("#/groups")):
            items.extend(_list_items(node, doc, level + 1))
            continue
        if label != "list_item":
            continue
        prov = _prov(node) or {}
        page = int(prov.get("page_no") or 1)
        _, height = _page_size(doc, page)
        enumerated = bool(node.get("enumerated"))
        marker = node.get("marker") or ""
        if not marker:
            marker = "1." if enumerated else "•"
        items.append({
            "text": node.get("text") or "",
            "level": int(node.get("level") or level),
            "marker": marker,
            "ordered": enumerated,
            "page": page,
            "bbox": to_top_left(prov.get("bbox"), height),
        })
    return items


def _text_block(item: dict, doc: dict, ids: _Ids, *, seen_title: list[bool]) -> dict | None:
    label = item.get("label")
    kind = _LABEL.get(label)
    if kind in {None, "list_item"}:
        return None
    prov = _prov(item) or {}
    page = int(prov.get("page_no") or 1)
    _, height = _page_size(doc, page)
    bbox = to_top_left(prov.get("bbox"), height)
    text = item.get("text") or ""
    if kind == "heading":
        is_title = not seen_title[0] and heading_level_from_text(text) == 2 and not _NUM_HEAD.match(text or "")
        # First unnumbered heading is the title (level 1). Later unnumbered stay level 2.
        if not seen_title[0] and not _NUM_HEAD.match(text or ""):
            is_title = True
            seen_title[0] = True
        elif not seen_title[0]:
            seen_title[0] = True
            is_title = False
        block = {
            "id": ids.take("heading"),
            "type": "heading",
            "level": heading_level_from_text(text, is_title=is_title),
            "page": page,
            "bbox": bbox,
            "text": text,
            "confidence": 0.9,
            "engine": "docling",
        }
        return block
    if kind == "formula":
        latex = text.strip()
        if latex.startswith("$$") and latex.endswith("$$"):
            latex = latex[2:-2].strip()
        return {
            "id": ids.take("formula"),
            "type": "formula",
            "page": page,
            "bbox": bbox,
            "latex": latex,
            "number": None,
            "confidence": 0.85,
            "engine": "docling",
        }
    if kind == "footnote":
        mark = ""
        match = _FOOT_MARK.match(text)
        if match:
            mark = match.group(1)
        return {
            "id": ids.take("footnote"),
            "type": "footnote",
            "page": page,
            "bbox": bbox,
            "mark": mark,
            "text": text,
            "confidence": 0.85,
            "engine": "docling",
        }
    if kind == "caption":
        return {
            "id": ids.take("caption"),
            "type": "caption",
            "page": page,
            "bbox": bbox,
            "text": text,
            "for": None,
            "confidence": 0.9,
            "engine": "docling",
            "_self": item.get("self_ref"),
        }
    return {
        "id": ids.take(kind),
        "type": kind,
        "page": page,
        "bbox": bbox,
        "text": text,
        "confidence": 0.9,
        "engine": "docling",
    }


def _removed(item: dict, doc: dict) -> dict:
    prov = _prov(item) or {}
    page = int(prov.get("page_no") or 1)
    _, height = _page_size(doc, page)
    label = item.get("label")
    if label == "page_header":
        reason = "running-header"
    elif label == "page_footer":
        reason = "running-footer"
    else:
        reason = "furniture"
    return {
        "page": page,
        "bbox": to_top_left(prov.get("bbox"), height),
        "text": item.get("text") or "",
        "reason": reason,
    }


def _link_captions(block: dict, ref_to_id: dict[str, str], blocks: dict) -> None:
    target = None
    for ref in block.get("_captions") or []:
        if ref and ref in ref_to_id:
            target = ref_to_id[ref]
            break
    if target:
        block["caption"] = target
        cap = blocks.get(target)
        if cap is not None:
            cap["for"] = block["id"]
    block.pop("_captions", None)
    block.pop("_self", None)


def convert_docling(
    doc: dict,
    *,
    sha256: str = "",
    options: dict | None = None,
    engine_version: str = "docling-2.91.0",
    created_at: str | None = None,
) -> dict:
    opts = normalize_options(options)
    stored = {k: opts[k] for k in ("ocr", "formula", "tables")}
    ids = _Ids()
    blocks: dict[str, dict] = {}
    order: list[str] = []
    removed: list[dict] = []
    seen: set[str] = set()
    seen_title = [False]
    ref_to_id: dict[str, str] = {}

    def emit_ref(ref: str | None) -> None:
        if not ref or ref in seen:
            return
        node = _resolve(doc, ref)
        if node is None:
            return
        seen.add(ref)
        label = node.get("label")
        layer = node.get("content_layer")
        if label in {"page_header", "page_footer"} or layer == "furniture":
            removed.append(_removed(node, doc))
            return
        if ref.startswith("#/groups") or label == "list":
            block = _list_block(node, doc, ids)
            if block:
                blocks[block["id"]] = block
                order.append(block["id"])
            return
        if label == "table" or ref.startswith("#/tables"):
            block = _table_block(node, doc, ids)
            blocks[block["id"]] = block
            order.append(block["id"])
            ref_to_id[ref] = block["id"]
            for cap in node.get("captions") or []:
                emit_ref(_ref_of(cap))
            return
        if label == "picture" or ref.startswith("#/pictures"):
            prov = _prov(node) or {}
            page = int(prov.get("page_no") or 1)
            _, height = _page_size(doc, page)
            block = {
                "id": ids.take("figure"),
                "type": "figure",
                "page": page,
                "bbox": to_top_left(prov.get("bbox"), height),
                "caption": None,
                "image": {"kind": "crop"},
                "confidence": 0.85,
                "engine": "docling",
                "_captions": [_ref_of(c) for c in (node.get("captions") or [])],
            }
            blocks[block["id"]] = block
            order.append(block["id"])
            ref_to_id[ref] = block["id"]
            for cap in node.get("captions") or []:
                emit_ref(_ref_of(cap))
            return
        block = _text_block(node, doc, ids, seen_title=seen_title)
        if block is None:
            return
        blocks[block["id"]] = block
        order.append(block["id"])
        if node.get("self_ref"):
            ref_to_id[node["self_ref"]] = block["id"]

    body = doc.get("body") or {}
    for child in body.get("children") or []:
        emit_ref(_ref_of(child))
    # Furniture that never appeared in the body walk.
    for item in doc.get("texts") or []:
        ref = item.get("self_ref")
        if item.get("label") in {"page_header", "page_footer"} and ref not in seen:
            removed.append(_removed(item, doc))
            if ref:
                seen.add(ref)

    for block in list(blocks.values()):
        if block["type"] in {"table", "figure"}:
            _link_captions(block, ref_to_id, blocks)
    for block in blocks.values():
        block.pop("_self", None)
        block.pop("_captions", None)

    pages_out = []
    raw_pages = doc.get("pages") or {}
    keys = sorted(raw_pages.keys(), key=lambda k: int(k))
    for key in keys:
        page = raw_pages[key]
        size = page.get("size") or {}
        pages_out.append({
            "n": int(page.get("page_no") or key),
            "w": float(size.get("width") or 612),
            "h": float(size.get("height") or 792),
            "rotation": 0,
            "kind": "text",
            "parsed": True,
        })

    title = None
    for bid in order:
        block = blocks[bid]
        if block.get("type") == "heading" and block.get("level") == 1:
            title = block.get("text")
            break

    out = {
        "schema": SCHEMA_ID,
        "sha256": sha256,
        "engine": "docling",
        "engineVersion": engine_version,
        "options": stored,
        "createdAt": created_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pageCount": len(pages_out),
        "title": title,
        "pages": pages_out,
        "order": order,
        "blocks": blocks,
        "removed": removed,
        "stats": {"ms": 0, "perPage": []},
    }
    errors = validate_document(out)
    if errors:
        out["stats"]["validation"] = errors
    return out


def merge_docling(parts: list[dict]) -> dict:
    """Concatenate chunked Docling documents, rebasing $ref indices."""
    if not parts:
        return {}
    if len(parts) == 1:
        return parts[0]
    merged = {
        "schema_name": parts[0].get("schema_name"),
        "version": parts[0].get("version"),
        "name": parts[0].get("name"),
        "origin": parts[0].get("origin"),
        "furniture": {"self_ref": "#/furniture", "children": [], "content_layer": "furniture", "name": "furniture", "label": "unspecified"},
        "body": {"self_ref": "#/body", "children": [], "content_layer": "body", "name": "body", "label": "unspecified"},
        "groups": [],
        "texts": [],
        "pictures": [],
        "tables": [],
        "pages": {},
    }
    offsets = {"texts": 0, "tables": 0, "pictures": 0, "groups": 0}

    def shift_ref(ref: str) -> str:
        match = re.fullmatch(r"#/(texts|tables|pictures|groups)/(\d+)", ref or "")
        if not match:
            return ref
        bucket, index = match.group(1), int(match.group(2))
        return f"#/{bucket}/{index + offsets[bucket]}"

    def rewrite(value):
        if isinstance(value, dict):
            if set(value.keys()) == {"$ref"}:
                return {"$ref": shift_ref(value["$ref"])}
            out = {}
            for key, item in value.items():
                if key in {"self_ref", "$ref"} and isinstance(item, str):
                    out[key] = shift_ref(item)
                else:
                    out[key] = rewrite(item)
            return out
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        return value

    for part in parts:
        rewritten = rewrite(part)
        for bucket in ("texts", "tables", "pictures", "groups"):
            merged[bucket].extend(rewritten.get(bucket) or [])
        body_children = (rewritten.get("body") or {}).get("children") or []
        merged["body"]["children"].extend(body_children)
        for key, page in (rewritten.get("pages") or {}).items():
            merged["pages"][str(key)] = page
        for bucket in offsets:
            offsets[bucket] += len(part.get(bucket) or [])
    return merged
