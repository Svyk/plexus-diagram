# Plexus Diagram 1.0 — rewrite spec

Status: approved by host 2026-09-28. Supersedes `spec-plexus-0.4.md`, `spec-plexus-0.6.md`, `plan-heptabase-arrows.md` (kept for history).

## 0. Why a rewrite

0.6.4 is one 2,200-line closure (`createCanvasRoot`) patched by five executors. The user's 2026-09-28 video on a 2-card board shows: the Section tool creates two offset frames per drag plus a stray frame per click; sections do not adopt cards, have no color, and paint under cards; the edge inspector covers the edge; a new card's caret appears and the typed text is lost (scratch-host editor); the sync dot goes pending on nearly every gesture (layout lives on one shared `[[plexus-diagram/metadata]]` page, 3 blocks per card, all boards on one page). Sections and connectors mean nothing in Roam.

Goal: a Heptabase-grade whiteboard whose every object is a real Roam object, fast by construction.

## 1. Measured facts this design rests on (Roam Desktop CDP :9223, 2026-09-28)

1. `data.block.update({block:{uid, props:{plexus:{...}}}})` works. It **replaces the whole `:block/props` map** (second write dropped the first key). Pulls return keyword keys with a leading colon (`":plexus"`, `":x"`). Nested maps, arrays, booleans, floats, negatives round-trip.
2. A pull watch on `[:block/string :block/props]` fires ~100 ms after a props write with the new value (our own echo).
3. `data.undo()` reverts a props write. Roam's undo stack covers layout.
4. `ui.components` has `renderBlock`, `renderPage`, `renderString`, `unmountNode`.
5. Native diagrams (20+ in Svy, several are real QA investigations): children are the node blocks; node geometry is in `:diagram/nodes` entities (`:diagram.node/block`, `:diagram.node/data` with position/width/height, `:diagram.node/parent-node` for groups); edges in `:diagram/edges` (`:diagram.edge/source`, `:diagram.edge/target`). Board block props hold `:rf-diagram` (viewport). The public API cannot write `:diagram/*`.
6. Existing 0.6 boards: `[[plexus-diagram/metadata]]` page, `enhanced::` → `<boardUid>` → `node <uid>` (pos::, size::, color::), `edge A->B` (kind::, label::, from::, to::, direction::, color::), `section <id>` (pos::, size::, title::, color::), `viewport::`.
7. Kept live facts from 0.x (do not re-learn): native guard must be `display:none` (React Flow re-sets `visibility:visible`); zoomed page uid parse (dated regex first, `src/discovery.js`); title panel is a sibling of `.rm-diagram`; MutationObserver alone misses remount after zoom → hashchange + popstate + reconcile tick; native RF import sizes are 165×83 (floor + scale).

## 2. Data model (schema v2) — everything is a Roam object

### 2.1 Board
Board = a `{{[[diagram]]}}` / `{{[[diagram]]:Title}}` block `B`. Enhanced ⇔ `B` props contain `:plexus` with `:v 2`. Writes to `B` props **read-merge-write** and preserve every other key (`:rf-diagram`). Board props: `{v: 2, bg?: "dots"|"lines"|"plain"}`.

Viewport is **per device**, in `localStorage` key `plexus-diagram:vp:<graph>:<boardUid>` → `{x, y, zoom}`. Never written to Roam. Opening, panning, zooming write nothing to the graph.

### 2.2 Items (children of B and of section blocks)
Every direct child of `B` is an item, except the connections container (2.4). Children of a **section** block are items (members). Children of a **card** block are the card's own content (not items).

Each item block may carry `props.plexus`:

| key | type | applies | default |
|---|---|---|---|
| `type` | `"card"`\|`"section"`\|`"text"` | all | `"card"` |
| `x`,`y` | number | all | auto-placed (not persisted until a gesture) |
| `w`,`h` | number | all | card 280×160, section 480×320, text 240×48 |
| `color` | palette id (2.6) | all | none |
| `collapsed` | bool | card | false |
| `fontSize` | 16\|24\|32\|48 | text | 24 |

`x`,`y` are **relative to the parent container's top-left** (board origin or section's `x,y`). Moving a section is one write; its members follow.

