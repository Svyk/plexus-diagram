# Plexus Diagram 2.0

The running package is 2.0.0. This file records the model and surfaces as built.

Layout lives in `:block/props` under `plexus`. Reads drop bad values in memory. A write happens when the user edits. Open, pan, and zoom write nothing to the graph.

## 1. Data model

`v` is `2` on an enhanced board and on a nested board card. Restore native removes `v`, `bg`, and `bgColor` from that board. Unknown keys stay on a read-merge-write.

| Key | On | Valid | Dropped when |
|---|---|---|---|
| `v` | board, nested board card | `2` | any other value |
| `type` | item, edge, container | `card` `section` `text` `edge` `edges` `snapshots` `snapshot` | missing item type becomes `card` |
| `x` `y` `w` `h` | item | finite numbers, stored to 0.1 | not a finite number |
| `color` | item, edge | palette name or `#rrggbb` | anything else |
| `collapsed` | item | `true` | `false` is not stored |
| `fontSize` | card, text | integer 10–48 | section, or out of range; card default 14 is omitted |
| `textColor` `fill` `border` | card or text; `border` also on a section | palette name or `#rrggbb` | anything else |
| `align` | card, text | `left` `center` `right` `justify` | section, or other |
| `titleSize` | section | integer 10–48 | default 18 is omitted |
| `titleColor` `titleFill` `areaFill` | section | palette name or `#rrggbb` | anything else |
| `pinned` | item | `true` | absent means free |
| `fit` | section | `false` opts out of auto-fit | absent means fit on |
| `look` | card, text, section | card `block` `card`; text `section-note` `sticky`; section `lane` | other |
| `axis` | lane section | `horizontal` `vertical` | not a lane; missing means horizontal |
| `shape` | text | `rectangle` `rounded` `ellipse` `diamond` `parallelogram` `cylinder` | not text |
| `bg` | board | `dots` `lines` `cross` `grid` `plain` | other; else the grid setting |
| `bgColor` | board | `paper`, a palette name, or `#rrggbb` | other; else the tone setting |
| `defaults.section` | board | `titleSize` `titleColor` `titleFill` `areaFill` `border`, same rules as a section | unknown keys |
| `from` `to` | edge | block uid string | missing becomes `""` |
| `fromSide` `toSide` | edge | `auto` `top` `right` `bottom` `left` | other becomes `auto` |
| `dir` | edge | `one` `two` `none` | other becomes `one` |
| `route` | edge | `curve` `straight` `elbow` | other becomes `curve` |
| `dash` | edge | `solid` `dashed` `animated` | other becomes `solid` |
| `weight` | edge | `1` `2` `3` `4` | other becomes `1` |
| `json` | snapshot | string of `{ "items": [ { uid, x, y, w, h, color, collapsed, parent } ] }` | not that shape |

An edge label is the block string, not a prop. The connections parent is the child whose `type` is `edges`. Snapshots sit under the child whose `type` is `snapshots`. A snapshot title is `YYYY-MM-DD HH:MM`. The board keeps 10. Writes stay in chunks of 45.

Palette names are `gray` `red` `orange` `yellow` `green` `teal` `blue` `indigo` `purple` `pink`. Hex is lowercase `#rrggbb` only.

Card kinds come from the block string: one `[[page]]`, a `((uid))`, a `{{[[diagram]]}}`, an image markdown, or a note. A query block is a card titled Query.

## 2. Surfaces

| Surface | What it does |
|---|---|
| Rail | Zoom in, zoom out, fit view, Toggle Minimap, Save PNG, Open outline in sidebar, Edit Block, Maximize, zoom percent, version badge. Settings can put zoom on a bar instead. |
| Properties | Title size, color, fill, align, border, area fill, and the board background. |
| Toolbar | Breadcrumbs, tools, Add, Info, links, Find, More, and the selection context bar. |
| Panel | Search, related refs, info, and the outline. The sidebar outline is the canvas. |
| Palette | Select, Hand, Card, Text, Sticky, Shape, Section, Board, Connect. It sits above the minimap. |
| Shortcut sheet | `?` lists `src/view/shortcuts.js`. That array is the only key list. |
| Changelog | The version badge shows the bundled entry for the running version. |

## 3. Native parity

Same block `vc8Skaj5K`, checked 2026-10-01.

