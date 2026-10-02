# Plexus Diagram

A Heptabase-style whiteboard for Roam `{{[[diagram]]}}` blocks. Cards, colored sections, and connections on an infinite canvas, where every object is a real Roam block: sections are parent blocks of their cards, connections are blocks that link both ends, and relationships already in your graph show up as arrows.

**Developer extension URL:** https://svyk.github.io/plexus-diagram

## Start a board

- **Plexus: New whiteboard here** (palette or slash) creates `{{[[diagram]]:Untitled board}}` under the focused block and opens it.
- **Plexus: Commands…** (palette) lists every action and keeps the block that was focused: Enhance, Restore, Fullscreen, Export board as SVG, and Copy board as text. Slash still runs each action by its **Plexus:** name.
- **Plexus: Enhance this diagram** turns an existing native diagram into a board. Native node positions, groups (become sections), and edges (become connections) are imported. Native diagrams you never enhance are never touched.
- **Plexus: Restore native diagram** gives the block back to Roam's React Flow view. Content is not deleted.
- Opening a board's block page (zoomed in) shows it full screen. **Plexus: Fullscreen this diagram** does the same from anywhere.

Boards enhanced with 0.6 upgrade to the 1.0 format once, the first time they are opened.

## 1.3 native parity

An enhanced board keeps Roam's diagram controls and adds to them.

- The right rail is zoom in, zoom out, fit view, Toggle Minimap, Save PNG, Open outline in sidebar, Edit Block, then Maximize.
- Edit Block opens the diagram block's text. Esc returns to the board.
- The Properties panel edits text, fill, border, edges, sections, and the background.
- A note card is a plain block. Hover shows Color, Expand, and References.

## Surfaces

![The fixture board in the light theme](docs/img/board-light.png)

![The same board with the dark token set](docs/img/board-dark.png)

- **Rail.** The vertical stack on the right (Settings can switch it to a horizontal bar): zoom in, zoom out, fit view, Toggle Minimap, Save PNG, Open outline in sidebar, Edit Block, Maximize, the zoom percent, and the version badge. The badge opens this version's changelog from the bundle. No network.
- **Properties.** The panel on the canvas. It edits the selection: title size, title color, title fill, area fill, and border. Reset default clears that selection's overrides. Background, on the board, sets this board's pattern and tone.
- **Toolbar.** The top row: breadcrumbs, the tools, Add, Info, graph links, Find, and More. A selection shows a context bar: colors, align, distribute, and, for a connection, direction, route, dash, weight, and label.
- **Panel.** Add opens the side panel. Search finds pages and blocks. Related lists what the selected card links to and what links to it. Info (also the I key) shows the card or the board. The outline in the sidebar is the same canvas, not a second copy of the bullets.
- **Palette.** The floating bar along the bottom, above the minimap. Select (V), Hand (H), Card (N), Text (T), Sticky (S), Shape (R), Section (G), Board (W), Connect (C). Hide it with Show tool palette.

![The tool palette above the minimap](docs/img/palette.png)

## Using the board

