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

Guards: `inject` refuses a window that already runs an installed Plexus (`window.__plexusDiagram` without `window.__pxdLive`), and `plexus-live.mjs` refuses the window titled `plx typing bench` for every command (the two `cdp-*` helpers do not check; pass the Svy or Readwisenotes target id).

Settings for the injected build persist in that window's `localStorage["pxd-live-settings"]`.

```bash
node tools/live/ledger.mjs add <uid> "<why>" [--page TITLE] [--graph NAME]
node tools/live/ledger.mjs list
node tools/live/ledger.mjs cleanup "Svy - "          # deletes ledger uids on test pages, newest first
node tools/live/ledger.mjs roundtrip "Svy - "        # create, list, cleanup on Test Lab
node tools/live/fixture.mjs <phase> ["Readwisenotes - Daily Notes"] [--cards N]
node tools/live/bench.mjs ["Readwisenotes - "]          # 200 real keys, injected vs unloaded
node tools/live/taskboard.mjs ["Readwisenotes - Plexus"] [--count 40] [--repeat-every 10] [--title T]   # a board of Better Tasks task cards, ledgered
PXD_REPO=/path/to/build-dir node tools/live/plexus-live.mjs inject <title>   # inject another build (extension.js + extension.css in that dir)
```

`cleanup` deletes only blocks whose page is `Plexus Diagram/Test Lab` or `diagram testing`, and only in the window's graph. Page uids and every other page are left in the ledger. `fixture` builds `P<phase> fixture` through `window.__plexusDiagram.session(uid)` (the caller releases). A second run reuses the page and adds a new board.
