# Plexus Diagram v0.4.2 — Correctness Review

Commit `da46011` (v0.4.2). Scope: bugs, edge cases, and behavioral correctness only.

---

## Nest stack desyncs on multi-level browser back/forward

**File:** src/feature.js:259
**Severity:** warning
**What is wrong:**
`syncNestStackOnNavigate` only pops when `nestStack[nestStack.length - 1].uid === diagramUidFromLocation(hash)`. It never truncates deeper entries when navigation jumps more than one level (e.g. C → A via browser back, skipping B). Crumb clicks avoid this because the click handler sets `crumbs.length = i` before navigating, but hash-only navigation does not.
**Why it matters:**
After a multi-level back, the toolbar can show stale ancestors (`Parent › … › Current`) that no longer match the open page. Clicking a stale crumb opens the wrong target or leaves the stack further out of sync.
**What needs to change:**
On navigate, reconcile the whole stack against the open uid (truncate to the prefix whose uids match the ancestry chain, or clear when the open page is not represented in the stack). At minimum, pop repeatedly while the top entry is not an ancestor of the current page.

---

## `activeDiagramUid` may record the wrong parent when nesting

**File:** src/feature.js:234
**Severity:** warning
**What is wrong:**
`openNestedDiagram` pushes `{ uid: runtime.activeDiagramUid, title }` onto `nestStack`, but `activeDiagramUid` is set only in `enhanceDiagram` (last enhanced diagram wins). It is not updated on pointer focus or per-canvas interaction. With more than one enhanced diagram visible (outline embeds, rapid reconcile), nesting from diagram B can push diagram A as the parent.
**Why it matters:**
Crumbs show the wrong parent title and `openCrumb` navigates to the wrong block when the user opened a nested card from a non-active canvas.
**What needs to change:**
Pass the parent diagram uid from the canvas/session that fired `openNested` (e.g. `session.diagramUid` in the `onAction` handler) instead of reading the global `runtime.activeDiagramUid`.

---

## Focus-steal guard cannot cancel `focus` events

**File:** src/canvas.js:1048
**Severity:** warning
**What is wrong:**
`onEditingFocusSteal` calls `event.preventDefault()` on `focus` events to block Roam's outline copy from taking focus. DOM `focus` events are not cancelable; `preventDefault` has no effect. `stopImmediatePropagation` only blocks other listeners — it does not prevent the focus change.
**Why it matters:**
The guard may give a false sense of protection. If Roam still focuses the outline textarea for the same block uid, the outline can scroll into view despite the overlay edit session, especially without reliable `preventScroll` on Roam's side.
**What needs to change:**
Treat `focusRoamInput` / `preventScroll` as the primary fix. For the guard, use `focusin` with an immediate `focus({ preventScroll: true })` back to the overlay input, or blur the outline target explicitly, rather than relying on `preventDefault` on `focus`.

---

## Scroll capture listener does not stop outline scrolling

