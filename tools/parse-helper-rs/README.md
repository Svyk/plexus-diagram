# plexus-parse-helper-rs

The default local parse helper on macOS. It speaks the same HTTP contract as `tools/parse-helper` for `/v1/health`, `/v1/pair`, `/v1/ocr` (Apple Vision, pdfium, the same 300 dpi tiling), and `/v1/cloud/parse` (LlamaParse). It does not run Docling or TableFormer. `/v1/jobs` returns 501. The Python helper stays available as the Docling add-on (`install.sh --docling`).

On any system that is not macOS the binary exits immediately and names the Python install. Apple Vision is the only OCR engine here.

Not part of the npm bundle. `target/` and the downloaded `libpdfium` dylib are gitignored.

## Build

From `tools/parse-helper-rs`, on macOS:

```sh
./fetch-pdfium.sh
cargo build --release
```

`./fetch-pdfium.sh arm64` or `./fetch-pdfium.sh x64` picks the library. With no argument it follows `uname -m`. It downloads bblanchon/pdfium-binaries chromium/8086 (`pdfium-mac-arm64.tgz` or `pdfium-mac-x64.tgz`) and extracts `vendor/libpdfium.dylib` (about 7.0 MB, BSD). The release binary is 8.2 MB (it was 5.1 MB before the LlamaParse client; reqwest and rustls added 3.1 MB). Together with libpdfium that is about 15 MB, plus nothing else. The Python helper's uv tool on this machine is 1.1 GB.

## Run

Default port is **48766**, so a development copy can sit next to a helper already on 48765. The installer runs it on **48765**. It binds `127.0.0.1` only.

```sh
./target/release/plexus-parse-helper-rs serve --port 48766
./target/release/plexus-parse-helper-rs ocr page.pdf --pages 1,3,5-9 --json out.json
```

It reads the same token file as the Python helper (`~/Library/Application Support/plexus-parse-helper/token`) and the same 90 s pair window. OCR JSON is cached under `~/Library/Caches/plexus-parse-helper-rs`, not the Python cache, so the two processes cannot serve each other's pages.

Point the scan bench at it:

```sh
node tools/parse-bench/scan.mjs scan.pdf truth.json --helper-url http://127.0.0.1:48766
```

`--helper-token` overrides the token. Otherwise the bench uses `$PXD_HELPER_TOKEN` or the token file above. Omit `--helper-url` and the bench keeps using the Python CLI.

## What matches

- Helper name `plexus-parse-helper`, schema `pxd-parse/1`. Version is `0.1.0-rs`.
- Unauthed `GET /v1/health` is 401 `{"helper":"plexus-parse-helper","auth":"required"}`.
- Authed health: `engines` is `["ocr", "cloud"]`. `models.layout` and `models.tableformer` are `"missing"`, `models.ocr` is `"ready"`, `warm` is false.
- Origin is checked before the body. Allowed origin defaults to `https://roamresearch.com`. CORS mirrors the Python helper, including `Access-Control-Allow-Private-Network: true`. OPTIONS is 204. `Access-Control-Allow-Headers` is `Authorization, Content-Type, X-Pxd-Options, X-Pxd-Cloud-Key`.
- `GET /v1/pair` returns the token once while the window is open and the Origin is allowed. Otherwise 404.
- `POST /v1/ocr` takes the PDF (200 MB cap) and `X-Pxd-Options` `{pages, cells}`. Page response is `pxd-ocr/1`: `pageCount`, `pages` (word `items`, `rules`, `deskew`, `dpi`), `sha256`, `elapsedMs`, `cached`. Cell response is `{cells:[{page,bbox,text,conf,glyph}]}` and is never cached.
- Options hashes match the Python helper (see `src/hashutil.rs` tests).

## Cloud (`POST /v1/cloud/parse`)

