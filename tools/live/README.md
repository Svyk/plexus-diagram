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