Card subtype is derived from the block string, never stored (`classifyString`):
- `page`: whole string is one page ref `[[T]]`, `#T`, or `#[[T]]` (whitespace allowed) → target page `T`.
- `block`: whole string is `((uid))` → target block.
- `board`: string starts with `{{[[diagram]]` or `{{diagram` → nested board (target = this item block).
- `image`: whole string is one `![...](url)`.
- `note`: anything else (target = this item block; content = string + children).

Items with no `props.plexus` (native children, blocks added in the outline) are auto-placed in memory and persisted only when the user moves/resizes them. A child block that is a heading (`:block/heading` 1-3) with children and no props is imported as a section.

### 2.3 Sections are parent blocks
A section block's string is its title (may hold `[[links]]`/`#tags`; rendered via `renderString`). Its children are its members. Membership changes are `block.move`. Consequences: the outline reads like the board (`## Evidence` → cards), and a card in a section titled `[[Root cause]]` shows under that section in Root cause's Linked References. Sections nest.

Membership rule (evaluated only at gesture end, for the items that moved or the section that was drawn/resized): an item belongs to the **deepest section whose world rect contains the item's center**, excluding itself and its descendants. Reparent = `block.move` to that container (order `"last"`) + rewrite `x,y` relative to it.

### 2.4 Connections are blocks with refs
Connections live under one **container** child of `B`: string `Connections`, props `{plexus:{type:"edges"}}`, `open: false`, kept as the last child (new cards are created at `order = containerIndex`). Created lazily on first connection.

Each connection is a child block of the container:
- string: `"<src> <arrow> <dst>"` or `"<src> <arrow> <label> <arrow> <dst>"`, arrow `→` (one-way), `↔` (two-way), `—` (none). Example: `[[Seal failure]] → causes → [[Leak]]`.
- `<src>`/`<dst>` = the endpoint's **semantic ref**: page card → `[[Title]]`; block card → `((uid))`; every other item (note, image, board, text, section) → `((itemUid))`.
- props.plexus: `{type:"edge", from:<srcItemUid>, to:<dstItemUid>, fromSide, toSide ("auto"|"top"|"right"|"bottom"|"left", default auto), dir ("one"|"two"|"none", default "one"), route ("curve"|"straight"|"elbow", default "curve"), dash ("solid"|"dashed", default solid), weight (1|2|3, default 1), color?}`.
- The label is parsed from the string (`parseEdgeLabel`), so editing the edge block in the outline edits the label. Endpoints come from props.
- Children of the edge block are notes on the connection (inspector "Notes" opens it in the right sidebar).

So every connection is a backlink on both endpoints (visible in their Linked References with the board as breadcrumb), carries a readable triple, and can hold discussion.

