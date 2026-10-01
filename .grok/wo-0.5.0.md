# WO plexus-diagram v0.5.0 — connect, in-place nest, section/card color

HARNESS: `~/.claude/scripts/cursor-run.sh --grok` (CURSOR_GROK=1). Long-horizon mechanical.
CWD: `/Users/svyatoslavkleshchev/plexus-Diagram`
Author for any git: `git -c user.name="Svyatoslav Kleshchev" -c user.email="svyk@icloud.com"`
DO NOT commit. DO NOT push. Stop after `npm run check` is green.

Native-first overlay. Children = cards. Layout on `[[plexus-diagram/metadata]]`. Do not write `:diagram/*` or `:harc/*`. Zero runtime deps.

## Video evidence (CleanShot 2026-08-29 06.54.01)

1. Connect tool is on, handles visible. Cursor on a handle then between two cards. **No rubber-band. No new edge.** User click-clicks / drags; we only complete a drag-past-threshold gesture. Temp edge lives under `.pxd-cards` so even a started wire is hidden.
2. Nested open works (`Diagram › Test Board`, two cards). Clicking back / Roam history: crumbs vanish while still on the child, then parent remounts at ~22–49% zoom with RoamJS breadcrumbs visible (`body.pxd-has-fullscreen` dropped). `openBlock` + `hashchange` is the bug. Heptabase nested whiteboards do **not** change the host route.
3. Section tool used; labels say `Section Section`; no color, rename is only double-click.

xmcp (X search) had no usable Heptabase posts. Implement from Heptabase wiki: Connect tool stays on; click-drag OR click-click; wire follows cursor; nested board is a layer with crumbs; sections/cards have color; click title to rename.

## A. Connect (focus)

Files: `src/canvas.js`, `src/extension.css`, `test/canvas.test.js`

1. `let currentSession = session;` and `const model = () => currentSession.model;`. Keep a `attachSession` (section B).
2. **Temp wire layer on top of cards**, pointer-events none:
   - SVG `.pxd-edges-temp` appended after `cardsLayer`.
   - `setTempEdge` / `clearTempEdge` only touch this layer.
   - Stroke `var(--pxd-active)`, width 3, dashed. Visible at 63% zoom.
3. **Immediate rubber-band.** On connect pointerdown, call `setTempEdge` before the drag threshold. On pointermove while `gesture.kind === "connect"` OR while `connectArm` is set, always update the temp path (no threshold skip).
4. **Two-click / click-click (Heptabase):**
   - `let connectArm = null; // { uid }`
   - Connect tool or handle pointerdown on card A starts `kind: "connect"` and shows the wire.
   - pointerup on A with `!moved`: set `connectArm = { uid: A }`, keep a document `pointermove` listener that follows the cursor. Do **not** `selectCard` (that was eating click-click).
   - Next pointerdown/up on card B ≠ A: `completeConnect` then stay on the Connect tool.
   - Next pointerdown/up on empty: connect-to-empty (`addCard` + `addEdge`) as today.
   - Esc or Select tool: `clearConnectArm()`.
   - Stay on Connect after a successful edge (do not `setActiveTool("select")`).
5. `root.setPointerCapture?.(event.pointerId)` on connect pointerdown (ignore if unsupported).
6. Handle hit slop: keep a 12px visible disc; add `::before { content:""; position:absolute; inset:-10px; }` so the hit is ~32px. Connect-tool handles stay `opacity: 1`.
7. `completeConnect` already exported — add `armConnect` / `clearConnectArm` / `getConnectArm` on the canvas return object for tests.

Tests (DOM stub, dispose in `finally`):
- `completeConnect` card→card adds an edge and a `.pxd-edge`.
- `completeConnect` empty still fires `onPersist` addCard+addEdge.
- After `armConnect("card-a")` then `completeConnect` to `card-b`, edge exists.
- CSS: `.pxd-edges-temp` has `pointer-events: none`. `.pxd-handle::before` exists.

## B. In-place nested boards (no Roam navigation)

Files: `src/canvas.js`, `src/feature.js`, `src/view.js`, `src/session.js` (if needed), `test/feature.test.js`, `test/canvas.test.js`

**Do not call `openBlock` / `openPage` for nest or crumbs.** Hash stays on the parent page. Fullscreen and `body.pxd-has-fullscreen` stay put. Parent session stays loaded.

1. Crumb row is **always** appended to the toolbar (today it is only appended when `crumbs.length` at create). `renderCrumbs` shows it when the stack is non-empty; empty class hides it.
2. `canvas.attachSession(nextSession)`:
   - `exitEdit(false)`, close edge editor, `endGesture`, `clearConnectArm`.
   - Unmount roam on every card, clear `cardEls` / `sectionEls` / edge maps.
   - `currentSession = nextSession`.
   - `initialFitDone = false` then `scheduleInitialFit()` unless `nextSession.model.viewport` is already usable (`!needsFit(viewSize())`) — then `applyTransform()` only.
   - `render()`.
   - Do **not** `setFullscreen(false)`.
