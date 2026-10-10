"""Local table reading with PaddleOCR-VL (Apache-2.0) through MLX.

The pinned weights download on first use into the helper cache and are checked
by SHA-256. `PXD_VLM_MODEL` points at an already present directory or a Hub id.
mlx-vlm is imported only when a request runs, so a helper install without that
extra does not advertise the engine and does not load a model. Decoding is
greedy (temperature 0) with a fixed seed.
"""

from __future__ import annotations

import importlib.util
import os
import threading
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image

from plexus_parse_helper.table_text import tables_from_text

MODEL_LABEL = "PaddleOCR-VL-0.9B"
TABLE_PROMPT = "Table Recognition:"
OCR_PROMPT = "OCR:"
SCALE = 200 / 72
PAD = 8.0
# A section title often sits one line above the ruled grid. The box from a
# layout model stops on the rules, so the crop grows upward by this much.
TOP_PAD = 36.0
MAX_REGIONS = 40
MAX_TOKENS = 4096
TEXT_TOKENS = 512
# Greedy and seeded. Temperature 0 is argmax; the seed keeps the random
# state from a previous sampled call out of this one.
DECODE_TEMPERATURE = 0.0
DECODE_SEED = 0

_lock = threading.Lock()
_loaded: tuple | None = None


def vlm_tables_available() -> bool:
    """True when the MLX VLM stack is installed. Weights may still download later."""
    if os.environ.get("PXD_VLM_TABLES") == "0":
        return False
    try:
        return importlib.util.find_spec("mlx_vlm") is not None
    except (ImportError, ValueError):
        return False


def model_location() -> str:
    override = (os.environ.get("PXD_VLM_MODEL") or "").strip()
    if override:
        return override
    return str(Path.home() / ".cache" / "plexus-parse-helper" / "vlm" / "paddleocr-vl")


def _has_weights(path: Path) -> bool:
    return (path / "model.safetensors").is_file() or (path / "model.safetensors.index.json").is_file()


def _ensure_weights(location: str) -> str:
    path = Path(location)
    # A Hub id (org/name) is loaded by mlx-vlm directly.
    if not path.is_absolute() and not path.exists() and location.count("/") == 1 and not location.startswith("."):
        return location
    # An explicit directory that already holds weights is the operator's copy
    # (a bench model, or PXD_VLM_MODEL). The default cache is downloaded on
    # the first read and checked against the pinned SHA-256 manifest.
    cache = Path.home() / ".cache" / "plexus-parse-helper" / "vlm" / "paddleocr-vl"
    if path.resolve() != cache.resolve() and _has_weights(path):
        return str(path)
    from plexus_parse_helper.vlm_weights import ensure_reader

    checked = ensure_reader(cache)
    tokenizer = Path(checked) / "tokenizer.json"
    if tokenizer.exists():
        tokenizer.chmod(tokenizer.stat().st_mode | 0o200)
    return checked


def _get_model():
    global _loaded
    if _loaded is not None:
        return _loaded
    with _lock:
        if _loaded is not None:
            return _loaded
        import mlx.core as mx
        from mlx_vlm import load
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.utils import StoppingCriteria

        location = _ensure_weights(model_location())
        model, processor = load(location)
        prompt = apply_chat_template(processor, model.config, TABLE_PROMPT, num_images=1)
        tok = processor.tokenizer if hasattr(processor, "tokenizer") else processor
        eos = getattr(model.config, "eos_token_id", None)
        if eos is None:
            eos = getattr(tok, "eos_token_id", None) or []
        tok.stopping_criteria = _RepeatStop(eos, tok)
        _loaded = (model, processor, prompt, mx)
        return _loaded