### 2.5 Graph links (derived, read-only)
The board shows relationships that already exist in the graph between cards on it: for card targets A, B, draw A⇢B when any block in A's scope references B.
- A's scope: page card → every block with `:block/page` = A; block/note card → the block and its descendants (`:block/parents`).
- Exclude referencing blocks inside `B`'s own subtree (cards, edges).
- Label: if the referencing block matches `^([^:\n]{1,60})::` → attribute name (kind `attr`); if its parent is a bare `Name::` block → that name (harc multi-value form); else kind `ref`, label `mentions`.
- Multiple sources A→B collapse into one link with a label set and a source list.
- Hidden when a board connection already joins A and B (the connection shows a small "in graph" dot instead).
- Toolbar toggle `Links: Off | Attributes | All` (setting `graph-links`, default `all`). Computed off the gesture path (idle, debounced 1.5 s after the card set or a visible card's content changes).
- Click → inspector lists sources (open in sidebar) and offers **Pin as connection** (creates 2.4 edge with the label).

### 2.6 Write to graph (promote a connection)
Inspector on a connection with a non-empty label and both endpoints resolvable: **Write to graph** creates an attribute, never edits an existing string:
- source page card: if page A has a top-level bare `Label::` block → add child `<dstRef>`; else create top-level block `Label:: <dstRef>` at the end of page A.
- source block/note card: create child `Label:: <dstRef>` under the source block.
- Refuse when the label contains `::`, starts with `BT_attr` (Better Tasks owns those), or is > 60 chars. The connection stays; its "in graph" dot turns on once 2.5 sees the attribute.

### 2.7 Palette
Ids: `gray red orange yellow green teal blue indigo purple pink` (10). Cards, sections, text, connections, derived-link relation colors (attribute name hash → palette index, `mentions` = gray). Light: soft tint fill + colored border. Dark (all five signals: `html.bp3-dark`, `body.bt-theme-dark`, `@media (prefers-color-scheme: dark)` guarded `:root:not(.bp3-light)`, `.rm-dark-theme`, `body.roam-body.dark`): **colored border + colored title, no tinted fill** (user standing preference). Selection accent teal (~175°).

### 2.8 Migration and import (explicit Enhance only; never on open)
- 0.6 board (has an `enhanced::` entry, no `:plexus` on `B`): write item props from `node` rows (absolute → board-root coords), create section blocks from `section` rows (title from `title::`, else `Section`), then reparent cards whose centers fall inside a section, create connection blocks from `edge` rows (label, direction `oneWay/twoWay/none` → `one/two/none`, `kind` → route `bezier→curve`, from/to sides, color), then add `migrated:: 2` under that board's metadata entry. Viewport → localStorage.
- Native diagram (no `:plexus`, no 0.6 entry): read `:diagram/nodes`/`:diagram/edges`; positions scaled by `max(1, 240/nodeWidth)` so the layout keeps its shape at card size; native group nodes → section blocks; edges → connection blocks.
- Never touch a diagram the user did not enhance. Import writes are one batch on the write queue; failure rolls back nothing (all writes are additive) and surfaces a toast.
- **Restore native** removes only `:plexus` from `B` props (merge-write). Item props and the container stay (harmless to native).

## 3. Runtime architecture

```
src/
  extension.js          entry (onload/onunload, shared lifecycle) — keep
  lifecycle.js          keep as is
  settings.js           rewrite (section 6)
  discovery.js          keep + extend (enhanced check via props)
  feature.js            rewrite: mount registry, commands, observers, fullscreen routing
  model/schema.js       pure: props conversion, classifyString, edge strings, palette
  model/board.js        pure: build board from pull, world rects, membership, hit test, diff
  model/geometry.js     pure: viewport math, ports, edge paths, arrowheads, fit, guides, align
  model/links.js        pure: derived-link query + reducer
  host/roam.js          all roamAlphaAPI access: pulls, watches, writes, props merge, queue, ledger
  host/migrate.js       0.6 + native import planners (pure planners + host executors)
  session.js            BoardSession: ref-counted model + watch + queue + mutations
  view/board-view.js    DOM root, layers, render scheduler, culling, LOD
  view/interactions.js  pointer/keyboard state machine
  view/cards.js         card/text/section DOM + content rendering + edit mode
  view/edges.js         SVG connections + derived links + temp wire
  view/chrome.js        toolbar, context bar (inspector), toast, search, minimap
  view/panel.js         Add/Library panel: search + Related
  view/fullscreen.js    fullscreen placement (port 0.6 insets/article follow)
  extension.css         all styles, scoped under .pxd-root / .pxd-portal
```

Delete: `adapter.js canvas.js edges.js library.js metadata.js model.js session.js view.js` (old) and their tests. Keep tests: build, secret-scan, lifecycle, guard, discovery.

### 3.1 Session (one per board uid, ref-counted — rule 11)
`acquireSession(boardUid, host) → session`; `session.release()` disposes at zero refs. Session owns: current `Board` model, one pull watch on `B` (pattern 4.1), a serial write queue, an echo ledger, derived links, and an event emitter `session.on("change", ({dirty:Set<uid>, structural:bool}) => …)`. Views never call the host directly.

Mutations are **optimistic**: update the model, emit change, enqueue writes. On write failure: toast, full repull, reconcile.

Echo ledger (rule 2): for each uid written, record the exact serialized value(s) written (props JSON, string, parent). On watch apply, an incoming value equal to a pending expected value clears that expectation and is a no-op; an incoming value equal to an older expectation for that uid is ignored (stale echo); a different value while writes for that uid are in flight is ignored until the queue for that uid drains + 800 ms, then accepted as external. Structural (create/move/delete) the same, keyed by uid and parent.

Watch apply is debounced to one rAF, builds a new `Board`, diffs against the model (`diffBoards`), and emits only dirty uids.

### 3.2 View
Layers inside `.pxd-root > .pxd-viewport`: `.pxd-grid` (CSS background tracking pan/zoom), `.pxd-world` (`transform: translate() scale()`, origin 0 0) containing `.pxd-sections`, `svg.pxd-edges`, `.pxd-items`, `svg.pxd-overlay` (temp wire, guides); screen-space chrome outside the world (toolbar, context bar, panel, minimap, toast, search).

Render scheduler: one rAF loop that runs only when dirty. Pan/zoom writes one transform + grid background position per frame. Drag writes item transforms and recomputes only edges touching moving items.

**Culling and LOD** (the speed lever):
- Every item has a cheap shell (div with size, color, title text). Content (renderString roots) mounts only when the item intersects the viewport + 50% margin **and** zoom ≥ 0.45. Content mounting runs in idle chunks ≤ 8 ms. Off-screen content unmounts (`unmountNode`) after 4 s; LRU cap 80 mounted cards.
- zoom < 0.45: "map" LOD — cards show title only in a scale-compensated font (`clamp(14px, 13px/zoom, 42px)` of world units), section titles scale up the same way, edge labels hide below 0.3.
- No `renderString` call happens during a pan/zoom/drag gesture; mounting resumes 120 ms after the gesture ends.

**Card content (static)**: header = plain-text first line (markdown stripped, no React). Body = `renderString` of the rest of the string plus up to 12 descendant blocks (depth ≤ 2), each its own `renderString` node. Page card body = first 12 blocks of the page (depth ≤ 2). Block card = referenced block + children. Image card = `renderString` of the image markdown (Roam decrypts `.enc`, rule 14; never build our own `<img>`). Board card = board title + item count + "Open" button. Collapsed card = header only. Content is cached per `(uid, string-hash)`.

**Edit mode** (double-click, or Enter on a single selected card/text): mount `renderBlock({uid: targetUid, el, "open?": true})` (note/block/image/text cards) or `renderPage({uid: pageUid, el})` (page cards) into the card body; wait for MutationObserver-quiet (2 frames, 900 ms cap), then synthesize mousedown/mouseup/click on the first `.rm-block__input` (rule 13; never `setBlockFocusAndSelection`). While editing: the body owns pointer and wheel (stopPropagation), drag only by the header, Esc exits unless `.rm-autocomplete__results` is open. Exit on Esc, click on empty board, or selecting another item → `unmountNode`, re-render static from the model. After exit, grow `h` to fit content if it overflows (cap 900), one props write. Zero graph writes to the edited block from us while it is focused (rule 19.2).

**New card**: create block (string `""`), props with position, then enter edit immediately. The block exists before the editor mounts, so typed text lands in the real block (fixes the 0.6.4 lost-text bug).

**Links inside static content**: pointerdown records; moving > 4 px starts a drag and suppresses the next click (capture phase); a click without movement passes through so `[[links]]` navigate (Shift-click opens the sidebar natively).

### 3.3 Interactions (state machine, one controller, pointer capture)
Tools: Select (V), Hand (H), Card (N), Text (T), Section (G), Connect (C). Tools other than Select/Hand revert to Select after one use unless Shift-locked (double-click the tool).

- Empty board: Select tool drag → marquee (Shift adds); click → clear selection; double-click → new card + edit. Hand tool / Space-held / middle button drag → pan. Wheel without ctrl → pan (trackpad two-finger); ctrl/meta wheel or pinch → zoom at cursor (setting `wheel` can swap).
- Item body (not editing): click selects (Shift toggles); drag > 4 px moves the selection (clicking an unselected item selects only it). Alignment guides snap to other items' edges/centers within 6 screen px and draw guide lines. On drop: membership rule (2.3), then one props write per moved item (+ moves). Arrow keys nudge 1 px (Shift 10 px).
- Resize: right-bottom grip (w,h), right edge (w), bottom edge (h). Min card 200×80, section 160×100, text 60×24. Section resize end re-evaluates membership for siblings whose centers are now inside, and releases members whose centers fall outside.
- Section tool: drag on empty → one section with that rect; click without drag → one default-size section centered on the click. **Exactly one create per gesture** (the 0.6.4 double-create bug is an acceptance test). Items fully inside the drawn rect become members. Cmd/Ctrl+G wraps the selection in a new section (bounds + 32 px padding, title "Section", then rename).
- Section title: click selects the section; double-click renames inline (writes block string); drag on title or frame border moves the section; its interior passes clicks to the board (so marquee works inside a section) except when Select tool drag starts on the title/border.
- Connect: four port handles appear on the hovered or selected item (cards, text, sections). Drag from a port → temp wire (arrowhead visible while dragging) → drop on an item (hit = topmost card/text; section when not over a card) → connection with `fromSide` = dragged port, `toSide` = nearest side of the target to the drop point. Drop on empty → new note card at the drop point + connection + edit. Drop on self or same existing directed pair → select the existing connection. Connect tool: drag from anywhere on an item.
- Connection click: selects; its label pill edits inline on double-click (writes the edge block string). Derived link click: selects (inspector with sources).
- Keyboard (only when the pointer is over the board or the board has focus, and no Roam editor/input is focused): V H N T G C, Delete/Backspace (delete selection; toast "Deleted · Undo" → `data.undo()`), Esc (exit edit → clear selection → exit fullscreen), Cmd+A, Shift+1 fit all, Shift+2 fit selection, Shift+0 zoom 100%, Cmd+= / Cmd+- zoom, Cmd+Z / Cmd+Shift+Z → `data.undo()` / `data.redo()`, Enter edit, Cmd+G section, L cycle graph links, `/` board search.
- Delete: card/text → delete the block (page/block cards remove only the ref; the page/block survives); connections touching deleted items are deleted. Section → "frame only" (members move to the section's parent with coords converted, then delete the section block); Shift+Delete deletes with contents.

### 3.4 Context bar (inspector) — floats **above** the selection bounds (12 px gap, flips below near the top edge, clamped to the viewport). For a connection it sits above the label/midpoint with ≥ 28 px clearance from the path. It never covers the selected object.
- Card(s): 10 color swatches, Edit, Open in sidebar, Collapse, Related…, Delete.
- Section: swatches, Rename, Select contents, Delete frame.
- Text: swatches, size (S/M/L/XL), Delete.
- Connection: direction (→ ↔ —), Flip, route (curve/straight/elbow), dash, weight (1/2/3), swatches, Label, Notes (open edge block in sidebar), Write to graph (2.6), Delete.
- Derived link: sources list (open each), Pin as connection.
- Multi-select: swatches, align (L/C/R/T/M/B), distribute (H/V), Wrap in section, Delete.

### 3.5 Chrome
- Toolbar (top-left, one row): tools · Add (panel) · Links toggle · zoom −/%/+ · Fit · Minimap · Fullscreen · version badge `v1.0.0`. Sync dot only shows pending while the write queue is non-empty.
- Panel (right drawer, screen space, 340 px): **Search** (pages by title substring, blocks by string substring, 40 results, debounced 150 ms, marks items already on the board) and **Related** (for the selected card: outgoing refs, incoming refs, attribute relations; each row labeled; click adds the card beside the selected one; "Add all"). Rows drag onto the board. Dropping a Roam `[[page]]`/block from the outline or sidebar also adds a card (port `parseDropPayload`).
- Minimap (bottom-right, 180×120 canvas 2D): item rects + viewport frame; click/drag navigates; redraw throttled to rAF when dirty.
- Board search (`/`): input filters by title/content text, Enter cycles matches and zooms to each, non-matches dim.
- Nested board card "Open" → `ui.mainWindow.openBlock` (Roam back button returns; zoomed diagram pages open fullscreen). No in-place session swap.
- Fullscreen: port 0.6 `fullscreenInsets`/`applyFullscreenChrome`/article-wrapper follow/route exit (`src/canvas.js:66-190`, `src/discovery.js:routeLeftZoomedDiagram`).

## 4. Host contracts

### 4.1 Pull pattern
```
[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/children [:block/uid :block/string :block/order :block/heading :block/props
   {:block/children [:block/uid :block/string :block/order :block/heading :block/props
     {:block/children ...}]}]}]
```
(recursive; section members and card content both come back; `buildBoard` decides what is an item).

### 4.2 Writes (all through the session queue)
`createBlock({parentUid, order, uid, string, props, open})`, `updateString(uid, s)`, `updateProps(uid, plexusValueOrNull)` (pull current props → convert keys → set/remove `plexus` → write), `moveBlock(uid, parentUid, order)`, `deleteBlock(uid)`, `undo()`, `redo()`. Generate uids with `util.generateUID()` before create (create returns nothing).

### 4.3 Queries
- Derived links: one datalog over the card target eids (see `model/links.js`), run with `data.fast.q` when present, else `data.q`.
- Panel search: `[:find ?t ?u :where [?p :node/title ?t] [(clojure.string/includes? ?lt ?q)] ...]` with lower-case compare, limit in JS; block search same over `:block/string`, excluding blocks under `roam/` pages.
- Related: pull `:block/refs` of the card's scope and `:block/_refs` of its target.

## 5. Performance and stability gates (live, Roam Desktop CDP, Readwisenotes test page)
- Open a 120-card board: shells painted in the first frame after mount; scripting before first paint < 60 ms; content fills within 1 s in idle chunks.
- Pan/zoom on that board: no `renderString` calls, no graph writes, one style write to `.pxd-world` per frame; frame time p95 < 16 ms.
- Drag one card: zero writes until pointerup, exactly one props write after.
- Section tool: one drag = one section block; one click = one section block.
- New card: type text immediately after creation; the text is in the block after exit.
- Open, pan, zoom, fit, select: sync dot never goes pending; zero writes (count via a write counter exposed as `window.__plexusDiagram.stats`).
- Unload: no `.pxd-*` nodes, no pull watches (`stats.watches === 0`), no listeners/timers left; native diagram visible again.
- Echo: rapid drag A→B→A of one card never shows a flicker back to an intermediate position.
- `npm run check` green.

## 6. Settings (panel)
`enabled`, `fullscreen-on-zoom` (default on), `graph-links` (`off|attributes|all`, default all), `wheel` (`pan|zoom`, default pan), `show-minimap` (default on), `snap-guides` (default on), `grid` (`dots|lines|plain`, default dots), `default-card-width` (280), `default-card-height` (160), `enable-shortcuts` (on), `show-version-badge` (on), `disable-on-mobile` (on).

## 7. Commands
Palette + slash, prefixed `Plexus:` — **Enhance this diagram**, **New whiteboard here** (creates `{{[[diagram]]:Untitled board}}` under the focused block, enhances, opens it zoomed), **Restore native diagram**, **Fullscreen this diagram**. Block context menu: **Plexus: Enhance**.

## 8. Non-goals for 1.0
Mind maps, presentation mode, freehand drawing, shapes, PDF/highlight cards, AI. Card appears-on-N-boards badge (1.1).

## 9. Units
| # | Unit | Files | Lane |
|---|---|---|---|
| A1 | schema + board model | `src/model/schema.js`, `src/model/board.js`, tests | sonnet-worker |
| A2 | geometry + links | `src/model/geometry.js`, `src/model/links.js`, tests | sonnet-worker |
| A3 | host + session + migrate | `src/host/roam.js`, `src/host/migrate.js`, `src/session.js`, tests | sonnet-worker |
| B1 | view layer + CSS | `src/view/*`, `src/extension.css` | Fable `--tough` |
| B2 | feature wiring, discovery, settings, commands, old-file removal | `src/feature.js`, `src/discovery.js`, `src/settings.js`, `src/extension.js`, tests | sonnet-worker |
| C | integration, live CDP gates (section 5), docs, release 1.0.0 | all | host |
