# Plexus Diagram v0.5.0 — Correctness Review

Scope: bugs, edge cases, and behavioral correctness only. Diff reviewed against `main`; all changed source and test files read.

---

## Debounced layout/viewport flush can target the wrong session after nest/crumb

**File:** src/canvas.js:467
**Severity:** warning
**What is wrong:**
`markLayoutDirty` / `markViewportDirty` schedule debounced `flushLayout` / `flushViewport` (150ms). `attachSession` (line 1525) and the explicit `persistLayout` calls in `view.js` (lines 44, 56) do not cancel those timers or clear the dirty flags. After `sessionBox.current` is repointed in `attachViewSession` (`src/feature.js:277`), a pending flush still runs and calls `onPersist({ persistLayout: true })` against whichever session `sessionBox.current` now references.
**Why it matters:**
If the pre-navigation `persistLayout` in `view.js` fails (caught and ignored) or races the debounce timer, the user's last parent-board edits may never reach metadata. A late flush can also write the child session's model unexpectedly. The failure mode is timing-dependent and silent.
**What needs to change:**
In `attachSession`, cancel `layoutTimer` / `viewportTimer` and reset `layoutDirty` / `viewportDirty` before swapping `currentSession`. Optionally flush synchronously for the outgoing session inside `view.js` and then clear dirty state on the canvas.

---

## Hash navigation updates `nestStack` but not the in-place canvas session

**File:** src/feature.js:310
**Severity:** warning
**What is wrong:**
`syncNestStackOnNavigate` truncates or clears the module-global `nestStack` when the Roam hash changes, but it never calls `attachSession` / `attachViewSession`. In-place nesting (v0.5.0) deliberately avoids `openBlock`, so the hash often stays on the root diagram while the canvas shows a nested board.
**Why it matters:**
When the user navigates away via Roam (sidebar, link, browser back) while in-place nested, the stack can be cleared or truncated while the mount still displays the child session. Crumbs disappear or lie; Esc and crumb clicks no longer match what is on screen. This is worse than v0.4.2 because nesting no longer forces a hash change that would remount the view.
**What needs to change:**
On hash change, either (a) detect an in-place nested mount and pop/reattach to the hash's diagram uid, or (b) treat in-place nest as session-local state keyed per mount (not a global `nestStack`) so route changes cannot desync one mount's crumbs from its canvas.

---

## `openCrumb` silently no-ops when the uid is not in `nestStack`

**File:** src/feature.js:298
**Severity:** warning
**What is wrong:**
`openCrumb` returns immediately when `nestStack.findIndex` is `-1` (line 301). No hook runs, no error, no canvas update.
**Why it matters:**
After stack desync (hash navigation, global stack collision, or manual Roam navigation), clicking a visible crumb button or pressing Esc (which calls `openCrumb` via `src/canvas.js:1973`) appears broken with no feedback. The user remains on the nested board.
**What needs to change:**
When the uid is missing from the stack, either rebuild ancestry from Roam (`block/parents` pull) and attach, or surface a recoverable error and re-render crumbs from truth. At minimum, log and clear stale crumb UI.

---

## Module-global `nestStack` is shared across all mounts

**File:** src/canvas.js:17
**Severity:** warning
**What is wrong:**
`nestStack` is a single exported array used by every `createCanvasRoot` instance and by `syncNestStackOnNavigate` in `feature.js`. Each mount may pass its own `nestStack:` test override, but production always shares the module singleton.
**Why it matters:**
Two enhanced diagrams on one page (inline embed + zoomed page, or multiple embeds) share one breadcrumb stack. Nesting in diagram A pollutes crumbs on diagram B; navigation sync in one context corrupts the other.
**What needs to change:**
Store nest state per mount or per root `sessionBox` (e.g. `session.nestStack` passed into `createCanvasRoot`), not at module scope.

---

## Connect gesture drop onto source card after drag is still a silent no-op

**File:** src/canvas.js:1801
**Severity:** suggestion
**What is wrong:**
`completeConnect` adds an edge only when `targetUid && targetUid !== sourceUid`, and spawns a card only when `!targetUid && (moved || connectArm)`. If the user drags a wire back onto the source card (`targetUid === sourceUid`, `moved === true`), neither branch runs; `clearConnectArm` still runs in `finally`.
**Why it matters:**
The gesture ends with no edge, no card, and no message. Minor, but confusing with the new two-click flow.
**What needs to change:**
Treat `targetUid === sourceUid` as disarm-only (clear temp wire) or show hint text; optionally select the source card.

---

## Unreachable duplicate `connect` branch in `onPointerMove`

