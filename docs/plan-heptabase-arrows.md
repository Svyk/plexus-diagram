# Plan — Heptabase-style arrows for Plexus Diagram 0.6.0

Target: `docs/plan-heptabase-arrows.md`. Bump `package.json` 0.5.0 → 0.6.0. Repo at `bf60226`. Do not expand after approve.

## Context

User 2026-09-05: arrows still do not work after the 0.5.0 connect pass. The 2026-08-29 learning closed only the temp wire. Cards stay diagram children. Layout lives on `[[plexus-diagram/metadata]]`. Zero runtime deps. Not a Heptabase clone.

Verified at `bf60226`:

1. `renderEdges` (`src/canvas.js:1060`) sets `stroke="var(--pxd-edge)"`. `.pxd-edge` CSS is pointer-events only (`src/extension.css:138-141`). `.pxd-edge--temp` has a CSS stroke (`199-206`) and that wire paints. Leading hypothesis: Chromium does not resolve `var()` in SVG presentation attributes. Not measured in-repo; the fix does not depend on which cause is true.
2. `ensureDefs` (`934-945`) injects markers via `innerHTML` with `fill="var(--pxd-edge)"`.
3. Marker ids are global `pxd-arrow-end` / `pxd-arrow-start`. `arrowheadMarkerId` (`src/edges.js:65`) exists and is unused.
4. `markerUnits="userSpaceOnUse"`, 8×8, inside CSS-scaled `.pxd-world`. Native fit-views hover around zoom 0.4 (`src/model.js:112-113`).
5. `addEdge` stores `{source, target, kind, label}` only. Four handles set `dataset.side`; `onPointerDown` (`1657-1665`) never reads it. Clicking a line returns early.

Outcome: drag from a port, see a directional head at any zoom, click the line, restyle from a floating inspector. New fields persist as optional `from::` `to::` `direction::` `color::` children of `edge A->B`. No `:diagram/*` or `:harc/*`.

## Approach

Paint first, then schema, then ports, then inspector. Each unit is one spawn. `npm run check` stays green.

- **Paint (U2).** No `var()` in SVG attributes. Scoped CSS `.pxd-root .pxd-edge { stroke: var(--pxd-edge) }` plus inline resolved literals from `resolveEdgeColor`. Markers via `createElementNS`. Unique ids `arrowheadMarkerId(kind, canvasId, colorId)`. Heads `arrowheadSize(zoom) = clamp(10 / zoom, 6, 24)`. `applyTransform` calls `syncMarkerScale` when `shouldRescaleMarkers` (5 percent). Temp-wire marker lives in `tempSvg` defs; `clearTempEdge` wipes children so `setTempEdge` re-ensures defs. `window.getComputedStyle(root)` for `--pxd-edge`; `isDarkHost` matches all four dark selectors (`src/extension.css:827-830`).
- **Schema (U3).** Edge `{source, target, kind, label, from, to, direction, color}`. `from`/`to` ∈ `auto|top|right|bottom|left`. `direction` ∈ `oneWay|twoWay|none`; absent falls back to global `arrowheads` (`end→oneWay`, `both→twoWay`, `none→none`). Serialize only non-default. `addEdge(..., extra = {})` so 3-arg call sites stay valid (`src/session.js:125`, `src/view.js:69-73`, `src/canvas.js:1801`). `applyPull` incoming-new copies the four fields; live views keep in-memory values like `kind` today. `METADATA_SCHEMA_VERSION` stays 1.
- **Ports (U4).** Pointerdown reads `dataset.side` into `fromSide`. Pointerup computes `toSide` from the handle under the point. `armConnect(uid, side)` second arg optional (existing `armConnect("card-a")` stays). `edgeEndpoints(src, tgt, from, to)` uses `sidePoint`. Temp wire starts at the armed handle.
- **Inspector (U5a then U5b).** Click the line → `selectEdge(key)` on the canvas instance (same shape as `completeConnect`). Floating `.pxd-edge-inspector` on `root`, screen-space midpoint, skip `.pxd-toolbar` / `.pxd-edge-inspector`. Buttons: direction cycle, Flip (disabled if reverse key exists), Route, Label (reuse `openEdgeLabelEditor`), color dots, Delete. Mutations: mutate → `markLayoutDirty()` → **`await flushLayout()`** (not `void`) → `renderEdges()`. Dismiss: Esc when overlay owns pointer (toggle via existing `pointerenter`/`pointerleave` at `2036-2037`); pan-click; select; `attachSession`; `dispose`.

## Files

