"""Docling model presence. Download is `docling-tools models download` in the background."""

from __future__ import annotations

import os
import signal
import subprocess
import threading
from pathlib import Path

# Measured 2026-10-07 on this machine (du -sh of the HF hub checkouts).
# pictureClassifier measured 2026-10-13. Hub file sizes sum to 33,544,253
# bytes: model.safetensors 16,378,200, model.onnx 16,940,439, and the small
# files. The repo folder walk under-counts them; this Hub stores the weights
# as symlinks into the shared blob store.
MEASURED_BYTES = {
    "layout": 164 * 1024 * 1024,
    "tableformer": 342 * 1024 * 1024,
    "formula": 610 * 1024 * 1024,
    "pictureClassifier": 32 * 1024 * 1024,
    "ocr": 0,
}

# Docling 2.138 preset document_figure_classifier_v2. `main` on 2026-10-13.
# The converter asks for this revision, so a hub snapshot of it works offline.
PICTURE_CLASSIFIER_REPO = "docling-project/DocumentFigureClassifier-v2.5"
PICTURE_CLASSIFIER_REVISION = "f859dfbff5c9916cd996942d4b0db7fa25808220"

_HUB_NAMES = {
    "layout": "models--docling-project--docling-layout-heron",
    "tableformer": "models--docling-project--docling-models",
    "formula": "models--docling-project--CodeFormulaV2",
    "pictureClassifier": "models--" + PICTURE_CLASSIFIER_REPO.replace("/", "--"),
}

_download_lock = threading.Lock()
_download_proc: subprocess.Popen | None = None


def _ready(hub: Path, folder: str) -> bool:
    root = hub / folder
    if not root.is_dir():
        return False
    snaps = root / "snapshots"
    if not snaps.is_dir():
        return False
    return any(p.is_dir() for p in snaps.iterdir())


def ocrmac_importable() -> bool:
    try:
        import ocrmac  # noqa: F401
        return True
    except Exception:
        return False


def _tree_bytes(root: Path) -> int:
    """Bytes on disk under a hub folder, partial downloads included. Symlinks are skipped
    (snapshots point at blobs), so nothing is counted twice."""
    total = 0
    if not root.is_dir():
        return 0
    for base, _dirs, files in os.walk(root):
        for name in files:
            path = Path(base) / name
            try:
                if not path.is_symlink():
                    total += path.stat().st_size
            except OSError:
                continue
    return total


def _downloading() -> bool:
    return _download_proc is not None and _download_proc.poll() is None


def hub_dir(hub: Path | None = None) -> Path:
    return Path(hub) if hub else Path.home() / ".cache" / "huggingface" / "hub"


def picture_classifier_ready(hub: Path | None = None) -> bool:
    """True when the pinned classifier snapshot is in the HF hub cache.

    Docling loads this model from that cache when no artifacts path is set.
    A missing snapshot means classification stays off; parse still runs.
    """
    return _ready(hub_dir(hub), _HUB_NAMES["pictureClassifier"])


def stage_picture_classifier() -> str:
    """Download the pinned classifier into the HF hub if it is not there yet.

    `docling-tools models download picture_classifier` writes
    ~/.cache/docling/models, which the converter does not read. This puts the
    same repo where `picture_classifier_ready` and the converter look.
    """
    if picture_classifier_ready():
        return "cached"
    from huggingface_hub import snapshot_download

    path = snapshot_download(
        repo_id=PICTURE_CLASSIFIER_REPO,
        revision=PICTURE_CLASSIFIER_REVISION,
    )
    return str(path)


def model_report(hub: Path | None = None) -> dict:
    hub = hub_dir(hub)
    running = _downloading()
    items = []
    health = {}
    want = 0
    have = 0
    for name, folder in _HUB_NAMES.items():
        ready = _ready(hub, folder)
        expected = MEASURED_BYTES[name]
        done = expected if ready else min(_tree_bytes(hub / folder), expected)
        state = "ready" if ready else ("downloading" if running else "missing")
        health[name] = "ready" if ready else "missing"
        items.append({"name": name, "state": state, "bytes": expected, "done": done})
        if not ready:
            want += expected
            have += done
    ocr_state = "ready" if ocrmac_importable() else "missing"
    health["ocr"] = ocr_state
    items.append({"name": "ocr", "state": ocr_state, "bytes": 0, "done": 0})
    if running:
        overall = "downloading"
    elif all(health[k] == "ready" for k in ("layout", "tableformer", "ocr")):
        overall = "ready"
    else:
        overall = "missing"
    fraction = 1.0 if want == 0 else round(have / want, 4)
    return {
        "state": overall,
        "items": items,
        "health": health,
        "bytes": want,
        "done": have,
        "fraction": fraction,
    }


def download_command() -> list[str]:
    return [
        "docling-tools", "models", "download",
        "layout", "tableformer", "code_formula", "picture_classifier", "rapidocr",
    ]


def _download_script() -> str:
    """docling-tools for the add-on set, then the classifier into the HF hub.

    The tool's picture_classifier lands under ~/.cache/docling/models. The
    converter reads the hub, so the second step is what makes a later parse
    work offline. `set -e` keeps a failed fetch from looking finished.
    """
    import shlex
    import sys

    fetch = " ".join(shlex.quote(part) for part in download_command())
    stage = " ".join(shlex.quote(part) for part in [
        sys.executable, "-c",
        "from plexus_parse_helper.models import stage_picture_classifier; stage_picture_classifier()",
    ])
    return f"set -e\n{fetch}\n{stage}\n"


def start_download() -> dict:
    global _download_proc
    with _download_lock:
        if _download_proc is not None and _download_proc.poll() is None:
            return {"started": False, "running": True}
        _download_proc = subprocess.Popen(
            ["sh", "-c", _download_script()],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return {"started": True, "pid": _download_proc.pid}


def stop_download() -> dict:
    """Cancel a running download. Partial files stay, so a later start resumes."""
    global _download_proc
    with _download_lock:
        if not _downloading():
            return {"stopped": False}
        try:
            os.killpg(os.getpgid(_download_proc.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            _download_proc.terminate()
        return {"stopped": True}
