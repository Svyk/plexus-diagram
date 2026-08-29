# Plexus Diagram v0.5.0 — Architecture Review

**Reviewer:** principal-engineer pass (read-only), 2026-08-29
**Scope:** src/ architecture and roam-plugin-dev fit. Generated bundle not reviewed per brief.

---

The 0.5.0 intent — connect-with-live-wire, in-place nested boards with crumbs, color persist, section rename — lands on the right architecture: nested open no longer touches `openBlock` or the hash, the `sessionBox` indirection in `view.js` correctly makes one canvas serve a stack of sessions, `color::` rides the existing 0.4.1 patch-persist instead of a new write path, and the scratch-host editor keeps every rule-13/19 discipline it had. The defects are concentrated in one place: the nesting feature is built on module-level singletons (`nestStack`, `nestedOpenUid`, the scratch block) that are shared across *every* mounted canvas, while 0.5.0 is exactly the release that makes multiple simultaneous boards normal. That mismatch produces the critical finding and three of the warnings. The second cluster is lifecycle hygiene at the session-swap boundary (`attachSession` carries per-canvas state across sessions) and two long-standing rule-10/11 gaps (ghost nodes never deleted, metadata page writes unserialized across sessions) that nesting now exercises much harder.

---

## Global nest stack is shared by every canvas

**File:** src/canvas.js:17, src/canvas.js:365, src/feature.js:241
**Severity:** critical
**What is wrong:** `nestStack` is a module-level array and `nestedOpenUid` a module-level variable. Every `createCanvasRoot` defaults `crumbs` to that one array (canvas.js:365), and `renderCrumbs` (canvas.js:673) plus the Esc pop (canvas.js:1970-1975) read it. There is one stack for the whole extension, keyed to nothing.
**Why it matters:** Two mounted boards (parent page embed + a second inline diagram, or main window + a reconciled remount) show each other's crumbs. Nest into a child in board A and board B's toolbar renders `Parent › Current` for A; Esc in board B pops A's parent *into B's canvas* via B's `sessionBox`, attaching an unrelated session to the wrong wrapper (`wrapper.dataset.diagramUid` rewritten, reconcile then reasons from the wrong uid). With two canvases both listening on `window` keydown, one Escape can fire two concurrent `openCrumb` calls that race on `nestStack.findIndex` + truncation (feature.js:300-303). This violates battle rule 11's core shape — one canonical unit, one state owner — for the release's headline feature.
**What needs to change:** Make the nest stack per mount: own it in `mountDiagramView` (or on the `sessionBox`) and pass it into `createCanvasRoot` via the existing `nestStack` option; `syncNestStackOnNavigate` then iterates live mounts instead of one global. `nestedOpenUid` moves with it. Also guard `openNestedDiagram` (feature.js:283-296) against a double-fire pushing the same parent twice, and pop the pushed entry back off if `hooks.attachSession` throws so a failed nest cannot leave a stale crumb.

## Esc pops a nest level without keyboard ownership

**File:** src/canvas.js:1954-1981
**Severity:** warning
**What is wrong:** `onKeyDown` is a `window` listener. The V/C/N/F shortcuts correctly gate on `isTextEntryTarget` + `overlayOwnsPointer()` (canvas.js:1989-1990), but the entire Escape branch runs before those gates: connect-arm, edge editor, edit, **crumb pop** (canvas.js:1970-1975), fullscreen — none of them check whether the overlay owns focus or pointer.
**Why it matters:** A user typing in an ordinary Roam block presses Escape to close autocomplete; if any mounted board has crumbs (and with the global stack above, *any* board qualifies), the extension consumes the key, `preventDefault()`s, and navigates a whiteboard the user is not even looking at. The fullscreen branch predates 0.5.0 and is defensible (fullscreen covers the window); the new crumb branch extends the hijack to inline embeds. This is the exact keyboard-ownership failure mode in the standing guardrail ("scope capture handlers to verified pointer/focus ownership").
**What needs to change:** Gate the crumb-pop (and connect-arm/edge-editor) Escape branches on `overlayOwnsPointer() || isFullscreen()`, and skip them when `isTextEntryTarget(event.target)` is true outside the overlay. Fullscreen exit may keep its broader claim.

## One global scratch block serves every editing card