**File:** src/canvas.js:1064
**Severity:** suggestion
**What is wrong:**
The same handler is registered for `scroll` in capture phase and applies the same `event.target` input checks. `scroll` is not cancelable in practice, and scroll events on `document` typically have `target === document`, not the outline `textarea`, so the handler returns early.
**Why it matters:**
Dead code path; no harm, but it does not contribute to stopping outline scroll-into-view.
**What needs to change:**
Remove the `scroll` listener or replace it with a targeted approach (e.g. observe the outline block's `scrollIntoView` via `IntersectionObserver`, or re-focus overlay input on `focusin` from outside `.pxd-root`).

---

## Connect-to-empty: unhandled rejection if `createChild` throws

**File:** src/view.js:44
**Severity:** warning
**What is wrong:**
`completeConnect` awaits `onPersist`, which awaits `session.addCard`. `adapter.createChild` throws if the Roam create does not change children (`src/adapter.js:109`). `onPointerUp` is `async` with no try/catch around `completeConnect`, so a failed create becomes an unhandled promise rejection.
**Why it matters:**
A transient Roam API failure leaves no card, no edge, and no user-visible error; the gesture silently fails and may log console noise.
**What needs to change:**
Wrap `completeConnect` / `onPersist` in try/catch in the pointer-up path (and optionally surface a hint). No partial edge is written today, which is correct — only error surfacing is missing.

---

## Connect-to-empty: drop on source card is a silent no-op

**File:** src/canvas.js:1549
**Severity:** suggestion
**What is wrong:**
When `moved` is true and `targetUid === sourceUid`, neither the edge branch nor the empty-board branch runs. The connect gesture ends with no card, no edge, and no selection change.
**Why it matters:**
Dragging a handle back onto the same card after moving looks like a failed connect with no feedback. Minor, but confusing.
**What needs to change:**
Either treat same-card drop as a select (`selectCard(sourceUid, shiftKey)`) or ignore without requiring movement threshold confusion — document or add minimal feedback.

---

## Connect-to-empty addCard + addEdge sequencing

**File:** src/view.js:44
**Severity:** suggestion (clean with caveat)
**What is wrong:**
Nothing materially wrong. `addCard` is awaited, then `addEdge` runs only when `uid` is truthy, then `persistLayout`, `render`, and `editCard` for empty strings. `createChild` returns a uid or throws — it does not return null in the current adapter.
**Why it matters:**
The race called out in the brief (edge before uid) is handled correctly by sequential `await`. Duplicate same-pair edges are suppressed in `model.addEdge` (`src/model.js:278`).
**What needs to change:**
No change required for the happy path. Keep the `if (uid && action.addEdge?.source)` guard if the adapter ever gains a nullable return.

---

## Nested name field: debounced timer survives body repaint

**File:** src/canvas.js:1126
**Severity:** warning
**What is wrong:**
Each `paintCardBody` for an unnamed nested card creates a closure-local `nameTimer`. `renderCards` only skips repaint when `card._pxdString === child.string`, but a pull-driven render after a debounced write can replace the input while a prior timer is still pending. `canvas.dispose` does not clear name timers. A disposed canvas can still call `updateBlock` 150ms later.
**Why it matters:**
Stale writes after navigation/dispose, or duplicate Roam updates if the user re-opens the board quickly. Rare but possible.
**What needs to change:**
Store the timer on the card element (e.g. `card._pxdNameTimer`), clear it at the start of `paintCardBody` and in `dispose`. Optionally abort in-flight `updateBlock` with a generation counter.

---

## Nested name field: first debounced write can collapse the input mid-compose

**File:** src/canvas.js:1130
**Severity:** suggestion
**What is wrong:**
After the first 150ms debounce fires with a non-empty prefix (e.g. `"R"`), `updateBlock` updates `child.string`, the next render sees `parseDiagramTitle` truthy, and `paintCardBody` replaces the `<input>` with a static label while the user may still be typing the rest of the name.
**Why it matters:**
Fast typists can lose characters after the first debounce tick, not only after commit.
**What needs to change:**
Debounce the UI swap as well (only switch to label on blur or after a longer idle), or keep the input mounted until blur even when the block string has a parsed name.

---

## `parseDiagramTitle` breaks on `}` in the name

**File:** src/canvas.js:22
**Severity:** suggestion
**What is wrong:**
The named-macro regex uses `([^}]+)` for the title, so a name containing `}` is truncated or fails to parse.
**Why it matters:**
Board names with braces (templates, code snippets) display and round-trip incorrectly.
**What needs to change:**
Use a parser aligned with how Roam stores `{{[[diagram]]:…}}`, or document the restriction.

---

## `diagramUidFromLocation` guard on nested rename is narrow but correct

**File:** src/canvas.js:1128
**Severity:** suggestion (clean)
**What is wrong:**
The input handler skips writes when `diagramUidFromLocation() === child.uid`, preventing rename API calls when the URL is the nested board's own page. On a parent board the guard does not fire; writes proceed normally.
**Why it matters:**
Avoids fighting the page-level block string while viewing the nested diagram as a zoomed page.
**What needs to change:**
No change for the common parent-board case. If nested cards can appear on their own zoomed page, consider disabling the inline name field there instead of silently swallowing input.

---

## Library portal cleanup on unload

**File:** src/library.js:61
**Severity:** suggestion (clean)
**What is wrong:**
Nothing leaks on extension unload. `lifecycle.node(drawer, parent)` registers `node.remove()` on dispose (`src/lifecycle.js:66`), and `onunload` calls `lifecycle.dispose()` (`src/extension.js:33`). `activeLibrary` is not nulled on unload, but the drawer is removed from the DOM; `isOpen()` returns false on reconnect.
**Why it matters:**
The brief's portal-leak concern is addressed for normal unload/reload.
**What needs to change:**
Optional: set `activeLibrary = null` in the lifecycle teardown disposer for hygiene. Not required for correctness.

---

## Library drawer position is fixed at open time

**File:** src/library.js:16
**Severity:** warning
**What is wrong:**
`placeLibraryDrawer` runs once when the drawer is created. It is not hooked to fullscreen chrome `ResizeObserver`, window resize, or sidebar animation frames, unlike `applyFullscreenChrome`.
**Why it matters:**
After toggling fullscreen or collapsing the right sidebar, the drawer can overlap the sidebar, sit off-screen, or drift from the toolbar while the board inset updates.
**What needs to change:**
Re-call `placeLibraryDrawer` from the same chrome placement path (or a shared `ResizeObserver` on `.pxd-mount` / toolbar) while the drawer is open.

---

## `fullscreenInsets` 8px flush collapse

**File:** src/canvas.js:107
**Severity:** suggestion (clean)
**What is wrong:**
Right inset uses article `getBoundingClientRect().right` gap, zeroing when `gap <= 8`. Tests cover 282px gap and flush viewport (`test/canvas.test.js:1033`). `ResizeObserver` on the right sidebar and double-`raf` after article class changes match the changelog intent.
**Why it matters:**
Avoids a visible 1–8px gutter when the article is effectively full width; behavior is intentional and tested.
**What needs to change:**
No change. Note: `[class*="right-sidebar"]` (`src/canvas.js:62`) could theoretically match a non-sidebar element; only a risk if Roam adds unrelated class names.

---

## `focusRoamInput` and caret CSS

**File:** src/canvas.js:295
**Severity:** suggestion (clean)
**What is wrong:**
`focusRoamInput` calls `focus({ preventScroll: true })` before `synthesizeBlockClick`. CSS sets `caret-color` and `cursor: text !important` under `.pxd-root` for light and dark themes (`src/extension.css:490`).
**Why it matters:**
Addresses Svy Beam mis-scaling and outline scroll on edit entry — the main fix for the brief's focus/scroll concern.
**What needs to change:**
No change. Keep tests for `preventScroll` and CSS specificity.

---

## Crumb UI only mounts when stack is non-empty at canvas creation

**File:** src/canvas.js:687
**Severity:** suggestion (clean)
**What is wrong:**
`crumbRow` is appended to the toolbar only when `crumbs.length > 0` at `createCanvasRoot` time. `renderCrumbs` updates content but does not append the row if the stack was empty at init.
**Why it matters:**
In practice, nesting navigates away and mounts a fresh canvas with a pre-pushed stack, so crumbs appear. Programmatic stack mutation without remount would not show the row.
**What needs to change:**
No change for the shipped flow. If the stack can grow in-place later, append `crumbRow` inside `renderCrumbs` when `crumbs.length` becomes non-zero.

---

## Summary

| Area | Verdict |
|------|---------|
| Connect-to-empty addCard + addEdge | Clean on happy path; add error handling for `createChild` throw |
| Nest stack vs hashchange | Needs fix for multi-level browser navigation; parent uid should come from session |
| Library portal on unload | Clean |
| Library position while chrome moves | Needs follow-up placement |
| fullscreenInsets 8px flush | Clean |
| Focus / scroll vs Roam outline | `preventScroll` + CSS clean; capture guard is incomplete |
| parseDiagramTitle / name debounce | Timer lifecycle and mid-type UI swap need hardening |
