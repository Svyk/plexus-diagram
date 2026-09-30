# Plexus Diagram 1.0 — module contracts

Companion to `docs/spec-plexus-1.0.md`. Every unit codes against these exact exports. Pure modules import nothing from the DOM or `window`. ES modules, no runtime deps, Node 20 `node --test`.

Conventions: a **rect** is `{x, y, w, h}` in world units; a **point** `{x, y}`; a **viewport** `vp = {x, y, zoom}` meaning `screen = world * zoom + (x, y)`. Uids are Roam 9-char strings. "Pulled" data is what `roamAlphaAPI.data.pull` returns: keys like `":block/uid"`, `":block/children"`, and inside props `":plexus"`, `":x"`.

---

## src/model/schema.js (A1)

```js
export const PLEXUS_KEY = "plexus";
export const SCHEMA_VERSION = 2;
export const PALETTE = ["gray","red","orange","yellow","green","teal","blue","indigo","purple","pink"];
export const ITEM_TYPES = ["card","section","text"];
export const DEFAULT_SIZES = { card:{w:280,h:160}, section:{w:480,h:320}, text:{w:240,h:48} };
export const MIN_SIZES = { card:{w:200,h:80}, section:{w:160,h:100}, text:{w:60,h:24} };
export const FONT_SIZES = [16, 24, 32, 48];
export const EDGE_DEFAULTS = { fromSide:"auto", toSide:"auto", dir:"one", route:"curve", dash:"solid", weight:1 };
export const SIDES = ["auto","top","right","bottom","left"];
export const ARROWS = { one:"→", two:"↔", none:"—" };

plainKeys(value)                      // deep copy; object keys lose ONE leading ":" ; arrays mapped; primitives returned
readPlexus(props)                     // props = pulled ":block/props" value OR plain; → plain plexus object | null
mergePropsForWrite(props, plexus)     // → plain object with every other key kept (plainKeys); plexus==null deletes the key
normalizeItemLayout(plexus)           // → {type, x, y, w, h, color, collapsed, fontSize}; invalid/missing fields → undefined
                                      //   (type defaults "card"; color only if in PALETTE; numbers must be finite; fontSize in FONT_SIZES)
serializeItemLayout(layout)           // → minimal plain object: {type (omitted when "card"), x, y, w, h (1-decimal rounded), color?, collapsed? (only true), fontSize? (text only)}
normalizeEdge(plexus)                 // → {from, to, fromSide, toSide, dir, route, dash, weight, color} (defaults applied, invalid enums → default)
serializeEdge(edge)                   // → {type:"edge", from, to, ...only non-default fields}
classifyString(s)                     // → {kind:"page", title} | {kind:"block", refUid} | {kind:"board"} | {kind:"image"} | {kind:"note"}
                                      //   page: whole trimmed string is [[T]] | #T | #[[T]] (no other text); nested brackets like [[a [[b]]]] → T = "a [[b]]"
                                      //   block: whole trimmed string is ((uid)); board: starts with {{[[diagram]] or {{diagram (case-insensitive);
                                      //   image: whole trimmed string is one ![alt](url)
parseBoardTitle(s)                    // "{{[[diagram]]:Hold for leak }}" → "Hold for leak"; no title → ""
plainText(s, max=200)                 // markdown → plain: [[x]]→x  #[[x]]→x  #x→x  [t](u)→t  ![a](u)→""  ((uid))→"" 
                                      //   **b** __i__ ^^h^^ ~~s~~ `c` → inner text; {{...}}→""; "Name::" kept; collapse whitespace; truncate with "…"
firstLine(s)                          // plainText of the first non-empty line
semanticRef(item)                     // item.target.kind "page" → "[[title]]"; "block" → "((refUid))"; "self" → "((item.uid))"
edgeString({srcRef, dstRef, dir, label})   // label "" → `${src} ${A} ${dst}`; else `${src} ${A} ${label} ${A} ${dst}` (A = ARROWS[dir])
parseEdgeLabel(s, srcRef, dstRef)     // strip leading `${srcRef} <any ARROWS token> ` and trailing ` <any ARROWS token> ${dstRef}`; → middle trimmed;
                                      //   if either strip fails: remove every occurrence of srcRef, dstRef and arrow tokens, trim
colorForLabel(label)                  // "mentions"/""/null → "gray"; else stable FNV-1a hash → PALETTE[1 + h % 9]
attrNameOf(s)                         // "Name:: rest" | "Name::" → "Name" (trimmed, 1-60 chars, no newline) else null
```

## src/model/board.js (A1)

```js
buildBoard(pulled, { defaults } = {})  // pulled = data.pull(BOARD_PATTERN) of the board block (may be null → null)
                                       // defaults = { card:{w,h} } overrides DEFAULT_SIZES.card
```
Returns **Board**:
```js
{
  uid, string, title,                  // title = parseBoardTitle(string)
  plexus,                              // readPlexus(board props) | null
  enhanced,                            // plexus?.v === 2
  items: Map<uid, Item>,
  roots: string[],                     // board's direct item uids, outline order
  order: string[],                     // render order: pre-order walk; all sections before all non-sections, sections by depth asc
  containerUid: string|null,           // child whose plexus.type === "edges"
  containerIndex: number,              // its index among board direct children; -1 when absent
  childCount: number,                  // number of board direct children (container included)
  edges: Map<uid, Edge>,
}
```
**Item**:
```js
{
  uid, type: "card"|"section"|"text", kind: "page"|"block"|"board"|"image"|"note"|"section"|"text",
  string, heading, parentUid, order, depth,       // depth 0 = board root
  x, y, w, h,                                     // relative to parent container; always numbers (auto-placed when missing)
  hasLayout,                                      // true iff props had finite x and y
  color, collapsed, fontSize,
  title,                                          // page card → page title; board card → parseBoardTitle || "Untitled board"; else firstLine(string)
  target: {kind:"page", title} | {kind:"block", uid} | {kind:"self", uid},
  members: string[],                              // sections only: direct member item uids (outline order); [] otherwise
  content: object[],                              // cards/text: the block's own pulled ":block/children" sorted by order ([] otherwise)
}
```
Rules: children of the board and of sections are items; the container is not an item; its children with `plexus.type === "edge"` are edges; a child without props whose `heading` > 0 and which has children is a section (no props → hasLayout false). A block with `plexus.type` "section"/"text" is that type. Children of cards/text are `content`, never items.