**File:** src/metadata.js:432-476, src/canvas.js:1347-1400
**Severity:** warning
**What is wrong:** `scratchRuntime` is a single module-level `{parentUid, uid}`. `editingUid` is per-canvas, so two mounted boards can both be "the one editor" simultaneously, both `renderBlock` the same scratch uid, and both commit from it. `enterEdit`'s seed guard (`scratchTextareaFocused()`, canvas.js:1380) only skips the *seed*; it does not stop the second mount.
**Why it matters:** Board B enters edit while board A's scratch textarea is live: B's editor shows A's string; keystrokes from either side land in the same block; A's `exitEdit` pulls the mixed string and `updateBlock`s it onto A's card (canvas.js:1323-1331). `shouldCommitPulledString` only refuses *empty*-over-nonempty, so wrong-but-nonempty text commits. That is silent cross-card content corruption — low probability per session, but 0.5.0 deliberately multiplies concurrent boards (nested + inline + reconciled remounts). Rule 19 built the scratch pattern for one grid; rule 11 says a canonical resource needs a single owner.
**What needs to change:** Serialize scratch ownership at the extension level: a module-level `editingOwner` token (canvas id + card uid) that `enterEdit` must acquire — if another canvas holds it, force that canvas's `exitEdit` first (mirroring what `enterEdit` already does within one canvas), or allocate one scratch child per concurrent editor under the `pxd:scratch` marker.

## Disappearing child uids are never treated as deletions

**File:** src/model.js:317-345, src/model.js:295-311, src/canvas.js:570
**Severity:** warning
**What is wrong:** `applyPull` replaces `children` from the authoritative pull but only *adds* missing entries to `nodes`, `edges`, and `sections`; nothing removes a node whose uid vanished from the pulled children. `layoutSnapshot` then persists those ghost rows forever, and `patchDiagramBlock` keeps them because they are still in the wanted set.
**Why it matters:** Battle rule 10 is explicit: "A UID that disappears from the pulled tree is authoritative deletion, not an error to paper over." Delete a card block in the outline and its `node <uid>` row lives on in `[[plexus-diagram/metadata]]`; worse, `fitToView`, `viewportNeedsFit`, and the minimap all compute over `model().nodes` (canvas.js:570, 494), so Fit frames empty space where deleted cards used to sit and the initial-fit rejection logic reasons over phantoms. Metadata grows monotonically. The in-memory-truth comment (model.js:313-316) justifies protecting positions from *stale metadata*, not from the authoritative children list.
**What needs to change:** In `applyPull`, after adopting `next.children`, drop `nodes` entries (and edges whose endpoint) whose uid is neither in the new children nor in a short-lived pending-create set the adapter already tracks via expected fingerprints. Sections are metadata-only and exempt.

## attachSession carries previous-session canvas state across the swap

**File:** src/canvas.js:1525-1548, src/canvas.js:453-470, src/canvas.js:637-645
**Severity:** warning
**What is wrong:** `attachSession` swaps `currentSession` but does not settle the persist machinery or tool state: `viewportDirty`/`layoutDirty` flags and their debounce timers survive the swap, and `setActiveTool` is never re-run against the incoming model, so `root.dataset.tool` and the toolbar highlight can disagree with the new `model().activeTool`.
**Why it matters:** Pan the parent, then double-click a nested card inside the 150 ms debounce: the timer fires after the swap, `flushViewport` → `onPersist({persistViewport})` → `sessionBox.current` is now the *child*, so the extension writes the child's freshly-fitted viewport to the graph with zero user gestures on that board — exactly the write class 0.4.0's dirty-flag discipline ("initial fit … no Roam writes") was added to eliminate. The tool desync is smaller but real: nest with Connect active and the child board shows a crosshair cursor and highlighted Connect button while behaving as Select.
**What needs to change:** In `attachSession`, clear both timers and reset both dirty flags before swapping (the parent's state is already captured by `view.js:44`'s pre-nest `persistLayout`, whose snapshot includes the viewport), then call `setActiveTool(model().activeTool || "select")` after `currentSession = nextSession`.

## Nested "Name this board…" input is torn down by its own write echo

