"""pxd-parse/1 validation and the options hash other units must reproduce."""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata

from plexus_parse_helper import SCHEMA_ID

# Cache key: defaults filled, `scope` dropped, keys sorted, no whitespace.
# SHA-256 hex of that JSON. `pages` is kept in the order the client sent.
DEFAULT_OPTIONS = {
    "ocr": "auto",
    "formula": False,
    "tables": "accurate",
    "pictures": True,
}


def normalize_options(raw: dict | None) -> dict:
    raw = raw or {}
    opts = {
        "ocr": raw.get("ocr") or DEFAULT_OPTIONS["ocr"],
        "formula": bool(raw.get("formula", False)),
        "tables": raw.get("tables") or DEFAULT_OPTIONS["tables"],
        "pictures": DEFAULT_OPTIONS["pictures"] if "pictures" not in raw else bool(raw.get("pictures")),
    }
    if raw.get("pages"):
        opts["pages"] = raw["pages"]
    if raw.get("scope"):
        opts["scope"] = raw["scope"]
    return opts


def canonical_options(opts: dict | None) -> dict:
    """The object that is hashed. `scope` is never part of it."""
    norm = normalize_options(opts)
    body = {
        "formula": bool(norm["formula"]),
        "ocr": norm["ocr"],
        "pictures": bool(norm["pictures"]),
        "tables": norm["tables"],
    }
    if "pages" in norm:
        body["pages"] = norm["pages"]
    return body


def options_hash(opts: dict | None) -> str:
    blob = json.dumps(canonical_options(opts), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def norm_text(value: str | None) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = text.replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


_FOOT_TAIL = re.compile(r"\[[A-Za-z0-9]+\]$")


def is_numeric_text(value: str | None) -> bool:
    """§4.2: strip %, ±, thousands separators, (negatives), trailing [a] marks."""
    s = norm_text(value)
    if not s:
        return False
    s = _FOOT_TAIL.sub("", s).strip()
    s = s.replace("%", "").replace("±", "").replace(",", "").replace(" ", "")
    wrapped = re.fullmatch(r"\(([^()]*)\)", s)
    if wrapped:
        s = "-" + wrapped.group(1)
    if s in {"", "-", ".", "-.", "+"}:
        return False
    try:
        return math.isfinite(float(s))
    except ValueError:
        return False


def column_is_numeric(cells: list[dict], col: int, header_rows: int) -> bool:
    body = []
    for cell in cells:
        if cell["c"] != col or cell.get("colSpan", 1) != 1:
            continue
        if cell["r"] < header_rows or cell.get("header"):
            continue
        text = norm_text(cell.get("text"))
        if not text:
            continue
        body.append(text)
    if not body:
        return False
    hits = sum(1 for text in body if is_numeric_text(text))
    return hits / len(body) >= 0.8


def validate_table(table: dict) -> list[str]:
    errors = []
    rows = int(table.get("rows") or 0)
    cols = int(table.get("cols") or 0)
    if rows < 1 or cols < 1:
        return ["table has no grid"]
    covered: set[tuple[int, int]] = set()
    for cell in table.get("cells") or []:
        r = int(cell.get("r", -1))
        c = int(cell.get("c", -1))
        rs = int(cell.get("rowSpan") or 1)
        cs = int(cell.get("colSpan") or 1)
        if rs < 1 or cs < 1 or r < 0 or c < 0 or r + rs > rows or c + cs > cols:
            errors.append(f"cell {(r, c, rs, cs)} outside {rows}x{cols}")
            continue
        for rr in range(r, r + rs):
            for cc in range(c, c + cs):
                if (rr, cc) in covered:
                    errors.append(f"overlap at {(rr, cc)}")
                covered.add((rr, cc))
    return errors


def validate_document(doc: dict) -> list[str]:
    errors = []
    if doc.get("schema") != SCHEMA_ID:
        errors.append(f"schema {doc.get('schema')!r}")
    blocks = doc.get("blocks") or {}
    for bid in doc.get("order") or []:
        if bid not in blocks:
            errors.append(f"order id {bid} missing")
    for bid, block in blocks.items():
        if block.get("id") != bid:
            errors.append(f"block id {bid} != {block.get('id')}")
        if block.get("type") == "table":
            for err in validate_table(block):
                errors.append(f"{bid}: {err}")
    return errors
