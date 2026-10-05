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
- **Board bar.** The top row: breadcrumbs, Add, Info, graph links, Find, and More. The last breadcrumb and the bar's bottom edge take the board's own color. More holds export, templates, snapshots, background, dock position and a Views submenu (Gallery, Timeline, Graph); the same Views submenu is in the canvas right-click menu. Hovering any control shows a tooltip with its name, shortcut and a one-line description (Settings, Hover tooltips and Tooltip delay). A selection shows a context bar: colors, align, distribute, and, for a connection, direction, route, dash, weight, and label. Toolbar layout in Settings: Split (default, tools in the dock), Classic (tools in the top bar, as in 2.1), or Dock only (the bar appears when the pointer is near the top edge).
- **Panel.** Add opens the side panel, to the left of the rail. Search finds pages and blocks. Related lists what the selected card links to and what links to it. Info (also the I key) shows the card or the board. Boards lists saved views: a small map, Go, Copy ref, Rename, and Delete. Go restores the camera and writes nothing. The outline in the sidebar is the same canvas, not a second copy of the bullets.
- **Tool dock.** The floating bar along the bottom, above the minimap: Select (V), Hand (H), Card (N), Text (T), Sticky (S), Shape (R), Section (G), Board (W), Connect (C). The active tool has a sliding highlight; double-click a tool to lock it (padlock). With Card, Sticky, Section or Shape active the dock shows that tool's options: with nothing selected a color, look or shape sets the next item you create (kept in memory only); with a selection it restyles the selection. Position, shape, labels and size are in Settings; a board can pick its own position from More, Dock position for this board. Below zoom 0.2 the dock keeps Select, Hand and Board. Hide it with Show tool palette.

![The tool palette above the minimap](docs/img/palette.png)

## Using the board