The extension cannot call LlamaParse (CORS). It posts the PDF here. The helper bearer is `Authorization`. The LlamaParse key is `X-Pxd-Cloud-Key` for that request only: it is not stored, logged, or copied into an event. `X-Pxd-Options` is `{region, tier, version}`. `region` is `us` (default) or `eu`. `tier` is `fast`, `cost_effective`, `agentic` (default), or `agentic_plus`. `version` is accepted and ignored; the upstream body always sends `"version":"latest"`, same as the Python helper.

The response is `text/event-stream`:

- `started` `{"job":"c_" + sha256(pdf)[:8]}`. A second job for the same bytes while the first is still running uses `c_<8hex>_<n>`.
- `progress` `{"status":"uploading"}`, then `{"status":"starting"}`, then `{"status","job"}` where `job` is the upstream LlamaParse id.
- `result` the provider JSON, plus `grounded_pages` when the cell sidecar is fetched.
- `error` `{"code","message","status"}`. Provider 401 is `unauthorized`, 402 is `credits`, the 240 s deadline is `504` / `timeout`. The HTTP status of the POST stays 200; the error is an event. A missing helper bearer is HTTP 401 `{"error":"unauthorized"}` and is not an event.

`DELETE /v1/cloud/parse/{job_id}` is 204 or 404. It accepts the helper id from `started` and the upstream id from `progress`, because the extension's SSE reader replaces the helper id with that upstream id before it cancels. The helper then POSTs `{base}/api/v2/parse/{upstream}/cancel`.

Upstream is `https://api.cloud.llamaindex.ai` or `https://api.cloud.eu.llamaindex.ai`: upload `POST /api/v1/beta/files` (multipart, purpose `parse`), start `POST /api/v2/parse` with `output_options.granular_bboxes = ["cell"]`, poll with backoff 1 s, 2 s, 4 s, 8 s, then `GET` the same job with `expand=items&expand=markdown&expand=usage`. The sidecar URL must be `https://` (8 MB cap, no Authorization header). The HTTP client is reqwest on rustls, with no OpenSSL and no system proxy.

## What it does not do

- `/v1/jobs`, `/v1/jobs/{id}`, and `/v1/jobs/{id}/events` return 501 `{"error":"layout model is not wired; this helper serves /v1/ocr only","code":"no-docling"}`. Cloud parse has its own SSE stream on `/v1/cloud/parse`.
- `POST /v1/models/download` returns the same 501.
- No TableFormer, no formula model, no Docling layout.

`swift/docrec.swift` is a probe of macOS 26 `RecognizeDocumentsRequest`, not a server dependency:

```sh
swiftc -O -parse-as-library -o /tmp/docrec swift/docrec.swift
/tmp/docrec page.png
```

It prints `{tableCount, tables:[{rows, cols, text}]}`. On this machine it did not beat the rule-and-assembly path (see the numbers below), so nothing calls it.

## Numbers (this Mac: M1 Max, macOS 26)

Uncached `/v1/ocr` or the equivalent in-process `ocr_pdf`. Cell F1 is `scan.mjs` against the truth file (structure F1 was 1.000 on every table below).

| | Python helper | Rust helper |
| --- | --- | --- |
| Install | 1.1 GB (uv tool) | 15.2 MB (8.2 MB binary + 7.0 MB libpdfium) |
| Cold start to first `/v1/health` 401 | 0.42 s, 74 MB RSS | 0.43 s, 27 MB RSS |
| CDC image-only, 1 page | 11.19 s, 651 words, 34 rules | 10.87 s, 651 words, 34 rules, 212 MB RSS after |
| report-scan, 3 pages | 7.92 s (2.64 s/page) | 7.73 s (2.58 s/page), 280 MB RSS after |
| CDC cell F1 | 0.957 | 0.957 |
| report-scan cell F1 (t1, t2, t3) | 0.974, 0.952, 1.000 | 0.974, 1.000, 1.000 |

