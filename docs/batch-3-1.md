# Batch 3-1 — 2.8.0 (P17 first slice)

Tasks: TSK-1, TSK-2, TSK-6, PERF-1. Version: 2.8.0. Depends of all four are none. DOC-17 waits for the rest of P17 and is not in this release.

Pre-code facts are the P17 probe bullet at the top of docs/roadmap.md section 8. Do not re-measure those before coding. The eight-arm table is PERF-1's deliverable and is written into section 8 by the bench run, before TSK-1 and TSK-6 change product behavior.

## File owners

Implementers run in parallel on disjoint files. The integrator runs after they finish and is the only one who may touch a second owner's file, and only at the seams named below.

| Owner | Files |
|---|---|
| TSK-1 | `src/settings.js`, `src/host/bt.js`, `src/view/shortcuts.js`, `src/view/shortcut-sheet.js`, `src/view/interactions.js`, `src/view/menu-model.js`, `src/view/board-view.js`, `src/view/task-popover.js` |
| TSK-6 | `src/model/highlighter.js` (new), `src/view/color-picker.js`, `src/css/highlighter.css` (new) |
| TSK-2 | `~/Roam-Task-Status-Tags` only: new `src/public-api.js`, the install and unload calls in `src/extension.js`, `tests/public-api.test.mjs`, `package.json`, `CHANGELOG.md` |
| PERF-1 | `tools/live/bench.mjs` only. No product code. |
| Integrator | `src/view/cards.js` (fill and the light checkbox). `src/view/chrome.js` only to pass the tag callback into the picker. `src/view/board-view.js` only to add `setHighlighterTag` and the `pxd-hl` class on the root after TSK-1 has landed. |

Do not edit `src/session.js`, `src/view/kanban-view.js`, `src/css/task.css`, or `src/extension.css` in this batch. Kanban Done already falls through to the marker write when `completeTask` is absent and `bt.available()` is false. The dock already hides the Task button when `task-tool` is false.

## Data model

No new block props. No `:diagram/*`. No `BT_attr*` writes.

Settings, read from `extensionAPI.settings` (the injected build persists them in `localStorage["pxd-live-settings"]`):

- `better-tasks` (boolean, default false). New id `SETTING_IDS.betterTasks`.
- `task-tool` (boolean, default false). The code default flips from true. `initializeSettings` writes only missing ids, so a saved `true` stays.
- `task-chips` and `task-default-project` move into the new Integrations group and do nothing while `better-tasks` is off.

`createBt({ win, enabled = true })`. Existing callers that omit `enabled` stay on, so `test/bt-27.test.js` keeps passing. The live board passes `enabled: setting("better-tasks") === true`. When `enabled` is false the returned object never reads `win` or `window.RoamExtensionTools`. `available()` and `canCreate()` are false. `prime()` resolves null and does not call. `modify`, `create`, `search`, and `projects` return the same empty or unavailable results they return when the tool is missing.

Shortcut row K gains `when(settings)`. `findShortcut(ev, mode, settings)` skips a row only when `row.when` is a function and returns false. A missing third argument does not apply `when`, so `test/interactions.test.js` still matches K. The live key handler passes the settings object. K's predicate is true only when `settings["task-tool"] === true`.

`buildMenu("canvas", ctx)` omits `new-task` only when `ctx.taskTool === false`. An omitted flag still includes the row, so `test/menu.test.js` stays green. The view always passes the live setting. The card menu item `make-task` stays.

Highlighter, pure, no DOM:

