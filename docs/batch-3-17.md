# Batch 17 — 2.11.3

PDF-4. No palette command. No :pdf write. No file fetch.

Do not dispatch the highlight click. It opens a fullscreen reader and leaves the board. Set the card reader's page input.

pdfCardForUrl(url, cards) returns the pdf uid whose macro url equals url, or null.

pdfPageUrl(pageUid) pulls :pdf/url. Read only.

Toolbar Open in reader. A matching pdf card opens and the input becomes the highlight page. Else openBlock and toast Click the highlight to open the PDF. Zero graph writes.

Tests: matching url, other url, input 1 to 2, toast, no write.

## Amendments

Use blockPageUid of the highlight target, not the card. Compare the page url to pdfMacroUrl of that target's block string. A ref card string is ((uid)).

Open in reader only when kind is highlight.

If that reader is already open, do not remount. Wait for its pdf container input, then set it with the value setter plus input and change. The number is highlight.page. A missing input is not the fallback.

Else openBlock and the toast. Never click the colour icon.

Tests also cover a ref card, an already-open reader, and a late input.
