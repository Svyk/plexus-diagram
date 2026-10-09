# Plexus Diagram 3.0

This file records the model as built in the tree whose `package.json` version is 2.21.0. Layout lives in `:block/props` under `plexus`. Reads drop bad values in memory. A write happens when the user edits. Open, pan, zoom, and select write nothing.

`tools/spec-keys.mjs` prints every key `normalizeItemLayout` and `normalizeEdge` read, plus the board keys below. `node tools/spec-keys.mjs --check docs/spec-plexus-3.0.md` exits 1 when a key is missing from these tables.

## 1. Data model

`v` is `2` on an enhanced board and on a nested board card. Restore native removes `v`, `bg`, `bgColor`, `bgImage`, `lodZoom`, and `dock`, and sets `native` to `true`. Unknown keys stay on a read-merge-write.

Palette names are `gray` `red` `orange` `yellow` `green` `teal` `blue` `indigo` `purple` `pink`. A stored colour is one of those names or lowercase `#rrggbb`. Anything else is dropped.

### Block kinds

| Kind | How the code sees it | Stored as |
|---|---|---|
| Board | Block string is `{{[[diagram]]}}` | Board keys on that block. `v` `2` means enhanced |
| Section | Item `type` `section`, or a heading with children and no plexus | Item keys. Children are the members |
| Note card | Any other string, item type `card` or omitted | Item keys. `kind` is `note` |
| Page card | One `[[page]]`, `#[[page]]`, or `#tag` | Item keys. `kind` is `page` |
| Block ref | One `((uid))` | Item keys. `kind` is `block` |
| Board ref | The card string is a diagram, `kind` `board`. A `((uid))` whose target is a diagram stays `kind` `block` and opens that board | Item keys |
| PDF card | String starts with `{{[[pdf]]:`, or a block ref whose target is that macro | Item keys. `kind` is `pdf`. No `:pdf-*` write |
| Highlight card | Block ref whose target has `:pdf-highlight` | Item keys. `kind` is `highlight`. Colour and position stay in Roam's pdf props |
| Drawing ref | Block ref whose target is `{{[[excalidraw]]}}` | Item keys. `kind` is `drawing-ref` |
| Region ref | Block ref to a Roam Plexus region, and `window.RoamPlexus.apiVersion` is at least 6 | Item keys. `kind` is `region-ref` |
| Task card | String contains `{{[[TODO]]}}` or `{{[[DONE]]}}` | Same card kinds as above. Not a separate `kind` |
| Query card | The whole string is `{{[[query]]}}` or `{{query}}` | `kind` stays `note` or `block`. Title is Query |
| Image card | One image markdown | Item keys. `kind` is `image` |
| Text | Item `type` `text` | Item keys |
| Sticky | Text with `look` `sticky` | Item keys. `min` is the header-only flag |
| Connections | Child whose `type` is `edges` | Not a card |
| Edge | Child of Connections whose `type` is `edge` | Edge keys. The label is the block string |
| Trails | Child whose `type` is `trails` | Not a card |
| Trail | Child whose `type` is `trail`, or whose string is `{{[[plexus-trail]]}}` | `type` `trail`. The name is the string after the macro |
| Stop | `((uid))` child of a trail | No plexus. The note is that stop's first child |
| Landmark | `landmark` `true` on a card, text item, or section | `glyph` and `size` only while that flag is set |
| Regions container | String `{{[[plexus-regions]]}}` or `{{[[plexus-pins]]}}`, and `type` `regions` | Not a card |
| Region | `{{[[plexus-region]]: ...}}` or a PDF pin `{{[[plexus-pin]]: ...}}` | No plexus on the region block. Caption is the text after `}}` |
| View | Region with `k=view` | Same block. `v` in the macro is the world rect, not schema `v` |
| Snapshots | Child whose `type` is `snapshots` | Not a card |
| Snapshot | Child whose `type` is `snapshot` | `json` string. Title is the block string |
| Kanban | Board key `kanban` | One string. See below |
| Table | Overlay on the same blocks | Not stored |

### Item keys

`normalizeItemLayout` in `src/model/schema.js` reads these. A missing item `type` becomes `card`. `serializeItemLayout` omits defaults.

