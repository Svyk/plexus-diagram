"""LRU JSON cache: <root>/<sha256>/<optsHash>.json, default 5 GB."""

from __future__ import annotations

import json
import os
from pathlib import Path

DEFAULT_ROOT = Path.home() / "Library" / "Caches" / "plexus-parse-helper"
DEFAULT_MAX_BYTES = 5 * 1024 ** 3


class ParseCache:
    def __init__(self, root: Path | None = None, max_bytes: int = DEFAULT_MAX_BYTES):
        self.root = Path(root) if root else DEFAULT_ROOT
        self.max_bytes = max_bytes

    def path_for(self, sha256: str, opts_hash: str) -> Path:
        return self.root / sha256 / f"{opts_hash}.json"

    def has(self, sha256: str, opts_hash: str) -> bool:
        return self.path_for(sha256, opts_hash).is_file()

    def get(self, sha256: str, opts_hash: str) -> dict | None:
        path = self.path_for(sha256, opts_hash)
        if not path.is_file():
            return None
        os.utime(path, None)
        return json.loads(path.read_text(encoding="utf-8"))

    def put(self, sha256: str, opts_hash: str, doc: dict) -> Path:
        path = self.path_for(sha256, opts_hash)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
        self.evict()
        return path

    def evict(self) -> list[Path]:
        files = [p for p in self.root.glob("*/*.json") if p.is_file()]
        files.sort(key=lambda p: p.stat().st_mtime)
        total = sum(p.stat().st_size for p in files)
        removed = []
        for path in files:
            if total <= self.max_bytes:
                break
            size = path.stat().st_size
            path.unlink(missing_ok=True)
            total -= size
            removed.append(path)
            parent = path.parent
            try:
                parent.rmdir()
            except OSError:
                pass
        return removed