| File | Change |
|---|---|
| `src/edges.js` | `sidePoint`, port-aware `edgeEndpoints`, `bezierPath` exit dirs, `arrowheadMarkerId(kind, canvasId, colorId)`, `arrowheadSize`, `shouldRescaleMarkers`, `effectiveDirection`, `directionToPoints` |
| `src/canvas.js` | `canvasId`, `resolveEdgeColor`, `isDarkHost`, `ensureDefs(svg, …)` via `createElementNS`, `syncMarkerScale`, port gesture, inspector, exported instance methods `selectEdge` / `clearEdgeSelection` / `getSelectedEdgeKey` |
| `src/model.js` | `addEdge(..., extra = {})`; `applyPull` incoming-new |
| `src/metadata.js` | parse/serialize/patch four props via `syncPropChild`; tests go through `MetadataStore.set` (359), never unexported `patchDiagramBlock` (246) |
| `src/view.js` | forward `from` on connect-to-empty |
| `src/session.js` | untouched |
| `src/extension.css` | stroke/fill rules, selected edge, inspector; dark = borders only |
| `src/settings.js` | Arrowheads copy: default for new connections |
| `src/feature.js` | `version: "0.6.0"` (37) and fallback (536) |
| `test/edges.test.js`, `test/canvas.test.js`, `test/metadata.test.js`, `test/model.test.js`, `test/sync-silence.test.js`, `test/build.test.js` | see Tests |
| `package.json`, `CHANGELOG.md`, `README.md` (Connect bullet), `docs/spec-plexus-0.6.md`, this file | 0.6.0 |
| `extension.js`, `extension.css`, `deploy/*` | `npm run build` |

`docs/spec-plexus-0.4.md` stays as history. `docs/spec-plexus-0.6.md` supersedes the connection section of 0.4 only.

Not in 0.6.0: nest stack / `nestedOpenUid`, lasso, section endpoints, ghost nodes, scratch ownership.

## Reuse

- `arrowheadPoints` / `arrowheadMarkerId` (`src/edges.js:65-73`)
- `COLOR_SWATCHES` / `colorHex` (`src/canvas.js:346-361`); palette loop (`736-750`)
- `openEdgeLabelEditor` (`965-1025`); `positionEdgeChrome` (`946`); `edgeKeyFromTarget` (`1099`)
- `overlayOwnsPointer` (`1934`); `isTextEntryTarget` (`332-338`)
- `markLayoutDirty` / `flushLayout`; `completeConnect` persist-then-rollback (`1798-1828`)
- `syncPropChild` (`src/metadata.js:219`); `MetadataStore.set` (`359`)
- `createDomStub` (`test/canvas.test.js:11`); `cardSession` (`285`); `findByClass` (`276`); `installMutableMetadataRoamMock` (`test/sync-silence.test.js:468-535`)
- roam-plugin-dev rules 5, 10–11, 19; `dispose` (`2066`) removes inspector and document listeners

## Tests

`npm run check` is the gate.

**U2 stub first** (`createDomStub`): attribute map; `querySelectorAll` walker; `innerHTML` setter that clears `children`; listener registry on elements, `document`, and `window` plus `dispatch`; `window.getComputedStyle(el)` (also assign `globalThis.getComputedStyle` if production uses the free global); settable `document.elementsFromPoint`; `replaceChildren`. Existing tests stay green.

`test/edges.test.js`

- [ ] `edgeEndpoints(src, tgt, "right", "left")` hits those midpoints; `("top", "auto")` starts at source top-center
- [ ] `bezierPath` from `top` has first control above start
- [ ] `arrowheadMarkerId("end", "pxdA", "teal")` is `pxd-arrow-end-pxdA-teal`; canvasIds never collide
- [ ] `arrowheadSize(0.4)` = 24; `(1)` = 10; `(3)` = 6
- [ ] `shouldRescaleMarkers(1, 1.03)` false; `(1, 1.06)` true
- [ ] `effectiveDirection({}, "end")` is `oneWay`; explicit `none` wins

`test/canvas.test.js`

- [ ] CSS tripwire: `.pxd-root .pxd-edge` sets `stroke: var(--pxd-edge)` (pattern `108-114`)
- [ ] After render, marker path `style.fill` is `/^#[0-9a-f]{6}$/`; no attribute contains `var(`
- [ ] Theme `--pxd-edge: #a7b6c2` → fill `#a7b6c2`; `body.bt-theme-dark` fallback `#a7b6c2`; light `#738694`
- [ ] Default `marker-end` unique per canvas; `twoWay` both heads; `none` neither
- [ ] Two roots → disjoint marker ids
- [ ] Temp path `marker-end` points inside `tempSvg`
- [ ] Zoom 1 → 0.4 rewrites `markerWidth` to 24; 1 → 1.03 leaves it
- [ ] **Port capture:** `pointerdown` on `.pxd-handle` `dataset.side="right"` of card-a, `event.button === 0`, then `pointerup` on document (`beginGesture` at **1563**); `getConnectArm()` equals `{ uid: "card-a", side: "right" }`
- [ ] `completeConnect({ fromSide: "right", toSide: "left" })` stores those sides
- [ ] Existing connect tests `672`, `740`, `771` still pass (`armConnect` 1-arg still works)
- [ ] `selectEdge("card-a->card-b")` → selected class + inspector in `root.children`; `clearEdgeSelection` removes both
- [ ] `pointerenter` then Esc dismisses; `pointerleave` + focus outside + Esc keeps selection
- [ ] `attachSession` and `dispose` clear inspector
- [ ] U5b: each mutation `await flushLayout`; persist-once; Flip disabled when reverse exists
- [ ] `enterEdit` scratch test (`365`) unchanged
- [ ] Six `version: "0.5.0"` literals (`724, 749, 780, 819, 848, 878`) left alone