- `highlighterTags(string)` returns `{ bg: string|null, text: string|null }`. It reads `#bg-<name>`, `#bg-ch-<name>`, `#[[bg-<name>]]`, `#[[bg-ch-<name>]]`, and `#c:<name>` / `#[[c:<name>]]`. The first bg tag wins. The first text tag wins.
- `fillFromTags(tags, probe)` returns a CSS color or "". Order: if the caller already has a props fill, the caller keeps it and does not call this. Else `probe(name)` for `--cl-lh-<name>` or `--cl-dk-<name>` when that string is non-empty. Else the fixed map red, orange, yellow, green, blue, purple, pink, gray, grey (same as gray), teal. Else "".
- `rewriteBgTag(string, name)` replaces the first `#bg-` / `#bg-ch-` / `#[[bg-…]]` token with `#bg-<name>`, or appends one `#bg-<name>` when none exists. It does not add a second token. `name` null removes that one token and leaves the rest of the string.

Tag mode is per board, stored only when the user flips the picker's gear: merge `plexus.highlighterTags: true|false` on the board block. Default false means today's props fill. Named palette picks in tag mode call `rewriteBgTag` and clear `fill` in the same user action (one string write plus one props merge, one undo group). Hex, darker, and lighter picks do not invent a tag name. They keep the props fill path and the picker shows that those stay on the card only.

Dark mode does not use a tinted wash as the only signal. A tag fill is the highlighter's own variable or the existing fill token, and the card keeps its border.

## Behavior

### TSK-1

Integrations group in settings: "Better Tasks integration" (`better-tasks`, off) and "Task tool" (`task-tool`, off), then chips and default project.

`better-tasks` off:

- `createBt({ enabled: false })` never touches the registry.
- `board-view` does not call `bt.prime()` on mount or on settings change.
- It does not pass `completeTask` into the kanban mount, so Done flips the marker only.
- `rescheduleTasks` already returns when `available()` is false, so a drop on a daily page does nothing.
- `watchRecurrence` already returns when `available()` is false, so the recurrence toast never appears.
- `task-popover.open` returns immediately when `available()` is false.
- Task cards do not draw `.pxd-task-check`. The TODO marker stays in the string and Roam's own checkbox renders through `renderString`, as before 2.7. `src/view/task-complete.js` is not called.

`better-tasks` on: chips follow `task-chips`, `prime()` runs once per enable (not once per card), and the 2.7 light checkbox returns.

`task-tool` off: no dock Task button (already in chrome.js), K does nothing, the shortcut sheet has no K row, the canvas menu has no "New task". If the current tool is task when the setting turns off, the tool becomes select. "Make task" on a note card stays.

`task-tool` on: dock entry, K, sheet row, and canvas "New task" return. A saved `task-tool: true` survives reload.

Turning `better-tasks` on calls `prime()` once and re-renders task cards in that same settings tick.

### TSK-6

Card fill on the item: props `fill` wins. Else `fillFromTags`. The chip row shows a small swatch and the tag name when the fill came from a tag.

CSS, only under `.pxd-root`, in `src/css/highlighter.css`. No `color` declaration on `.pxd-item .rm-page-ref` or on `strong`. When the root has `pxd-hl` (set only after a probe finds a non-empty `--cl-lh-*` or `--cl-dk-*` on `document.body`), hide `.rm-page-ref[data-tag^="bg-"]` and `[data-tag^="c:"]` inside card bodies. Without that class the tags stay visible.

The picker gains a gear, "Write as highlighter tag", shown only when the caller passes `onTag`. The gear writes the board flag. While the flag is on, a named swatch calls `onTag(name)` instead of `onPick`. Callers that omit `onTag` are unchanged.

### TSK-2

`window.RoamTaskStatusTags` is installed from `~/Roam-Task-Status-Tags`, frozen, `apiVersion: 1`:

- `statuses()` re-reads settings on every call and returns six rows by default: `{ key, name, tag, glyph, light: { base, text }, dark: { base, text } }`. Colours come from the existing derivation helpers so they match the pills.
- `statusOf(string)` returns the name or null.
- `setStatus(uid, name|null)` and `cycle(uid)` return `Promise<{ status: "updated"|"rejected"|"unknown", reason? }>` and go through the existing certified writer and `createBetterTasksStatusRouter`. Plexus writes nothing.
- `addEventListener` / `removeEventListener` for `"change"` and `"statuses"`.
- `roam-task-status-tags:ready` on install, `:unload` on unload. Delete the global only if it is still this object.

