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
| P23 | Speed wherever a board lives | 2.14.0 | PERF-4, PERF-9, PERF-10, PERF-5, PERF-6, PERF-7, PERF-8, REL-1, DOC-23 |
| P24 | Reliability and sibling debt | 2.15.0 | REL-2, REL-3, REL-4, REL-5, REL-6, ECO-8, ECO-9, DOC-24 |
| P25 | Heptabase parity, next wave | 2.16.0 | HEP-1, HEP-2, HEP-3, HEP-4, DOC-25 |
| P26 | Feel instant | 2.17.0 | FAST-10, FAST-1, FAST-2, FAST-3, FAST-4, FAST-5, FAST-6, FAST-7, FAST-8, FAST-9, DOC-26 |
| P27 | PDF highlights closer to Heptabase | 2.18.0 | PDFH-1, PDFH-2, PDFH-3, PDFH-4, PDFH-5, PDFH-6, PDFH-7, DOC-27 |
| P28 | Edit in place, drag out of the PDF | 2.19.0 | PGE-2, PDFH-8, PDFH-9, PDFH-10, FIX-28 |

P23-P26 were added 2026-10-05 and ship before P22; P22's 3.0.0 gate then covers them.

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

## P23 — Speed wherever a board lives (2.14.0)

### PERF-4 — Sidebar copies open in Board mode; outline rows render lazily
- Phase: P23 · Version: 2.14.0 · Effort: M · Priority: high · Depends: none
- Summary: Status: being built now as 2.13.2. A sidebar copy opens in Board mode, and this device remembers the last choice for that board. Outline mode mounts a row only when it nears the scroller, and a row whose uid did not change stays mounted. Measured 2026-10-05 in Readwisenotes: the sidebar defaulted to Outline (`src/view/board-view.js` `if (inSidebar) setOutline(true)`); `syncOutline` rendered every top-level block's whole subtree at once, so a section holding a pdf ref mounted a full PDF.js reader (27 pages, 21 canvases). Steady state was 1.36 s of long tasks per 3 s, about 1,000 mutations per 2 s, and 81 frames per 3 s. The same board in Board mode: 0 long tasks, 181 frames per 3 s.
- Roam model: No block or props writes. The mode lives in localStorage, the same class of store as the viewport.
- Design: The first sidebar paint is Board. Outline remains the other button on the existing mode bar. The stored choice is per graph and per board uid. Changing it does not write the graph. Outline rows are diffed by uid: a new uid gets a shell, a removed uid is unmounted, an unchanged uid stays. `renderBlock` runs only after that shell intersects the outline scroller, with a one-screen margin.
- Build tips: Remove `if (inSidebar) setOutline(true)` at the end of `mountBoardView` (`src/view/board-view.js`, about line 4608). `inSidebar` is `sidebarMountKind(nativeEl) !== "main"` (`sidebarMountKind` at line 109, the flag at line 809). Keep `setOutline` (line 954) for the Outline and Board buttons (lines 979-980). Store the choice at `plexus-diagram:sidebar-mode:${graph}:${boardUid}`, next to `viewportStorageId` (line 120) and `createViewportStore` in `src/host/roam.js` (key `plexus-diagram:vp:${graph}:${uid}`, line 177). `syncOutline` (line 903) currently clears `.pxd-sidebar-outline` and calls `host.renderBlock` for every uid from `sidebarOutlineUids` (`src/model/board.js` line 590) whenever the joined list changes. Replace that with a per-uid diff and an IntersectionObserver on `.pxd-sidebar-outline`. Leave the board park observer in `src/feature.js`.
- Acceptance: 1. A fresh sidebar open of a Test Lab board, read with `node tools/live/plexus-live.mjs eval "Readwisenotes - "`: the root has `pxd-root--sidebar` and does not have `pxd-root--outline`. 2. Choose Outline, reload, and open that board in the sidebar again: Outline is restored. A different board still opens in Board. 3. On the 2026-10-05 Readwisenotes board, Outline is idle within 2 s of opening: a 3 s trace has 0 long tasks that start after 2 s (the old arm was 1.36 s of long tasks per 3 s). 4. Board mode on that same board stays at 0 long tasks over 3 s and at least 181 frames per 3 s. 5. Before the outline is scrolled, `.pxd-sidebar-outline .rm-pdf-container` count is 0; after the pdf row is scrolled into view the count is at least 1. 6. `node tools/live/ledger.mjs list` shows no new uid from this check.
- Out of scope: Parking a board that has scrolled off the page (PERF-6). Poster embeds (PERF-5).
- Revisit when: n/a

### PERF-9 — Leaked card renderers cost nothing and stop leaking
- Phase: P23 · Version: 2.14.0 · Effort: M · Priority: high · Depends: none
- Summary: Status: being built now as 2.13.2. A Readwisenotes window open for days on installed 2.13.1 took about 1 s to paint each click on a board and panned in stutters. CDP listener counts showed 5,852 capture `pointerup` listeners from `onMenuPointer` (`src/view/cards.js`) and 5,850 `roam-plexus:ready`/`unload` pairs on `window`, across three loaded copies of the same build, with one `.pxd-root` in the DOM. Every click started a 13-frame loop per leaked renderer, each frame running two whole-document `querySelector` calls: about 23,000 query pairs per second, 5.9 s of 6.0 s busy. A fresh load of the same board: clicks paint in about 72 ms and nothing leaks on pan, click, navigation or sidebar open and close.
- Roam model: None. No writes.
- Design: One menu watcher per document (one `pointerup` listener, at most one rAF loop) with a registry of renderers whose anchors are scoped to their own root. Renderers whose root left the document are pruned on the next event. One shared pair of `roam-plexus:ready`/`unload` listeners per window. A new extension load awaits `window.__plexusDiagramTeardown` from an earlier copy before installing. A `mountBoardView` that throws disposes what it built, and feature.js retries a failing board with backoff instead of every reconcile tick.
- Build tips: `watchEditorMenus` in `src/view/editor-menus.js` (line 142), `menuAnchor`/`ensureMenus`/`onMenuPointer` in `src/view/cards.js` (lines 369-380), the region listeners near line 3210, `activeLifecycle` in `src/extension.js`, the mount try blocks in `src/feature.js` (lines 763, 817, 905). Count listeners with CDP `DOMDebugger.getEventListeners` on `document` and `window`.
- Acceptance: 1. With 50 renderers registered in a test, there is exactly one `pointerup` listener and one rAF loop. 2. Live: after a fresh load, then 20 navigations away and back plus 10 sidebar open/close cycles, the document has at most one Plexus `pointerup` listener per mounted board. 3. Loading the build twice without unload leaves one copy's listeners. 4. Click to paint p50 under 100 ms on the C. botulinum learning board (Event Timing). 5. A forced mount failure adds zero listeners and logs one warning.
- Out of scope: Leaks in other extensions.
- Revisit when: n/a

### PERF-10 — Fewer Roam API calls per board open
- Phase: P23 · Version: 2.14.0 · Effort: M · Priority: medium · Depends: none
- Summary: Opening the C. botulinum learning board (39 cards, 4 page cards) costs about 155 `data.pull` calls plus 7 pull watches per open, measured 2026-10-05 by wrapping `roamAlphaAPI.data`. Roam caps the API at 1,500 calls per 60 s across all extensions ("roamAlphaApi maximum mutation rate limit exceeded"); a loop of board opens hit that cap after about nine opens. Plexus should not spend another extension's budget.
- Roam model: Read-only. No new writes.
- Design: Read a board in one or two `pull-many` / `data.q` calls (board block, its children with props, refs, and page titles in one pattern), cache by uid for the session with the existing card cache, and share one pull watch per board instead of one per card. Page cards read their rows through the same batched read.
- Build tips: Count calls first by wrapping `window.roamAlphaAPI.data` for one open (helper in the PERF-8 gate). The reads live in `src/host/roam.js` (`pull` near line 4012 of the built file) and the session load in `src/session.js`. The card cache is `src/model/card-cache.js`.
- Acceptance: 1. One open of the C. botulinum board makes at most 20 `roamAlphaAPI.data` calls, counted by wrapper. 2. 30 open/close cycles in 60 s do not trip Roam's rate limit. 3. Cards, page cards and badges look the same as before (screenshots before/after). 4. `npm run check` green.
- Out of scope: Other extensions' call budgets.
- Revisit when: n/a

### PERF-5 — Heavy embeds are posters until asked
- Phase: P23 · Version: 2.14.0 · Effort: M · Priority: high · Depends: none
- Summary: A PDF reader, video, iframe, or tweet inside a card body, a page card, or an outline row stays a static poster until that card is focused or the user clicks Open. At most one live heavy embed per board.
- Roam model: Read-only. Opening a poster does not write a block. The live PDF is still Roam's own reader.
- Design: The poster shows a title, a count only when the block already carries one, and a first frame or thumbnail only when that image is already in memory. Open and focus mount the live node and close the previous live embed on that board. An outline row uses the same poster, so scrolling a pdf ref into view does not start PDF.js.
- Build tips: `EMBED_SEL` in `src/view/cards.js` (line 402) is `iframe, video, .rm-pdf-highlight, .rm-pdf-container, .twitter-tweet, .rm-xparser-default-tweet`. `armEmbedShield` (line 407) runs after `renderBlock`. Draw the poster first and call `renderBlock` only for the one open uid. PDF cards already do this for the reader: `coverModel` (`src/model/pdf.js` line 40) returns `{ title, count, label }`, `readerRule` (line 49) keeps a single open uid, and `src/view/cards.js` applies it around line 1891. Generalise `readerRule` beyond `item.kind === "pdf"`. `readPdfCover` in `src/host/roam.js` (line 266) sets `count` by counting highlight blocks, then passes it to `coverModel`. Show that number as highlights. Do not fetch the PDF to invent a page count.
- Acceptance: 1. A Test Lab board with one pdf ref, one video or iframe, and one tweet opens with `.pxd-root` containing 0 of `.rm-pdf-container`, `iframe`, and `video`, and each poster shows its title. 2. Open on the pdf leaves exactly one `.rm-pdf-container` inside `.pxd-root`. 3. Open on the video removes that container and leaves exactly one live embed. 4. Focusing a card that holds an iframe keeps the same single-live count. 5. `:edit/time` of the board and of the three blocks is unchanged across those opens. 6. `node tools/live/plexus-live.mjs shot "Readwisenotes - " .live/shots/PERF-5-poster.png .pxd-root` shows the posters.
- Out of scope: Downloading a PDF to count its pages. Two live readers on one board.
- Revisit when: n/a

### PERF-6 — Park every board that is out of view
- Phase: P23 · Version: 2.14.0 · Effort: M · Priority: high · Depends: none
- Summary: A board that is off screen suspends paint, page watches, and observers, and wakes when it comes back. That includes a main-page board scrolled away, a collapsed sidebar window, and a board inside a closed Roam block. The sidebar path already parks. The others still run.
- Roam model: None. Park and wake do not write. Wake rebuilds the view from the graph and restores the in-memory camera.
- Design: One observer decides dormant versus awake for every mount. Dormant disposes the view, releases the session, and leaves a min-height gap, which the sidebar path already does. A board that contains the focused element stays awake. Fullscreen stays awake.
- Build tips: `mount` in `src/feature.js` (about line 803) sets `rec.dormant` and observes only when `inRightSidebar(native)` (line 856). `ensureViewportWatch` (line 869) builds one IntersectionObserver with `rootMargin: "60px"` and calls `wake` (line 894) or `hibernate` (line 880). Observe main mounts on that same observer. Also park when the sidebar window is collapsed or the diagram's Roam parent block is closed, since a closed block is not an intersection change. `hibernate` already drops `rec.off` and calls `rec.session.release`. `src/view/offscreen.js` only decides card shells: `shellOffscreen`, `rectMisses`, `unmountDue`, and `UNMOUNT_GRACE_MS` (10_000). Use those for cards inside an awake board. Do not use them to park the board.
- Acceptance: 1. Two boards on one Test Lab page. Scroll the first fully out of view: its mount has no `.pxd-root`, and the gap min-height is at least 40. 2. Scroll it back: `.pxd-root` returns within 1 s and the camera matches the pre-park viewport. 3. Collapse the right sidebar while a board is open in it: that copy has no `.pxd-root` until the sidebar is expanded. 4. Close a Roam block that contains a board: `stats.pageWatches` drops by that board's watches, and reopening the block brings the count back. 5. A board that holds the focused textarea keeps its `.pxd-root`. 6. Park and wake alone leave the board block's `:edit/time` unchanged.
- Out of scope: Card `content-visibility` (PERF-3). Unloading the extension.
- Revisit when: n/a