Auto-place (items with hasLayout false), per container, deterministic: start at the right edge of the union of laid-out siblings + 48 (or x=0,y=0 when none), fill columns of 4 downward with 40 gaps using the item's size.

**Edge**: `{uid, string, from, to, fromSide, toSide, dir, route, dash, weight, color, label, valid}`; `label = parseEdgeLabel(string, semanticRef(fromItem), semanticRef(toItem))` when both endpoints exist; `valid` = both endpoints are items of this board.

```js
worldRects(board)                          // Map<uid, rect> for all items (parents accumulated), O(n)
worldRect(board, uid, rects?)              // single rect
descendantsOf(board, uid)                  // Set of item uids under a section (recursive), excludes uid
topLevelOf(board, uids)                    // uids minus those that have an ancestor section also in uids
containerAt(board, point, { exclude = new Set(), rects })   // deepest section (max depth) whose world rect contains point,
                                                              // skipping exclude and descendants of excluded sections → uid | board.uid
toRelative(board, containerUid, worldPoint, rects)          // → {x, y} relative to that container (board.uid → same point)
hitTest(board, point, rects, { sectionInterior = false })   // → {uid, part} | null
    // cards/text first, topmost = last in board.order: part "body"
    // then sections deepest first: point within the top 32 world units of the frame → "title";
    // within 8 world units of the frame edge → "border"; interior → only when sectionInterior: "interior"
itemsInRect(board, rect, rects, { mode = "contain" })       // "contain" | "intersect"; topLevelOf applied to the result
boundsOf(rectList)                         // union rect | null
membershipPlan(board, movedUids, rects)    // for topLevelOf(movedUids): new parent = containerAt(center, exclude = moved set)
    // → [{uid, fromParent, toParent, x, y}] only where parent changes; x,y relative to toParent (from current world rect)
sectionAdoptPlan(board, sectionUid, rects) // adopt siblings (same parent as the section, not the section) whose centers are inside;
    // release direct members whose centers are outside to the section's parent → [{uid, toParent, x, y}]
edgesTouching(board, uidSet)               // Set of edge uids with from or to in uidSet (also for descendants of sections in the set)
findEdge(board, from, to)                  // directed match → Edge | null
diffBoards(prev, next)                     // → {structural, dirty:Set}; structural when item/edge uid sets, parents, container, or
                                           //   order differ; dirty = uids (items + edges) whose any field differs (JSON compare) + all added
```

## src/model/geometry.js (A2)

```js
screenToWorld(vp, p) ; worldToScreen(vp, p)
clampZoom(z, min=0.1, max=4)
zoomAt(vp, screenPoint, factor, {min, max})       // keeps the world point under screenPoint fixed
fitViewport(bounds, size, {padding=64, maxZoom=1.5, minZoom=0.1})   // size={width,height}; bounds null → {x:size.width/2, y:size.height/2, zoom:1}
visibleWorldRect(vp, size, margin=0)              // margin = fraction of the viewport added on each side
lodForZoom(zoom)                                   // < 0.45 → "map", else "detail"
center(r) ; inflate(r, n) ; unionRect(a, b) ; rectsIntersect(a, b) ; rectContains(outer, inner) ; pointInRect(p, r)
sidePoint(rect, side)                             // midpoint of that side
nearestSide(rect, point)                          // side whose midpoint is closest
autoSides(a, b)                                    // dominant axis of center delta: |dx| >= |dy| → right/left (or left/right), else bottom/top
edgePath({ a, b, fromSide="auto", toSide="auto", route="curve", offset=0 })
   // a, b rects. Resolve auto sides (autoSides). start = sidePoint(a, fromSide), end = sidePoint(b, toSide).
   // curve: cubic bezier; control points pushed out along each side normal by max(40, 0.4 * distance)
   // straight: line start→end
   // elbow: orthogonal polyline leaving/entering along the side normals with a 24-unit stub, one or two bends
   // offset: perpendicular shift of the control geometry (used when A→B and B→A both exist)
   // → { d, start, end, mid, startAngle, endAngle, fromSide, toSide }
   //   mid = point at the path's middle (bezier t=0.5; polyline half length); endAngle = tangent direction arriving at end (radians)
arrowHeadPath(point, angle, size)                  // closed triangle "M…L…L…Z" with tip at point pointing along angle
arrowSize(zoom, weight=1)                          // world units: max(8 + 2*weight, 6 / zoom)
snapMove(moving, others, threshold)                // align moving rect's left/center/right to others' left/center/right (x) and top/middle/bottom (y)
   // → { dx, dy, guides: [{x1, y1, x2, y2}] } smallest correction per axis within threshold, guides spanning the aligned rects
alignRects(list, mode)                             // list [{uid,x,y,w,h}] world; mode left|center|right|top|middle|bottom → [{uid,x,y}]
distributeRects(list, axis)                        // "h" | "v" equal gaps between first and last (sorted) → [{uid,x,y}]
gridBackground(vp, style, base=24)                 // → {size, x, y} px for CSS background-size/position; style "plain" → null
```

## src/model/links.js (A2)

