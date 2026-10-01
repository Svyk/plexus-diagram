# Plexus Diagram 0.6.0 — Correctness Review

**Scope:** `src/` and `test/` from `reviews/0.6.0-2026-09-05/diff.txt`  
**Focus:** Correctness, bugs, edge cases (not generated `extension.js`)  
**Verdict:** One critical wiring gap in `canvas.js` undermines the port feature; geometry/schema/inspector layers are otherwise sound.

---

## src/canvas.js

### Port sides stored but not used when painting edges

**File path:** `src/canvas.js:1149`, `src/canvas.js:1151`  
**Severity:** critical

**What is wrong:** `positionEdgeChrome` calls `buildEdgePath(edge.kind || style, source, target)` and `edgeMidpoint(source, target)` without passing `edge.from` / `edge.to`. Every rendered connector therefore uses the legacy `auto`/`auto` geometry even when metadata and the model hold explicit port sides (e.g. `from: "right"`, `to: "left"`).

**Why it matters:** U4 captures and persists port sides; U5 inspector flip swaps them correctly; reload round-trips them — but the on-canvas path, hit target, arrow placement, label pill, label editor, and inspector anchor all ignore them. Dragging from a handle looks correct only on the temp wire (`setTempEdge` at line 1424 does pass `fromSide`); the committed edge does not.

**What needs to change:** Thread ports through all geometry call sites, at minimum:

```js
const from = edge.from || "auto";
const to = edge.to || "auto";
const d = buildEdgePath(edge.kind || style, source, target, from, to);
const mid = edgeMidpoint(source, target, from, to);
```

Apply the same `from`/`to` arguments at lines 1196, 1237, and 1378.

---

### Inspector and label chrome use auto midpoints

**File path:** `src/canvas.js:1196`, `src/canvas.js:1237`, `src/canvas.js:1378`  
**Severity:** warning

**What is wrong:** `openEdgeLabelEditor`, `positionEdgeInspector`, and the label-pill branch inside `renderEdges` each call `edgeMidpoint(source, target)` with no port arguments.

**Why it matters:** Even after fixing `positionEdgeChrome`, the floating inspector, inline label editor, and midpoint pills will stay anchored to the card-center connector unless these sites are updated too. On port-to-port edges the UI chrome will float away from the visible line.

**What needs to change:** Pass `edge.from || "auto"` and `edge.to || "auto"` into every `edgeMidpoint` call, or centralize port resolution in a small helper used by all chrome positioning.

---

### Direction cycle cannot restore implicit global default

**File path:** `src/canvas.js:1025`  
**Severity:** warning

**What is wrong:** `nextDirection` cycles `none → oneWay → twoWay → none` via `effectiveDirection`, but always writes an explicit `edge.direction` string. It never sets `edge.direction = ""` to mean “inherit global Arrowheads setting.”

**Why it matters:** Spec and `sync-silence.test.js` treat absent `direction::` as the global default and expect a metadata delete when reverting. The inspector has no path to that state: once cycled, every edge carries an explicit `direction::` child even when it matches the global setting, and changing the global Arrowheads setting no longer affects that edge (by design for explicit values, but the user cannot undo explicitness from the UI).

**What needs to change:** When the next cycle step would match `effectiveDirection({}, globalSetting)`, set `edge.direction = ""` instead of the explicit enum, so `serializeDiagramMetadata` omits the prop and `syncPropChild` deletes the child.

---

### Flip rollback leaves UI un-refreshed on impossible addEdge failure

**File path:** `src/canvas.js:1076`  
**Severity:** suggestion

**What is wrong:** If `addEdge` for the reversed key returns `null` after `removeEdge`, the code restores the original edge in memory and returns without `renderEdges()` or `syncEdgeInspector()`.

**Why it matters:** The guard at line 1058 makes this path unreachable in normal use, but if it ever fires the in-memory model and DOM could diverge until the next full `renderEdges`.

**What needs to change:** After rollback `addEdge`, call `renderEdges()` and `syncEdgeInspector()` (or early-return before `removeEdge` using a single atomic swap).

---

## src/edges.js

**This section is clean** for the shipped geometry helpers. `sidePoint`, `edgeEndpoints`, port-aware `bezierPath`, `effectiveDirection`, and marker scaling behave as tested.

### Invalid port strings silently fall back to center

**File path:** `src/edges.js:10`  
**Severity:** suggestion

**What is wrong:** `sidePoint` returns the card center for any unknown `side` value instead of rejecting or normalizing to `"auto"`.