### PERF-7 — Typing next to a mounted board under +1 ms/key
- Phase: P23 · Version: 2.14.0 · Effort: L · Priority: high · Depends: none
- Summary: Typing in a block beside a mounted 40-card board costs at most +1.0 ms per key (median). 2.12.1 and 2.13.0 measured about +2 ms/key with that board mounted and `BENCH_SCRATCH` above it. The bench goes back into the phase gate.
- Roam model: None. The bench types into the existing scratch block above the board.
- Design: Profile 40 keys with the board mounted and 40 with it unloaded. Attribute script time by script URL. Cut the Plexus share until the median delta over 5 interleaved rounds of 200 keys is at most +1.0 ms/key. The no-board budget stays +0.1 ms/key.
- Build tips: `tools/live/bench.mjs` reads `BENCH_VIEW=page` (line 13) and `BENCH_SCRATCH` (lines 873 and 1041). The scratch block has to sit above the board or the board scrolls out and unmounts. Record CDP `Tracing` and split V8 time by script URL. Ignore `blob:` entries: other extensions load from blob URLs too, so a blob bucket is not Plexus. Count only the injected `extension.js` URL. Per-key work lives in `src/view/interactions.js` and `src/view/board-view.js`. Pull-watch callbacks in `src/host/roam.js` (about lines 310 and 325) increment `stats.watches`. Log that count per key before changing code, then re-measure after each cut. Do not add a document MutationObserver (rule 3.7).
- Acceptance: 1. Five interleaved rounds, `BENCH_VIEW=page`, `BENCH_SCRATCH` set to the block above the 40-card board, `node tools/live/bench.mjs "Readwisenotes - "`: mounted median delta at most +1.0 ms/key and p95 at most +3 ms; unloaded at most +0.1 ms/key. 2. The trace table names the `extension.js` URL that still pays Plexus time, and lists the blob bucket separately, not as Plexus. 3. Each cut has a before and after median in the bench output. 4. Unload leaves 0 `.pxd-*`.
- Out of scope: Open time for 300 cards (POL-5). Changing the +0.1 ms/key no-board budget.
- Revisit when: n/a

### PERF-8 — Live perf gate script
- Phase: P23 · Version: 2.14.0 · Effort: M · Priority: high · Depends: none
- Summary: `tools/live/perf-gate.mjs` measures one fixture board, prints a table, and exits non-zero when a row is over its threshold. Every later phase gate runs it.
- Roam model: The script may create the fixture and must delete those blocks before it exits. It does not write a user's board.
- Design: The fixture is 40 cards, 3 images, one pdf ref, and one page card, on `Plexus Diagram/Test Lab`. Rows: idle 3 s with the board in the main column; sidebar copy loaded versus parked; sidebar Board versus Outline; typing bench with the scratch block above the board. Thresholds, written at the top of the script: main idle long-task time 0 ms over 3 s; sidebar Board long-task time 0 ms over 3 s; sidebar Outline has no long task that starts after 2 s; typing median at most +1.0 ms/key mounted and at most +0.1 ms/key with the board parked. The parked arm fails when its long-task time is above 0.
- Build tips: Follow `tools/live/README.md`. The target is `"Readwisenotes - "`. Drive the page with `plexus-live.mjs eval` and type with `bench.mjs` (`BENCH_VIEW`, `BENCH_SCRATCH`). Build the board with `node tools/live/fixture.mjs` or `taskboard.mjs` and record uids through `ledger.mjs`. Clean up with `node tools/live/ledger.mjs cleanup "Readwisenotes - "`, which deletes only blocks on `Plexus Diagram/Test Lab` and `diagram testing`. `plexus-live.mjs` refuses the window titled `plx typing bench`. `inject` refuses a window whose `window.__plexusDiagram` is set and whose `window.__pxdLive` is not.
- Acceptance: 1. `node tools/live/perf-gate.mjs "Readwisenotes - "` prints the four rows and exits 0 on a build that meets the thresholds. 2. A build that still eagerly renders sidebar Outline exits non-zero. 3. After a run, `node tools/live/ledger.mjs list` has no uid on `Plexus Diagram/Test Lab` from this script. 4. DOC-23, DOC-24, and DOC-25 name this command.
- Out of scope: Fixing a regression the script reports.
- Revisit when: n/a

### REL-1 — The reconcile tick stops rewriting unchanged classes
- Phase: P23 · Version: 2.14.0 · Effort: S · Priority: high · Depends: none
- Summary: Every 400 ms, reconcile rewrites the `class` attribute on `.rm-diagram` and `.rm-diagram-title-panel` even when the new value equals the old one. A MutationObserver on 2026-10-05 recorded those attribute mutations with `oldValue` equal to the new value, on every copy. The tick still runs. It writes a class only when the element does not already have it.
- Roam model: None.
- Design: `consider` adds `pxd-outline-native` or `pxd-native-hidden` only when that token is absent. The title panel gets the same check. Nothing else writes `class` to the same string.
- Build tips: `RECONCILE_INTERVAL_MS` is 400 (`src/feature.js` line 54). `lifecycle.interval(reconcile, RECONCILE_INTERVAL_MS)` is at line 2203. `reconcile` (line 1438) calls `consider` for every `.rm-diagram`. The writes are `native.classList.add(OUTLINE_NATIVE_CLASS)` and `titlePanelOf(native)?.classList.add(OUTLINE_NATIVE_CLASS)` (lines 1032-1033) and `native.classList.add(NATIVE_HIDDEN_CLASS)` (line 1041). The strings are `pxd-outline-native` and `pxd-native-hidden` (`src/discovery.js` lines 8-9). `TITLE_PANEL_CLASS` is `rm-diagram-title-panel` (feature.js line 57). Guard each add with `classList.contains`. Do not assign `className` to the current class string. A unit test calls `consider` twice and asserts the second call produces no `class` attribute record (`MutationObserver`, `attributeOldValue: true`).
- Acceptance: 1. On Test Lab with two mounted copies, a 2 s MutationObserver for `attributes` on `.rm-diagram, .rm-diagram-title-panel` reports 0 records whose `class` `oldValue` equals the new value. 2. An outline copy still has `pxd-outline-native`, and a second diagram in one embed still has `pxd-native-hidden`. 3. `npm run check` is green, including the double-call test.
- Out of scope: Removing or slowing the 400 ms tick.
- Revisit when: n/a

### DOC-23 — P23 gate and release 2.14.0
- Phase: P23 · Version: 2.14.0 · Effort: S · Priority: high · Depends: PERF-4, PERF-5, PERF-6, PERF-7, PERF-8, REL-1
- Summary: Standing gate for the speed phase, then release 2.14.0. `tools/live/perf-gate.mjs` is part of the gate.
- Roam model: None.
- Design: Standing gate items, CHANGELOG 2.14.0, and a short note of the 2026-10-05 sidebar numbers against the new trace. README limits mention the poster and the parked board in one sentence each.
- Build tips: `npm run check`. Run `node tools/live/perf-gate.mjs "Readwisenotes - "` and `node tools/live/bench.mjs "Readwisenotes - "` with `BENCH_VIEW=page`. Bump `package.json`, tag `v2.14.0`, and `cmp` the published `extension.js` and `extension.css` against the local build. Git author Svyatoslav Kleshchev, new commits only.
- Acceptance: 1. `npm run check` green. 2. `node tools/live/perf-gate.mjs "Readwisenotes - "` exits 0. 3. Typing bench: no board at most +0.1 ms/key; 40-card board mounted at most +1.0 ms/key (medians). 4. Unload: 0 `.pxd-*`, listeners back to baseline, 0 watches, `window.__plexusDiagram` removed. 5. Published files byte-identical to the build. 6. Ledger empty.
- Out of scope: A Depot PR.
- Revisit when: n/a

---

## P24 — Reliability and sibling debt (2.15.0)

### REL-2 — Real-Roam smoke suite
- Phase: P24 · Version: 2.15.0 · Effort: M · Priority: high · Depends: none
- Summary: `tools/live/smoke.mjs` runs a fixed checklist on `Plexus Diagram/Test Lab`, prints pass or fail per step, and cleans up through the ledger. The 2.8 to 2.12 run shipped real bugs while the fake-DOM tests stayed green: a cardchips `children.indexOf` throw with an observer loop, NAV-2 dropping top-level refs, and an image cut losing regions. This script is the acceptance core for later unattended runs.
- Roam model: The script creates and deletes blocks on `Plexus Diagram/Test Lab` only. It does not touch another page.
- Design: The steps, in order: create a card, edit its text, add an arrow, add a section, move the card into the section, undo, duplicate, open the board in the sidebar in Board and in Outline, restore native, and confirm the auto-enhance first-edit stamp. Each step prints `pass` or `fail` and a one-line reason. The process exits 0 only when every step passed, and it runs ledger cleanup on the way out, including after a failure.
- Build tips: Drive the window with `node tools/live/plexus-live.mjs eval` and `input`, target `"Readwisenotes - "`, as in `tools/live/README.md`. Record uids with `ledger.mjs` and finish with `node tools/live/ledger.mjs cleanup "Readwisenotes - "`. Restore native goes through `session.restoreNative` (`src/session.js` line 1901), called from `restoreCommand` in `src/feature.js` (line 1536). The first-edit stamp is `stampBoard` in `src/session.js` (line 593): a virtual board's first write adds the board marker in that same group. Assert the marker is absent before the edit (`:edit/time` of the board unchanged on open) and present after the one edit.
- Acceptance: 1. `node tools/live/smoke.mjs "Readwisenotes - "` prints pass for all 10 steps and exits 0. 2. Forcing one step to fail prints fail for that step and exits non-zero. 3. After either run, `node tools/live/ledger.mjs list` shows no smoke uid on `Plexus Diagram/Test Lab`. 4. Open of the fixture writes nothing: board `:edit/time` is unchanged until the edit step.
- Out of scope: Replacing the unit tests. Covering copy and paste (REL-4).
- Revisit when: n/a