```js
linksQuery()   // datalog string with inputs [$ ?board [?a ...] [?b ...]] returning [?a ?b ?su ?ss]:
               //   [?src :block/refs ?b] (or [?src :block/page ?a] [?src :block/parents ?a] [(= ?src ?a)])
               //   [(not= ?a ?b)] (not [?src :block/parents ?board]) [(not= ?src ?board)]
               //   [?src :block/uid ?su] [?src :block/string ?ss]
reduceLinks(rows, { eidToItems, parentStrings = new Map() })
   // rows: [[aEid, bEid, srcUid, srcString], …]; eidToItems: Map<eid, itemUid[]>; parentStrings: Map<srcUid, parentString>
   // label = attrNameOf(srcString) ?? attrNameOf(parentStrings.get(srcUid)) (only when parent is bare "Name::") ?? "mentions"
   // kind "attr" when label !== "mentions"
   // one Link per (fromItem, toItem) pair, fromItem !== toItem:
   // → [{ key:`${from}->${to}`, from, to, kind, labels:[…unique, attr first], sources:[{uid, string}] (≤ 20), color: colorForLabel(first label) }]
filterLinks(links, mode)                           // "off" → [] ; "attributes" → kind attr ; "all" → all
coveredBy(links, board)                            // → { visible: Link[], coveredEdges: Set<edgeUid> } links whose pair (either direction) has a board edge are hidden
```

## src/host/roam.js (A3)

```js
export const BOARD_PATTERN   // see spec 4.1
createHost({ api = globalThis.roamAlphaAPI, storage = globalThis.localStorage, graph } = {})  → host
host.api                                   // the raw api (views may use host.render* only)
host.pullBoard(uid)                        // data.pull(BOARD_PATTERN, [":block/uid", uid]) | null
host.watchBoard(uid, cb)                   // addPullWatch; cb(after) ; returns unwatch(); stats.watches tracks live count
host.pullProps(uid)                        // plain props object ({} when none)
host.pullTree(uid, depth=2, limit=12)      // [{uid, string, children:[…]}] of the block's children (not the block), order-sorted, ≤ limit total
host.pagePreview(title, depth=2, limit=12) // → {uid, exists, blocks:[{uid, string, children:[…]}]} (page's children, same shape/limits as pullTree)
host.pageUid(title)                        // → uid | null
host.blockString(uid)                      // string | null
host.resolveEid({uid} | {title})           // :db/id | null
host.generateUid()
host.createBlock({parentUid, order="last", uid, string="", props, open})   // → Promise<uid>; props = plain props object (whole map)
host.updateString(uid, string)
host.updateProps(uid, plexus)              // pull current → mergePropsForWrite → block.update({uid, props}); plexus null removes
host.moveBlock(uid, parentUid, order="last")
host.deleteBlock(uid)
host.setOpen(uid, open)
host.undo() ; host.redo()
host.openInSidebar(uid, type="block")      // ui.rightSidebar.addWindow({window:{type, "block-uid": uid}}) ; type "outline" for pages
host.openBlock(uid)                        // ui.mainWindow.openBlock({block:{uid}})
host.renderString(el, string) ; host.renderBlock(el, uid) ; host.renderPage(el, uid) ; host.unmount(el)
host.q(query, ...inputs)                   // data.fast.q when present else data.q
host.searchPages(text, limit=40)           // → [{uid, title}] case-insensitive substring, excludes titles starting "roam/"
host.searchBlocks(text, limit=40)          // → [{uid, string, pageTitle}]
host.related({kind, title|uid}, limit=60)  // → [{relation:"links to"|"linked from"|<attr name>, target:{kind:"page",title}|{kind:"block",uid}, text}]
host.stats                                 // {writes, watches, renders}
createWriteQueue({ onBusy })                // → { run(fn) → Promise (serial), get pending(), idle() → Promise }; onBusy(bool) on 0↔1+ transitions
createEchoLedger({ graceMs = 800, now = Date.now })
   // expect(uid, field, value)  record a pending write value (field: "props"|"string"|"parent")
   // settle(uid, field)         a write for uid/field finished (starts the grace timer when none remain)
   // accept(uid, field, value)  → true when incoming should be applied:
   //   equals the newest pending value → clears all pending for that field, returns false (echo absorbed)
   //   equals an older pending value → false (stale echo)
   //   different, while pending or within grace → false ; otherwise → true
createViewportStore({ storage, graph })     // get(boardUid) → vp|null ; set(boardUid, vp) (writes at most once per 500 ms per board)
graphName()                                  // from location hash "#/app/<graph>"
```

## src/host/migrate.js (A3)

```js
readV06Entry(host, boardUid)      // parse [[plexus-diagram/metadata]] → {nodes: Map<uid,{x,y,w,h,color}>, sections:[{id,x,y,w,h,title,color}],
                                  //   edges:[{from,to,route,label,fromSide,toSide,dir,color}], viewport:{x,y,zoom}|null, entryUid} | null
readNative(host, boardUid)        // pull :diagram/nodes + :diagram/edges → {nodes:[{blockUid,x,y,w,h,parentNode?,type}], edges:[{from,to,label?}]}
planImport(board, source)         // pure. source = v06 entry or native → {itemLayouts:[{uid, layout}], sections:[{uid (pre-generated by caller-supplied gen), title, layout, members:[uid]}],
                                  //   memberLayouts:[{uid, layout}] (relative to their new section), edges:[{from,to,label,props}], viewport}
executeImport(plan, host, board)  // writes: board props {v:2}, item props, section blocks (then moves), container + edge blocks; returns counts
```

## src/session.js (A3)

