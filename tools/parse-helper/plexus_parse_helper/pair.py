"""Pairing window. `plexus-parse-helper pair` writes an expiry time; the running server
reads it per request. While the window is open, GET /v1/pair hands the token to an allowed
Origin exactly once. Outside the window the route is a plain 404."""

from __future__ import annotations

import os
import subprocess
import sys
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


def _applescript_quote(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def mac_consent(origin: str) -> bool:
    """Ask on this Mac whether the page at `origin` may use the helper. True only on Allow.
    Anywhere but macOS there is no dialog, so the answer is no."""
    if sys.platform != "darwin":
        return False
    prompt = f"Allow Plexus Diagram in Roam ({_applescript_quote(origin)}) to use the parse helper on this Mac?"
    script = (
        f'display dialog "{prompt}" buttons {{"Don\u2019t Allow", "Allow"}} '
        'default button "Allow" with title "Plexus parse helper" giving up after 60'
    )
    try:
        done = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.SubprocessError):
        return False
    out = done.stdout or ""
    return done.returncode == 0 and "button returned:Allow" in out and "gave up:true" not in out