### REL-3 — "New drawing" joins Plexus undo
- Phase: P24 · Version: 2.15.0 · Effort: M · Priority: medium · Depends: none
- Summary: New drawing is one Plexus undo step. `window.RoamPlexus.create` writes the drawing block outside Plexus's undo log, a known limit since 2.13.0. One undo removes the drawing block and the ref card together.
- Roam model: The drawing block is still created by Roam Plexus (the excalidraw macro string Roam Plexus writes). The ref card is still a Plexus block. Both deletes happen in the one undo step.
- Design: After `RoamPlexus.create` returns a uid, that uid is recorded on the open Plexus undo group as a delete. Undo deletes the drawing block and the ref card. Redo creates both again. With Roam Plexus unloaded, the existing fallback create stays on the same group.
- Build tips: `createDrawing` in `src/session.js` (line 1086) calls `api.create({ parentUid, order })`, then `txn` for the ref card, inside `grouped` (line 1101). `grouped` is `host.group` (`src/host/roam.js` line 551). That group only records writes that go through this host, and groups do not nest (line 550). Roam Plexus `create` (`~/roam-plexus/src/api.js` line 312) calls its own `host.createDrawing`, so the drawing uid never enters this `undoLog`. Push the returned uid onto the open group so `host.undo` (line 567) deletes it with the ref card. The fallback `host.createBlock(spec)` (session.js line 1096) already uses this host; keep it inside the same group. Do not open a second group from `stampedRun` (session.js line 622).
- Acceptance: 1. On Test Lab, New drawing creates one drawing block and one ref card, and the write count for the gesture is at most 45. 2. One undo removes both, and a second undo does not remove a neighbouring card. 3. Redo restores both. 4. With Roam Plexus unloaded, the fallback create still undoes in one step. 5. `npm run check` green.
- Out of scope: Changing Roam's own undo stack. Editing the drawing scene.
- Revisit when: n/a

### REL-4 — Clipboard acceptance without CDP keys
- Phase: P24 · Version: 2.15.0 · Effort: M · Priority: medium · Depends: none
- Summary: Copy, cut, and paste can be tested without CDP key events. CDP keys do not reach Electron's clipboard, so this stayed a manual check. A test seam drives `src/view/clipboard-io.js` with synthetic ClipboardEvents, and `tools/live/README.md` gains a short manual checklist for the real OS clipboard.
- Roam model: None in the unit test. The manual checklist uses ordinary board writes and one undo.
- Design: The seam calls the same handlers `createClipboardIO` registers. A synthetic copy receives the plexus mime and `text/plain`. A synthetic paste of that mime calls the plexus paste handler once. A synthetic cut calls the cut-done handler once. The README states that `plexus-live.mjs input` key steps do not carry the OS clipboard, then lists the three manual gestures.
- Build tips: `createClipboardIO` (`src/view/clipboard-io.js` line 72) listens on `doc` for `copy`, `cut`, and `paste`, and on `win` for `keydown` and `paste`. The handlers are closed over, so either return `dispatch(event)` from `createClipboardIO` or let tests pass a fake `doc` that records `addEventListener`. Build the event so `clipboardData.getData` and `setData` work for `PLEXUS_MIME` from `src/model/clipboard.js`. Do not call `document.execCommand("copy")` in the unit test. In `tools/live/README.md`, under the harness commands, add: select two cards, Cmd+C, click empty board, Cmd+V, confirm two new cards and one undo; repeat for cut; repeat for a text paste into a card editor.
- Acceptance: 1. A unit test pastes a synthetic plexus payload and asserts the plexus paste handler runs once, and a copy event receives `text/plain` plus the plexus mime. 2. A cut event calls the cut-done handler once. 3. `npm run check` green. 4. `tools/live/README.md` lists the three OS-clipboard gestures and states that input key steps do not carry the clipboard. 5. The manual pass on Test Lab is recorded as pass, or still open, in the phase notes before DOC-24 tags the release.
- Out of scope: Making CDP synthesize an OS clipboard.
- Revisit when: n/a

### REL-5 — Error budget for callbacks
- Phase: P24 · Version: 2.15.0 · Effort: M · Priority: medium · Depends: none
- Summary: Every pull-watch, observer, and timer callback runs through one guard. The guard logs once per error signature, adds one to `stats.errors`, and stops a callback that throws 20 times in a minute. Settings shows a quiet "N errors" line when the count is not zero.
- Roam model: None. The count is in memory and dies on unload.
- Design: The signature is the error name plus the first stack frame. The first throw of a signature logs with `console.error`. Throws 2 through 19 of that signature only increment the count. The 20th throw in a 60 s window replaces that callback with a no-op until the minute has passed or the extension reloads. A different signature still logs. The settings row is plain text, hidden at 0.
- Build tips: `src/host/roam.js` line 235 creates `stats = { writes, watches, pageWatches, renders, items }` and has no `errors` field. Add `errors: 0`. The pull-watch wrappers are about lines 310 and 325. `src/lifecycle.js` registers raw callbacks in `interval` (line 45), `observer` (line 57), and `pullWatch` (line 70). `reconcile` is started with `lifecycle.interval` (`src/feature.js` line 2203). `armEmbedShield` builds its own MutationObserver (`src/view/cards.js` line 418). Put `guardCallback(name, fn)` in one module and use it at those sites. The settings line is a read-only row in `src/settings.js` beside `showVersionBadge` (`show-version-badge`, line 17), rendered only when `stats.errors > 0`, text like `3 errors`. No network and no toast.
- Acceptance: 1. A test callback that throws logs once across 19 calls and leaves `stats.errors === 19`. 2. The 20th throw in that minute silences it: the 21st call does not throw and does not increment. 3. A second signature still logs and increments. 4. With fake timers, the silenced callback is armed again after 60 s. 5. The settings panel has no errors line at 0, and shows `3 errors` when the count is 3. 6. Unload removes the panel.
- Out of scope: Sending errors off the machine. A per-error settings page.
- Revisit when: n/a

### REL-6 — Block-reference cards follow edits to their source
- Phase: P24 · Version: 2.15.0 · Effort: S · Priority: high · Depends: none
- Summary: Found 2026-10-05 while testing PERF-10, and present on 2.13.2 too: a `((uid))` card that is on screen keeps showing the old text after its source block is edited elsewhere (edited "ref target GAMMA" to "DELTA"; the card still read GAMMA 1.5 s later). Page cards do follow edits. The card only picks up the change when it is rebuilt (scrolled off and back, reopened). The board's pull watch does not fire for changes inside a joined ref target, so nothing tells the card.
- Roam model: Read-only. No new writes.
- Design: Each mounted block-ref card renders its source with Roam's live `renderBlock` (or `renderString` refreshed by a watch on the source block), so Roam keeps it current. One pull watch per distinct source uid, shared by every card that cites it, released with the last card, counted in `stats.watches`. Offscreen shells keep their cached header until they mount.
- Build tips: Card paint for `item.kind === "block"` is in `src/view/cards.js` (paintShell, mountContentBody). PERF-10 removed per-ref watches when the board watch "covers" a ref (`coversBlock` in `src/host/roam.js`); live measurement says the board watch does not cover edits inside a ref target, so `coversBlock` must not suppress the source watch for content freshness. Keep the PERF-10 call budget: one shared watch per source, not per card.
- Acceptance: 1. On a Test Lab board, a visible `((uid))` card shows a source edit within 500 ms. 2. Two cards citing one source add one watch, not two. 3. Board open stays within the PERF-10 call budget. 4. `npm run check` green.
- Out of scope: Live editing of the source inside the card.
- Revisit when: n/a

### ECO-8 — Fix Roam Compass drawCardLinks page-ref edges
- Phase: P24 · Version: 2.15.0 · Effort: M · Priority: medium · Depends: none
- Summary: Roam Compass draws a connection edge when the connection string uses page refs, not only block refs. This sibling bug was left unfixed at Plexus Diagram 2.13.0. Fix it in `~/roam-compass`, test it, bump, and deploy Pages.
- Roam model: Compass reads connection child strings. This task does not write them.
- Design: A page-ref connection draws one line between those two card nodes, with the label that sits between the arrows, the same way a block-ref connection already draws. A string with one page ref and one block ref draws when both ends resolve. A string with one end draws nothing.
- Build tips: In `~/roam-compass`, `connectionEdges` (`src/model/boards.js` line 82) collects ends with `BLOCK_REF = /\(\(([^)]+)\)\)/g` and skips the child when fewer than two uids match, so a page-ref connection returns nothing. `drawCardLinks` (`src/view/overlay.js` line 1524) only draws those edges. `endOf` looks up `boxes` by uid, and `blockRefOf` (line 53) only matches a string that is exactly a block ref. Teach `connectionEdges` to return page titles as ends, and resolve a title to the card node in `drawCardLinks`. The alias map (line 1528) already maps a block-ref target uid onto the card uid; add the title. Test page-ref, block-ref, mixed, and one-ended strings. `npm run check` in that repo. Deploy `https://svyk.github.io/roam-compass`. In the Roam client, remove that Pages URL and add the same URL back.
- Acceptance: 1. `npm run check` in `~/roam-compass` is green, including the four edge cases. 2. On a Test Lab board, a page-ref connection between two cards produces one `.compass-edge` between those nodes while Compass is open on the board. 3. A block-ref connection still draws one edge. 4. `cmp` of the published `extension.js` against the local build is empty. 5. This task changes no file in plexus-Diagram.
- Out of scope: New Compass features. Editing Plexus Diagram to work around the missing edge.
- Revisit when: n/a

### ECO-9 — Fix Roam Plexus validate("apiVersion", 6)
- Phase: P24 · Version: 2.15.0 · Effort: S · Priority: medium · Depends: none
- Summary: `window.RoamPlexus.validate("apiVersion", 6)` returns ok. Today it returns not ok, because validate demands the current version and the current version is 7. Callers that still probe 6, which Plexus Diagram does, get a false failure. Fix it in `~/roam-plexus`, test it, bump, and deploy Pages. `apiVersion` stays 7.
- Roam model: None.
- Design: `validate("apiVersion", 6)` and `validate("apiVersion", 7)` return ok with data 6 and data 7. `validate("apiVersion", 3)` stays not ok, with the error `apiVersion must be 7`. The frozen object's `apiVersion` field stays 7. No method is removed.
- Build tips: `validate` in `~/roam-plexus/src/api.js` (line 442) returns ok only when `value === API_VERSION`. `API_VERSION` is 7, so 6 fails. `test/batch16.test.js` (lines 128-129) asserts 7 ok and 3 not ok, and does not assert 6. Accept the integers 6 and 7. Plexus Diagram still gates on `apiVersion >= 6` in `src/model/region-card.js` (line 6) and `src/view/cards.js` (line 2169); leave those checks. `npm run check` in roam-plexus. Deploy `https://svyk.github.io/roam-plexus`. Remove that Pages URL in the Roam client and add the same URL back.
- Acceptance: 1. `npm run check` in `~/roam-plexus` is green. 2. The test asserts `validate("apiVersion", 6)` is ok with data 6, 7 is ok with data 7, and 3 is not ok. 3. After remove-and-readd, `window.RoamPlexus.apiVersion === 7` and `window.RoamPlexus.validate("apiVersion", 6).ok === true` in Readwisenotes. 4. `cmp` of the published `extension.js` against the local build is empty. 5. This task changes no file in plexus-Diagram.
- Out of scope: Moving `apiVersion` off 7. A compatibility shim inside Plexus Diagram.
- Revisit when: n/a

### DOC-24 — P24 gate and release 2.15.0
- Phase: P24 · Version: 2.15.0 · Effort: S · Priority: high · Depends: REL-2, REL-3, REL-4, REL-5, ECO-8, ECO-9
- Summary: Standing gate for the reliability phase, then release 2.15.0. `tools/live/smoke.mjs` and `tools/live/perf-gate.mjs` are both part of the gate.
- Roam model: None.
- Design: Standing gate, CHANGELOG 2.15.0, and one line each for the smoke result, the Compass page-ref edge, and `validate("apiVersion", 6)`.
- Build tips: `npm run check` in plexus-Diagram, roam-compass, and roam-plexus. Run `node tools/live/smoke.mjs "Readwisenotes - "` and `node tools/live/perf-gate.mjs "Readwisenotes - "`. Tag `v2.15.0` only after each Pages `cmp` matches. Remove and re-add the Compass and Roam Plexus Pages URLs before the live checks.
- Acceptance: 1. `npm run check` green in all three repos. 2. `node tools/live/smoke.mjs "Readwisenotes - "` exits 0. 3. `node tools/live/perf-gate.mjs "Readwisenotes - "` exits 0. 4. Unload: 0 `.pxd-*`, listeners and watches at baseline. 5. Published files for all three repos byte-identical to their builds. 6. Ledger empty.
- Out of scope: A Depot PR.
- Revisit when: n/a