No new command-palette entries. Palette commands that already exist stay.

`setStatus` on a Better Tasks-owned child whose router rejects does not write the block string and resolves `rejected`.

Ship this repo on its own: bump version, CHANGELOG, `npm run check`, commit as Svyatoslav Kleshchev, annotated tag, push, wait for its Pages deploy, `cmp` the published `extension.js` to the local build. Record that sha on the TSK-2 Shipped line. Plexus Diagram does not call the API in this batch (TSK-3 does).

### PERF-1

`BENCH_ARMS=1` on `node tools/live/bench.mjs "Readwisenotes - Plexus"` runs eight arms, five interleaved rounds of 200 keys, `BENCH_VIEW=page`, scratch block above the board. Print median and p95 of injected-minus-unloaded for each arm. Arms:

- (a) unloaded, no board required for the trace pair.
- (b) injected, no board on the page.
- (c) 40-task board mounted. Better Tasks is loaded. Task Status Tags is not installed in this window. Record that. Do not install it for this arm.
- (d) Disable Better Tasks in Roam Depot, hard-reload, measure the same board, then restore Better Tasks and hard-reload again. Task Status Tags is absent, so there is nothing to disable for it. A live toggle is not the measurement.
- (e) board mounted, `.pxd-root { display: none }` for the typing run, then remove that rule.
- (f) board mounted, Plexus window and document listeners removed for the run, DOM left up, then restore.
- (g) board mounted with `contain: content` on `.pxd-item` and `.pxd-root` for the run only. Do not commit that CSS.
- (h) 40 plain note cards, no tasks. Build with the existing fixture tool if `taskboard.mjs` can make notes. If it only makes tasks, add a note-card mode in `tools/live/taskboard.mjs` and ledger every uid.

Also record a CDP `Tracing` session (`Tracing.start`, categories `devtools.timeline,v8.execute,blink.user_timing`) over 40 keys for arms (a) and (c). Split by V8 script URL, UpdateLayoutTree, Layout, and Paint. Count `MutationObserver` callbacks per key by wrapping the constructor for those 40 keys, then unwrap.

Write the table and a one-paragraph attribution into section 8, plus a ranked fix list for PERF-2. Rebuild "RE bench 40" first. The page is empty. Ledger every uid. Clean the fixture at the end of PERF-1's acceptance, after the numbers are saved. Product code for TSK-1 and TSK-6 lands after this table is in section 8.

The window baseline swings. Report medians of the five rounds. Do not compare a single run to P16.

## Tests

Each test imports the shipped function and calls it. No re-implementation.

- `test/bt-28.test.js`. `createBt({ enabled: false, win })` where reading `win` throws. `available()` is false, `prime()` resolves null, `modify` returns unavailable, and the thrower was not read. `createBt({ win })` with a fake registry still resolves `bt_modify`. `test/bt-27.test.js` stays as it is.
- `test/shortcuts-28.test.js`. `findShortcut` on K with `{ "task-tool": false }` returns null. With no settings argument it still returns the K row. The shortcut sheet, built with the fake DOM helper used by `test/view-12.test.js`, omits the K row when the setting is false and shows it when true.
- `test/menu-28.test.js`. `buildMenu("canvas", { taskTool: false })` has no `new-task`. `buildMenu("canvas", {})` still has it. `make-task` is still on the card menu when `canMakeTask` is true.
- `test/highlighter-28.test.js`. `highlighterTags` and `fillFromTags` for `#bg-ch-blue`, `#[[bg-blue]]`, two bg tags (first wins), props-fill precedence left to the caller, probe hit versus empty probe versus the fixed map, and `rewriteBgTag` replacing one token instead of appending a second. CSS file has no `color` rule on `.rm-page-ref` or `strong`, and the hide rule is under `.pxd-root.pxd-hl`.
- `test/cards-28.test.js`. Fake DOM, same style as `test/cards-12.test.js`. A task card rendered with Better Tasks integration off does not call `bt.prime` and does not create `.pxd-task-check`. A card string `#bg-blue` sets the fill from the probe map. A props fill on that card wins.
- `~/Roam-Task-Status-Tags/tests/public-api.test.mjs`. Frozen shape and `apiVersion` 1. `ready` fires on install and `unload` removes the global and fires `:unload`. `setStatus` on a Better Tasks-owned child whose router returns rejected does not write.