**File:** src/canvas.js:1738
**Severity:** suggestion
**What is wrong:**
`onPointerMove` handles `gesture.kind === "connect"` at lines 1696–1699 and returns. The second `if (gesture.kind === "connect")` block at lines 1738–1740 is dead code.
**Why it matters:**
No runtime bug today, but a future edit to the first branch could leave the second as a false duplicate path.
**What needs to change:**
Remove the unreachable block at 1738–1740.

---

## Missing tests for nest pop, Esc, and debounced-persist races

**File:** test/feature.test.js:1
**Severity:** suggestion
**What is wrong:**
New v0.5.0 paths have partial coverage: `armConnect`, `attachSession`, and `openNestedDiagram` hooks are tested; `openCrumb` + `attachSession`, Esc-to-pop (`src/canvas.js:1970`), `syncNestStackOnNavigate` with an attached canvas, and layout-timer cancellation on session swap are not.
**Why it matters:**
The highest-risk regressions (in-place session swap, stack desync, silent crumb failure) have no automated guard.
**What needs to change:**
Add tests for: `openCrumb` invoking `attachSession` and restoring viewport; Esc with non-empty `nestStack`; pending `layoutTimer` cleared after `attachSession`; `syncNestStackOnNavigate` behavior when a mount is mid-nest.

---

## Clean: two-click / drag connect (`connectArm`, `completeConnect`, Esc)

**File:** src/canvas.js:1135
**Severity:** (clean)
**What is wrong:** —
**Why it matters:** —
**What needs to change:** —

The connect flow is internally consistent: first click arms (`armConnect`, line 1782), temp wire lives on `.pxd-edges-temp` (line 380), `completeConnect` handles card-to-card and drag-to-empty (lines 1799–1828), Esc clears the arm before other handlers (lines 1954–1958), and switching off the Connect tool clears the arm (`setActiveTool`, line 638). `finally { clearConnectArm() }` prevents a dangling arm after completion. Tests cover card-to-card, armed two-click, and connect-to-empty.

---

## Clean: `sessionBox` routing in `view.js`

**File:** src/view.js:33
**Severity:** (clean)
**What is wrong:** —
**Why it matters:** —
**What needs to change:** —

`sessionBox.current` correctly routes `persistLayout`, `persistViewport`, `addCard`, and nest/crumb actions to the active session after in-place swaps. `parentUid` and viewport snapshot come from `current.diagramUid` / `current.model.viewport` (lines 48–49), fixing the v0.4.2 `runtime.activeDiagramUid` parent mismatch. Pre-navigation layout persist is attempted before nest/crumb (lines 44, 56).

---

## Clean: `attachViewSession` session swap

**File:** src/feature.js:247
**Severity:** (clean)
**What is wrong:** —
**Why it matters:** —
**What needs to change:** —

View handoff (find view on outgoing session, `removeView`, `addView` on target, update `sessionBox`, `wrapper.dataset.diagramUid`, `canvas.attachSession`) is logically sound for single-mount in-place nesting. `child.load()` + `startWatch()` handle first open; restored viewport is applied before attach when popping crumbs (lines 257, 306).

---

## Clean: `attachSession` DOM/model swap

**File:** src/canvas.js:1525
**Severity:** (clean)
**What is wrong:** —
**Why it matters:** —
**What needs to change:** —

Ends gestures/editing, clears connect arm, tears down card/section/edge DOM without disposing the canvas shell, swaps `currentSession`, and reuses or schedules viewport fit before `render()`. Test `attachSession swaps cards from session A to session B` validates the card layer swap.

---

## Clean: metadata / model color persistence

**File:** src/metadata.js:124
**Severity:** (clean)
**What is wrong:** —
**Why it matters:** —
**What needs to change:** —

`color::` parse/serialize/patch for nodes and sections is wired through `layoutSnapshot` (`src/model.js:295`) and `addSection` default (`src/session.js:115`). Round-trip tests pass.

---

## Clean: section click-rename and palette

**File:** src/canvas.js:853
**Severity:** (clean)
**What is wrong:** —
**Why it matters:** —
**What needs to change:** —

Section selection, click/double-click rename (`startSectionRename`, `onClick` at 1872), label pointerdown guard during connect-arm, and palette `applyColor` for cards/sections behave coherently. Section label defaults to "Section" when title is empty (tested).

---

## Clean: CSS / build artifacts

**File:** src/extension.css:1
**Severity:** (clean)
**What is wrong:** —
**Why it matters:** —
**What needs to change:** —

`caret-color` override removal (Beam compatibility), `.pxd-edges-temp` pointer-events, connect-handle sizing, and palette/crumb styles match the new behavior. `deploy/*` mirrors `src/*`; `package.json` version 0.5.0; build test expects v0.5.0 banner. No logic issues found in docs-only files (`README.md`, `CHANGELOG.md`).
