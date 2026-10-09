#!/usr/bin/env python3
"""Table-structure models for the scan bench.

Reads the pack from table-structure.mjs (Vision words, detector boxes, LlamaParse
oracle boxes) and writes structure cells in page points. Text is not filled here:
the scorer puts Vision words into cells by centre.

Engines: slanet, tatr, docling. Regions: detector (our lattice/stream boxes) or
oracle (cached LlamaParse table boxes; the truth files have no table bbox).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import types
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "tools" / "parse-helper"
sys.path.insert(0, str(HELPER))

from plexus_parse_helper.ocr import deskew, render_page  # noqa: E402

DPI = 300
SCALE = DPI / 72.0
SLANET_URL = "https://www.modelscope.cn/models/RapidAI/RapidTable/resolve/v2.0.0/slanet-plus.onnx"
SLANET_SHA = "d57a942af6a2f57d6a4a0372573c696a2379bf5857c45e2ac69993f3b334514b"
MODEL_DIR = Path.home() / "Library" / "Caches" / "plexus-parse-helper-rs" / "models"
PAD_PT = 6.0


def sha256_file(path: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def slanet_path() -> Path:
    path = MODEL_DIR / "slanet-plus.onnx"
    if path.is_file() and sha256_file(path) == SLANET_SHA:
        return path
    src = Path("/tmp/pxd-table-models/slanet-plus.onnx")
    if src.is_file() and sha256_file(src) == SLANET_SHA:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(src.read_bytes())
        return path
    import urllib.request
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(SLANET_URL, path)
    got = sha256_file(path)
    if got != SLANET_SHA:
        path.unlink(missing_ok=True)
        raise SystemExit(f"slanet-plus sha256 {got} != {SLANET_SHA}")
    return path


def page_image(pdf: str, page: int, angle: float):
    img, _w, _h = render_page(pdf, page, DPI)
    img = deskew(img, angle or 0.0)
    gray = np.asarray(img.convert("L"))
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def crop_box(bgr, bbox, pad=PAD_PT):
    h, w = bgr.shape[:2]
    x0 = max(0, int(np.floor((bbox[0] - pad) * SCALE)))
    y0 = max(0, int(np.floor((bbox[1] - pad) * SCALE)))
    x1 = min(w, int(np.ceil((bbox[2] + pad) * SCALE)))
    y1 = min(h, int(np.ceil((bbox[3] + pad) * SCALE)))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return bgr[y0:y1, x0:x1].copy(), (x0, y0)


def rotate_bbox(bbox, w_pt, h_pt, angle):
    if not bbox or abs(angle) < 0.05:
        return bbox
    w, h = w_pt * SCALE, h_pt * SCALE
    m = cv2.getRotationMatrix2D((w / 2, h / 2), -angle, 1.0)
    pts = []
    for x, y in ((bbox[0], bbox[1]), (bbox[2], bbox[1]), (bbox[2], bbox[3]), (bbox[0], bbox[3])):
        px, py = x * SCALE, y * SCALE
        pts.append((m[0, 0] * px + m[0, 1] * py + m[0, 2], m[1, 0] * px + m[1, 1] * py + m[1, 2]))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [min(xs) / SCALE, min(ys) / SCALE, max(xs) / SCALE, max(ys) / SCALE]


def to_page(box, origin):
    ox, oy = origin
    return [
        (box[0] + ox) / SCALE,
        (box[1] + oy) / SCALE,
        (box[2] + ox) / SCALE,
        (box[3] + oy) / SCALE,
    ]


# ---------------------------------------------------------------- SLANet-plus


class SlaNet:
    def __init__(self, path: Path):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        self.session = ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])
        meta = self.session.get_modelmeta().custom_metadata_map["character"]
        chars = meta.splitlines()
        if "<td></td>" not in chars:
            chars.append("<td></td>")
        if "<td>" in chars:
            chars.remove("<td>")
        self.chars = ["sos"] + chars + ["eos"]
        if len(self.chars) != 50:
            raise SystemExit(f"SLANet vocab is {len(self.chars)}, expected 50")
        self.eos = len(self.chars) - 1
        self.td = {"<td>", "<td", "<td></td>"}
        self.mean = np.array([0.485, 0.456, 0.406], np.float32)
        self.std = np.array([0.229, 0.224, 0.225], np.float32)

    def preprocess(self, bgr):
        h, w = bgr.shape[:2]
        ratio = 488 / float(max(h, w))
        resized = cv2.resize(bgr, (max(1, int(w * ratio)), max(1, int(h * ratio))))
        norm = (resized.astype(np.float32) / 255.0 - self.mean) / self.std
        canvas = np.zeros((488, 488, 3), np.float32)
        canvas[: norm.shape[0], : norm.shape[1]] = norm
        chw = canvas.transpose(2, 0, 1)[None]
        return chw, [h, w]

    def cells(self, bgr, origin):
        chw, shape = self.preprocess(bgr)
        loc, prob = self.session.run(None, {"x": chw})
        loc = loc[0]
        idx = prob[0].argmax(axis=1)
        h, w = shape
        tokens = []
        boxes = []
        for i, char_idx in enumerate(idx.tolist()):
            if i > 0 and char_idx == self.eos:
                break
            if char_idx in (0, self.eos):
                continue
            text = self.chars[char_idx]
            if text in self.td:
                bb = loc[i].astype(np.float64).copy()
                bb[0::2] *= w
                bb[1::2] *= h
                boxes.append(bb)
            tokens.append(text)
        boxes = np.array(boxes, np.float64) if boxes else np.zeros((0, 8))
        if len(boxes):
            ratio = min(488 / h, 488 / w)
            boxes[:, 0::2] *= 488 / (w * ratio)
            boxes[:, 1::2] *= 488 / (h * ratio)
        logic = logic_points(tokens)
        cells = []
        n = min(len(logic), len(boxes))
        for (r0, r1, c0, c1), bb in zip(logic[:n], boxes[:n]):
            if np.all(bb == 0):
                continue
            xyxy = [float(bb[0::2].min()), float(bb[1::2].min()), float(bb[0::2].max()), float(bb[1::2].max())]
            if xyxy[2] - xyxy[0] < 1 or xyxy[3] - xyxy[1] < 1:
                continue
            cells.append({
                "r": r0,
                "c": c0,
                "rowSpan": r1 - r0 + 1,
                "colSpan": c1 - c0 + 1,
                "bbox": to_page(xyxy, origin),
                "header": False,
            })
        rows = max((c["r"] + c["rowSpan"] for c in cells), default=0)
        cols = max((c["c"] + c["colSpan"] for c in cells), default=0)
        header_rows = thead_rows(tokens, logic)
        for cell in cells:
            cell["header"] = cell["r"] < header_rows
        return cells, rows, cols, header_rows


def logic_points(tokens):
    points = []
    row = col = 0
    occupied = set()

    def taken(r, c):
        return (r, c) in occupied

    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token == "<tr>":
            col = 0
        elif token == "</tr>":
            row += 1
        elif token.startswith("<td"):
            colspan = rowspan = 1
            j = i
            if token != "<td></td>":
                j += 1
                while j < len(tokens) and not tokens[j].startswith(">"):
                    if "colspan=" in tokens[j]:
                        colspan = int(tokens[j].split("=")[1].strip("\"'"))
                    elif "rowspan=" in tokens[j]:
                        rowspan = int(tokens[j].split("=")[1].strip("\"'"))
                    j += 1
            i = j
            while taken(row, col):
                col += 1
            points.append([row, row + rowspan - 1, col, col + colspan - 1])
            for rr in range(row, row + rowspan):
                for cc in range(col, col + colspan):
                    occupied.add((rr, cc))
            col += colspan
        i += 1
    return points


def thead_rows(tokens, points):
    in_head = False
    td = 0
    rows = set()
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token == "<thead>":
            in_head = True
        elif token == "</thead>":
            in_head = False
        elif token.startswith("<td"):
            if in_head and td < len(points):
                rows.add(points[td][0])
            td += 1
            if token != "<td></td>":
                j = i + 1
                while j < len(tokens) and not tokens[j].startswith(">"):
                    j += 1
                i = j
        i += 1
    n = 0
    while n in rows:
        n += 1
    return n


# ---------------------------------------------------------------- Table Transformer


class Rect:
    def __init__(self, box=None):
        self.empty = box is None
        if isinstance(box, Rect):
            self.x0, self.y0, self.x1, self.y1 = box.x0, box.y0, box.x1, box.y1
            self.empty = box.empty
        elif box is None:
            self.x0 = self.y0 = self.x1 = self.y1 = 0.0
        else:
            self.x0, self.y0, self.x1, self.y1 = (float(v) for v in box)
            if self.x1 < self.x0 or self.y1 < self.y0:
                self.empty = True

    def get_area(self):
        if self.empty:
            return 0.0
        return max(0.0, self.x1 - self.x0) * max(0.0, self.y1 - self.y0)

    def intersect(self, other):
        o = other if isinstance(other, Rect) else Rect(other)
        if self.empty or o.empty:
            return Rect()
        box = Rect([max(self.x0, o.x0), max(self.y0, o.y0), min(self.x1, o.x1), min(self.y1, o.y1)])
        if box.x1 < box.x0 or box.y1 < box.y0:
            return Rect()
        return box

    def include_rect(self, other):
        o = other if isinstance(other, Rect) else Rect(other)
        if o.empty or o.get_area() <= 0:
            return self
        if self.empty:
            self.x0, self.y0, self.x1, self.y1 = o.x0, o.y0, o.x1, o.y1
            self.empty = False
            return self
        self.x0, self.y0 = min(self.x0, o.x0), min(self.y0, o.y0)
        self.x1, self.y1 = max(self.x1, o.x1), max(self.y1, o.y1)
        return self

    def __iter__(self):
        return iter((self.x0, self.y0, self.x1, self.y1))

    def __getitem__(self, i):
        return (self.x0, self.y0, self.x1, self.y1)[i]


def load_tatr_post():
    fitz = types.ModuleType("fitz")
    fitz.Rect = Rect
    sys.modules["fitz"] = fitz
    import importlib.util
    path = Path("/tmp/pxd-table-models/tatr_postprocess.py")
    spec = importlib.util.spec_from_file_location("tatr_postprocess", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Tatr:
    CLASS_THRESH = {
        "table": 0.5,
        "table column": 0.5,
        "table row": 0.5,
        "table column header": 0.5,
        "table projected row header": 0.5,
        "table spanning cell": 0.5,
        "no object": 10,
    }

    def __init__(self):
        import json
        import torch
        from huggingface_hub import hf_hub_download
        from transformers import TableTransformerConfig, TableTransformerForObjectDetection
        self.torch = torch
        name = "microsoft/table-transformer-structure-recognition-v1.1-all"
        # transformers 5 rejects the checkpoint's dilation: null. Patch before construct.
        raw = json.loads(Path(hf_hub_download(name, "config.json")).read_text())
        raw["dilation"] = False
        if raw.get("use_pretrained_backbone") is None:
            raw["use_pretrained_backbone"] = False
        config = TableTransformerConfig.from_dict(raw)
        # The installed transformers rejects this checkpoint's size dict, so the
        # preprocess is the structure-recognition MaxResize(1000) from the model card.
        self.model = TableTransformerForObjectDetection.from_pretrained(name, config=config)
        self.model.eval()
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model.to(self.device)
        labels = self.model.config.id2label
        self.names = [labels[i] if i in labels else labels[str(i)] for i in range(len(labels))]
        if "no object" not in self.names:
            self.names.append("no object")
        self.post = load_tatr_post()

    def cells(self, bgr, origin, words_page):
        from PIL import Image
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(rgb)
        torch = self.torch
        w0, h0 = image.size
        scale = 1000.0 / max(w0, h0)
        resized = image.resize((int(round(scale * w0)), int(round(scale * h0))), Image.BILINEAR)
        arr = np.asarray(resized).astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        arr = (arr - mean) / std
        pixel = torch.from_numpy(np.transpose(arr, (2, 0, 1))).unsqueeze(0).to(self.device)
        with torch.no_grad():
            outputs = self.model(pixel_values=pixel)
        logits = outputs.logits[0]
        probs = logits.softmax(-1)
        scores, pred_labels = probs.max(-1)
        pred_boxes = outputs.pred_boxes[0].detach().cpu()
        objects = []
        for score, label, box in zip(scores.detach().cpu().tolist(), pred_labels.detach().cpu().tolist(), pred_boxes.tolist()):
            label = int(label)
            name = self.names[label] if label < len(self.names) else "no object"
            if name == "no object" or float(score) < self.CLASS_THRESH.get(name, 0.5):
                continue
            cx, cy, bw, bh = box
            xyxy = [
                (cx - 0.5 * bw) * w0,
                (cy - 0.5 * bh) * h0,
                (cx + 0.5 * bw) * w0,
                (cy + 0.5 * bh) * h0,
            ]
            objects.append({"label": self.names.index(name), "score": float(score), "bbox": xyxy})
        ox, oy = origin
        tokens = []
        for word in words_page:
            cx = (word["x0"] + word["x1"]) / 2
            cy = (word["y0"] + word["y1"]) / 2
            px, py = cx * SCALE - ox, cy * SCALE - oy
            if px < 0 or py < 0 or px > w0 or py > h0:
                continue
            tokens.append({
                "bbox": [word["x0"] * SCALE - ox, word["y0"] * SCALE - oy, word["x1"] * SCALE - ox, word["y1"] * SCALE - oy],
                "text": word.get("text") or "x",
                "span_num": len(tokens),
                "line_num": 0,
                "block_num": 0,
            })
        table = {"bbox": [0, 0, w0, h0], "page_num": 0}
        _structures, cells, _score = self.post.objects_to_cells(table, objects, tokens, self.names, self.CLASS_THRESH)
        out = []
        for cell in cells or []:
            rows = sorted(cell["row_nums"])
            cols = sorted(cell["column_nums"])
            if not rows or not cols:
                continue
            box = cell["bbox"]
            out.append({
                "r": rows[0],
                "c": cols[0],
                "rowSpan": rows[-1] - rows[0] + 1,
                "colSpan": cols[-1] - cols[0] + 1,
                "bbox": to_page(box, origin),
                "header": bool(cell.get("header")),
            })
        nrows = max((c["r"] + c["rowSpan"] for c in out), default=0)
        ncols = max((c["c"] + c["colSpan"] for c in out), default=0)
        header_rows = 0
        while header_rows < nrows and all(c["header"] for c in out if c["r"] == header_rows):
            if not any(c["r"] == header_rows for c in out):
                break
            header_rows += 1
        return out, nrows, ncols, header_rows


# ---------------------------------------------------------------- Docling via the running helper


def docling_documents(pack, token):
    import hashlib
    import urllib.request
    cache = Path("/tmp/pxd-table-bench/docling")
    cache.mkdir(parents=True, exist_ok=True)
    by_pdf = {}
    for page in pack["pages"]:
        by_pdf.setdefault(page["pdf"], []).append(page["page"])
    docs = {}
    http_ok = True
    for pdf, pages in by_pdf.items():
        pages = sorted(set(pages))
        key = hashlib.sha256(f"{pdf}:{pages}".encode()).hexdigest()[:16]
        path = cache / f"{key}.json"
        if path.is_file():
            docs[pdf] = json.loads(path.read_text())
            continue
        t0 = time.perf_counter()
        doc = None
        if http_ok:
            try:
                body = Path(pdf).read_bytes()
                opts = json.dumps({"ocr": "off", "formula": False, "tables": "accurate", "pictures": False, "pages": pages}).encode()
                req = urllib.request.Request(
                    "http://127.0.0.1:48765/v1/jobs",
                    data=body,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/pdf", "X-Pxd-Options": opts.decode()},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=60) as res:
                    started = json.loads(res.read().decode())
                    code = res.status
                if code == 200 and started.get("blocks"):
                    doc = started
                elif started.get("job"):
                    deadline = time.perf_counter() + 900
                    while time.perf_counter() < deadline:
                        poll = urllib.request.Request(
                            f"http://127.0.0.1:48765/v1/jobs/{started['job']}",
                            headers={"Authorization": f"Bearer {token}"},
                        )
                        with urllib.request.urlopen(poll, timeout=30) as res:
                            polled = json.loads(res.read().decode())
                        if polled.get("blocks") or polled.get("state") in {"error", "cancelled"}:
                            doc = polled
                            break
                        time.sleep(1.5)
            except Exception as err:
                print(f"docling http error: {err}", file=sys.stderr)
                doc = None
        if not doc or not doc.get("blocks"):
            # The live helper's venv imports a cpython-312 numpy into Python 3.11, so
            # /v1/jobs convert errors. Same options, in this process. Do not restart it.
            if http_ok:
                err = (doc or {}).get("error")
                print(f"docling http failed ({err}); in-process TableFormer", file=sys.stderr)
                http_ok = False
            doc = docling_inprocess(pdf, pages)
        path.write_text(json.dumps(doc))
        docs[pdf] = doc
        print(f"docling {Path(pdf).name} pages {pages} {(time.perf_counter() - t0):.1f}s", file=sys.stderr)
    return docs


def docling_inprocess(pdf, pages):
    from plexus_parse_helper.jobs import convert_file
    return convert_file(pdf, {
        "ocr": "off",
        "formula": False,
        "tables": "accurate",
        "pictures": False,
        "pages": pages,
    })


def docling_tables(doc, page_no):
    tables = []
    for block in (doc.get("blocks") or {}).values():
        if not isinstance(block, dict) or block.get("type") != "table" or block.get("page") != page_no:
            continue
        cells = []
        for cell in block.get("cells") or []:
            if not cell.get("bbox"):
                continue
            cells.append({
                "r": cell["r"],
                "c": cell["c"],
                "rowSpan": cell.get("rowSpan") or 1,
                "colSpan": cell.get("colSpan") or 1,
                "bbox": cell["bbox"],
                "header": bool(cell.get("header")),
            })
        tables.append({
            "page": page_no,
            "bbox": block.get("bbox"),
            "rows": block.get("rows") or 0,
            "cols": block.get("cols") or 0,
            "headerRows": block.get("headerRows") or 0,
            "cells": cells,
        })
    return tables


def run(pack, engines, regions, only, pad=PAD_PT):
    want = set(engines)
    sla = SlaNet(slanet_path()) if "slanet" in want else None
    tatr = Tatr() if "tatr" in want else None
    token = None
    ddocs = None
    if "docling" in want:
        token = Path.home().joinpath("Library/Application Support/plexus-parse-helper/token").read_text().strip()
        ddocs = docling_documents(pack, token)
    images = {}
    results = []
    for page in pack["pages"]:
        if only and only not in page["id"]:
            continue
        key = (page["pdf"], page["page"])
        if key not in images and ("slanet" in want or "tatr" in want):
            images[key] = page_image(page["pdf"], page["page"], page.get("deskew") or 0)
        for engine in engines:
            if engine == "docling":
                t0 = time.perf_counter()
                tables = docling_tables(ddocs[page["pdf"]], page["page"])
                results.append({
                    "id": page["id"],
                    "engine": "docling",
                    "region": "docling",
                    "seconds": time.perf_counter() - t0,
                    "tables": tables,
                })
                print(f"{page['id']} docling tables {len(tables)}", file=sys.stderr)
                continue
            model = sla if engine == "slanet" else tatr
            for region in regions:
                boxes = page["detector"] if region == "detector" else [
                    rotate_bbox(b, page["w"], page["h"], page.get("deskew") or 0) for b in page.get("oracle") or []
                ]
                t0 = time.perf_counter()
                tables = []
                bgr = images[key]
                for bbox in boxes:
                    cropped = crop_box(bgr, bbox, pad)
                    if not cropped:
                        continue
                    crop, origin = cropped
                    cells, rows, cols, header_rows = model.cells(crop, origin, page["words"]) if engine == "tatr" else model.cells(crop, origin)
                    if not cells:
                        continue
                    tables.append({
                        "page": page["page"],
                        "bbox": bbox,
                        "rows": rows,
                        "cols": cols,
                        "headerRows": header_rows,
                        "cells": cells,
                    })
                seconds = time.perf_counter() - t0
                results.append({"id": page["id"], "engine": engine, "region": region, "seconds": seconds, "tables": tables})
                shapes = ",".join(f"{t['rows']}x{t['cols']}" for t in tables) or "none"
                print(f"{page['id']} {engine}/{region} {shapes} {seconds:.2f}s", file=sys.stderr)
    return results


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--pack", default="/tmp/pxd-table-bench/pack.json")
    p.add_argument("--out", default="/tmp/pxd-table-bench/results.json")
    p.add_argument("--engines", default="slanet,tatr")
    p.add_argument("--regions", default="detector,oracle")
    p.add_argument("--only", default="")
    p.add_argument("--pad", type=float, default=PAD_PT)
    args = p.parse_args(argv)
    pack = json.loads(Path(args.pack).read_text())
    results = run(
        pack,
        [s for s in args.engines.split(",") if s],
        [s for s in args.regions.split(",") if s],
        args.only,
        args.pad,
    )
    Path(args.out).write_text(json.dumps(results))
    print(f"wrote {len(results)} rows {args.out}")


if __name__ == "__main__":
    main(sys.argv[1:])
