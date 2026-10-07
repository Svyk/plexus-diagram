"""Docling model presence. Download is `docling-tools models download` in the background."""

from __future__ import annotations

import os
import subprocess
import threading
from pathlib import Path

# Measured 2026-10-07 on this machine (du -sh of the HF hub checkouts).
MEASURED_BYTES = {
    "layout": 164 * 1024 * 1024,
    "tableformer": 342 * 1024 * 1024,
    "formula": 610 * 1024 * 1024,
    "ocr": 0,
}

_HUB_NAMES = {
    "layout": "models--docling-project--docling-layout-heron",
    "tableformer": "models--docling-project--docling-models",
    "formula": "models--docling-project--CodeFormulaV2",
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


def model_report(hub: Path | None = None) -> dict:
    hub = Path(hub) if hub else Path.home() / ".cache" / "huggingface" / "hub"
    items = []
    health = {}
    for name, folder in _HUB_NAMES.items():
        state = "ready" if _ready(hub, folder) else "missing"
        health[name] = state
        items.append({
            "name": name,
            "state": state,
            "bytes": MEASURED_BYTES[name] if state == "ready" else 0,
            "done": MEASURED_BYTES[name] if state == "ready" else 0,
        })
    ocr_state = "ready" if ocrmac_importable() else "missing"
    health["ocr"] = ocr_state
    items.append({"name": "ocr", "state": ocr_state, "bytes": 0, "done": 0})
    if _download_proc is not None and _download_proc.poll() is None:
        overall = "downloading"
    elif all(health[k] == "ready" for k in ("layout", "tableformer", "ocr")):
        overall = "ready"
    else:
        overall = "missing"
    return {"state": overall, "items": items, "health": health}


def download_command() -> list[str]:
    return [
        "docling-tools", "models", "download",
        "layout", "tableformer", "code_formula", "rapidocr",
    ]


def start_download() -> dict:
    global _download_proc
    with _download_lock:
        if _download_proc is not None and _download_proc.poll() is None:
            return {"started": False, "running": True}
        _download_proc = subprocess.Popen(
            download_command(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return {"started": True, "pid": _download_proc.pid}
