"""Bearer token in ~/Library/Application Support/plexus-parse-helper/token (0600)."""

from __future__ import annotations

import hmac
import os
import secrets
from pathlib import Path

APP_SUPPORT = Path.home() / "Library" / "Application Support" / "plexus-parse-helper"
DEFAULT_TOKEN_FILE = APP_SUPPORT / "token"


def load_or_create_token(path: Path | None = None) -> tuple[str, bool]:
    """Return (token, created). A new file is mode 0600. An existing file is not rewritten."""
    path = Path(path) if path else DEFAULT_TOKEN_FILE
    if path.is_file():
        token = path.read_text(encoding="utf-8").strip()
        if token:
            return token, False
    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, (token + "\n").encode("utf-8"))
    finally:
        os.close(fd)
    os.chmod(path, 0o600)
    return token, True


def token_matches(header: str | None, token: str) -> bool:
    if not header or not token:
        return False
    prefix = "Bearer "
    if not header.startswith(prefix):
        return False
    got = header[len(prefix):].strip()
    return hmac.compare_digest(got, token)


def print_token_banner(token: str) -> None:
    print(f"Token: {token}")
    print("Paste this in Roam → Settings → Plexus Diagram → Parse helper token")