**Why it matters:** A typo in hand-edited metadata (e.g. `from:: rght`) parses and persists but renders a center-anchored edge with no user-visible error.

**What needs to change:** Normalize unknown sides to `"auto"` in `parseMetadataTree` / `addEdge`, or validate in `sidePoint` and log once.

---

### Non-finite zoom yields NaN marker geometry

**File path:** `src/edges.js:159`  
**Severity:** suggestion

**What is wrong:** `arrowheadSize(zoom)` does not guard against `NaN` / `Infinity` / `≤ 0` zoom; `10 / zoom` can produce non-finite sizes that propagate into `markerGeometry`.

**Why it matters:** Corrupt viewport metadata could produce invisible or invalid SVG markers. Unlikely in practice because viewport is usually validated elsewhere.

**What needs to change:** Coalesce with `const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1` before `10 / zoom`.

---

## src/model.js

**This section is clean** for the 0.6.0 contract.

`addEdge(..., extra)` stores the new fields; duplicate-key guard still returns `null`; `applyPull` adopts `from`/`to`/`direction`/`color` for incoming-new edges and intentionally leaves live in-memory edges untouched (consistent with existing `kind`/`label` behavior). No correctness defect found.

---

## src/metadata.js

### Invalid `direction::` values are parsed but silently dropped on persist

**File path:** `src/metadata.js:149`, `src/metadata.js:190`  
**Severity:** warning

**What is wrong:** `parseMetadataTree` accepts any `direction::` string (e.g. `direction:: both`). `effectiveDirection` ignores values outside `oneWay|twoWay|none` and falls back to the global setting, but the invalid string stays in memory until persist. `serializeDiagramMetadata` and `patchDiagramBlock` only emit recognized values, so the bad child is deleted on the next layout flush without surfacing an error.

**Why it matters:** Hand-edited or migrated metadata can appear to “fix itself” on save while the live canvas shows global-default arrowheads, which is confusing when debugging persisted state.

**What needs to change:** Validate on parse (coerce unknown values to `""`) or reject with a console warning so in-memory and serialized state stay aligned.

---

### No validation for `from::` / `to::` enum

**File path:** `src/metadata.js:147`  
**Severity:** suggestion

**What is wrong:** Any string is accepted for `from::` / `to::`; only empty string is coerced to `"auto"`.

**Why it matters:** Same silent-degradation pattern as invalid sides in `sidePoint` (see `src/edges.js:10`).

**What needs to change:** Restrict to `auto|top|right|bottom|left` at parse time.

---

## src/view.js

**This section is clean.**

`connect-to-empty` correctly forwards `addEdge.from` into `model.addEdge` via `edgeExtra`; `to` correctly defaults to `"auto"` for a newly created card.

---

## src/settings.js

**This section is clean.**

Arrowheads copy update is documentation-only; no behavioral change.

---

## src/feature.js

**This section is clean.**

Version bump literals only (`0.5.0` → `0.6.0`).

---

## test/

### No regression test that rendered paths honor port sides

**File path:** `test/canvas.test.js` (missing)  
**Severity:** warning

**What is wrong:** Tests assert port capture and model persistence (`completeConnect` stores `from`/`to`) and flip swaps them, but nothing inspects the SVG `d` attribute or `edgeEndpoints` output after `renderEdges` for a port-specified edge.

**Why it matters:** The critical `positionEdgeChrome` omission above would have been caught immediately by asserting the path starts at the right-edge midpoint (e.g. `sx === 100` for the standard test rects).

**What needs to change:** Add a canvas test: create an edge with `from: "right", to: "left"`, call `renderEdges`, parse the path `M` coordinate or compare against `edgeEndpoints` from `edges.js`.

---

### Otherwise adequate coverage for 0.6.0 features

**This section is clean** aside from the gap above.

`test/edges.test.js` covers port geometry primitives; `test/metadata.test.js` and `test/sync-silence.test.js` cover round-trip and patch semantics; `test/canvas.test.js` covers markers, inspector mutations, flip guard, Esc dismissal, and zoom-stable heads; `test/model.test.js` covers `addEdge` extra fields and `applyPull` adoption rules.

---

## Summary

| Severity   | Count |
|-----------|-------|
| critical  | 1     |
| warning   | 4     |
| suggestion| 4     |

**Ship blocker:** Fix `positionEdgeChrome` (and related midpoint call sites) to pass `edge.from` / `edge.to` into `buildEdgePath` and `edgeMidpoint`. Without that fix, 0.6.0’s port feature is persisted but not rendered.

**Recommended before ship:** Add the missing canvas regression test; consider direction-cycle reset to `""` and metadata enum validation.
