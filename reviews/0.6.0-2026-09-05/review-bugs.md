# Plexus Diagram 0.6.0 — Bugs / Security / Performance Review

Scope: `reviews/0.6.0-2026-09-05/diff.txt`. Read `src/canvas.js`, `src/edges.js`, `src/model.js`, `src/metadata.js` in full. Skipped generated `extension.js` / `deploy/*`.

Correctness already owns the port-paint miss (`positionEdgeChrome` drops `edge.from` / `edge.to`). This lane does not re-litigate that.

---

## `from::` / `to::` / `color::` are written raw; only `direction::` is allowlisted

**File:** `src/metadata.js:148-150`, `src/metadata.js:188-193`, `src/metadata.js:303-308`
**Severity:** warning
**Type:** security
**What is wrong:** Parse copies the rest of the block string with no check (`from` / `to` / `color`). Serialize and `patchDiagramBlock` then interpolate those values into Roam children. `direction` is restricted to `oneWay|twoWay|none` on write; the new fields are not. `createDiagramChildren` splits `serializeDiagramMetadata` on newlines, so a stored `from` / `to` / `color` that contains a newline becomes extra metadata children on the first-create path. `addEdge(..., extra)` (`src/model.js:290-293`) will also persist whatever `dataset.side` or parsed string it was given, including values outside `auto|top|right|bottom|left`.
**Attack vector / Impact:** Anyone who can edit `[[plexus-diagram/metadata]]` (the graph owner, a multiplayer writer, or a pasted tree) can plant `from:: right\n  node <uid>` (or a huge `color::` blob). On the next create-children persist those extra lines become real `node` / `edge` / `section` rows. This is the same class as unsanitized `label::`, now on three new fields. Paint is not XSS: `colorHex` still gates marker ids and `style.stroke` / `style.fill`, and unknown sides fall through to card center in `sidePoint`. The harm is metadata-tree injection and unbounded block strings, not script execution.
**What needs to change:** Allowlist on parse *and* write: `from`/`to` ∈ `auto|top|right|bottom|left` (else `"auto"`); `color` ∈ `COLOR_SWATCHES` ids (else `""`); reject / strip newlines in every interpolated prop, including `label::`. Do not persist unknown values just because they are non-empty.

---

## Inspector click waits for a full sequential layout patch

**File:** `src/canvas.js:1043-1050`, `src/canvas.js:1086-1088`, `src/canvas.js:1097-1098`; `src/metadata.js:292-314`
**Severity:** warning
**Type:** performance
**What is wrong:** Direction / Route / Color / Flip / Delete all `markLayoutDirty()` then `await flushLayout()`, which runs `MetadataStore.set` → `patchDiagramBlock` over the whole diagram. 0.6.0 adds four sequential `await syncPropChild` calls per edge (`from`, `to`, `direction`, `color`) on top of the existing `kind` / `label` pair. Unchanged strings no-op the Roam write but still pay an async hop each. A color click on a 40-edge board is ~240 extra sequential awaits, plus `getTree`, before the handler returns and `renderEdges()` runs. `completeConnect` already flushed immediately; the inspector now puts that path on every restyle, not just connect.
**Attack vector / Impact:** Not attacker-triggered. Rapid inspector use (cycle direction, then flip, then color) serializes behind `persistQueue` and stalls the overlay for the length of a full metadata patch. This compounds the 0.5.0 finding that `patchDiagramBlock` is an O(rows) chain of awaited writes. Failed persist is uncaught here (`void persistEdgeMutation`); `completeConnect` rolls back the in-memory edge, these handlers do not, and `flushLayout` clears the debounce timer before the await so a thrown persist leaves `layoutDirty === true` with no timer to retry.
**What needs to change:** Keep `await flushLayout()` if persist-once is required, but (1) `Promise.all` the independent prop syncs for a row, (2) skip the four new `syncPropChild` calls when the in-memory values are still default/absent, (3) catch persist failure and either roll back the mutator or reschedule `markLayoutDirty()`, matching `completeConnect`.

---

## `getComputedStyle` per default-colored edge, twice or thrice per `renderEdges`

