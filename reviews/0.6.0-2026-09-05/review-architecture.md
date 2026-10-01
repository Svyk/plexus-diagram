# Plexus Diagram v0.6.0 — Architecture Review

**Reviewer:** principal-engineer pass, 2026-09-05
**Scope:** `src/` architecture and roam-plugin-dev fit (rules 5, 10, 11). Generated bundle not reviewed. Read: `reviews/0.6.0-2026-09-05/diff.txt`, `src/canvas.js` connect/inspector paths, `src/metadata.js` edge props, `src/model.js`, `src/edges.js`, `src/view.js`, `src/session.js`, `src/extension.css`.

---

The 0.6.0 intent — visible arrows, port-aware connect, per-edge direction, floating inspector — sits on the right store: optional `from::` / `to::` / `direction::` / `color::` children under `edge A->B` on `[[plexus-diagram/metadata]]`, UIDs as the join key, no `:diagram/*` or `:harc/*` writes. Gesture capture, temp-wire geometry, and schema parse/patch are aligned. The defects are concentrated in one seam: **the settled-edge painter never reads the port fields the rest of the stack just grew**, so the canonical store and the committed paint path are different programs. The second cluster is persist discipline around the new inspector: in-place model mutation plus `MetadataStore.layoutMatchesStored` against aliased objects, no rollback, and a live Arrowheads fallback that contradicts the “new edges only” contract.

Standing 0.5.0 items (global nest stack, scratch ownership, ghost nodes, unserialized metadata page) are unchanged. They are not re-opened as 0.6.0 findings except where the inspector makes the metadata-page race hotter.

---

## Settled-edge paint ignores stored ports

**File:** src/canvas.js:1148-1151, src/canvas.js:1237, src/canvas.js:1378, src/canvas.js:1424
**Severity:** critical
**What is wrong:** `edges.js` grew port-aware `buildEdgePath` / `edgeMidpoint` (fourth and fifth args `from` / `to`). The temp wire uses them (`setTempEdge` → `buildEdgePath(style, source, target, fromSide, "auto")`). The committed painter does not: `positionEdgeChrome` calls `buildEdgePath(edge.kind || style, source, target)` and `edgeMidpoint(source, target)` with no `edge.from` / `edge.to`. The same two-arg midpoint is reused for the inspector, the label editor, and the label pill.
**Why it matters:** 0.6.0’s headline is “drag from a handle stores `from::` / `to::`.” Capture, `completeConnect` extras, `view.js` connect-to-empty, metadata parse/serialize/patch, and `addEdge(..., extra)` all honor that. The one path the user stares at after pointerup — `renderEdges` / `updateEdgesFor` — still auto-routes. The rubber-band leaves a handle and the committed stroke jumps to the auto facing sides. Reloading a board with persisted ports paints the same auto geometry. Schema without a consumer is not a store; it is a comment. This is a layering failure, not a missed CSS tweak: two paint functions for one edge model, and only the ephemeral one is port-aware.
**What needs to change:** One helper, used by temp wire and settled edges: `buildEdgePath(kind, source, target, edge.from || "auto", edge.to || "auto")` and the matching `edgeMidpoint`. Pass the same pair into inspector / pill / label-editor positioning. Delete the two-arg call sites. A canvas test that `completeConnect({ fromSide: "right", toSide: "left" })` then asserts the path `d` hits those midpoints would have caught this; the current port test only checks `getConnectArm()`.

## First inspector persist can no-op because the model aliases the metadata store

**File:** src/model.js:169-171, src/model.js:322, src/metadata.js:381-389, src/canvas.js:1043-1050
**Severity:** warning
**What is wrong:** `importNativeLayout` does `const edges = [...(metadataLayout?.edges || [])]` — new array, **same edge objects** as `MetadataStore.diagrams`. Inspector mutations (`persistEdgeMutation`, Flip, label editor) write fields in place on those objects, then `flushLayout` → `layoutSnapshot()` (a shallow `{ ...edge }` copy) → `MetadataStore.set`. `set` bails when `serializeDiagramMetadata(stored) === serializeDiagramMetadata(snapshot)`. After an in-place mutate the two serializations match, so `set` returns `false` and writes nothing. `flushLayout` still clears `layoutDirty`. The same alias exists for node objects (`new Map([...metadataLayout.nodes])`).
**Why it matters:** Rule 11’s fingerprint-compare is supposed to stop overwrites of *divergent* trees, not skip the first write of a mutation that already leaked into the cache. Open a board, click a line, cycle direction / color / route, reload: the graph never got `direction::`. The UI already showed the new state. The skip lasts until any *additive* persist (`addEdge`, `addCard`) replaces `this.diagrams` with snapshot copies — which is why drags-after-connect appear to save and inspector-only sessions do not. 0.6.0 made this the primary persist path for the new fields.
**What needs to change:** Deep-copy edges (and nodes) at import, or freeze a `lastWrittenSerialized` string at successful `set` and compare against that, never against live objects. Do not share references between `MetadataStore` and `DiagramModel`. Inspector mutations should snapshot-before / restore-on-failure like `completeConnect` already does for new edges.