class _RepeatStop:
    """Stop on EOS, a document end, or a repeated token span.

    Assigned onto the tokenizer. `generate` calls `reset` and then this object
    with each new token id.
    """

    def __init__(self, eos_token_ids, tokenizer):
        from mlx_vlm.utils import StoppingCriteria

        ids = eos_token_ids if isinstance(eos_token_ids, list) else [eos_token_ids]
        self._inner = StoppingCriteria(ids, tokenizer, additional_eos_token_ids=_extra_eos(tokenizer))
        self.tokenizer = tokenizer
        self.recent: list[int] = []
        self.buf = ""

    def reset(self, eos_token_ids=None):
        self._inner.reset(eos_token_ids)
        self.recent = []
        self.buf = ""

    def add_eos_token_ids(self, new_eos_token_ids=None):
        self._inner.add_eos_token_ids(new_eos_token_ids)

    def __call__(self, token) -> bool:
        tid = int(token.item()) if hasattr(token, "item") else int(token)
        self.recent.append(tid)
        if self._inner(token):
            return True
        decode = getattr(self.tokenizer, "decode", None)
        piece = ""
        if decode is not None:
            try:
                piece = decode([tid], skip_special_tokens=False)
            except TypeError:
                piece = decode([tid])
        self.buf = (self.buf + piece)[-160:]
        if any(mark in self.buf for mark in ("</doctag>", "<end_of_utterance>", "User:")):
            return True
        n = len(self.recent)
        if n >= 12 and len(set(self.recent[-12:])) == 1:
            return True
        # Two copies of a header ("Rate of flow" three times across one row, or
        # the left half of a page repeated on the right) are the table, not a
        # loop. Stop only when the same span that contains a row break has been
        # emitted three times.
        for period in range(8, min(96, n // 3) + 1):
            span = self.recent[-period:]
            if span != self.recent[-2 * period:-period] or span != self.recent[-3 * period:-2 * period]:
                continue
            if _span_has_break(self.tokenizer, span):
                return True
        return False


def _span_has_break(tokenizer, span) -> bool:
    decode = getattr(tokenizer, "decode", None)
    if decode is None:
        return False
    try:
        text = decode(list(span), skip_special_tokens=False)
    except TypeError:
        text = decode(list(span))
    except Exception:
        return False
    return "<nl>" in text or "\n" in text


def _extra_eos(tokenizer) -> list[int]:
    convert = getattr(tokenizer, "convert_tokens_to_ids", None)
    if convert is None:
        return []
    unk = getattr(tokenizer, "unk_token_id", None)
    ids = []
    for name in ("</doctag>", "<end_of_utterance>", "<|end_of_text|>", "<|im_end|>"):
        token_id = convert(name)
        if isinstance(token_id, int) and token_id >= 0 and token_id != unk:
            ids.append(token_id)
    return ids


def crop_pixels(bbox, pw, ph, width, height, pad=PAD, top_pad=TOP_PAD):
    """PDF-point box, origin top-left, onto a rendered bitmap of `width`×`height`.

    Document boxes (the built-in parser, LlamaParse, this layout model) all use
    that corner. An earlier crop flipped them as if y grew upward, so the model
    read the wrong band of the page.
    """
    x0, y0, x1, y1 = (float(v) for v in bbox)
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    x0 = max(0.0, x0 - pad)
    y0 = max(0.0, y0 - top_pad)
    x1 = min(float(pw), x1 + pad)
    y1 = min(float(ph), y1 + pad)
    sx = width / float(pw) if pw else 1.0
    sy = height / float(ph) if ph else 1.0
    box = (
        max(0, int(round(x0 * sx))),
        max(0, int(round(y0 * sy))),
        min(int(width), int(round(x1 * sx))),
        min(int(height), int(round(y1 * sy))),
    )
    return box


def _crop(page, bbox, bitmap=None, pad=PAD, top_pad=TOP_PAD) -> Image.Image:
    pw, ph = page.get_size()
    if bitmap is None:
        bitmap = page.render(scale=SCALE).to_pil().convert("RGB")
    box = crop_pixels(bbox, pw, ph, bitmap.width, bitmap.height, pad=pad, top_pad=top_pad)
    if box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError("table box is empty")
    return bitmap.crop(box)


def greedy_sampler(logits):
    """Argmax. Ties follow MLX argmax; the call is not a sample."""
    import mlx.core as mx

    return mx.argmax(logits, axis=-1)


def _generate(image: Image.Image, instruction: str = TABLE_PROMPT, max_tokens: int = MAX_TOKENS) -> str:
    from mlx_vlm import generate

    from mlx_vlm.prompt_utils import apply_chat_template

    model, processor, _cached, mx = _get_model()
    prompt = apply_chat_template(processor, model.config, instruction, num_images=1)
    tok = processor.tokenizer if hasattr(processor, "tokenizer") else processor
    # generate() resets the criteria. Installing it again keeps the loop stop
    # if a previous call replaced the object.
    if not isinstance(getattr(tok, "stopping_criteria", None), _RepeatStop):
        eos = getattr(model.config, "eos_token_id", None) or []
        tok.stopping_criteria = _RepeatStop(eos, tok)
    if hasattr(mx, "reset_peak_memory"):
        mx.reset_peak_memory()
    if hasattr(mx, "random") and hasattr(mx.random, "seed"):
        mx.random.seed(DECODE_SEED)
    out = generate(
        model,
        processor,
        prompt,
        image=image,
        max_tokens=max_tokens,
        temperature=DECODE_TEMPERATURE,
        seed=DECODE_SEED,
        sampler=greedy_sampler,
        verbose=False,
    )
    return out.text or ""


def read_tables(pdf_path: str, regions: list) -> dict:
    """One crop per region. Regions are `{page, bbox}` in PDF points, origin top-left."""
    if len(regions) > MAX_REGIONS:
        raise ValueError(f"tables cap is {MAX_REGIONS}")
    tables = []
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        n_pages = len(pdf)
        for region in regions:
            page_no = int(region.get("page") or 0)
            bbox = region.get("bbox")
            if page_no < 1 or page_no > n_pages:
                raise ValueError(f"page {page_no} is outside 1..{n_pages}")
            if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
                raise ValueError("bbox must be [x0, y0, x1, y1]")
            image = _crop(pdf[page_no - 1], bbox)
            parsed = tables_from_text(_generate(image), "html")
            if not parsed:
                continue
            table = parsed[0]
            tables.append({
                "page": page_no,
                "bbox": [float(v) for v in bbox],
                "rows": table["rows"],
                "cols": table["cols"],
                "cells": table["cells"],
            })
    finally:
        pdf.close()
    return {"model": MODEL_LABEL, "tables": tables}
