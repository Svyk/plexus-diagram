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
| source_commit | `968036d7cf46d1346f8322fc894146183765a0e2` |
| tags | diagram, whiteboard, canvas, blocks |

`source_commit` is `968036d`, the `main` commit `PXD-17: Shrink the bundle, keep features`. It has the Depot build without OCR or anydoc, auto-enhance off for new users, the dark-mode linked references fix, the smaller bundle, and the 3.38 README images. It is after the `v3.38.0` tag, so it holds changes listed under Unreleased in `CHANGELOG.md`; the package version is still 3.38.0.

## Pull request

Title: `Add Plexus Diagram`

Body:

```
Add extensions/Svyk/plexus-diagram.json.

Source: https://github.com/Svyk/plexus-diagram
Commit: 968036d7cf46d1346f8322fc894146183765a0e2
```

Fork `Roam-Research/roam-depot`, copy the JSON to `extensions/Svyk/plexus-diagram.json`, and open that pull request only when you decide to. This draft does not do that.

## What the reviewer will build

`build.sh` runs `npm ci --ignore-scripts --no-audit --no-fund` and then `node build.mjs`. The repo root has `README.md`, `extension.js`, `extension.css`, `CHANGELOG.md`, and `LICENSE` (MIT). The package version is 3.38.0.

## Open before submitting

From the 2026-10-29 Depot research:

- The repo-root `extension.js` is the Depot build: no In-browser reading (beta) and no anydoc converter, so nothing is fetched from outside the bundle. `deploy/extension.js` is the GitHub Pages build and keeps both.
- `extension.js` is about 2.1 MiB and `extension.css` about 240 KiB. Depot sets no limit, but Roam asks that heavy dependencies load lazily. Rarely used code is carried lazily inside `extension.js` (see Note for the reviewer).
- README images use relative paths. Other Depot READMEs use absolute `raw.githubusercontent.com` URLs; whether Roam resolves relative ones is unchecked.

## Note for the reviewer

`extension.js` holds rarely used code as deflated, base64 text and runs it with `new Function` on first use. The text is built from this repository by `build.sh` (`scripts/pieces.mjs`, `src/piece-loader.js`); nothing is fetched. Depot publishes only `extension.js` and `extension.css`, so this is how the extension starts light without loading remote code. If a reviewer objects, listing no pieces in `scripts/pieces.mjs` gives one plain minified bundle with the same features.
