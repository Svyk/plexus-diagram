# Depot listing draft

This folder is the Roam Depot material for Plexus Diagram. Nothing here is read at runtime. The pull request against `Roam-Research/roam-depot` has not been opened.

## Description

Plexus Diagram is a whiteboard on a Roam `{{[[diagram]]}}` block. Cards, sections, and connections are ordinary blocks. A board or a section can follow a block's children, a query, linked references, a page's headings, journals, the Inbox, or another board. Graph links already in the graph draw as arrows. Restore native diagram hands the block back to Roam's own diagram view.

The product page Roam renders is the repository `README.md` at `source_commit`. The short line in the metadata file is the marketplace blurb.

## Screenshots

Taken on 3.38.0 in Roam Desktop, on a scratch board in a test graph, with the light and the dark Roam theme. They are the README images in `docs/img/`.

![A reading-map board in the light theme](../img/board-light.png)

![The same board in a dark Roam theme](../img/board-dark.png)

![The tool dock with the Card tool active](../img/palette.png)

## Metadata

`extensions/Svyk/plexus-diagram.json` is the file a fork would place at `extensions/Svyk/plexus-diagram.json`.

| Field | Value |
|---|---|
| name | Plexus Diagram |
| author | Svyatoslav Kleshchev |
| source_url | https://github.com/Svyk/plexus-diagram |
| source_repo | https://github.com/Svyk/plexus-diagram.git |
| source_commit | `d7b48d6a69d4b6394a96f50a6f655f16ba8d546b` |
| tags | diagram, whiteboard, canvas, blocks |

`source_commit` is the 3.38.0 release, the commit the annotated tag `v3.38.0` points to (`PXD-12: Release 3.38: README+CHANGELOG`). It is on `origin/main`.

The README at that commit still shows the 2.x screenshots, because the new ones landed after the tag. Roam renders the README at `source_commit`, so before opening the pull request either move `source_commit` to a later `main` commit that has the new images (the extension code is the same 3.38.0), or wait for the next release.

## Pull request

Title: `Add Plexus Diagram`

Body:

```
Add extensions/Svyk/plexus-diagram.json.

Source: https://github.com/Svyk/plexus-diagram
Commit: d7b48d6a69d4b6394a96f50a6f655f16ba8d546b
```

Fork `Roam-Research/roam-depot`, copy the JSON to `extensions/Svyk/plexus-diagram.json`, and open that pull request only when you decide to. This draft does not do that.

## What the reviewer will build

`build.sh` runs `npm ci --ignore-scripts --no-audit --no-fund` and then `node build.mjs`. The repo root has `README.md`, `extension.js`, `extension.css`, `CHANGELOG.md`, and `LICENSE` (MIT). The package version is 3.38.0.

## Open before submitting

From the 2026-10-29 Depot research, still open at 3.38.0:

- The OCR beta loads onnxruntime-web from cdn.jsdelivr.net, and the anydoc converter fetches its wasm from svyk.github.io. Both are hash-pinned but outside the reviewed bundle. Expect Roam's eval warning, which blocks install for a whole graph, or a rejection. Leaving both out of the Depot build avoids it.
- `extension.js` is about 4.6 MiB. Depot sets no limit, but Roam asks that heavy dependencies load lazily.
- Every diagram is a Plexus board is on by default. A reviewer may read that as replacing a native feature.
- README images use relative paths. Other Depot READMEs use absolute `raw.githubusercontent.com` URLs; whether Roam resolves relative ones is unchecked.