## Arrowheads is a live fallback, not a create-time default

**File:** src/edges.js:174-181, src/model.js:290-292, src/canvas.js:2139-2150, src/settings.js:169, docs/spec-plexus-0.6.md:12
**Severity:** warning
**What is wrong:** Locked product copy (CHANGELOG, settings row, README) says global Arrowheads is the default **for new connections**; the inspector overrides per connection. Implementation never stamps `direction` at `addEdge`: `completeConnect` / `view.js` pass only `from`/`to`, `direction` stays `""`, serialize omits it, `effectiveDirection` reads the **current** setting on every paint. Spec 0.6 simultaneously documents that absent `direction::` falls back to the global setting. Those two sentences are different architectures.
**Why it matters:** Changing Settings → Arrowheads restyles every edge that the user has not yet clicked in the inspector — including every 0.5.0 edge — which is the opposite of “new connections only.” The first inspector Direction click then freezes a value derived from the *visual* cycle (`none → oneWay → twoWay`), not from a stamped create-time default. Two tabs with different setting values paint the same unstamped metadata differently. Rule 10 wants the metadata page to be the layout source of truth; a live settings fallback makes the source of truth “metadata plus this client’s panel.”
**What needs to change:** Pick one. Stamp: `addEdge` / `completeConnect` / `session.connectSelected` write `direction` from the current setting (`end→oneWay`, `both→twoWay`, `none→none`) so serialize persists it and later setting changes leave old edges alone. Live fallback: revert the settings/README/CHANGELOG sentence and treat Arrowheads as a board-wide default for unstamped rows. Do not ship both claims.

## Inspector mutations skip the persist-then-rollback path completeConnect already has

**File:** src/canvas.js:1043-1099, src/canvas.js:2153-2160, src/view.js:71-83
**Severity:** warning
**What is wrong:** `completeConnect` adds the edge, `await flushLayout()`, and `removeEdge` + re-render on failure. Connect-to-empty now mirrors that in `view.js`. `persistEdgeMutation`, `flipSelectedEdge`, and `deleteSelectedEdge` mutate the model first, `await flushLayout()`, and have no catch: a failed `metadataStore.set` leaves Flip/Delete/Direction committed in memory (`layoutDirty` stays true only if `flushLayout` throws; a `false` return does not throw — see previous finding). Flip’s only rollback is `addEdge` returning null, not persist failure. Label edits still debounce via `markLayoutDirty()` and never await.
**Why it matters:** 0.6.0’s new writes are exactly the class 0.4.2 called out: four sites owning edge semantics, inconsistent failure discipline. The inspector is now the fifth writer (`session.connectSelected` is still a sixth, and it does not pass `extra`). One failed metadata patch plus a later successful card drag persists the speculative Flip. Rule 11: one queue, compare, write, reload-or-rollback — not mutate-and-hope.
**What needs to change:** `session.patchEdge(key, mutator)` / `session.flipEdge` / `session.removeEdge` owning snapshot → mutate → `persistQueue.run` → on failure restore snapshot and `notifyViews`. Canvas inspector only emits. Label editor should use the same await-flush path as Direction. `connectSelected` must pass `extra` (or stamp direction — previous finding).

## New unprefixed `from::` / `to::` / `direction::` join the graph attribute namespace

