# plexus-parse-helper

Local Docling service for Plexus Diagram. It listens on `127.0.0.1:48765` and returns `pxd-parse/1` JSON. It never writes the Roam graph.

## Run

```sh
tools/parse-helper/bin/plexus-parse-helper serve
tools/parse-helper/bin/plexus-parse-helper token
tools/parse-helper/bin/plexus-parse-helper parse path/to/file.pdf --json /tmp/out.json
tools/parse-helper/bin/plexus-parse-helper parse path/to/file.pdf --pages 1,3,5-9 --formula
```

The launcher uses `/opt/homebrew/opt/python@3.14/bin/python3.14` when `docling`, `fastapi`, `uvicorn`, and `pypdfium2` import. Otherwise it uses `uv run --python 3.12`. `--workers` is accepted and ignored: one job runs at a time, in one worker process.

`serve` binds only to `127.0.0.1`. The first launch writes a token to `~/Library/Application Support/plexus-parse-helper/token` (mode `0600`) and prints:

```
Token: …
Paste this in Roam → Settings → Plexus Diagram → Parse helper token
```

`install-agent` writes `~/Library/LaunchAgents/com.plexus.parse-helper.plist` (built in `agent.py`, pointing at the installed `plexus-parse-helper`), reloads the agent and starts it. Running it twice is safe. Do not run it from a work order.

## Install and pair

```sh
curl -fsSL https://svyk.github.io/plexus-diagram/helper/install.sh | sh -s -- --docling
```

On a Mac the same script with no arguments installs the light Rust helper (`tools/parse-helper-rs`). `--docling`, and any install on another system, keeps this Python path: `uv` when it is missing, `uv tool install --force "git+https://github.com/Svyk/plexus-diagram#subdirectory=tools/parse-helper"`, `install-agent`, a wait until the helper answers, the pairing window, and "Back to Roam: click Pair.". `--docling --vlm` installs the same helper with `mlx-vlm` and `onnxruntime`. The first high-accuracy read then downloads PaddleOCR-VL-0.9B (about 1.8 GB) and PP-DocLayoutV2 (about 204 MB). Both weights are Apache-2.0. The source is `tools/parse-helper/install.sh`; `npm run build` copies it to `deploy/helper/install.sh`.

`plexus-parse-helper pair` opens a 90 s window (a `0600` file `pair-until` beside the token). While it is open, `GET /v1/pair` from an allowed `Origin` returns `{token, helper, version}` once and closes the window. Outside the window, without an `Origin`, or from any other `Origin`, the route is `404` (a disallowed `Origin` is `403`, as everywhere). The Roam **Pair** button calls it and stores the token, so nothing is copied by hand. Pasting the token in Settings still works.

## HTTP

All routes except a rejected `Origin` require `Authorization: Bearer <token>`. Health without a token is `401` `{"helper":"plexus-parse-helper","auth":"required"}`. Any other route without a token is `401` `{"error":"unauthorized"}`.