**File:** src/canvas.js:1213-1216, src/canvas.js:1242-1255, src/canvas.js:1478, src/adapter.js:81-94
**Severity:** warning
**What is wrong:** The name input debounces `updateBlock(child.uid, "{{[[diagram]]:Name}}")`. That write goes through `metadata.js:45`'s bare `updateBlock`, not the adapter, so no expected fingerprint is recorded and the pull watch reports it as an external structural change. If the watch echo lands before the `.then` updates `card._pxdString` (ordering is not guaranteed), `renderCards` sees `_pxdString !== child.string` and calls `paintCardBody`, which clears the pending name timer (canvas.js:1213-1216) and rebuilds the body — replacing the input the user is mid-word in with the static parsed label.
**Why it matters:** This is battle rule 2's exact failure: your own echo, treated as external, clobbers state you just set — here the caret and any keystrokes since the last 150 ms commit, plus a cancelled pending update. The 0.4.2 "timers clear on repaint" fix is what performs the clobber.
**What needs to change:** Route card-string writes through the adapter (or record an expected before→after string transition) so the matching echo is absorbed silently per rule 2; alternatively have `paintCardBody` skip rebuilding while the nested-name input inside that card has focus, the same way `renderCards` already skips the card being edited (canvas.js:1478).

## Metadata page writes are unserialized across sessions

**File:** src/metadata.js:359-378, src/metadata.js:391-399, src/feature.js:367-381, src/adapter.js:144-151
**Severity:** warning
**What is wrong:** Each session's `persistQueue` serializes only its own writes, but every session read-modify-writes the same `[[plexus-diagram/metadata]]` page. `MetadataStore.set` and `setViewport` both do `getTree(pageUid)` → find-or-create `schema-version::` / `enhanced::` → write. Two concurrent first-enhances — which `scanAddedNode` produces routinely by `void enhanceDiagram(...)` per diagram on a page with two diagrams and auto-enhance on — can both miss `enhanced::` and both create it. `parseMetadataTree` reads only the first root, so layout rows under the duplicate are silently invisible on the next reload. Meanwhile `DiagramAdapter.verifyChildrenBeforeWrite` (adapter.js:144) — the rule-11 fingerprint-compare-before-write discipline — exists and is called by nothing.
**Why it matters:** Rule 11: never fire concurrent raw writes at the same subtree; fingerprint-compare before writing. The metadata page is the one subtree every session shares, and it is the only one without a shared queue. Duplicate roots are a real, self-inflicted data-loss mode.
**What needs to change:** One extension-level `MutationQueue` inside `MetadataStore` wrapping `set`/`setViewport`/`remove` (sessions keep their local queues for adapter writes). Cache the `enhanced::`/`schema-version::` uids after first resolution instead of re-finding per call. Either wire `verifyChildrenBeforeWrite` into the store path or delete it — a dead safety API reads as protection that isn't there.

## Colored sections get a tinted fill in dark mode via inline style

**File:** src/canvas.js:810-821, src/extension.css:243-248
**Severity:** warning
**What is wrong:** `paintSectionColor` sets `el.style.background = color-mix(in srgb, <hex> 10%, transparent)` unconditionally as an inline style. `paintCardColor` (canvas.js:1411-1420) correctly tints only the border.
**Why it matters:** The CHANGELOG's own claim for 0.5.0 is "Dark mode uses the border as the signal," and border-as-signal / no-tinted-fills is a standing user preference for this extension family. Because the fill is an inline style, the dark-theme rules in extension.css (which the neutral section fill already routes through, css:243-248) cannot override it — the theme contract is bypassed by the highest-specificity channel there is.
**What needs to change:** Set only `--pxd-section-color` from JS and move both border-color and the 10% fill into the stylesheet, where the existing dark selectors can drop or dim the fill. Inline styles from `applyColor` should carry no theme-dependent values.

## Nest stack survives navigation to the child's own page

**File:** src/feature.js:310-327, src/feature.js:439-463
**Severity:** warning
**What is wrong:** `syncNestStackOnNavigate` keeps the stack when `openUid === nestedOpenUid`. Nested into C under `/page/P`, then navigate directly to `/page/C` (block ref, search): openUid is C, equals `nestedOpenUid`, so the stack `[P]` survives onto a *fresh* mount created for C's own zoomed page. Esc there "pops" to P in place while the hash says `/page/C`; on the next hashchange `routeLeftZoomedDiagram(P)` is true and `exitFullscreenOnNavigate` tears down fullscreen and stomps the mount height for a board the user believes they are legitimately inside.
**Why it matters:** This is the residual "nest fights hashchange" seam. The in-place design's invariant should be: a crumb stack belongs to one mount and dies with it; `nestedOpenUid` as a graph-global "we meant to be here" flag conflates an in-place nest with an ordinary navigation that happens to land on the same uid.
**What needs to change:** With the stack made per-mount (first finding), this collapses naturally: a new mount starts with an empty stack, and `syncNestStackOnNavigate` clears a mount's stack whenever that mount's wrapper is no longer connected or the route left its *root* diagram. The `openUid === nestedOpenUid` carve-out can then be deleted.

