# Plexus Diagram

Native-first Heptabase-like overlay for Roam `{{[[diagram]]}}` blocks. Roam's diagram children remain the canonical card store; Plexus Diagram hides the native React Flow canvas for enhanced diagrams and mounts an enhanced canvas with cards, connections, sections, and a library sidebar.

**Developer extension URL:** https://svyk.github.io/plexus-diagram

## Enhance and restore

1. Focus a diagram block (`{{[[diagram]]}}` or `{{[[diagram]]:title}}`).
2. Run **Plexus Diagram: Enhance this diagram** from the command palette, the block context menu, or the **Plexus Diagram** slash command.
3. The native `.rm-diagram` renderer is hidden and a `.pxd-root` overlay mounts as a sibling.
4. Run **Plexus Diagram: Restore native diagram** to unmount the overlay and show native React Flow again. Content children are never deleted.

## What is written where

| Data | Location |
| --- | --- |
| Card content (pages, text, images) | Diagram block **children** via `data.block.create` |
| Card positions, sizes, edges, sections | `[[plexus-diagram/metadata]]` blocks keyed by content UIDs |
| Pan/zoom viewport | Native `:block/props` `":rf-diagram".viewport` (metadata mirrors when saved) |

Plexus Diagram does **not** create fake `:diagram/nodes`, write to `:rf-diagram.nodes`, or transact `:harc/*` / `:entity/attrs`.

## Privacy

No network requests. All reads and writes go through Roam's Extension API on the local graph.

## Settings

Open **Settings → Extensions → Plexus Diagram**. Key settings:

- **General:** enabled, auto-enhance, show-version-badge, restore-native-on-unload
- **Canvas:** default-height, snap-to-grid, grid-size, show-grid, grid-style, minimap, pan-on-space, zoom-min/max, wheel-zoom
- **Cards:** default-card-width/height, card-radius, show-card-title, native-block-editor, compact-cards, card-shadow, render-children-depth
- **Edges:** connector-style, arrowheads, edge-width, show-edge-labels, edge-animated
- **Groups:** show-sections, section-label
- **Library:** show-library-on-open, library-include-dailies
- **Theme:** follow-roam-theme
- **Performance:** viewport-culling, disable-on-mobile
- **Keyboard:** enable-shortcuts

## Commands

All commands are prefixed **Plexus Diagram:**

- Enhance this diagram
- Restore native diagram
- Add card
- Connect selected
- Toggle connect tool
- Open nested diagram
- Show library
- Appearances of this block
- Snap selection to grid
- Auto-layout

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Commit `src/`, generated root `extension.js` / `extension.css`, and `deploy/` together.

## Install as a Developer Extension

In Roam: **Settings → Roam Depot → Developer mode → Load extension → URL**

Enter: `https://svyk.github.io/plexus-diagram`

## License

[MIT](LICENSE)