| Method | Path | Result |
|---|---|---|
| GET | `/v1/health` | `{helper, version:"0.1.0", schema:"pxd-parse/1", engines:["docling","ocr","cloud"], models, busy, warm}`. `engines` also lists `vlm-tables` when mlx-vlm is installed, and `vlm-layout` plus `vlm-text` when onnxruntime is installed as well |
| GET | `/v1/pair` | no bearer. `200` `{token, helper, version}` once while the pairing window is open and `Origin` is allowed; else `404` |
| GET | `/v1/models` | `{state:"ready"\|"missing"\|"downloading", items:[{name, state, bytes, done}], bytes, done, fraction}`. `bytes`/`done` on a missing model are the expected size and what is on disk now (partial files count), so the Engines row shows a progress bar |
| POST | `/v1/models/download` | `202` starts `docling-tools models download` |
| DELETE | `/v1/models/download` | `200` `{stopped}` stops a running download; files already fetched stay |
| HEAD, GET | `/v1/cache/{sha256}?opts={optsHash}` | cached document, or 404 |
| POST | `/v1/jobs` | body is the PDF (max 200 MB). `X-Pxd-Options` is JSON. `202` `{job, sha256, pages, cached}` |
| POST | `/v1/ocr` | body is the PDF. `X-Pxd-Options` `{pages}` → `200` `{schema:"pxd-ocr/1", pageCount, pages:[…], sha256, elapsedMs, cached}` (Vision word boxes + OpenCV rules for scanned pages, cached by sha256 + pages, 50 pages per call). `{cells:[{page, bbox}]}` → `{cells:[{page, bbox, text, conf, glyph}]}`, a 3× re-read of single cells, never cached (400 cells per call). Synchronous; one OCR runs at a time. |
| POST | `/v1/tables` | body is the PDF. `X-Pxd-Options` `{pages, tables:[{page, bbox}]}`. Each `bbox` is PDF points, origin top-left. `200` `{model:"PaddleOCR-VL-0.9B", tables:[{page, bbox, rows, cols, cells}]}`. `404` `{"error":"vlm-tables is not installed"}` when mlx-vlm is absent. One table read at a time. |
| POST | `/v1/vlm` | body is the PDF. `X-Pxd-Options` `{pages, tables, text}`. `tables` are the caller's boxes, used on a page the layout model does not mark as a table. `text` true also reads text regions. `200` `{model, layoutModel:"PP-DocLayoutV2", tables, lines:[{page, bbox, text}], figures:[{page, bbox, label, score}], layout:[{page, label, score, bbox}]}`. `404` `{"error":"vlm-layout is not installed"}` when high accuracy is absent. |
| GET | `/v1/jobs/{id}/events` | SSE `progress`, `page`, `done`, `error` |
| GET | `/v1/jobs/{id}` | the document when `done`, else `{state}` |
| DELETE | `/v1/jobs/{id}` | `204` cancels a running job (kills and respawns the worker). `404` otherwise |
| POST | `/v1/cloud/parse` | body is the PDF. `Authorization` is the helper token. `X-Pxd-Cloud-Key` is the LlamaParse key (not stored, not copied into the SSE). `X-Pxd-Options` is `{region, tier, version, pages}`. `pages` is a LlamaParse `target_pages` string (`"4"`, `"10,11"`); omit it to parse the whole file. SSE `started` `{job}`, then `progress`, then `result` (provider JSON) or `error` `{code, message, status}` |
| DELETE | `/v1/cloud/parse/{id}` | `204` cancels that cloud job. `404` if it is unknown |

A second `POST /v1/jobs` while one job is running is `409` `{"running":"j_…"}`. `pages` in the 202 body is the PDF page count.

`OPTIONS` for an allowed origin answers `204` with `Access-Control-Allow-Origin` (the request origin), `Vary: Origin`, `Access-Control-Allow-Headers: Authorization, Content-Type, X-Pxd-Options, X-Pxd-Cloud-Key`, `Access-Control-Allow-Methods: GET, POST, DELETE, HEAD, OPTIONS`, and `Access-Control-Allow-Private-Network: true`. The allowlist is `https://roamresearch.com` plus `--allow-origin`. Any other `Origin` is `403` before the body is read.

SSE events:

- `progress` `{page, of, ms}`
- `page` `{page, blocks}`
- `done` `{sha256, optsHash, elapsedMs}`
- `error` `{code, message}`

## Options hash

Other units must hash the same object. Fill defaults, drop `scope`, keep `pages` only when the client sent them (do not sort the page list), then SHA-256 hex of canonical JSON (`sort_keys`, separators `("," , ":")`, `ensure_ascii` false).

```json
{"formula":false,"ocr":"auto","pictures":true,"tables":"accurate"}
```

With pages `[1, 3, [5, 9]]` the hashed object also has `"pages":[1,3,[5,9]]`. `ocr` is `auto` | `on` | `off`. `tables` is `accurate` | `fast`. `formula` defaults to false. A request with `scope` is never cached.

Cache files are `~/Library/Caches/plexus-parse-helper/<sha256>/<optsHash>.json`, LRU at 5 GB.

## Document

`convert_docling(doc, *, sha256="", options=None, engine_version="docling-2.91.0", created_at=None) -> dict`

`refine_document(doc, pdf_path, *, ocr=True) -> dict`

## OCR page records (`pxd-ocr/1`)