`test/metadata.test.js`

- [ ] Round-trip `from::` `to::` `direction::` `color::`; defaults omitted

`test/sync-silence.test.js`

- [ ] `MetadataStore.set` direction-only change: one create, zero unrelated deletes; revert to default: one delete

`test/model.test.js`

- [ ] `addEdge` extra stores fields; duplicate key returns null; `applyPull` adopts new, leaves live in-memory

`test/build.test.js`

- [ ] Banner `v0.6.0`

Manual (not CI): Roam Desktop CDP `:9223`, Svy `1IIx5sG4L`. Probe computed stroke/fill; draw port-to-port; reload; inspector flip; badge `v0.6.0` after remove-and-re-add `https://svyk.github.io/plexus-diagram`. Record which paint hypothesis the probe confirms.

## Units

Each unit: one `/tmp/wo/` work order, author `Svyatoslav Kleshchev <svyk@icloud.com>` via `git -c`, verify `git log -1 --format="%an <%ae>"`, `npm run check` green.

| # | Unit | Lane | Done |
|---|---|---|---|
| U1 | Edge geometry and marker helpers (`src/edges.js` + `test/edges.test.js`). Pure functions. | mechanical | [ ] |
| U2 | Stub upgrade, then visible unique zoom-stable arrows (`src/canvas.js`, `src/extension.css`, `test/canvas.test.js`). Depends on U1. | tough | [ ] |
| U3 | Per-edge schema (`src/model.js`, `src/metadata.js`, model/metadata/sync-silence tests). Parallel with U1. | mechanical | [ ] |
| U4 | Port capture end to end (gesture + `view.js` + pointer-registry test). Depends on U1, U2, U3. | mechanical | [ ] |
| U5a | Edge selection and inspector chrome. Exported instance methods. Depends on U2–U4 merged. | tough | [ ] |
| U5b | Inspector mutations + `await flushLayout` persist-once. Depends on U5a. | mechanical | [ ] |
| U6 | Version, changelog, spec addendum, README, `src/feature.js` 37/536, `test/build.test.js:42`, `npm run build`. Depends on U5b. Then `/prose-clean`. | writing | [ ] |

Order: U1 ∥ U3 → U2 → U4 → U5a → U5b → U6. CDP gate after U6.

U5a/U5b do not start until U2–U4 are merged. U6 does not `npm run build` until U5b is merged.

Deferred 0.6.1: per-mount nest stack + `nestedOpenUid`; Shift+drag lasso; sections as endpoints; ghost nodes; scratch ownership.

## Assumptions

- Literal fill + scoped CSS covers both `var()`-in-attribute and marker-inheritance hypotheses.
- Missing `direction::` falls back to global `arrowheads`; no metadata migration.
- Inspector is unscaled on `root`.
- Flip A→B to B→A is one delete + one create; disabled when B→A exists (`addEdge` null is never reached from Flip).
- Theme switch repaints on next `renderEdges`.
- `.pxd-world` CSS transform stays.
- No live Roam in CI.

## Open questions

Locked 2026-09-05 ("Approved do recommended"):

1. Per-edge `direction`; global Arrowheads = default for new edges.
2. Floating inspector at the midpoint, skip `.pxd-toolbar`.
3. 0.6.0 is arrows only; U7/U8/U9 to 0.6.1.
4. U1 mechanical; U2 tough.

## Sign-off

- Claude Max Fable 5.1 (`claude-run.sh --plan`): draft complete (`/tmp/orch/t3-plan-draft-plexus-heptabase.out.md`)
- Grok-on-Cursor facts: first pass Approve=no (stub, exports, U5 size, U6 version files); after Fable amend Approve=yes (`/tmp/orch/t3-plan-grok2-plexus-heptabase.out.md`). Remaining: line nits folded above; no fact-blockers.
- Cursor Fable (`claude-fable-5-1-thinking-medium`): Verdict amend, Sign-off yes
- User preferences: locked
