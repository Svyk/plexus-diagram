"""LaunchAgent plist for `serve`. Built in code so a `uv tool install` copy needs no data files."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

PLIST_LABEL = "com.plexus.parse-helper"
AGENT_PATH = Path.home() / "Library" / "LaunchAgents" / f"{PLIST_LABEL}.plist"


def resolve_bin() -> str:
    """The `plexus-parse-helper` executable launchd should run: the one that started this
    process, else PATH, else the uv tool dir. Never a path inside site-packages."""
    argv0 = Path(sys.argv[0]) if sys.argv and sys.argv[0] else None
    if argv0 and argv0.name == "plexus-parse-helper" and argv0.is_file():
        return str(argv0.resolve())
    found = shutil.which("plexus-parse-helper")
    if found:
        return str(Path(found).resolve())
    fallback = Path.home() / ".local" / "bin" / "plexus-parse-helper"
    if fallback.exists():
        return str(fallback)
    dev = Path(__file__).resolve().parents[1] / "bin" / "plexus-parse-helper"
    return str(dev)


def render_plist(bin_path: str, home: Path | None = None) -> dict:
    home = Path(home) if home else Path.home()
    log = str(home / "Library" / "Logs" / "plexus-parse-helper.log")
    return {
        "Label": PLIST_LABEL,
        "ProgramArguments": [bin_path, "serve"],
        "RunAtLoad": True,
        "KeepAlive": False,
        "StandardOutPath": log,
        "StandardErrorPath": log,
        "EnvironmentVariables": {
            "PATH": os.pathsep.join([str(home / ".local" / "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]),
        },
    }