`tools/parse-helper/bin/plexus-parse-helper ocr file.pdf --pages 25 --json out.json` and
`--cells cells.json` (a JSON list of `{page, bbox}`) are the CLI forms of `/v1/ocr`.

`ocr_pdf(pdf_path, pages=None) -> {"schema": "pxd-ocr/1", "pageCount", "pages": [record]}`.
A record is what the engine's `parsePageGeometry` takes in place of pdf.js data:

```json
{"n": 1, "w": 597.4, "h": 405.1, "rotation": 0, "transform": [1, 0, 0, 1, 0, 0], "scan": true,
 "dpi": 300, "deskew": 0.0, "fonts": {"ocr": {"name": "ocr"}}, "ops": {"fnArray": [], "argsArray": []},
 "items": [{"str": "0.05", "transform": [5.9, 0, 0, 5.9, 251.8, 46.6], "width": 11.5, "height": 5.9,
            "y0": 41.9, "y1": 47.9, "fontName": "ocr", "conf": 1.0}],
 "rules": [{"x0": 103.4, "y0": 19.6, "x1": 568.1, "y1": 19.6, "thick": 0.5}]}
```

Coordinates are PDF points with the origin at the top-left of the rendered page after
deskew (`deskew` is the angle applied, degrees, counter-clockwise positive). Each item is one
word: `transform[4]` is its left edge, `transform[5]` its baseline (from the ink), `width` its
ink width, `y0`/`y1` the box the engine should use, `conf` Vision's candidate confidence (0.3,
0.5 or 1). Rules are segments in the same frame. The page is read in overlapping tiles (Vision
returns at most about 250 observations per image), words are deduplicated by overlap, word
sizes within 0.45–1.5× of the page's body size snap to it, and a second pass with language
correction replaces words that have letters when it is at least as confident.

`ocr_cells(pdf_path, cells) -> {"cells": [{page, bbox, text, conf, glyph}]}`: each cell is
cropped from the page render, upscaled 3×, padded and read alone; `glyph` is `—`, `*` or
`null` from an ink check (one thin solid run, one small blob), independent of `text`.

Tests: `tests/test_ocr.py` runs on a saved Vision result (`tests/fixtures/ocr-table.vision.json`,
made from `ocr-table.png`), so CI needs no Vision; the server tests stub the OCR runners
(`create_app(..., ocr_runner=, cell_runner=)`).

Blocks are keyed by id (`b` text, `l` list, `t` table, `f` figure, `e` formula, `c` caption, `n` footnote, `k` code). Coordinates are PDF points, origin top-left. Table cells are anchors only (`r`, `c`, `rowSpan`, `colSpan`, `text`, `header`, `bbox`, `align`, `numeric`). `headerRows` counts leading rows whose cells are all column headers. `method` is `"tableformer"`. `grid` is `{xs, ys}`. Images are not embedded. Page headers and footers go to `removed[]` with `running-header` or `running-footer`.

`score.score_document(doc, truth) -> {structureF1, cellF1, headingAccuracy, furnitureRemoved, tables}`. Structure F1 is `(r, c, rowSpan, colSpan)`. Cell F1 adds NFKC text with collapsed spaces, case kept. Both headline numbers are micro (pooled cells).

## Models

Layout about 164 MB, TableFormer about 342 MB, CodeFormula about 610 MB, already in the Hugging Face cache. OCR is ocrmac (Vision) when `import ocrmac` works, otherwise RapidOCR. Formula enrichment is off unless the request sets `formula: true`.

## Measurements

Times are wall clock on this machine with models already cached. Structure and cell F1 are against `test/fixtures/pdf/report.truth.json`. attention.pdf has no truth file.

| PDF | formula | seconds | tables | structure F1 | cell F1 | heading accuracy |
|---|---|---|---|---|---|---|
| report.pdf | off | 8.61 | 3 | 1.0 | 1.0 | 1.0 |
| report.pdf | on | 35.93 | 3 | 1.0 | 1.0 | 1.0 |
| report-scan.pdf | off | 13.33 | 3 | 1.0 | 0.918 | 1.0 |
| attention.pdf | off | 17.12 | 4 |  |  |  |

attention.pdf is local-only (arXiv 1706.03762, 15 pages) and has no truth file. Models were already in the Hugging Face cache. Times are one cold process each, on this machine.