3. Nest stack entry shape: `{ uid, title, viewport }`. Save parent viewport when pushing so back restores 63% instead of a postage-stamp fit.
4. `openNestedDiagram(uid, parentUid, hooks = {})`:
   - Push parent onto `nestStack` (with `hooks.viewport`).
   - `nestedOpenUid = uid`.
   - `await markEnhanced(uid)`.
   - If `hooks.attachSession`: `await hooks.attachSession(uid)` and **return**. No `openBlock`.
   - If no hook: still do **not** navigate. Tests without a hook only assert markEnhanced + stack.
5. `openCrumb(uid, hooks)`: find index, persist current, `nestStack.length = i`, `attachSession` the ancestor session. No `openPage`/`openBlock`.
6. Wire this from `mountDiagramView` via a `sessionBox = { current: session }`:
   - `onPersist` addCard/addSection/persist* uses `sessionBox.current`.
   - `action.openNested` → persist parent layout, `openNestedDiagram(child, parentUid, { viewport, attachSession })`.
   - `attachSession` hook: `getOrCreateSession(childUid, factory)` with the same `NativeDiagramSession` factory as `enhanceDiagram`, `load()` if needed, `startWatch()`, move the view `{ refresh, dispose, canvas, wrapper, setFullscreen }` from parent.views to child.views (`parent.removeView`, `child.addView`), `sessionBox.current = child`, `runtime.activeDiagramUid = childUid`, `wrapper.dataset.diagramUid = childUid`, `canvas.attachSession(child)`.
   - `action.openCrumb` → same with ancestor uid. Restore saved viewport onto the ancestor model **before** attach if present.
7. Esc: if `connectArm` or editing, existing behavior. Else if `crumbs.length`, pop one level (last stack entry) via `openCrumb`. Else exit fullscreen.
8. `syncNestStackOnNavigate` stays for **real** house/daily navigation (hash actually changed). In-place nest does not change hash, so it will not fire. Keep the existing truncate/clear tests.
9. Nested card preview: when painting a nested card, if `session.metadataStore?.get(child.uid)?.nodes` has entries, render a `.pxd-card__preview` of up to 8 mini rects (pos/size scaled into the card). Name field + "Double-click to open" stay. Missing metadata → no preview, not an error.

Tests:
- Rewrite `test/feature.test.js` openNested tests: **must not** expect `openBlock`. Assert `markEnhanced`, stack push, and that `hooks.attachSession` is awaited when provided. Keep ignore-parent-canvas timing test (no 500ms wait).
- `attachSession` swaps cards: session A one card, session B another; after attach, A's card node is gone and B's is present.
- Crumb row exists in the toolbar even when `nestStack` is empty (`pxd-crumb--empty`).

## C. Section + card chrome (normal diagram features)

Files: `src/canvas.js`, `src/extension.css`, `src/metadata.js`, `src/model.js`, `src/session.js`, tests

1. Click `.pxd-section__label` (single click) starts rename. Double-click still works. Pointerdown on the label must **not** start section-drag.
2. Track `selectedSectionId`. Clicking a section (not a card) selects it; selected section gets a stronger border (`var(--pxd-active)`).
3. Color palette in the toolbar (hidden until a card or section is selected). Eight Blueprint-ish ids plus default:

```
"" default
red #db3737
orange #d9822b
yellow #d99e0b
green #29a634
teal #00b3a4
blue #2d72d2
violet #7157d9
rose #c22762
```

   Click a swatch: set `node.color` on selected cards and/or `section.color` on the selected section, `markLayoutDirty()`. Dark mode: **border is the signal**, no heavy tinted fill. Cards: `border-color`. Sections: border-color plus `background: color-mix(in srgb, <color> 10%, transparent)` (fallback: keep the existing 6% blue fill when color is empty).
4. Persist `color::` on section rows the same way nodes already persist `color::` (`metadata.js` parse + serialize + `syncPropChild`).
5. `model.ensureNode` already has `color: ""`. Preserve color in `layoutSnapshot` / `applyPull`.

Tests:
- Empty section label still shows "Section".
- Setting `section.color` / `node.color` round-trips through `serializeDiagramMetadata` / parse.
- Selected card with `color: "teal"` paints a border (style or CSS variable `--pxd-card-color`).

## D. Version + copy

- `package.json` version `0.5.0`. `src/feature.js` runtime default `"0.5.0"`. `test/build.test.js` banner `v0.5.0`.
- `CHANGELOG.md` top section `## 0.5.0 — 2026-08-29` with short bullets (connect two-click + temp wire, in-place nest, section/card color, section click-rename). `deploy/CHANGELOG.md` is generated by the build — do not hand-edit unless the build copies it.
- README: Connect = click-click or drag, wire follows cursor, tool stays on. Nested = in-place crumbs, Esc pops a level. Sections = click title to rename, color swatches. Remove the "Caret: overlay editors opt out of Svy Beam" sentence (theme restores Beam this round).

## Constraints

- `npm run check` must pass (build, secrets, syntax, tests, generated identity).
- Do not add runtime deps. Scope CSS under `.pxd-root`.
- Canvas/view tests: `dispose()` in `finally` (rAF leaks).
- Do not rewrite `reconcileVisibleDiagrams` or the `display:none` guard.
- Do not write `:diagram/*`.

When done, print: files touched, test count, `npm run check` result, remaining risks. No commit.
