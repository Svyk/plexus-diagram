# Batch 16 — 2.11.2

PDF-6, PDF-5, PDF-3. Depends: PDF-2 is released. No new palette command. No typing bench. No `:pdf-*` writes. Copy and paste stay a manual limit.

Measured in roadmap section 8. The page mark does not follow a rewritten `#h` tag. The outline swatch does. Overlay highlights are not draggable. Outline bullets are. The picker and bullet drag are the paths.

## Model

Colour is the `#h/` token. Seven names map to the same board colours. Unknown stays gray. Do not store it on `item.color`.

`rewriteHighlightTag` replaces one `#h/word` and leaves the rest. A missing token is appended. One write, on the highlight block.

Area cards stay kind `highlight`, with `highlight.image` and `highlight.natural` `{w, h}` from `:image-size`. Add class `pxd-item--image`. Paint the image, then the bar and footer. Map lod stays the bar and the first line.

The region container is a child of the highlight block, `item.target.uid`. A png uses the image macro. An `.enc` url uses `file.get`. No `:pdf-*` key is written.

Picker rows come from that PDF page. Group by a `[[date]]` parent. A placed uid is checked and disabled. Place writes at most 45 ref cards in one undo group. Grid is 3 columns, 300 by 140. Column is a stack.

A dropped date block expands only after confirm: `Add N highlights under this date?` Cancel drops nothing.

## Files

- `src/model/highlight.js` owns the tag rewrite, the seven names, and natural size.
- `src/model/highlight-pick.js` owns grouping, placed rows, the 45 cap, grid and column positions, and date expansion.
- `src/model/lens.js` adds `h/<colour>` for a highlight card. The row label is the colour name. Dim uses `pxd-item--focus-dim`.
- `src/model/kanban.js` adds `Highlight colour`. A move rewrites the highlight tag. No highlight means no write.

- `src/host/roam.js` reads the page tree. No url fetch.
- `src/session.js` places one chunk in one group, and sets colour in one group.
- `src/view/cards.js` paints the image, then the bar and footer. Aspect ratio is set before load.
- `src/view/board-view.js` owns the picker, `Add highlights…`, the seven-colour row, the lens section, and the mark-region parent.

## Tests

- `test/highlight-2112.test.js` rewrites one tag and reads natural size.
- `test/highlight-pick-2112.test.js` groups, places 5 of 7, disables placed rows, caps at 45, and uses 3 columns.
- `test/highlight-lens-2112.test.js` keeps pink bright.
- `test/highlight-kanban-2112.test.js` plans a tag write.
- `test/highlight-cards-2112.test.js` checks the ratio, both classes, and a hidden header.

A date-drop test confirms, cancels, and leaves props untouched.

## Acceptance

PDF-6. Seven colours render as seven bars. Lens pink adds `pxd-item--focus-dim` on the others. Picker green rewrites `#h/yellow` to `#h/green`. Undo restores the string. The tooltip says the page mark stays as Roam painted it.

PDF-5. The area image uses the 133 by 47 ratio before load. Mark region parents the container on the highlight block. The ref renders inline. `:pdf-highlight` keys stay the same.

PDF-3. One bullet drag makes one card. The picker places 5 and one undo removes them. Reopen shows those 5 disabled. Reader drag is not a path. Cmd-V stays manual.

## Amendments

The highlight block is not in the board tree. `rawInsert` skips an unknown parent. Add `addHighlightRegion` and create the container and the region in one transaction. The create ops still name those parents. Do not use `addImageRegion` for this card.

`rebuildLens` must append `h/<colour>` for a highlight. `extraTagText` ignores that kind.

The seven colours are a row on the highlight card picker, with the label `#h/<name>`. The swatch tooltip says the page mark keeps Roam's painted colour.

`src/view/color-picker.js` and `src/view/chrome.js` may add that row. `src/views.js` may add `addHighlightRegion`. No other files.

Critic, 2026-10-05. `setString` returns when the block is not on the board. The colour write uses `t.string` after `blockString`, not `setString` or `setColor`.

A date drop is `((uid))`. Confirm before `addRefCards`. Place the highlight children only. A page drop stays a page card. A highlight bullet stays one card.

Placed means `item.target.uid`. The lens label is the colour name and `data-tag` stays `h/pink`. Mark region shows for an area highlight. `image` stays a boolean.
