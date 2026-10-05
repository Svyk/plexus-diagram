# Batch 19 — 2.12.0

MEM-1 and NAV-1. No new palette command. The halo and the chips do not write. No typing bench.

Create time and edit time are numbers. The user entity has a uid and an empty display name, so the header names no person. dateToPageUid exists. The board pull does not include times yet. Add those three scalars to BOARD_PATTERN.

The page title is h1.rm-title-display. No reference header was mounted. A page chip is inserted only after .rm-reference-main. Never under the title.

## MEM-1

src/model/halo.js is pure. company(items, uid) keeps other cards within 24 hours, at most 6. buckets(dates) returns 12 quarter counts. Their sum equals the ref count. An empty list is 12 zeros. headerText skips the person when the display name is empty.

The popover uses placePopover. It is pxd-chrome and stops pointerdown. Dates are page refs via renderString inside a pxd-root. Menu id context is on a card and an edge. The info panel adds one Context section from the same model. A halo open reads refs once and keeps them for 60 seconds. It does not write.

Tests: test/halo-2120.test.js.

## NAV-1

createCardCache already keys a target to its boards. Extend setBoard so each board keeps its title. Do not add a second cache.

src/cardchips.js draws pxd-cardchip. The text is "▦ on " plus the board title. Show at most 3, then +N. Skip .pxd-root. Skip a block whose textarea is focused. Skip a page that contains #plexus-no-chips. The setting card-chips defaults on.

One click listener on document, not one per chip. Hover opens a 320 px map from the existing minimap. A click opens that board and pulses the card. Two boards make two chips. Search results get no chip. Unload removes every chip.

Tests: test/cardchips-2120.test.js. The card-cache test gains the title.

## Owners

halo.js and its test are one owner. cardchips.js and its test are another. The integrator wires feature.js, menu-model.js, panel.js, board-view.js, and the board pull. CSS is src/css/halo.css and src/css/cardchips.css.

## Acceptance

MEM-1: the header day matches create time. The board and section names match. With lists cards from the same minute. The sparkline has 12 buckets and matches the ref count. A date click is Roam's navigation. Edit times stay put. Dark and light.

NAV-1: the outline and the sidebar show the chip. Hover shows the card and two neighbours. Click opens and pulses. Two boards make two chips. Unload removes the chips. The typing bench is waived.

## Amendments

Do not add the time fields to BOARD_PATTERN. That string is the pull watch. On halo open, one unwatched pull reads create time, edit time, and the user ref's display name. Pass those numbers into company. headerText omits the person when the name is empty. Do not print the user uid.

The popover is its own pxd-root on document.body, position fixed, using getBoundingClientRect. Do not stop pointerdown on a page ref. Unmount each date root on close. If that daily page does not exist, show plain text. Do not create the page.

The info panel Context section is text from headerText. No renderString in the panel.

setBoard stores the title the caller passes. An empty title reads Untitled board. A page card resolves its page uid once and keys that uid in this same cache.

Skip a container that already has a highlight view or an On board chip. Resolve input ids with uidFromElementId, and stop at 60 nodes. One capture pointerdown stops only on pxd-cardchip. One click listener ignores every other target. Do not stop mouseup in a textarea. Unload removes both listeners and every chip.

When the reference header is absent, one chip is the first child of the page's first block-children. Never touch the title. Dark mode is a border and a clear fill.