`npm run check` in both repos. Save the plexus log to the scratch dir as `check-2.8.0.log` and the sibling log as `check-Roam-Task-Status-Tags-2.8.0.log`.

## Acceptance (literal)

### TSK-1

1. Fresh settings: clear `better-tasks`, `task-tool`, `task-chips`, and `task-default-project` from the injected settings store over CDP, reload the injected build. The notes say "five ids". Only these four exist. Do not add a fifth setting to match the count. Dock shows no Task entry. Pressing K on the board does nothing. The `?` sheet has no K row.
2. On the rebuilt "RE bench 40" fixture, wrap `window.RoamExtensionTools["better-tasks"].tools[*].execute` and count calls from Plexus across open, pan, hover, and one card click. The wrap must ignore calls whose stack does not include the Plexus build, because Better Tasks calls its own tools. The Plexus count is 0.
3. Turn `better-tasks` on. Chips appear within one settings-change tick. `bt_get_attributes` is called once.
4. Save `task-tool: true`, reload. The dock entry is back.
5. Dark and light screenshots of a task card with the integration off: `.live/shots/TSK-1-task-off-dark.png` and `TSK-1-task-off-light.png`. Blueprint topbar Auto, then Dark, then Light, then restore Auto. If the toggle will not cycle, add `bp3-dark` on body for the dark shot and remove it.
6. Typing bench, no board: median of five interleaved rounds ≤ +0.1 ms/key against unloaded.
7. Unload: 0 `.pxd-*`.

### TSK-2

1. Both extensions loaded in Readwisenotes. `window.RoamTaskStatusTags.statuses().length === 6` and each row has `glyph`, `light`, and `dark`. Install by removing the Developer Extension URL and re-adding `https://svyk.github.io/Roam-Task-Status-Tags/`. A reload is not enough. Do not dev-load it into the Test Lab window if that would replace the user's URL install. Use the other Readwisenotes window (target id prefix `192979C1`) for a dev load, or the re-added Pages URL in Test Lab after the deploy.
2. `setStatus(uid, "Waiting")` on a plain TODO rewrites the string to start `{{[[TODO]]}} #[[task-status/Waiting]]` and keeps the rest byte-identical. `setStatus(uid, null)` removes only that tag.
3. On a Better Tasks task, `setStatus` resolves `status: "updated"` and the Better Tasks activity log shows one entry.
4. Unload of Task Status Tags removes the global and fires `:unload`.
5. `npm run check` green in that repo.

### TSK-6

1. Install the colour highlighter in Readwisenotes. A card with `#bg-blue text` paints that blue in light and dark. Compare the computed background to `--cl-lh-blue` and `--cl-dk-blue`.
2. A card with `#c:red **hot**` shows red text inside the card.
3. Set a props fill on the same card: props wins. Clear it: the tag colour returns.
4. Highlighter unloaded: fallback palette blue, and the tag is visible.
5. Picker in tag mode: picking green rewrites the string once to include `#bg-green` and not a second bg token. Props `fill` is removed. One undo step restores both.
6. Typing bench, no board: ≤ +0.1 ms/key.