```js
acquireSession(boardUid, { host, settings })   // registry by boardUid, ref-counted → session
session.uid ; session.board ; session.rects (Map, recomputed on change) ; session.links (visible Link[]) ; session.coveredEdges (Set)
session.host ; session.settings ; session.busy (bool)
session.on(name, fn) → off     // "change" {dirty:Set, structural:bool} | "links" | "busy" (bool) | "toast" {message, action?:{label, run}}
session.release()
session.setLinkMode(mode)       // "off"|"attributes"|"all" → recompute visible links, emit "links"
session.refreshLinks()          // debounced 1500 ms; idle callback
// mutations: optimistic model update + emit change + queued writes; every one returns a Promise that resolves after its writes
session.commitMove(uids, dx, dy)                  // world delta; top-level items only; then membershipPlan; props (+ move) writes
session.commitRects(list)                          // [{uid, x, y, w, h}] world rects (align/distribute/resize); sections → sectionAdoptPlan
session.createCard({x, y, string="", w, h})        // world point = top-left; parent = containerAt(center) → uid
session.createText({x, y, string=""})              // → uid
session.createSection({rect, title="Section", color})  // adopts items fully inside rect → uid
session.wrapInSection(uids)                        // bounds + 32 padding → uid
session.addRefCards(list)                          // [{string, x, y}] → uids
session.deleteItems(uids, {withContents=false})    // + touching edges; sections without contents: members move up first
session.setColor(uids, color|null)                 // items and/or edges
session.setCollapsed(uid, bool) ; session.setFontSize(uid, size)
session.setString(uid, string)                     // section titles, text, card string, never while that card is being edited
session.growToFit(uid, contentHeight)              // world units, cap 900
session.addEdge({from, to, fromSide, toSide, label="", dir})   // existing same-direction pair → returns existing uid
session.updateEdge(uid, patch)                     // {dir, route, dash, weight, color, fromSide, toSide, label}; rewrites string when dir/label change
session.flipEdge(uid) ; session.deleteEdges(uids)
session.pinLink(link)                              // → edge uid with label = link.labels[0] (unless "mentions")
session.writeToGraph(edgeUid)                      // → {ok, reason}
session.undo() ; session.redo()
session.enhance()                                  // not enhanced → import (v06 → native → none), write board props {v:2}
session.restoreNative()                            // remove plexus from board props
```

## src/view (B1) — entry used by feature.js

```js
mountBoardView({ host, session, mountEl, nativeEl, settings, onRequestFullscreen, fullscreen:boolean, version }) → view
view.setFullscreen(bool) ; view.fit() ; view.dispose() ; view.root (the .pxd-root element)
```

## 1.1 additions (R4: Roam drag-and-drop)

```js
host.cardStringForUid(uid) → string|null           // page uid → "[[Title]]", block uid → "((uid))", unknown → null
parseDropPayload(dataTransfer, { resolveUid }) → Array<{string}>   // [] when nothing usable; never null
```
`parseDropPayload` order: `application/x-plexus-card`; uids from `roam/block-uid-list-only-parents`, then `roam/block-uid-list`, then `/page/<uid>` in `roam/roam-uri-list` / `text/uri-list` (deduped, max 50, each mapped through `resolveUid`, nulls dropped); then the `[[..]]` / `((..))` / bare-uid text fallbacks. Board drops stack cards 24 px apart, the first centred on the drop point; drops onto an editing card (`.pxd-item__editor`) are left to Roam.

## 1.1 additions (R2: focus recovery)

```js
itemRenderer.recoverFocus() → boolean              // arms the focus floor once: refocus the live Roam textarea of the card being edited
```
Called by `board-view.js` when a key arrives during an edit with focus on `<body>` (the key is not run as a board shortcut). It never writes to the graph and is rate-limited (4 recoveries per 1.5 s).

## 1.1 additions (F5: nested boards)

A nested board is one card block: string `{{[[diagram]]:Title}}`, props `{plexus:{x,y,w,h,v:2}}` written in a single create. In the parent it is a `kind:"board"` card (`v` is ignored); its own children form the child board, which `buildBoard` reads as enhanced because of `v:2`.

```js
// schema
DEFAULT_BOARD_CARD = {w:320, h:220} ; UNTITLED_BOARD = "Untitled board"
boardString(title) → "{{[[diagram]]:Title}}"      // newlines → space, "}}" stripped, empty → Untitled board
setBoardTitle(string, title) → string              // rewrites only the leading {{[[diagram]]…}} token; keeps [[diagram]]/diagram form and trailing text
isUntitledBoard(title) → boolean                   // "" or "untitled board" (case-insensitive)
withBoardMarker(plexus, on) → plexus|null          // on: {...plexus, v:2}; off: without v and bg, null when empty
serializeItemLayout(l)                             // now also keeps v (only 2) and bg (dots|lines|plain)

// board
hitTest(board, point, rects, {sectionInterior=false, exclude:Set|null})   // exclude skips those uids
boardPreview(item, {max=60}) → {count, aspect, rects:[{x,y,w,h,type,color}], bounds}
                                                   // built from item.content (no extra pull); rects are fractions of bounds in draw order, aspect clamped 0.25..4, bounds = absolute child bounds or null

// session
session.createBoard({rect, title?}) → uid          // one create call, open:false; parent = container at the rect center
session.wrapInBoard(uids) → uid|null               // card at the bounds (w 240..480, h 180..360); items rebased to the child origin;
                                                   // edges with both ends moved go to a Connections block in the child; crossing edges are retargeted to the board card (self/duplicate edges are deleted)
session.moveIntoBoard(uids, boardUid) → {moved, title, boardUid, undo()}|null
                                                   // null unless the target is a board card; drops the target and any section containing it;
                                                   // placed right of existing child content (bounds.x+w+48) or at 0,0 when empty; undo() is an inverse transaction
session.renameBoard(uid, title)                    // string write of the token only, none when unchanged
session.restoreNative()                            // now strips only v/bg: a nested card keeps x,y,w,h
executeImport(...)                                 // final write is withBoardMarker(board.plexus, true), so nested layout survives Enhance
```

```js
// view
mountBoardView({ ..., crumbs:[{uid,title}]|null, onOpenBoard(uid), onCrumb(index), routeUid=session.uid, autofocus=false })
```
`crumbs` entries are shared with the caller, so a board rename updates them. `routeUid` is the board of the Roam route/mount: it keys the inline height and the fullscreen route watch (the viewport store stays keyed by `session.uid`). Without `onOpenBoard`, Open falls back to `host.openBlock`. Interaction actions added: `createBoard`, `moveIntoBoard(uids, boardUid, dx, dy)` (the view falls back to `commitMove` when it returns null), `openBoard`, `popBoard() → boolean`. Tool `board` (key W); Esc order is gesture, edit, selection, `popBoard`, fullscreen. `createItemRenderer` takes `onOpenBoard(uid)` and `onRenameBoard(uid, title)` and returns `renameBoard(uid)`. `createChrome` takes `crumbs` and returns `toolbar.setCrumbs(list)`; the context bar has a `board` kind (Open, Rename board) and the multi-select bar has Move into new board.

