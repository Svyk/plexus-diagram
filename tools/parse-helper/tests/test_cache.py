"""Options hash and the LRU cache. Nothing touches ~/Library."""

import json
import os
import time

from plexus_parse_helper.cache import ParseCache
from plexus_parse_helper.schema import canonical_options, options_hash


def test_options_hash_drops_scope_and_is_canonical():
    body = {"formula": False, "ocr": "auto", "pictures": True, "tables": "accurate"}
    blob = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert canonical_options({"scope": {"page": 1}}) == body
    assert options_hash(None) == options_hash({"scope": "x", "formula": False})
    assert options_hash({}) == __import__("hashlib").sha256(blob.encode()).hexdigest()
    with_pages = options_hash({"pages": [1, 3, [5, 9]]})
    assert with_pages != options_hash({})
    again = json.dumps(
        {"formula": False, "ocr": "auto", "pages": [1, 3, [5, 9]], "pictures": True, "tables": "accurate"},
        sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    assert " " not in again
    assert options_hash({"pages": [1, 3, [5, 9]]}) == __import__("hashlib").sha256(again.encode()).hexdigest()


def test_cache_roundtrip_and_lru(tmp_path):
    one = {"pad": "a" * 40}
    size = len(json.dumps(one).encode("utf-8"))
    cache = ParseCache(tmp_path, max_bytes=size * 2)
    cache.put("a" * 8, "h1", one)
    time.sleep(0.05)
    cache.put("b" * 8, "h2", {"pad": "b" * 40})
    time.sleep(0.05)
    assert cache.get("a" * 8, "h1")["pad"].startswith("a")
    time.sleep(0.05)
    cache.put("c" * 8, "h3", {"pad": "c" * 40})
    names = {p.name for p in tmp_path.glob("*/*.json")}
    total = sum(p.stat().st_size for p in tmp_path.glob("*/*.json"))
    assert total <= size * 2
    assert "h2.json" not in names
    assert cache.has("a" * 8, "h1")
    assert os.stat(cache.path_for("a" * 8, "h1")).st_size == size