Screenshots: `.live/shots/TSK-6-bg-blue-dark.png`, `TSK-6-bg-blue-light.png`, `TSK-6-c-red-dark.png`, `TSK-6-c-red-light.png`, `TSK-6-fallback-light.png`.

### PERF-1

1. Section 8 table with eight arms, medians and p95, and the per-category trace split for (a) and (c).
2. One paragraph naming the dominant cost and the number that proves it.
3. Fix list for PERF-2 ranked by measured share.
4. Fixture cleaned, 0 `.pxd-*` after unload.

Copy and paste stay a manual Limits item. CDP does not fire Electron clipboard commands.

## Out of scope

Removing 2.7 task features. Changing Better Tasks. New statuses. A write path for statuses inside Plexus. Rendering `#.card-grid*` or writing `#c:` tags. Any product code inside PERF-1. TSK-3, TSK-4, TSK-5, PERF-2, PERF-3, DOC-17. A fifth settings id. Dev-loading Roam Plexus into the Test Lab window. Command-palette entries beyond the existing two.


## Critic amendments

Written after `critic-2.8.0.log`. Where this section conflicts with a sentence above, follow this section.

1. `createBt` has one production caller, `src/view/board-view.js` around line 353 (`host?.bt ?? createBt({ win })`), once at mount. `setSettings` swaps `settingsRef` and does not build another bridge. Read `enabled` before any access to `win`, including the default parameter, so a throwing `win` is not touched when `enabled` is false. `enabled` may default true only so `test/bt-27.test.js` callers that omit it stay on. The live call passes `enabled` from `readSetting("better-tasks") === true`. The bridge re-reads that flag on every tool lookup, including after `setSettings`, so turning the integration off stops `prime`, `available`, and `modify` on the same object. Do not keep using `host.bt` while the setting is off.

2. The light checkbox is drawn only when `bt.available()` is true (`taskBlockOn` in `cards.js`). Chips are skipped only when `taskChips === "none"` (`cards.js` around line 2027). `applyTaskSettings` today sets chips from `task-chips` alone. While `better-tasks` is off, `applyTaskSettings` passes `setTaskChips("none")` and the bridge reports unavailable, so no chips and no `.pxd-task-check`. When it turns on, restore the saved `task-chips` value and call `prime()` once in that `setSettings` tick. `completeLightCheck` returns before `taskDone.complete` and before `bt.modify` when the integration is off, even if a stale span is in the DOM. Kanban: pass no `completeTask` while off, and `available()` must be false. Omitting `completeTask` alone still calls `bt.modify`.

3. `initializeSettings` writes an id only when `get(id)` is null, so a saved `task-tool: true` stays. Reset writes every current default, including `task-tool` false, and that is intended. The injected build's `extensionAPI.settings` is the `pxd-live-settings` Map in `tools/live/plexus-live.mjs`. `settings.set` updates that Map and does not emit `onSettingsChange`. The panel row `onChange` emits and does not by itself persist. A live check that toggles a setting does both. Clearing the four ids (`better-tasks`, `task-tool`, `task-chips`, `task-default-project`) is the fresh-settings step. Do not add a fifth id. TSK-1 also edits `test/extension.test.js`: the id list, the Cards membership, and the group-name list gain Integrations and `better-tasks`, and Cards loses the three task rows.

4. The shortcut sheet does not call `findShortcut`. Filter rows when the sheet opens, using `readSetting` on `settingsRef` (the object `setSettings` swaps). `interactions.js` line 860 passes that same live read into `findShortcut`. The predicate uses `.get` when present, not bracket access: the live settings object is `{ get: readSetting }`, so `settings["task-tool"]` is undefined and would leave K dead. Do not apply `when` on the present, always, or view calls. `chrome.js` already hides the dock from `task-tool` and is not a TSK-1 file. `when` does not drive the dock.

