# Changelog

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