```js
// feature.js
window.__plexusDiagram.mounts() → [{uid, current, crumbs:[uid…], fullscreen, connected}]
```
`uid` stays the native (route) board; `current` is the board on screen and `crumbs` the trail. Navigation (`onOpenBoard`, `onCrumb`) swaps view and session on the same mount element and keeps fullscreen; it never enhances a native diagram (a child without `v:2` goes to `host.openBlock`). A zoomed nested board seeds its crumbs from its enhanced diagram ancestors, root first. A `.rm-diagram` inside a hidden native or our overlay is never mounted. Settings changes remount with the trail intact.

`settings` may be a `{get(key)}` object or a plain map in `mountBoardView`, `createChrome` and `createInteractions`.

## 1.1 additions (collapsed board blocks)

Roam lists an enhanced board's child blocks as an outline under it. The extension does not hide that outline with CSS or key handlers; it collapses the board block (`:block/open` false), so Roam neither renders the children nor steps into them with the keyboard. The `{{[[diagram]]}}` in the block body still renders, and expanding the bullet shows the outline.

- Creation: "Plexus: New whiteboard here" and `session.createBoard` / `wrapInBoard` (nested boards) pass `open: false` in the create call, or no `open` when `collapse-outline` is off.
- `session.enhance()` also runs `host.setOpen(uid, false)` in the same queued run, after the import, when `collapse-outline` is on and the board block is open (children or not, so cards added later do not show as an outline). An already collapsed board is not written.
- First mount of an already-enhanced board that is open with children collapses it once: with the `collapse-outline` setting on, and `localStorage` key `plexus-diagram:collapsed:<graph>:<uid>` absent, the key is set first and then `host.setOpen(uid, false)` runs. A board found already collapsed only records the key. Mounts inside `.bp3-portal` (hover previews, popovers) never write and never record the key. The key is per browser, not per graph, so another device or a cleared storage collapses an expanded board once more. Nothing else writes on mount, and a board that is not enhanced is never touched.
- `session.restoreNative()` leaves the open state alone.
- Setting `collapse-outline` (switch, default true): "Collapse board blocks in the outline (expand the bullet to see them)". It replaces the unreleased `show-outline`.
- Zoomed parent pages still render children under the overlay, so `.rm-diagram` elements inside an enhanced ancestor board's rendered children are never mounted (they get `pxd-outline-native` so the pre-paint guard leaves them alone), and an already-mounted nested one is unmounted when the parent mounts.

## 1.2 additions

Everything below is in the merged 1.2 code. Nothing in the 1.0 or 1.1 sections changed meaning, except that the plain Arrow keys select instead of nudge (see interactions).

### schema.js

```js
BOARD_PATTERNS = ["dots","lines","grid","plain"] ; BOARD_TONES = ["paper", ...PALETTE] ; FIT_PAD = 24
dailyPageTitle(date) → "September 29th, 2026"    // local date, Roam daily-note title
```
`BOARD_BACKGROUNDS` is gone. Props keys (all under `plexus`):

| key | on | meaning | serialized when |
|---|---|---|---|
| `pinned` | any item | locked: cannot move, resize, tidy, same-size, reset or be deleted (without `force`) | `true` only |
| `fit` | section | `false` opts the section out of auto-fit | `false` only, sections only |
| `bg` | board (board block or nested board card) | pattern, one of `BOARD_PATTERNS` | valid value |
| `bgColor` | board | tone, one of `BOARD_TONES` | valid value |

`normalizeItemLayout` returns `pinned` (boolean) and `fit` (`false` or `undefined`). `withBoardMarker(plexus, false)` now deletes `v`, `bg` and `bgColor`.

### model/board.js

```js
item.pinned : boolean ; item.autofit : boolean   // autofit is false only for a section with fit:false
board.background = { pattern: string|null, tone: string|null }   // this board's own values, null = not set
sectionFitPlan(board, rects, touchedUids, {pad=FIT_PAD, skip=Set, parentOf}) → [{uid, rect}]
boardPreview(item, {max=60, aspect=null, pad=0.12}) → {count, aspect, rects, edges, bounds, empty}
outlineOrder(board) → uid[]
```
`sectionFitPlan` is grow-only. Each touched uid walks up its section chain; a section grows to `unionRect(section, inflate(child, pad))`, and a grown section counts as touched for its own parent (the cascade). It stops at the first ancestor that does not change, is not a section, has `autofit === false`, is `pinned` (a pinned frame never grows or moves), or is in `skip`. `rects` are world rects and may hold live drag rects. The result is sorted deepest first, one entry per grown section.

`boardPreview` v2: `rects` are `{x,y,w,h,type,kind,color,title,ref?}` (`ref` = the referenced block uid of an untitled ((ref)) card, so the card view can title the mini) as fractions of a padded frame (`max(24, pad*max(bw,bh))` around the child bounds, grown to at least 560x320 first, aspect clamped 0.25..4 unless `aspect` is given). `edges` are `{x1,y1,x2,y2}` centre-to-centre fractions of valid connections. `bounds` stays the unpadded absolute child bounds. Titles are the first line cut at 40 characters (a board card with no text uses the board title). `empty:true` with `count:0` for a board with no items.
`outlineOrder` is depth first, siblings by block order (the Tab order and the Outline tab order).

### model/geometry.js

