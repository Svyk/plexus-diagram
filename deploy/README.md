# Plexus Diagram

A Heptabase-style whiteboard for Roam `{{[[diagram]]}}` blocks. Cards, colored sections, and connections on an infinite canvas, where every object is a real Roam block: sections are parent blocks of their cards, connections are blocks that link both ends, and relationships already in your graph show up as arrows.

**Developer extension URL:** https://svyk.github.io/plexus-diagram

## Start a board

- **Plexus: New whiteboard here** (palette or slash) creates `{{[[diagram]]:Untitled board}}` under the focused block and opens it.
- **Plexus: Enhance this diagram** turns an existing native diagram into a board. Native node positions, groups (become sections), and edges (become connections) are imported. Native diagrams you never enhance are never touched.
- **Plexus: Restore native diagram** gives the block back to Roam's React Flow view. Content is not deleted.
- Opening a board's block page (zoomed in) shows it full screen. **Plexus: Fullscreen this diagram** does the same from anywhere.

Palette and slash commands also include **Plexus: Export board as SVG** and **Plexus: Copy board as text**.

Boards enhanced with 0.6 upgrade to the 1.0 format once, the first time they are opened.

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
| Copy / paste | Cmd+C, Cmd+V paste as `((ref))` cards, Cmd+Shift+V as copies (also from another board); pasted text becomes cards; pasted images upload and become cards |
| Move by keyboard | Arrows nudge the selection 1 px (Shift+Arrow 10 px); Alt+Arrow selects the nearest card in that direction (Alt+Shift+Arrow adds); Tab and Shift+Tab step through the outline order |
| Fold | Cmd/Ctrl+Alt+Enter folds or unfolds the selected cards |
| Pin | Pin (context bar or menu) locks a card, section, or text in place |
| Focus | F fades everything except the selection and its connections; Esc leaves |
| Quick look | Q shows the selected card and its children in an overlay |
| Present | P steps through the sections in outline order (arrows or Space, Esc to exit) |
| Mind map | M on a note, block, or page card turns its child blocks into `((ref))` cards with connections |
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

## Settings

Settings → Extensions → Plexus Diagram: enabled, fullscreen-on-zoom, graph links default, wheel (pan or zoom), minimap, snap guides, default board background (pattern: dots / lines / grid / plain; tone: none, paper, or a color), map view below (zoom 0.3 / 0.45 / 0.6), auto-fit sections, space out cards, show card badges, default card size, collapse board blocks in the outline (on: the board's cards are not listed again as bullets under an inline board; expand the bullet to see them), keyboard shortcuts, version badge, disable on mobile.

## Privacy

No network requests. All reads and writes go through Roam's extension API on your graph.

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Design: `docs/spec-plexus-1.0.md` and `docs/spec-plexus-1.2.md`. Module contracts: `docs/api-plexus-1.0.md`. Commit `src/` with the generated root `extension.js` / `extension.css` and `deploy/`.

## Install

Roam: **Settings → Roam Depot → Developer extensions → Load extension → URL** → `https://svyk.github.io/plexus-diagram`. To pick up a new version in an open tab, remove that URL entry and add it again.

## License

[MIT](LICENSE)
