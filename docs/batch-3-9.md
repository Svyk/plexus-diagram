# Batch 3-9 · 2.9.5 · REG-5 and REG-7

Depends done: REG-4 (`f56ca02`), REG-6 (`728f1fe`). No sibling repo edits. No new command-palette entry. Typing bench is waived. Buttons live on the popover only.

## Measured

Test Lab page `xxnGb6SEj` has 0 children. Plexus is unloaded. A click on the empty block opened a textarea. Escape closed it. The probe block was deleted. tooltip-delay is "350 ms" and motion is "full". No block string contains `k=view`. The button class is `button.rm-xparser-default-plexus-region`.

`getOpenPageOrBlockUid()` is the page uid string. A `?pxd=` assign fires two hashchange events. Only the first newURL keeps `?pxd=`. `location.hash` drops it within 80 ms. The sidebar already has 140 windows. `drawPreview` is not exported. `previewModel` is an edge crop. `goToView` matches x, y, and width. Height follows the board. Pulse duration is `motionProfile.pulseMs`, not 1.2 s.

## Files

- `src/view/region-hover-geom.js` owns veil boxes and the region camera. Test: `test/region-hover-geom-295.test.js`.
- `src/view/minimap-svg.js` owns `viewMapModel` and the moved `drawPreview`. `src/relchips.js` imports that drawer and deletes its local copy. Test: `test/minimap-svg-295.test.js`.

- `src/view/region-open.js` owns popover placement, the open decision, and the pending target. Test: `test/region-open-295.test.js`.
- Integrate only: `src/feature.js` (scan kind `view`, hold the target), `src/view/region-crop.js` (stop `pointerdown` and `mousedown`), `src/view/board-view.js` (`cameraRect`, region zoom, view camera, pulse), `src/css/region-hover.css`, `src/css/region-view.css`.

## Data

Read-only. No new block grammar. `k=img` keeps `f` as `[rx, ry, rw, rh]`. `k=view` keeps `v` as `[x, y, w, h]` and optional `ids` (max 24). Deep link stays `?pxd=<uid>`.

The uid may be a region block or a view block. Stash `{ uid, until }` before `assignDeepLink`. The mount reads the stash. It does not read `location.hash` on a timer. A mounted board may also read the first hashchange newURL through `hashFromUrl`. Camera changes stay in the local viewport. No graph write.

## REG-5

Hover or keyboard focus on `.pxd-region-crop` waits `tooltipDelay()` (350 ms here). The popover is absent before that. `placePopover` places it. Obstacles come from `avoid.js`.

Esc, outside pointerdown, and disconnect close it. Scroll and resize call `placePopover` again.

The preview image uses `previewImageBox`: scale `min(1, 480 / naturalW, 480 / naturalH)`. No upscale. A 40% black veil covers that box. The hole is `holeRect` from `f`. Caption plus buttons "Open" and "Open in sidebar".

`resolveRegionTarget` calls `host.showOnBoard(drawingUid)`. A hit is `{ kind: "board", boardUid, pageUid, cardUid }`. No hit is `{ kind: "outline", blockUid, pageUid }`.

Click and "Open" stash the region uid, then `assignDeepLink` to the board page when the target is a board. On mount, centre the fraction rect. Zoom is `clampZoom` of `240 / min(regionWorldW, regionWorldH)`, max 4. The region's on-screen smaller side is at least 240 px unless zoom is already 4. Draw `.pxd-region-pulse` on that fraction for `pulseMs`. Reuse the existing pulse animation. Do not add a 1200 ms timer.

An outline target calls `host.openBlock`. Retry until `getOpenPageOrBlockUid()` equals that page uid, about 8 times at 150 ms. Then `scrollIntoView` the image and pulse an overlay on the img box once.

Shift-click and "Open in sidebar" call `host.openInSidebar(boardUid, "block")` and do not change the main hash. The same stash applies to the sidebar mount. The test closes only the window it added.

Stop `pointerdown` and `mousedown` on the crop. Handle the open on `click`, then stop that click.

## REG-7

The same scan claims `kind === "view"` and `supported === true`. Hide the button before the board pull. Cache the board 5 s, same as `modelOf`. Inline SVG is at most 240 by 140. `viewMapModel(board, v, ids)` sets `viewBox` to `v`, keeps cards and sections that intersect `v`, caps cards at 40, marks `ids` as `hi` and the rest `muted`. Titles come from `itemLabel`. Sections are outlines.

Highlight is an accent stroke plus a 12% accent tint. Everything else is a stroke and no fill.

Hover uses the same SVG at 480 px wide, with "Open" and "Open in sidebar".