---

## P25 — Heptabase parity, next wave (2.16.0)

### HEP-1 — Journal panel
- Phase: P25 · Version: 2.16.0 · Effort: M · Priority: medium · Depends: none
- Summary: The board panel shows today's daily page, with a date stepper. Dragging a block from that list onto the board makes a card. Opening the panel and stepping the date write nothing. The drop is the first write.
- Roam model: The drop uses the existing card-create path and writes one block ref (plus its props) in one undo step. Reading the daily page and stepping the date are pulls only.
- Design: A Journal tab lists the top-level blocks of the daily page for the stepped date. Each row shows the block's first line and is draggable. The stepper moves one day at a time. Clicking a row does not add a card. An empty day shows one line, "Nothing on this day."
- Build tips: Tabs are built in `src/view/panel.js` by `tabBtn` (line 68): search, related, boards, outline, info. Add `journal` beside them. `row` (line 196) sets `draggable` and `CARD_MIME` (`src/model/drop.js`) and, on click, calls `on.addBeside`, which writes. Journal rows use the drag half only. `parseDropPayload` already turns that mime into a card string. Daily titles parse with `pageTitleToDate` (`src/model/resurface.js` line 9), which matches a title like `October 5th, 2026`. `addDaily` in `src/view/board-view.js` (line 2090) writes a page card for a date; the journal lists that page's children instead, and the drop is a block ref, not `addDaily`. Pull the children when the tab opens or the date changes. Compare `:edit/time` so a read is not a write.
- Acceptance: 1. Open Journal on today's daily page: the row count equals that page's top-level blocks, and the board's `:edit/time` is unchanged. 2. Step back one day and forward one day: the list follows, and `:edit/time` stays unchanged. 3. Click a row: no new card, `:edit/time` unchanged. 4. Drag a row onto the board: one new card whose string is that block ref, one undo removes it, write count at most 45. 5. An empty day shows the empty line and still writes nothing. 6. Light and dark shots: `node tools/live/plexus-live.mjs shot "Readwisenotes - " .live/shots/HEP-1-journal.png .pxd-panel`.
- Out of scope: Writing into the daily page. Scheduling. A second journal product.
- Revisit when: n/a

### HEP-2 — Board tabs in fullscreen
- Phase: P25 · Version: 2.16.0 · Effort: M · Priority: medium · Depends: none
- Summary: Fullscreen can hold several boards as tabs. Cmd+1 through Cmd+9 selects a tab. A recent-boards list on this device remembers the tabs. Nothing is written to Roam.
- Roam model: None. Tabs and the recent list are localStorage, keyed by graph.
- Design: The tab strip sits in the fullscreen chrome. Opening a board while fullscreen adds a tab, up to 9. Closing a tab leaves the board in the graph. Cmd+1 selects the first tab, through Cmd+9 for the ninth. The recent list restores those tabs on the next fullscreen enter, in the same order. Shift+1 and Shift+2 keep their current zoom commands.
- Build tips: `applyFullscreenChrome` (`src/view/fullscreen.js` line 67) toggles one mount (`pxd-mount--fullscreen` and `body.pxd-has-fullscreen`). Add the strip inside that mount, not on `document.body` outside `.pxd-root`. Switching tabs calls `visit` (`src/feature.js`, used by `onOpenBoard` about line 588), which already replaces `rec.crumbs`. New keys go in `SHORTCUTS` (`src/view/shortcuts.js` line 21); the file says a key that is not in that list is not a shortcut. Shift+1 is Fit all (line 55) and Shift+2 is Fit selection (line 56), so the tab keys require meta or ctrl and must not match those shift rows. Store the uid list beside `createViewportStore` (`src/host/roam.js` line 177, key `plexus-diagram:vp:${graph}:${uid}`), for example `plexus-diagram:fullscreen-tabs:${graph}`, capped at 9. Do not write props.
- Acceptance: 1. Enter fullscreen, open three boards: three tabs, and the visible board uid matches the selected tab. 2. Cmd+1, Cmd+2, and Cmd+3 select those tabs. Cmd+4 does nothing when only three tabs exist. 3. Shift+1 still fits all. 4. Leave fullscreen and enter again: the same three tabs return, from localStorage, and the board blocks' `:edit/time` values are unchanged. 5. A fourth graph's tabs do not appear in this graph. 6. The `?` sheet lists Cmd+1 through Cmd+9.
- Out of scope: Syncing the tab list through Roam. Tabs outside fullscreen.
- Revisit when: n/a

### HEP-3 — Touch and tablet
- Phase: P25 · Version: 2.16.0 · Effort: L · Priority: medium · Depends: none
- Summary: A coarse pointer can pinch to zoom, pan with two fingers, long-press for the context menu, and grab a larger grip. `disable-on-mobile` still keeps Plexus off on phones.
- Roam model: None. Gestures change the in-memory camera and open the existing menu.
- Design: Two-finger pinch zooms around the midpoint. Two-finger move pans. A long-press of about 500 ms, with movement under 8 px, opens the context menu at that point. One-finger drag still moves a card or pans with the hand tool. Grips under `pointer: coarse` are at least 44 px on screen. The phone setting is unchanged.
- Build tips: `onWheel` in `src/view/interactions.js` (line 665) already treats ctrl or meta wheel as pinch (`pinch` at line 671) for a trackpad. Add a two-pointer path beside it for touch: distance change calls the same `zoomAt` path, and a two-finger move calls `setViewport`. Long-press calls the same handler as `listen(root, "contextmenu")` in `src/view/board-view.js` (line 4092), which reaches `onContextMenu` in `interactions.js` (line 885). `.pxd-grip` in `src/extension.css` (line 617) is 8 px wide (`.pxd-grip--right` uses `calc(8px * var(--pxd-inv-zoom))`). Under `@media (pointer: coarse)` size the grip so the screen size is at least 44 px, still multiplied by `--pxd-inv-zoom`. `disable-on-mobile` is `SETTING_IDS.disableOnMobile` (`src/settings.js` line 18, default true). `isMobile` (`src/feature.js` line 135) reads `extensionAPI.platform.isMobile`, and the gate is at line 399. Leave that gate. A touch laptop or iPad that Roam does not report as mobile still gets the gestures.
- Acceptance: 1. With a coarse-pointer emulation, two-finger pinch from zoom 1 to about 2 lands within 0.15 of the expected zoom and keeps the midpoint within 24 px. 2. Two-finger pan moves the camera by the finger delta within 8 px, and does not move a card. 3. A 500 ms press with under 8 px of movement opens `.pxd-menu`; a press that moves 20 px does not. 4. A selected card's grip is at least 44 px on screen under `pointer: coarse`, and stays 8 px under `pointer: fine`. 5. With `disable-on-mobile` on and `platform.isMobile` true, no `.pxd-root` mounts. 6. `:edit/time` is unchanged across pinch, pan, and long-press.
- Out of scope: A phone layout. Turning `disable-on-mobile` off. A stylus-only mode.
- Revisit when: n/a

### HEP-4 — Highlights from reading pages to cards
- Phase: P25 · Version: 2.16.0 · Effort: M · Priority: medium · Depends: none
- Summary: Dragging a highlight block from a Readwise-style page (`Articles/…` or `Media Captures/…` in the notes graph) makes a card with a source chip. The chip shows the page title and the author when the page has an author attribute, and it opens that page in the sidebar.
- Roam model: The drop writes one block-ref card, the same write as any other block drop, one undo step. The chip is computed on read from the page title and a child whose string starts with `Author::`. The author is not copied into props.
- Design: The card is a normal block-ref card. The chip sits on it only when `pageTitleOf` starts with `Articles/` or `Media Captures/`. With an author child, the chip text is the title and the author. Without one, the chip is the title only. Click and Enter open the source page in the sidebar. A block from any other page gets no chip.
- Build tips: `parseDropPayload` (`src/model/drop.js` line 12) already accepts `roam/block-uid-list` and a block-ref string, so the drag needs no new mime. Page title comes from `host.pageTitleOf` (`src/host/roam.js` line 454), which pulls the page title off the block. Read the author with one pull of that page's children, matching a string that starts with `Author::`. The chip is a `pxd-chip` drawn from `src/view/cards.js` with the other chips. Activate it through `host.openInSidebar` (`src/host/roam.js` line 607) with the page uid. PDF highlight cards stay on `src/model/highlight.js` and are unchanged. Do not write the title or the author onto the card block.
- Acceptance: 1. Drag a block from a page titled `Articles/Example` that has an `Author::` child: one card, chip text contains the page title and the author, one undo removes the card. 2. The same drag from a page with no author child: the chip is the title only. 3. Click the chip: the sidebar shows that page (`openInSidebar`), and the card string is unchanged. 4. A block dragged from `Plexus Diagram/Test Lab` gets no source chip. 5. Renaming the author child updates the chip on the next paint without a props write (`:edit/time` of the card unchanged). 6. `npm run check` green.
- Out of scope: PDF highlight cards (PDF-2). Editing the highlight. Creating the Articles page.
- Revisit when: n/a

### DOC-25 — P25 gate and release 2.16.0
- Phase: P25 · Version: 2.16.0 · Effort: S · Priority: high · Depends: HEP-1, HEP-2, HEP-3, HEP-4
- Summary: Standing gate for the Heptabase parity wave, then release 2.16.0. The gate includes the perf gate and the smoke suite.
- Roam model: None.
- Design: Standing gate, CHANGELOG 2.16.0, and a README paragraph of at most 120 words for the journal, fullscreen tabs, touch, and the reading-page chip. Shortcuts in the README include Cmd+1 through Cmd+9, generated from `SHORTCUTS`.
- Build tips: `npm run check`. Run `node tools/live/perf-gate.mjs "Readwisenotes - "` and `node tools/live/smoke.mjs "Readwisenotes - "`. Re-check Shift+1 (fit all) after the tab keys land. Tag `v2.16.0` only after the Pages `cmp` matches. P22 remains 3.0.0 and ships after this.
- Acceptance: 1. `npm run check` green. 2. `node tools/live/perf-gate.mjs "Readwisenotes - "` exits 0. 3. `node tools/live/smoke.mjs "Readwisenotes - "` exits 0. 4. One live check from each of HEP-1, HEP-2, HEP-3, and HEP-4 passes on this build. 5. Unload: 0 `.pxd-*`, listeners and watches at baseline, `window.__plexusDiagram` removed. 6. Published files byte-identical to the build. 7. Ledger empty.
- Out of scope: 3.0 planning. A Depot PR.
- Revisit when: n/a

---

## P26 — Feel instant (2.17.0)

### FAST-10 — Graph links after first paint
- Phase: P26 · Version: 2.17.0 · Effort: S · Priority: high · Depends: none
- Summary: Measured 2026-10-06 on the C. botulinum learning board: opening a board spends about 100 ms in `runLinks` (src/session.js computeLinks for the dashed graph-link curves) before the first paint, on every fresh mount and sidebar open. Links are decoration; they can arrive one idle callback later.
- Roam model: Read-only.
- Design: The session publishes the board without links first, then computes links in an idle callback (timeout 1 s) and publishes a links-only change. Edits that change refs recompute the same way. A test that needs links synchronously can await the session's links promise.
- Build tips: `runLinks` / `computeLinks` / `refreshLinks` in `src/session.js`; the view already handles a `links` dirty flag (`dirty.links` in `src/view/board-view.js`).
- Acceptance: 1. A CPU profile of one board open shows no `runLinks` before the first `.pxd-item` paint. 2. Links appear within 1 s of open. 3. FAST-1 budgets unchanged or lower. 4. `npm run check` green.
- Out of scope: Changing which links are drawn.
- Revisit when: n/a