**File:** src/metadata.js:147-150, src/metadata.js:188-193, src/metadata.js:303-314
**Severity:** warning
**What is wrong:** 0.6.0 adds three generic `Name::` children under edge rows on `[[plexus-diagram/metadata]]`. `METADATA_SCHEMA_VERSION` stays 1, so there is no migration hook. Parse accepts any tail (`from:: foo` stores `"foo"`; `sidePoint` then falls through to center).
**Why it matters:** Rule 20: Roam derives harcs from every `Name::` block graph-wide. `from::`, `to::`, and `direction::` are common user attributes; they now flood those attribute pages’ references and `::` autocomplete for every persisted port/direction. roam-grid prefixes (`roam-grid/table::`) for this reason. 0.5.0 already flagged `pos::` / `color::` / `title::` as suggestion; 0.6.0 is the release that adds the most collision-prone keys and freezes them at schema 1. Not content corruption, but permanent namespace noise that a later prefix migration has to rewrite.
**What needs to change:** Next schema bump (the marker exists), prefixed keys (`pxd-from::`, `pxd-to::`, `pxd-direction::`, and the 0.5.0 set) with read-old/write-new. Until then, at least reject unknown `from`/`to`/`direction` tails at parse (treat as default) so garbage does not round-trip.

## Inspector writes make the unserialized metadata page hotter

**File:** src/metadata.js:388-406, src/session.js:67-71, src/adapter.js:144-150
**Severity:** warning
**What is wrong:** Unchanged from 0.5.0: each session’s `persistQueue` serializes only its own `persistLayout`; every session read-modify-writes the same `[[plexus-diagram/metadata]]` page; `verifyChildrenBeforeWrite` is still dead. 0.6.0 adds a floating inspector that `await flushLayout()`s on every Direction / Route / color / Flip / Delete — high-frequency patches of the shared page, including Flip as delete-row + create-row in one `set`.
**Why it matters:** Rule 11: never fire concurrent raw writes at the same subtree; fingerprint-compare before writing. Two boards on one page, or two tabs, can still both miss `enhanced::` and duplicate roots (`parseMetadataTree` reads only the first). Flip is the first 0.6.0 operation that *deletes* an edge row; a lost race no longer means a stale `pos::`, it means a duplicate `edge B->A` next to a surviving `edge A->B`.
**What needs to change:** The 0.5.0 fix still stands: one extension-level `MutationQueue` inside `MetadataStore` wrapping `set` / `setViewport` / `remove`. Cache `enhanced::` / `schema-version::` uids. Wire `verifyChildrenBeforeWrite` or delete it.

## Native-imported edges drop the new fields; applyPull never refreshes them

**File:** src/model.js:194-203, src/model.js:335-342
**Severity:** suggestion
**What is wrong:** `importNativeLayout` still pushes `{ source, target, kind: "bezier", label: "" }` for native `:diagram/edges` with no `from`/`to`/`direction`/`color`. `applyPull` copies those four fields only for **incoming-new** keys; an existing in-memory edge keeps stale `from`/`to`/`direction`/`color` even if `metadataLayout` changed (same freeze already used for `kind`). There is still no pull watch on the metadata page, so another client’s inspector patch never arrives until remount.
**Why it matters:** Rule 10’s “in-memory is truth while a view is alive” was written to protect in-flight drags from stale metadata. It also means the new per-edge schema has no read-back path into a live model. Native-imported edges serialize without defaults (`from` undefined is omitted), then later `addEdge`-shaped code assumes `from || "auto"`. Inconsistent edge shapes in one array.
**What needs to change:** Normalize native imports to the same shape `addEdge` produces. If live cross-tab restyle is in scope, watch the metadata block (or accept remount-only and document it). Do not start merging `from`/`to` on existing keys until the aliasing finding is fixed, or a pull will clobber in-flight inspector state.

## Inspector CSS is unscoped relative to the sheet’s own contract

**File:** src/extension.css:1-2, src/extension.css:123-133, src/extension.css:225-257
**Severity:** suggestion
**What is wrong:** The sheet claims every rule sits under `.pxd-root` / `.pxd-mount`. New `.pxd-edge-inspector` / `__btn` (and pre-existing `.pxd-edges { overflow: visible }`) are class-global. Stroke/fill fallbacks correctly use `.pxd-root .pxd-edge` / `.pxd-arrow`. The inspector node is appended to `root`, so in practice it only matches extension-owned DOM.
**Why it matters:** Rule 5’s actual failure mode was `overflow: visible` on **native** block containers. These `overflow: visible` rules are on extension SVG inside `.pxd-root { overflow: hidden }`, so they are not that bug. The gap is the public claim vs the selectors: an unprefixed class is how a later collision lands. Dark tokens still omit `@media (prefers-color-scheme: dark)` (rule 17 auto mode); `isDarkHost` mirrors the same four class signals, so JS fallbacks and CSS agree — both miss auto-dark. Computed `--pxd-edge` on `.pxd-root` covers the paint path when the host actually stamps a dark class.
**What needs to change:** Prefix the new rules `.pxd-root .pxd-edge-inspector`. Leave SVG `overflow: visible` as-is (extension-owned, clipped by `.pxd-root`). Auto-dark is a standing theme debt, not a 0.6.0 regression — do not chase it in this arrows patch.

