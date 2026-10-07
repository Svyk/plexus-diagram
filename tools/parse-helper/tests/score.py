"""Score a pxd-parse/1 document against report.truth.json.

structure F1 uses (r, c, rowSpan, colSpan). cell F1 adds normalised text
(NFKC, collapsed spaces, case kept). Both numbers below are micro (pooled
cells), and `tables` has the same F1 per table.
"""

from __future__ import annotations

from collections import Counter

from plexus_parse_helper.schema import norm_text


def _f1(tp: int, fp: int, fn: int) -> float:
    if tp == 0 and fp == 0 and fn == 0:
        return 1.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def _struct_key(cell: dict) -> tuple:
    return (
        int(cell["r"]),
        int(cell["c"]),
        int(cell.get("rowSpan") or 1),
        int(cell.get("colSpan") or 1),
    )


def _cell_key(cell: dict) -> tuple:
    return _struct_key(cell) + (norm_text(cell.get("text")),)


def _counts(pred: list, gold: list) -> tuple[int, int, int, list, list]:
    pc, gc = Counter(pred), Counter(gold)
    tp = sum((pc & gc).values())
    extra = list((pc - gc).elements())
    missing = list((gc - pc).elements())
    return tp, len(extra), len(missing), missing, extra


def _tables(doc: dict) -> list[dict]:
    blocks = doc.get("blocks") or {}
    found = []
    for bid in doc.get("order") or []:
        block = blocks.get(bid) or {}
        if block.get("type") == "table":
            found.append(block)
    return found


def _headings(doc: dict) -> list[dict]:
    blocks = doc.get("blocks") or {}
    found = []
    for bid in doc.get("order") or []:
        block = blocks.get(bid) or {}
        if block.get("type") == "heading":
            found.append({"level": int(block.get("level") or 0), "text": norm_text(block.get("text"))})
    return found


def _furniture_removed(doc: dict) -> bool:
    removed = doc.get("removed") or []
    reasons = {item.get("reason") for item in removed}
    if "running-header" not in reasons or "running-footer" not in reasons:
        return False
    removed_text = {norm_text(item.get("text")) for item in removed if norm_text(item.get("text"))}
    body = set()
    for block in (doc.get("blocks") or {}).values():
        kind = block.get("type")
        if kind in {"heading", "para", "caption", "footnote", "code"}:
            text = norm_text(block.get("text"))
            if text:
                body.add(text)
        elif kind == "list":
            for item in block.get("items") or []:
                text = norm_text(item.get("text"))
                if text:
                    body.add(text)
    return not (removed_text & body)


def score_document(doc: dict, truth: dict) -> dict:
    """Return micro structure F1, micro cell F1, heading accuracy, furnitureRemoved."""
    pred_tables = _tables(doc)
    gold_tables = truth.get("tables") or []
    rows = []
    stp = sfp = sfn = 0
    ctp = cfp = cfn = 0
    for index in range(max(len(pred_tables), len(gold_tables))):
        pred = (pred_tables[index].get("cells") or []) if index < len(pred_tables) else []
        gold = (gold_tables[index].get("cells") or []) if index < len(gold_tables) else []
        tp, fp, fn, missing, extra = _counts([_struct_key(c) for c in pred], [_struct_key(c) for c in gold])
        tp2, fp2, fn2, missing2, extra2 = _counts([_cell_key(c) for c in pred], [_cell_key(c) for c in gold])
        stp += tp
        sfp += fp
        sfn += fn
        ctp += tp2
        cfp += fp2
        cfn += fn2
        rows.append({
            "index": index,
            "structureF1": round(_f1(tp, fp, fn), 4),
            "cellF1": round(_f1(tp2, fp2, fn2), 4),
            "missingCells": [list(item) for item in missing2[:8]],
            "extraCells": [list(item) for item in extra2[:8]],
            "missingStructure": [list(item) for item in missing[:8]],
        })
    headings = _headings(doc)
    gold_headings = [
        {"level": int(item["level"]), "text": norm_text(item.get("text"))}
        for item in (truth.get("headings") or [])
    ]
    matched = 0
    used: set[int] = set()
    for gold in gold_headings:
        for index, heading in enumerate(headings):
            if index in used:
                continue
            if heading == gold:
                used.add(index)
                matched += 1
                break
    accuracy = matched / len(gold_headings) if gold_headings else 1.0
    return {
        "tables": rows,
        "structureF1": round(_f1(stp, sfp, sfn), 4),
        "cellF1": round(_f1(ctp, cfp, cfn), 4),
        "headingAccuracy": round(accuracy, 4),
        "headingMatches": matched,
        "headingCount": len(gold_headings),
        "furnitureRemoved": _furniture_removed(doc),
        "tableCount": len(pred_tables),
    }