### FAST-1 — Perf budgets that only go down
- Phase: P26 · Version: 2.17.0 · Effort: L · Priority: high · Depends: PERF-8
- Summary: `tools/live/perf-budgets.json` holds ceilings for a 40-card board and a 300-card board. A node test fails when a count is above its ceiling. A helper lowers a ceiling when a run beats it, and refuses a write that would raise one. `tools/live/perf-gate.mjs` reads the same file.
- Roam model: None. The node fixtures are in-memory trees. The live gate still creates and deletes only its Test Lab board, as PERF-8 does.
- Design: Both `"40"` and `"300"` store nine numbers: `dataCallsPerOpen`, `rendersSelect`, `rendersDrag`, `rendersType`, `domMutationsSelect`, `domMutationsDrag`, `domMutationsType`, `listenersPerBoard`, `layoutReadsPerPanFrame`. The 40-card `dataCallsPerOpen` ceiling starts at 20, the PERF-10 cap. Measured 2026-10-05 on the 39-card C. botulinum board the open made about 12-20 data calls. Every other ceiling is the count from the first run, checked in with the test. A pan frame with a gesture in progress is expected to read layout zero times. The select action selects one card, the drag moves it 24 px on x, and the type inserts one `a`. `lowerCeilings` writes a key only when the new count is strictly smaller.
- Build tips: Add `tools/live/perf-budgets.json` and import it from `tools/live/perf-gate.mjs` (thresholds and `exitCode` are at the top; `test/perf-8-gate.test.js` already spawns `--dry`). The 300-card tree is `stressBoardTree()` in `src/model/stress-board.js` (`STRESS_CARDS` is 300, line 6; the tree is line 22). Build the 40-card tree in the test with that same node shape and 40 notes. Count data calls on a fake `api.data` passed to `createHost` (`src/host/roam.js` line 349) for one `pullBoard` (line 687). Count renders from `host.stats.renders` (the object is line 350) for the three actions. Count DOM mutations from a fake document. Count `addEventListener` calls during `mountBoardView` (`src/view/board-view.js` line 5584). Count `getBoundingClientRect`, `offsetWidth`, `offsetHeight`, and `clientWidth` during one pan frame: the pan branch of `onPointerMove` (`src/view/interactions.js` line 335) calls `setViewport` (`src/view/board-view.js` line 1478). While `gesturing` is true the paint skips `propsPanel.place` (line 5003) and hit-testing uses `edgeEndNearWorld` (line 243, called at line 4173) instead of `edgeEndNear` (line 226). Put `lowerCeilings` next to the JSON so the gate and the node test share it.
- Acceptance: 1. `tools/live/perf-budgets.json` has a number for all nine keys on `"40"` and on `"300"`, and the 40-card `dataCallsPerOpen` is at most 20. 2. A node test whose count is one above a ceiling fails. 3. `lowerCeilings` writes a strictly lower number and the file stays lower. 4. `lowerCeilings` throws when asked to raise any key, and the file is unchanged. 5. `node tools/live/perf-gate.mjs --dry "Readwisenotes - "` exits 0, and `test/perf-8-gate.test.js` asserts the gate module reads `perf-budgets.json`. 6. `npm run check` is green.
- Out of scope: Cutting a hot path in order to beat a ceiling (FAST-7). Changing the PERF-8 long-task thresholds.
- Revisit when: n/a

### FAST-2 — Local timing log (opt-in RUM)
- Phase: P26 · Version: 2.17.0 · Effort: M · Priority: medium · Depends: none
- Summary: An opt-in ring buffer records open-to-cards-visible, click-to-paint, pan fps, and long tasks attributed to Plexus. A Performance group in settings shows p50 and p75. The same numbers sit on `window.__plexusDiagram.stats.perf`. The switch is off by default. Nothing goes over the network and nothing is written to Roam or localStorage.
- Roam model: None. The buffer is memory and dies on unload.
- Design: The switch is `speed-log`, default false. Off: no PerformanceObserver is constructed, and `stats.perf` is null. On: 256 samples per series. Open is the time from the start of `mountRecView` until the first `.pxd-item` is in the mount. Click-to-paint is Event Timing for an event whose target is inside `.pxd-root`. Pan fps is 1000 divided by the median rAF delta across one pan gesture, pushed when the gesture ends. A long task counts only when its script URL is the Plexus `extension.js`. A `blob:` URL is not Plexus, the same split PERF-7 uses. With n samples, p50 is the sample at floor of (n minus 1) times 0.5, and p75 is floor of (n minus 1) times 0.75. The settings row prints the four series at p50 and p75.
- Build tips: Add `speedLog: "speed-log"` to `SETTING_IDS` in `src/settings.js`, default false. `initializeSettings` (line 156) writes only missing ids. Add a Performance group to `SETTING_GROUPS` (line 276) with one `switchRow` (line 183). The readout is a `groupRow` (line 210) whose text is taken from `host.stats.perf` when the panel builds. `stats` is created at `src/host/roam.js` line 350 and published as `win.__plexusDiagram.stats` (`src/feature.js` lines 2217 and 2239). Register the observers through `src/lifecycle.js` and disconnect them on dispose. Do not add a document MutationObserver.
- Acceptance: 1. With default settings, `window.__plexusDiagram.stats.perf` is null and Plexus has registered no event or longtask observer. 2. After `speed-log` is turned on and a Test Lab board opens, `stats.perf.open.p50` is a number and the Performance row shows p50 and p75. 3. One click inside `.pxd-root` adds a click sample, and a click outside it does not. 4. One pan adds an fps sample. 5. A long task whose script URL is `blob:` does not increment the Plexus long-task count. 6. Unload clears `stats.perf` and returns the observer count to the baseline. 7. The board block's `:edit/time` is unchanged, and this feature sends no request.
- Out of scope: Uploading the log. A dashboard. Layout-shift numbers (FAST-6).
- Revisit when: n/a

### FAST-3 — Instant first paint from a cached sketch
- Phase: P26 · Version: 2.17.0 · Effort: L · Priority: high · Depends: none
- Summary: On mount, Plexus paints a static sketch of the last render from localStorage for that board: card rects, titles, colours, and edges. The live board then replaces the sketch. At four zooms the sketch and the live geometry stay within 1 px. A key pressed during the handoff is delivered to the live board. The sketch writes nothing to Roam.
- Roam model: None. The sketch is localStorage, keyed by graph and board uid, the same class of store as the viewport.
- Design: The sketch is written after a settled paint, debounced, and not during a pan frame. Each item stores uid, x, y, w, h, title, color, and fill. Each edge stores from, to, and path. The next mount paints that sketch inside the mount element before `mountBoardView` builds the live DOM, then removes the sketch in the same turn the live world is attached. Missing or invalid JSON skips the sketch and mounts normally. The four zooms are 0.25, 0.5, 1, and 2.
- Build tips: Copy the store shape of `createViewportStore` (`src/host/roam.js` line 292). Its key is `plexus-diagram:vp:${graph}:${uid}` (line 293) and `set` debounces at 500 ms (line 316). Use the key `plexus-diagram:sketch:${graph}:${uid}` and the same quota try/catch. Titles, color, and fill are already on the board from `buildBoard` (`src/model/board.js` line 137; `color` and `fill` at lines 244 and 249). Edge paths come from `edgePath` (`src/model/geometry.js` line 242). Paint plain DOM into the mount before `mountRecView` (`src/feature.js` lines 801 and 1047). Do not call `renderBlock` for the sketch, and do not write block props.
- Acceptance: 1. After one settled paint, localStorage holds the sketch for that graph and board, and the board's `:edit/time` is unchanged. 2. The next mount shows the sketch before any live `.pxd-item`, then the live board replaces it. 3. At zoom 0.25, 0.5, 1, and 2, every sketched card and its live rect differ by at most 1 px on x, y, width, and height. 4. A keydown fired in the handoff turn reaches the live handler once and does not reach the sketch. 5. A corrupt sketch string still mounts the live board and throws nothing. 6. `npm run check` is green.
- Out of scope: Sketching card bodies, images, or PDF readers. Any Roam write. The layout-shift gate (FAST-6).
- Revisit when: n/a

### FAST-4 — Prefetch on hover
- Phase: P26 · Version: 2.17.0 · Effort: M · Priority: high · Depends: PERF-10
- Summary: Hovering a board chip, a nested-board card, a board breadcrumb, or a block ref or page ref that the cache already knows as a board warms that board's read after 80 ms. Leaving earlier cancels the warm. At most 4 cache misses are warmed per 60 s. Those reads count toward Roam's 1,500 calls per 60 s.
- Roam model: Read-only. A warm is one `pullBoard`. No block writes.
- Design: `pointerenter` starts an 80 ms timer and `pointerleave` clears it. A warm that `pullBoard` serves from `blockOf` does not count. A miss counts as one prefetch. The fifth miss inside 60 s does not call Roam. Targets: a `.pxd-cardchip` (its `data-board`), a `.pxd-boardchip` (the boards for that block), a `.pxd-crumb` that is not the current crumb, a card whose kind is `board`, and a block ref or page ref whose uid or title is already in the card cache as a board. A ref the cache does not know is left alone.
- Build tips: `pullBoard` (`src/host/roam.js` line 687) returns `cache.blockOf(uid)` when the uid is warm (lines 688-690). Lookups are `boardsOf` (`src/model/card-cache.js` line 93), `refBoardsOf` (line 149), and `pageBoardsOf` (line 155). Card chips set `data-board` in `createCardChips` (`src/cardchips.js` line 232). The On board chip is `.pxd-boardchip` from `createBoardChips` (`src/boardchips.js` line 34) and stores no board uid, so use `boardsOf` on the block uid. Crumbs are the buttons from `renderCrumbs` (`src/view/chrome.js` line 176); skip `.pxd-crumb--current`. A nested board card is `item.kind === "board"` (`src/view/cards.js` line 2521), which `classifyString` marks at `src/model/schema.js` line 328. Use one document `pointerover` listener, not one per ref. Put `schedulePrefetch` next to the chip constructors in `src/feature.js` (around line 207).
- Acceptance: 1. A `.pxd-cardchip` hovered for 80 ms calls `pullBoard` once for its `data-board`, and a leave at 40 ms calls it zero times. 2. A cache hit does not increment the prefetch count. 3. Five cache misses inside 60 s produce four `pullBoard` misses, and the fifth does not call the fake data API. 4. A page ref whose title is absent from `pageBoardsOf` produces zero calls. 5. The board's `:edit/time` is unchanged after the warms. 6. `npm run check` is green.
- Out of scope: Warming a board the cache has never seen. Changing Roam's 1,500 call cap.
- Revisit when: n/a

