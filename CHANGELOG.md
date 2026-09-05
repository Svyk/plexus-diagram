# Changelog

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
