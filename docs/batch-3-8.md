# Batch 3-8 · 2.9.4 · REG-3 and REG-4

Depends done: REG-2 (`67849d3`), ECO-1 (roam-plexus `52869cc`, apiVersion 7). Roam Plexus is not edited. No new command-palette entry.

## Measured

Outline `img.rm-inline-img` and `.rm-inline-img__resize` were the same box, 500 by 312.5. Natural size 1600 by 1000. Not `.enc`. The block menu submenu is labeled Extensions. It already has Roam Plexus "Plexus: Region on image". Our label is "Plexus: Mark image region". A `k=img` block and a `((ref))` to it each render `button.rm-xparser-default-plexus-region` with text "plexus-region" and no `data-plexus-owner`. Roam Plexus skips reserved kind `img`. The region block's only ref is the page plexus-region. `d=<imageUid>` does not reference the image.

## Files

- `src/view/region-outline.js` owns the outline overlay. Reuse `mountRegionMark` inside a fixed root whose box matches the `img` rect.
- `src/view/region-crop.js` owns the crop node and the pixel math.
- `src/feature.js` owns the menu command and the `scanAdded` pass. Cap 60, same as `SCAN_CAP`.
- Tests: `test/region-outline-294.test.js`, `test/region-crop-294.test.js`.

## REG-3

`blockContextMenu` label "Plexus: Mark image region". Show it only when `classifyString` is `image`. A non-image string toasts and writes nothing. The overlay is fixed on the `img` rect, within 2 px. Drag fractions use that `img` box. Confirm copies `((uid))` in the click, then `addImageRegion`, same two-step undo as REG-2. Esc and a click outside destroy the overlay and write nothing. No `setPointerCapture`. Do not call Roam Plexus's command.

## REG-4

On each unowned region button, read the string from `.rm-block-ref[data-uid]` when the button is inside a ref, otherwise from the outline block id. Parse with `parseRegion`. Claim only `owner === "plexus-diagram"` and `kind === "img"`. Set `data-plexus-owner="plexus-diagram"` and hide the button. Skip a button already owned, including `roam-plexus`. Crop from `host.getFile` bytes, object URL, LRU 24, nothing persisted. If the file fails, show the caption and the text "image unavailable". Max height 160. Dark mode is a 1 px border and no shadow. Unload removes the crop and shows the button text again. One crop per button, including sidebar, embed, and linked references. Typing bench is waived.

## Acceptance

REG-3: menu opens the overlay on the outline image within 2 px. Confirm writes the container and the region and copies `((uid))`. Esc leaves no `.pxd-*` node. Palette stays two entries. REG-4: the ref shows the hamstring crop in light and dark. Sidebar and embed render once each. A Roam Plexus region on the same page keeps owner `roam-plexus`. The crop also renders where that button appears under Linked References. Unload restores the plain button.

## Out

Polygons. Page-card images. Show-regions outlines and resize handles. Editing the crop. Roam Plexus source.


## Critic amendments

These override any earlier sentence.

1. The outline root has class pxd-root so the mark CSS applies. Inline styles set position fixed, the image box, and overflow visible. Do not leave width 100 percent, height 560px, or overflow hidden. Move the root on scroll and resize.
2. Attach the outside-click listener on the next turn, not during the menu click that opened the overlay.
3. The menu acquires a session on the image block uid and calls addImageRegion on that session. It does not use the open board or resolveBoardUid. Release only after addImageRegion has returned, so both transactions are already queued.
4. On install, run the button pass over document and over existing bp3-portal nodes. Later mutation batches stay capped at 60.
5. The region uid is the ancestor rm-block-ref data-uid when that exists, otherwise the closest roam-block-container data-block-uid. Do not slice a block-input id. Image bytes are host.getFile of imageSrc of the drawing block string. Set data-plexus-owner to plexus-diagram and hide the button before that await. A failed file shows the caption and the text image unavailable.
