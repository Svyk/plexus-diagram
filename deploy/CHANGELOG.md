# Changelog

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