---

## Battle-rule fit

- **Rule 5 (CSS scope):** Met for the 0.6.0 paint fix. `.pxd-root .pxd-edge` / `.pxd-arrow` / `.pxd-edge--selected` are correctly scoped; literals in SVG presentation attributes avoid `var()`-in-attribute. Inspector selectors should sit under `.pxd-root` (suggestion above). No global overflow on native blocks.
- **Rule 10 (native blocks canonical):** Met for content and for the new edge props’ *location* — children remain the card store, layout stays on the versioned metadata page, edge identity is `sourceUid->targetUid` not an array index, vanished card UIDs are still papered over (0.5.0 warning, not new). The settled painter not reading `from`/`to` is the miss: stored UID-keyed ports are not the paint input. Live Arrowheads fallback makes settings a second layout authority for unstamped rows.
- **Rule 11 (one session, serialized queue, fingerprint compare):** Met for diagram-child writes (adapter queue + expected fingerprints). Violated for the metadata page (standing) and now exercised by inspector `await flushLayout()`. `verifyChildrenBeforeWrite` remains dead. In-place mutate + `layoutMatchesStored` against aliased objects is a false “fingerprint match.” `session.js` still has no `addEdge` owner; 0.6.0 added more call sites instead of consolidating.
- **Rule 2 (echo):** Unchanged. Metadata patches are not diagram-child writes, so they do not echo through the adapter watch. Nested-name `updateBlock` still bypasses the adapter (0.5.0).
- **Rule 20 (no `:harc/*` / `:diagram/*` writes):** Met as a write policy. Unprefixed `from::` / `to::` / `direction::` are still real harcs on the metadata page (warning above).
- **Cleanup ownership:** Met for 0.6.0 chrome. `selectEdge` / `clearEdgeSelection` / `getSelectedEdgeKey` are instance methods; `attachSession` and `dispose` remove the inspector; document `pointermove` for `armConnect` is paired with `removeEventListener` in `clearConnectArm`; Esc dismisses the inspector only when `overlayOwnsPointer() || isFullscreen()`. Marker ids are unique per `canvasId`. `renderEdges` still `innerHTML = ""` the edges SVG (defs rebuilt via `ensureDefs`); that is wasteful, not a leak.

Standing 0.5.0 architecture holes not fixed in this diff: global `nestStack` / `nestedOpenUid`, global scratch, ghost nodes in `applyPull`, metadata-page queue. AttachSession now clears dirty timers and resets the tool — that 0.5.0 warning is addressed.

---

## What is sound

- **Store shape.** Optional children under the existing `edge A->B` row, omitted at default, patched via `syncPropChild` (create / update / delete only the changed prop). No native `:diagram/edges` writes, no schema rewrite of cards. `addEdge(..., extra = {})` keeps 3-arg call sites valid.
- **Port capture.** `dataset.side` on pointerdown, `connectSideFromPoint` on pointerup, `armConnect(uid, side)` with optional second arg, temp wire starts at the armed handle. Click-click and connect-to-empty still work; empty-space `to` stays `auto`.
- **Paint pipeline for arrows.** Resolved literals + scoped CSS fallbacks; `createElementNS` markers; ids `arrowheadMarkerId(kind, canvasId, colorId)`; `arrowheadSize` / `shouldRescaleMarkers`; temp-wire marker lives in `tempSvg` and dies with `replaceChildren`. Two canvases cannot share marker ids.
- **Inspector chrome lifecycle.** Floating cluster on `root` (unscaled, `worldToScreen` midpoint), skips `.pxd-toolbar` / `.pxd-edge-inspector` on pointerdown, Flip disabled when the reverse key exists, Delete/Backspace gated on overlay ownership, selection cleared on pan-click / card select / `attachSession` / `dispose`.
- **Connect persist-then-rollback** on the card→card path, and connect-to-empty now rolls back the edge on persist failure (0.4.2 suggestion closed).
- **attachSession** clears inspector, connect arm, layout/viewport timers and dirty flags, then `setActiveTool` — the 0.5.0 session-swap leak for those flags is fixed.
- **Zero runtime deps; artifacts still generated.** `session.js` untouched was the right call for a schema-only unit; the miss is that inspector mutations did not then go *through* the session they left alone.
