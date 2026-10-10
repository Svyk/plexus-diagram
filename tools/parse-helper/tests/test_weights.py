"""The weight pins match what the Hub serves at the pinned revisions.

tests/fixtures/hub-listing.json is the recorded Hub tree listing (sizes for every
file, SHA-256 for LFS files). Pinning a file that was rewritten on this machine
(an MLX re-save, a tokenizer config written back by transformers) made a clean
install download the Hub file and then fail its own check. Set PXD_HUB_CHECK=1
to compare against the live Hub API as well.
"""

import json
import os
from pathlib import Path

import pytest

from plexus_parse_helper import vlm_weights as w

LISTING = Path(__file__).parent / "fixtures" / "hub-listing.json"

PINS = [
    (w.READER_REPO, w.READER_REVISION, w.READER_FILES),
    (w.TEXT_REPO, w.TEXT_REVISION, w.TEXT_FILES),
    (w.LAYOUT_REPO, w.LAYOUT_REVISION, {w.LAYOUT_FILE: {"sha256": w.LAYOUT_SHA256, "bytes": w.LAYOUT_BYTES}}),
]


def _recorded():
    data = json.loads(LISTING.read_text())
    return {(r["repo"], r["revision"]): {f["path"]: f for f in r["files"]} for r in data["repos"]}


def _check(files: dict, listing: dict, where: str):
    problems = []
    for name, spec in files.items():
        entry = listing.get(name)
        if entry is None:
            problems.append(f"{name}: not in the {where} listing")
            continue
        if entry["size"] != spec["bytes"]:
            problems.append(f"{name}: pinned {spec['bytes']} bytes, {where} has {entry['size']}")
        if entry.get("sha256") and entry["sha256"] != spec["sha256"]:
            problems.append(f"{name}: pinned sha256 {spec['sha256'][:12]}, {where} has {entry['sha256'][:12]}")
    assert not problems, "\n".join(problems)


@pytest.mark.parametrize("repo,revision,files", PINS, ids=[p[0] for p in PINS])
def test_pins_match_the_recorded_hub_listing(repo, revision, files):
    recorded = _recorded()
    assert (repo, revision) in recorded, f"no recorded listing for {repo}@{revision}; re-record the fixture"
    _check(files, recorded[(repo, revision)], "recorded Hub")


def test_reader_pin_is_the_hub_file_not_a_local_resave():
    model = w.READER_FILES["model.safetensors"]
    assert model["bytes"] == 1917255968
    assert model["sha256"].startswith("3085f1042e18")
    assert w.READER_FILES["tokenizer_config.json"]["bytes"] == 185587


def test_verify_tree_rejects_a_file_of_another_size(tmp_path):
    (tmp_path / "config.json").write_bytes(b"{}")
    with pytest.raises(ValueError, match="mismatch \\['config.json'\\]"):
        w.verify_tree(tmp_path, {"config.json": {"sha256": "0" * 64, "bytes": 2}})


@pytest.mark.skipif(os.environ.get("PXD_HUB_CHECK") != "1", reason="set PXD_HUB_CHECK=1 to query the Hub API")
@pytest.mark.parametrize("repo,revision,files", PINS, ids=[p[0] for p in PINS])
def test_pins_match_the_live_hub_listing(repo, revision, files):
    import urllib.request

    url = f"https://huggingface.co/api/models/{repo}/tree/{revision}?recursive=true"
    with urllib.request.urlopen(url, timeout=60) as response:
        entries = json.load(response)
    listing = {e["path"]: {"size": e["size"], "sha256": (e.get("lfs") or {}).get("oid")} for e in entries if e["type"] == "file"}
    _check(files, listing, "live Hub")
