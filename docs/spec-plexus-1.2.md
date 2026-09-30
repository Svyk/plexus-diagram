# Plexus Diagram 1.2 spec

Status: shipped 2026-09-29 on top of 1.1.0. The 1.0 spec (`spec-plexus-1.0.md`) still holds; this file lists what 1.2 adds. Module contracts are in `api-plexus-1.0.md`, section "1.2 additions".

## 1. Goals

1. Fix the four problems reported on 1.1.0 (section 2).
2. Close the most visible Heptabase gaps (section 6) without leaving Roam's model: every new thing is a props key on an existing block, a block Roam already has, or read-only chrome.
3. Keep the 1.0 invariants: opening, panning and zooming write nothing; one props write per moved item; no runtime dependencies; no `setPointerCapture`; keyboard in the window capture phase.

## 2. The four reported issues

| Report (screen recording, 2026-09-29) | Cause | Fix |
|---|---|---|
| Zoomed out, a `((ref))` card printed its whole text in huge bold and ran far below its box; the LOD class only changed when the gesture ended | Map font applied to the whole header with `white-space: normal` and no clip; tier decided at settle only | Map and overview are title-only tiles: 3-line clamp, font capped by the tile height, no overflow. Ref titles are cut at 120 characters and header text at 160. The tier is recomputed while zooming with hysteresis (`lodTier`), and only a class toggle happens on crossing, never per-frame style work. A third tier, overview, shows section titles only. |
| A nested board card showed a large empty white box with teal bars | The single child's rect filled 100% of the preview bounds | `boardPreview` v2: padded frame (at least 560x320, 12% pad), mini cards with border, fill and title, sections as tinted frames, connections as one SVG, and an "Empty board" state |
| A card inside a section stuck out past its bottom edge | Sections never resized | Auto-fit (section 4) |
| "Different backgrounds like Heptabase" | Only dots, lines and plain, one global setting | Per-board pattern (dots, lines, grid, plain) and tone (paper or one of ten palette tints), stored in the board's props |

## 3. Data model additions

All under `props.plexus`, read-merge-write, unknown keys preserved.

| key | on | values | default |
|---|---|---|---|
| `bg` | board block or nested board card | `dots` `lines` `grid` `plain` | the `grid` setting |
| `bgColor` | board | `paper`, `gray` `red` `orange` `yellow` `green` `teal` `blue` `indigo` `purple` `pink` | the `board-tone` setting |
| `pinned` | any item | `true` | absent |
| `fit` | section | `false` (opt out of auto-fit) | absent (fit on) |

Restore native diagram removes `v`, `bg` and `bgColor` from the board props; a nested card keeps its layout keys. Nothing else in the graph changes shape: duplicates, pastes and clones are ordinary blocks, and badges, quick look, presentation, focus and the boards library are read-only.

## 4. Behavior rules

- **Auto-fit is grow-only.** After a move, resize, create, tidy or paste, every section on the path from the touched item to the root grows to contain the item plus 24 px (`FIT_PAD`). A grown section counts as touched for its own parent, so nesting cascades. It never shrinks on its own; **Fit to contents** shrinks on demand.
- **Live and persisted.** During a drag the section frames grow in the preview (`previewSectionRects`); on drop the whole result is one transaction: one props write per grown section, plus one per direct member of a section whose origin moved (world positions stay put). One undo step.
- **Opt out.** `fit:false` on a section (context menu "Auto-fit", ctx bar toggle) or the setting `auto-fit-sections` off. A section the user just resized is not grown back in the same gesture.
- **Pinned.** A pinned item does not move, resize, tidy, same-size, reset or delete (unless forced). It can still make its section grow.
- **Space out** (`space-out`, default off): after a move, overlapping siblings are pushed apart by `spaceOut` (16 px gap). Sections take part only when a section moved; pinned siblings never move.
- **Backgrounds.** Effective pattern and tone are the board's own values, else the defaults from settings. The Background popover writes the board's props; "Use as default" writes the two settings; Reset removes the board's override.
- **Level of detail.** Detail at or above the map threshold (setting `map-zoom`, 0.3, 0.45 or 0.6), map below it, overview below 0.2. Coming back up needs 1.1x the threshold so the tier does not flicker.
- **Keys.** Plain arrows select the nearest item in that direction (Shift adds); nudging moved to Alt+Arrow (1 px, Alt+Shift 10 px). This is an intentional change from 1.1.

