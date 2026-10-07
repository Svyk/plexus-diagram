"""One warm Docling worker. Cancel terminates the process and respawns it.

Page ranges run in chunks of 4 so the server can emit SSE progress. Docling has
no per-page callback.
"""

from __future__ import annotations

import multiprocessing as mp
import queue
import threading
import time
import traceback
from pathlib import Path

from plexus_parse_helper.convert import convert_docling, merge_docling
from plexus_parse_helper.schema import normalize_options

CHUNK = 4
_CONVERTERS: dict[tuple, object] = {}


class JobCancelled(Exception):
    pass


def expand_pages(spec, page_count: int) -> list[int]:
    if not spec:
        pages = list(range(1, page_count + 1))
    else:
        pages = []
        for item in spec:
            if isinstance(item, int):
                pages.append(int(item))
            elif isinstance(item, (list, tuple)) and len(item) == 2:
                start, end = int(item[0]), int(item[1])
                if end < start:
                    start, end = end, start
                pages.extend(range(start, end + 1))
            else:
                raise ValueError(f"bad page spec {item!r}")
    out = sorted({p for p in pages if 1 <= p <= page_count})
    if len(out) > 400:
        raise ValueError("page range cap is 400")
    if not out:
        raise ValueError("no pages in range")
    return out


def chunk_pages(pages: list[int], size: int = CHUNK) -> list[list[int]]:
    """Contiguous runs, then slices of `size`. A gap does not pull in the pages between."""
    runs: list[list[int]] = []
    for page in pages:
        if not runs or page != runs[-1][-1] + 1:
            runs.append([page])
        else:
            runs[-1].append(page)
    chunks = []
    for run in runs:
        for i in range(0, len(run), size):
            chunks.append(run[i:i + size])
    return chunks


def _ocr_options(do_full: bool):
    from docling.datamodel.pipeline_options import OcrMacOptions, RapidOcrOptions
    from plexus_parse_helper.models import ocrmac_importable

    if ocrmac_importable():
        opts = OcrMacOptions(lang=["en-US"])
    else:
        opts = RapidOcrOptions()
    if do_full:
        opts.force_full_page_ocr = True
    return opts


def make_converter(options: dict):
    from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        TableFormerMode,
        TableStructureOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    norm = normalize_options(options)
    ocr_on = norm["ocr"] != "off"
    mode = TableFormerMode.FAST if norm["tables"] == "fast" else TableFormerMode.ACCURATE
    pipeline = PdfPipelineOptions(
        do_table_structure=True,
        do_ocr=ocr_on,
        do_formula_enrichment=bool(norm["formula"]),
        generate_picture_images=bool(norm["pictures"]),
        images_scale=2.0,
        table_structure_options=TableStructureOptions(do_cell_matching=True, mode=mode),
        ocr_options=_ocr_options(norm["ocr"] == "on"),
        accelerator_options=AcceleratorOptions(device=AcceleratorDevice.AUTO),
    )
    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline)}
    )


def converter_for(options: dict):
    norm = normalize_options(options)
    key = (norm["ocr"], bool(norm["formula"]), norm["tables"], bool(norm["pictures"]))
    conv = _CONVERTERS.get(key)
    if conv is None:
        conv = make_converter(norm)
        _CONVERTERS[key] = conv
    return conv


def _quiet_loggers() -> None:
    import logging
    for name in ("docling", "docling_ibm_models", "rapidocr", "RapidOCR"):
        logging.getLogger(name).setLevel(logging.WARNING)


