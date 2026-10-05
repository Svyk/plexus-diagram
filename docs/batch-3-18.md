# Batch 18 — 2.11.4

PDF-7. DOC-20 is the gate. No palette command. No :pdf write. No file fetch. No typing bench.

Fixture pages are 1 and 2. Unit tests use pages 2 and 3. Live chips show 1 and 2.

pageChips(rows, url) groups page, uids, and count. It drops a different url and sorts by page. firstChipUid is uids[0]. highlightPill(page) is p. N.

The strip sits under the cover title and under the reader header. The badge is the count. A click pulses those cards after 280 ms. A double-click cancels that and calls openPdfAt for that page. The strip does not write.

createCardCache keys an enhanced board's child uids. A block-ref child also keys its target. setBoard replaces one board.

On board sits on an outline block that has a highlight view and whose uid is a cached target. Skip the reader and any pxd-root. The text is On board. One chip. Read-only.

An arrow onto a highlight card already stores the block ref. The end pill reads p. N from highlight.page. The relchip is the existing one.

Tests: pdf-chips-2114, card-cache-2114, pdf-chip-dom-2114, boardchips-2114.

## Amendments

row.url is the highlight page url. Compare it to the pdf card macro url. page is highlight.page. uids are highlight card uids on this board. Do not read fingerprints.

The strip is pxd-chrome. It follows the cover title, and it is the first child of pxd-pdf-reader, outside the pdf container. It stops pointerdown, mousedown, and dblclick. A click pulses the card uids after 280 ms. A double-click clears that and calls openPdfAt with the pdf card uid and the page. firstChipUid is for tests only. Do not click a highlight.

Do not set fromBlock or toBlock. When the end item kind is highlight and highlight.page is a number, draw highlightPill at that end even when the end is not anchored.

The On board chip sits on the outline container, outside the block main and outside the highlight view. Stop pointerdown, mousedown, mouseup, and dblclick. Do not navigate and do not write. Dark mode is a border and a clear fill. Unload removes every new chip.