Click stashes the view uid and opens the board page. On mount, `setCamera` uses `zoom = clampZoom(min(width / v.w, height / v.h))`, then `x = -v.x * zoom` and `y = -v.y * zoom`. `cameraRect()` is `visibleWorldRect(viewport(), size, 0)`. The visible rect contains `v`. The tighter axis matches `v` within 1 px.

Pulse each id in `ids` with the existing item pulse. Shift-click uses the sidebar path above.

`drawPreview` moves as-is into `minimap-svg.js`. Relchip previews keep their edge, bars, and arrow. `viewMapModel` does not require an edge.

## Tests

- `previewImageBox` of 1600 by 1000 is 480 by 300. `holeRect` for `f = [0.25, 0.3, 0.2, 0.25]` is x 120, y 90, w 96, h 75.
- Region zoom: world region 56 by 40 reaches zoom 4 and does not claim 240. World region 200 by 200 reaches zoom 1.2 and a 240 px side.

- `resolveRegionTarget` returns board when `showOnBoard` hits, otherwise outline.
- `viewMapModel` viewBox equals `v`. Three ids get class `hi`. The 41st intersecting card is dropped. A section is an outline.
- `setCamera` math: an 800 by 600 board and `v = [10, 20, 400, 300]` gives a visible rect with x 10, y 20, w 400, h 300. A short board fits height and still contains `v`.

## Acceptance

REG-5: hover shows the veil and the hole within 350 ms. Esc closes. Click opens the board and centres the card. The region is at least 240 px on the smaller side unless zoom is 4. A frame grab shows the pulse.

Shift-click opens the board in the sidebar and spotlights there. A region whose image is not a card scrolls the outline to the image and pulses. `:edit/time` is unchanged.

REG-7: a Corner view ref renders the SVG in light and dark. Hover shows the 480 px map and both buttons. Click opens the board and `cameraRect()` matches `v`, with a pulse on the 3 ids. Shift-click opens the sidebar at that camera.

A view button inside a linked-references portal renders the map. The click writes nothing.

## Limits to expect

`d=<uid>` is not a Roam ref. The view block will not appear in the board page's Linked References. Do not change the grammar. Render the map on any button that does appear, including a portal. Copy stays a manual check if `readText` fails. Show-regions outlines, multi-region tours, and animated view transitions stay out.

## Out

Palette entries. Graph writes for the camera. A second highlighter. Closing the user's existing sidebar windows.

## Critic amendments

These override any earlier sentence.

1. On the first hashchange only, a mounted board reads the stashed uid and applies the region or view camera. The second hashchange has no ?pxd= and must not clear that camera. If the hash is already equal, apply the stash in that callback. An open board does not remount.
2. Read the stash in wake() as well as on mount, after the sidebar view exists. Keep until at least 8 seconds.
3. If the open uid is already the image page, do not navigate. Otherwise call host.openPage(pageUid) and retry until getOpenPageOrBlockUid() equals that page uid. Then scroll the image into view and pulse once. Do not call openBlock.

4. After the card image has a box, map f onto that image in world space, not the card rect. Centre that fraction. Zoom is clampZoom of 240 divided by the smaller side.
5. setCamera uses zoom = clampZoom(min(width / v.w, height / v.h)) and pins v's top-left. Do not call goToView. When the unclamped zoom is inside 0.1 to 4, the visible rect contains v and the tighter axis matches within 1 px. When clamp changes the zoom, skip that 1 px check.

window.__plexusDiagram.cameraRect() reads the main mount. cameraRect(boardUid) reads a sidebar mount.
6. Put pxd-item--pulse on a box over that fraction for motionProfile.pulseMs. Use the existing pxd-pulse rules, including reduced and none.
7. Move drawPreview together with its svg helper, parameterized by doc. Leave previewModel's edge, bars, and arrow behavior unchanged.
8. Append the popover to document.body with class pxd-root and position fixed. placePopover uses client coordinates. Pass chrome obstacles only when a board root is on screen.

9. On every span for the veil, the hole, or the inline view frame, setProperty display to inline-block with priority important before width and height.
10. On the crop and the view map, stop pointerdown, mousedown, mouseup, and dblclick. The click handler stops propagation and calls preventDefault. Set tabindex 0. Focus opens the same popover after tooltipDelay.

11. If the view's d is not the page root board, enter that nested board on the existing crumb trail, then setCamera. Do not frame the root with the nested rect.
12. The region zoom test uses the image box. A 100 by 80 world region uses zoom 3. A 40 px smaller side reaches zoom 4 and does not claim 240 px.