```js
lodTier(zoom, prev="detail", {threshold=0.45, overview=0.2}) → "detail"|"map"|"overview"
lodFonts(zoom) → {map, section, ui}       // world-unit sizes: map clamp(13/z,14,42), section clamp(16/z,15,160), ui clamp(1/z,1,4)
nearestInDirection(rects, fromUid, dir, {candidates}) → uid|null
gridBackground(vp, style, base=24) → {size, x, y, major}|null      // null only for "plain"; major = 5 cells
```
`lodTier` has hysteresis: leaving `detail` needs zoom below the threshold, coming back needs 1.1x the threshold; `overview` is left at 1.15x its cutoff. `lodForZoom` is unchanged. `nearestInDirection` takes the candidate with the lowest `primary + 2*|orthogonal|` inside a 68 degree cone, falls back to the best candidate beyond the source centre on that axis, ties break by uid; `dir` is `left|right|up|down`.

### model/layout.js (new, pure)

```js
tidyRects(list, mode, {gap=24, columns=null, order=null}) → [{uid,x,y}]     // mode: row|column|grid|outline (order = uid list for outline)
spaceOut(rects:Map, movedUids, {gap=16, maxPasses=8, fixed=Set}) → [{uid,x,y}] // displaced rects only; moved uids never move; `fixed` (pinned cards) are never displaced and never push
sameSize(list, primaryUid, mode="both") → [{uid,w,h}]                       // mode: width|height|both
mindMapLayout(root, {direction="right", hGap=80, vGap=24}) → Map uid → {x,y} // root {uid,w,h,children[]}; right|down|balanced, root at 0,0
```

### model/clipboard.js (new, pure)

```js
PLEXUS_MIME = "application/x-plexus-cards"
copyPayload(board, uids, rects) → {mime, text}     // mime = JSON {v:1, board, bounds, items:[{uid,type,kind,string,target,x,y,w,h,color}], snapshot?}; a cut adds `snapshot` (see session.snapshotItems) (top-level items, world rects); text = one semantic ref per line
parseClipboard(dataTransfer) → {kind:"plexus", data} | {kind:"images", files} | {kind:"text", entries:[{string}]} | null
parsePastedText(text) → [{string}]                 // one entry per non-empty line, leading "- "/"* " stripped, max 50
refCardStrings(data, at) → [{string,x,y,w,h,color}] // ref cards placed relative to `at`
planSubtreeClone(node, {genUid, parentUid, order, plexusPatch, uidMap}) → {creates, uidMap}   // creates: [{uid,parent,order,string,props,open}], ((uid)) inside the subtree rewritten
planEdgeClones(edges, uidMap, {genUid, containerUid, refOfNew}) → creates              // only edges whose both ends were cloned
```
`parseClipboard` order: the plexus MIME (valid `v:1` JSON with `items`), then image files, then `text/plain` lines.

### model/export.js (new, pure)

```js
boardToSvg(board, rects, {dark=false, padding=48, maxItems=500}) → string   // standalone SVG, no external refs
boardToMarkdown(board, rects) → string                                     // sections become headings (depth), cards bullets, then connections
```

### session.js

```js
extendSession(fn(session, api)) → unregister()
```
Every session created afterwards runs `fn` once before it is returned; a throwing extension is logged and skipped. `api` = `{uid, host, settings, txn, rawNode, ix, kidsOf, rawPlexus, itemPlexus, edgePlexus, insertOrder, ensureContainer, edgeStringFor, refOf, applyFit, board(), rects(), queue, isGone(), setting, clone, round1, emit}`.

Settings read by the session (through `setting()`, boolean or `"true"`/`"false"`): `auto-fit-sections` (default true), `space-out` (default false).

**applyFit(t, touched, {skip})** runs inside the caller's transaction, after `t.sync()`: it takes `sectionFitPlan`, writes each grown section once (relative to its parent's final rect) and rebases direct members of a section whose origin moved so their world positions stay put. Off when `auto-fit-sections` is false. Write counts: a move, resize, create, tidy, same-size, reset-size, fit-to-content, grow-to-fit, paste or daily-card action that pushes past a section adds one props write per grown section (plus one per member of a section whose origin moved). It is one transaction, so one undo step. A section the user just resized is in `skip` (`commitRects`). A pinned item never moves or resizes but can still make its section grow.

New and changed methods:

```js
session.fitSection(uid, {shrink=true}) → boolean    // tight fit (members' bounds + FIT_PAD, origin may move inward); shrink:false unions with the current rect; skips no-op writes
session.setFit(uid, on)                              // sections; off writes fit:false, on removes the key
session.setPinned(uids, on)                          // pinned:true / key removed
session.setBoardBackground({bg, bgColor}) → boolean  // undefined leaves the key, null removes it, invalid value or non-enhanced board → false
session.setCollapsedMany(uids, value) → count        // cards only
session.collapseAll(value, {within, except}) → count
session.tidyItems(uids, mode="grid", {gap}) → count  // row|column|grid|outline; a lone section tidies its members; writes x,y only; skips pinned
session.sameSize(uids, primaryUid, mode="both") → count ; session.resetSize(uids) → count   // skip pinned; resetSize uses DEFAULT_BOARD_CARD for board cards
session.fitToContent(uid, contentHeight)             // sets h from measured content, shrinks as well as grows (growToFit only grows), cap 900
session.addDailyCards(dates, {x, y}) → uids          // [[<dailyPageTitle>]] cards, skips pages already on the board; dates are Date or "YYYY-MM-DD"
session.deleteItems(uids, {withContents, force})     // pinned items are skipped unless force; with contents also skips a section holding a pinned member
```
`commitMove` and `commitRects` skip pinned items, then run `applyFit` and (moves only, when `space-out` is on) `spaceOut` for the moved items' siblings: sections only take part when a section moved, pinned siblings never move, displaced cards are written and `applyFit` runs again. `createCard`, `createText`, `createBoard`, `wrapInBoard`, `moveIntoBoard`, `addRefCards` and `growToFit` also end with `applyFit`. `ITEM_KEYS` now include `pinned` and `fit`, so other keys and unknown plexus keys are preserved on write.

