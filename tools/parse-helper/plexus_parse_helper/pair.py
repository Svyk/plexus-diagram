"""Pairing window. `plexus-parse-helper pair` writes an expiry time; the running server
reads it per request. While the window is open, GET /v1/pair hands the token to an allowed
Origin exactly once. Outside the window the route is a plain 404."""

from __future__ import annotations

import os
import time
from pathlib import Path

from plexus_parse_helper.auth import APP_SUPPORT

PAIR_SECONDS = 90
DEFAULT_PAIR_FILE = APP_SUPPORT / "pair-until"


def open_window(path: Path | None = None, seconds: int = PAIR_SECONDS, now=time.time) -> float:
    """Open (or reopen) the window. Returns the expiry as a unix time. Mode 0600."""
    path = Path(path) if path else DEFAULT_PAIR_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    until = float(now()) + float(seconds)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, f"{until:.3f}\n".encode("ascii"))
    finally:
        os.close(fd)
    os.chmod(path, 0o600)
    return until


def window_open(path: Path | None = None, now=time.time) -> bool:
    path = Path(path) if path else DEFAULT_PAIR_FILE
    try:
        until = float(path.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        return False
    t = float(now())
    # A file written further ahead than the window length is not ours: ignore it.
    return t < until <= t + PAIR_SECONDS + 5


def close_window(path: Path | None = None) -> bool:
    """Remove the window. True when this call removed it (the one caller that gets the token)."""
    path = Path(path) if path else DEFAULT_PAIR_FILE
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
