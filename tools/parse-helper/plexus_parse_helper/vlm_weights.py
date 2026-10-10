"""Pinned high-accuracy weights. The first read downloads them and checks SHA-256.

An explicit model directory (PXD_VLM_MODEL pointing at weights already on disk)
is used as given. The cache directory this module fills is checked every time.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

# PaddlePaddle/PaddleOCR-VL @ 7fa00a8c55b735ba51ba49a9058f3f9c57a99a11. Apache-2.0.
# Hashes are of that snapshot, measured from the files the helper loads.
READER_LABEL = "PaddleOCR-VL-0.9B"
READER_REPO = "PaddlePaddle/PaddleOCR-VL"
READER_REVISION = "7fa00a8c55b735ba51ba49a9058f3f9c57a99a11"
READER_LICENCE = "Apache-2.0"
READER_FILES = {
    "model.safetensors": {"sha256": "a6d433670e422e64b4403dad2465725e14f7736655b1a1d848ea0809d89b1116", "bytes": 1811260812},
    "config.json": {"sha256": "ce7f4565f8b1db78532ad5d1b9ebe55c2139d49bd4cb04778b580a08a598f171", "bytes": 2059},
    "tokenizer.json": {"sha256": "f90f04fd8e5eb6dfa380f37d10c87392de8438dccb6768a2486b5a96ee76dba6", "bytes": 11187679},
    "tokenizer_config.json": {"sha256": "166973d1c25b8362213b2c8959327308bb9f013e884ee50ebf268c34ab15120e", "bytes": 950},
    "preprocessor_config.json": {"sha256": "0c349d1210abce664bdba8986dc0637e94679b1fe90f13fcb18616a6466c4618", "bytes": 641},
    "processor_config.json": {"sha256": "1568858960a9760c54431dae693a6152e601ff55cdf6d2eab97a4a99958faea0", "bytes": 137},
    "chat_template.jinja": {"sha256": "ab4f984a185809daf6d36ebb6efa7a27c5fe7772ed7b0f0cabd3a1b30a2069cd", "bytes": 1472},
    "generation_config.json": {"sha256": "a6701d78ab3b4d972307cdec3b69d4c13f46e0d5140514f50ab7d84259324b94", "bytes": 133},
    "special_tokens_map.json": {"sha256": "215bf3a1b155fafe3497f8790bedf280af92d29c2f0286c2f87a5c78baff8f7c", "bytes": 1152},
    "added_tokens.json": {"sha256": "f59f889088e0fe21c523e7cf121bb6dca3b0bb148cb7159fbb4572c74dfc5644", "bytes": 25381},
    "modeling_paddleocr_vl.py": {"sha256": "556398ac4b9e1879066f4589dd45c3142037eea616e47d82011402206fbda28f", "bytes": 103889},
    "configuration_paddleocr_vl.py": {"sha256": "753dd93654c3a9c8c85a3eaee1e3092dd12591b0f2dce0305e1abfb7a41ff160", "bytes": 8104},
    "processing_paddleocr_vl.py": {"sha256": "e29cb1e5f275f2bd3ce051bd5c9983a33894e693b2823a0e13d4c07c8c4f9e13", "bytes": 12253},
    "image_processing_paddleocr_vl.py": {"sha256": "a4fa521b9cb16e207f94b7f2d16427771776dfc634420d319fc4916ee58049ec", "bytes": 25032},
}

# alex-dinh/PP-DocLayoutV2-ONNX @ 5e30a2650d087e23af3a8084d42bd30d135af771. Apache-2.0.
LAYOUT_REPO = "alex-dinh/PP-DocLayoutV2-ONNX"
LAYOUT_REVISION = "5e30a2650d087e23af3a8084d42bd30d135af771"
LAYOUT_FILE = "PP-DocLayoutV2.onnx"
LAYOUT_SHA256 = "2009fcb35e64085ab9f6f2b27aca550edc29a040a24f7d6a0f05b74a2f804860"
LAYOUT_BYTES = 213963712
LAYOUT_LICENCE = "Apache-2.0"


def sha256_file(path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_tree(root, files: dict) -> None:
    """Raise ValueError unless every pinned file is present and matches."""
    root = Path(root)
    missing = []
    mismatch = []
    for name, spec in files.items():
        path = root / name
        if not path.is_file():
            missing.append(name)
            continue
        if path.stat().st_size != spec["bytes"] or sha256_file(path) != spec["sha256"]:
            mismatch.append(name)
    if missing or mismatch:
        raise ValueError(f"weight sha256 check failed: missing {missing or '-'} mismatch {mismatch or '-'}")


def verify_layout_file(path) -> None:
    path = Path(path)
    if not path.is_file() or path.stat().st_size != LAYOUT_BYTES or sha256_file(path) != LAYOUT_SHA256:
        raise ValueError("layout sha256 check failed")


def ensure_reader(dest) -> str:
    """Download the pinned reader into `dest` if the check does not already pass."""
    dest = Path(dest)
    try:
        verify_tree(dest, READER_FILES)
        return str(dest)
    except ValueError:
        pass
    dest.mkdir(parents=True, exist_ok=True)
    from huggingface_hub import hf_hub_download

    for name, spec in READER_FILES.items():
        path = dest / name
        if path.is_file() and path.stat().st_size == spec["bytes"] and sha256_file(path) == spec["sha256"]:
            continue
        path.unlink(missing_ok=True)
        hf_hub_download(READER_REPO, name, revision=READER_REVISION, local_dir=str(dest))
    verify_tree(dest, READER_FILES)
    return str(dest)


def ensure_layout(dest) -> str:
    """Download the pinned layout graph. `dest` is the onnx file path."""
    dest = Path(dest)
    if dest.is_file():
        verify_layout_file(dest)
        return str(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    from huggingface_hub import hf_hub_download

    fetched = Path(hf_hub_download(LAYOUT_REPO, LAYOUT_FILE, revision=LAYOUT_REVISION))
    verify_layout_file(fetched)
    if fetched.resolve() != dest.resolve():
        dest.write_bytes(fetched.read_bytes())
        verify_layout_file(dest)
        return str(dest)
    return str(fetched)
