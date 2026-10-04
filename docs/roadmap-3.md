# Plexus Diagram 3.x roadmap: a more connected Heptabase, built on Roam's graph

**Vision.** Plexus Diagram 2.7 is a whiteboard whose cards are Roam blocks. 3.x makes every *part* of a board and every *part* of an image a Roam block too, so a region, a saved view, a PDF highlight, a trail and a connection can all be written as `((uid))` in a daily note, show up in Linked References, and open back to the exact spot they came from. The three sibling extensions (Roam Plexus, Roam Compass, Plexus Diagram) share one region macro and discover each other by feature detection. Nothing task-related is forced on; Better Tasks, Task Status Tags and the colour highlighter are opt-in integrations.

**Memory science to features.** Encoding specificity and context reinstatement: provenance halo and "why" notes on connections (MEM-1, MEM-2). Spatial memory and method of loci: landmarks and the Walk (MEM-7), views you can jump back into (REG-6). Spacing and resurfacing: the daily-page resurface macro (MEM-4). Elaborative interrogation: labelled arrows with a "why" child (MEM-2). Interference and forgetting: the scrubber and the dust lens (MEM-3, MEM-8). Associative trails (Bush's memex): trails (MEM-6). Retrieval cues: board chips on refs anywhere and the all-contexts drawer (NAV-1, NAV-2). Everything reads Roam's own `:create/time`, refs and attributes; new writes are explicit user actions only.

| Phase | Theme | Version | Tasks |
|---|---|---|---|
| P17 | Quick wins: tasks opt-in, status tags, highlighter, perf debt | 2.8.0 | TSK-1, TSK-2, TSK-3, TSK-4, TSK-5, TSK-6, PERF-1, PERF-2, PERF-3, DOC-17 |
| P18 | Regions and views as blocks | 2.9.0 | REG-1, ECO-1, REG-2, REG-3, REG-4, REG-5, REG-6, REG-7, REG-8, DOC-18 |
| P19 | Ecosystem: Roam Plexus, Compass, public API | 2.10.0 | ECO-2, ECO-3, ECO-4, ECO-5, ECO-6, ECO-7, DOC-19 |
| P20 | PDF on the native annotator | 2.11.0 | PDF-1, PDF-2, PDF-3, PDF-4, PDF-5, PDF-6, PDF-7, DOC-20 |
| P21 | Memory and navigation | 2.12.0 | MEM-1, MEM-2, NAV-1, NAV-2, MEM-3, MEM-4, MEM-5, MEM-6, MEM-7, NAV-3, MEM-8, DOC-21 |
| P22 | Polish and 3.0 | 3.0.0 | POL-1, POL-2, POL-3, POL-4, POL-5, DOC-1, DOC-2, DOC-3, DOC-22 |

Rules that bind every task below (docs/roadmap.md §3): add, never take away (3.1); Roam data canonical, props merged on write (3.2); never `:diagram/*`, never `BT_attr*` from Plexus code (3.3); no writes on open, pan, zoom, select (3.4); at most 45 writes per user action (3.5); never stop `mouseup` in a renderBlock editor, window-capture keys, no `setPointerCapture` (3.6); typing budget +0.1 ms/key, exactly two palette entries (3.7); encrypted Svy through `file.get` (3.8); zero runtime deps (3.9); theme from `bp3-dark` or measured luminance, borders carry meaning in dark (3.10); tests for every module (3.11). Live testing on the Readwisenotes window `Readwisenotes - Plexus Diagram/Test Lab`; never a Svy board. Each phase ends with the §4 standing gate.

---

### TSK-1 — Make Better Tasks and the Task tool opt-in, off by default
- Phase: P17 · Version: 2.8.0 · Effort: S · Priority: high · Depends: none
- Summary: A user who installs Plexus Diagram without Better Tasks, or who does not want task features, sees nothing task-related: no Task tool in the dock, no K key, no chips, no popovers, no calls to Better Tasks, no hidden checkbox renders. Both the Task tool and the Better Tasks bridge become switches that default to off. Existing users who already saved `task-tool: true` keep it.
- Roam model: Reads `extensionAPI.settings` only. No block or props writes. Task cards still render as plain Roam TODO blocks (Roam's own checkbox in the card) when the integration is off.
- Design: Two switches in a new "Integrations" group: `better-tasks` ("Better Tasks integration", off) and `task-tool` (off). `task-chips` and `task-default-project` show under them and are inert when `better-tasks` is off. With `better-tasks` off: `createBt().available()` returns false without touching `window.RoamExtensionTools`, `prime()` is never called, `src/view/task-complete.js` is never used (the card's checkbox is Roam's own through `renderString`/`renderBlock` as before 2.7), Kanban Done flips the marker only, drop-on-daily-page does nothing, and the recurrence toast never appears. With `task-tool` off: no dock entry, no K (shortcut row hidden from the `?` sheet), no "New task" in the canvas menu; "Make task" in the card menu stays (it is a plain string prefix).
- Build tips: `src/settings.js`: add `betterTasks: "better-tasks"` to `SETTING_IDS`, default `false`, flip `taskTool` default to `false`; add the `group-integrations` row to `SETTING_GROUPS` and move the three task rows into it. `initializeSettings` only writes missing ids, so saved values survive. Thread the flag through `src/host/bt.js createBt({ enabled })` so every tool lookup short-circuits. In `src/view/shortcuts.js` the K row needs a `when: (settings) => settings[taskTool]` predicate; the shortcut sheet and the dock both read that table. Search `bt.available()` / `bt.prime()` call sites in `src/session.js`, `src/view/cards.js`, `src/view/kanban-view.js`, `src/view/task-popover.js` and gate each. Test seam: the settings-panel tests and `test/bt-27.test.js` fixtures take a settings object.
- Acceptance: 1. Fresh settings (clear the five ids over CDP, reload): dock shows no Task entry, pressing K on the board does nothing, `?` sheet has no K row. 2. On the "RE bench 40" fixture, a wrapped `window.RoamExtensionTools["better-tasks"].tools[*].execute` counts 0 calls across open, pan, hover and one card click. 3. Turn `better-tasks` on: chips appear within one settings-change tick, `bt_get_attributes` is called once. 4. A user with saved `task-tool: true` sees the dock entry after reload. 5. Dark and light screenshots of a task card with the integration off. 6. Typing bench, no board: ≤ +0.1 ms/key. 7. Unload: 0 `.pxd-*`.
- Out of scope: Removing the 2.7 features. Changing how Better Tasks itself behaves.
- Revisit when: n/a

### TSK-2 — Expose a public API from Roam Task Status Tags
- Phase: P17 · Version: 2.8.0 · Effort: S · Priority: high · Depends: none
- Summary: Task Status Tags has palette commands and a context menu but no global another extension can call. This task adds `window.RoamTaskStatusTags` (in the `~/Roam-Task-Status-Tags` repo) so Plexus Diagram can read the configured statuses, their colours and glyphs, and ask it to set a status. Plexus never has to know the Better Tasks routing rules; Task Status Tags keeps them.
- Roam model: Task Status Tags continues to write exactly one `#[[task-status/<Name>]]` tag after `{{[[TODO]]}}`, routed through `window.betterTasks.v2.requestStatusTag` when the block is Better Tasks-owned, with its fresh-string precondition. Plexus writes nothing.
- Design: `window.RoamTaskStatusTags = Object.freeze({ apiVersion: 1, statuses(): [{ key, name, tag, glyph, light: {base, text}, dark: {base, text} }], statusOf(string): name|null, setStatus(uid, name|null): Promise<{status: "updated"|"rejected"|"unknown", reason?}>, cycle(uid): Promise<same>, addEventListener("change"|"statuses", cb), removeEventListener })`. Dispatch `roam-task-status-tags:ready` on install and `:unload` on unload; delete the global only if it is still ours (copy the pattern from `~/roam-plexus/src/api.js installPublicApi`). `setStatus` goes through the same certified writer as the palette command (`src/status-write.js` + `src/better-tasks-bridge.js createBetterTasksStatusRouter`).
- Build tips: Build it in `src/extension.js` near the palette registration (line ~2123) using the existing `STATUSES` config object and the colour derivation helpers (lines ~536-583) so light/dark values match the pills. `statuses()` must re-read settings each call (users reorder statuses). Add a test in that repo's suite for the frozen shape, the ready/unload events and that `setStatus` on a Better Tasks-owned child returns `rejected` without writing. Bump the version and deploy its Pages URL before P17 acceptance; in each Roam client remove and re-add `https://svyk.github.io/Roam-Task-Status-Tags/` (GUARDRAILS: reload is not enough).
- Acceptance: 1. In Readwisenotes with both extensions loaded, `window.RoamTaskStatusTags.statuses().length === 6` and each row has `glyph`, `light`, `dark`. 2. `setStatus(uid, "Waiting")` on a plain TODO rewrites the string to `{{[[TODO]]}} #[[task-status/Waiting]] …`, keeping the rest byte-identical; `setStatus(uid, null)` removes only the tag. 3. On a Better Tasks task it resolves with `status: "updated"` and the Better Tasks activity log shows one entry. 4. Unload of Task Status Tags removes the global and fires `:unload`. 5. `npm run check` green in that repo.
- Out of scope: New statuses. A write path inside Plexus Diagram.
- Revisit when: n/a

### TSK-3 — Draw status glyphs and pills on task cards
- Phase: P17 · Version: 2.8.0 · Effort: M · Priority: high · Depends: TSK-1, TSK-2
- Summary: A task card with `#[[task-status/Waiting]]` shows the same amber pause glyph on its checkbox and, optionally, the same pill that Task Status Tags draws in the outline. Alert pulses the way it does in the outline. The colours come from the Task Status Tags API when it is loaded, so renamed or recoloured statuses match; without it, Plexus falls back to a fixed table for the six default names and a neutral diamond for anything else.
- Roam model: Read-only. `taskMeta` already extracts `status` from the block string (`src/model/tasks.js` line 123). No writes.
- Design: `.pxd-task-check` gains `data-status="<key>"` and CSS variables `--pxd-status-base/--pxd-status-text` set per card from the API's light or dark set (chosen by the board root's theme token, not `prefers-color-scheme`). Glyphs: play, pause, stop, ring, exclamation, X, diamond as inline SVG masks on the span (no font glyphs: RE-3 showed baseline glyphs clip). Pill: a `pxd-chip pxd-chip--status` in the chip row when `task-chips` is `full`; hidden on `due only`. Map tier (zoom < map-zoom): glyph only at 22 px screen size using `--pxd-screen-px`. Overview tier: coloured 20 px box border. Alert: two-beat pulse in the first 1.25 s of a 5.2 s cycle, honouring `prefers-reduced-motion` and the `motion` setting. Done cards: glyph disappears, native check fill wins (same rule as Task Status Tags). Dark mode: border and glyph carry the status; no filled background.
- Build tips: `src/view/cards.js` around line 334 builds the check span; add the status attributes there and keep the RE-5 rule (no `<input>`, no `renderBlock` at rest). New pure module `src/model/status-tags.js`: `statusPalette(api)` returning a Map keyed by lower-case name with fallbacks, `statusKey(name)`. Listen for `roam-task-status-tags:ready` / `:unload` and the API's `statuses` event in `src/feature.js` and call `session.rerenderTasks()` (no pull watch change). Blueprint: `.bp3-dark button` beats single-class rules; keep the span a `span`, not a `button`. Tests in `test/status-28.test.js`: palette with and without the API, dark/light variable selection, pill hidden on `due only`.
- Acceptance: 1. On the "RE bench 40" fixture, set six cards to the six statuses with `RoamTaskStatusTags.setStatus`; each card shows the matching glyph within one tick, screenshots `TSK-3-light.png`, `TSK-3-dark.png` (dark through the Blueprint topbar toggle, restored to Auto after; if it will not cycle, add `bp3-dark` to body for the shot and remove it). 2. Rename "Waiting" to "Blocked" in Task Status Tags settings: the card pill reads Blocked after the `statuses` event. 3. Unload Task Status Tags: cards fall back to the default table, no console error. 4. Alert card: `getAnimations()` on the span returns 1 at rest, 0 with `motion: none`. 5. `document.querySelectorAll('.check-container input, .rm-checkbox input')` inside the board stays 0. 6. Typing bench with the 40-task board mounted is not worse than PERF-1's baseline for the same build (compare medians).
- Out of scope: Writing statuses (TSK-4). Styling Task Status Tags' own pills inside page cards (they render natively there and stay).
- Revisit when: n/a

### TSK-4 — Change a task's status from the card
- Phase: P17 · Version: 2.8.0 · Effort: S · Priority: medium · Depends: TSK-3
- Summary: Clicking the status glyph on a task card opens a small chooser with the configured statuses in order, plus "Remove status". Picking one asks Task Status Tags to write it. Without the Task Status Tags API the glyph is read-only and the chooser does not exist.
- Roam model: All writes through `window.RoamTaskStatusTags.setStatus(uid, name|null)`. Plexus writes nothing; a rejected result is shown as a toast with the reason.
- Design: Glyph click (not the checkbox area: split the span into `pxd-task-check__box` and `pxd-task-check__status`, 14 px gutter to the left like Task Status Tags' own control). Chooser is a `pxd-root` popover placed with `src/view/avoid.js` so it never sits under the dock; rows show glyph, name, keyboard focus ring; Enter picks, Esc closes, Shift+click on the glyph removes. The card re-renders from the pull watch echo, not optimistically (status is a string edit by another extension). Card context menu gains "Status ▸" with the same rows. Multi-select: the context bar offers "Status ▸" and applies sequentially, at most 45 cards, with a progress toast.
- Build tips: Reuse `src/view/task-popover.js` for the popover shell (it already handles outside-click, Esc, placement). Add menu rows in `src/view/menu-model.js` behind `api.statusTags.available()`. Keep pointerdown/mousedown stops on the chooser as in `relchips.js buildChip` (Roam enters edit on mousedown). Do not render anything while Better Tasks' "Choose scheduling mode" dialog is open (check for `.bp3-dialog` from Better Tasks before opening). Test: chooser calls `setStatus` once per pick, `null` on remove, hidden without the API, 45-cap on multi-select.
- Acceptance: 1. On a plain TODO card pick Waiting: block string gains the tag, card glyph updates after the echo; Cmd+Z in Roam restores the string (one step). 2. On a Better Tasks task (integration on) pick Holding: Better Tasks activity log has one entry, `BT_attr*` children unchanged. 3. Shift+click removes the tag only. 4. Chooser near the dock opens above it (bottom of popover < dock top). 5. Without Task Status Tags loaded the glyph has no `role=button` and clicking it does nothing.
- Out of scope: Creating or renaming statuses. Any direct string write from Plexus.
- Revisit when: n/a

### TSK-5 — Kanban lanes by status
- Phase: P17 · Version: 2.8.0 · Effort: M · Priority: medium · Depends: TSK-4
- Summary: The Kanban view gets a "Lanes: Status" mode: one column per configured status in Task Status Tags order, plus "No status" and "Done". Dragging a card between status columns sets its status through Task Status Tags; dropping on Done uses the existing completion path; dragging out of Done reopens through `bt_modify` (or the marker flip without Better Tasks).
- Roam model: Status writes via `RoamTaskStatusTags.setStatus`; completion via `src/view/task-complete.js` (checkbox path) or the marker flip; nothing else. Column order and the lane mode are view state kept in the board's `plexus.kanban` prop only when the user picks it from the menu (one props write), never on open.
- Design: Kanban toolbar select: Lanes by TODO/DONE (today), by Status, by attribute (existing). Column headers show the status glyph and count. Cards keep their task look (TSK-3). A card without the tag sits in "No status"; a DONE card sits in Done regardless of a retained tag. Drop on a status column: optimistic column move, revert if `setStatus` returns rejected, toast the reason. Keyboard: with a card focused, `[` and `]` move it one column.
- Build tips: `src/model/kanban.js` has the lane grouping (`laneOf`); add `groupByStatus(items, statuses)` and keep it pure. `src/view/kanban-view.js` does the drop; wire a `moveToLane` strategy object so Done keeps the RE-1 helper. Columns come from `statusPalette()` so a renamed status is a new column, not a lost card. CDP: the Kanban card drag selects text under trusted mouse moves (BT-6 note), so drive drops with pointer events in the live check. Tests: grouping with unknown tags, retained tag on DONE, revert on rejected.
- Acceptance: 1. "RE bench 40" with six statuses applied: Lanes: Status shows 8 columns with the right counts. 2. Drop a card from Active to Waiting: one `setStatus` call, string updated, column stable after the echo. 3. Drop on Done: completion runs the checkbox path (one `BT_attrCompleted` with Better Tasks on; marker flip with it off). 4. Rename a status in Task Status Tags settings: columns re-label without reload. 5. Light and dark screenshots. 6. Cmd+Z after a status drop undoes the string edit (Roam undo).
- Out of scope: Column-level writes like reordering statuses. Lanes by Better Tasks status when the integration is off.
- Revisit when: n/a

### TSK-6 — Respect and reuse colour-highlighter tags on cards
- Phase: P17 · Version: 2.8.0 · Effort: M · Priority: medium · Depends: none
- Summary: A card whose block carries `#bg-blue` or `#bg-ch-blue` (fbgallet's colour highlighter) gets that background on the board; `#c:red **text**` keeps its text colour inside the card. Plexus never overrides them with its own fill, and the colour picker gains an optional "Write as highlighter tag" mode that stores the colour in the text instead of props for users who want the colour visible in the outline too.
- Roam model: Reads the block string for `#bg-(ch-)?(\w+)` and `#c:(\w+)`. Default behaviour writes nothing new. In "highlighter tag" mode (opt-in per board from the colour picker's gear), picking a colour appends or replaces one `#bg-<name>` token at the end of the block string (one string write, undoable) and clears `fill` from the props in the same action.
- Design: Fill resolution order: props `fill` set by the user wins; else `#bg-*` tag colour from `var(--cl-lh-<name>)` / `var(--cl-dk-<name>)` when the stylesheet defines it (probe with `getComputedStyle(document.body).getPropertyValue`), else a fixed name-to-palette map (red, orange, yellow, green, blue, purple, pink, gray, teal); else none. The chip row shows a tiny swatch with the tag name so the source is visible. Card CSS: no `color` rule on `.pxd-item .rm-page-ref` descendants or `strong`, so `#c:` styling applies. Hidden-tag rule: if the highlighter hides its own tags in the outline, hide the same `.rm-page-ref[data-tag^="bg-"]` and `[data-tag^="c:"]` inside card bodies only when the highlighter extension is detected (its CSS variable exists); otherwise leave them visible.
- Build tips: Pure module `src/model/highlighter.js`: `highlighterTags(string)`, `fillFromTags(tags, probe)`. Apply in `src/view/cards.js` where `fill` becomes a CSS variable on the item. Picker mode lives in `src/view/color-picker.js`; the write goes through the session's string update (same path as rename). Do not add global CSS; everything under `.pxd-root`. Test: tag parsing (`#bg-ch-`, `#[[bg-blue]]` form, multiple tags: first wins), fill precedence, and that the string write replaces an existing `#bg-*` token rather than appending a second.
- Acceptance: 1. Install the highlighter in Readwisenotes; a card with `#bg-blue text` paints the highlighter's blue in light and dark (compare computed background to `--cl-lh-blue` / `--cl-dk-blue`). 2. A card with `#c:red **hot**` shows red text inside the card. 3. Set a props fill on the same card: props wins; clear it: tag colour returns. 4. Highlighter unloaded: fallback palette blue, tag visible. 5. Picker in tag mode: picking green rewrites the string once (`#bg-green`), props `fill` removed in one undo step. 6. Typing bench ≤ +0.1 ms/key, no board.
- Out of scope: Rendering `#.card-grid*` layouts. Writing `#c:` tags.
- Revisit when: n/a

### PERF-1 — Measure where the mounted-board typing cost comes from
- Phase: P17 · Version: 2.8.0 · Effort: M · Priority: high · Depends: none
- Summary: Typing in a block on a page with a mounted 40-task board costs +2 to +5 ms per key (2.7.0 and 2.7.1), and a plain board about +1.5 ms. Before changing code, measure which part pays: script in Plexus listeners, style and layout over the board's DOM, Roam's own re-render, or another extension's observer scanning our nodes. The output is a table in roadmap §8 and a chosen fix list for PERF-2.
- Roam model: Read-only. The bench uses the existing scratch block above the board.
- Design: Arms, each 5 interleaved rounds of 200 keys with `BENCH_VIEW=page`, medians reported: (a) unloaded; (b) injected, no board on the page; (c) 40-task board mounted, Better Tasks and Task Status Tags loaded; (d) same board, Better Tasks and Task Status Tags disabled in Roam Depot and the window hard-reloaded before measuring (GUARDRAILS: a live toggle measures slower, not faster); (e) board mounted but `.pxd-root { display: none }` injected (DOM present, no layout); (f) board mounted with Plexus's window/document listeners removed via `lifecycle` but DOM intact; (g) board mounted with `contain: content` on `.pxd-item` and `.pxd-root`; (h) 40-card board of plain notes, no tasks. Record a CDP `Tracing` session over 40 keys for arms (a) and (c) and split by category: V8 (by script URL), UpdateLayoutTree, Layout, Paint; count `MutationObserver` callbacks per key via wrapped constructors.
- Build tips: `tools/live/bench.mjs` already supports `BENCH_VIEW=page` and `BENCH_SCRATCH=<uid>`; add `BENCH_ARMS` to run arms back to back and print medians and p95. Use `Tracing.start` with `categories: "devtools.timeline,v8.execute,blink.user_timing"` through the same CDP socket. Note the P16 caveat: the scratch block must sit above the board or the board scrolls out and unmounts (`preRoots` 0). The window is noisy (baselines swing 160 to 235 ms/key); report medians of interleaved rounds, never single runs. Keep the `taskboard.mjs` fixture and ledger every uid.
- Acceptance: 1. A §8 table with eight arms, medians and p95, and the per-category trace split for (a) and (c). 2. A one-paragraph attribution naming the dominant cost with the number that proves it (for example "Layout 3.1 ms/key of the 4.2 ms delta; V8 in extension.js 0.2 ms"). 3. The fix list for PERF-2 ranked by the measured share. 4. Fixture cleaned, 0 `.pxd-*` after unload.
- Out of scope: Any product code change.
- Revisit when: n/a

### PERF-2 — Cut the mounted-board typing cost to under +1 ms/key
- Phase: P17 · Version: 2.8.0 · Effort: L · Priority: high · Depends: PERF-1
- Summary: Apply the fixes PERF-1 ranked until typing with a 40-task board mounted costs at most +1.0 ms per key (median of 5 interleaved rounds) and a plain 40-card board at most +0.5. The no-board budget stays +0.1.
- Roam model: No change to stored data. Any view-state tricks stay in memory.
- Design: Candidate fixes, applied in PERF-1's order and re-measured one at a time: (1) `contain: content` on `.pxd-item` and `contain: layout style` on `.pxd-root` so Roam's textarea autosize does not lay out the board; (2) early exit at the top of every window-capture key handler when `event.target.closest(".pxd-root") === null` and the board has no selection; (3) coalesce the session's pull-watch echo so a sibling-block edit does not rebuild the board model (check the watch pattern pulls only the board subtree); (4) render task titles' `renderString` roots with `pointer-events: none` wrappers that other extensions' observers skip? No: instead keep the DOM small: shells for cards outside the viewport (PERF-3); (5) if an external observer dominates, publish a `data-pxd-static` marker and open an issue upstream; do not patch other extensions. Every fix gets a before/after row in §8.
- Build tips: Containment can break the counter-scaled absolute editor (P14 edit floor) and `ResizeObserver` re-measure for block-arrow rows; run the P14 edit-floor live check after enabling it. Key handlers live in `src/view/interactions.js` and `src/view/board-view.js` (`isTextEntryTarget` must still not match `.rm-block__input` ancestors). The pull watch is created in `src/session.js`; log its callback count per key in the bench. Do not add a `MutationObserver` (rule 3.7). Tests: a DOM test that the key handler returns before any model read when the target is outside the root.
- Acceptance: 1. §8 rows: each fix with median delta before and after. 2. Final: 40-task board mounted ≤ +1.0 ms/key median, p95 ≤ +3 ms; 40-note board ≤ +0.5; no board ≤ +0.1 (5 interleaved rounds each). 3. P14 edit-floor check still passes (editing TODO card at zoom 1.5 keeps the card 160 px). 4. Block-arrow row re-measure still updates after a late-loading page row. 5. Unload 0 `.pxd-*`, listener counts return to baseline.
- Out of scope: Open-time for 300 cards (POL-5).
- Revisit when: n/a

### PERF-3 — Offscreen cards cost nothing: content-visibility and shell budget
- Phase: P17 · Version: 2.8.0 · Effort: M · Priority: medium · Depends: PERF-2
- Summary: Cards outside the visible viewport keep a sized shell but skip style, layout and paint through `content-visibility: auto`, and their Roam renders are unmounted after a grace period. This lowers both typing cost and pan cost on large boards, and it is measured, not assumed.
- Roam model: None. Viewport stays in localStorage.
- Design: Each `.pxd-item` outside the camera rect plus a 1-screen margin gets `content-visibility: auto; contain-intrinsic-size: <w>px <h>px` using the model size, so scrollbars and the minimap stay correct. Roam-rendered bodies (`renderString`/`renderBlock`) of cards that have been offscreen for 10 s are unmounted (`unmountNode`) and re-rendered on re-entry through the existing progressive path (`src/view/progressive.js`). Editing cards are never unmounted. Map and overview tiers already skip bodies; this applies to the detail tier only.
- Build tips: `worldRects` in `src/model/board.js` plus the camera from `board-view.js` give the visibility set; compute it in the existing settle tick (no extra rAF loop). `content-visibility` interacts with `getBoundingClientRect` (forces layout on that element only) and with `IntersectionObserver`; avoid measuring offscreen cards. Known trap: `contain-intrinsic-size` must be in CSS px before the board's zoom transform; the item is inside the scaled world, so use world units. Measure with the PF-2 board `PWtaSkuAX`-style 320-card fixture: pan fps and the PERF-1 bench. Test: visibility set with margin, unmount grace timing with fake timers.
- Acceptance: 1. 320-card fixture at detail zoom: offscreen items report `content-visibility: auto`; detail pan stays ≥ 58 fps (p95 ≤ 20 ms). 2. Typing with the 320-card board mounted: ≤ +1.5 ms/key median. 3. Pan a card out for 12 s and back: its body re-renders within 400 ms, no visible flash in the screenshot pair. 4. An editing card scrolled out keeps its editor. 5. Minimap unchanged (shot before/after identical within 1 px).
- Out of scope: Virtualising connections.
- Revisit when: n/a

### DOC-17 — P17 gate and release 2.8.0
- Phase: P17 · Version: 2.8.0 · Effort: S · Priority: high · Depends: TSK-1, TSK-2, TSK-3, TSK-4, TSK-5, TSK-6, PERF-1, PERF-2, PERF-3
- Summary: Run the standing gate for P17, record measurements, update docs and ship 2.8.0 plus the Task Status Tags release that carries its API.
- Roam model: None.
- Design: Standing gate (§4) items 1 to 7. README: Integrations section (defaults off, how to turn on), status cards, Kanban by status, highlighter colours. CHANGELOG 2.8.0. Roadmap P17 ticks with evidence lines and §8 rows from PERF-1/2/3.
- Build tips: `npm run check`; bump `package.json`; tag `v2.8.0`; after Pages deploys, `cmp` the published `extension.js` and `extension.css` against the local build. For Task Status Tags do the same in its repo. Git author Svyatoslav Kleshchev, new commits only.
- Acceptance: 1. `npm run check` green in both repos. 2. Typing bench no board ≤ +0.1; mounted 40-task ≤ +1.0 (medians). 3. Unload: 0 `.pxd-*`, listeners back to baseline, 0 watches, `window.__plexusDiagram` removed. 4. Published files byte-identical to the build. 5. Ledger empty. 6. Session learning written for any new Roam fact.
- Out of scope: Depot PR.
- Revisit when: n/a

---

### REG-1 — Region and view block model shared with Roam Plexus
- Phase: P18 · Version: 2.9.0 · Effort: M · Priority: high · Depends: none
- Summary: A region of an image card, and a saved view of a board, are ordinary Roam blocks written in the same macro Roam Plexus uses, so one `((uid))` works anywhere, shows up in Linked References, and all three extensions can parse it. This task is the pure model and parser; nothing renders yet.
- Roam model: Container: one collapsed child block `{{[[plexus-regions]]}}` (string identical to Roam Plexus's `CONTAINER_STRING`), last child of the owner block, with `:block/props plexus {type: "regions"}` so the board model treats it like `edges` and `snapshots`. Region blocks are its children: image region `{{[[plexus-region]]: k=img d=<imageBlockUid> f=<rx>,<ry>,<rw>,<rh>}} caption` (fractions 0..1, 4 dp, same `f` grammar as Roam Plexus `rect`); board view `{{[[plexus-region]]: k=view d=<boardUid> v=<x>,<y>,<w>,<h> ids=<uid>,<uid>}} caption` (world rect to 0.1, `ids` optional highlighted items, at most 24). Owner for `img` is the image block itself (it may be a card or any image block in the graph); owner for `view` is the board block. Captions are free text with real `[[refs]]`. Region blocks carry no props. Deleting a region is deleting the block.
- Design: `src/model/regions.js`: `parseRegion(string)` (accepts every Roam Plexus kind, reports `owner: "roam-plexus" | "plexus-diagram" | "unknown"`, `supported` only for `img` and `view`), `serializeRegion`, `isContainerString`, `regionsOf(ownerBlockWithChildren)`, `viewRectOf`, `fracRectOf`. `classifyString` returns `{kind: "regions"}` for the container and `{kind: "region"}` for region blocks so `buildBoard` excludes both from cards, kid counts, rows and outline peeks (same list as Better Tasks attrs in BT-1).
- Build tips: Copy the token grammar from `~/roam-plexus/src/model/region.js` (`HEAD_RE`, `KNOWN_KEYS`, `normalizeFrac`), do not import it (zero deps). Add `v` to the known keys. Round and clamp exactly as Roam Plexus so a round trip is byte-stable. Hook `src/model/schema.js classifyString` (line 316) and the exclusions in `src/model/board.js` and `src/model/tasks.js isTaskAttr` call sites. Tests `test/regions-29.test.js`: parse/serialize round trips, Roam Plexus kinds recognised but unsupported, bad tokens, container exclusion from `kidCount`.
- Acceptance: 1. `npm run check` green with the new tests. 2. A fixture board with a `{{[[plexus-regions]]}}` child holding two region blocks shows no extra cards and no `▸ N` badge change on the image card. 3. `parseRegion` on a real Roam Plexus region string from Readwisenotes returns `owner: "roam-plexus"`, `supported: false`, no error. 4. Open the fixture: zero writes (pull `:edit/time` of every block before and after).
- Out of scope: Rendering, UI.
- Revisit when: n/a

### ECO-1 — Teach Roam Plexus to tolerate `img` and `view` kinds
- Phase: P18 · Version: 2.9.0 · Effort: S · Priority: high · Depends: REG-1
- Summary: Roam Plexus renders every `{{[[plexus-region]]}}` button it sees and today treats an unknown kind as an error chip. Add `img` and `view` to its reserved kinds so it parses them without error and leaves the button untouched for Plexus Diagram to decorate. Both extensions mark the buttons they own, so neither double-renders.
- Roam model: No data change. The ownership mark is a DOM attribute `data-plexus-owner="roam-plexus" | "plexus-diagram"` on `button.rm-xparser-default-plexus-region`.
- Design: In `~/roam-plexus/src/model/region.js` set `RESERVED_KINDS = ["img", "view"]` (the reserved branch already returns the region without `supported` and without an error when `d` is a valid id; it must also accept `f`, `v`, `ids` as extra tokens). In its renderer, skip buttons whose parsed kind is reserved and skip any button that already has a foreign `data-plexus-owner`. `RoamPlexus.regionsOf(uid)` returns reserved kinds with `label: "Plexus Diagram · region"` so Compass can list them. Bump `API_VERSION` to 7 and document the kinds in `docs/spec-plexus.md`.
- Build tips: The renderer claim lives in Roam Plexus's discover/view layer (search `REGION_BUTTON_CLASS`); add the attribute at claim time and a guard before claiming. Test in that repo: reserved parse, renderer skip, foreign-owner skip. Deploy Pages and re-add the URL in each Roam client before P18 acceptance.
- Acceptance: 1. In Readwisenotes with both extensions: a block `{{[[plexus-region]]: k=img d=<uid> f=0.1,0.1,0.3,0.3}} test` shows no Roam Plexus error chip and the button carries no `data-plexus-owner="roam-plexus"`. 2. An existing Roam Plexus `k=area` region still renders its crop. 3. `RoamPlexus.apiVersion === 7`; `regionsOf` lists the img region with the Plexus Diagram label. 4. Its `npm run check` green.
- Out of scope: Roam Plexus rendering img regions itself.
- Revisit when: n/a

### REG-2 — Mark a region on an image card
- Phase: P18 · Version: 2.9.0 · Effort: M · Priority: high · Depends: REG-1, ECO-1
- Summary: On an image card (an anatomy chart, a floor plan) the hover toolbar gets "Mark region". Drag a rectangle over the image, type a caption such as "hamstring", and Plexus writes one region block under the image card and copies `((uid))` to the clipboard. Paste that ref in a workout block and it will render as the crop (REG-4).
- Roam model: Creates the `{{[[plexus-regions]]}}` container (if missing) as the image card's last child with `plexus {type: "regions"}`, collapsed (`:block/open false`), then one region block `{{[[plexus-region]]: k=img d=<imageUid> f=…}} caption`. Two or three writes, one user action, undoable. Clipboard gets `((regionUid))`.
- Design: Tool state `region` on that card only: crosshair cursor, drag draws a dashed rectangle in the card's image box (clamped), handles to adjust, Enter or the ✓ confirms, Esc cancels. A caption field appears at the rectangle's corner (plain input, 80 chars, `[[` allowed as text). After confirm: toast "Region made, ref copied" with Undo. Existing regions show as faint outlines on hover of the image card (toggle in the card menu: "Show regions"). Dark: 1.5 px light outline plus a 1 px dark halo so it reads on any image. Zoom tiers: regions outline only at detail tier; the handle size is screen-constant through `--pxd-screen-px`.
- Build tips: The image card body is `img` inside the Roam root (`src/view/cards.js`, kind `image`); compute fractions against the rendered `img` box, not the card, since the image letterboxes. Pointer handling in `src/view/interactions.js` with no `setPointerCapture`; cancel pointerdown propagation inside the card to stop Roam's mousedown navigation (existing root capture). Writes through a new session method `addImageRegion(cardUid, frac, caption)` using the existing create path with the 45 cap. Clipboard write needs a trusted gesture: do it in the confirm click handler, not after an await. Tests: fraction math with letterbox offsets, container reuse, serialize output.
- Acceptance: 1. Fixture image card (upload a 1600×1000 PNG through the ED-7 path): drag from (25%,30%) to (45%,55%), caption "hamstring", confirm. Pulled children: container with `plexus.type regions`, open false, one child whose string matches `k=img d=<imageUid> f=0.25,0.3,0.2,0.25` (±0.005) and caption. 2. Clipboard text equals `((<regionUid>))` (read via `navigator.clipboard.readText` over CDP with permission granted). 3. Cmd+Z once removes the region block, twice the container. 4. Dark and light shots of the drag state. 5. The image card's `▸ N` badge does not count the container. 6. Encrypted-URL image (`.enc` fixture on Readwisenotes if available, else a unit test with the host stub): fractions are computed from the decoded `img` box.
- Out of scope: Polygon regions. Regions on page-card images.
- Revisit when: n/a

### REG-3 — Mark a region on any image block from the block menu
- Phase: P18 · Version: 2.9.0 · Effort: M · Priority: medium · Depends: REG-2
- Summary: The anatomy image may live on a page, not on a board. The block context menu on an image block gets "Plexus: Mark image region", which opens a light overlay over that image with the same rectangle and caption flow, and writes the same region block under that image block.
- Roam model: Identical to REG-2 with the image block as owner. Block context menu registration is free of the palette budget (facts: context-menu registrations measured +0 per key). Palette stays at two entries.
- Design: Overlay is a `pxd-root` positioned over the image's `img` element in the outline (fixed, follows scroll, closes on Esc or outside click), with the same dashed rectangle, caption input and ✓. Shows existing regions as outlines. No board is needed and no board is created.
- Build tips: Register in `src/feature.js` beside "Show on board" (line ~934) with `blockContextMenu.addCommand`; the callback receives `block-uid`; only act when the block string is a single image markdown (`classifyString` kind image). Reuse the REG-2 component with an `anchor: HTMLImageElement` option. The outline image can be inside `.rm-inline-img__resize`; take the `img` rect, not the wrapper. Test: menu callback refuses non-image strings with a toast.
- Acceptance: 1. On a Test Lab page image block (not on any board): right-click → Plugins → "Plexus: Mark image region" opens the overlay aligned to the image within 2 px. 2. Confirm writes the container and region under that block; `((uid))` on the clipboard. 3. Esc leaves no `.pxd-*` node. 4. Palette command count unchanged (2).
- Out of scope: Image blocks inside page cards on a board (use REG-2 on a copy or the outline).
- Revisit when: n/a

### REG-4 — Render `((region))` refs as crops anywhere in Roam
- Phase: P18 · Version: 2.9.0 · Effort: L · Priority: high · Depends: REG-2, ECO-1
- Summary: Wherever Roam renders an `img` region block, as the block itself, inside a `((ref))`, an embed, the sidebar or Linked References, Plexus Diagram replaces the bare macro button with the cropped image and the caption. A workout block that says `((hamstring region))` shows the hamstring cutout inline.
- Roam model: Read-only. Roam renders the macro as `button.rm-xparser-default-plexus-region` (also inside `.rm-block-ref[data-uid]`); the region string comes from the enclosing block (`data-uid` on the ref or the container's `data-block-uid`). Image bytes through `roamAlphaAPI.file.get` for `.enc` and firebase URLs; decoded bitmaps and object URLs cached in memory per session only.
- Design: Crop card: `canvas` or `img` with `object-fit` crop drawn from the fraction rect, max height 160 px inline (setting `region-inline-height`: 120/160/240), caption under it in Roam's text colour, a corner glyph showing it is a region. Claims the button by setting `data-plexus-owner="plexus-diagram"` and skips buttons already owned. While editing the block the raw macro stays (Roam shows the textarea). Bounds check: if the image fails to load, show the caption with a muted "image unavailable" chip instead of a wrong crop. Dark: 1 px border, no shadow.
- Build tips: Hook `src/feature.js scanAdded` (line 681), which already walks added nodes for relchips; add a selector pass for the region button, capped like `SCAN_CAP`. Read the string from `data-uid`/`data-block-uid` with `host.blockString`, parse with `regions.js`, and bail unless `owner === "plexus-diagram"`. Use `host` file bytes (`src/host/roam.js` ~line 377: `file.get` returns a File; the URL itself taints a canvas). Cache decoded `ImageBitmap` by URL with an LRU of 24. Never persist (rule 3.8). Measure the no-board typing bench after this lands: the scan runs per mutation batch. Tests: owner claim/skip, fraction to pixel crop, failure chip.
- Acceptance: 1. Paste `((regionUid))` from REG-2 into a Test Lab block: the ref renders the crop with caption "hamstring"; shot `REG-4-inline-light.png` and dark. 2. The same ref in the right sidebar and in an embed renders once each (no double button). 3. Roam Plexus region refs on the same page still render Roam Plexus's crop, and `[data-plexus-owner]` values are distinct. 4. Linked References of the image's page list the region block with the crop. 5. Typing bench on the refs page ≤ +0.1 ms/key. 6. Unload removes every crop and restores the plain button text.
- Out of scope: Editing the region from the inline crop.
- Revisit when: n/a

### REG-5 — Hover shows the region in context; click opens the source
- Phase: P18 · Version: 2.9.0 · Effort: M · Priority: high · Depends: REG-4
- Summary: Hovering an inline region crop pops a larger preview: the whole image dimmed with the region lit, so you see where the hamstring sits. Clicking opens the image where it lives: on its board zoomed to the card with the region spotlit, or in the outline scrolled to the image block; Shift-click opens in the sidebar.
- Roam model: Read-only. Deep link `?pxd=<regionUid>` (extends `src/model/deeplink.js`; `feature.js` already holds the target until the board mounts because Roam strips `?pxd=`).
- Design: Hover after the tooltip delay: popover (placed by `placePopover`, obstacles from `avoid.js`) with the full image at max 480 px, a dark 40% veil and the region cut out, caption and "Open" / "Open in sidebar" buttons; keyboard focus on the crop shows it too. Click: if the image block is a card on an enhanced board, navigate to that page with the deep link; on mount the board centres the card at a zoom where the region is ≥ 240 px on screen, draws a 1.2 s pulse ring on the region (motion setting honoured). Otherwise `openBlock` and, after routing settles, scroll the image into view and pulse the outline overlay once.
- Build tips: Reuse the relchips popover life cycle (`openPop/closePop`, scroll and resize re-placement, Esc). Board landing: wait for the mount tick like `?pxd=` card targets, then `session.focusRegion(uid)`. Routing settles when `mainWindow.getOpenPageOrBlockUid()` matches (Roam Plexus §13 landing note). Stop `pointerdown/mousedown` on the crop so Roam does not enter edit mode. Tests: preview geometry (veil rect), target resolution board vs outline.
- Acceptance: 1. Hover the inline crop: popover within tooltip delay, veil plus lit region; Esc closes. 2. Click: board page opens, card centred, region ≥ 240 px on screen, pulse visible in a frame grab. 3. Shift-click opens the board in the sidebar and spotlights there. 4. Region on a non-board image: click scrolls the outline to the image and pulses. 5. Viewport change from the click is not written to the graph (`:edit/time` unchanged).
- Out of scope: Multi-region tours.
- Revisit when: n/a

### REG-6 — Save a board view as a block
- Phase: P18 · Version: 2.9.0 · Effort: M · Priority: high · Depends: REG-1
- Summary: "Save view" captures the current viewport rectangle and optionally the selected cards as a `view` region block under the board, with a caption. The ref `((view))` can go in a daily note or a meeting page; it renders as a mini-map crop (REG-7) and opens the board exactly there.
- Roam model: Writes the `{{[[plexus-regions]]}}` container under the board (if missing, `plexus {type: "regions"}`, collapsed) and one block `{{[[plexus-region]]: k=view d=<boardUid> v=x,y,w,h ids=…}} caption`. Nothing on open or pan; the write happens only on Save.
- Design: Board bar More menu "Save view…", shortcut Shift+V (add to `shortcuts.js`, View group), context bar on a selection "Save view of selection" (rect = bounds of the selection + 48 px pad, `ids` = selection, max 24). Dialog: caption (prefilled with the section title under the viewport centre or "View of <board>"), "Copy ref" checkbox default on. Views list in the panel's Boards tab: rows with caption, a 96 px mini-map, Go, Copy ref, Rename, Delete. Nested boards: `d` is the nested board's block uid; opening pops the breadcrumb path.
- Build tips: Camera rect from `board-view.js` (world units); write through a session method `addView({rect, ids, caption})`. Container reuse shared with REG-2. Panel rows in `src/view/panel.js`; mini-map drawing shared with REG-7. Tests: rect rounding, ids cap, nested board owner.
- Acceptance: 1. On the Test Lab fixture, pan to a corner, Save view "Corner": container plus one view block; `v` equals the camera rect ±0.1; clipboard `((uid))`. 2. Selection of 3 cards → "Save view of selection": `ids` lists the 3 uids, `v` is their bounds + 48. 3. Cmd+Z removes the view block. 4. Panel lists both; Go restores the camera within 1 px with no graph write. 5. Delete from the panel removes the block (one undo).
- Out of scope: Per-view background or lens state.
- Revisit when: n/a

### REG-7 — Render `((view))` refs as mini-maps; click opens the board there
- Phase: P18 · Version: 2.9.0 · Effort: M · Priority: high · Depends: REG-6, REG-4
- Summary: An inline `((view))` renders a small SVG map of that part of the board, highlighted cards brighter, with the caption. Hover shows a bigger map; click opens the board at that viewport and pulses the highlighted cards; Shift-click opens the board in the sidebar.
- Roam model: Read-only. Board model pulled once per view (cached 5 s like `relchips.js modelOf`). Deep link `?pxd=<viewUid>`.
- Design: Inline: 240×140 max SVG with `viewBox = v`, rounded rects per card in the crop (titles from `itemLabel` at a font that fits, cap 40 cards, sections as outlines), highlighted `ids` with the accent stroke, others muted; caption under it. Hover: the same at 480 px wide with "Open" and "Open in sidebar". Click: navigate, mount, set the camera to `v` (fit if the window is smaller), pulse `ids`. Dark: strokes only, no fills except the highlight's 12% tint.
- Build tips: Reuse `previewModel`/`drawPreview` from `src/relchips.js` with a `viewBox` override and a `highlight` set; extract them into `src/view/minimap-svg.js` so relchips, REG-6's panel and REG-7 share one drawer. The scan hook is the same REG-4 pass (kind `view`). Landing is the REG-5 path with `session.setCamera(rect)` then `pulse(ids)`. Tests: viewBox from `v`, highlight classes, card cap.
- Acceptance: 1. Paste the "Corner" view ref into a Test Lab block: SVG renders with the cards inside the rect; shot light and dark. 2. Hover: 480 px map with buttons. 3. Click: board opens, camera rect equals `v` within 1 px (`window.__plexusDiagram` camera read), pulse on the 3 `ids`. 4. Shift-click opens the board in the sidebar at the same camera. 5. The view ref in Linked References of the board's page renders the map. 6. Zero writes on click.
- Out of scope: Animated transitions between views (present mode covers sequences).
- Revisit when: n/a

### REG-8 — Regions panel, badges and clean-up
- Phase: P18 · Version: 2.9.0 · Effort: S · Priority: medium · Depends: REG-2, REG-6, REG-7
- Summary: The card and board know their regions: an image card shows a small "◰ N" badge when it has regions, its menu lists them with Go, Copy ref, Rename, Delete, and the panel's Boards tab shows views. Deleting a region that is referenced elsewhere warns with the count first.
- Roam model: Reads the container's children; "Rename" rewrites only the caption part of the region string; "Delete" deletes the block (Roam's own behaviour: refs show the uid, so warn first). Ref counts from `:block/_refs` of the region block.
- Design: Badge next to the refs badge (`show-card-badges` governs it). Menu submenu "Regions ▸" on image cards. Delete confirm: "Referenced in N blocks. Delete anyway?" with Open references. The container block itself never appears as a card; "Show regions" overlay (REG-2) toggles outlines with captions.
- Build tips: Badge counts in `src/model/info.js`/`cards.js` beside `kidCount`. Menu rows in `menu-model.js`. Rename reuses the connection label write path (string update). Ref count query through the host's existing refs helper (`src/model/refs.js`). Tests: caption-only rewrite keeps tokens byte-identical; delete warning threshold.
- Acceptance: 1. Image card with two regions shows "◰ 2". 2. Rename "hamstring" to "biceps femoris": string tokens unchanged, caption replaced. 3. Delete with one inline ref: warning shows 1; confirm deletes; the inline ref now shows Roam's plain `((uid))` fallback. 4. Badges off setting hides it.
- Out of scope: Moving a region between images.
- Revisit when: n/a

### DOC-18 — P18 gate and release 2.9.0
- Phase: P18 · Version: 2.9.0 · Effort: S · Priority: high · Depends: REG-1, ECO-1, REG-2, REG-3, REG-4, REG-5, REG-6, REG-7, REG-8
- Summary: Standing gate for regions and views, docs, release of Plexus Diagram 2.9.0 and Roam Plexus with reserved kinds.
- Roam model: None.
- Design: README section "Regions and views" with the two block formats and the daily-note workflow. Spec appendix: region grammar table shared with `~/roam-plexus/docs/spec-plexus.md`. CHANGELOG. Roadmap ticks.
- Build tips: Both repos release; re-add both Pages URLs in the Readwisenotes window before final acceptance; run the REG-4 typing bench on a page that holds 20 inline region refs.
- Acceptance: 1. `npm run check` green in both repos. 2. Typing bench: no board ≤ +0.1; page with 20 region refs ≤ +0.1. 3. Unload 0 `.pxd-*`, 0 claimed buttons left with `data-plexus-owner="plexus-diagram"`. 4. Published files byte-identical. 5. Ledger clean.
- Out of scope: n/a
- Revisit when: n/a

---

### ECO-2 — Publish `window.PlexusDiagram`, a public API for sibling extensions
- Phase: P19 · Version: 2.10.0 · Effort: M · Priority: high · Depends: REG-7
- Summary: Compass, Roam Plexus and scripts get a stable, read-mostly API: which boards a page or block is on, a board's cards, thumbnails, regions and views, and open-at. Writes are limited to adding a ref card, which is what "Send to board" already does.
- Roam model: Reads through the host; the only write is `addCard(boardUid, {ref})` (one block create, undoable). No new blocks or props kinds.
- Design: `window.PlexusDiagram = Object.freeze({ apiVersion: 1, version, isAvailable(), boardsOn(pageUid) -> [{uid, title}], boardsWith(targetUid) -> boards holding a card that refs the page or block, cardsOf(boardUid) -> [{uid, kind, title, rect, parent}], regionsOf(ownerUid), viewsOf(boardUid), thumbnail(boardUid, {maxWidth}) -> Promise<Blob> (SVG mini-map rasterised, no Roam render), open(uid, {card, view, region, sidebar}) -> Promise, addCard(boardUid, {ref: "[[Page]]"|"((uid))", at?}) -> Promise<{uid}>, addEventListener("change"|"mount"|"unmount", cb), removeEventListener, spec(), help() })`. Events: `plexus-diagram:ready` and `:unload` on window. `boardsWith` is the query behind the existing "on N boards" badge.
- Build tips: Model it on `~/roam-plexus/src/api.js createPublicApi` / `installPublicApi` (frozen object, listener buckets that swallow listener errors, delete the global only if ours). Keep `window.__plexusDiagram` as the internal debug handle. `thumbnail` reuses `src/view/minimap-svg.js` and `OffscreenCanvas` when present, else a hidden canvas. `boardsWith` needs a Datascript query over `:block/refs` of enhanced boards' children; Roam Datascript has no `clojure.string/lower-case`, use `re-pattern` with `(?i)` where text matching is needed. Tests: frozen shape, event install/uninstall, `addCard` cap and refusal when the board is not enhanced.
- Acceptance: 1. `PlexusDiagram.spec().methods` lists the names above. 2. `boardsWith(pageUid)` for a page carded on two fixture boards returns both. 3. `thumbnail(boardUid, {maxWidth: 160})` resolves a PNG blob ≤ 160 px wide in under 100 ms warm. 4. `open(boardUid, {card})` lands and pulses; `{view}` sets the camera. 5. `addCard` creates one child with plexus props and emits `change`. 6. Unload deletes the global and fires `:unload`.
- Out of scope: Scene-style mutation APIs (move, connect).
- Revisit when: n/a

### ECO-3 — Roam Plexus region refs as crop cards on a board
- Phase: P19 · Version: 2.10.0 · Effort: M · Priority: high · Depends: ECO-1
- Summary: Drop or paste a Roam Plexus region ref (`((uid))` of a `k=area`/`rect`/`frame` region) onto a board and it becomes a crop card: the drawing's cutout rendered through `RoamPlexus.thumbnail`, caption as title, click opens the drawing zoomed to the region through `RoamPlexus.open`. Without Roam Plexus the card falls back to the block-ref card Roam renders.
- Roam model: The card is an ordinary `((uid))` ref block (kind `ref`), so nothing new is stored. Feature detection: `window.RoamPlexus?.apiVersion >= 6`.
- Design: Card kind `region-ref` when the target string parses with `owner === "roam-plexus"`. Body: thumbnail at card width (`thumbnail(uid, {maxWidth: w*dpr})`, re-requested on resize end), caption strip, drawing title chip. Map tier: caption only. Hover toolbar: Open drawing (RoamPlexus.open with `{region: true}`), Open in sidebar. Listens to `RoamPlexus.addEventListener("change")` to refresh thumbnails for that drawing only. Encrypted graphs: Roam Plexus keeps thumbnails memory-only; Plexus Diagram caches nothing.
- Build tips: Detection in `classifyString` cannot see the target; resolve in `buildBoard` through `blockText(uid)` as `itemLabel` does. Rendering in `src/view/cards.js` with a `pxd-item--region` class; use the Roam Plexus `roam-plexus:ready`/`:unload` window events to switch kinds live. Do not call `thumbnail` for offscreen cards (PERF-3 visibility set). Tests with a stub `RoamPlexus`.
- Acceptance: 1. Readwisenotes has Roam Plexus regions (spike page `8eai6ikkw`, region `eyjMKi1DA`): paste `((eyjMKi1DA))` on the Test Lab board → crop card with caption; shot light/dark. 2. Click Open: Roam Plexus opens the drawing zoomed to the region (full-screen editor visible). 3. Unload Roam Plexus: the card becomes a plain ref card, no error. 4. Resize the card: thumbnail re-requested once (count wrapper). 5. Zero writes beyond the card create.
- Out of scope: Creating Roam Plexus regions from the board.
- Revisit when: n/a

### ECO-4 — Drawing cards: Excalidraw blocks on a board
- Phase: P19 · Version: 2.10.0 · Effort: M · Priority: medium · Depends: ECO-3
- Summary: A `{{[[excalidraw]]}}` block dropped on a board becomes a drawing card showing Roam's own view image (or a Roam Plexus thumbnail when loaded), with Open drawing, Open in sidebar, and, with Roam Plexus, a "Regions ▸" list of that drawing's regions to add as crop cards. "New drawing here" creates a drawing block as a card through `RoamPlexus.create` when present, else a bare `{{[[excalidraw]]}}` child.
- Roam model: The card is the drawing block (a child of the board) or a `((uid))` ref to one elsewhere. Creating writes one block. Never writes `:excalidraw/*` or props on a drawing block (Roam Plexus §13 S3: a props write wipes `:excalidraw/*`). Plexus props for the card therefore live on a wrapper: a drawing card on a board is always a `((drawingUid))` ref card, never the drawing block itself.
- Design: Body: `img.rm-inline-img--excalidraw` from a hidden `renderBlock` snapshot when Roam Plexus is absent (57 ms warm, spec §13), else `RoamPlexus.thumbnail`. Click on the image: nothing (native view image is inert); the toolbar Open uses `RoamPlexus.open` or the native fullscreen path (`openBlock` then the user clicks the expand icon; toast explains). Canvas menu "New drawing here" (Commands… list too).
- Build tips: Enforce the wrapper rule in `src/model/drop.js`: a dropped drawing block uid becomes a `((uid))` card, with a toast "Drawings stay where they are; this is a reference". `renderBlock` into the hidden holder pattern from `task-complete.js`, unmounted after the image URL is captured (same-origin blob, untainted). Tests: drop conversion, thumbnail source choice.
- Acceptance: 1. Drag a drawing bullet onto the board: a ref card with the drawing image; pull the drawing block: `:block/props` unchanged. 2. With Roam Plexus: Regions ▸ lists `regionsOf` entries; picking one adds an ECO-3 card. 3. New drawing here with Roam Plexus: `RoamPlexus.create` called once, card appears. 4. Without Roam Plexus: bare `{{[[excalidraw]]}}` child plus a ref card. 5. Dark/light shots.
- Out of scope: Editing the drawing inside the card.
- Revisit when: n/a

### ECO-5 — Compass: boards and cards as nodes
- Phase: P19 · Version: 2.10.0 · Effort: L · Priority: high · Depends: ECO-2
- Summary: In `~/roam-compass`, when `window.PlexusDiagram` is present, a `{{[[diagram]]}}` board is a node with a thumbnail, a board's cards hang south of it, and a page or block that sits on boards shows those boards north-west as "On board" neighbours. Clicking a board node centres it; "Open on board" opens it with the card spotlit.
- Roam model: Compass reads only (its rule); it uses `PlexusDiagram.boardsWith`, `cardsOf`, `thumbnail`, `open`. No Compass writes change.
- Design: Compass setting "Boards" (default on when the API exists, like its Drawings setting). Node kind `board`: 160 px thumbnail, title from `parseBoardTitle`; connections (Plexus `Connections` blocks) become labelled edges between card nodes, using the connection label as the edge label the same way `Role:: Lead` does. Context menu on a board or card node: Open on board, Open in sidebar. Hover: 480 px thumbnail (same as drawings).
- Build tips: `src/model/neighborhood.js` `isDrawingLike` / `plexusKind` get a sibling `isBoardLike` (`{{[[diagram]]` prefix) and a `diagram()` accessor mirroring `plexus()` in `overlay.js` line 21. Edge labels from connection strings: parse `[[A]] → label → [[B]]` (grammar in Plexus `src/model/schema.js parseEdgeLabel`; copy, do not import). Thumbnail budget: Compass already caps thumbnails per render pass; put boards under the same cap. Tests in the Compass repo with a stub `PlexusDiagram`.
- Acceptance: 1. Compass centred on a page that is a card on two fixture boards shows two board nodes with thumbnails. 2. Click a board node: its cards appear south (count equals `cardsOf` length, capped by Nodes per side). 3. Two cards joined by a labelled connection show an edge with that label. 4. "Open on board" lands on the board with the card pulsed. 5. Compass with Plexus Diagram unloaded shows no board nodes and no error.
- Out of scope: Dragging nodes in Compass to move cards.
- Revisit when: n/a

### ECO-6 — Two-way hop: board → Compass, Compass → board
- Phase: P19 · Version: 2.10.0 · Effort: S · Priority: medium · Depends: ECO-5
- Summary: A card's menu gets "Open in Compass" when Compass is loaded, and Compass's node menu gets "Show on board…" listing the boards that hold that page or block. Compass gains a tiny global so Plexus can call it.
- Roam model: None.
- Design: In Compass: `window.RoamCompass = Object.freeze({ apiVersion: 1, open(uid, {sidecar?}), focusBlock(uid), isOpen() })` plus `roam-compass:ready`/`:unload`. In Plexus: card menu row "Open in Compass" (feature-detected), passing the page uid for page cards and the block uid otherwise. In Compass: node menu "Show on board…" uses `PlexusDiagram.boardsWith`; one board opens directly, several show a picker.
- Build tips: Compass currently exposes nothing on window; add the global in its `extension.js` lifecycle with the same install/uninstall discipline as ECO-2. Plexus menu row in `menu-model.js`. Tests on both sides with stubs.
- Acceptance: 1. From a page card, "Open in Compass" opens Compass centred on that page. 2. From Compass, "Show on board…" on a page carded on one board lands with the card pulsed; on two boards shows a picker. 3. Unload Compass: the Plexus menu row disappears on next open.
- Out of scope: Sidecar syncing.
- Revisit when: n/a

### ECO-7 — Sketch on a card: annotate an image card as a drawing
- Phase: P19 · Version: 2.10.0 · Effort: M · Priority: low · Depends: ECO-4
- Summary: With Roam Plexus loaded, an image card's menu offers "Annotate as drawing": Roam Plexus creates a drawing with that image placed and locked, Plexus adds the drawing as a card beside the image, and a connection "annotates" links them. Users mark up a floor plan or CAPA photo without leaving the board.
- Roam model: `RoamPlexus.create({...})` makes the drawing block; Plexus adds a `((drawingUid))` card and one connection block `((drawing)) → annotates → ((image))`. Roam Plexus owns the image placement (its AUTH-15 path; if `create` cannot place an image, the task falls back to creating an empty drawing and toasting "Drop the image into the drawing").
- Design: Menu row visible only with Roam Plexus. After creation the drawing card opens full screen through `RoamPlexus.open`. Positions: drawing card to the right of the image card, same size.
- Build tips: Check `RoamPlexus.spec().methods` for an image-capable create option at runtime; measure first on Readwisenotes what `create` accepts (record in §8). Writes: 3 blocks, one undo group as far as Roam allows (creates are sequential; document the count). Tests with a stub.
- Acceptance: 1. On an image card: Annotate as drawing creates the drawing, card and connection; the drawing opens. 2. The connection chip in the outline reads "drawing —annotates→ image". 3. Without Roam Plexus the row is absent.
- Out of scope: Syncing annotations back onto the image card.
- Revisit when: n/a

### DOC-19 — P19 gate and release 2.10.0
- Phase: P19 · Version: 2.10.0 · Effort: S · Priority: high · Depends: ECO-2, ECO-3, ECO-4, ECO-5, ECO-6, ECO-7
- Summary: Standing gate across three repos (Plexus Diagram, Roam Compass, Roam Plexus), the interop matrix recorded, releases shipped.
- Roam model: None.
- Design: Add `docs/interop.md` to Plexus Diagram: a matrix of the three extensions × features with "requires" cells, all feature-detected, and the three window globals with their apiVersions. README "Works with" section. CHANGELOGs in each repo.
- Build tips: Run the live matrix in four configurations: all three loaded; each one alone. Each configuration must show no console errors from any of the three. Record in §8.
- Acceptance: 1. `npm run check` green in all three repos. 2. Four-configuration matrix recorded with zero errors. 3. Typing bench ≤ +0.1 no board with all three loaded. 4. Unload each in turn leaves no globals of its own and no `.pxd-*`, `.compass-*`, `.plexus-*` nodes. 5. Published files byte-identical for each.
- Out of scope: n/a
- Revisit when: n/a

---

### PDF-1 — PDF card: Roam's native reader on the board
- Phase: P20 · Version: 2.11.0 · Effort: M · Priority: high · Depends: PERF-3
- Summary: A `{{[[pdf]]: url}}` block becomes a PDF card. At rest it is a cover: file name, page of highlights count, and "Open reader". Opening mounts Roam's own PDF Annotator inside the card (every native control: highlight, area highlight, search, fullscreen), sized 640×820, one open reader per board.
- Roam model: The card is the pdf block (a board child) or a `((uid))` ref to one. Never writes `:pdf-settings` (Roam's per-user prop on the pdf block) or any `:pdf-*` prop; merge-write keeps them when `plexus` props change. Highlight count = children of the PDF's page (named after the file plus fingerprint) under `Notes by [[User]]` → `[[Date]]`.
- Design: Cover state: document glyph, title from the URL file name (or `:pdf-fingerprints` page title when resolvable), "N highlights", Open reader button, hover toolbar Open in sidebar / Fullscreen (native). Reader state: `renderBlock` of the pdf block into the card body behind the EMBED shield (`EMBED_SEL` already lists `.rm-pdf-container`); an "Interact" toggle on the header lifts the shield so the reader takes wheel and pointer events; Esc or clicking the board returns to shielded. Opening a second reader closes the first (toast). Map tier: cover only. Fullscreen uses the reader's own control.
- Build tips: `classifyString` kind `pdf` for `/^\{\{\[\[pdf\]\]:/`. `.enc` URLs: Roam's reader decrypts itself; do not fetch the URL. Find the PDF page by `:pdf-fingerprints` on a highlight block or by title pattern `<file name> -- <md5>`; measure first whether the pdf block carries a prop linking to its page and record it in §8. Shield logic in `src/view/cards.js` ~line 298. Mounting a reader is expensive: measure mount time and long tasks; unmount on card leave of viewport after 30 s (PERF-3 hook). Tests: classify, cover model, single-reader rule.
- Acceptance: 1. Upload a 3-page PDF on Test Lab (`/upload`), make two highlights natively, drag the block to the board: cover shows "2 highlights". 2. Open reader: native toolbar visible inside the card, page nav works in Interact mode, board pan works when shielded. 3. Open a second PDF card's reader: the first returns to cover. 4. Fullscreen via the native button, Esc back, card intact. 5. Pull the pdf block before and after: only `plexus` props changed (position), `:pdf-settings` preserved byte-identical. 6. Dark/light shots; typing bench with one reader mounted recorded in §8.
- Out of scope: A custom highlighter. Writing reader state.
- Revisit when: n/a

### PDF-2 — Highlight cards
- Phase: P20 · Version: 2.11.0 · Effort: M · Priority: high · Depends: PDF-1
- Summary: A PDF highlight block on the board (as a ref card) looks like a highlight: a colour bar from its `#h/<colour>` tag, the quoted text or the area image, a "p. N" badge, and the source PDF's name. It is still the real block, so Roam's own click-to-open behaviour is preserved inside the card.
- Roam model: Reads `:block/props :pdf-highlight` (`type`, `content.text` or `content.image-id`, `position.boundingRect.pageNumber`), the `#h/<colour>` tag and `:pdf-fingerprints`. No writes.
- Design: Card class `pxd-item--highlight`; left 4 px bar in the tag colour (yellow, green, blue, pink, purple, orange, red: map to palette; unknown → gray); body: the block rendered with `renderString` of the string minus the colour tag at rest; area highlights show the image (file.get for `.enc`); footer: "p. 12 · <pdf name>". Map tier: colour bar and first line. Hover toolbar: Open in reader (PDF-4), Open block, References.
- Build tips: Highlight detection needs props, so `BOARD_PATTERN` (`src/host/roam.js` line 16) must pull `:block/props` for ref targets too; extend `blockText`-style resolution with a `blockProps(uid)` host method. Hide `#h/*` in the card body only (CSS scoped to the item), keep it in the outline. Tests: prop parsing with text and area types, colour map, missing props → plain ref card.
- Acceptance: 1. Drag a highlight bullet from the PDF page outline onto the board: the card shows the colour bar, text and "p. N" matching `pageNumber`. 2. An area highlight shows its image. 3. Change the tag natively to `#h/green`: the bar follows after the echo. 4. A card for a block without `:pdf-highlight` renders as a normal ref card. 5. Dark mode: bar plus border, no filled background.
- Out of scope: Editing highlight geometry.
- Revisit when: n/a

### PDF-3 — Getting highlights onto the board: drag, paste, picker
- Phase: P20 · Version: 2.11.0 · Effort: M · Priority: high · Depends: PDF-2
- Summary: Three verified paths: drag a highlight's bullet from the PDF page (outline or sidebar) onto the board; copy a highlight ref in the reader (Cmd-Shift-C) and paste on the board; or open "Add highlights…" on the PDF card, tick the ones you want and place them in a tidy grid beside the card, at most 45 at a time.
- Roam model: Each highlight becomes a `((highlightUid))` ref card child of the board (one create each, chunked at 45). The picker reads the PDF page tree; nothing else.
- Design: Picker dialog: grouped by date (`[[Date]]` blocks), each row with colour bar, text snippet, page number; filter by colour and page; Select all on page; Place as grid (3 columns, 300×140) or Place as column; opens with the already-placed ones ticked and disabled. Drop from the reader itself: measure whether the native highlight popup or highlight list is draggable (facts say only bullets carry `roam/block-uid-list`); if not, the picker and paste are the paths and the README says so.
- Build tips: Bullet drops already parse `roam/block-uid-list-only-parents` (`src/model/drop.js`); a dropped `[[Date]]` group block must expand to its highlight children when the user drops a date block (ask: "Add 7 highlights under this date?"). Paste of `((uid))` is the existing plain paste path. Grid placement via `src/model/layout.js`. Tests: picker model grouping, 45 cap, already-placed detection.
- Acceptance: 1. Bullet drag of one highlight → one card. 2. Cmd-Shift-C in the native reader then Cmd-V on the board → one ref card (manual check in the ledger notes if CDP clipboard fails, per the MEMORY note). 3. Picker: select 5 of 7, Place as grid → 5 cards in 3 columns, one undo removes all 5 (single chunk). 4. Reopen picker: 5 disabled. 5. Reader-drag result recorded in §8 either way.
- Out of scope: Importing highlights from other PDF tools.
- Revisit when: n/a

### PDF-4 — Open a highlight in the reader at its position
- Phase: P20 · Version: 2.11.0 · Effort: M · Priority: high · Depends: PDF-3
- Summary: "Open in reader" on a highlight card opens the PDF and scrolls to that highlight, using Roam's own click behaviour on highlight blocks (the help changelog says clicking a highlight opens the pdf and scrolls into view). If the PDF card for that file is on the board, the reader opens inside that card; otherwise Roam opens it where it normally does.
- Roam model: Read-only. Depends on Roam's native handler attached to the rendered highlight block.
- Design: Measure first: render a highlight block with `renderBlock({open:false})` in a hidden holder and find which element carries the open handler (`.rm-pdf-highlight` or a child), where Roam opens the pdf (main window? the block's own pdf render? fullscreen?), and whether a dispatched `click` (React synthetic events fire for dispatched MouseEvents) triggers it. Then: toolbar button → if a PDF card for the same fingerprint is on the board, switch it to reader state first, then dispatch the native click on the card's own rendered highlight; the reader scrolls. Fallback: `openBlock(highlightUid)` with a toast "Click the highlight to open the PDF".
- Build tips: Fingerprint match: `:pdf-fingerprints[0]` on the highlight equals the md5 in the PDF page title; the pdf block's URL is not the fingerprint, so resolve pdf block → page by scanning highlight props once per board (cache 5 s). Use the `task-complete.js` hidden-holder pattern for the measurement spike. Record findings in §8 before coding the button. Tests: fingerprint resolution, fallback path.
- Acceptance: 1. §8 row with the measured handler element and open target. 2. Highlight card + PDF card on the board: Open in reader shows page N in the card reader with the highlight in view (screenshot). 3. Without the PDF card: Roam's own open behaviour happens, nothing breaks. 4. Zero writes.
- Out of scope: Scrolling to a page without a highlight (PDF-7 chips).
- Revisit when: n/a

### PDF-5 — Area highlights as image cards with regions
- Phase: P20 · Version: 2.11.0 · Effort: S · Priority: medium · Depends: PDF-2, REG-2
- Summary: An area highlight (`![](…png)` with `:pdf-highlight.type "area"`) is an image: on the board it can be resized, cropped visually, and marked with REG-2 regions, so a figure from a paper gets `((region))` refs like any image.
- Roam model: The area highlight block is the owner of its `{{[[plexus-regions]]}}` container, exactly as any image block. `.enc` images via `file.get`.
- Design: Area highlight cards use the image card renderer with the PDF-2 footer. Mark region, Show regions, badges all apply. "Open in reader" stays in the toolbar.
- Build tips: Kind resolution: `image` first (string), then `highlight` decoration from props; make `cards.js` compose the two rather than branch. `:image-size` prop gives natural size for the first layout without waiting for the image. Tests: composition order, natural size from props.
- Acceptance: 1. Area highlight card renders the image at the `:image-size` ratio before load. 2. Mark region writes the container under the highlight block; the ref renders inline (REG-4) and click opens the board (REG-5). 3. `:pdf-highlight` props untouched after the region write (merge-write check).
- Out of scope: Re-cropping the PDF area itself.
- Revisit when: n/a

### PDF-6 — Highlight colours as card colours and a colour lens
- Phase: P20 · Version: 2.11.0 · Effort: S · Priority: medium · Depends: PDF-2
- Summary: Highlight colour tags map to board colours automatically, and the Lens menu gets "Highlight colour" to dim everything but one colour (for example only the pink "objections"). Changing a highlight's colour from the card writes the tag Roam's own reader would write.
- Roam model: Card colour derives from `#h/<colour>` at render time; nothing stored unless the user picks a colour on a highlight card, which rewrites the `#h/<colour>` tag in the block string (one write; Roam's reader reads that tag back).
- Design: Palette map: yellow→yellow, green→green, blue→blue, pink→pink, purple→purple, orange→orange, red→red; the colour picker on a highlight card shows these seven first with the `#h/` label. Lens rows under the existing tag lens (`src/model/lens.js`). Kanban "Lanes: Highlight colour" for review boards.
- Build tips: Measure first that Roam's reader honours a changed `#h/*` tag (recolours the highlight) and record in §8; if it does not, keep the write but say so in the tooltip. Lens via the existing `lens.js` predicate API. Tests: tag rewrite keeps the rest of the string, lens predicate.
- Acceptance: 1. Seven colours render as seven card colours. 2. Lens "pink" dims the others (opacity class), toggled off restores. 3. Picker green on a yellow highlight rewrites `#h/yellow` to `#h/green`; the native reader shows green after reload (or the §8 note). 4. Undo restores the string.
- Out of scope: New colour names.
- Revisit when: n/a

### PDF-7 — Board ↔ PDF links: page chips and arrows into highlights
- Phase: P20 · Version: 2.11.0 · Effort: M · Priority: medium · Depends: PDF-4, REG-7
- Summary: The PDF card shows a strip of page chips for pages that have highlight cards on this board; clicking a chip pulses those cards, double-click opens the reader there (through one of that page's highlights). Arrows can end on a highlight (block arrows already exist), and a PDF card's reader shows a small "On board" chip on highlights that are cards, with Show on board.
- Roam model: Arrows into highlights are the existing `toBlock` connections, which write `((highlightUid))` so the highlight's backlinks show the board. The "On board" chip is read-only, driven by the relchips-style scan of rendered highlight blocks whose uid is a card on an enhanced board (the NAV-1 cache).
- Design: Chip strip under the cover title and under the reader header; chips sorted by page; count badge. Arrow end on a highlight card: the row pill shows "p. N". Inside the mounted reader the native highlight list (if Roam renders one) is decorated with the chip; if no list exists, the chip appears on the highlight blocks in the PDF page outline instead (same code path as NAV-1).
- Build tips: Page numbers from PDF-2's parsed props grouped per PDF fingerprint. The reader chip decoration uses `scanAdded` with the NAV-1 uid cache (build NAV-1's cache module early in this task if P21 has not shipped; it is a pure cache keyed by enhanced boards' child uids). Tests: chip grouping, double-click target choice (first highlight on that page).
- Acceptance: 1. PDF card with highlight cards from pages 2 and 3 shows chips "2" and "3". 2. Click "3": the page-3 cards pulse. 3. Double-click: reader open at page 3. 4. Connect a note card to a highlight card: the connection string holds `((highlightUid))`; the highlight's Linked References list the board's connection with a relchip. 5. Highlight blocks in the PDF page outline show the "On board" chip for carded ones only.
- Out of scope: Writing anything into the PDF.
- Revisit when: n/a

### DOC-20 — P20 gate and release 2.11.0
- Phase: P20 · Version: 2.11.0 · Effort: S · Priority: high · Depends: PDF-1, PDF-2, PDF-3, PDF-4, PDF-5, PDF-6, PDF-7
- Summary: Standing gate, PDF documentation, release.
- Roam model: None.
- Design: README "PDFs" section: what is native (highlighting, reader) and what Plexus adds; the three paths to get highlights on a board; the Svy note that `.enc` files open through Roam's reader. Spec: pdf card kind, highlight decoration, no `:pdf-*` writes. §8: reader mount cost, typing bench with a mounted reader, the PDF-4 handler measurement.
- Build tips: Delete the test PDF upload and its page through the ledger (file delete via `file.delete` if the harness supports it; otherwise record the leftover).
- Acceptance: 1. `npm run check` green. 2. Typing bench no board ≤ +0.1; with a PDF card in cover state mounted on the page ≤ +0.5 (median). 3. Unload 0 `.pxd-*`, 0 mounted readers left (`.rm-pdf-container` count returns to pre-inject). 4. Published files byte-identical. 5. Ledger clean, leftovers listed.
- Out of scope: n/a
- Revisit when: n/a

---

### MEM-1 — Context halo: when, where and with what a card or connection was made
- Phase: P21 · Version: 2.12.0 · Effort: M · Priority: high · Depends: REG-7
- Summary: Years later, a connection is only useful if you can recall why it was made. Hovering the ⓘ on a card or a connection shows its halo: created on [[date]] (by user), last edited, which board and section it was on, which cards were created within a day of it on the same board (its "company"), how many blocks reference it and the first and latest date among them. Everything comes from Roam's own timestamps and refs; nothing is written.
- Roam model: Reads `:create/time`, `:edit/time`, `:create/user`, `:block/_refs` of the card's target (page or block), the board's structure for section and neighbours, and the daily-page uid of each date (`util.dateToPageUid`). Zero writes.
- Design: Halo popover (placed by `placePopover`): header "Made October 4th, 2026 on Board X › Section Y"; row "With: card A, card B" (created within ±24 h on this board, max 6, click pulses them); row "Referenced 14 times, first Jan 2025, last Sep 2026" with a 12-bucket sparkline of refs per quarter (inline SVG, pre-computed, no JS at view time); row "On 3 boards" (from `boardsWith`). Each date is a real `[[date]]` link (renderString of the date ref so Roam's hover preview and click work). Also available from the card menu "Context" and the `I` info panel section.
- Build tips: Add `:create/time :create/user :edit/time` to `BOARD_PATTERN` pulls (check cost on a 320-card board; these are scalar fields). Refs with dates: one query per halo open, not at mount; cache 60 s per uid. Sparkline buckets in a pure module `src/model/halo.js`. Dates render with `renderString` of `[[Title]]` inside a `pxd-root` so Roam's mousedown navigation is routed by the root capture path as elsewhere. Tests: company window, bucket math, empty refs.
- Acceptance: 1. On the fixture, hover ⓘ of a connection: header date equals the block's `:create/time` day; the board and section names match. 2. "With:" lists the cards created in the same fixture build minute. 3. Sparkline has 12 buckets and the total equals the refs count from a direct query. 4. Click a date: Roam navigates to that daily page. 5. Zero writes (`:edit/time` scan). 6. Dark/light shots.
- Out of scope: Guessing intent. Storing a derived "made with" relation.
- Revisit when: n/a

### MEM-2 — "Why" on connections: elaboration you can read back
- Phase: P21 · Version: 2.12.0 · Effort: S · Priority: high · Depends: MEM-1
- Summary: When you label an arrow, the label popover offers a second line, "Why?". The answer becomes the connection's first child block (connection children are already its notes). The arrow shows a small ¶ mark when a why exists; hover shows it; the relation chip in the outline includes it. A board setting can prompt for a why on every new labelled connection.
- Roam model: One child block under the connection block with the text as typed (plain string; `[[refs]]` allowed and real). No new macro. Reading: the first child that is not an attribute.
- Design: Label popover: label field, Why field (Shift+Enter for newline, Enter saves both), placeholder "Because…". Setting `why-prompt` (off by default): after creating a labelled connection, focus the Why field. Arrow mark: a 10 px ¶ near the label at detail tier; tooltip shows the why text (first 200 chars). Relation chip text appends " · because …" (clip 48). Edit later: connection menu "Edit why".
- Build tips: The label write path is in `src/view/edges.js` and the session's edge update; adding a child is one more create (two writes, one action). `chipText` in `relchips.js` gains an optional `why`. Tests: popover saves label and why; chip text; empty why writes nothing.
- Acceptance: 1. Connect two cards, label "causes", why "seal temp drifted": connection block string holds the label, first child holds the why. 2. Arrow shows ¶; hover tooltip shows the text. 3. Outline chip reads "A —causes→ B · because seal temp drifted". 4. Cmd+Z twice removes why then label. 5. Why empty: no child created.
- Out of scope: Required whys, templates for whys.
- Revisit when: n/a

### NAV-1 — Board chips on card refs anywhere in Roam
- Phase: P21 · Version: 2.12.0 · Effort: L · Priority: high · Depends: ECO-2
- Summary: Relation chips (2.4) exist for connections; this extends the idea to cards. Wherever Roam renders a block that is a card on an enhanced board, a quiet "▦ on Board X" chip appears under it (outline, sidebar, Linked References, search results excluded). Hover shows a mini-map of the card's neighbourhood; click opens the board with the card spotlit. This is the retrieval cue that brings a board back when you only remember the note.
- Roam model: Read-only. A cache of card uids per enhanced board, loaded once at start from the boards' children (direct children plus section children), refreshed by the mounted sessions' `noteBoard` path and by a cheap periodic re-pull of unmounted boards' child lists (every 60 s, only boards whose `:edit/time` changed).
- Design: Chip after the relchip rules: `pxd-cardchip`, one per board (max 3 shown, "+N"), hidden while editing the block, setting `card-chips` (on/off, default on) and a per-page opt-out tag `#plexus-no-chips`. Hover popover: 320 px mini-map of the card and its connected neighbours (SVG from `minimap-svg.js`), board title, section name, Open on board, Open in sidebar. Page cards: the chip appears on the page's title area? No: only on block refs and the page's own blocks when the page is a card: a single chip under the page title would require touching Roam's title DOM; instead show it in the Linked References header area as a `pxd-root` row inserted after `.rm-reference-main` header. Measure both and pick the one with zero layout shift.
- Build tips: Reuse `createConnectionCache` shape for a `createCardCache` (uid → boards[]) and the `scan` hook in `feature.js` (same `SCAN_CAP`). Start-up load must be one query for all enhanced boards' children (`[:find ?child ?board :where [?board :block/props ?p] … ]` is not possible on props; instead keep the enhanced-uid cache from `discovery.js` (`readEnhancedUidCache`) and pull children for those uids in one `pull-many`). Budget: measure the typing bench on a page with 50 carded blocks visible; the chip must not add a listener per chip beyond the delegated click. Tests: cache build, multi-board text, hidden while editing.
- Acceptance: 1. A Test Lab block that is a card on the fixture board shows "▦ on P18 fixture" in the outline and in the sidebar. 2. Hover: mini-map with the card highlighted and its two connected neighbours. 3. Click: board opens with the card pulsed. 4. Same block on two boards: two chips, each opening its board. 5. Typing bench on a page with 50 chips visible ≤ +0.1 ms/key; start-up cache load under 50 ms for 20 boards (log it). 6. Unload removes all chips.
- Out of scope: Chips inside Plexus cards themselves (they already know).
- Revisit when: n/a

### NAV-2 — All-contexts drawer for a block card
- Phase: P21 · Version: 2.12.0 · Effort: M · Priority: medium · Depends: MEM-1
- Summary: A block-ref card gets a drawer that lists every place the block is used: each reference with its breadcrumb (page › parent), date, and a one-line snippet, newest first, grouped by year. It answers "where else did I use this thought" without leaving the board, and each row opens in the sidebar.
- Roam model: Reads `:block/_refs` of the target block plus each referrer's parents and page. No writes. (The existing Linked References drawer covers page cards; this is the block-card counterpart.)
- Design: Drawer toggle in the card toolbar (References already opens Roam's mentions for page cards; for block cards it now opens this drawer inline under the card body, 240 px tall, scroll). Rows: year header, date chip, breadcrumb (two levels, ellipsis), snippet with the ref highlighted. Shift-click opens in sidebar, click opens in main window. Filter box when > 20 rows. Map tier hides it.
- Build tips: Query through `src/model/refs.js`; render snippets with `renderString` of the referrer block string limited to 200 chars so refs inside stay real. Cap 200 rows, progressive render in chunks of 25 (reuse `progressive.js`). Tests: grouping by year, breadcrumb trimming, cap.
- Acceptance: 1. A block referenced from three pages: drawer shows three rows under the right years with correct breadcrumbs. 2. Shift-click opens the sidebar on that block. 3. 250 referrers (fixture page generating refs): first 25 rows paint under 100 ms, rest stream; cap note shown. 4. Zero writes.
- Out of scope: Editing referrers inline.
- Revisit when: n/a

### MEM-3 — Memory lane: a time scrubber over the board
- Phase: P21 · Version: 2.12.0 · Effort: M · Priority: medium · Depends: MEM-1
- Summary: A slider in the board bar scrubs through time using every card's and connection's `:create/time`: items made after the slider's date fade, the section titles stay, and a date label follows the thumb. Play animates from the first card to today. Snapshots (if any) appear as ticks you can snap to and restore read-only. You watch the board grow the way it grew.
- Roam model: Read-only. `:create/time` already pulled by MEM-1. Snapshot ticks read the existing `type: snapshot` blocks. Nothing is written; the scrubber state is memory only.
- Design: More menu "Memory lane" or Shift+T. A 36 px bar under the board bar: slider from the earliest `:create/time` to now, date label, Play/Pause (1 s per month, honouring motion setting), ticks for snapshots and for the daily pages that reference ≥1 card (from NAV-3's spine data, if present). Items later than the thumb: `opacity .12`, connections hidden; items created within the thumb's week: brief accent outline. Esc closes and restores.
- Build tips: Pure module `src/model/timeline.js`: `timeIndex(board)` returning sorted events and a `visibleAt(t)` predicate; the view applies one class per item on a rAF, no model rebuild. Snapshot restore as preview only (do not call the restore writer; render the snapshot layout in memory via `src/model/snapshots.js` and discard). Tests: index, predicate, snapshot preview non-write.
- Acceptance: 1. Open Memory lane on the fixture: thumb at start shows only the first card made; at end everything. 2. Play runs to the end in under 20 s for a two-year span and stops. 3. A snapshot tick previews that layout; Esc returns to live layout; `:edit/time` of every item unchanged. 4. Dark/light shots mid-scrub.
- Out of scope: Replaying edits to text.
- Revisit when: n/a

### MEM-4 — Resurface: a daily-page macro that brings old connections back
- Phase: P21 · Version: 2.12.0 · Effort: M · Priority: high · Depends: NAV-1
- Summary: Spacing beats cramming. A user puts `{{[[plexus-resurface]]}}` in their daily-note template; on today's page it renders "From your boards" with cards and connections made 1 week, 1 month, 3 months, 1 year and N years ago today (±1 day), each with its board, a mini-map thumbnail and Open on board. Nothing is auto-written to daily pages; the user places the macro once.
- Roam model: The macro is a user-placed block; Roam renders unknown `{{[[name]]}}` as a button, which Plexus decorates (same technique as region buttons). Reads `:create/time` across enhanced boards' children and connections (uses the NAV-1 cache plus a pull of `:create/time` for its uids). Zero writes.
- Design: Panel inside the block: header with the five intervals as tabs (only non-empty shown), up to 6 items per interval: card title, board name, date made, 96 px mini-map; Open on board, Open block; "Why" text from MEM-2 shown for connections. Empty state: one quiet line "Nothing from a week, a month or a year ago." Renders only on the daily page whose date is today or the page's own date (so looking at an old daily page shows what was due then). Setting `resurface-intervals` (comma list of days, default `7,30,90,365`).
- Build tips: Decorate `button.rm-xparser-default-plexus-resurface` in the `scanAdded` pass; resolve the page date with `util.pageTitleToDate` on the containing page title. Compute matches in a pure module `src/model/resurface.js` from `(uid, createTime, boardUid)` rows; sort by closeness to the anniversary. Thumbnails via `minimap-svg.js`. Also offer a Commands… entry "Resurface here" that inserts the macro block under the focused block (one create). Tests: interval matching with ±1 day, per-interval cap, old-page date.
- Acceptance: 1. Fixture: set `:create/time` cannot be forged, so use the fixture builder's real times plus a Readwisenotes board that is older than 7 days (keep one "aging fixture" board from P18 for this): the macro on today's page shows its cards under "1 week ago". 2. On a daily page from last month it shows the matching items for that date. 3. Open on board lands and pulses. 4. Typing bench on the daily page with the macro rendered ≤ +0.1. 5. Unload restores the plain button.
- Out of scope: Spaced-repetition scheduling or grading.
- Revisit when: n/a

### MEM-5 — Suggestions lens: unlinked and shared-reference neighbours on the board
- Phase: P21 · Version: 2.12.0 · Effort: M · Priority: medium · Depends: MEM-1
- Summary: Roam's Unlinked References find mentions you never linked; the board can do the same between its own cards. The Suggest lens draws dotted lines between cards where one card's text mentions the other's page title without a link, or where both reference the same page or attribute value. Hover a dotted line to see the reason; one click turns it into a real connection (a block under Connections), optionally with the shared page as the label.
- Roam model: Reads card strings, page titles and `:block/refs`. Accepting writes one connection block (existing `addEdge`); "Link text" is a separate explicit action that edits the mentioning block string to wrap the title in `[[ ]]`.
- Design: Links menu gains "Suggest" (Off / Shared refs / Shared + unlinked). Dotted thin lines in a muted colour, never more than 60 on screen (top by score), tooltip "Both reference [[Zone 2]]" or "Mentions 'Sanitation' without a link". Click: popover with Connect (label prefilled with the shared page), Link text (only for unlinked, shows the sentence), Dismiss (memory only for the session). Case-insensitive title match on word boundaries, titles ≥ 4 chars, skipping daily-page titles.
- Build tips: Score in a pure module `src/model/suggest.js`; run it in a settle tick after model builds, capped at 300 cards (beyond that, show "Too many cards to suggest" and offer selection-only). Title matching must avoid Roam's own regex pitfalls: build one alternation regex of escaped titles sorted by length. Tests: unlinked detection with word boundaries, shared ref pairs, cap and score order.
- Acceptance: 1. Fixture with card A text "sanitation drift" and card B page `[[Sanitation]]`, plus C and D both referencing `[[Zone 2]]`: Suggest shows two dotted lines with the right reasons. 2. Connect on C–D creates a connection labelled "Zone 2" (one block). 3. Link text on A wraps "sanitation" as `[[Sanitation]]` (one string write, undo restores). 4. Lens off removes all lines. 5. 300-card board computes under 150 ms (log).
- Out of scope: Semantic similarity, embeddings, network.
- Revisit when: n/a

### MEM-6 — Trails: ordered paths through cards, as blocks
- Phase: P21 · Version: 2.12.0 · Effort: L · Priority: high · Depends: REG-7, MEM-2
- Summary: Bush's memex trail: a named sequence of cards with a note at each stop. A trail is a block under the board's collapsed `Trails` child; its children are `((cardUid))` refs in order, each with optional note children. "Add to trail" from a card, "Walk trail" plays it in present mode stop by stop with the notes, and `((trailUid))` pasted anywhere renders as a strip of stops you can click.
- Roam model: Board child block `Trails` with `plexus {type: "trails"}`, collapsed; each trail `{{[[plexus-trail]]}} <name>` with `plexus {type: "trail"}`; stops are `((uid))` children; a stop's note is its first child block. Reordering a stop is `block.move` (one write). Cards may be on this board or any board (a stop on another board opens it).
- Design: Panel tab "Trails": list, new trail, rename, delete, drag to reorder stops. Card menu "Add to trail ▸" (existing trails, New trail…). Cards on the active trail show a numbered badge; the trail is drawn as a soft dashed path through the stops (not a connection, read-only decoration). Walk: present mode steps through stops, shows the stop note in the HUD, Space next. Inline `((trailUid))`: a horizontal strip of up to 8 stop titles with arrows; click a stop opens its board at that card; "Walk" button starts the walk.
- Build tips: Container handling parallels `edges`/`snapshots`/`regions` in `buildBoard`. Present integration in `src/view/present.js` (it already walks sections; add a stops source). Inline strip through the `scanAdded` macro decoration (button class `rm-xparser-default-plexus-trail`). Reorder with `move_block` and the echo ledger. Tests: trail model, stop order, strip model, 45 cap on "Add selection to trail".
- Acceptance: 1. New trail "Onboarding", add 4 cards: block tree as specified; badges 1–4 on the cards. 2. Reorder stop 3 above 2: one `move`, badges update after the echo. 3. Walk: 4 steps, notes shown, Esc exits with no writes. 4. Paste `((trailUid))` on a Test Lab page: strip with 4 stops; click stop 2 opens the board centred on it. 5. Cmd+Z after adding a stop removes it.
- Out of scope: Branching trails.
- Revisit when: n/a

### MEM-7 — Landmarks and the Walk: boards as memory palaces
- Phase: P21 · Version: 2.12.0 · Effort: M · Priority: medium · Depends: MEM-6
- Summary: A memory palace works because landmarks anchor positions. A card, sticky or section can be made a landmark: it gets a large glyph or image, stays visible at every zoom tier including overview, and is drawn on the minimap. "Walk the board" tours landmarks in reading order (left-to-right, then down) or along a chosen trail, pausing at each with its neighbourhood lit.
- Roam model: `landmark: true` plus optional `glyph: "<emoji or short text>"` in the item's `plexus` props (one props write per toggle). The Walk writes nothing.
- Design: Card menu "Make landmark" (toggle); Properties panel shows glyph picker (emoji input, 2 chars max) and size (S/M/L: 48/72/96 px glyph at detail tier). Overview tier: landmarks keep glyph and title while other cards are tiles. Minimap: landmark dots with glyph. Walk: present-mode variant from the More menu, order toggle (reading / nearest-next / trail), each stop fits the landmark plus a 1-screen neighbourhood. Dark: glyph on a bordered disc, no fill.
- Build tips: Schema keys in `src/model/schema.js` (`normalizeItemLayout`, `serializeItemLayout`), tier rules in `cards.js` and the overview CSS (RE-3 patterns for screen-constant sizes with `--pxd-screen-px`). Minimap in `board-view.js` minimap drawer. Reading order: sort by `y` bucketed to 200 world px then `x`. Tests: schema round trip, order sorts, overview visibility class.
- Acceptance: 1. Make 3 landmarks with glyphs: at 13% zoom they show glyph and title, other cards are tiles (shot). 2. Minimap shows 3 dots with glyphs. 3. Walk: 3 stops in reading order; Esc exits; zero writes. 4. Toggle off: props key removed, overview reverts. 5. Dark/light shots at 100% and 13%.
- Out of scope: Automatic landmark suggestion.
- Revisit when: n/a

### NAV-3 — Daily-notes spine: when this board was touched
- Phase: P21 · Version: 2.12.0 · Effort: M · Priority: medium · Depends: MEM-3
- Summary: Daily notes are Roam's time spine. The Info panel gets a "Timeline" section listing the daily pages that reference any card on this board (or the board itself), with how many refs each day and a click to open the day. The same data feeds Memory lane ticks and lets "Lay out by date" place cards by the day they were first mentioned, not only by their own date attribute.
- Roam model: Reads `:block/_refs` for every card target and groups referrers by their page when that page title parses as a date (`util.pageTitleToDate`). No writes except the existing "Lay out by date" props writes when the user runs it.
- Design: Panel section: a year-by-year list of days with counts (max 365 rows, collapse years), day click opens the daily page in the sidebar; "Show on board" on a day pulses the cards mentioned that day. Calendar lane option "Date source: attribute / first mention / last mention".
- Build tips: One batched query per board open of the panel (not at mount). Reuse `calendar` look code in `src/model/section6.js`. Tests: grouping, date parsing, source option.
- Acceptance: 1. Fixture cards referenced from three daily pages: Timeline lists three days with counts. 2. Show on board pulses the right cards. 3. Lay out by first mention orders cards by those days (props writes ≤ 45, one undo). 4. Zero writes when only viewing.
- Out of scope: Writing refs into daily pages.
- Revisit when: n/a

### MEM-8 — Strength and dust: a use-based lens (speculative)
- Phase: P21 · Version: 2.12.0 · Effort: M · Priority: low · Depends: MEM-1, NAV-3
- Summary: Pathways you use stay; the rest fade. A "Strength" lens scales connection weight by evidence of use (refs to either end over time, how many boards both ends share, recency of edits) and a "Dust" lens dims cards whose block and references have been untouched for longer than a chosen period, so a years-old board shows at a glance what is alive. Scores are explained on hover and never stored.
- Roam model: Read-only, from `:edit/time`, `:create/time` and refs already gathered by MEM-1 and NAV-3. Optional device-local "opened" counts in localStorage (same class as the viewport store), off by default (`track-opens`).
- Design: Lens menu: Strength (off/on), Dust (off / 6 months / 1 year / 2 years). Strength maps a 0–1 score to stroke width 1–4 and opacity .5–1; hover shows "12 refs, 2 shared boards, edited 3 months ago". Dust: `opacity .35` and a greyscale filter on cards; a card's halo shows the dust age. Clear labelling as heuristics in the tooltip.
- Build tips: Pure scoring module `src/model/strength.js` with a fixed, documented formula; expose the components so tests pin them. Opened-count store follows `createViewportStore` conventions (graph-scoped key). Tests: formula components, period thresholds.
- Acceptance: 1. Fixture with one heavily referenced pair and one bare pair: Strength draws the first at width ≥ 3 and the second at 1. 2. Dust 6 months on the aging fixture dims the untouched cards and not the recently edited one. 3. Hover explains the score with the three components. 4. Lenses off restores everything; zero writes.
- Out of scope: Automatic archiving or deleting.
- Revisit when: the MEM-1/NAV-3 data shows which signal users actually trust; if Strength looks arbitrary on real boards, keep Dust and drop Strength.

### DOC-21 — P21 gate and release 2.12.0
- Phase: P21 · Version: 2.12.0 · Effort: S · Priority: high · Depends: MEM-1, MEM-2, NAV-1, NAV-2, MEM-3, MEM-4, MEM-5, MEM-6, MEM-7, NAV-3, MEM-8
- Summary: Standing gate for the memory and navigation phase, with a short "How Plexus helps you remember" README section that maps each feature to the retrieval idea behind it in plain words.
- Roam model: None.
- Design: README section (≤ 200 words) plus a table of the lenses. Spec: trails and landmark props, the resurface macro, all read-only features marked as such. §8: NAV-1 cache load time and chip bench, MEM-5 compute time.
- Build tips: Run the typing bench on three pages: plain, 50 chips, daily page with the resurface macro.
- Acceptance: 1. `npm run check` green. 2. Three typing benches ≤ +0.1. 3. Unload 0 `.pxd-*`, 0 decorated macro buttons left. 4. Published files byte-identical. 5. Ledger clean.
- Out of scope: n/a
- Revisit when: n/a

---

### POL-1 — Integrations settings group with live detection
- Phase: P22 · Version: 3.0.0 · Effort: S · Priority: high · Depends: TSK-1, ECO-2
- Summary: One settings group shows each sibling extension and integration with its detected state and version ("Better Tasks: detected 1.3 · off", "Task Status Tags: not installed", "Roam Plexus: apiVersion 7", "Compass: ready", "Colour highlighter: detected") and the switch that governs it, so a user sees in one place what is on and why a feature is missing.
- Roam model: None.
- Design: Group rows render through the `reactComponent` row type with plain text status (no network, no links out). Switches: `better-tasks`, `task-tool`, `card-chips`, `resurface` (allow the macro), `regions-inline` (render crops inline), `interop` (Roam Plexus/Compass hooks). Status updates on the ready/unload events.
- Build tips: `src/settings.js groupRow` already uses a null React component; replace with a tiny `window.React.createElement` text renderer (React is global in Roam). Detection helpers live in `src/model/detect.js` and are reused by the features. Tests: status strings per detection state.
- Acceptance: 1. With all siblings loaded, the group shows five "detected" rows with versions. 2. Unload Compass: row flips to "not installed" within the event. 3. Switching `interop` off hides the Open in Compass row and stops thumbnail calls (count 0).
- Out of scope: Installing other extensions from Plexus.
- Revisit when: n/a

### POL-2 — Undo budget and write audit for every 3.x writer
- Phase: P22 · Version: 3.0.0 · Effort: S · Priority: high · Depends: REG-8, MEM-6, PDF-3
- Summary: Every new path that writes (regions, views, trails, why notes, highlight placement, status changes, landmarks) is audited against the 45-write cap and Roam's single-undo expectation, and a table in the README's Limits section says how many undo steps each gesture takes.
- Roam model: No change; the audit may add chunking where a path can exceed 45.
- Design: Extend the §8 gesture/undo table with the 3.x gestures. A `writeCounter` in the host (debug only, `window.__plexusDiagram.stats.writes`) counts creates, updates, moves and deletes per user action in dev builds.
- Build tips: The counter wraps the write queue in `src/host/roam.js createWriteQueue`. Tests: each writer's maximum write count under a 100-item input.
- Acceptance: 1. Table in README and §8 covering: mark region (≤ 3), save view (≤ 2), add trail stop (1), add selection to trail (≤ 45), place highlights (≤ 45 per chunk), why (1), landmark (1 per item, ≤ 45), status change (0 by Plexus). 2. Live: "Add selection to trail" with 50 cards stops at 45 with a toast. 3. Cmd+Z after each gesture restores the prior state (spot-check five).
- Out of scope: Changing Roam's undo.
- Revisit when: n/a

### POL-3 — Bundle and start-up budget
- Phase: P22 · Version: 3.0.0 · Effort: M · Priority: medium · Depends: NAV-1
- Summary: 3.x adds many modules; the bundle and start-up work must stay inside a stated budget: extension.js under 900 KB, CSS under 90 KB, load-to-ready under 80 ms with no board on the page, and the start-up caches (enhanced uids, card chips) built lazily after first idle.
- Roam model: None.
- Design: `npm run check` gains a size gate (fail over budget). Start-up: everything not needed for the first paint of a board moves behind the first `requestIdleCallback` (chip cache, resurface, suggestions), still in the single bundle (no dynamic loading, rule 3.9). Measure with `performance.mark` around `onload`.
- Build tips: esbuild metafile for the size report (`--metafile`), check the biggest modules; tree-shake dead view code (older toolbar layouts kept per rule 3.1 stay). `lifecycle.js` is where idle work should be scheduled and cancelled on unload. Tests: size gate script, idle scheduling cancel on unload.
- Acceptance: 1. Size report committed under `docs/size.md` with the per-module top 15. 2. `extension.js` < 900 KB, `extension.css` < 90 KB. 3. `onload` to ready mark < 80 ms (median of 5 reloads, no board). 4. Unload before idle fires leaves no scheduled work (counter 0).
- Out of scope: Code splitting.
- Revisit when: n/a

### POL-4 — Keyboard and accessibility pass on the 3.x surfaces
- Phase: P22 · Version: 3.0.0 · Effort: M · Priority: medium · Depends: REG-5, TSK-4, MEM-6
- Summary: Every new popover, chooser, panel tab, chip and strip is reachable by Tab, operable by Enter/Space/Esc, announced with a role and label, and visible with a focus ring in light and dark. The `?` sheet lists every new key.
- Roam model: None.
- Design: Checklist per surface: region overlay (arrow keys nudge the rectangle 1/10 px with Shift, Enter confirms), status chooser, halo popover, trails panel (reorder with Alt+Up/Down), resurface panel, inline crops and strips (focusable, Enter opens), Memory lane slider (arrow keys, Home/End), landmarks glyph input. `aria-live` toast region reused.
- Build tips: Follow UI-7's approach (Tab reaches rail, panel, card, toolbar, menu). Focus rings use the existing `--pxd-focus` token. Tests: DOM tests for key handling in each new component.
- Acceptance: 1. A Tab-only walkthrough (CDP key events) reaches and operates each listed surface; recorded as a step table in §8. 2. `?` sheet shows Shift+V, Shift+T and the trail keys. 3. Axe-style checks (manual): every interactive element has a role and an accessible name (query `[role=button]:not([aria-label]):not(:has(text))` returns 0 inside `.pxd-root`).
- Out of scope: Screen-reader scripting beyond labels.
- Revisit when: n/a

### POL-5 — Open time for 300 cards: close PF-2 or state the limit
- Phase: P22 · Version: 3.0.0 · Effort: L · Priority: medium · Depends: PERF-3
- Summary: The 2.0 limit "300-card open still over 400 ms" is re-attacked with the PERF-3 shells and a two-stage mount (shells first, bodies on idle). Either the open lands under 400 ms to first interactive shells with bodies streaming, or the limit is restated with numbers and the reason.
- Roam model: None.
- Design: Stage 1 paints shells for the viewport only; stage 2 fills bodies in chunks of 40 on idle; the camera restore happens before stage 1. Instrument `stats.open` with marks for pull, build, shells, first body, settled.
- Build tips: PF-2 measurements in §8 show pull and build as part of the 894 ms; profile them separately on the 320-card fixture. The pull pattern (`BOARD_PATTERN`) grew in 3.x (props, times); consider a two-pull strategy: shallow for shells, deep on idle. Tests: stage order, chunk size.
- Acceptance: 1. 320-card fixture cold open: shells visible ≤ 400 ms, first bodies ≤ 700 ms, settled ≤ 1500 ms (medians of 5), or a §8 paragraph with the measured breakdown and the stated limit. 2. Detail pan after settle ≥ 58 fps. 3. No long task over 100 ms after the first 400 ms.
- Out of scope: Worker threads.
- Revisit when: n/a

### DOC-1 — Spec 3.0: the data model as built
- Phase: P22 · Version: 3.0.0 · Effort: M · Priority: high · Depends: POL-2
- Summary: `docs/spec-plexus-3.0.md` records every block kind and prop key as of 3.0: regions and views (shared grammar with Roam Plexus), trails, landmarks, PDF card decoration, the macros Plexus decorates, the public API, and the updated Heptabase gap table.
- Roam model: Documentation only.
- Design: Same structure as `spec-plexus-2.0.md`: data model table, surfaces, native parity, Heptabase gap (PDF, regions, views now filled), limits, non-goals. Add "Interop" with the three globals and their versions.
- Build tips: Generate the prop table from `schema.js` constants where possible (a small script in `tools/` that prints the keys, to avoid drift). Keep prose short; tables carry the facts.
- Acceptance: 1. Every `plexus` key accepted by `normalizeItemLayout`/`normalizeEdge` appears in the table (script diff is empty). 2. Every decorated macro name is listed with its button class. 3. Reviewed against the live fixtures (one spot check per kind).
- Out of scope: Tutorials.
- Revisit when: n/a

### DOC-2 — API 3.0 contracts and README refresh
- Phase: P22 · Version: 3.0.0 · Effort: M · Priority: high · Depends: DOC-1
- Summary: `docs/api-plexus-3.0.md` contracts the new modules (`regions.js`, `minimap-svg.js`, `halo.js`, `trails`, `strength.js`, `resurface.js`, `highlighter.js`, `status-tags.js`, `detect.js`, the public API) and the README gets the 3.0 feature sections, the integrations table, the shortcuts, and the limits table from POL-2.
- Roam model: Documentation only.
- Design: One section per module with exports, inputs, outputs, failure behaviour, as in `api-plexus-2.0.md`. README order: Start a board, Surfaces, Using the board, Regions and views, PDFs, Tasks and statuses (opt-in), Remembering (lenses, trails, resurface), Works with, Shortcuts, Limits, Settings, Privacy, Install.
- Build tips: Shortcut list is generated from `src/view/shortcuts.js` (the only key list); the settings list from `SETTING_ROWS`. Keep the "Install" note about remove-and-re-add the Pages URL.
- Acceptance: 1. Every exported function of the listed modules is documented (script diff empty). 2. README shortcut table equals the `shortcuts.js` rows. 3. Settings section lists every `SETTING_IDS` entry.
- Out of scope: Screenshots in the README beyond three.
- Revisit when: n/a

### DOC-3 — Mirror the roadmap to the Svy project page as Someday tasks
- Phase: P22 · Version: 3.0.0 · Effort: S · Priority: medium · Depends: DOC-2
- Summary: **Done 2026-10-04 by the planning session**: the Svy page "Plexus Diagram" holds every non-gate task except DOC-3 itself. The user tracks projects in Roam Svy. Create or update the page "Plexus Diagram" in the same shape as "Roam Plexus" (uid `t-lDCVP0K`): top attributes and one Better Tasks Someday task per roadmap item still open, with Design, Why later, Revisit when, Effort and the roadmap reference; shipped items get Shipped, Expected behavior, Testing and Limits.
- Roam model: Svy page `Plexus Diagram`: `Project Status:: Active`, `Aliases::`, `Repo::`, `Roadmap::`; tasks `{{[[TODO]]}} <title> - Plexus Diagram <ID>` with children `BT_attrProject:: [[Plexus Diagram]]`, `BT_attrGTD:: Someday`, `BT_attrNotes::` and the nested bullets. Written through `roam_tasks.py` / `roam_writer.py` (never through Plexus code; this is the operator's tooling, not the extension).
- Design: One task per ID that is not `[x]` at the time of running; existing tasks are updated in place by matching the ` - Plexus Diagram <ID>` suffix (uid preserved). Shipped IDs get the ship bullets appended, not duplicated.
- Build tips: This is the only task that writes to Svy, and it writes only the project page, never a daily page or a board. Dry-run first and print the diff. Chunk writes so a failure leaves a consistent page. Do not create tasks for gate tasks (DOC-17..22).
- Acceptance: 1. Page exists with the four attributes. 2. Task count equals open non-gate IDs; a rerun changes nothing (idempotent). 3. One sample task's nested bullets match the roadmap entry. 4. No other Svy page modified (compare `:edit/time` of a control page).
- Out of scope: Scheduling or due dates.
- Revisit when: n/a

### DOC-22 — P22 gate and release 3.0.0
- Phase: P22 · Version: 3.0.0 · Effort: S · Priority: high · Depends: POL-1, POL-2, POL-3, POL-4, POL-5, DOC-1, DOC-2, DOC-3
- Summary: Final standing gate for the 3.x line, the full regression of P17–P21 live checks on the current build, release 3.0.0, Depot draft refreshed (PR stays unopened until the user says so).
- Roam model: None.
- Design: Regression list: one acceptance item from each 3.x task re-run on the final build (the first numbered check of each), recorded as a table in §8. CHANGELOG 3.0.0 summarises by phase. `docs/depot/` draft updated with three new screenshots (regions inline, PDF card, resurface).
- Build tips: Run the four-configuration interop matrix from DOC-19 again. Tag `v3.0.0` only after Pages `cmp` matches. GUARDRAILS: PR creation is a separate external action; do not open it.
- Acceptance: 1. `npm run check` green (report the test count). 2. Regression table with one pass per 3.x task. 3. Typing benches: no board ≤ +0.1; 40-task board ≤ +1.0; 50 chips ≤ +0.1; macro page ≤ +0.1. 4. Unload: 0 `.pxd-*`, listeners and watches at baseline, globals removed. 5. Published files byte-identical to the build; tag pushed. 6. Ledger clean; leftovers listed. 7. No Depot PR opened.
- Out of scope: 3.1 planning.
- Revisit when: n/a

## Facts (measured 2026-10-04)

## Plexus Diagram today (~/plexus-Diagram, v2.7.1, tag v2.7.1 at 8b3fc7e, Pages https://svyk.github.io/plexus-diagram)
Heptabase-style whiteboard over Roam {{[[diagram]]}} blocks. Cards / sections / connections / nested boards are Roam blocks; layout in each block's :block/props `plexus` (merge-write). Connections are blocks under a collapsed `Connections` child: `((A)) → label → ((B))`, endpoints in props, with optional fromBlock/toBlock (arrow to a single block inside a page card, writes `((uid))` so it shows in that block's backlinks). Relation chips + preview popover on connection blocks in Roam's outline / linked refs; breadcrumb click opens the preview. Page cards (whole outline, progressive rows), block-ref cards, image cards, board cards, stickies (header/minimize), task cards (Better Tasks via window.RoamExtensionTools["better-tasks"].tools — Plexus never writes BT_attr* itself; `task-tool` setting currently DEFAULTS ON — must become OFF by default), children badge (`kids`), Kanban/Table/Gallery/Timeline/Graph views, present, snapshots, templates, deep links `?pxd=`, board bar + tool dock, tooltips, Properties panel, minimap. Phases P0-P16 in docs/roadmap.md (read its section 3 rules: add never take away; Roam data canonical; never write :diagram/*; no writes on open/pan/zoom/select; undo budget 45 writes; never stop mouseup in renderBlock editor; no setPointerCapture; typing +0.1 ms/key budget, palette entries cost ~0.055 ms/key each so Plexus keeps exactly 2; encrypted Svy graph; zero runtime deps; theme follows Roam bp3-dark, borders carry meaning in dark). Open perf debt: typing in a block on the same page as a mounted 40-task board costs +2 to +5 ms/key (2.7.0 and 2.7.1). Live harness tools/live/ (plexus-live.mjs inject/eval/shot/input, cdp-drag.mjs, ledger.mjs, fixture.mjs, bench.mjs, taskboard.mjs). Acceptance graph: Readwisenotes window "Readwisenotes - Plexus Diagram/Test Lab"; Svy has the user's URL-installed Plexus (harness refuses to inject over it).

## Roam native PDF Annotator (help graph page "PDF Annotator" + measured in Readwisenotes)
- `{{[[pdf]]: <firebase url>}}` renders a reader; `/upload` a PDF; fullscreen, page nav, zoom, search.
- Every highlight is a regular block. Select text → Create highlight (with note/tag buttons) or highlight mode; Alt-drag = area highlight saving a snapshot image. Cmd-Shift-c copies a ref to a highlight; shift-click opens its block.
- Behind every PDF is a page named after the file (+ fingerprint), e.g. "Novel risk assessment model … -- 84a551fdb6bf68e0ebb65fa59c75f378". Highlights live there: page → "Notes by [[User]]" → "[[Date]]" → highlight blocks. Same file uploaded twice shares one PDF page (recognised by contents).
- Highlight block string: text (or `![](…png)` for area) + colour tag `#h/yellow`.
- Highlight block :block/props: `:pdf-highlight {:type "text"|"area", :content {:text "…"} | {:image-id "zqJy0wsTc"}, :position {:boundingRect {:x1 :y1 :x2 :y2 :width :height :pageNumber}, :rects [same shape…]}, :id "<block uid>"}`, `:pdf-fingerprints ["<md5>" nil]`, area highlights also `:image-size {url {:width :height}}`.
- The pdf block itself: `:pdf-settings {<user-id> {:current-scale "auto", :current-page 3, :text-selection-color "yellow", :highlights-visible? true}}`.
- Help changelog: "Fixed some flakeyness when clicking a highlight to open the pdf and scroll it into view"; `/embed pdf` exists.
- Implication: Plexus must NOT build its own PDF highlighter; it should put the native reader on the board (PDF card), show highlights as first-class cards (they are blocks), drag highlights from the reader/PDF page onto the board, open a highlight's page/position, and connect highlights with arrows. Svy is encrypted: PDF URLs may be `.enc` (file.get).

## Roam Plexus (~/roam-plexus, Excalidraw extension, Pages https://svyk.github.io/roam-plexus)
Region refs: region block = child of a drawing under collapsed `{{[[plexus-regions]]}}`, string `{{[[plexus-region]]: k=<kind> d=<drawingUid> ids=<id>,<id> pad=N}} caption`; kinds area, rect (image element fractions rx,ry,rw,rh), group, frame, cframe, poly (lasso). A `((region))` ref renders inline as a crop card (button.rm-xparser-default-plexus-region); click opens the drawing zoomed to the region. Public API window.RoamPlexus apiVersion 6: isAvailable, create, open(uid,{region,frame,sidebar}), thumbnail(uid,{maxWidth,render}), regionsOf, linksOf, framesOf, drawingsOn, scene(uid).remove, addChart, build, addEventListener('change'). CSS roots .plexus-root/.plexus-portal. Docs: ~/roam-plexus/docs/spec-plexus.md (§13 measured facts), roadmap.md, roadmap-next.md.

## Roam Compass (~/roam-compass, Pages https://svyk.github.io/roam-compass, v0.7.0)
Spatial navigator: a page/block in the centre, neighbours in compass directions (Parents/Children/Friends/Challengers/Previous/Next) from `Name::` attributes (harcs) and refs. Read-only; uses window.RoamPlexus.thumbnail / create / open. No window global of its own (check its src for one). CSS .compass-node.

## Roam-Task-Status-Tags (~/Roam-Task-Status-Tags, Pages https://svyk.github.io/Roam-Task-Status-Tags/)
One tag per TODO: `{{[[TODO]]}} #[[task-status/Active]] text`; statuses Active, Waiting, Holding, Incubating, Alert, Cancelled (configurable). Styled checkbox glyphs per status, quiet or pill mode, Alert pulse. Slash `/task status: X`, palette commands, block context menu. Routes through window.betterTasks.v2 when present. Never writes TODO/DONE.

## Better Tasks (~/better-tasks)
Tools: bt_create, bt_modify, bt_search, bt_get_task_by_uid, bt_get_projects, bt_get_attributes. Recurrence spawns only from a real checkbox pointerdown+change (Plexus 2.7.1 clicks a hidden renderBlock checkbox). Attr children BT_attr* + "**Activity log**". 100-checkbox pill throttle per page.

## fbgallet roam-extension-color-highlighter
Tag-based colours inside block text: `#c:colorname **text**` (text colour), `#bg-colorname` (block background), `#bg-ch-colorname` (block + children), `#.card-grid*` layouts; CSS custom properties `--cl-lh-<name>` / `--cl-dk-<name>`. No JS API. Plexus should render these colours on cards (map to card colour/background), offer them in the colour picker as an option, and not fight them.

## Roam's mission (help graph "White Paper", "Why Roam?", "Block References", "Bidirectional linking", "Zettelkasten")
Full text: /tmp/wo/roam-help-philosophy.json (JSON of page outlines). Key ideas: directed graph not file cabinet; a node holds many positions at once; remix without overwriting original context (block refs/transclusion); explicit, defined relationships with weights (Bayesian inference / decision making); collaborative shared mental maps; memory retrieval is lossy — the tool should make connections findable; "use it or lose it" pathways.

## Svy page format to mirror (page "Roam Plexus", uid t-lDCVP0K)
Top attrs: `Project Status:: Active`, `Aliases::`, `Repo::`, `Roadmap::`. Each task:
`{{[[TODO]]}} <Imperative title> - Plexus <ID>`
  - BT_attrProject:: [[Roam Plexus]]
  - BT_attrGTD:: Someday
  - BT_attrNotes:: <one-paragraph summary>
      - **Design**: …
      - **Why later**: … · **Revisit when**: …
      - **Effort**: S|M|L · **Sources**: … · **Roadmap**: `docs/…` §… <ID>
      - (on ship) **Shipped**, **Expected behavior**, **Testing**, **Limits**