## Armed connect leaks a document-wide pointermove and a live wire outside the board

**File:** src/canvas.js:1135-1152
**Severity:** suggestion
**What is wrong:** `armConnect` installs a capture-phase `pointermove` on `document`, and nothing cancels the armed state when the pointer leaves the board or clicks elsewhere in Roam — `onPointerDown` lives on `root` only. The temp wire keeps tracking the cursor across the whole app until Esc or a board click.
**Why it matters:** Per-move DOM writes and a dangling rubber band while the user works in the outline is scoped-ownership leakage — cheap, but the kind of "extension bleeds outside its footprint" behavior rule 5 polices for CSS and the guardrails police for input.
**What needs to change:** On a pointerdown outside `root` (one capture listener installed only while armed, symmetric with `onConnectArmMove`), call `clearConnectArm()`. Optionally hide the temp wire when `pointerInside` is false.

## Metadata attributes use unprefixed generic names

**File:** src/metadata.js:160-184, src/metadata.js:246-307
**Severity:** suggestion
**What is wrong:** The metadata rows are real Roam attributes: `pos::`, `size::`, `color::`, `title::`, `label::`, `kind::`, `viewport::` at block start on `[[plexus-diagram/metadata]]`.
**Why it matters:** Rule 20's model: Roam derives harcs from every `Name::` block graph-wide. These generic keys join the graph's attribute namespace — `title::`/`color::` collide with common user attributes, flood those attribute pages' references, and appear in `::` autocomplete. roam-grid deliberately prefixed its keys (`roam-grid/table::`) for exactly this reason. Not corruption, but permanent namespace noise that grows with every board.
**What needs to change:** Next schema bump (the `schema-version::` marker exists for this), move to prefixed keys (`pxd-pos::`, …) with a one-time read-old/write-new migration. Not urgent; worth doing before the format calcifies further.

## addCard-with-edge lacks the rollback completeConnect has

**File:** src/view.js:66-78, src/canvas.js:1799-1829
**Severity:** suggestion
**What is wrong:** `completeConnect` rolls back `model().addEdge` when the persist fails (canvas.js:1806-1811). The connect-to-empty path in `view.js` adds the edge to the model and awaits `persistLayout` with no catch: a failed persist leaves the edge in memory (rendered, re-persisted by the next unrelated flush) and the rejection bubbles into `completeConnect`'s blanket catch, which only clears the arm.
**Why it matters:** The 0.4.2 review pack's "connect failures do not leave dangling edges" holds on one of the two connect paths. Inconsistent failure discipline across twin paths is how the fixed bug returns.
**What needs to change:** Mirror the rollback: on persist failure in the `addCard`+`addEdge` branch, `current.model.removeEdge(...)` (the created card may stay — it is real content) and re-render.

## Theme-companion fit: zoom can change under a live editor

**File:** src/canvas.js:1898-1916, src/extension.css:115-121
**Severity:** suggestion
**What is wrong:** With svy-theme's Beam no longer excluding `.pxd-root` and `measureCaretRect` now applying CSS transform scale, the caret overlay is live inside the scaled `.pxd-world`. `onWheel` blocks zoom only when the wheel target is inside the editing card; wheel-zoom elsewhere on the board rescales the world transform under a mounted, focused `renderBlock` editor between input events.
**Why it matters:** Beam re-measures on caret-moving events; a transform change without one leaves the painted caret at the stale scale/position until the next keystroke. The single-transform assumption (`translate(...) scale(...)` on `.pxd-world`, position via left/top on cards) currently holds — it is now an implicit cross-repo contract worth pinning.
**What needs to change:** While `editingUid` is set, either suppress wheel-zoom board-wide (keep panning) or force a caret re-measure path after `applyTransform`. Record the "no additional transforms on the editor ancestor chain" invariant in the repo (README dev notes or a source comment at `.pxd-world`), since the theme now depends on it.

