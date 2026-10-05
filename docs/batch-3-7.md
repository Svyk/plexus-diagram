# Batch 3-7 — REG-2

Version 2.9.3. No typing bench.

## Critic amendments

The container is a child of the image card, never the board. Match `{{[[plexus-regions]]}}` or plexus type regions on that card only. Order is explicit last. The child has no props. Build the string with serializeRegion before the txn. `d` is the image uid. A rejected fraction writes nothing.

A new container is its own transaction, then the child is a second transaction. One Cmd+Z removes the region. The next removes the container. A reused container is one transaction and one undo. Do not group the two creates.

The mark layer stops pointerdown and mousedown and calls preventDefault. Document pointermove and pointerup follow the drag. No setPointerCapture. The card must not move, and Roam's image viewer must not open.

`f` is the drag divided by `img.rm-inline-img` only. Not the card and not `.rm-inline-img__resize`.

## Files

`src/model/image-region.js` and `test/image-region-293.test.js`: `fracFromDrag` and `imageRegionString`.

`src/views.js` adds `addImageRegion` only. `test/image-region-write-293.test.js` uses the fake Roam session.

`src/view/region-mark.js`, `src/css/region-mark.css`, the image button in `chrome.js`, and the `board-view.js` hook. The confirm click copies `((uid))` before any await. Dark is a 1.5px stroke plus a 1px halo, no fill. Two palette entries.

## Live

A 1600 by 1000 image. Drag 25,30 to 45,55 of the img box. Caption hamstring. `f=0.25,0.3,0.2,0.25` within 0.005. Undo once, then twice. The kids badge does not count the container.