| Key | On | Type and valid values | Default |
|---|---|---|---|
| `type` | item, and the container markers | `card` `section` `text`. Containers use `edges` `snapshots` `snapshot` `regions` `trails` `trail` `edge`, which this function does not keep | `card`, and `card` is omitted on write |
| `x` `y` `w` `h` | item | Finite numbers, stored to 0.1 | Missing x or y means auto-place. Size falls back to the kind default |
| `color` | item | Palette name or `#rrggbb` | None |
| `collapsed` | item | `true` | Absent means expanded. `false` is not stored |
| `fontSize` | card, text | Integer 10–48 | Card default 14 is omitted. Text stores every size in range, including 24 |
| `textColor` | card, text | Palette name or `#rrggbb` | None |
| `align` | card, text | `left` `center` `right` `justify` | None |
| `fill` | card, text | Palette name or `#rrggbb` | None |
| `border` | card, text, section | Palette name or `#rrggbb` | None |
| `pinned` | item | `true` | Absent means free |
| `fit` | section | `false` opts out of auto-fit | Absent means fit on |
| `look` | card, text, section | Card `block` `card`. Text `section-note` `sticky`. Section `lane` `calendar` `timer` | Omitted. A note with no look draws as a block. Page, ref, image, and board cards draw as cards |
| `axis` | lane section | `horizontal` `vertical` | Horizontal when the look is `lane` |
| `min` | sticky | `true` | Absent means the sticky is open. Only stored for `look` `sticky` |
| `kids` | card | `true` | Absent means the children badge is off |
| `titleSize` | section | Integer 10–48 | 18 is omitted |
| `titleColor` `titleFill` `areaFill` | section | Palette name or `#rrggbb` | None |
| `shape` | text | `rectangle` `rounded` `ellipse` `diamond` `parallelogram` `cylinder` | None |
| `landmark` | card, text, section | `true` | Absent. `false` is not stored |
| `glyph` | landmark | One or two Unicode characters | Empty means no glyph. Dropped when `landmark` is not true |
| `size` | landmark | `S` `L` | `M` is omitted. Dropped when `landmark` is not true |

`defaults` on the board holds `section`, and that object uses the same section style keys: `titleSize` `titleColor` `titleFill` `areaFill` `border`. Unknown keys inside it are dropped. Title size 18 is omitted there too.

### Edge keys

`normalizeEdge` reads these. The label is the block string, not a prop. Sides are `auto` `top` `right` `bottom` `left`.

| Key | Type and valid values | Default |
|---|---|---|
| `from` `to` | Block uid string | `""` |
| `fromSide` `toSide` | `auto` `top` `right` `bottom` `left` | `auto` |
| `dir` | `one` `two` `none` | `one` |
| `route` | `curve` `straight` `elbow` `around` | `curve`. `around` routes past cards |
| `dash` | `solid` `dashed` `animated` | `solid` |
| `weight` | `1` `2` `3` `4` | `1` |
| `color` | Palette name or `#rrggbb` | None |
| `fromBlock` `toBlock` | Block uid, 1 to 36 of `[A-Za-z0-9_-]` | Omitted. Set when the arrow ends on a block inside a page card |
| `via` | Up to 8 points `{x, y}`, each to 0.1 | Omitted when empty |

A write omits a side, dir, route, dash, or weight that still equals that default.

### Board keys

Read on the board block's plexus. They are not item fields.

| Key | Type and valid values | Default |
|---|---|---|
| `v` | `2` | Absent means a native or not-yet-enhanced diagram |
| `native` | `true` | Absent. Restore native sets it and clears `v` |
| `bg` | `dots` `lines` `cross` `grid` `plain` | The grid setting, else dots |
| `bgColor` | `paper`, a palette name, or `#rrggbb` | The board-tone setting |
| `bgImage` | `https` URL, at most 2000 characters, no spaces or quotes | None. Painted locked, cover, center |
| `lodZoom` | Number from 0.05 to 1.5 | The map-zoom setting, else 0.45 |
| `dock` | `bottom` `left` `top` | The dock-position setting |
| `defaults` | Object. Only `section` is read | None |
| `kanban` | String. `To do`, `Highlight colour`, `Lanes: Status`, or an attribute column name | Absent opens on `To do`. Written only when the user picks a lane mode |
| `highlighterTags` | `true` or `false` once the gear is used | Absent means off. `true` stores a colour as a `#bg-` tag in the block string and clears `fill` |