### session-clip.js (new; registers through extendSession, imported first by extension.js)

Each method is one transaction with `applyFit` at the end.
```js
session.duplicateItems(uids, {dx=24, dy=24, asRef=false}) → uids   // clones the subtrees (blocks, children, props minus pinned); asRef makes ((ref)) cards; nested boards clone with their inner edges remapped; a native (non-enhanced) diagram is skipped
session.snapshotItems(uids) → rawBoardTree|null                       // detached copy of the top-level items, their subtrees and the connections between them; a cut stores it in the clipboard payload before the blocks are deleted
session.pasteItems(data, {x, y, mode="refs"|"clone"}) → uids        // data = parseClipboard result or its .data; a payload with `snapshot` (a cut) is always cloned from the snapshot, never pasted as ((ref)) cards to the deleted blocks; clone mode also clones the connections between the pasted items and reads another board through host.pullBoard
session.pasteText(textOrEntries, {x, y}) → uids                     // one card per entry, stacked 24 apart below each default-height card
session.sendToBoard(uids, targetBoardUid) → {added, title}|null      // ref cards right of the target's content; null for itself, a missing uid or a non-enhanced/non-board block; a board outside this tree is written through the host queue
session.expandOutline(cardUid, {direction="right", max=40}) → {added, edges}   // child blocks of a note/block/page card become ref cards laid out by mindMapLayout, plus one connection per parent -> child; depth <= 3; blocks already on the board are reused
```

### host/roam.js

```js
host.listBoards({limit=200}) → [{uid, title, pageTitle, pageUid, count, edited}]   // every enhanced board block (props.plexus.v === 2), sorted by page then title; count excludes the Connections block; read-only
host.cardStats(targets, {boardUid}) → Map key → {refs, boards, open, done}          // key "page:<title>" or "uid:<uid>"; at most 4 datalog queries (the view runs it in idle slots, 12 targets at a time, cached 2 minutes); targets = [{kind, uid?, title?}]
host.uploadFile(file) → Promise<url>                                                 // api.file.upload; throws "upload-unavailable" or "upload-failed"; bumps stats.writes on success
```
`refs` counts blocks elsewhere that reference the target (not under this board), `boards` the diagram blocks that contain such a block, `open`/`done` the TODO/DONE blocks under or on the target page.

### view

```js
mountBoardView({ ..., onSetDefaults(patch) })        // patch is a settings map, e.g. {grid, "board-tone"}; wired to feature.setDefaults
view.setSettings(settings)                           // swap the settings object; re-applies background, LOD, minimap and badges without a remount
view.state() → {zoom, lod, pattern, tone, focus, present, selection, mounted, menuOpen}
view.exportSvg({download=true}) → Promise<string>    // boardToSvg; download offers <title>.svg through a temporary link
view.copyOutline() → Promise<string>                 // boardToMarkdown to the clipboard, toast "Outline copied"
```
Background resolution: the board's own `bg`/`bgColor`, else the `grid` and `board-tone` settings. Image files pasted or dropped are uploaded with `host.uploadFile` and added as `![](url)` cards; a drop onto an editing card is still left to Roam.