## 5. Settings

Added: `board-tone`, `map-zoom`, `auto-fit-sections`, `space-out`, `show-card-badges`. `grid` also accepts `grid`. Changing any of them updates open boards through `view.setSettings` with no remount.

## 6. Heptabase gap table

| Heptabase | 1.2 | The Roam twist |
|---|---|---|
| Whiteboard backgrounds | Pattern and tone per board, defaults in settings | Stored in the board block's props, so it moves with the block and undoes with Roam |
| Sections auto-fit at the edge | Grow-only cascade, opt-out per section | A section is a parent block; growing is one props write on it |
| Sub-whiteboard thumbnails | Real mini map with titles, sections, connections | Built from the already-pulled child blocks, no extra read |
| Whiteboard shortcut to another whiteboard | A `((ref))` card to a board block renders the thumbnail and opens the board | The card is a normal block reference; it never re-renders the block |
| Right-click menus | Canvas, card, section, text, connection, multi-selection, board menu | Menu items call the same session methods as the keys |
| Alt-drag duplicate, Cmd+D, copy and paste | Duplicate as a real subtree clone or as a ref; paste as refs or copies, also from another board; pasted text and images become cards | Clones are ordinary blocks (children and props kept, `((refs))` inside the subtree rewritten); images upload through `api.file.upload` |
| Arrow selection, Tab | Nearest item by direction; Tab walks the Roam outline order | The outline order is the block order |
| Fold and unfold cards | Cmd+Alt+Enter folds the selection; menu items fold all cards and all cards inside a section | Uses the existing `collapsed` key |
| Tidy, align, same size | Row, column, grid and outline-order tidy; same size; fit height and reset size | Writes x, y, w, h only |
| Pin | Lock an item in place | `pinned:true` on the block |
| Focus mode | F fades everything but the selection and its connections | Presentation-only |
| Presentation | P steps through sections in outline order | Read-only; nothing is written |
| Quick look | Q shows a card and its children in an overlay | Rendered by Roam, unmounted on close |
| Mind map from an outline | M turns a note, block or page card's children into ref cards plus connections, laid out right, down or balanced | The blocks stay canonical in Roam; cards are refs |
| Card library / search | Boards tab lists every board in the graph; Outline tab lists sections | `host.listBoards` reads enhanced board blocks only |
| Journal cards | "Add today's journal" and "Add this week's journals" | The card is a `[[September 29th, 2026]]` page card |
| Tags and card stats | Read-only badges: references, boards, open and done TODOs | Counted from Roam's own refs, at most four queries per batch |
| Export | SVG and text outline | Standalone SVG, Markdown outline |

## 7. Deferrals

- Editing card tags or properties on the board: Roam attributes and tags already do this in the block itself.
- A separate card library store: the Add panel, the Boards tab and Roam search cover it.
- Live thumbnails for boards in other pages beyond the shortcut card (no polling; a board opens to refresh).
- Cross-graph and multi-user presence.
- A per-board default zoom threshold (the map threshold is a global setting).

## 8. Non-goals

AI agent features, SuperTag-style typed schemas, storing anything outside Roam blocks and props, network requests, and any write on open, pan or zoom.

## 9. Verification

Unit tests for every new module (`layout`, `clipboard`, `export`, `session-fit`, `session-clip`, `cards-12`, `chrome-12`, `menu`, `panel-12`, `overlays`, `view-12`, `build-css`) plus the updated 1.0/1.1 suites. The host still has to check live on Roam Desktop: `api.file.upload`, Datascript for `cardStats`, `:edit/time` in `listBoards`, the grid background at every zoom, and the Escape and Tab keys with Roam's own shortcuts.