5. `menuContext` for `"canvas"` must pass `taskTool: readSetting("task-tool") === true`. `buildMenu("canvas", {})` still includes `new-task`, so a green `test/menu.test.js` does not prove the live menu hid it. `make-task` stays behind `canMakeTask`.

6. `data-tag` on `.rm-page-ref` is the page title with no hash. `#bg-blue` and `#[[bg-blue]]` both render `data-tag="bg-blue"`. Hide `span.rm-page-ref` and `a.rm-page-ref` with `[data-tag^="bg-"]` and `[data-tag^="c:"]` only under `.pxd-root.pxd-hl`. A colon tag may render as `data-tag="c"` plus the text `:red`, so `#c:red` text colour is the highlighter's own CSS, not `--pxd-fill`. `highlighterTags` and `rewriteBgTag` also accept bare `[[bg-<name>]]` and `[[bg-ch-<name>]]`. Write `#[[bg-<name>]]`, not `#bg-<name>`, so an editor round-trip does not drop the token. The string replace and the fill clear run inside one existing `host.group` from `board-view`. Do not edit `session.js`. Do not write while that block's textarea is focused. Acceptance 5 treats one undo step as that single group. The live string may be `#[[bg-green]]`.

7. `mergePropsForWrite` replaces the whole `plexus` value. `updateProps(boardUid, { highlighterTags: true })` deletes `v` and the board unmounts. The gear handler reads the current board plexus, copies every key, sets `highlighterTags`, and writes that whole object. Never pass a partial object. Write only on the gear click. `buildColorPicker` does not write, does not call `onTag`, and does not persist `false`. Named swatches call `onTag` only from the click listener. Open, pan, zoom, and select do not call `updateProps` for this flag.

8. `setStatus(uid, "Waiting")` resolves the display name to the status key (`WAITING`) and then calls the existing `setBlockStatus` path, which already uses the router. Do not also call `requestStatusTag` or `updateBlock`. A Better Tasks-owned child comes back `{ status: "rejected", didWrite: false, reason: "better-tasks-owned-child" }` and the writer is not called. On `rejected`, `unknown`, `conflict`, `not-updated`, or `unchanged`, do not write again. Map those public results on purpose. `cycle` on a DONE block returns an object, not undefined. Delete `window.RoamTaskStatusTags` only when it is still this object, same as `uninstallPublicApi` in `~/roam-plexus/src/api.js`. Leave the existing `__svyk_roamTaskStatusTags` identity check in place. `public-api.js` registers no palette command. Acceptance 1 expects six rows on the default list. If the live graph has a different saved list, record the length and do not fail a non-default list that still has `glyph`, `light`, and `dark` on every row.

9. PERF-1 also owns `tools/live/taskboard.mjs` (and `taskboard-page.js` if that is where the card string is built) for a note-card mode used by arm (h). Arm (d) uses the Depot Installed toggle, which persists for the whole graph. `bench.mjs` reconnects after each hard reload, restores Better Tasks in a `finally`, and refuses to exit while `window.betterTasks` is missing. Task Status Tags is not installed, so arm (d) does not disable it. `Tracing.start` and the `MutationObserver` wrap run only on the separate 40-key samples, each in a `finally` that calls `Tracing.end` and restores the constructor. They are not part of the 200-key median rounds.

10. The execute wrap cannot filter on `extension.js`. The injected build is a blob URL. Stamp a string on the bridge (for example a `source` argument the wrapper adds, or a marker the test sets on the function) and count calls that carry that stamp. Iterate the tools array. A count of 0 that comes from filtering out every frame is not a pass.

11. No `updateBlock` or `updateProps` from mount, pan, zoom, select, or `buildColorPicker`. Gear and swatch writes only on their click handlers. Do not add a `mouseup` or `pointerup` listener that runs inside `.pxd-item--editing` or a `renderBlock` root. Do not add a command-palette entry in either repo. Plexus stays at two. Task Status Tags stays at its current palette set.
