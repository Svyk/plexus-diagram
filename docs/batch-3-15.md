# Batch 3-15 — 2.11.1 PDF-2

PDF-1 is done. One task. No new palette command. No writes. No typing bench.

## Measured

A fixture text highlight has type text, pageNumber, and :pdf-content-hash. That hash matches the PDF page. It has no :pdf-fingerprints. The page title is the file name. The string has #h/yellow.

An older area highlight has type area, :image-id, pageNumber, :pdf-fingerprints, and :image-size. The string is an image macro plus the colour tag. It is not encrypted. The board pull does not include a ref target's props.

## Model

src/model/highlight.js is pure. highlightModel reads props. Text is :content :text, else the block string with the #h token removed. Do not require quotation marks. Area uses the image macro already in the string, not :image-id. pageNumber is under :position :boundingRect. The colour is the name after h/, mapped onto PALETTE. Unknown maps to gray. Missing pdf-highlight means a normal ref card. Accept both :pdf-highlight and pdf-highlight. The footer name is the page title. No write helper.

## Files

highlight.js owns the model. Test test/highlight-2111.test.js. roam.js adds blockProps(uid). That pull reads props, the string, and the page title. It does not fetch a url. board.js sets kind highlight when the target props contain pdf-highlight, and keeps the ref uid as the target. session.js passes blockProps and watches the highlight block. cards.js paints the bar, the body without the colour tag, and the footer. extension.css hides the tag in the card only. Dark mode is the bar plus a border.

## Acceptance

1. A dragged highlight shows the bar, the text, and p. N.
2. An area highlight shows its image.
3. Changing the tag to #h/green updates the bar after the echo.
4. A block without :pdf-highlight stays a normal ref card.
5. Dark mode is bar plus border. Light shot too.

## Out of scope

No geometry edits. No Open in reader. No highlight picker.

## Amendments

buildBoard must keep a highlight target as the ref uid, same as the pdf branch. Otherwise the body is the ref string.

session rebuild must pass blockProps into buildBoard. resolve today returns only the string. A tag edit lives on the PDF page, so watch that block and put the colour in the card content key.

Do not put the colour on item.color. That class tints the card. The bar is its own element. plainText would show the word h/yellow, so strip the token before render.