| Do | How |
|---|---|
| Pan | Trackpad scroll, Space + drag, middle-drag, or the Hand tool (H) |
| Zoom | Pinch or Ctrl/Cmd + scroll, `−` / `+`, click the % to reset, Shift+1 fit all, Shift+2 fit selection |
| Select | Click; Shift-click to add; drag on empty board for a selection box; Cmd+A |
| New card | Double-click empty board, or N. Type right away; an empty new card disappears when you click away |
| Edit a card | Double-click or Enter. Roam's own editor opens in the card (page cards open the whole page). The card keeps its size while you edit, and its arrows stay attached; the editor fills the card and the card grows only if your text is taller. Esc to finish |
| Open | Click a `[[link]]` in a card to go there (Shift-click: sidebar). Context bar: Open in sidebar |
| Move / resize | Drag a card (from anywhere, links included); drag the right edge, bottom edge, or corner. Alignment guides snap to neighbours. The Hand tool resizes too: a press on a grip resizes, anything else pans (Space-drag always pans). Page cards have a wide grip band and a corner above the scrollbar. Grips, connection dots and arrow-end handles keep the same size on screen at every zoom |
| Section | G, then drag (or click for a default size). Cmd+G wraps the selection. Drop cards in and out of sections. A section grows to contain a card moved or resized past its edge (24 px padding, cascading through nested sections); Fit to contents shrinks it, and Auto-fit in the menu turns it off for one section |
| Connect | Drag from a card's port (the dots on its edges) to another card or section. Drop on empty board to create a new linked card. C turns the whole card into a handle |
| Text | T for a free heading on the board (16/24/32/48) |
| Sticky notes | S, then click the board. A sticky is a real Roam block in a coloured note: drag the header bar to move it, click once in the note to type (tags, images, links, refs and the slash menu all work), drag a corner or edge to resize. The header has a colour dot (pick one of ten) and a minimize toggle that folds the note to its header; the choice is saved with the note. Stickies persist: there is no close button, and an empty sticky stays. Delete (or the menu) removes one, and Cmd+Z brings it back |
| Nested board | W, then click or drag; or select cards → **Move into new board**. Double-click a board card to go inside; the breadcrumb (`Parent › Child`) and Esc take you back up. Drag a card onto a board card to move it in |
| Drag from Roam | Drag any bullet from the outline or sidebar onto the board to add it as a `((ref))` card |
| Right-click menu | Right-click empty board, a card, section, text, connection, or a multi-selection. The board menu (toolbar More) has export, fold all, journals, background |
| Page cards | Add page… in the canvas menu searches for a page; dropping a page from the left sidebar does the same. A page card shows the title as a header (click opens the page, Shift-click the sidebar) and the whole outline, scrolling inside the card. Click a row to edit that block. A row that holds a board shows it as a small map with its title and item count (a one-line chip after four, and for the board you are on, "this board"); click opens it, Shift-click opens it in the sidebar. A row Roam cannot render shows its raw text. Roam's right sidebar title, links inside blocks and search results carry no drag data, so they cannot be dropped |
| Arrows to blocks | Drag an arrow end over a page card: the row under the pointer lights up and the arrow connects to that block with a `((ref))` (so it shows in Roam's backlinks); the title connects to the page. The end follows the row when the card scrolls and shows a marker at the edge when the row is out of view (click it to scroll there). Select an arrow to drag its end handles; the arrow menu has Connect to the page instead The arrow continues into the card and its head stops beside the row; the row keeps a mark in the arrow's color. Hover either one and both light up; a row scrolled out of view becomes a pill at the card edge (click it to scroll back). |
| Tasks on the board | The Task tool and Better Tasks start off. Turn them on under Settings, Integrations. A Task tool you already saved stays on. With both off, the dock has no Task button and K does nothing. With them on, K, then click the board, makes a task card: a Roam `{{[[TODO]]}}` block. With Better Tasks loaded, the card shows its checkbox, its title and chips for due date, project, priority, repeat, status, waiting-for and GTD. Click the due, project, priority or repeat chip to change it from a small popover; the change is made by Better Tasks, so Plexus never writes a `BT_attr` block itself, and Cmd+Z after a chip change is Roam's undo, not the board's. Cmd+Z right after K removes the new block in one step. Today's due date gets a teal border, an overdue task a red one, a done task is dimmed and struck through. Tick the checkbox on the card (it is a light checkbox of Plexus's own, so a board of many tasks stays under Better Tasks' 100-checkbox limit) and Better Tasks writes the completed date and, for a repeating task, the next occurrence on its daily or project page; a toast offers Add to board. Zoomed out, a task is a check box of at least 20 screen pixels with its due date. Dragging a task card onto a daily-page card (or a section named for a day) sets that day as its due date, the same attribute block keeps its uid; hold Shift to move the card only. A Kanban drop on Done goes through the same Better Tasks checkbox, so a repeating task also makes its next occurrence. Popovers, the children peek and the card menu open clear of the dock, top bar, rail, minimap and panels. The card menu has Make task for a plain note card. Better Tasks' own attribute blocks and its activity log never show as rows, badges or children on a card. Without Better Tasks the tool still makes a plain TODO card and the chips are read-only |
| Highlighter colours | A card with `#bg-blue` or `#[[bg-blue]]` uses that colour when the colour highlighter is installed. A fill set on the card wins until you clear it. The colour picker's gear, Write as highlighter tag, stores one `#[[bg-name]]` in the block and clears the fill. One undo restores both. Hex, darker, and lighter stay on the card only. `#c:red` still colours text inside the card. |
| Card children | A card with child blocks shows only its own block and a ▸ N badge. Click the badge to open the children as an editable outline in the card (remembered per card); hover it to peek. The card menu has Spread children as cards: one card per child with an arrow back, in one undo step |
| Connections in Roam | A connection block (under a board's Connections) gets a small chip in the outline, the sidebar and linked references: "A —label→ B · on Board". Click it for a preview with a map of the two cards, the arrow and the target row; Open on board selects the connection (inside a nested board too), Open in sidebar opens the board block. Nothing is written The breadcrumb Roam draws above a connection block (in linked references and when zoomed into the block) opens the same preview on a plain click, with a ▦ mark; Shift, Cmd and Ctrl clicks keep Roam's behavior. The preview opens under the chip, else above or beside it, and never covers the chip or the block line |
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
| Save view | More → Save view…, or Shift+V, stores the camera as one view block. With cards selected, the context bar saves a view of that selection. The Boards tab lists the views. Go restores the camera and writes nothing |
| Mark region | On an image card, Mark region, then drag a rectangle on the picture. Confirm stores the region under the image and copies a block ref. The first undo removes the region. The next undo removes the empty container |
| Mark image region | On an image block, right-click the bullet, then Extensions, then Plexus: Mark image region. Drag a rectangle and Confirm. The region is stored under the image and a block ref is copied. Escape writes nothing. The same region shows as a crop, at most 160px tall, in the outline, a block ref, an embed, the sidebar, and linked references. The crop has a 1px border and no shadow |
| Open a region | Hover a crop for a larger preview. Click opens the image on its board, zoomed to the region, or scrolls the outline image into view and pulses the region. Shift-click opens the board in the sidebar |
| Public API | `window.PlexusDiagram` lists boards, opens a card or a saved view, adds one card, and returns a small PNG of a board. The command palette stays two entries |
| Roam Plexus on a board | A block ref of a Roam Plexus region shows the caption, a crop, Open drawing, and Open in sidebar. Without Roam Plexus the card is an ordinary block ref |
| Drawing on a board | A block ref of a Roam drawing shows the picture. Regions lists its regions and adds a reference. New drawing here creates the drawing and the reference. The drawing block stays where it is |
| PDF on a board | A pdf block is a card. The cover shows the file name and the highlight count. Open reader mounts Roam's reader. Interact uses that reader. One reader is open at a time. The command palette stays two entries |
| Highlight on a board | A block ref of a PDF highlight shows a colour bar, the passage or the area picture, and the page. Changing the colour tag updates the bar. A block that is not a highlight stays a normal ref |
| Open in reader | On a highlight card, Open in reader opens that page inside the PDF card on the board. The mark stays in view. If the PDF card is not on the board, Roam opens the highlight. The click does not write. The command palette stays two entries |
| Add highlights | On a PDF card, Add highlights lists that page's highlights by date, with a colour bar and a page number. Place as grid or column. One undo removes those cards. Drag a highlight's bullet onto the board for one card. Drop a date and confirm to add only its highlights. Paste of a highlight ref is unchanged |
| Highlight colour | The tag lens can keep one highlight colour bright. An area picture uses its saved width and height. Mark region on an area card stores the region under that highlight. The page mark keeps the colour Roam painted |
| Open a view | An inline view is a small map. Hover enlarges it. Click opens the board at that view and pulses the highlighted cards. Shift-click opens the board in the sidebar. The click does not write |

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

## Regions and views

An image region and a saved view are blocks under `{{[[plexus-regions]]}}`. That container is a child of the image or the board. It is not a card.

| Kind | Block |
|---|---|
| Image region | `{{[[plexus-region]]: k=img d=<image uid> f=<rx>,<ry>,<rw>,<rh>}} caption` |
| Saved view | `{{[[plexus-region]]: k=view d=<board uid> v=<x>,<y>,<w>,<h>}} caption` |

`f` is the crop as fractions of the picture. `v` is the camera. `ids=` can name up to 24 cards. Roam Plexus 0.33.0 reserves these two kinds.

Mark a region on the picture, or from the block menu. Plexus copies a block ref. Paste that ref on a daily note and the crop shows there. Save view stores the camera the same way. The image card shows a region count. Rename changes only the words after `}}`. Delete asks when another block still references the region.

## Works with

Plexus Diagram, Roam Compass, and Roam Plexus notice each other. With Compass loaded, a card menu can open Compass on that page, and Compass can open the board that holds it. With Roam Plexus loaded, an image card can start an empty drawing beside it. If one of them is missing, that menu row stays hidden.

## Shortcuts

`?` opens this same list on the board. ⌘ means Command on a Mac and Ctrl elsewhere. Present keys apply only while a presentation is running.

| Group | Keys | Action |
|---|---|---|
| Tools | V | Select |
| Tools | H | Hand |
| Tools | N | Card |
| Tools | K | Task |
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
| Integrations | Better Tasks integration | Use Better Tasks for task chips, the light checkbox, and task edits. Off leaves the TODO marker to Roam. Starts off. |
| Integrations | Task tool | Show the Task tool (K) in the dock. Starts off. A saved on stays on. |
| Integrations | Task chips | Full (due date, project, priority, repeat, status), due only, or none. |
| Integrations | Default project for new tasks | A page name. A task made from the board gets it as its Better Tasks project. Empty uses Better Tasks' own default. |
| Sections | Auto-fit sections | Grow a section when a card is moved or resized past its edge. |
| Connections | Graph links | Show lines between cards that share a page reference or an attribute. All, attributes, or off. |
| Connections | Attribute styles | One JSON object. Each attribute name gets a palette color and a line: solid, dashed, or dotted. |
| Board | Enabled | Turn the diagram overlay on or off. |
| Board | Fullscreen on zoom | Open a diagram full screen when you zoom into its block. Esc leaves it. |
| Board | Mouse wheel | Pan or zoom. Pinch still zooms. |
| Board | Show minimap | Show the small map of the whole board. |
| Board | Show tool palette | Show the tool dock. |
| Board | Toolbar layout | Split: board bar on top, tools in the dock. Classic: the 2.1 look. Dock only: hide the top bar until the pointer is near the top edge. |
| Board | Tool dock position | Bottom, left or top. A board can override it from its More menu. |
| Board | Dock shape | Pill or strip. |
| Board | Show tool names under icons | Label each tool in the dock. |
| Board | Button size | Comfortable or compact, for both bars. |
| Board | Show tool options in the dock | Show the active tool's colors, look or shape next to the dock. |
| Board | Hover tooltips | Show a name, shortcut and one-line description when you hover or focus a control. Off falls back to the browser's plain tooltip. |
| Board | Tooltip delay | Instant, 350 ms or 800 ms. Keyboard focus always shows the tip at once. |
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
