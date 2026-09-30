# Changelog

## 1.2.0 — 2026-09-29

Fixes from the second round of testing on 1.1.0:

- **Zoomed-out cards stay inside their box.** Map view is a clean title-only tile: three-line clamp, font capped by the tile height, nothing spills below the card. Ref titles are cut at 120 characters and header text at 160. The level of detail now switches while you zoom (with hysteresis, one class toggle), not only when the gesture ends. A third tier below 20% shows section titles only.
- **Nested board thumbnails are real thumbnails.** A padded frame with mini cards (border, fill, title), sections as tinted frames, connections, and an "Empty board" state, instead of one white box.
- **Sections auto-fit.** A card moved, resized, created, or pasted past a section edge grows the section to contain it (24 px padding), live during the drag and saved as one undo step. It cascades through nested sections, never shrinks by itself, and can be turned off per section or with the `auto-fit-sections` setting.
- **Board backgrounds.** Dots, lines, grid, and plain patterns and paper or ten palette tones, chosen per board from the Background button (stored in the board block's props) with a default in Settings.

Added:

- **Right-click menus** for the board, cards, sections, text, connections, multi-selection, and the More menu.
- **Duplicate and clipboard.** Alt+drag and Cmd+D duplicate (Alt+Shift makes `((ref))` cards); copy and paste as refs or as copies, across boards; pasted text and images become cards. Send to board, Boards tab (every board in the graph), Outline tab.
- **Keyboard.** Tab and Shift+Tab step through the outline, F focus mode, Q quick look, P presentation, M mind map from a card's child blocks, Cmd/Ctrl+Alt+Enter fold, double-click a bottom or corner grip to fit or reset height. Arrow keys nudge the selection 1 px (Shift for 10 px); Alt+Arrow selects the nearest card in that direction (Alt+Shift adds), as in Heptabase.
- **Layout tools.** Tidy (row, column, grid, outline order), same size, fit height, reset size, fit section, fold all, optional space-out after a move, "Back to content" button.
- **Pin.** Pinned items do not move, resize, or delete.
- **Card badges.** References, boards, and open and done TODO counts, read from Roam (never written); a `((ref))` to a board renders its thumbnail; journal cards for today and this week.
- **Export.** Export board as SVG and Copy board as text (commands and board menu).
- **Review fixes.** Cut and paste now moves a note, text or section (the clipboard carries a snapshot; before, the paste was a dead `((ref))`). The Open button, double-click and Enter open a whiteboard-shortcut card. Settings changes reach open boards' sessions live. A pinned section is never grown by auto-fit. Fit height can shrink a card. Fit / Reset size / Same size never leave a card outside its section. A pinned card no longer pushes other cards in space-out. Escape closes the Background popover first. Right-clicking a ref, tag, link or image inside a card keeps Roam's or the browser's menu. Tab is only taken while the board itself has focus. A tall menu scrolls inside a small board. Thumbnails title `((ref))` and image cards. The section grows live while you type in a card at its edge. Card badge queries run in idle slots and are cached for two minutes.
- New settings: default board tone, map view threshold, auto-fit sections, space out cards, show card badges; grid accepts `grid`. API and build: see `docs/api-plexus-1.0.md` ("1.2 additions") and `docs/spec-plexus-1.2.md`; `src/css/*.css` is appended to the bundle.

## 1.1.0 — 2026-09-29

From the first round of testing on 1.0.0:

- **Cards show their content.** Note and block-reference cards render the whole block (and its children) instead of a truncated first line over an empty body. A long single-line `((ref))` card is readable again.
- **Drag blocks in from Roam.** Dragging a bullet from the outline or the right sidebar onto a board adds it as a `((ref))` card (a page becomes a `[[page]]` card). Multi-block drags stack. The source block is never moved.
- **Typing in a card.** Enter adds lines inside the card and keeps the caret there; if Roam drops focus while it moves between blocks, the editor takes it back. The card header no longer repeats and lags behind what you type, and text items keep their heading size while editing.
- **Nested boards (Heptabase sub-whiteboards).** New Board tool (W): click or drag to add a board card, or select cards and choose **Move into new board**. Board cards show a mini map, item count, and a name field. Double-click or Open goes into the board in place with a `Parent › Child` breadcrumb; click a crumb or press Esc to go back up. Drag a card onto a board card to move it inside (with Undo). Boards opened from their own page get crumbs for their parent boards.
- **Collapsed board blocks.** The board block is collapsed once so Roam does not list its cards as bullets under an inline board; expand the bullet to see them. Turn it off with **Collapse board blocks in the outline**. A nested board no longer opens a second overlay from an expanded outline.
- Import and Restore keep a nested board's marker; a board deleted while open closes cleanly (a nested one pops to its parent).

## 1.0.0 — 2026-09-28

Rewrite. The 0.6 canvas (one 2,200-line closure) is replaced by a model / host / session / view split with 204 unit tests and a live CDP gate on Roam Desktop.

- **Everything is a Roam object.** Card layout lives in each block's `:block/props` (`plexus` key), not on `[[plexus-diagram/metadata]]`. Sections are parent blocks of their cards. Connections are blocks under a collapsed **Connections** child that read `[[A]] → label → [[B]]`, so both ends get a backlink and notes live as children.
- **Graph links.** References and attributes that already exist between cards are drawn as dashed arrows colored by relation (`causes`, `Detected by`, `mentions`). **Write to graph** turns a labelled connection into `label:: [[B]]` on the source.
- **Heptabase features.** 10 colors for cards, sections, text, and connections; sections drawn by drag or Cmd+G around a selection, with titles above the frame; ports on every edge; curve / straight / elbow routes, direction, dash, weight; selection box, alignment guides, align / distribute; text headings; minimap; board search; Add panel with Search and Related; card editing with Roam's own editor (page cards open the whole page); zoomed-out map view with readable titles.
- **Fast by construction.** Pan and zoom move one transform (p95 frame 4.5 ms on a 120-card board, no renders, no writes). Only on-screen cards render content; zoomed out, cards show titles only. Opening a board writes nothing; the viewport is per device.
- **Fixed from 0.6.4:** Section tool made two frames per drag and one per click; sections did not hold cards and had no color; the connection inspector covered the connection; text typed into a new card was lost; the sync indicator went pending on pan and zoom; diagrams on normal (non-daily) pages were never discovered; `[[links]]` inside cards did not open; keyboard shortcuts were swallowed by the diagram block.
- **Migration.** Boards enhanced with 0.6 upgrade once on first open (positions, colors, sections with their cards, connections with labels and styles). Native diagrams import on **Enhance** (positions, groups as sections, edges as connections). Diagrams you never enhance are never written.
- Commands: Enhance this diagram, New whiteboard here, Restore native diagram, Fullscreen this diagram.

## 0.6.4 — 2026-09-05

- **Inspector Comment** — converts the edge label to native Roam comments (one-way → target, two-way → both) then clears the pill.

## 0.6.3 — 2026-09-05

- **Idle card children** — after click-away, idle cards `renderBlock` the card uid so child bullets stay visible; deep pull includes nested `:block/children`; empty placeholder only when string is blank and there are no children.
- **Board background** — toolbar cycles Dots / Lines / Solid (`grid-style` persisted).

## 0.6.2 — 2026-09-05

- **Connect hit-test** — targets resolve from the painted card rects (`getBoundingClientRect`, 12px handle inflate) before `elementsFromPoint` and world-rect math, and the card hovered on the last pointermove is the fallback for a captured pointerup.
- **Rubber-band** — the edge and temp-wire SVGs cover content ∪ viewport (2000px pad) so the dashed wire paints across a panned board.
- **No junk cards** — a click-click that misses a card cancels the arm; only a real drag onto empty board creates a linked card.
- **Version badge** — the toolbar stamps the package version, not Roam's `DEV` developer-extension version.

## 0.6.1 — 2026-09-05

- **Connect hit-test** — when Electron's `elementsFromPoint` misses cards under `.pxd-world`, resolve targets from world-space node rects (12px handle inflate). Click-click arms and drag-to-card both work.
- **Delete cards** — Delete/Backspace on a selected card removes it from the diagram (adapter + metadata), not just edges.
- **Scratch children** — `blankScratch` deletes scratch-host children so a new card editor never inherits the previous card's bullet tree.

## 0.6.0 — 2026-09-05

- **Visible arrows** — connector stroke and marker fill are resolved colors, not `var()` in SVG attributes. Marker ids are unique per canvas. Heads scale with zoom (`clamp(10 / zoom, 6, 24)`).
- **Ports** — drag from a card handle stores `from::` / `to::` (`auto|top|right|bottom|left`). Click-click and connect-to-empty still work.
- **Per-edge direction** — `direction::` `oneWay|twoWay|none` on `edge A->B`. Global Arrowheads is the default for new edges only.
- **Inspector** — click a line for a floating cluster: direction, Flip (disabled if the reverse exists), Route, Label, color, Delete. Mutations `await flushLayout()`.
- **Schema** — optional `from::` `to::` `direction::` `color::` children under the existing edge row. `[[plexus-diagram/metadata]]` only. No `:diagram/*` / `:harc/*`.

## 0.5.0 — 2026-08-29

- **Connect two-click + temp wire** — Connect stays on after an edge. Click-click or drag; the rubber-band lives on `.pxd-edges-temp` above the cards and follows the cursor immediately. Handles are a 12px disc with a larger hit target.
- **In-place nested boards** — opening a nested diagram does not call `openBlock` / change the hash. The parent session stays loaded; crumbs sit on the toolbar and Esc pops one level.
- **Section and card color** — toolbar swatches (eight Blueprint-ish ids plus default) write `color::` on nodes and sections. Dark mode uses the border as the signal.
- **Section click-rename** — a single click on the section title starts rename; pointerdown on the label does not drag the frame.
- **Review pack** — session swap flushes the outgoing board then cancels persist timers; unused parent pull-watches stop; Esc nest-pop only when the overlay owns the pointer; connect-to-empty rolls back a failed edge persist.

## 0.4.2 — 2026-08-28

- **Svy Beam caret** — overlay inputs use native `caret-color` and `cursor: text` (higher specificity than Beam's custom hotspot cursor). `focus({ preventScroll: true })` plus a capture-phase guard stop Roam from scrolling the outline copy of an editing card into view.
- **Right sidebar inset** — fullscreen also ResizeObserves the right sidebar and re-places on the next two animation frames after the article class changes. When the article's right edge is within 8px of the viewport, the overlay `right` inset is 0.
- **Library portal** — the drawer mounts on `document.body` (fixed, 320px, 14px) so it is not scaled by `.pxd-world`. Items are opaque `#f5f8fa` / `#182026`. Empty search hides `roam/js/` and `roam/css` pages.
- **Nested crumbs** — opening a nested board pushes the parent onto a crumb stack (`Parent › Current`). Clicking a crumb opens that block (or page). Nested cards show the parsed name; unnamed boards get an inline "Name this board…" field.
- **Connect to empty** — dragging a handle onto empty board creates a card at the drop point, links it, and enters edit (Heptabase pull-from-port). Handles are 14px. An existing edge is kept if you connect the same pair again.
- **Review pack** — nested open passes parent uid explicitly; nest stack truncates on multi-level back; drop parsing no longer treats incidental 9-char tokens as block refs; connect failures do not leave dangling edges; nested name timers clear on repaint and dispose.

## 0.4.1 — 2026-08-28

- **Pending-changes patch** — layout persist no longer delete-all/recreates the metadata tree. Existing diagram blocks are patched in place: only changed `pos::` / `size::` / `color::` / edge / section rows are written, identical strings are skipped, and gone ids are the only deletes. Viewport persist is still the one-line `setViewport` path.
- **Article-pane fullscreen** — fullscreen follows `.rm-article-wrapper` (below the topbar, inset with the left sidebar) instead of `sidebar.right`. ResizeObserver on the article and sidebar plus a class MutationObserver re-place the overlay when the sidebar opens or closes. Drop `[[page]]` / block uid from the sidebar onto the board to add a card.
- **Visible sections** — sections use a 2px solid border, a light blue fill, `pointer-events: auto`, a default "Section" label, drag, corner resize, and double-click rename.
- **Opaque library** — the drawer sets its own `#ffffff` / `#1c2127` background so it stays readable when mounted outside `.pxd-root`. Blank titles and `roam/js/` pages are hidden until you search.
- **Nested overlay** — adding or opening a nested `{{[[diagram]]}}` card registers it as enhanced and opens our overlay fullscreen, not native Empty Roam Diagram. Nested cards show "Nested diagram" instead of the raw macro. Nested open no longer waits on the parent canvas.
- **Connect hit-testing** — `cardFromPoint` walks `elementsFromPoint` and ignores edge-hit strokes; temp edges are `pointer-events: none`; connect-tool handles stay visible.

## 0.4.0 — 2026-08-28

- **Fullscreen vs breadcrumbs** — fullscreen hides `#roam-breadcrumbs-panel` / `.breadcrumbs-content` only while `body.pxd-has-fullscreen`. The overlay sits below the remaining topbar and to the right of the left sidebar (article fill, not the whole window). Resize recomputes the inset. Inline boards leave breadcrumbs alone.
- **Scratch-host card editor** — double-click no longer `renderBlock`s the card uid (the hidden native diagram still owns it). Edit mounts on a `pxd:scratch` child of `[[plexus-diagram/metadata]]`, hydrates until MutationObserver-quiet, then a trusted mousedown/mouseup/click. Commit pulls the scratch string onto the card; empty pulls never overwrite known text.
- **Connection notes** — labels live on the connector (`label::` under `edge A->B`), not as extra cards. Double-click the line or click the midpoint pill. `show-edge-labels` defaults on.
- **Commands** — palette and slash keep Enhance, Restore, and Fullscreen only. Toolbar is a single nowrap row. `V` / `C` / `N` / `F` when the overlay owns the pointer.
- **Sync silence on open** — remounting an already-enhanced diagram no longer rewrites `[[plexus-diagram/metadata]]` or `:rf-diagram` viewport props when the stored snapshot already matches.
- **Viewport-only persist** — pan/zoom/fit writes only the `viewport::` metadata line; node/edge/section children are left intact.
- **Dirty flags** — initial fit, fullscreen resize, and dispose no longer schedule Roam writes; persist runs only after real user gestures (pan, zoom, drag, Fit, etc.).

## 0.3.2 — 2026-08-28

Double-clicking a card no longer blanks its text: `setBlockFocusAndSelection` was focusing the outline copy of the same uid (Roam then cleared the overlay mount), and a same-tick `focusout` committed an empty pull. Overlay editors now keep a text fallback until `renderBlock` hydrates, ignore focusout for 1s, and refuse to commit an empty pull over known text. Fullscreen sits below `.rm-topbar` so RoamJS breadcrumbs stay clickable and the Plexus toolbar is not hidden under it.

## 0.3.1 — 2026-08-28

House / daily-tab navigation left a `position:fixed` overlay covering the daily notes. Native Maximize unmounts on route change; our mount often survives because the diagram block is still in the outline. `hashchange` / `popstate` now exit fullscreen, drop `--zoomed`, and restore the inline height whenever the open page uid is no longer the diagram. The 250ms reconcile does not do this, so a Fullscreen click on an inline embed is not immediately undone.

## 0.3.0 — 2026-08-28

Canvas rewrite: the board is usable. Imported native React Flow nodes (165×83 on the live graph) are floored to real cards (min 240×140, default 280×160), and a viewport that paints any card under 140px, has zoom below 0.7, or shows no card at all is rejected and replaced by a fit once the root has a size (single card fits at zoom 1.5, centred; fitted viewport persisted once). Pan, wheel zoom, card drag and corner resize touch only CSS (`.pxd-world` transform, one card's box, the edges hanging off it) — no `innerHTML` rebuild, no Roam write per pixel; viewport/layout persist on pointer-up and wheel-end with a 150 ms debounce, serialized through one queue per session. Cards render with `renderString`; double-click swaps in the native block editor (`renderBlock`) and blur/Esc commits it back, so Roam chrome no longer paints into every card. `render()` reconciles card elements by uid, so a pull during editing never tears down the caret. Drag from a card's connect dots (or any card with the Connect tool) onto another card to link. Double-click empty board adds a card at that point; Card/Nested tool clicks still add. A hint pill explains pan/add/fullscreen on boards with ≤1 card until the first pointer down. Zoomed diagram pages open in fullscreen (`fullscreen-on-zoom`, default on; inline embeds stay inline). Grid lives outside the world and tracks pan/zoom; a live minimap replaces the empty box; toolbar buttons are grouped, high-contrast, with a zoom readout. Dark mode: card and toolbar backgrounds from `--bc-main` / `--bc-menu`, 1px visible borders, 2px `--cl-blue` ring for selection — no tinted fills. `applyPull` keeps in-memory positions, sizes, edges, sections, and viewport (a pull only refreshes content), so a debounced persist can no longer be undone by a concurrent add.

## 0.2.1 — 2026-08-27

Fix dead board on zoomed block pages. Navigating to `#/app/<graph>/page/<uid>` destroys the overlay DOM and the MutationObserver never remounted it. A reconcile pass (hashchange/popstate + 250ms interval) now prunes detached views, finds the native canvas — via the dated `block-input-…-body-outline-MM-DD-YYYY-<uid>` suffix or the location hash when ancestors carry no `data-uid` — and remounts the overlay. The pre-paint guard uses `display: none` (React Flow nodes punch through `visibility: hidden` by re-setting `visibility: visible` on themselves) and also hides the native `.rm-diagram-title-panel` and `.react-flow` chrome. Zoomed mounts fill the article (`pxd-mount--zoomed`). Every mount is stamped `data-diagram-uid` and remounts are idempotent per uid.

## 0.2.0 — 2026-08-27

Heptabase-usable overlay: full-bleed board sizing from native diagram (min 560px), horizontal labeled toolbar with zoom/fit/**Fullscreen** (Esc exits; covers the window like native Maximize), empty-canvas pan and cursor-anchored wheel zoom, Roam bullet/ref-count chrome hidden on cards, searchable library drawer that toggles without covering the board, and card titles off by default.

## 0.1.4 — 2026-08-27

Slash/command Enhance was a no-op: typing `/enh` puts the diagram block in edit mode, which unmounts `.rm-diagram`. The command now remembers the uid and waits for the native canvas to remount before overlaying.

## 0.1.3 — 2026-08-27

Slash commands use the same labels as the command palette (Roam Grid pattern), so `/enh` lists **Plexus Diagram: Enhance this diagram**.

## 0.1.2 — 2026-08-27

Metadata writes now generate UIDs before `block.create` / `page.create`. Live roamAlphaAPI returns `undefined` from those calls, so the first enhance was dropping `schema-version::`, `enhanced::`, and node/edge lines. Nested-diagram open uses `roamAlphaAPI.ui.mainWindow.openBlock`.

## 0.1.1 — 2026-08-27

Live-wire fixes against roamAlphaAPI (CDP, Svy graph):

- Fix native hide inversion: `.pxd-native-hidden` now sets `display: none`; pending state uses visibility
- Use EDN string pull pattern for `data.pull`; strip keyword colons from pull results
- Generate child block UIDs via `util.generateUID()`; default create order `"last"`
- Viewport writes try `roamAlphaAPI.updateBlock` before `data.block.update`
- Register slash/context commands via `addCommand`/`removeCommand` with live callback shapes
- Auto-enhance and focus checks pull `[:block/string]` via `roamAlphaAPI.data.pull`
- Find native diagram hosts via `diagramElForUid` (id suffix, data-uid, block-ref)
- Library mounts as overlay drawer; queries `roamAlphaAPI.data.q`; filters daily pages by UID
- Card/Section toolbar tools place items at click position; library uses viewport center
- Default `restore-native-on-unload` to false; unload disposes sessions without deleting metadata

## 0.1.0 — 2026-08-27

Initial release of Plexus Diagram.

- Hide native `.rm-diagram` React Flow renderer for enhanced diagrams and mount a vanilla DOM/SVG canvas overlay
- Keep Roam diagram children as the canonical card store; persist layout on `[[plexus-diagram/metadata]]`
- Writable viewport via native `:rf-diagram` props; import native node positions when metadata is absent
- Heptabase-like toolbar, cards, connectors, sections, library sidebar, and fat settings panel
- Command palette, slash command, and block context menu integration
- GitHub Pages developer extension at https://svyk.github.io/plexus-diagram