Vision dominates the page time. The Rust port is not faster. The Python figure is an in-process call with the repo's Python 3.14, not a restart of the LaunchAgent on 48765. Peak RSS of that Python process, which OCR'd both files, was 344 MB.

`RecognizeDocumentsRequest` (300 dpi for the fixtures, 200 dpi for the scans), one page each:

| Page | Truth | Document API |
| --- | --- | --- |
| CDC | 51×11 | 0 tables, 1.4 s |
| report-scan p1 | 7×7 | 7×7 in 0.8 s, cells split across rows |
| report-scan p3 | 7×6 | 7×6 in 0.7 s, site ids split, zone column empty |
| naca-supercharger p15 | 12×4 | 0 tables, 1.2 s |
| nbs-redwood p5 | 13×6 | 14×6 in 0.9 s, header split into empty rows |
| usda-electroculture p10 | 6×10 | 5×10 in 1.0 s, year columns duplicated |

## Layout models (not wired)

Docling's Heron layout model is on disk as `model.safetensors` (164 MB, Apache-2.0, `RTDetrV2ForObjectDetection`). There is no ONNX file in that snapshot, and the `ort` crate loads ONNX, not safetensors. TableFormer accurate (203 MB) and fast (139 MB) are safetensors inside `docling-models` (CDLA-Permissive-2.0). No ONNX export was produced, and no layout model was added to this crate: a layout box is not a cell, and the document API above, which does return cells, lost to assembly on these pages.

## Release

Tag `helper-rs-v*` (for example `helper-rs-v0.1.0`). That tag, and a manual run of `.github/workflows/helper-rs.yml`, builds `plexus-parse-helper-rs` on `macos-14` (arm64) and `macos-15-intel` (x86_64). Each job runs `fetch-pdfium.sh` for its architecture, `cargo build --release --locked`, ad-hoc `codesign`s the binary and `libpdfium.dylib`, and packs them as:

- `plexus-parse-helper-rs-macos-arm64.tar.gz`
- `plexus-parse-helper-rs-macos-x86_64.tar.gz`

The release job writes `SHA256SUMS` (sha256sum, two spaces, the file name) and uploads the three files to that GitHub release. A manual run uploads only when its `tag` input is an existing `helper-rs-v*` tag (`gh release create --verify-tag` does not create a tag).

Check the install on a Mac without touching a helper already on 48765. `launchctl bootout` is by label, so a real `launchctl` and the real LaunchAgents directory would stop that helper. Point both at a stub and a temporary directory, and use another port:

```sh
PLEXUS_HELPER_PREFIX=/tmp/plexus-parse-helper \
PLEXUS_HELPER_PORT=48767 \
PLEXUS_LAUNCH_AGENTS_DIR=/tmp/plexus-parse-helper-agents \
PLEXUS_LAUNCHCTL=/usr/bin/true \
PLEXUS_HELPER_LOG=/tmp/plexus-parse-helper.log \
sh tools/parse-helper/install.sh
```

`/usr/bin/true` stands in for `launchctl`, so nothing is loaded or stopped. The script downloads the archive for `uname -m` from `github.com/Svyk/plexus-diagram` releases, checks `SHA256SUMS`, and copies the binary and `libpdfium.dylib` into the prefix `bin` directory. The plist it writes is `com.plexus.parse-helper` with `--port` and `--pdfium`, under the temporary agents directory. Pairing then runs the binary directly. If the label is already loaded and this is not `--replace`, a real `launchctl` refuses and leaves the logged-in helper running. `--uninstall` bootouts only when the agents directory is `~/Library/LaunchAgents`. curl does not set Gatekeeper quarantine. A browser download needs `xattr -d com.apple.quarantine` on the binary (the installer clears the attribute when it is present).

## Recommendation

This is the helper the extension launches for scans on macOS. It matches the Python helper's OCR quality and its seconds per page, in about 15 MB instead of 1.1 GB. `/v1/jobs` stays on the Python add-on until TableFormer is actually replaced. A second Vision process does not make OCR faster.
