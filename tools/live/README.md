# Live harness

Drives Roam Desktop over CDP (`http://127.0.0.1:9223`). Dev-only; never bundled.

```bash
node tools/live/plexus-live.mjs inject  "Svy - "                      # load ./extension.js + .css into that window
node tools/live/plexus-live.mjs unload  "Svy - "                      # onunload + remove css; prints leftover .pxd-* count
node tools/live/plexus-live.mjs eval    "Svy - " "<js expression>"    # awaited, result printed as JSON
node tools/live/plexus-live.mjs evalfile "Svy - " path/to/script.js
node tools/live/plexus-live.mjs shot    "Svy - " .live/shots/ID.png [cssSelector]
node tools/live/plexus-live.mjs input   "Svy - " '[{"t":"click","x":400,"y":300,"count":2},{"t":"text","text":"alpha"}]'
node tools/live/cdp-drag.mjs <targetIdPrefix> x1 y1 x2 y2             # real HTML5 drag (Roam bullet drags)
node tools/live/cdp-logs.mjs "Svy - "                                 # stream plexus/pxd console lines
```

The second argument matches a target id prefix first, then a window title substring. List targets with `curl -s localhost:9223/json`.

Input steps: `move {x,y}`, `down {x,y,mods?}`, `up {x,y,mods?}`, `click {x,y,count?,mods?}`, `drag {x1,y1,x2,y2,steps?,mods?}`, `key {key,code?,mods?}`, `text {text}`, `wait {ms}`, `wheel {x,y,dx,dy,mods?}`. `mods` is an array of `alt`, `ctrl`, `meta`, `shift`.

`plexus-live.mjs input` key steps do not carry the OS clipboard. Check copy, cut, and paste by hand on a Test Lab board: select two cards, Cmd+C, click empty board, Cmd+V, and confirm two new cards and one undo; repeat for cut; repeat for a text paste into a card editor.

Guards: `inject` refuses a window that already runs an installed Plexus (`window.__plexusDiagram` without `window.__pxdLive`), and `plexus-live.mjs` refuses the window titled `plx typing bench` for every command (the two `cdp-*` helpers do not check; pass the Svy or Readwisenotes target id).

Settings for the injected build persist in that window's `localStorage["pxd-live-settings"]`.

```bash
node tools/live/ledger.mjs add <uid> "<why>" [--page TITLE] [--graph NAME]
node tools/live/ledger.mjs list
node tools/live/ledger.mjs cleanup "Svy - "          # deletes ledger uids on test pages, newest first
node tools/live/ledger.mjs roundtrip "Svy - "        # create, list, cleanup on Test Lab
node tools/live/fixture.mjs <phase> ["Readwisenotes - Daily Notes"] [--cards N]
node tools/live/bench.mjs ["Readwisenotes - "]          # 200 real keys, injected vs unloaded
node tools/live/smoke.mjs ["Readwisenotes - "]          # ten REL-2 steps; exit 1 on any fail
node tools/live/smoke.mjs --fail <step> ["Readwisenotes - "]
node tools/live/taskboard.mjs ["Readwisenotes - Plexus"] [--count 40] [--repeat-every 10] [--title T]   # a board of Better Tasks task cards, ledgered
PXD_REPO=/path/to/build-dir node tools/live/plexus-live.mjs inject <title>   # inject another build (extension.js + extension.css in that dir)
```

`cleanup` deletes only blocks whose page is `Plexus Diagram/Test Lab` or `diagram testing`, and only in the window's graph. Page uids and every other page are left in the ledger. `fixture` builds `P<phase> fixture` through `window.__plexusDiagram.session(uid)` (the caller releases). A second run reuses the page and adds a new board.

## Smoke

```bash
node tools/live/smoke.mjs "Readwisenotes - "                 # ten steps; exit 1 when any step fails
node tools/live/smoke.mjs --fail <step> "Readwisenotes - "   # force that step to fail, then clean up
```

Steps, in order: `create-board`, `create-card`, `edit-text`, `add-arrow`, `add-section`, `move-card`, `undo`, `duplicate`, `sidebar`, `restore-native`. Each line is `pass <step>` or `fail <step>: <reason>`. The window must already be running Plexus. The board is created on `Plexus Diagram/Test Lab`. Opening it must leave `:edit/time` unchanged and must not write `plexus.v`; the first card stamps that marker. Sidebar opens one right-sidebar window, clicks Board and then Outline, and removes only that window. Cleanup deletes the block uids this run created. It does not run `ledger cleanup`, so other fixtures on Test Lab stay.

## Perf gate

```bash
node tools/live/perf-gate.mjs "Readwisenotes - "    # four rows; exit 1 when a row is over its threshold
node tools/live/perf-gate.mjs --dry                  # print the plan; do not connect
```

The gate builds one fixture on `Plexus Diagram/Test Lab`: 40 note cards, 3 images, one pdf ref, and one page card. The scratch block sits above that board (`BENCH_VIEW=page`, `BENCH_SCRATCH`). Typing uses the same key-to-paint sample as `bench.mjs` (keydown, animation frame, message channel) for 5 rounds of 200 keys. Thresholds are the named constants at the top of `perf-gate.mjs`: main idle and sidebar Board long tasks at most 350 ms over 3 s (Roam runs its own ~290 ms task every few seconds), no sidebar Outline long task that starts after 2 s, typing median at most +1.0 ms/key mounted and +0.1 ms/key parked, and the parked sidebar arm fails above 350 long-task ms. It also counts Plexus `pointerup` listeners (at most one per mounted board).

The version line is `window.__plexusDiagram.version` from the build running in that window. For one board open it wraps every function on `roamAlphaAPI.data`, `data.block`, and `data.fast`, opens Daily Notes, waits, opens the fixture board, and restores the functions. The data-calls row is the count whose stack contains this build's blob URL. The log also prints the total.

It refuses a window titled `plx typing bench`. It adds one right-sidebar window for the fixture board. Collapse uses `rightSidebar.collapseWindow({ window: { type: "block", "block-uid" } })`. Remove uses `unpinWindow` and `removeWindow` with that same block uid, and only for the window this run added. It does not call `rightSidebar.close`. A sidebar failure is printed and the typing rows still run. Parking the main board for those rows schedules `data.block.move` into the closed folder and polls `.roam-main .pxd-root`. That move promise stays pending while the evaluate awaits it, even after the root is gone. On every exit, including a failed row, it removes that window and checks the earlier window list is intact. `ledger cleanup` then deletes ledgered blocks on the test pages. Page lookup uses `roamAlphaAPI.pull("[:block/string {:block/page [:node/title]}]")`, because `data.pull` omits `:block/page`.