### FAST-5 — Keep recent boards alive
- Phase: P26 · Version: 2.17.0 · Effort: L · Priority: high · Depends: PERF-6
- Summary: Navigating away keeps the last 2 board views detached, with their watches paused, instead of disposing them. Coming back reattaches that view and does not rebuild it. A third detached view disposes the oldest. A detached view idle for 5 minutes is disposed. Parking still disposes the view and the pool.
- Roam model: None. Detach, reattach, and dispose write nothing.
- Design: The pool is per window, cap 2, keyed by board uid. Only `navigate` detaches. `hibernate` still disposes the attached view, and it also disposes that mount's pooled views, so a parked mount holds no detached session and no pull watch. A detached view is off the document. Its session ref stays held, so the session is not destroyed. Watches stay paused until reattach or dispose. The idle timer is 300000 ms from detach and clears on reattach. A fullscreen mount, and a mount that holds focus, are not detached. The main column and the sidebar do not share one view object.
- Build tips: `navigate` (`src/feature.js` line 771) currently calls `rec.view.dispose` and `rec.session.release` (lines 796-797) and then `mountRecView` (line 801). `release` drops the `acquireSession` refcount and `destroy` runs at zero (`src/session.js` lines 2218-2224). `destroy` calls `unwatch` (line 2068). The watch itself is `host.watchBoard` (line 590). Add `pauseWatches` and `resumeWatches` that drop and re-add that watch without `destroy`. The pool holds one ref, so detach does not call `release`. Overflow and the 5 minute timer call `view.dispose` and `session.release`. Reattach puts the same view root back and calls `resumeWatches`, and does not call `createSession` or `mountRecView`. `hibernate` (line 1020) keeps disposing the attached view; after that, dispose every pooled view for that `rec`. A pooled session must not leave `watchBoard` running while the mount is dormant.
- Acceptance: 1. Open board A, navigate to B, then to C: A and B are detached, C is showing, and `mountRecView` ran for C and not again for A or B. 2. Navigate back to A: the same view root is attached, and `createSession` was not called for A. 3. Opening a fourth distinct board disposes the oldest detached view, with dispose and release each once. 4. With fake timers, a detached view at 300000 ms is disposed. 5. Scrolling that mount fully out of view removes `.pxd-root`, disposes its pooled views, and drops `stats.watches` by those boards' watches. 6. `:edit/time` is unchanged across detach and reattach. 7. `npm run check` is green.
- Out of scope: Keeping DOM for a parked board. One view object shared by the main column and the sidebar.
- Revisit when: n/a

### FAST-6 — Layout-shift telemetry and a no-shift test
- Phase: P26 · Version: 2.17.0 · Effort: M · Priority: high · Depends: FAST-1
- Summary: A LayoutShift observer attributes each shift to cards, chrome, the panel, or the page around the board, and to the phase before or after the board is usable. The live gate fails on a shift after usable. Fixes cover the shifts that show up: card height while content mounts, chip rows, and posters.
- Roam model: None.
- Design: Usable is the first card shell in the mount, the same moment as open-to-cards-visible. A shift with `hadRecentInput` is ignored. Any other shift whose value is greater than 0 and whose start is after usable fails the gate. A source maps through `closest` to `.pxd-item` (cards), `.pxd-toolbar` or `.pxd-dock` (chrome), `.pxd-panel` (panel), or a node outside `.pxd-root` (the page around the board). The shell reserves the height the later body, chip, or embed will use, so usable content does not grow the card.
- Build tips: Disconnect the observer on unload through `src/lifecycle.js`. Set the usable mark in `mountRecView`. Extend the `extra` checks in `tools/live/perf-gate.mjs` (the verdict is built around line 307) so one after-usable shift fails the process. This check is separate from the existing long-task ceilings in that file. Reserve card height from the item's `h` in `normalizeItemLayout` before `renderBlock` returns (`src/view/cards.js`). Reserve the `.pxd-cardchip` row in `createCardChips` (`src/cardchips.js` line 232) so attaching the chip does not grow the block. Give the poster and the opened embed the same outer box (`coverModel` in `src/model/pdf.js` line 40, `armEmbedShield` in `src/view/cards.js`). Do not write a height into props.
- Acceptance: 1. A unit test with one shift before usable and one after usable fails only the later shift. 2. A shift with `hadRecentInput` set does not fail. 3. A source inside `.pxd-item` is attributed to cards, one inside `.pxd-toolbar` to chrome, one inside `.pxd-panel` to panel, and one outside `.pxd-root` to the page. 4. `node tools/live/perf-gate.mjs "Readwisenotes - "` exits 0 on the PERF-8 fixture, and exits non-zero when a card's height grows after usable. 5. Opening a poster changes the card's height by at most 1 px. 6. `npm run check` is green.
- Out of scope: The sketch-versus-live geometry test (FAST-3). Shifts outside a Plexus mount that match none of the four regions.
- Revisit when: n/a

### FAST-7 — Hot paths measured and tuned
- Phase: P26 · Version: 2.17.0 · Effort: L · Priority: high · Depends: FAST-1
- Summary: Node benchmarks on the 300-card board time board build, board diff, geometry, link computation, and the parsers. Each benchmark prints a before and an after. An entity id that one open looks up twice is looked up once. A parser returns before its regex when the first character cannot match.
- Roam model: None. The board is `stressBoardTree()`, in memory.
- Design: Run under `node --predictable`. Record `process.cpuUsage()` and a call count, before the change and after, in the test output. A cold `pullBoard` computes the board entity once and passes it to both pull patterns. `computeLinks` resolves each distinct ref once, not once per card that shares it. `highlighterTags` returns immediately when the string has no hash and no bracket link, and does not build a RegExp on that path. `isDiagramString` returns false when the string has no brace, without testing the diagram regex. `parseRegion` returns null when the head token is absent. `attrNameOf` returns null when the string has no `::`. `classifyString` already returns on cheap prefixes and stays as it is.
- Build tips: `buildBoard` and `diffBoards` are `src/model/board.js` lines 137 and 822. Geometry is `screenToWorld`, `worldToScreen`, and `edgePath` in `src/model/geometry.js` (lines 8, 12, and 242) plus `hitTest` (`src/model/board.js` line 484). Links are `computeLinks` (`src/session.js` line 978, `resolveEid` at lines 980 and 986) and `linksQuery` / `reduceLinks` (`src/model/links.js` lines 5 and 22). Parsers: `isDiagramString` (`src/discovery.js` line 11, `DIAGRAM_MARKER` line 3), `parseRegion` (`src/model/regions.js` line 76), `attrNameOf` (`src/model/schema.js` line 457), `highlighterTags` (`src/model/highlighter.js` line 51, `new RegExp` at line 54), `classifyString` (`src/model/schema.js` line 320). The tree is `stressBoardTree()` (`src/model/stress-board.js` line 22). `eidKey` is called at `src/host/roam.js` lines 694 and 697; hoist one call above both pulls. When a before/after count drops a key in `tools/live/perf-budgets.json`, call `lowerCeilings` from FAST-1. Do not raise a ceiling in this task.
- Acceptance: 1. The benchmark test prints before and after `process.cpuUsage` for `buildBoard`, `diffBoards`, `edgePath`, `computeLinks`, `isDiagramString`, `parseRegion`, `attrNameOf`, and `highlighterTags` on the 300-card tree under `node --predictable`. 2. A cold `pullBoard` of that tree invokes `eidKey` once for the board uid. 3. `computeLinks` calls `resolveEid` once per distinct ref when two cards share a ref. 4. `highlighterTags` on a string with no hash and no bracket link does not construct a RegExp, and a string that contains a bg tag still returns that tag. 5. `isDiagramString` on the 300 plain note strings does not test `DIAGRAM_MARKER`, and a diagram string still returns true. 6. The after cpu time for `highlighterTags` across those 300 strings is lower than the before time in the same run. 7. `npm run check` is green.
- Out of scope: Rewriting `classifyString`. A browser profile. Raising a budget ceiling.
- Revisit when: n/a

### FAST-8 — Frame-budgeted mounting
- Phase: P26 · Version: 2.17.0 · Effort: L · Priority: high · Depends: none
- Summary: Card content mounts in batches that stop around 8 ms per frame, and a frame touches only cards that changed. Open reports fps from rAF timestamps. A 40-card open has no Plexus long task over 50 ms. Roam's own long tasks stay on the existing PERF-8 ceilings.
- Roam model: None.
- Design: Card bodies are rows in the existing row scheduler. Light bodies run before heavy ones. A uid outside the `diffBoards` dirty set is not mounted again. The first open has no previous board, so each item is dirty once. The fps number is the rAF deltas during those pumps. The 50 ms bar counts only a long task whose script is Plexus `extension.js`, not the raw long-task total the PERF-8 gate already caps near 350 ms because Roam itself runs a long task.
- Build tips: Extend `createRowScheduler` (`src/view/progressive.js` line 10). It already stops a pump at `budgetMs` (default 8, line 39) and runs light rows before heavy ones (`isHeavyRow`, line 8). Feed it card uids from the paint path instead of mounting every body in one turn. The dirty set is the return of `diffBoards` (`src/model/board.js` line 822); a null previous board marks every item dirty (lines 823-829). Skip `renderBlock` when `isDone` is true for that uid. Pan keeps writing one transform on `.pxd-world` (`src/view/board-view.js` line 4980) and does not mount bodies. Store the open fps on `host.stats` as `mountFps` so the test can read it with `speed-log` off. Do not add a worker. Leave the page-card heavy-row rule as it is.
- Acceptance: 1. A fake clock that advances 8 ms per render mounts only the rows that fit in that budget, then continues on the next pump. 2. A second diff that dirties one uid calls `renderBlock` for that uid only. 3. On a 40-card open, `node tools/live/perf-gate.mjs "Readwisenotes - "` records the max Plexus long task and exits 0 when that max is at most 50 ms. 4. The open reports `mountFps` from rAF timestamps. 5. The existing PERF-8 long-task ceilings are unchanged. 6. `npm run check` is green.
- Out of scope: POL-5's 300-card shell deadline. A worker tokenizer. Changing which page-card rows count as heavy.
- Revisit when: n/a

### FAST-9 — Kill switches for speed features
- Phase: P26 · Version: 2.17.0 · Effort: M · Priority: medium · Depends: PERF-5, PERF-6, FAST-3, FAST-4, FAST-5, FAST-8
- Summary: One hidden JSON setting turns posters, parking, keep-alive, prefetch, the sketch, and budgeted mounting off individually. Each defaults to on. Turning one off restores that feature's previous behaviour, with no release.
- Roam model: The value lives in `extensionAPI.settings` only. No block writes.
- Design: The id is `speed-flags`. It is not listed in a settings group, so the panel does not show it. The default object is posters, parking, keepAlive, prefetch, sketch, and budgetedMount, all true. JSON that does not parse leaves that default. Off means: posters mount the embed on open; parking does not hibernate; keep-alive disposes on navigate; prefetch does not schedule; the sketch is not read or written; budgeted mounting mounts card bodies in one turn. The page-card row scheduler is not gated by this setting.
- Build tips: Add `speedFlags: "speed-flags"` to `SETTING_IDS` (`src/settings.js` line 1) and leave it out of `SETTING_GROUPS` (line 276). Parse it the way `parseAttrStyles` treats bad input (`src/model/attr-styles.js` line 7): invalid JSON returns the all-on default. Read the flags next to the other settings checks in `src/feature.js`. Posters gate the poster branch around `armEmbedShield` (`src/view/cards.js`) and `coverModel` (`src/model/pdf.js` line 40). Parking gates `hibernate` (`src/feature.js` line 1020). Keep-alive gates the pool inside `navigate` (line 771). Prefetch gates `schedulePrefetch` from FAST-4. Sketch gates the localStorage read on the mount path. Budgeted mounting gates the card-body use of `createRowScheduler` (`src/view/progressive.js` line 10). Tests pass a settings object and do not open the panel.
- Acceptance: 1. The settings panel has no control for `speed-flags`. 2. The default turns posters, parking, keep-alive, prefetch, sketch, and budgeted mounting on. 3. With posters off, the embed node is in the card on open. 4. With parking off, `.pxd-root` stays mounted when the board is scrolled out of view. 5. With keep-alive off, navigate disposes the leaving view. 6. With prefetch off, a hover calls `pullBoard` zero times. 7. With sketch off, the sketch key is neither read nor written. 8. With budgeted mounting off, every card body mounts in one turn. 9. A string that is not JSON leaves all six on. 10. `npm run check` is green.
- Out of scope: Showing the flags in the settings panel. Flagging any feature outside this list.
- Revisit when: n/a

