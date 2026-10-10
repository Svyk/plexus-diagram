"""Page text for a weak page. Qwen3-VL-8B-Instruct 4-bit (Apache-2.0).

Loaded only when a read asks for text. Table crops stay on PaddleOCR-VL.
The weights download on first use and are checked by SHA-256. Decoding is
greedy with a fixed seed. A full-page photograph is shrunk so the long side
is at most 2048 px, which is the size this reader was measured at.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

from PIL import Image

from plexus_parse_helper.vlm_tables import DECODE_SEED, DECODE_TEMPERATURE, _RepeatStop, greedy_sampler
from plexus_parse_helper.vlm_weights import TEXT_LABEL

# The instruction used in the page-text bake-off. Not tuned to a page.
TEXT_PROMPT = (
    "Transcribe all the text on this page in reading order. "
    "Output only the transcription, one visual line per line."
)
MAX_SIDE = 2048
MAX_TOKENS = 2048

_lock = threading.Lock()
_loaded: tuple | None = None


def text_model_location() -> str:
    override = (os.environ.get("PXD_VLM_TEXT_MODEL") or "").strip()
    if override:
        return override
    return str(Path.home() / ".cache" / "plexus-parse-helper" / "vlm" / "qwen3-vl-8b-4bit")


def _has_weights(path: Path) -> bool:
    return (path / "model.safetensors").is_file() or (path / "model.safetensors.index.json").is_file()


def _ensure_weights(location: str) -> str:
    path = Path(location)
    if not path.is_absolute() and not path.exists() and location.count("/") == 1 and not location.startswith("."):
        return location
    cache = Path.home() / ".cache" / "plexus-parse-helper" / "vlm" / "qwen3-vl-8b-4bit"
    if path.resolve() != cache.resolve() and _has_weights(path):
        return str(path)
    from plexus_parse_helper.vlm_weights import ensure_text_reader

    return ensure_text_reader(cache)


def fit_page(image: Image.Image, max_side: int = MAX_SIDE) -> Image.Image:
    """Shrink so the long side is at most `max_side`. Smaller pages stay."""
    longest = max(image.size)
    if longest <= max_side:
        return image
    scale = max_side / float(longest)
    return image.resize(
        (max(1, int(round(image.width * scale))), max(1, int(round(image.height * scale)))),
        Image.Resampling.LANCZOS,
    )


def _get_model():
    global _loaded
    if _loaded is not None:
        return _loaded
    with _lock:
        if _loaded is not None:
            return _loaded
        import mlx.core as mx
        from mlx_vlm import load

        location = _ensure_weights(text_model_location())
        model, processor = load(location)
        _loaded = (model, processor, mx)
        return _loaded


def _plain(raw: str) -> str:
    from plexus_parse_helper.table_text import plain_lines

    return "\n".join(plain_lines(raw)).strip()


def read_page_text(image: Image.Image) -> str:
    """Transcribe one page image. Empty when the model returns nothing."""
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template

    model, processor, mx = _get_model()
    prompt = apply_chat_template(processor, model.config, TEXT_PROMPT, num_images=1)
    tok = processor.tokenizer if hasattr(processor, "tokenizer") else processor
    eos = getattr(model.config, "eos_token_id", None) or []
    if not isinstance(eos, list):
        eos = [eos]
    if not isinstance(getattr(tok, "stopping_criteria", None), _RepeatStop):
        tok.stopping_criteria = _RepeatStop(eos, tok)
    if hasattr(mx, "reset_peak_memory"):
        mx.reset_peak_memory()
    if hasattr(mx, "random") and hasattr(mx.random, "seed"):
        mx.random.seed(DECODE_SEED)
    out = generate(
        model,
        processor,
        prompt,
        image=fit_page(image),
        max_tokens=MAX_TOKENS,
        temperature=DECODE_TEMPERATURE,
        seed=DECODE_SEED,
        sampler=greedy_sampler,
        stopping_criteria=tok.stopping_criteria,
        verbose=False,
    )
    return _plain(out.text or "")


def label() -> str:
    return TEXT_LABEL
