# Changelog

## 0.1.0 — 2026-08-27

Initial release of Plexus Diagram.

- Hide native `.rm-diagram` React Flow renderer for enhanced diagrams and mount a vanilla DOM/SVG canvas overlay
- Keep Roam diagram children as the canonical card store; persist layout on `[[plexus-diagram/metadata]]`
- Writable viewport via native `:rf-diagram` props; import native node positions when metadata is absent
- Heptabase-like toolbar, cards, connectors, sections, library sidebar, and fat settings panel
- Command palette, slash command, and block context menu integration
- GitHub Pages developer extension at https://svyk.github.io/plexus-diagram
