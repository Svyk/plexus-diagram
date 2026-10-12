# PhD stress builder

Turns a `pxd-phd/1` blueprint (`~/wo/pxd-phd/schema.md`) into a real Plexus world in the **Readwisenotes** graph:
nested boards, sections, cards of every kind, connections, Roam PDF pages with real Roam highlights, pins, regions,
comments, saved views, snapshots, trails and daily-note inbox mentions. Used to stress Plexus's speed and stability.

Only the Readwisenotes window (Roam Desktop CDP `127.0.0.1:9223`, title starting "Readwisenotes") is touched. The
builder refuses any other graph.

## Commands

```sh
# blueprint -> graph (resumable; a re-run writes only what is missing)
node tools/live/phd/build.mjs <blueprintDir> [--state real|fixture|synth|<path>] [--conc 8] [--stages pages,pdf,images,structure,edges,extras] [--dry]
# check it (add --plexus to load every board through Plexus's own session and compare item/edge counts)
node tools/live/phd/verify.mjs <blueprintDir> --state <name> --plexus [--json out.json]
# remove it, then prove nothing is left
node tools/live/phd/cleanup.mjs --state <name>
node tools/live/phd/verify.mjs --empty --state ~/wo/pxd-phd/build-state.<name>.cleaned-*.json
# test blueprints
node tools/live/phd/synth.mjs --fixture --out ~/wo/pxd-phd/fixture-blueprint
node tools/live/phd/synth.mjs --out ~/wo/pxd-phd/synth-blueprint --boards 40 --cards 3000 --edges 5000 --highlights 1210 --depth 4
```

State lives in `~/wo/pxd-phd/build-state[.<name>].json` (not /tmp): the uid salt, uploaded file URLs, Roam's
highlight uids, page aliases, failures and per-stage timings. The state name defaults to `meta.stateName`, else
`real`. Cleanup renames the state to `*.cleaned-<time>.json`, so the next build gets a new salt and fresh uids.

## How it writes

- **Uids** are `sha256(salt, key)` (9 chars), keys like `card:K12`, `sec:B0:S3`, `edge:E4`. A re-run checks which
  uids exist (`pull_many`) and skips them: no duplicates after a crash or a reopened window.
- **Levels:** ops are written parent level by parent level. Siblings of one parent go one after another with
  `order: "last"`; 8 parents at a time. A 50 ms timer in the page reports the longest main-thread stall per call;
  over 1 s halves the concurrency and pauses. The main window sits on the Daily Notes while writing (no board open).
  The right sidebar is never touched.
- **Roam's limits** (measured 2026-10-12): the API refuses more than 1,500 mutations per 60 s (navigation counts),
  so all writers share a 1,300/min budget (`lib/limit.mjs`); refused ops are handed back and retried in order.
  Roam confirms queued writes one at a time and each confirmation costs time in proportion to the queue: a synth build
  that wrote at ~21/s for 13 min left 18k unconfirmed writes that drained at ~5 a minute with the window at 100% CPU.
  The writer therefore reads Roam's own queue (IndexedDB `v10_SLASH_dbs_SLASH_<graph>` / `unconfirmed-log`) before
  every chunk and holds while it is over 300 (`PHD_MAX_PENDING`).
- **Formats** come from Plexus's own pure serializers, imported from `src/model` in Node (`lib/plan.mjs`):
  `serializeItemLayout`, `serializeEdge`, `boardString` (schema.js), `serializeRegion` + container strings
  (regions.js), `viewBlockString` (view-save.js), `trailString` (trails.js), `snapshotProps` (snapshots.js),
  `COMMENTS_CONTAINER_STRING` / `commentAnchorString` (comments.js), `imageRegionString` (image-region.js),
  `TABLE_ROOT` (roam-table.js), `pageCardString` / `cleanPageTitle` (pdf-page.js).
- **Roam PDF highlights** cannot be written as plain blocks: Roam's reader only shows highlights that carry
  `:annotation/origin`, and `:pdf/url` / `:pdf/content-hash` on a page cannot be set through the API. The builder
  uploads the PDF (a trailing `%phd-stress` comment makes the bytes unique, so Roam never attaches it to a page the
  user already highlighted from the same file), mounts its `{{[[pdf]]}}` block in the main window, turns on highlight
  mode and calls the reader's own `onSelection` with a position computed from pdf.js text (`lib/pdftext.mjs`). Roam
  writes the block, its origin and the PDF page. Then colour (`#h/<colour>`) and the note child are added, the pdf
  block moves to the top of Roam's PDF page, and that page is renamed `PhD/Library/<short>`.
- **Placeholders** in planned strings (`⟦HL:S001:3⟧`, `⟦IMG:K12⟧`, `⟦REF:K12⟧`) are filled at write time from the
  state; a highlight whose text is not in the PDF falls back to a quote card with `Source::`.

## Cleanup scope

Pages titled `PhD/…` (this includes the renamed Roam PDF pages and the root page with its comments), blocks with
the `phd-stress` prop on other pages (daily notebook mentions), daily pages the build created that are empty again,
pages created after the build started that only the build's refs made and that nothing links to, and the uploaded
files (`roamAlphaAPI.file.delete`).

## Files

`build.mjs`, `verify.mjs`, `cleanup.mjs`, `synth.mjs`; `lib/blueprint.mjs` (load, validate), `lib/plan.mjs`
(blueprint -> ops), `lib/layout.mjs`, `lib/uid.mjs`, `lib/pdftext.mjs`, `lib/page.mjs` (functions run in the page),
`lib/write.mjs`, `lib/cdp.mjs`, `lib/serve.mjs` (loopback server for uploads), `lib/state.mjs`.
Tests: `test/phd-builder.test.js`.