`fold` is not a plexus key. Folding a card writes `collapsed`. Collapsing the board's outline writes `:block/open` false, and the device remembers that in `localStorage` under `plexus-diagram:collapsed:`.

### Regions, views, trails, snapshots

Region strings match Roam Plexus. The container is `{{[[plexus-regions]]}}`.

| Kind | Fields after `:` | After `}}` |
|---|---|---|
| `k=img` | `d` image uid, `f` four fractions `rx,ry,rw,rh` | Caption |
| `k=view` | `d` board uid, `v` four numbers `x,y,w,h`, optional `ids` up to 24 | Caption |
| `{{[[plexus-pin]]: …}}` | `d` PDF block uid, `pg` page (1-based), `f` four fractions. No `k=`. Under `{{[[plexus-pins]]}}`. The old `{{[[plexus-region]]: k=pdf …}}` form still reads | Quote |

Roam Plexus kinds `area` `rect` `group` `frame` `cframe` `poly` `imgrect` `imgpoly` parse and stay unsupported here. Rename rewrites the caption only. Delete deletes the block.

A trail's stops are `((uid))` children in block order. A snapshot's `json` is `{ "items": [ { uid, x, y, w, h, color, collapsed, parent } ] }`. The board lists all of them and restore offers the 10 newest. `json` is not an item or board key.

Kanban and table use the same blocks. Table filter, sort, and a column name with no filled cell stay in the overlay. Filling a cell writes one attribute child. Kanban lane mode is the only view state in props.

## 2. Where it is stored

| Fact | Where |
|---|---|
| Layout, style, board chrome, kanban mode, highlighter flag, landmark, container `type`, snapshot `json` | `:block/props` `plexus` |
| Titles, edge labels, macros, trail names, region captions, task markers, highlight text and `#h/` colour | Block string |
| Board outline folded, card open | `:block/open` |
| Camera, sketch, panel width, sidebar mode, read-pane width, fullscreen tabs, mind-map preset, enhanced-uid cache, collapse-once flag, migration flag | `localStorage` keys prefixed `plexus-diagram:` |
| Open counts for the strength lens, and only while track-opens is on | `localStorage` `plexus-diagram:opens:` |
| Tag lens, dust lens, strength score, timeline rows, source chip, table mode, gallery, graph, present, focus | Not stored. Computed on read |
| `:diagram/*`, `:pdf-*`, `BT_attr*` | Never written by Plexus |

The source chip is the page title plus an `Author::` child, and only for `Articles/` and `Media Captures/` pages. The timeline is a query of daily pages that mention cards on the board. Lenses dim cards in memory.

## 3. Macros

Plexus decorates these. The button class is Roam's component button. The mount class is what Plexus adds.

| Macro | What Plexus does | Button or host class |
|---|---|---|
| `{{[[diagram]]}}` | Mounts the board over Roam's diagram | `.rm-diagram`, mount `.pxd-root` |
| `{{[[pdf]]}}` | PDF card. The reader is Roam's | `.rm-pdf-container` inside `.pxd-read` or the card |
| `{{[[excalidraw]]}}` | Drawing card. The scene is Roam Plexus | `.excalidraw`, `img.rm-inline-img--excalidraw` |
| `{{[[query]]}}` | Query card stays a live `renderBlock` | No component button of ours |
| `{{[[plexus-trail]]}}` | Hides the button and inserts a stop strip | `button.rm-xparser-default-plexus-trail`, strip `.pxd-trail-strip`, `data-plexus-owner="trail"` |
| `{{[[plexus-resurface]]}}` | Panel of cards from a week, a month, or a year ago | `button.rm-xparser-default-plexus-resurface`, `data-pxd-resurface="1"` |
| `{{[[plexus-region]]}}` | Crop or view map in place of the button | `button.rm-xparser-default-plexus-region`, `.pxd-region-crop`, `.pxd-region-view`, `data-plexus-owner="plexus-diagram"` |
| `{{[[plexus-pin]]}}` | PDF source pin quote and crop in place of the button | `button.rm-xparser-default-plexus-pin`, `.pxd-pdf-pin`, `data-plexus-owner="plexus-diagram"` |

