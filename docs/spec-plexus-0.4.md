# Plexus Diagram v0.4.0

Native-first overlay for `{{[[diagram]]}}`. Not a Heptabase clone. Cards stay diagram children. Layout/viewport/edge labels live on `[[plexus-diagram/metadata]]`. Do not write `:diagram/*` or `:harc/*`. Zero runtime deps.

## Bugs this bump closes

1. **Breadcrumbs** — RoamJS `#roam-breadcrumbs-panel` in `.rm-topbar`. Fullscreen hid the Plexus toolbar under the left sidebar (`left:0; z-index:20`). Hide the panel only while `body.pxd-has-fullscreen`. Offset overlay below topbar and to the right of the sidebar. Keep graph switcher + left sidebar.
2. **Sync on open** — `enhanceDiagram` always `metadata.set` (delete-all/recreate). `scheduleInitialFit` persists. `persistViewport` writes `:rf-diagram` on the daily block. Open must write nothing. Viewport is metadata-only after first enhance.
3. **Card edit blanks** — `renderBlock` of a uid that already has an outline instance. Scratch-host editor (roam-grid rule 19). Trusted mousedown/mouseup/click. Fallback until hydrate quiet.
4. **Connection notes** — labels on the connector (`label::` under `edge A->B`), not new cards. Double-click the line. `show-edge-labels` default on.
5. **Commands** — palette/slash: Enhance, Restore, Fullscreen only. Toolbar single row. V/C/N/F/Esc when overlay owns pointer.

## Persist rules

- Dirty flags only: pan moved, zoom changed, drag/resize, add/connect, Fit button, zoom ±.
- Initial fit, remount, dispose: no write.
- Equal serialized snapshot: no write.
- `persistViewport` updates `viewport::` only. No `:rf-diagram` props except first enhance seed.

## Ship

`npm run check`. Source + generated together. Author Svyatoslav Kleshchev `<svyk@icloud.com>`. Push `main`, no PR. After Pages, remove-and-re-add `https://svyk.github.io/plexus-diagram`. Badge `v0.4.0`.
