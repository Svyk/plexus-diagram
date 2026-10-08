"""Docling model presence. Download is `docling-tools models download` in the background."""

from __future__ import annotations

import os
import signal
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


def model_report(hub: Path | None = None) -> dict:
    hub = Path(hub) if hub else Path.home() / ".cache" / "huggingface" / "hub"
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