`{{[[plexus-regions]]}}` and `{{[[plexus-pins]]}}` are container strings. They are not given a button; Plexus hides their rows in the reading pane and in page cards. `{{[[TODO]]}}` and `{{[[DONE]]}}` are task markers, not decorated components. `{{[[embed]]}}` is how Roam nests a copy. Plexus does not claim it.

## 4. Surfaces

| Surface | What it does |
|---|---|
| Rail | Zoom in, zoom out, fit, minimap, Save PNG, outline in the sidebar, Edit Block, Maximize, zoom percent, version badge |
| Properties | Title size, colour, fill, align, border, area fill, section defaults, board background |
| Toolbar | Breadcrumbs, tools, Add, Info, links, Find, More, selection context bar |
| Dock | Select, Hand, Card, Text, Sticky, Shape, Section, Board, Connect. A board can set `dock` |
| Panel | Search, related, boards, outline, journal, info, trails |
| Read pane | Roam's PDF reader beside the board. Width is `localStorage` |
| Kanban, table, gallery, timeline, graph | Same blocks. Gallery, timeline, and graph write nothing |
| Shortcut sheet | `?` lists `src/view/shortcuts.js` |
| Changelog | The version badge shows the bundled entry for the running version |

## 5. Native parity

Same controls as the 2.0 spec. That live check was 2026-10-01 on block `vc8Skaj5K`. This file does not repeat it.

| Native control | Plexus |
|---|---|
| Edit Block | Opens the diagram string. Esc returns |
| Maximize | Full screen. Esc leaves. Fullscreen can hold up to 9 board tabs on this device |
| Zoom in, zoom out, fit view | Rail and the shortcut table |
| Toggle Minimap | Rail. A drag on the map pans |
| Save PNG | Rail |
| Open outline in sidebar | Sidebar block shows the canvas |
| Properties | Text size, colour, align, fill, border, edge direction, decoration, type, colour, section title and area, diagram background |
| Hover toolbar | Colour, Expand, References |
| Cards | Plain blocks. Embeds render |
| Delete, marquee, Cmd-click, Cmd-A, arrow nudge | Match native |

## 6. Public API

`window.PlexusDiagram` comes from `src/model/public-api.js`. `apiVersion` is `1`. The object is frozen. Install fires `plexus-diagram:ready`. Unload deletes the global only when it is still ours, and always fires `plexus-diagram:unload`.

| Member | Meaning |
|---|---|
| `apiVersion` | `1` |
| `version` | Package version string |
| `isAvailable` | True when the host can name the graph |
| `boardsOn(pageUid)` | Enhanced boards on that page |
| `boardsWith(targetUid)` | Enhanced boards that reference that block. `plexus.v` must be 2 |
| `cardsOf(boardUid)` | Cards with uid, kind, title, rect, parent |
| `regionsOf(ownerUid)` | Regions on that owner |
| `viewsOf(boardUid)` | Saved `k=view` rows |
| `thumbnail(boardUid, opts)` | Width at most `opts.maxWidth`, default 160. Never doubled |
| `open(boardUid, opts)` | Opens the board |
| `addCard(boardUid, opts)` | The only write. `opts.ref` is one `[[page]]` or one `((uid))`. The board must be `v` 2 |
| `addEventListener` / `removeEventListener` | `change`, `mount`, `unmount` |
| `spec` | `{ apiVersion, events, methods }` |
| `help` | One line naming apiVersion 1 and the three listener names |

`window.__plexusDiagram` stays the debug handle. It is not this API.

## 7. Interop

| Global | What this repo requires |
|---|---|
| `window.RoamPlexus` | `apiVersion` at least 6 for a region-ref card and for a drawing thumbnail. `create` and `open` are called when they are functions, with no version check in those call sites |
| `window.RoamCompass` | `open` as a function. This repo does not check `apiVersion`. `detect.js` also reads `__ROAM_COMPASS_VERSION` |
| `window.RoamTaskStatusTags` | `apiVersion` exactly 1, and `statuses` as a function. Status writes go through `setStatus`. Plexus does not write the tag |
| `RoamExtensionTools["better-tasks"]` | The tools object. No `apiVersion` in this repo. Off unless the `better-tasks` setting is on. Plexus does not write `BT_attr*` |