**File:** `src/canvas.js:393-409`, `src/canvas.js:1138-1141`, `src/canvas.js:1354-1366`
**Severity:** warning
**Type:** performance
**What is wrong:** `resolveEdgeColor` calls `getComputedStyle(root)` whenever `colorHex` misses (the empty/"default" swatch is the common case). `renderEdges` does that once for `path.style.stroke`, then `edgeMarkerId` → `ensureDefs` does it again for each head (`end`, and `start` on `twoWay`). `renderEdges` also starts with `edgesSvg.innerHTML = ""`, which throws away defs so every full redraw rebuilds markers from scratch. Inspector mutations and connect completion both call `renderEdges`.
**Attack vector / Impact:** Not attacker-triggered. Twenty default one-way edges → ~40 layout-forcing `getComputedStyle` calls plus a full SVG rebuild per restyle/connect. That sits on the same turn as the awaited layout persist above. Swatch-colored edges skip the computed-style path (`colorHex` hits) and are fine.
**What needs to change:** Resolve `--pxd-edge` / `--pxd-active` once per `renderEdges` (and once when creating the temp wire). Reuse defs across redraws: delete stale `path`/`hit` nodes, do not `innerHTML = ""` the whole svg. `ensureDefs` should no-op when the marker id already exists.

---

## `elementsFromPoint` runs twice on connect pointer-up

**File:** `src/canvas.js:1883-1901`, `src/canvas.js:2112-2123`
**Severity:** suggestion
**Type:** performance
**What is wrong:** `onPointerUp` for `kind === "connect"` calls `cardFromPoint` then `connectSideFromPoint`. Each calls `hitStackFromPoint` → `document.elementsFromPoint`. Roam's live page DOM is large; this hit-test walks the whole document, not the overlay.
**Attack vector / Impact:** Once per completed connect, not per move. Cheap on a small page, noticeable if the outline is huge. `completeConnect` can call `connectSideFromPoint` a third time when `toSide` was omitted (`src/canvas.js:2138`).
**What needs to change:** Take the stack once in `onPointerUp` and pass it into both `cardUidFromHitStack` and the handle walk. Do not call `connectSideFromPoint` again inside `completeConnect` when `toSide` was already resolved.

---

## src/edges.js

Clean for this lane. `arrowheadSize` clamps `10 / zoom` even if zoom is 0 (`Infinity` → 24). `shouldRescaleMarkers` refuses non-finite / zero `prev`. `arrowheadMarkerId` only concatenates `kind` / `canvasId` / `colorId`; callers pass `pxdN` and a `colorHex`-gated id, so the string is not attacker-shaped today.

---

## src/model.js

Clean for this lane. `extra` fields are copied as strings with `|| "auto"` / `|| ""`. No object merge, no prototype path. `applyPull` adopting new edges with the four fields and leaving live in-memory values is the stated 0.6.0 contract, not a leak.

---

## Marker DOM / XSS (canvas paint)

Clean. 0.5.0 injected markers with `innerHTML` and `fill="var(--pxd-edge)"`. 0.6.0 builds `marker`/`path` via `createElementNS`, sets `style.fill` from `resolveEdgeColor` (swatch hex, computed `--pxd-edge`, or a literal fallback), and puts labels on `textContent` / `SVGTitle`. `edgeColorId` maps unknown `edge.color` to `"default"` before `arrowheadMarkerId`, so `querySelector("#"+id)` and `url(#id)` do not see graph-controlled ids. Keep that whitelist if marker ids ever take a raw color string.

`src/feature.js` (version bump), `src/settings.js` (copy), and `src/view.js` (forward `from` only) have no security or performance issues in this diff. `dispose` / `attachSession` remove the inspector and do not leave the new window listeners behind.

---

## Summary

| Severity | Type | Location | Finding |
|---|---|---|---|
| warning | security | `src/metadata.js:148-193`, `src/metadata.js:303-308` | `from` / `to` / `color` round-trip unsanitized; newline values can fork extra metadata children on create. Allowlist like `direction`. |
| warning | performance | `src/canvas.js:1043-1098`, `src/metadata.js:292-314` | Every inspector mutation awaits a full sequential layout patch; +4 `syncPropChild` per edge; persist failure is not rolled back. |
| warning | performance | `src/canvas.js:393-409`, `src/canvas.js:1323-1366` | `getComputedStyle` per default edge (×2–3) after `innerHTML` wipe of defs on every `renderEdges`. |
| suggestion | performance | `src/canvas.js:1883-2138` | Connect pointer-up hit-tests the whole document twice (sometimes three times). |