---

## Battle-rule fit

- **Rule 2 (echo):** Partially met. Adapter `createChild`/`deleteChild` record and consume expected fingerprints; card-string `updateBlock`s (edit commit, nested rename) bypass the discipline — benign for edit commit (content-compare downstream), a live clobber for the nested-name input (finding above).
- **Rule 5 (CSS scope):** Met. Every rule sits under `.pxd-*` roots or extension-added state classes (`body.pxd-has-fullscreen`, `.pxd-native-hidden`); foreign-node rules (RoamJS breadcrumbs, native diagram chrome) are gated by extension-controlled classes/uids. No global overflow or unscoped selectors.
- **Rule 10 (native blocks canonical):** Met for content (children are the store, `[[plexus-diagram/metadata]]` is versioned, UIDs are the join key) — except the deletion clause: vanished uids are papered over, not honored (warning above).
- **Rule 11 (one session per unit):** Met for diagram sessions (one adapter/model/watch/queue per uid, views attach); violated by the three cross-cutting singletons: global nest stack, global scratch, unserialized shared metadata page. `verifyChildrenBeforeWrite` is dead code.
- **Rules 13/19 (renderBlock scratch):** Met. Scratch under `pxd:scratch` with boot-sweep/blank/release; seed-before-mount with a focused-textarea guard (no writes near a focused mount); hydrate-quiet (2-frame, 900 ms cap) before the trusted-shaped synthetic click; 1.2 s grace window; stale-blank refuses to commit. The remaining gap is multi-canvas ownership, not the per-canvas protocol.
- **Rule 20 (no :harc/:diagram writes):** Met. No `:harc/*`, `:entity/attrs`, or `:diagram/*` transacts; `:rf-diagram` viewport only on the first-enhance seed via `adapter.updateViewport`; native `:diagram/nodes` read-only. The unprefixed attribute names are namespace noise, not a rule breach.
- **Cleanup ownership:** `attachSession` leaks no pull watches — `startWatch` is idempotent, child watches stop in `dispose`, the parent's retained watch is a deliberate keep-parent-loaded choice with a pruned view set. Nest-vs-hashchange is mostly settled by the sibling-adjacency check in `instanceAlreadyMounted` plus the wrapper `data-diagram-uid` rewrite; the residual seam is the `nestedOpenUid` carve-out (warning above).

## What is sound

- **In-place nesting shape.** No `openBlock`, no hash mutation; `sessionBox` is the right indirection — every deferred action (`persistLayout`, `addCard`, crumb/nested opens) resolves `sessionBox.current` at call time, so writes always target the attached session. Parent uid passed explicitly; crumb entries carry the parent viewport and restore it on pop; layout is persisted before both nested-open and crumb-pop, with failures deliberately non-blocking.
- **attachSession internals.** Exits edit, closes the edge editor, ends gestures, clears the connect arm, unmounts Roam from every card body before the swap, and reuses the stored-viewport-vs-fit gate so a restored board doesn't re-fit or write on open.
- **Connect two-click + temp wire.** Arm/gesture separation is clean; the same `onConnectArmMove` reference makes double-arm idempotent; `completeConnect` rolls back a failed edge persist and dedupes an existing pair; the temp wire is `pointer-events: none` on its own layer; `endGesture` preserves the wire only while armed.
- **color:: persist.** Rides the 0.4.1 patch path end-to-end — `syncPropChild` writes/updates/deletes only the changed `color::` row, identical strings are skipped, and swatch ids (not hexes) are the stored vocabulary. Card color is border-only as designed.
- **Crumb row always mounted.** The `--empty` collapse avoids toolbar reflow; crumbs re-render inside the ordinary `render()` pass; Esc precedence (connect-arm → edge editor → edit → crumb → fullscreen) is the right order.
- **Scratch editor protocol** (per-canvas): faithful rule-19 implementation, including the focus-steal capture guard scoped to the editing uid and the empty-pull refusal.
- **Fullscreen chrome lifecycle.** `applyFullscreenChrome` returns a disposer chaining observer disconnects and the rAF; `placeFullscreen` cancels the prior placement; dispose tears it down.