Ready and unload events this repo listens for: `roam-plexus:ready`, `roam-plexus:unload`, `roam-compass:ready`, `roam-compass:unload`, `roam-task-status-tags:ready`, `roam-task-status-tags:unload`. Better Tasks has no such pair here.

## 8. Heptabase gap

| Heptabase | 3.0 | The Roam twist |
|---|---|---|
| PDF on the board | PDF card, highlight card, page chips, read pane, drag a highlight out | No `:pdf-*` writes. Roam's reader stays canonical |
| Regions and views | Image region and saved view, shared region grammar | `((uid))` works in the outline. Roam Plexus kinds parse and stay unsupported |
| Trails | Named path, stops, walk | A trail is a block under `Trails` |
| Journal | Journal tab lists a daily page. A drop makes a card | Stepping the date writes nothing |
| Tabs | Up to 9 boards in fullscreen | `localStorage` only |
| Touch | Pinch zoom, two-finger pan, long-press menu, coarse grips | `disable-on-mobile` still keeps Plexus off when Roam says the platform is mobile |
| Whiteboard backgrounds | Pattern, tone, and an https image per board | Board props |
| Sections, lanes, calendar, timer | Section looks `lane` `calendar` `timer` | One props write when a section grows |
| Sub-whiteboard | Mini map from child blocks. A board ref opens it | A `((ref))` to a board |
| Menus, duplicate, paste, fold, tidy, pin | Same session methods as the keys | Bulk create stops at 45 |
| Focus, present, quick look | Read-only | Roam renders quick look |
| Mind map | Up to 24 branches. Preset is per device | Children stay canonical |
| Sticky and shapes | `look` `sticky`, or a `shape` on text | Text blocks |
| Table and kanban | Toolbar modes | Kanban mode is `kanban`. Table mode is not stored |
| Snapshots | Up to 10 layout copies offered for restore | `type` `snapshot` and a JSON string |
| Waypoints | `via`, up to 8 | One props write |
| Query, tasks, lenses | Query card, TODO card, tag lens, strength, dust | Scores and the tag lens are not stored |
| Source chip | Title and author on a reading-page card | Computed. Author is not copied into props |
| Gallery, timeline, graph | Read-only overlays | Not a second store |
| Resurface | Macro on a daily page | Read-only panel |

Still missing, from this tree:

| Gap | Why it is still open |
|---|---|
| Phone layout | `disable-on-mobile` unmounts when `platform.isMobile` is true |
| Tabs outside fullscreen, or tabs in the graph | The list is `localStorage`, fullscreen only |
| Polygon regions on an image | Only the fraction rectangle is written |
| A second live PDF reader | One read pane |
| Editing a highlight's quote from the card | That string belongs to Roam's reader |
| Cross-graph presence | No such code |
| A separate card library | The Add panel, the Boards tab, and Roam search are the library |
| Writing into the daily page from Journal | The drop writes a card on the board |

## 9. Limits

| Limit | Value |
|---|---|
| Roam undo | 50 changes. One gesture stays inside that |
| Bulk create and other bulk writes | 45 |
| Mind map | 24 branches |
| View `ids` and a selection view | 24 |
| Snapshots offered for restore | 10 newest |
| Edge waypoints | 8 |
| Landmark glyph | 2 characters |
| Fullscreen tabs | 9 |
| Resurface rows | 6 |
| Trail strip | 8 stops |
| Query results placed as cards | 45 |
| Font size | 10–48 |
| `lodZoom` | 0.05–1.5 |
| Board image URL | 2000 characters, `https` only |
| Typing budget | At most +0.1 ms/key with the extension loaded. Measured gates are still over that on some pages |

## 10. Non-goals

No network. No store besides Roam blocks, Roam props, and the `localStorage` cache in section 2. No `:diagram/*` writes, no `:pdf-*` writes, and no `BT_attr*` writes by product code. No write on open, pan, zoom, or select. No AI features. The command palette keeps exactly two Plexus entries. No runtime dependencies. Theme comes from `bp3-dark` or measured luminance, not `prefers-color-scheme`.
