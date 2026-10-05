# Batch 3-14 — 2.11.0 PDF-1

PERF-3 is done. The typing bench is waived. The palette stays two entries. Do not fetch the PDF URL. Do not write a :pdf prop.

## Measured

The pdf block has no prop for its page. The page stores :pdf/url and :pdf/content-hash. The macro contains that url. Highlights sit under Notes by, then a date. One real highlight counted 1. The page title is the file name.

## Model

src/model/pdf.js is pure. pdfMacroUrl reads the url inside the pdf macro. pdfPagePlan picks the page whose url equals it. coverModel uses that page title, or the url file name, and the highlight count. No page means count 0. readerRule keeps one open uid. Opening another uid closes the first.

classifyString returns kind pdf for a string that starts with the pdf macro. A block ref becomes kind pdf only after resolve says the target is a pdf. renderBlock uses the pdf block uid, not the ref card.

## Files

schema.js owns classifyString. pdf.js owns the plan. Test test/pdf-2110.test.js. That test calls mergePropsForWrite and checks that :pdf-settings is unchanged.

board.js sets kind pdf. roam.js finds the page by the page attribute :pdf/url. That attribute is not inside :block/props. Count blocks on that page whose props contain :pdf-highlight. Those blocks are under Notes by, then a date, so they are not direct children.

cards.js paints the cover and the reader behind the existing embed shield. The shield observer puts the shield back when the reader node appears. Interact removes the shield and stops that observer. Esc or a board click arms it again. Opened size is 640 by 820. The map tier stays the cover.

board-view.js keeps one open reader. A second open returns the first to cover and shows a toast. Fullscreen is the native control. Offscreen unmount stays the existing grace. No new palette command.

## Acceptance

1. After two native highlights, the cover shows "2 highlights".
2. Open reader shows the native toolbar. Page nav works while Interact is on. The board pans while the shield is up.
3. Opening a second reader returns the first card to its cover.
4. Native fullscreen, then Esc, leaves the card intact.
5. A pull after a move shows only the plexus position changed. :pdf-settings is byte-identical. The unit test is not that pull.
6. Dark and light shots. No typing bench.

## Out of scope

No second highlighter. No saved reader state. Highlight cards are PDF-2.

## Amendments

A live fast.q on :pdf/url returned the page, same as the full query. host.q may use that. Do not scan titles. Old pages have :pdf/url too.

A ref card's target uid is the pdf block, not the ref card. A pdf block's own uid is already that block. board.js sets both.

Interact is not only removing the shield. The board pointerdown calls preventDefault unless the card is being edited or the hit is an image. While Interact is on, that handler must leave the reader clicks alone, or page nav and fullscreen never run.