**cards.js** (`createItemRenderer`) adds: `setLod(tier, zoom)` (`detail|map|overview`; only map and overview change what is mounted: titles, text, board shells), header caps (ref titles 120 characters, header text 160), the `pxd-item--bare` class while a card has no mounted body, the board thumbnail (`.pxd-mini`, `.pxd-mini__title`, `svg.pxd-board-preview__edges`, `.pxd-board-preview__empty`), whiteboard shortcut cards (a `((ref))` to a board block renders the thumbnail from `host.pullBoard`, class `pxd-item--wb`, Open calls `onOpenBoard(refUid)`, never `renderString`), `previewSectionRects(list)`, `resetRects(rects, uids)`, `measureContent(uid)` (natural content height: the body is unclamped for the read, so Fit height can shrink a card), `onEditResize(uid, height)` option (the editing card's live height; the view previews the section growing around it), `setBadges(map)`, `setShowBadges(bool)`, `setFocus(uids|null)`. Pinned items get `pxd-item--pinned` / `pxd-section--pinned`.

**edges.js**: `setGhosts([{x,y,w,h}]|null)` (dashed Alt-drag duplicate previews) and `setFocus(Set|null)` (dims connections and links not fully inside the set; re-applied on render and update).

**interactions.js** actions added (all optional): `openMenu({kind, uid, screen, world, selection})`, `showGhosts`, `duplicateItems(uids, {dx,dy,asRef})`, `cancelPreview`, `foldSelection`, `toggleFocus`, `quickLook`, `present`, `expandOutline(uid)`, `presentActive`, `presentNext`, `presentPrev`, `closeQuickLook`, `exitPresent`, `exitFocus` (each of the last three returns true when it closed something), `fitHeight(uid)`, `fitSection(uid)` (bottom-grip double-click on a section), `isBoardCard(uid)` (true for a nested board or a whiteboard-shortcut card: double-click and Enter open it instead of editing). Keydown events may carry `tabOwned:false` (focus is not on the board itself); Tab is then not handled. `resetSize(uids)`. Escape order: gesture, quick look, presentation, edit, focus, selection, popBoard, fullscreen.

Keys: Alt+drag duplicates (Alt+Shift+drag makes ref cards; the drop never goes through `moveIntoBoard`), Cmd/Ctrl+D duplicates by 24,24, right-click opens the menu, plain Arrow nudges the selection 1 px (Shift+Arrow 10 px, pinned items stay put), **Alt+Arrow selects the nearest item in that direction (Alt+Shift+Arrow adds)**, Tab / Shift+Tab walk `outlineOrder` (wrapping), F focus, Q quick look, P present, M expand a note, block or page card into a mind map, Cmd/Ctrl+Alt+Enter fold. Double-click a bottom or corner grip fits or resets the height. Pinned items ignore move, resize and grip gestures; in a multi-selection only the unpinned ones move.

**chrome.js** adds toolbar buttons Background (popover), Focus, Present and More, `chrome.toolbar.setBackground({pattern, tone, override})`, `chrome.popover`, `chrome.backToContent`, and the ctx-bar buttons Pin (`.pxd-ctx__pin-toggle`), Fit height, Reset size, Fit section, Auto-fit toggle, Fold, Same size, Tidy, Send to, Expand outline. Callbacks: `setBackground({bg?, bgColor?})` (Reset sends `{bg:null, bgColor:null}`, the default swatch `{bgColor:null}`), `useBackgroundAsDefault()`, `toggleFocus`, `present`, `openMore({x,y,w,h})` (client coordinates of the button's left and bottom edge), `backToContent`, `pin`, `toggleFit`, `fitSection`, `fitHeight`, `fold`, `foldAll`, `sameSize`, `tidy`, `sendTo`, `expandOutline`, `align`, `distribute`.

**panel.js** tabs: Search, Related, Boards, Outline. Callbacks `listBoards()` (Promise of `host.listBoards` rows), `openBoardByUid(uid)`, `addBoardCard(uid)`, `getOutline()` (sections only: `{uid,title,depth,count,color}`), `outlineClick(uid)`, `opened(bool)`; `panel.open(tab)`, `panel.refreshOutline()`. "Send to board" opens the Boards tab; the next board row click calls `session.sendToBoard`.

**menu.js / menu-model.js**: `createMenu({doc, root, on:{pick(id), closed()}})` with `open({x,y,items})` in client coordinates; Esc or Tab closes it. A menu taller than the board gets `pxd-menu--scroll` (max-height, scrolls; submenus are then pinned beside their row). `buildMenu(kind, ctx)` for `MENU_KINDS = canvas|card|section|text|edge|multi|board-menu` returns `{id, label, hint?, disabled?, checked?, danger?, children?}` or `{id:"sep-N", separator:true}`; `flattenMenu(items)` lists every non-separator item. Item ids: canvas `new-card new-text new-section new-board paste paste-clone add-today add-week select-all fit-all fold-all unfold-all background export-svg copy-outline`; card `edit open open-sidebar copy copy-ref copy-link duplicate duplicate-ref color:<name> fold|unfold fit-height reset-size pin|unpin mind-map (note, block and page cards) send-to related delete` (a board card relabels Edit as Rename board and Open as Open board); section `rename select-contents fit-section toggle-fit tidy tidy:grid|row|column|outline fold-all-in unfold-all-in color:<name> pin|unpin duplicate copy-ref delete-frame delete-contents`; text `edit color:<name> size:16|24|32|48 duplicate pin|unpin copy delete`; edge `dir:none|one|two flip route:curve|straight|elbow dash:solid|dashed color label notes write-to-graph delete`; multi `copy duplicate color align:left|center|right|top|middle|bottom distribute:h|v tidy:* same-size:width|height|both fold unfold pin unpin wrap-section wrap-board send-to delete`; board-menu `export-svg copy-outline fold-all unfold-all add-today add-week background tidy:grid`.

**quicklook.js**: `createQuickLook({doc, root, host, timers, on:{close, getRefCount}})` → `{open(item), close(), toggle(item), isOpen(), dispose()}`. Renders the block and its children (depth 3, 24 rows) through `host.renderString`; a board card shows its item count; swallows pointer, wheel and key events.
**present.js**: `createPresenter({doc, root, timers, on:{step, exit}})` → `{start(board, rects), next(), prev(), goto(i), stop(), isActive(), index(), total(), dispose()}`; steps are the top-level sections in outline order, or the whole board when there are none; `on.step` receives the rect and the member set the view dims around.
**clipboard-io.js**: `createClipboardIO({doc, root, ownsKeyboard, isTextEntry, on:{getPayload, cutDone, pastePlexus, pasteImages, pasteText}, now})` wires capture-phase copy, cut and paste while the board owns the keyboard and no text field is focused; Cmd/Ctrl+Shift+V within 400 ms of the keydown pastes as clones. Also exports `writeClipboard({text, mime, data})` and `filesFromDataTransfer(dt)` (images only, max 10). `on.pasteText` receives the parsed entries.

### CSS and build

`src/extension.css` is the base. `src/css/*.css` (`background.css`: grid pattern and board tones, `chrome.css`: popover, menu, back-to-content, panel lists, `overlays.css`: quick look, presenter HUD, ghosts, focus dim) are appended in name order by `readCss()` in `build.mjs`; without a `src/css` directory the output is unchanged. Rules stay scoped under `.pxd-root` or `.pxd-portal` with at least two classes. Root classes: `pxd-lod-map`, `pxd-lod-overview`, `pxd-bg-<tone>`.

### settings.js and feature.js

New setting ids (defaults): `board-tone` ("none"; none, paper or a palette name), `map-zoom` ("0.45"; "0.3", "0.45" or "0.6"), `auto-fit-sections` (true), `space-out` (false), `show-card-badges` (true). `grid` now also accepts `"grid"`, and its panel row is "Default board background: pattern". Enum values are stringified before matching, so a numeric `0.3` becomes `"0.3"`. `initializeSettings` seeds the new ids.

Commands added: "Plexus: Export board as SVG" (`view.exportSvg`) and "Plexus: Copy board as text" (`view.copyOutline`), in the palette and the slash list under the same guard as the others; both resolve the target like Fullscreen (`resolveBoardUid`, then the connected mount). Sessions are given `{get: id => settings[id]}` (never a snapshot), so `auto-fit-sections`, `space-out` and the default card size change on open boards without a remount. `feature.setDefaults(patch)` saves each setting, warns on failure, updates the settings object and calls `setSettings` once on every mount that has it (no remount). `window.__plexusDiagram.mounts()` entries gain `state` (the view's `state()` or `null`).
