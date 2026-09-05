# Plexus Diagram

Native-first Heptabase-like overlay for Roam `{{[[diagram]]}}` blocks. Roam's diagram children remain the canonical card store; Plexus Diagram hides the native React Flow canvas for enhanced diagrams and mounts an enhanced canvas with cards, connections, sections, and a library sidebar.

**Developer extension URL:** https://svyk.github.io/plexus-diagram

## Enhance and restore

1. Focus a diagram block (`{{[[diagram]]}}` or `{{[[diagram]]:title}}`).
2. Run **Plexus Diagram: Enhance this diagram** from the command palette, the block context menu, or the **Plexus Diagram** slash command.
3. The native `.rm-diagram` renderer is hidden and a `.pxd-root` overlay mounts as a sibling.
4. Run **Plexus Diagram: Restore native diagram** to unmount the overlay and show native React Flow again. Content children are never deleted.

## Using the board

- **Pan:** drag empty space (Select tool), middle mouse, or hold Space and drag. **Zoom:** wheel / pinch, `Zoom+` / `Zoom-`, click the percentage to reset, `Fit` to frame all cards.
- **Add a card:** double-click empty space, pick the `Card` tool and click, or drop a page/block from the left sidebar onto the board (`[[Title]]` or a Roam uid).
- **Edit a card:** double-click it. Roam's native block editor mounts in place; click away or press Esc to commit. Cards show `renderString` output otherwise.
- **Move / resize:** drag a card; drag the bottom-right corner to resize (min 240×140). Shift-click to multi-select and drag together.
- **Connect:** drag from a card handle (or click-click / Connect tool) onto another card, or onto empty board to pull out a new card and link it. The wire shows a head while dragging. Click a connector for the inspector (direction, flip, route, color, delete). Double-click the line or the midpoint pill to add a note (`label::` on the edge, not a new card). Settings → Arrowheads is the default for new edges only.
- **Sections:** frames are visible (solid border, light fill). Drag to move, resize the corner, click the title to rename. Color swatches in the toolbar apply to the selected card or section.
- **Nested diagrams:** double-click a nested card body to open it in place (hash stays on the parent page; fullscreen and crumbs stay). The toolbar shows Heptabase-style crumbs (`Parent › Current`); click a parent crumb or press Esc to pop one level. Nested cards show the parsed board name, or an inline "Name this board…" field when the block is only `{{[[diagram]]}}`.
- **Library:** the searchable drawer portals onto `document.body` (not the scaled world) so type stays readable.
- **Fullscreen:** `Fullscreen` button or **Plexus Diagram: Fullscreen this diagram**. Esc exits edit, then pops a nested crumb if any, then exits fullscreen. Zoomed diagram pages (`#/app/<graph>/page/<uid>`) open full screen by default (`fullscreen-on-zoom`). Fullscreen hides RoamJS breadcrumbs, sits below the remaining topbar, and follows `.rm-article-wrapper` so the overlay shrinks with the left and right sidebars instead of covering them.
- **Shortcuts** (when `enable-shortcuts` is on and the overlay has the pointer): `V` select, `C` connect, `N` add a card at view center, `F` fit. Ignored while typing in a card or edge-label editor.
- Viewport and layout persist on pointer-up / wheel-end, not per pixel. A viewport imported from the native diagram that would paint cards under 140px is replaced by a fit on first paint.

## What is written where

| Data | Location |
| --- | --- |
| Card content (pages, text, images) | Diagram block **children** via `data.block.create` |
| Card positions, sizes, edges, edge labels, sections | `[[plexus-diagram/metadata]]` blocks keyed by content UIDs |
| Pan/zoom viewport | `viewport::` on `[[plexus-diagram/metadata]]` (native `:rf-diagram` only on first enhance seed) |

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

Palette and slash keep only these, each prefixed **Plexus Diagram:**

- Enhance this diagram
- Restore native diagram
- Fullscreen this diagram

The block context menu still has **Plexus Diagram: Enhance**. Card, connect, nested, library, snap, and auto-layout stay on the toolbar (single row) and as shortcuts.

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