def convert_file(pdf_path: str | Path, options: dict | None = None, on_event=None, cancel=None) -> dict:
    """Convert one PDF to pxd-parse/1. Used by `parse` and by the worker."""
    _quiet_loggers()
    from plexus_parse_helper.refine import refine_document
    from plexus_parse_helper.schema import sha256_bytes

    path = Path(pdf_path)
    data = path.read_bytes()
    sha = sha256_bytes(data)
    norm = normalize_options(options)
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(path))
    try:
        page_count = len(pdf)
    finally:
        pdf.close()
    selected = expand_pages(norm.get("pages"), page_count)
    started = time.perf_counter()
    parts = []
    per_page = []
    converter = converter_for(norm)
    chunks = chunk_pages(selected, CHUNK)
    done = 0
    for chunk in chunks:
        if cancel is not None and cancel.is_set():
            raise JobCancelled()
        t0 = time.perf_counter()
        result = converter.convert(str(path), page_range=(chunk[0], chunk[-1]))
        parts.append(result.document.export_to_dict())
        elapsed = int((time.perf_counter() - t0) * 1000)
        done += len(chunk)
        ms = int((time.perf_counter() - started) * 1000)
        for page in chunk:
            per_page.append(elapsed // max(1, len(chunk)))
            if on_event:
                on_event("progress", {"page": page, "of": len(selected), "ms": ms})
    merged = merge_docling(parts)
    doc = convert_docling(merged, sha256=sha, options=norm)
    # Drop pages outside the request. Chunk ranges are exact, so this is a guard.
    keep = set(selected)
    doc["order"] = [bid for bid in doc["order"] if int(doc["blocks"][bid].get("page") or 0) in keep]
    doc["blocks"] = {bid: doc["blocks"][bid] for bid in doc["order"]}
    doc["removed"] = [item for item in doc["removed"] if int(item.get("page") or 0) in keep]
    doc["pages"] = [page for page in doc["pages"] if int(page["n"]) in keep]
    doc["pageCount"] = page_count
    doc = refine_document(doc, path, ocr=norm["ocr"] != "off")
    doc["stats"]["ms"] = int((time.perf_counter() - started) * 1000)
    doc["stats"]["perPage"] = per_page
    if on_event:
        by_page: dict[int, list] = {}
        for bid in doc["order"]:
            block = doc["blocks"][bid]
            by_page.setdefault(int(block.get("page") or 1), []).append(block)
        for page in selected:
            on_event("page", {"page": page, "blocks": by_page.get(page) or []})
    return doc


def worker_main(in_q, out_q) -> None:
    _quiet_loggers()
    while True:
        msg = in_q.get()
        if msg is None or msg.get("cmd") == "stop":
            return
        if msg.get("cmd") != "convert":
            continue
        job = msg.get("job")

        def on_event(event, data, job=job):
            out_q.put({"job": job, "event": event, "data": data})

        try:
            doc = convert_file(msg["pdf"], msg.get("options") or {}, on_event=on_event)
            out_q.put({"job": job, "event": "done", "data": doc})
        except Exception as exc:
            out_q.put({
                "job": job,
                "event": "error",
                "data": {"code": "convert", "message": str(exc), "trace": traceback.format_exc()[-2000:]},
            })


def sleep_worker(in_q, out_q) -> None:
    """Test double: ignores the PDF and sleeps until the process is killed."""
    import time as _time
    while True:
        msg = in_q.get()
        if msg is None or msg.get("cmd") == "stop":
            return
        _time.sleep(30)
        out_q.put({"job": msg.get("job"), "event": "done", "data": {}})


class ProcessWorker:
    """One child process. kill_and_respawn() is the cancel path."""

    def __init__(self, target=worker_main):
        self.target = target
        self._ctx = mp.get_context("spawn")
        self.in_q = None
        self.out_q = None
        self.proc = None
        self.warm = False
        self.start()

    def start(self) -> None:
        self.in_q = self._ctx.Queue()
        self.out_q = self._ctx.Queue()
        self.proc = self._ctx.Process(target=self.target, args=(self.in_q, self.out_q), daemon=True)
        self.proc.start()
        self.warm = False

    def kill_and_respawn(self) -> int:
        old = self.proc.pid if self.proc is not None else None
        if self.proc is not None and self.proc.is_alive():
            self.proc.terminate()
            self.proc.join(timeout=3)
            if self.proc.is_alive():
                self.proc.kill()
                self.proc.join(timeout=2)
        self.start()
        return old or 0

    def close(self) -> None:
        if self.proc is not None and self.proc.is_alive():
            try:
                self.in_q.put(None)
            except Exception:
                pass
            self.proc.terminate()
            self.proc.join(timeout=2)

    def convert(self, pdf_path, options, on_event, cancel_event) -> dict:
        job = "w"
        self.in_q.put({"cmd": "convert", "job": job, "pdf": str(pdf_path), "options": options})
        while True:
            if cancel_event.is_set():
                self.kill_and_respawn()
                raise JobCancelled()
            try:
                msg = self.out_q.get(timeout=0.2)
            except queue.Empty:
                if not self.proc.is_alive():
                    self.start()
                    raise RuntimeError("worker died")
                continue
            if msg.get("job") != job:
                continue
            event = msg.get("event")
            if event == "done":
                self.warm = True
                return msg.get("data") or {}
            if event == "error":
                raise RuntimeError((msg.get("data") or {}).get("message") or "convert failed")
            if on_event:
                on_event(event, msg.get("data") or {})


class JobManager:
    """In-process runner for tests, or a ProcessWorker for serve."""

    def __init__(self, runner=None, worker: ProcessWorker | None = None):
        self.runner = runner
        self.worker = worker
        self.warm = False
        self._busy = 0
        self._lock = threading.Lock()
        self._cancel = threading.Event()

    @property
    def busy(self) -> int:
        return self._busy

    def shutdown(self) -> None:
        if self.worker is not None:
            self.worker.close()

    def run(self, pdf_path, options, on_event, cancel_event) -> dict:
        with self._lock:
            self._busy += 1
        try:
            if self.runner is not None:
                doc = self.runner(pdf_path, options, on_event, cancel_event)
            elif self.worker is not None:
                doc = self.worker.convert(pdf_path, options, on_event, cancel_event)
                self.warm = self.worker.warm
            else:
                if cancel_event.is_set():
                    raise JobCancelled()
                doc = convert_file(pdf_path, options, on_event=on_event, cancel=cancel_event)
                self.warm = True
            return doc
        finally:
            with self._lock:
                self._busy -= 1
