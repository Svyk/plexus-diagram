"""PP-DocLayoutV2, the layout detector inside the PaddleOCR-VL pipeline.

The weights are an ONNX export of PaddlePaddle/PP-DocLayoutV2 (Apache-2.0).
They download on first use and are checked by SHA-256. onnxruntime is imported
only when a page is detected. Boxes are pixels of the image passed in, origin
top-left, the same corner as a PDF render.
"""

from __future__ import annotations

import importlib.util
import os
import threading
from pathlib import Path

import numpy as np
from PIL import Image

LABELS = (
    "abstract",
    "algorithm",
    "aside_text",
    "chart",
    "content",
    "display_formula",
    "doc_title",
    "figure_title",
    "footer",
    "footer_image",
    "footnote",
    "formula_number",
    "header",
    "header_image",
    "image",
    "inline_formula",
    "number",
    "paragraph_title",
    "reference",
    "reference_content",
    "seal",
    "table",
    "text",
    "vertical_text",
    "vision_footnote",
)

# Element prompts in PaddleOCR-VL. Figures stay with our own detector; these
# labels are only a hint where that detector found nothing.
# figure_title is not re-read. The caller links the local line the box covers.
# Replacing that line with a second OCR pass dropped captions.
TABLE_LABELS = frozenset({"table"})
FIGURE_LABELS = frozenset({"image", "chart"})
TEXT_LABELS = frozenset({
    "abstract",
    "algorithm",
    "aside_text",
    "content",
    "doc_title",
    "footer",
    "footnote",
    "header",
    "number",
    "paragraph_title",
    "reference",
    "reference_content",
    "text",
    "vertical_text",
    "vision_footnote",
})

HF_ONNX = "alex-dinh/PP-DocLayoutV2-ONNX"
ONNX_NAME = "PP-DocLayoutV2.onnx"
LAYOUT_MODEL = "PP-DocLayoutV2"
SCORE_MIN = 0.5
INPUT_SIZE = 800

_lock = threading.Lock()
_session = None


def layout_available() -> bool:
    """True when onnxruntime can load the layout graph. Weights download on first use."""
    if os.environ.get("PXD_VLM_LAYOUT") == "0":
        return False
    try:
        return importlib.util.find_spec("onnxruntime") is not None
    except (ImportError, ValueError):
        return False


def layout_path() -> str:
    override = (os.environ.get("PXD_VLM_LAYOUT") or "").strip()
    if override and override != "0":
        return override
    return str(Path.home() / ".cache" / "plexus-parse-helper" / "vlm" / ONNX_NAME)


def _ensure_onnx(location: str) -> str:
    from plexus_parse_helper.vlm_weights import ensure_layout, verify_layout_file

    path = Path(location)
    if path.is_file():
        verify_layout_file(path)
        return str(path)
    if path.suffix == ".onnx":
        return ensure_layout(path)
    return ensure_layout(path / ONNX_NAME)


def _get_session():
    global _session
    if _session is not None:
        return _session
    with _lock:
        if _session is not None:
            return _session
        import onnxruntime as ort

        path = _ensure_onnx(layout_path())
        _session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        return _session


def preprocess_rgb(rgb: np.ndarray, size: int = INPUT_SIZE):
    """Stretch to size×size and apply the ImageNet normalisation the ONNX export expects.

    Returns (blob NCHW float32, scale_h, scale_w) where the scales map the
    resized canvas back onto the original image.
    """
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("layout input must be RGB")
    orig_h, orig_w = rgb.shape[:2]
    if orig_h < 2 or orig_w < 2:
        raise ValueError("layout image is empty")
    scale_h = size / orig_h
    scale_w = size / orig_w
    resized = np.asarray(Image.fromarray(rgb).resize((size, size), Image.Resampling.BILINEAR), dtype=np.float32)
    blob = resized / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    blob = (blob - mean) / std
    blob = np.transpose(blob, (2, 0, 1))[np.newaxis, ...]
    return blob, float(scale_h), float(scale_w)


def boxes_from_output(output, width: int, height: int, score_min: float = SCORE_MIN) -> list[dict]:
    """Rows are [label, score, xmin, ymin, xmax, ymax, ...] in original pixels."""
    rows = np.asarray(output)
    if rows.ndim == 3:
        rows = rows[0]
    if rows.ndim != 2 or rows.shape[1] < 6:
        return []
    found = []
    for row in rows:
        score = float(row[1])
        if score < score_min:
            continue
        label_i = int(row[0])
        if label_i < 0 or label_i >= len(LABELS):
            continue
        x0, y0, x1, y1 = (float(row[2]), float(row[3]), float(row[4]), float(row[5]))
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        x0 = min(max(0.0, x0), width)
        x1 = min(max(0.0, x1), width)
        y0 = min(max(0.0, y0), height)
        y1 = min(max(0.0, y1), height)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        found.append({
            "label": LABELS[label_i],
            "score": round(score, 4),
            "bbox": [x0, y0, x1, y1],
        })
    found.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))
    return found


def detect_layout(image: Image.Image) -> list[dict]:
    """Layout boxes on `image`, in that image's pixels, origin top-left."""
    rgb = np.asarray(image.convert("RGB"))
    blob, scale_h, scale_w = preprocess_rgb(rgb)
    session = _get_session()
    im_shape = np.array([[INPUT_SIZE, INPUT_SIZE]], dtype=np.float32)
    scale = np.array([[scale_h, scale_w]], dtype=np.float32)
    feed = {}
    for inp in session.get_inputs():
        name = inp.name
        if "scale" in name:
            feed[name] = scale
        elif "shape" in name:
            feed[name] = im_shape
        else:
            feed[name] = blob
    output = session.run(None, feed)[0]
    return boxes_from_output(output, rgb.shape[1], rgb.shape[0])