### DOC-26 — P26 gate and release 2.17.0
- Phase: P26 · Version: 2.17.0 · Effort: S · Priority: high · Depends: FAST-1, FAST-2, FAST-3, FAST-4, FAST-5, FAST-6, FAST-7, FAST-8, FAST-9
- Summary: Standing gate for the feel-instant phase, then release 2.17.0. The gate runs the perf gate and the smoke suite, checks that the budget ceilings were not raised, and records a before/after table against 2.14.0 on the C. botulinum board.
- Roam model: None.
- Design: Standing gate, CHANGELOG 2.17.0, and one README sentence each for the sketch, hover prefetch, keep-alive, and the Performance readout. The table is the 39-card C. botulinum board in Readwisenotes. The 2.14.0 column is open to cards visible about 460 ms, main-thread busy about 870 ms, click to paint about 50 ms, pan 60 fps, typing next to the board about 0.1 ms per key, and data calls per open about 12-20. The after column is this build, same rows, same board.
- Build tips: `npm run check`. Run `node tools/live/perf-gate.mjs "Readwisenotes - "` and `node tools/live/smoke.mjs "Readwisenotes - "`. The gate reads `tools/live/perf-budgets.json`, and a ceiling above the run fails the gate. Tag `v2.17.0` only after the Pages `cmp` matches. P22 stays 3.0.0 and ships after this. Git author Svyatoslav Kleshchev, new commits only.
- Acceptance: 1. `npm run check` green. 2. `node tools/live/perf-gate.mjs "Readwisenotes - "` exits 0. 3. `node tools/live/smoke.mjs "Readwisenotes - "` exits 0. 4. Every ceiling in `tools/live/perf-budgets.json` is less than or equal to the count from that gate run. 5. The CHANGELOG has the before/after table with those six rows for the C. botulinum board. 6. Unload leaves 0 `.pxd-*`, listeners and watches at baseline, and `window.__plexusDiagram` removed. 7. Published files byte-identical to the build. 8. Ledger empty.
- Out of scope: A Depot PR. 3.0 planning.
- Revisit when: n/a

---

## P27 — PDF highlights closer to Heptabase (2.18.0)

Design, research and decisions: `docs/design-pdf-heptabase.md` (2026-10-06). Defaults taken while the user was away: in-board pane, footer jump, show existing notes only until measured, page jump plus flash, one reader with a switcher, pane stacks under narrow sidebar boards, keep colour control with a tooltip, no quote editing, page sort.

### PDFH-1 — Open the PDF in a pane beside the board
- Phase: P27 · Version: 2.18.0 · Effort: L · Priority: high · Depends: none
- Summary: Open reader mounts Roam's reader in a pane beside the board. The PDF card stays a cover at its own size. The pane is live, so highlighting needs no Interact click. Closing the pane leaves every card in place and writes nothing.
- Roam model: Read-only. `renderBlock` of the existing pdf block. No `:pdf-settings` write, no `:pdf-highlight` write, no new block. The pane width is localStorage `plexus-diagram:read:${graph}`, the same class of store as the viewport.
- Design: The pane is `.pxd-read`, a sibling of `.pxd-world` inside `.pxd-root`, default right, 42% of the mount, clamped to 360–720 px. Under 720 px of mount width it stacks below the board. `readerRule` still allows one open uid, and a second open toasts "Closed the other reader" and unmounts the first. Escape closes the pane only when the target is pane chrome and `isTextEntryTarget` is false. The close control always unmounts. Wheel events over the pane do not zoom the board.
- Build tips: Stop calling the 640×820 draw in `pdfReaderBox` / `drawnRect` / `applyPdfSize` (`src/view/cards.js`, `pdfReaderBox` at line 2320, `drawnRect` at line 2325, `applyPdfSize` at line 2339, `PDF_READER_W` and `PDF_READER_H` in `src/model/pdf.js` lines 5–6). Mount `renderBlock` from `paintPdfReader` (line 2405) into the pane instead of `rec.body`. Delete the shield path for this reader: `beginPdfInteract` (line 2380) and the document listeners in `armPdfLiveWatch` (line 2349). Keep `readerRule` (line 68) and `openEmbed` (line 2462). `armEmbedShield` stays for iframes, video, and tweets (`EMBED_SEL` at line 542). The splitter key follows `createViewportStore` (`src/host/roam.js` line 292). CSS only under `.pxd-read`.
- Acceptance: 1. Open reader on a PDF card leaves the card's width and height unchanged and shows `.rm-pdf-container` inside `.pxd-read`. 2. A text selection in that reader can create a highlight with no Interact click, and the new block is Roam's, with `:pdf-highlight` present and no `plexus` prop written by Plexus. 3. Opening a second PDF unmounts the first reader and leaves one `.rm-pdf-container` owned by Plexus. 4. Close, and Escape on the list, remove the pane and leave the board block's `:edit/time` unchanged. 5. A wheel over the pane does not change the board zoom, and a wheel over the board still zooms. 6. `document` keydown listeners registered by Plexus do not grow when the pane opens. 7. `npm run check` is green.
- Out of scope: The highlight list (PDFH-2). A second simultaneous reader. Writing `:pdf-settings`.
- Revisit when: n/a

### PDFH-2 — List this PDF's highlights in the pane
- Phase: P27 · Version: 2.18.0 · Effort: M · Priority: high · Depends: PDFH-1
- Summary: The pane lists every highlight on the open PDF's page: colour bar, snippet, page, and On board when a card already exists. A highlight created in the reader shows up in the list without a reload. Clicking a row turns the reader to that page.
- Roam model: Read-only. The list is `pdfHighlightTree` plus `highlightRows`. A `watchPage` on the PDF page title is held while the pane is open and released on close. No block write.
- Design: Rows sort by page, then Roam's child order. Filters are colour, page, and a snippet substring. Area rows render the image string. On board uses the placed set `highlightRows` already computes. Clicking a row calls the page-input path (`writeReaderPage`) and does not create a card. The Add highlights… modal stays on the card for bulk placement.
- Build tips: `host.pdfHighlightTree` (`src/host/roam.js` line 1235) and `HIGHLIGHT_TREE_PATTERN` (line 158). `highlightRows` (`src/model/highlight-pick.js` line 94). `watchPage` (line 868) returns the unsubscribe. `pdfCover` (line 1266) supplies `pageUid` and the title `watchPage` needs. Reuse `openPdfAt` (`src/view/cards.js` line 2499) against the pane's reader. The 2026-10-05 measure found zero highlight lists inside `.rm-pdf-container`, so this list is the list. Do not decorate `.rm-pdf-highlight`. Release `watchPage` in the pane's close and in view dispose.
- Acceptance: 1. A PDF page with two highlights on pages 1 and 2 shows two rows, with `p. 1` and `p. 2` and the `#h/` colour on the bar. 2. Creating one highlight in the pane's reader adds one row without a manual reload, and closing the pane drops `stats.pageWatches` by one. 3. A row whose uid is already a card shows On board. 4. Clicking the page-2 row sets the reader page input to 2 and writes nothing (`:edit/time` of the board unchanged). 5. The snippet filter hides a row whose text does not contain the query. 6. An area highlight row shows the image. 7. `npm run check` is green.
- Out of scope: Dragging a row (PDFH-3). Sorting by `:create/time`. A graph-wide highlight app.
- Revisit when: n/a

### PDFH-3 — Drag a highlight from the list onto the board
- Phase: P27 · Version: 2.18.0 · Effort: M · Priority: high · Depends: PDFH-2
- Summary: Dragging a list row onto the board creates one highlight card at the drop point. Place on the focused row creates one card beside the PDF cover. A highlight that is already a card pulses that card and creates nothing.
- Roam model: One `((highlightUid))` child of the board per new card, through the existing ref-card create. No `:pdf-highlight` write. The 45 cap stays on the modal. This gesture places one.
- Design: `dragstart` sets `application/x-plexus-card` to `((uid))`. The drop lands in the current board drop handler. Place uses the origin already computed beside the PDF card (cover right edge plus 40 px). Both paths select the new card. A placed uid pulses and does not call create.
- Build tips: `CARD_MIME` and `parseDropPayload` (`src/model/drop.js` lines 7 and 12) already prefer that mime. The drop listener is `src/view/board-view.js` line 4622, and `openHighlightPicker`'s origin is lines 4563–4566. `session.addRefCards` is what the modal's `onPlace` calls (line 4573). Placed detection is `placedSet` (`src/model/highlight-pick.js` line 60). The 2026-10-05 measure says overlay marks are not draggable, so the list row is the drag source. Do not try to drag `.rm-pdf-container`. One undo group, one create.
- Acceptance: 1. Dragging a list row that is not On board creates one card whose string is `((uid))` of that highlight, and one undo removes it. 2. Dragging an On board row creates zero blocks and pulses the existing card. 3. Place on a new row creates one card to the right of the cover and selects it. 4. A drop of five rows is five creates only if the user dragged five, and a single row drag is one create. 5. The board's highlight props for that uid are unchanged across the create (`:pdf-highlight` deep-equal before and after). 6. `npm run check` is green.
- Out of scope: Dragging the painted mark inside Roam's reader. The 45-card grid. Removing Add highlights….
- Revisit when: n/a

### PDFH-4 — A highlight card opens the pane on its page and flashes
- Phase: P27 · Version: 2.18.0 · Effort: M · Priority: high · Depends: PDFH-1
- Summary: The footer on a highlight card, and Open in reader, open the pane and set the reader to that highlight's page, then flash the card. This works when the PDF card on the board is still a cover. The native colour-icon click is not dispatched.
- Roam model: Read-only. Page change goes through the reader input (`writeReaderPage`). No graph write. The pdf block is found by `:pdf/url` on the highlight's page.
- Design: The footer is a button. The card body still drags and edits. Flash is class `pxd-item--flash` for 2 seconds. If no pdf block uid can be resolved, keep `openBlock` plus the toast "Click the highlight to open the PDF". A scroll-to-rect inside the reader ships in this task only when a Test Lab measure shows a scroller whose coordinates match `position.boundingRect`. Otherwise the task records the miss in `docs/roadmap.md` §8 and ships the page jump alone.
- Build tips: `openHighlightInReader` (`src/view/board-view.js` line 3160), `pdfCardForUrl` (`src/model/pdf.js` line 234), `pdfPageUrl` (`src/host/roam.js` line 1246), `writeReaderPage` (line 245 of `src/model/pdf.js`), `openPdfAt` (`src/view/cards.js` line 2499). The forbid is measured in `docs/roadmap.md` §8 on 2026-10-05: a click on `.rm-pdf-highlight-color-icon` opened fullscreen and left Test Lab. Lookup of the pdf block is a read of blocks whose string contains the url, scoped to the `:pdf/url` page's refs, and it must not fetch the file. Do not add a document listener.
- Acceptance: 1. With the PDF card on the board in cover state, activating the footer opens `.pxd-read`, sets the page input to the highlight's `pageNumber`, and adds `pxd-item--flash` to that card. 2. The click writes nothing. 3. With no resolvable pdf block, `openBlock` runs once and the toast shows, and no pane is left mounted. 4. A test that dispatches a click on `.rm-pdf-highlight-color-icon` is absent from the implementation. 5. The §8 row says whether rect scroll matched, and a mismatch leaves the page-input behaviour in place. 6. Dragging the card body still moves the card. 7. `npm run check` is green.
- Out of scope: Flashing the ink inside the PDF. A custom scroll coordinate system invented without the measure.
- Revisit when: n/a