| Do | How |
|---|---|
| Pan | Trackpad scroll, Space + drag, middle-drag, or the Hand tool (H) |
| Zoom | Pinch or Ctrl/Cmd + scroll, `−` / `+`, click the % to reset, Shift+1 fit all, Shift+2 fit selection |
| Select | Click; Shift-click to add; drag on empty board for a selection box; Cmd+A |
| New card | Double-click empty board, or N. Type right away; an empty new card disappears when you click away |
| Edit a card | Double-click or Enter. Roam's own editor opens in the card (page cards open the whole page). Esc to finish |
| Open | Click a `[[link]]` in a card to go there (Shift-click: sidebar). Context bar: Open in sidebar |
| Move / resize | Drag a card (from anywhere, links included); drag the right edge, bottom edge, or corner. Alignment guides snap to neighbours |
| Section | G, then drag (or click for a default size). Cmd+G wraps the selection. Drop cards in and out of sections. A section grows to contain a card moved or resized past its edge (24 px padding, cascading through nested sections); Fit to contents shrinks it, and Auto-fit in the menu turns it off for one section |
| Connect | Drag from a card's port (the dots on its edges) to another card or section. Drop on empty board to create a new linked card. C turns the whole card into a handle |
| Text | T for a free heading on the board (16/24/32/48) |
| Nested board | W, then click or drag; or select cards → **Move into new board**. Double-click a board card to go inside; the breadcrumb (`Parent › Child`) and Esc take you back up. Drag a card onto a board card to move it in |
| Drag from Roam | Drag any bullet from the outline or sidebar onto the board to add it as a `((ref))` card |
| Right-click menu | Right-click empty board, a card, section, text, connection, or a multi-selection. The board menu (toolbar More) has export, fold all, journals, background |
| Duplicate | Alt+drag (Alt+Shift+drag makes `((ref))` cards) or Cmd+D |
| Copy / paste | Cmd+C, Cmd+V paste as `((ref))` cards, Cmd+Shift+V as copies (also from another board); pasted text becomes cards (bulk adds stop at 45 cards, so Roam's 50-change undo can reach them); pasted images upload and become cards |
| Move by keyboard | Arrows nudge the selection 1 px (Shift+Arrow 10 px); Alt+Arrow selects the nearest card in that direction (Alt+Shift+Arrow adds); Tab and Shift+Tab step through the outline order |
| Fold | Cmd/Ctrl+Alt+Enter folds or unfolds the selected cards |
| Pin | Pin (context bar or menu) locks a card, section, or text in place |
| Focus | F fades everything except the selection and its connections; Esc leaves |
| Quick look | Q shows the selected card and its children in an overlay |
| Present | P steps through the sections in outline order (arrows or Space, Esc to exit) |
| Mind map | M (Expand outline) on one note, block, or page card lays its children out as a mind map, up to 24 branches. The card menu has the same action |
| Background | The Background button picks a pattern (dots, lines, grid, plain) and a tone for this board; Use as default saves it for every board |
| Delete | Delete/Backspace. The toast offers Undo; Cmd+Z / Shift+Cmd+Z are Roam's own undo and redo |
| Search | `/` filters the board and steps through matches |
| Add | The Add panel searches pages and blocks, and its Related tab lists what the selected card links to and is linked from |

The context bar above a selection has 10 colors for cards, sections, text, and connections; connection direction (→ ↔ —), flip, route (curve, straight, elbow), dashed line, weight, label, and notes.

## What it means in Roam

| On the board | In the graph |
|---|---|
| Card | A child block of the board: a note (its own text and children), a `[[page]]`, a `((block))`, an image, or a nested `{{[[diagram]]:Title}}` board (its own cards are its children) |
| Section | A block whose children are its cards. Title it `[[Root cause]]` and the section, with its cards, appears in Root cause's linked references |
| Connection | A block under the board's collapsed **Connections** child, reading `[[Seal failure]] → causes → [[Leak]]`. Both ends get a backlink. Its children are notes on the connection |
| Graph links (dashed) | Existing references and attributes between cards on the board, drawn automatically and colored by relation. Toggle with **Links** (Off / Attributes / All) or L |
| Write to graph | On a labelled connection, writes the attribute to the source: `causes:: [[Leak]]` on page Seal failure (a child of the block for block cards). Existing blocks are never rewritten |
| Layout | Position, size, and color live in each block's hidden properties (`:block/props`), so they move with the block and undo with Roam's undo |
| Background | A board's pattern and tone are `bg` and `bgColor` in the board block's properties; without them the board uses the default from Settings |
| Pinned, fit | `pinned` on an item locks it; `fit:false` on a section opts it out of auto-fit. Both are properties on the block |
| Badges | The small counts on a card (references, boards, open and done TODOs) are read from Roam and never written |
| Pan and zoom | Stored per device in local storage. Opening, panning, and zooming write nothing to the graph |

## Shortcuts

`?` opens this same list on the board. ⌘ means Command on a Mac and Ctrl elsewhere. Present keys apply only while a presentation is running.

| Group | Keys | Action |
|---|---|---|
| Tools | V | Select |
| Tools | H | Hand |
| Tools | N | Card |
| Tools | T | Text |
| Tools | S | Sticky |
| Tools | R | Shape |
| Tools | G | Section |
| Tools | W | Board |
| Tools | C | Connect |
| Edit | Enter | Edit, open, or rename |
| Edit | F2 | Rename page |
| Edit | ⌘D | Duplicate |
| Edit | Delete | Delete |
| Edit | Shift+Delete | Delete with contents |
| Edit | ⌘Z | Undo |
| Edit | ⌘⇧Z | Redo |
| Edit | ⌘⌥Enter | Fold selection |
| Edit | ⌘G | Wrap in a section |
| Select | ⌘A | Select all |
| Select | Tab | Next in outline |
| Select | Shift+Tab | Previous in outline |
| Select | ⌥+arrows | Select nearest |
| Select | Shift+⌥+arrows | Add nearest |
| Select | Shift+F10 | Card menu |
| Select | M | Expand outline |
| View | Space | Hold to pan |
| View | ⌘+ | Zoom in |
| View | ⌘- | Zoom out |
| View | ⇧0 | Zoom to 100% |
| View | ⇧1 | Fit all |
| View | ⇧2 | Fit selection |
| View | Arrows | Nudge 1 px |
| View | Shift+arrows | Nudge 10 px |
| View | L | Cycle links |
| View | / or ⌘F | Find on board |
| View | I | Info |
| View | F | Focus |
| View | Q | Quick Look |
| View | P | Present |
| View | ? | Shortcuts |
| View | Escape | Close or step back |
| Navigate | ⌘[ | Back |
| Navigate | ⌘] | Forward |
| Present | → ↓ Space | Next |
| Present | ← ↑ | Previous |

## Limits

- Roam's undo stack holds 50 changes. A move of many cards, an align, a distribute, a paste, a mind map, and a template insert are each one undo step.
- A bulk add creates at most 45 cards, so that undo can still reach them.
- A mind map adds at most 24 branches.

## Settings

Settings → Extensions → Plexus Diagram. Each change applies on the open board. **Reset Plexus settings** puts every value back to its default.

| Group | Setting | What it does |
|---|---|---|
| Cards | Default card look | New note cards. Block is a plain Roam block. Card keeps a title row. |
| Cards | Default card width | Width of a new card, in pixels. |
| Cards | Default card height | Height of a new card, in pixels. |
| Cards | Show card badges | Show how many references, tasks, and children a card has. |
| Cards | Space out cards | After a move, push cards apart when they overlap. |
| Sections | Auto-fit sections | Grow a section when a card is moved or resized past its edge. |
| Connections | Graph links | Show lines between cards that share a page reference or an attribute. All, attributes, or off. |
| Connections | Attribute styles | One JSON object. Each attribute name gets a palette color and a line: solid, dashed, or dotted. |
| Board | Enabled | Turn the diagram overlay on or off. |
| Board | Fullscreen on zoom | Open a diagram full screen when you zoom into its block. Esc leaves it. |
| Board | Mouse wheel | Pan or zoom. Pinch still zooms. |
| Board | Show minimap | Show the small map of the whole board. |
| Board | Show tool palette | Show the tool palette along the bottom of the board. |
| Board | Controls | Rail is the vertical stack on the right. Bar is the horizontal zoom group. |
| Board | Snap guides | Line a dragged card up with its neighbours and show the guides. |
| Board | Snap to grid | Snap a dragged card to the 24 pixel grid. Hold Alt while dragging to skip snapping. |
| Board | Default board background: pattern | Dots, lines, grid, or plain, for boards that do not set their own. |
| Board | Default board background: tone | Color wash for boards that do not set their own. |
| Board | Map view below (zoom) | Below 0.3, 0.45, or 0.6, cards show only their title. |
| Board | Enable shortcuts | Use keyboard shortcuts on the board. |
| Board | Show version badge | Show the version on the board. |
| Performance | Motion | Full, reduced, or none. A system reduced-motion setting shortens Full. |
| Performance | Disable on mobile | Do not open diagrams on a phone. |
| Performance | Collapse the outline | Fold an enhanced board once, so the outline does not list every card. Opening the bullet is remembered. |

## Privacy

No network requests. All reads and writes go through Roam's extension API on your graph.

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Design: `docs/spec-plexus-1.0.md` and `docs/spec-plexus-1.2.md`. Module contracts: `docs/api-plexus-1.0.md`. Commit `src/` with the generated root `extension.js` / `extension.css` and `deploy/`.

## Install

Roam: **Settings → Roam Depot → Developer extensions → Load extension → URL** → `https://svyk.github.io/plexus-diagram`.

To update, remove that URL and add it again. The page serves the latest build from `main`. An open tab keeps the old bundle until you do that.

## License

[MIT](LICENSE)
