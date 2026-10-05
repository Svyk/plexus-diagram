# Batch 3-10 — 2.9.6 REG-8

Code is REG-8. DOC-18 docs ride the same release after the live pass. Typing bench is waived. Do not bump roam-plexus.

Measured on Test Lab: one `((uid))` is ref count 1 on `:block/refs`. The Boards tab already lists views. Leave that list. src has no `window.confirm`. The toast has one action.

## Pure module

`src/model/region-menu.js` owns the rules. `renameRegionCaption(string, caption)` replaces the caption and keeps the text through `}}` byte-identical. `regionBadge(n)` returns `◰ N` when n > 0, else `""`. `regionMenu(rows)` returns one Regions item. Each row's children are Go, Copy ref, Rename, and Delete, with ids `region-go:<uid>`, `region-copy:<uid>`, `region-rename:<uid>`, and `region-delete:<uid>`.

Test: `test/region-menu-296.test.js`.

## Wire

`menu-model.js` adds that item on a card when `ctx.regions` has rows. `cards.js` paints the badge beside the refs badge, and hides it when show-card-badges is off. `board-view.js` fills `ctx.regions` from `regionsOf` for the image card.

Count 0 deletes at once. Count 1 opens the dialog with "Referenced in 1 block. Delete anyway?". A larger count says "blocks". Buttons are Delete, Open references, and Cancel. Open references opens that region's mentions in the sidebar. A null count does not delete. `regionRefCount` reads `[[n]]`, `[n]`, or `n`. Rename reuses the view dialog with copy hidden, then `updateString` of `renameRegionCaption`. Fake-DOM test: `test/region-delete-296.test.js`. Palette stays at two commands. No write on open, pan, zoom, or select.

Acceptance: badge `◰ 2`; rename keeps tokens and replaces the caption; delete with one ref warns with 1 and deletes the region; badges off hides it. This Roam replaces `((uid))` with the deleted block's text. Plexus does not rewrite the referencing block.