### PDFH-5 — Show the note on the highlight card
- Phase: P27 · Version: 2.18.0 · Effort: M · Priority: medium · Depends: PDFH-2
- Summary: The highlight card shows the note Roam already stored, and a Note action edits that note. The action's write is chosen only after a live trace of Roam's own note button. Until that trace, the card shows a child when one exists and does not create one.
- Roam model: The note is a child of the highlight block if the trace says so. The create, when allowed, is one plain child block. No `:pdf-highlight` write. No second store.
- Design: `highlightModel` gains `note`, the string of the first child that fails `highlightRecord`. `paintHighlight` renders it under the quote, clipped. The list row shows a note mark when `note` is non-empty. The Note action is hidden until the trace. After the trace: if Roam already created the child, the action focuses it with `renderBlock` and creates nothing; if Roam stores the note in the highlight string, the action is omitted and the string is what the card shows; if Roam stores no note, the action creates one child and focuses it. The trace is a §8 row before the create ships.
- Build tips: `HIGHLIGHT_TREE_PATTERN` (`src/host/roam.js` line 158) already pulls one level under the highlight. `rowFrom` (`src/model/highlight-pick.js` line 72) omits children today. `highlightModel` (`src/model/highlight.js` line 121) and `paintHighlight` (`src/view/cards.js` line 2542). Focus uses `renderBlock` on the child, the same mount discipline as other card editors, and must not stop `mouseup` inside that editor. Gate the create behind the §8 row so a wrong guess cannot write.
- Acceptance: 1. A highlight block with one non-highlight child renders that child's string on the card and a note mark on the list row. 2. A highlight with no children renders no note and writes nothing when the card is painted. 3. The §8 row names what Roam's note button created (child uid, string edit, or neither) on Test Lab. 4. The Note action creates a block only in the "neither" case, exactly one create, and one undo removes it. 5. `:pdf-highlight` on the parent is deep-equal before and after the note create. 6. `npm run check` is green.
- Out of scope: Rich notes (images, tasks) as a designed layout. Editing the quoted highlight string. Rewriting Roam's highlight props.
- Revisit when: n/a

### PDFH-6 — Area rows and colour stay on Roam's data
- Phase: P27 · Version: 2.18.0 · Effort: S · Priority: medium · Depends: PDFH-2
- Summary: Area highlights in the list and on the card stay images. Colour stays the `#h/` tag. The pane does not promise that a tag rewrite recolours the mark painted on the page, because a 2026-10-05 measure showed the page mark staying yellow.
- Roam model: No new writes. `setHighlightColor` remains the one string rewrite. Area `:image-size` and `:pdf-highlight` are read.
- Design: An area row uses the image renderer and the PDF footer, and it drags through PDFH-3 as the same `((uid))`. The colour control on a highlight card still offers the seven names. The tooltip on that control says the card and the list follow the tag, and the mark in the PDF changes when Roam's reader changes it. Lens and Kanban "Highlight colour" stay.
- Build tips: `naturalSize` and `highlightModel` (`src/model/highlight.js` lines 108 and 121). `setHighlightColor` (`src/session.js` line 1613) and `rewriteHighlightTag` (line 100). The measure is `docs/roadmap.md` §8, 2.11.2: tag rewrite turned the outline swatch green (167,232,200) and the page marks stayed yellow (255,234,133), prop keys unchanged. Do not add a props write to "fix" the page mark.
- Acceptance: 1. An area row shows the image at the `:image-size` ratio and drags as one card. 2. Setting the card colour from yellow to green changes the block string's tag and leaves `:pdf-highlight` and `:image-size` deep-equal. 3. The list bar and the card bar are green after that write. 4. The tooltip text includes the measured limit that the page mark may stay yellow. 5. The highlight-colour lens still dims the other cards. 6. `npm run check` is green.
- Out of scope: A new colour name. Repainting Roam's page mark. Region editing (PDF-5 already does that).
- Revisit when: A later measure shows the page mark follows a tag rewrite. Then delete the tooltip sentence.

### PDFH-7 — One reader, every PDF on the board, no new command
- Phase: P27 · Version: 2.18.0 · Effort: S · Priority: medium · Depends: PDFH-1, PDFH-3
- Summary: The pane header switches among PDF cards on this board and keeps a single live reader. Keyboard shortcuts for the list live on the pane. The command palette stays at two entries. Roam's find box is the PDF search.
- Roam model: None. Switching readers unmounts one `renderBlock` and mounts another. No block write.
- Design: The header lists kind `pdf` items on the current board by `coverModel` title. Choosing one runs `readerRule`. Arrow keys while the list (not the reader) is focused move the row selection. Enter jumps to that row's page. The Place button is in the row. `Cmd/Ctrl+F` is not rebound. No `document` listener and no palette command.
- Build tips: `readerRule` (`src/model/pdf.js` line 68). Palette rule is roadmap §3.7, and `docs/roadmap.md` records the two-entry cap. Bind `keydown` on `.pxd-read` and ignore events whose target passes `isTextEntryTarget` or sits inside `.rm-pdf-container`. `coverModel` is `src/model/pdf.js` line 40. Confirm the palette array length in the test rather than adding a command.
- Acceptance: 1. A board with two PDF cards shows both titles in the pane header, and choosing the second leaves one `.rm-pdf-container`. 2. Enter on a list row sets the page input and creates no block. 3. A keydown whose target is inside `.rm-pdf-container` is ignored by the pane handler. 4. The command palette registration count is unchanged by this phase. 5. `npm run check` is green.
- Out of scope: A shortcut that creates a highlight (that stays Roam's S inside the reader). Two readers. A full-text index.
- Revisit when: n/a

### DOC-27 — P27 gate and release 2.18.0
- Phase: P27 · Version: 2.18.0 · Effort: S · Priority: high · Depends: PDFH-1, PDFH-2, PDFH-3, PDFH-4, PDFH-5, PDFH-6, PDFH-7
- Summary: Standing gate for the reading pane, then release 2.18.0. The gate checks that a highlight session writes no `:pdf-*` props, that the palette stays at two entries, and that unload removes the pane.
- Roam model: None.
- Design: CHANGELOG 2.18.0 and a README paragraph of at most 120 words: the pane, the drag from the list, and the footer jump. Shortcuts in the README stay inside the existing two palette commands. The §8 rows from PDFH-4 (rect scroll) and PDFH-5 (note shape) are filled before the tag.
- Build tips: `npm run check`. Run `node tools/live/perf-gate.mjs "Readwisenotes - "` and `node tools/live/smoke.mjs "Readwisenotes - "`. Typing bench on Test Lab: pane closed, no board, median at most +0.1 ms per key; pane open, record the median and keep it at most +0.5, the DOC-20 reader allowance. Tag `v2.18.0` only after the Pages `cmp` matches. P22 stays 3.0.0 and ships after this. Git author Svyatoslav Kleshchev, new commits only.
- Acceptance: 1. `npm run check` green. 2. `node tools/live/perf-gate.mjs "Readwisenotes - "` exits 0. 3. `node tools/live/smoke.mjs "Readwisenotes - "` exits 0. 4. One live check from each of PDFH-1, PDFH-3, and PDFH-4 passes on this build, and the PDFH-4 check records zero `:pdf-highlight` writes. 5. Unload leaves 0 `.pxd-*`, including `.pxd-read`, listeners and watches at baseline, and `window.__plexusDiagram` removed. 6. The command palette still has two Plexus entries. 7. Published files byte-identical to the build. 8. Ledger empty.
- Out of scope: A Depot PR. 3.0 planning. Readwise or Zotero.
- Revisit when: n/a

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

---

## P28 — Edit in place, drag out of the PDF (2.19.0)

From user testing of 2.18.0 (2026-10-06): the page-card editor looked like a different card, the link legend sat on the board bar, and a highlight could not be dragged out of the PDF the way Heptabase allows.

### PGE-2 — A page card looks the same while you edit it
- Phase: P28 · Version: 2.19.0 · Shipped
- Summary: The page editor renders in world units (no 1/zoom counter-scale), 13px / 19.5px, 22px rows with a 2px gap, the resting card's 16px text inset and 12+6px child indent, thin scrollbar, Roam's reference count floated right so wrapping matches. Bullets sit in the 16px gutter, invisible at rest, a faint dot on hover, still the handle for block drag, menu and zoom.
- Measured: text x identical, row y within 1.2 px of the resting view at zoom 0.61 (was 25 px vs 14.5 px pitch, 8.5px vs 13px text).

### PDFH-8 — Drag a highlight out of the PDF
- Phase: P28 · Version: 2.19.0 · Shipped
- Roam fact: the highlight layer (`z-index 1`) sits under the text layer (`z-index 2`), and Roam calls preventDefault on `mousedown` over a highlight, so native HTML5 drag cannot start there. The highlight block uid is `memoizedProps.value.highlight.id` on a React fiber above `.rm-pdf-highlight-container`.
- Design: pointermove hit-tests the page's mark rects once per frame and arms the mark (grab cursor). A press that moves 6px becomes a pointer drag with a chip; release over the board dispatches synthetic `dragover` + `drop` with a `DataTransfer` holding `((uid))`, so the board's existing drop path places the card (or pulses one already there). A press that does not move stays Roam's click. The browser's one click after the drop is swallowed on the same task only.

### PDFH-9 — Locate a highlight
- Phase: P28 · Version: 2.19.0 · Shipped
- Summary: A list row, Place, and a highlight card's page footer scroll the reader to the highlight (Roam's own `scrollToHighlight` from the highlighter context, fallback scroll to 30%) and flash its marks for 1.6 s. Measured ~0.65 s from click.

### PDFH-10 — Reader fills its box
- Phase: P28 · Version: 2.19.0 · Shipped
- Summary: The live box no longer scrolls; Roam's reader fills it (58%), the list takes the rest (42%). Roam's toolbar stays visible.

### FIX-28 — Legend and sidebar copies
- Phase: P28 · Version: 2.19.0 · Shipped
- Summary: The link legend sits under the board bar beside Properties. A right-sidebar copy of the board the main window is zoomed into stays inline; before, both copies went fullscreen and the sidebar copy covered the main board and took its clicks and drops.


### TBL-1 — Roam tables and Roam Grid in cards
- Phase: P33 · Version: 3.4.0 · Shipped (Svy task `((tyf1xpuDh))`)
- Summary: A card holding `{{[[table]]}}` renders Roam's table (rendered collapsed, so the child rows do not list again), scrolls sideways inside the card, and owns keys, wheel and right-click while focused or hovered. Table tool (B) writes a 3×3 in one undo: 10 creates, each row a chain of nested cells, because Roam reads a cell's child as the next column. With Roam Grid, **Open grid** shows the grid outside the zoom transform.
- Limit: in-card Roam Grid column resize is zoom-dependent (Roam Grid adds screen deltas to layout px). Fix needs an additive Roam Grid API (`view.setScreenScale`), not built.

### PDFP-1 — Parse a PDF into clean Markdown and tables (research)
- Phase: P34 · Version: 3.5.0 · Shipped (Svy task `((EYaZ57RAs))`); bench in `docs/parse-bench.md`
- Summary: Heptabase's PDF Parser (Parse button on a PDF card) extracts text, tables, equations and images with OCR into Markdown and lets you copy page ranges into cards. Plexus would write tables as native `{{[[table]]}}` blocks so Roam Grid can enhance them. Compare pdf.js text-layer clustering, a local parser helper (Docling, Marker, MinerU) and a per-page vision pass on three PDFs before building.