| Native control | Plexus |
|---|---|
| Edit Block | Opens the diagram string. Esc returns. |
| Maximize | Full screen. Esc leaves. |
| Zoom in, zoom out, fit view | Rail buttons and the shortcut table. |
| Toggle Minimap | Rail, and a drag on the map pans. |
| Save PNG | Rail. |
| Open outline in sidebar | Sidebar block shows the canvas. |
| Properties | Text size, color, align, fill, border, edge direction, decoration, type, color, section title and area, diagram background. |
| Hover toolbar | Color, Expand, References. |
| Cards | Plain blocks. Embeds render. |
| Delete, marquee, Cmd-click, Cmd-A, arrow nudge | Match native. |

## 4. Heptabase gap

| Heptabase | 2.0 | The Roam twist |
|---|---|---|
| Whiteboard backgrounds | Pattern and tone per board | Board props. Use as default writes the two settings. |
| Sections auto-fit | Grow-only, 24 px, opt out with `fit:false` | One props write per grown section. |
| Sub-whiteboard thumbnails | Mini map from child blocks | A `((ref))` to a board opens it. |
| Right-click menus | Canvas, card, section, text, connection, multi-select | Same session methods as the keys. |
| Duplicate and paste | Alt-drag, ⌘D, paste as ref or copy | Bulk create stops at 45. |
| Fold | ⌘⌥Enter, and fold-all in the menu | `collapsed: true`. |
| Tidy, align, same size | Row, column, grid, outline order | One undo step. Writes `x` `y` `w` `h` only. |
| Pin | Context bar or menu | `pinned: true`. |
| Focus | F | Read-only. |
| Presentation | P, then arrows or Space | Read-only. |
| Quick look | Q | Roam renders it. Unmounted on close. |
| Mind map | M, Expand outline, up to 24 branches | Children stay canonical. Cards are refs. |
| Tool palette | Nine tools, bottom center | Hide with Show tool palette. |
| Sticky and shapes | S and R | `look: sticky` or a `shape` on text. |
| Swimlanes | Section look `lane` | `axis` horizontal or vertical. |
| Table and kanban | Toolbar modes | The same blocks. A move is one undo. |
| Snap | Guides, and a 24 px grid when the setting is on | Alt while dragging skips both. |
| Templates | Board templates from the menu | Insert chunk is one undo, capped at 45 creates. |
| Snapshots | Up to 10 layout copies | `type: snapshot` and a JSON string. |
| Query cards | A Roam query renders on a card | Read-only. |
| Linked references | Drawer on a card | Read-only. |
| Attribute lines | Setting and `L` | Styles are one JSON object in settings, not a block write. |
| Tasks | TODO toggle, due chip | No `BT_attr*` writes. |
| Motion | full, reduced, none | Honors `prefers-reduced-motion` under Full. |
| Light and dark | Tokens on the board root | Host theme is not rewritten. |
| Gallery, calendar, timeline, force graph | Not built | Listed under Later in the roadmap. |
| Manual waypoints, image background | Not built | Same. |
| PDF | pdf card, highlight card, page chips | No `:pdf-*` writes. Roam's reader stays canonical. |

## 5. Limits

| Limit | Value |
|---|---|
| Roam undo | 50 changes |
| Bulk create | 45 cards |
| Mind map | 24 branches |
| Snapshots kept | 10 |
| Typing budget | at most +0.1 ms/key with the extension loaded. Measured gates are still over that. |
| 300-card open | Still over 400 ms. Pan and zoom are still under 60 fps. |

## 6. Non-goals

No network. No store besides Roam blocks and props. No `:diagram/*` writes and no `BT_attr*` writes by product code. No write on open, pan, or zoom. No AI features. No Depot pull request until you ask. No version tag while a phase gate is blocked.

## 7. Region grammar

Same strings Roam Plexus 0.33.0 parses and leaves alone (`docs/spec-plexus.md` section 8, `apiVersion` 7). The container is `{{[[plexus-regions]]}}`.

| Kind | After `}}` | Fields |
|---|---|---|
| `k=img` | caption | `d` image uid, `f` four fractions `rx,ry,rw,rh` |
| `k=view` | caption | `d` board uid, `v` four numbers `x,y,w,h`, optional `ids` up to 24 |

Rename rewrites only the caption. Delete deletes the block and does not edit other blocks. A count of incoming `:block/refs` is `[[n]]` from `data.fast.q`.
