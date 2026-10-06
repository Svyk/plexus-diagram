# PDF highlights closer to Heptabase

Design for Plexus Diagram phase P27, version 2.18.0. Research date 2026-10-06. This file is the design. It does not change `docs/roadmap-3.md`, source, or the build.

Plexus already ships a PDF card on Roam's native PDF Annotator (2.11.0 through 2.11.4, roadmap P20, PDF-1 through PDF-7). The reader, the highlight blocks, the colour tag, and the page jump stay Roam's. This phase changes where the reader sits and how a highlight becomes a card.

Roam stays canonical. A highlight is a Roam block on the PDF's page. Plexus does not keep a second highlight store. Plexus does not write `:pdf-highlight`, `:pdf-settings`, `:pdf-fingerprints`, or `:image-size`. A colour change rewrites the `#h/<colour>` tag in the block string, which is the write PDF-6 already ships.

## 1. Heptabase, step by step

Sources are listed again at the end. Where a 2023 or 2024 walkthrough is the only source for a gesture, the sentence says so. The public wiki pages were fetched on 2026-10-06.

### 1.1 Put a PDF where you can read it

1. Drag a PDF from the desktop into the card library or onto a whiteboard. It becomes a PDF card. The card library owns it. A whiteboard holds a placement of that card. Removing the placement leaves the card in the library. ([pdf-annotation](https://wiki.heptabase.com/pdf-annotation), [fundamental elements](https://wiki.heptabase.com/fundamental-elements))
2. Open it beside the work. The official 31-second demo (2025-09-25) drags the file onto the whiteboard, then uses **Add to side panel** so the PDF occupies the right sidebar. A second official clip (2025-11-27) says to click the PDF's **Open** button, then highlight. Option/Alt-click on a card adds it to the side panel. A card tab can keep the previous card in that panel (`Cmd+Option+N` on Mac) so notes sit next to the source. ([YouTube JFIcuMPD0Zk](https://www.youtube.com/watch?v=JFIcuMPD0Zk), [YouTube 8fAz8zWZa2g](https://www.youtube.com/watch?v=8fAz8zWZa2g), [keyboard shortcuts](https://wiki.heptabase.com/keyboard-shortcuts), [user interface logic](https://wiki.heptabase.com/user-interface-logic))
3. The right sidebar also has a **Highlight** tool. On a PDF card tab it lists that card's highlights and annotations. On a whiteboard tab it lists highlights you can drag onto the board. The Highlight app is absent until at least one highlight exists. `Cmd/Ctrl+3` reopens the last non-chat, non-library right-hand panel, which can be Highlights. ([user interface logic](https://wiki.heptabase.com/user-interface-logic))
4. The reader itself: focus it, then `Cmd/Ctrl+F` searches that PDF, Enter and Shift+Enter step the matches, Left and Right change page, and `Cmd/Ctrl` plus the wheel zooms. A 2023 newsletter added sort of PDF highlights by page or by creation time. ([keyboard shortcuts](https://wiki.heptabase.com/keyboard-shortcuts), [newsletter 2023-09-28](https://wiki.heptabase.com/newsletters/2023-09-28))

Heptabase does not document a locked two-PDF scroll, and it does not document a reader that is only a small object in the middle of the whiteboard. The reading surface is a tab or a side panel. The whiteboard stays the place where highlight cards are arranged.

### 1.2 Make a highlight

1. Select text in the PDF card. That selection is the highlight. With the text-selection toolbar up, `S` creates the highlight, `A` creates it and adds a note, and `D` creates it and adds it to the current editable whiteboard. `D` opens a destination picker when no whiteboard is open. ([keyboard shortcuts](https://wiki.heptabase.com/keyboard-shortcuts))
2. An area highlight is `Cmd/Ctrl` plus a drag, per the wiki. The same official demo also names an area-highlight tool. A 2024 Heptabase walkthrough draws a box around a figure, then drags that area highlight onto the whiteboard, and shows a locate control that reopens the PDF on that figure. ([pdf-annotation](https://wiki.heptabase.com/pdf-annotation), [YouTube JFIcuMPD0Zk](https://www.youtube.com/watch?v=JFIcuMPD0Zk), [YouTube HgvR2QkfwG0](https://www.youtube.com/watch?v=HgvR2QkfwG0))
3. Each highlight is stored as a Highlight card in the card library. From December 2023 those cards are a real card type: the library can filter them, and they take tags and properties. A colour can be set on a highlight. The wiki does not publish the colour count. A 2024 third-party article counted seven colours. Sort is by page or by creation time for PDF highlights, and by Readwise's order for Readwise imports. ([pdf-annotation](https://wiki.heptabase.com/pdf-annotation), [newsletter 2023-12-28](https://wiki.heptabase.com/newsletters/2023-12-28), [newsletter 2023-09-28](https://wiki.heptabase.com/newsletters/2023-09-28), [Goedel](https://www.goedel.io/p/unleashing-the-mind-heptabase))
4. A note rides with the highlight. The 2024 walkthrough adds a comment in the note section of the highlight and says the locate button repositions the PDF. The `A` shortcut is the keyboard form of "highlight and add a note." A 2023 third-party video shows the note travelling onto the board with the passage, a vertical bar in the pen colour, and the PDF title on the card. Treat the bar, the title, and the travelling note as 2023 UI, confirmed in spirit by the later locate and note descriptions. ([keyboard shortcuts](https://wiki.heptabase.com/keyboard-shortcuts), [YouTube HgvR2QkfwG0](https://www.youtube.com/watch?v=HgvR2QkfwG0), [YouTube 3VhtS6dmJrc](https://www.youtube.com/watch?v=3VhtS6dmJrc))

### 1.3 Put the highlight on the whiteboard

1. Drag the highlight from the PDF, or from the Highlight tool on a whiteboard tab, onto the whiteboard. The official clips call the result an atomic card. The wiki says the same drag works from the right sidebar, next to ordinary note cards. ([YouTube 8fAz8zWZa2g](https://www.youtube.com/watch?v=8fAz8zWZa2g), [YouTube JFIcuMPD0Zk](https://www.youtube.com/watch?v=JFIcuMPD0Zk), [pdf-annotation](https://wiki.heptabase.com/pdf-annotation), [user interface logic](https://wiki.heptabase.com/user-interface-logic))
2. `D`, while the selection toolbar is visible, adds the new highlight to the open whiteboard without a drag. Copy link, then paste as embed, places the highlight inside another note card. Highlight cards can also be mind-map nodes (October 2024). ([keyboard shortcuts](https://wiki.heptabase.com/keyboard-shortcuts), [pdf-annotation](https://wiki.heptabase.com/pdf-annotation), [newsletter 2024-10-25](https://wiki.heptabase.com/newsletters/2024-10-25))
3. The card shows the passage (or the area image), the source, and a way back. Locate, or a click on the card's source, reopens the PDF at the original content. The wiki's own summary is "locate these highlights back to their original content positions." The 2024 walkthrough shows that for an area highlight this focuses the figure, which is more than the top of the page. ([pdf-annotation](https://wiki.heptabase.com/pdf-annotation), [YouTube HgvR2QkfwG0](https://www.youtube.com/watch?v=HgvR2QkfwG0))
4. Closing the reader does not remove the card. The card lives in the library and on every whiteboard where it was placed. The Highlight app still lists it. Whiteboards do not own cards. ([fundamental elements](https://wiki.heptabase.com/fundamental-elements), [user interface logic](https://wiki.heptabase.com/user-interface-logic))

### 1.4 Several PDFs, search, and what Heptabase does not do

- Several PDFs are several cards. The right sidebar can hold more than one card at a time (December 2023). The Highlight app on a whiteboard spans sources, so one board can receive highlights from more than one PDF. There is no documented mode that scrolls two PDFs in lockstep. ([newsletter 2023-12-28](https://wiki.heptabase.com/newsletters/2023-12-28), [user interface logic](https://wiki.heptabase.com/user-interface-logic))
- Search is `Cmd/Ctrl+F` inside the focused reader, plus global search (`Cmd/Ctrl+O`) with a card-type filter, plus the library filter for highlight cards. A third-party 2024 article also describes a search box on the all-highlights sidebar. ([keyboard shortcuts](https://wiki.heptabase.com/keyboard-shortcuts), [user interface logic](https://wiki.heptabase.com/user-interface-logic), [newsletter 2023-12-28](https://wiki.heptabase.com/newsletters/2023-12-28), [Goedel](https://www.goedel.io/p/unleashing-the-mind-heptabase))
- Readwise and Zotero are import doors. Readwise highlights land in the Highlight app and can be dragged onto a whiteboard. Edits made in Heptabase are kept: a later Readwise sync does not overwrite them, and deleting a highlight in Readwise does not delete it from Heptabase. ([Readwise sync](https://support.heptabase.com/en/articles/10447319-connect-and-sync-readwise), [pdf-annotation](https://wiki.heptabase.com/pdf-annotation))
- Highlights made in another PDF app are not a supported drag source. A 2023 walkthrough states that a PDF highlighted elsewhere, then uploaded, does not yield draggable passages. You highlight inside Heptabase. The 2025 changelog still records fixes for highlights made in other products displaying incorrectly, which is a display bug, not an import feature. ([YouTube 3VhtS6dmJrc](https://www.youtube.com/watch?v=3VhtS6dmJrc), [changelog 2025](https://wiki.heptabase.com/changelog/2025))
- AI chat and the Insight summary are separate tools. They can cite a PDF. They are not the highlight gesture. ([work with AI](https://wiki.heptabase.com/work-with-ai), [user interface logic](https://wiki.heptabase.com/user-interface-logic))

The feeling Heptabase is selling, in the official clips, is three moves: open the PDF beside the board, mark a passage or an area with the tools already in the reader, and drag that mark onto the board as its own card. The card still knows the spot it came from after the reader is closed.

## 2. Plexus today, step by step

Shipped behaviour, read from the worktree on 2026-10-06 and from the 2.11.x measurements in `docs/roadmap.md` §8. The user is on a board.

### 2.1 The PDF is a card, then a shielded reader

1. A `{{[[pdf]]: url}}` block, or a ref to one, is a cover card. `paintPdfCover` (`src/view/cards.js`) draws the title, the page-chip strip, the highlight count, and a button labelled **Open reader**. The title and the count come from `host.pdfCover` → `readPdfCover` (`src/host/roam.js`). That function finds the Roam page whose `:pdf/url` equals the macro url (`PDF_PAGE_QUERY`) and counts blocks on that page whose props contain `:pdf-highlight`. The cover does not fetch the file. On an encrypted graph the url may end in `.enc`. Roam's reader decrypts it.
2. **Open reader** calls `openEmbed` → `readerRule` (`src/model/pdf.js`). The card is drawn at 640×820 (`PDF_READER_W`, `PDF_READER_H`) while the stored card size stays put. `paintPdfReader` mounts `renderBlock` of the pdf block and immediately calls `armEmbedShield`. A button labelled **Interact** is the only way through the shield. A second reader closes the first and toasts "Closed the other reader."
3. **Interact** runs `beginPdfInteract`, which removes the shield and adds the class `pxd-pdf-live`. A document `keydown` listens for Escape, and a document `pointerdown` outside the reader puts the shield back. Until that click, the wheel and the pointer pan the board, and the reader ignores them. Highlighting is impossible for that first moment inside a card that is 640 by 820 px on top of the board.

Measured reader mount is one heavy embed per board. Map zoom keeps the cover. Fullscreen is Roam's own control.

### 2.2 A new highlight does not become a card

Roam writes the highlight. The block lands on the PDF page under "Notes by [[User]]" then a date page, with string text or `![](…png)`, a `#h/<colour>` tag, and `:pdf-highlight` props (`docs/roadmap-3.md`, Roam native PDF Annotator facts). The board does not gain a child.

Three placed paths exist, and none of them is a drag from the mark the user just painted:

1. Drag the highlight's bullet in Roam's outline. `parseDropPayload` (`src/model/drop.js`) reads `roam/block-uid-list-only-parents` and `roam/block-uid-list`. The 2026-10-05 measure in `docs/roadmap.md` says the overlay parts inside the reader are not draggable and the outline bullets are. No popup opened during that measure.
2. Cmd-Shift-C in Roam's reader copies a block ref. Paste on the board uses the existing `((uid))` path.
3. **Add highlights…** (`PDF_HIGHLIGHTS_LABEL` in `src/view/board-view.js`) opens `openHighlightDialog`. Rows come from `host.pdfHighlightTree` (four levels of children, `HIGHLIGHT_TREE_PATTERN`) passed through `highlightRows`. The dialog groups by the date ancestor, filters by colour and page, and offers **Select all on page**, **Place as grid** (3 columns, 300×140, gap 24), and **Place as column**. `placeHighlights` takes at most 45. Already-placed rows are disabled. One undo removes the chunk. Dropping a date block asks before expanding to its highlight children (`expandDateHighlights`).

That is four to six actions from a sentence on the page to a card on the board: Open reader, Interact, select and confirm in Roam, then outline drag or copy-paste or the dialog's tick-and-place.

### 2.3 The card, the jump, and the extras that already work

`paintHighlight` draws a 4 px bar from `#h/<colour>` (`highlightModel` in `src/model/highlight.js`: yellow, green, blue, pink, purple, orange, red, else gray), the quote via `renderString` with the tag stripped, or the area image at the `:image-size` ratio, and a footer `p. N · <page title>`. It does not draw the highlight block's children. A note, if Roam stored one as a child, is invisible on the card. Map zoom shows the bar and the first line.

**Open in reader** is on the hover toolbar (`src/view/chrome.js`), wired to `openHighlightInReader` (`src/view/board-view.js`). It resolves the highlight's page uid, reads `:pdf/url` with `pdfPageUrl`, and finds a PDF card with `pdfCardForUrl`. On a match it calls `openPdfAt`, which opens the card reader and writes the page number into the reader's page input (`writeReaderPage`). The 2026-10-05 live check set that input to 1, then to 2, and the mark was on that page. The button wrote nothing. With no PDF card on the board, `openBlock` runs and a toast says "Click the highlight to open the PDF."

The same day, a click on `.rm-pdf-highlight-color-icon` in a closed render opened a fullscreen reader and left the Test Lab page. The same click still went fullscreen when a reader was already mounted. Plexus therefore does not dispatch that click. `openPdfAt` sets the page. It does not scroll to `boundingRect`. There is no flash on the card.

Page chips (`pageChips`, `paintPdfChipStrip`) show one chip per page that already has a highlight card. A click pulses those cards after 280 ms. A double-click opens that page. The strip is on the cover and on the reader header. The 2026-10-05 measure found text marks in the mounted reader and zero highlight lists, so there is no Roam list inside the reader to hang an "On board" chip on. `src/boardchips.js` puts **On board** on outline rows instead.

Area highlights are image cards and accept regions (PDF-5). The colour picker calls `session.setHighlightColor`, which rewrites `#h/` via `rewriteHighlightTag` and does not touch props. The 2026-10-05 measure: a tag rewrite turned the outline swatch green after reload, and the marks on the page stayed yellow. The card bar follows the tag. The ink in the PDF did not. The lens can dim to one highlight colour. Kanban can lane by "Highlight colour."

Match key, also measured that day: those text highlights had no `:pdf-fingerprints`. The page title had no md5. The hash on the block matched the page hash. Cards match on `:pdf/url`, not on a fingerprint parsed out of the title.

### 2.4 Where it feels slow

- Two clicks before a highlight is possible, inside a fixed 640×820 card, with a shield that drops on any board click.
- The mark you just made is on the PDF page, not on the board. The drag source that works is an outline bullet, which is a different pane of Roam.
- Jumping back is a hover-toolbar button, then a page number. The sentence is not flashed. The native click that would scroll to it also leaves the board.
- One reader. Opening a second PDF unmounts the first.
- A note child never reaches `paintHighlight`.

What already matches Heptabase, and should stay: the highlight is a real block, the card shows the passage or the figure and the page, colour is a tag, area figures can be marked up, and closing the reader leaves the cards on the board.

## 3. Gap table

| Heptabase behaviour | Plexus today | Proposed Plexus behaviour | Roam constraint |
|---|---|---|---|
| PDF opens in a side panel or a card tab, beside the whiteboard. | **Open reader** grows the card to 640×820 and covers the board. **Interact** lifts a shield. Escape or a board click puts the shield back. | **Open reader** opens a pane on the right of the mount. The card stays a cover. The pane's reader is `renderBlock`, live, with no shield. | The reader is still Roam's annotator. One heavy embed per board (`readerRule`). Do not write `:pdf-settings`. |
| Select text, or press `S`. `A` adds a note. `D` sends the highlight to the open whiteboard. | Highlighting works only after Interact, and only with Roam's own controls. Nothing in Plexus maps S, A, or D. | The pane is live, so Roam's select-to-highlight and Alt-drag area highlight work at once. S, A, and the note button stay Roam's. A **Place** control on the new list is the D-shaped action. | Creating a highlight is Roam's write. Plexus does not call an API to mint `:pdf-highlight`. No new command-palette entry (the palette stays at two). |
| Area highlight is Cmd/Ctrl-drag or the area tool. The card is the image and still locates. | Alt-drag in Roam's reader. The card is an image card with the PDF footer and optional regions. | The list shows area rows with the image. Dragging one places the same image card. Locate uses the pane. | Area bytes and `:image-size` stay Roam's. `.enc` images render through `renderString` / `renderBlock`, never a hand-built `<img>`. |
| Colour on the highlight, and sort by page or time. | Seven `#h/` names. The card bar follows the tag. Measured 2026-10-05: the outline swatch followed a tag rewrite and the page mark stayed yellow. | Keep the tag rewrite for the card, the list bar, and the lens. Say in the tooltip that the mark inside the PDF changes when Roam changes it. | Do not write `:pdf-highlight` to recolour. The page-mark lag is measured. |
| Highlight list on the PDF tab and on the whiteboard tab. Drag from that list. | The mounted reader has zero highlight lists (measured). **Add highlights…** is a modal with checkboxes. Outline bullets are the drag source. Overlay marks are not draggable (measured). | A list in the pane, built by `highlightRows` from `pdfHighlightTree`. Drag a row. The modal stays for bulk place. | The list is a view of Roam blocks. It stores nothing. A pull watch on the PDF page while the pane is open, removed on close. |
| Drag the highlight onto the whiteboard. One card. The library still owns it. | Bullet drag, paste, or the modal. The modal refuses a second card for a uid that is already placed. | Drag sets `application/x-plexus-card` to `((uid))`, which `parseDropPayload` already accepts. A uid that is already a card pulses that card and does not create another. | One `((uid))` create. Cap 45 still applies to the modal. The drag is one create. |
| Card shows passage, source, colour, and the note. | Bar, quote or image, `p. N · title`. Children are not painted. | Under the quote, the first child that is not itself a highlight. A Note action creates that child only after a live trace shows Roam's note button uses a child. | If the trace shows a different shape, show that shape. Do not invent a parallel note. |
| Locate reopens the PDF at the original spot. The 2024 walkthrough focuses a figure. | **Open in reader** sets the page input. That landed on the right page in Test Lab. A click on the colour icon goes fullscreen and leaves the board. | Clicking the card footer, or **Open in reader**, opens the pane, sets the page input, and flashes the card. A rect scroll inside `.rm-pdf-container` ships only if a measure shows the rect's coordinate space. | Do not dispatch the colour-icon click. Zero graph writes on the jump. Match cards by `:pdf/url`. |
| Cards remain after the reader closes. | Ref cards remain. Jumping back with no PDF card on the board calls `openBlock` and a toast. | The pane can open from a highlight card by resolving the pdf block from the page url, so the board does not need the reader card to be the open one. The cover card can stay a cover. | `renderBlock` needs the pdf block uid. If the lookup finds none, keep today's `openBlock` and toast. |
| Several PDFs, and a sidebar that can hold more than one card. | One open reader. The second close toasts and unmounts the first. | One pane, one live reader. A switcher in the pane lists the PDF cards on this board. Choosing another uses `readerRule`. | Same one-embed rule. A second `renderBlock` of a pdf is a second reader and is out of scope. |
| Search inside the PDF, and filters on the highlight library. | Roam's search works only in Interact mode. The modal filters colour and page. | With the pane live, Roam's own find box is the PDF search. The list filters colour, page, and snippet. | No second full-text index of the file. Do not fetch the PDF. |
| Readwise and Zotero imports. | Whatever Roam already stored as highlight blocks shows up. Nothing else does. | Unchanged. | No Readwise token, no Zotero sync, no PDF-annotation import. |
| Foreign highlights inside an uploaded PDF are not a drag source. | Same, because Plexus only sees Roam blocks. | Same. | Do not parse the PDF file for annotations. |

## 4. Proposed design

### 4.1 The pane

The board stays the canvas. The reader leaves the card.

```
+------------------------------------------------------------------+
| Board (pan and zoom unchanged)            | Paper.pdf        [x] |
|                                           | p. 12 / 40           |
|  +------------+     +------------------+  | +------------------+ |
|  | PDF cover  |     | | quote of the   |  | |                  | |
|  | 14 hl      |     | | sentence       |  | |  Roam's reader   | |
|  | [2][12]    |     | note: why it     |  | |  renderBlock     | |
|  | Open reader|     | matters          |  | |  live, no shield | |
|  +------------+     | p.12 · Paper     |  | |                  | |
|                     +------------------+  | +------------------+ |
|                                           | Highlights           |
|                                           | yellow  p.12  ...... |
|                                           | green   p.13  [img]  |
|                                           | pink    p.13  On board |
+------------------------------------------------------------------+
         ^                                      |
         |          drag a list row             |
         +--------------------------------------+
```

- The pane is a sibling of `.pxd-world` inside `.pxd-root`, class `pxd-read`. It is outside the transformed world, so a wheel over the reader does not zoom the board, and the embed shield is unnecessary. Pointer events on the pane stop at the pane.
- Default side is the right, about 42% of the mount, minimum 360 px, maximum 720 px. A splitter writes the width to localStorage under `plexus-diagram:read:${graph}`. No Roam write. Below 720 px of mount width the pane stacks under the board instead of beside it, which is the sidebar-board case.
- **Open reader** on the cover calls the existing `openEmbed` / `readerRule` and mounts `renderBlock` in the pane. The card stays at its cover size. `paintPdfReader` stops growing the card to 640×820.
- Close unmounts that `renderBlock`, clears `pdfOpenUid`, and leaves every card where it is. Escape closes the pane only when the event target is pane chrome and not a text field (`isTextEntryTarget` already exists). Escape inside Roam's reader belongs to Roam. The document `keydown` that `armPdfLiveWatch` adds goes away with the shield.
- One pane. `readerRule` still closes the previous reader. The toast stays.
- CSS stays under `.pxd-read` and the existing `.pxd-root`. No rule on `.rm-pdf-container` at document scope.

Opening a highlight from a card when the cover is closed:

```
click footer "p.12 · Paper"
        |
        v
pane opens (same renderBlock) --> page input set to 12 --> card flashes
```

The page input is the measured path (`writeReaderPage`, Test Lab 2026-10-05, page field 1 then 2, zero writes). A flash is a two-second class `pxd-item--flash` on the highlight card. Scrolling the reader's inner scroller so `boundingRect` sits in view is a follow-up inside PDFH-4, gated on a measure. Until that measure, the page is the jump.

### 4.2 The list

The list is the Highlight tool. It reads `pdfHighlightTree` for the open PDF's page uid and `highlightRows` for colour, snippet, page, and placed. `watchPage` (`src/host/roam.js`) on that page title runs while the pane is open and the returned unsubscribe runs on close, so a highlight Roam just created appears without a reload. The watch writes nothing.

Each row is a colour bar, an 80-character snippet, `p. N`, and **On board** when `placed` is true. Area rows show the image through the same `renderString` the card uses. A text field filters the snippet. The colour and page selects move out of the modal's ideas and into this list. Sort is page, then the block order Roam already returned. Creation-time sort waits until a row actually carries `:create/time` in the pull. The tree pattern today does not ask for it.

Clicking a row sets the page input and selects the row. It does not create a card.

**Add highlights…** stays on the PDF card for the bulk grid and the 45 cap. The list is the one-at-a-time path. The modal is not removed.

Drag: the row's `dragstart` sets `application/x-plexus-card` (`CARD_MIME`) to `((highlightUid))`. `parseDropPayload` already returns that string first. The board drop path creates one ref card at the cursor. If that uid is already a card on this board, the drop pulses the existing card and creates nothing. One undo removes a card that was created.

**Place** on the focused row does the same create, to the right of the PDF cover, using the origin `openHighlightPicker` already computes. That is the stand-in for Heptabase's `D`. It is a button, not a palette command.

The list does not listen on `document`. Keys bind on `.pxd-read`: Enter jumps to the row's page, and the Place button is the mouse path. `Cmd/Ctrl+F` is Roam's once focus is in the reader.

### 4.3 The highlight card

The card PDF-2 already draws gains two things.

- The first child of the highlight block that is not a highlight itself, rendered with `renderString` under the quote, clipped to about four lines. `HIGHLIGHT_TREE_PATTERN` already pulls one child level under the highlight (page, Notes by, date, highlight, child). `highlightRows` does not copy those children today. PDFH-5 adds them to the row and to `highlightModel`.
- The footer `p. N · title` is a button. It runs the jump in §4.1. Dragging the card still moves the card. The body is not the jump target.

A **Note** action is visible only after the measure in PDFH-5. If Roam's note button already creates a child, the action focuses that child with `renderBlock` and creates nothing when the child exists. If the measure shows the note lives in the highlight string, the card shows the string and the action is omitted. If the measure shows no note shape at all, the action creates one plain child block, one write, and focuses it. That create is the fallback, and it does not write props.

Colour, lens, regions on area images, page chips, and outline **On board** stay as they are.

### 4.4 Several PDFs

The pane header is the open PDF's title and a control that lists every PDF card on this board (kind `pdf`, url from `pdfMacroUrl`). Choosing one runs `readerRule`. Highlight cards from a closed PDF stay on the board and still open the pane, because the jump looks up the pdf block by `:pdf/url` rather than requiring that card's reader to be the thing under the pointer.

The pane does not open a second reader for a comparison. Two PDFs side by side would break the one-embed rule and the shield measurements.

### 4.5 What this phase refuses

- A PDF.js (or any other) renderer.
- A write to `:pdf-highlight` or `:pdf-settings`, including a write that would recolour the page mark.
- A dispatch of the highlight colour icon. Measured result is a fullscreen reader that leaves the board.
- A document-level key listener. This phase removes the interact Escape listener rather than adding another. The command sheet keeps its own Escape handler.
- A third palette command.
- Readwise, Zotero, or an import of annotations embedded by another app.
- Editing the quoted text. A string rewrite can desync the mark Roam painted. The tag rewrite is the only string write, and it already exists.
- AI summaries of the PDF.

## 5. Implementation plan

Paste into `docs/roadmap-3.md` as a new `## P27 — PDF highlights beside the board (2.18.0)` before the P22 tasks, plus this row in the phase table: P27, PDF highlights beside the board, 2.18.0, PDFH-1 through PDFH-7 and DOC-27. P27 ships before P22, the same way P23–P26 do. Line numbers below are the worktree on 2026-10-06 and will drift. Function names are the contract.

### PDFH-1 — Open the PDF in a pane beside the board
- Phase: P27 · Version: 2.18.0 · Effort: L · Priority: high · Depends: none
- Summary: Open reader mounts Roam's reader in a pane beside the board. The PDF card stays a cover at its own size. The pane is live, so highlighting needs no Interact click. Closing the pane leaves every card in place and writes nothing.
- Roam model: Read-only. `renderBlock` of the existing pdf block. No `:pdf-settings` write, no `:pdf-highlight` write, no new block. The pane width is localStorage `plexus-diagram:read:${graph}`, the same class of store as the viewport.
- Design: The pane is `.pxd-read`, a sibling of `.pxd-world` inside `.pxd-root`, default right, 42% of the mount, clamped to 360–720 px. Under 720 px of mount width it stacks below the board. `readerRule` still allows one open uid, and a second open toasts "Closed the other reader" and unmounts the first. Escape closes the pane only when the target is pane chrome and `isTextEntryTarget` is false. The close control always unmounts. Wheel events over the pane do not zoom the board.
- Build tips: Stop calling the 640×820 draw in `pdfReaderBox` / `drawnRect` / `applyPdfSize` (`src/view/cards.js`, `pdfReaderBox` at line 2320, `drawnRect` at line 2325, `applyPdfSize` at line 2339, `PDF_READER_W` and `PDF_READER_H` in `src/model/pdf.js` lines 5–6). Mount `renderBlock` from `paintPdfReader` (line 2405) into the pane instead of `rec.body`. Delete the shield path for this reader: `beginPdfInteract` (line 2380) and the document listeners in `armPdfLiveWatch` (line 2349). Keep `readerRule` (line 68) and `openEmbed` (line 2462). `armEmbedShield` stays for iframes, video, and tweets (`EMBED_SEL` at line 542). The splitter key follows `createViewportStore` (`src/host/roam.js` line 292). CSS only under `.pxd-read`.
- Acceptance: 1. Open reader on a PDF card leaves the card's width and height unchanged and shows `.rm-pdf-container` inside `.pxd-read`. 2. A text selection in that reader can create a highlight with no Interact click, and the new block is Roam's, with `:pdf-highlight` present and no `plexus` prop written by Plexus. 3. Opening a second PDF unmounts the first reader and leaves one `.rm-pdf-container` owned by Plexus. 4. Close, and Escape on the list, remove the pane and leave the board block's `:edit/time` unchanged. 5. A wheel over the pane does not change the board zoom, and a wheel over the board still zooms. 6. `document` keydown listeners registered by Plexus do not grow when the pane opens. 7. `npm run check` is green.
- Out of scope: The highlight list (PDFH-2). A second simultaneous reader. Writing `:pdf-settings`.
- Revisit when: n/a

### PDFH-2 — List this PDF's highlights in the pane
- Phase: P27 · Version: 2.18.0 · Effort: M · Priority: high · Depends: PDFH-1
- Summary: The pane lists every highlight on the open PDF's page: colour bar, snippet, page, and On board when a card already exists. A highlight created in the reader shows up in the list without a reload. Clicking a row turns the reader to that page.
- Roam model: Read-only. The list is `pdfHighlightTree` plus `highlightRows`. A `watchPage` on the PDF page title is held while the pane is open and released on close. No block write.
- Design: Rows sort by page, then Roam's child order. Filters are colour, page, and a snippet substring. Area rows render the image string. On board uses the placed set `highlightRows` already computes. Clicking a row calls the page-input path (`writeReaderPage`) and does not create a card. The Add highlights… modal stays on the card for bulk placement.
- Build tips: `host.pdfHighlightTree` (`src/host/roam.js` line 1235) and `HIGHLIGHT_TREE_PATTERN` (line 158). `highlightRows` (`src/model/highlight-pick.js` line 94). `watchPage` (line 868) returns the unsubscribe. `pdfCover` (line 1266) supplies `pageUid` and the title `watchPage` needs. Reuse `openPdfAt` (`src/view/cards.js` line 2499) against the pane's reader. The 2026-10-05 measure found zero highlight lists inside `.rm-pdf-container`, so this list is the list. Do not decorate `.rm-pdf-highlight`. Release `watchPage` in the pane's close and in view dispose.
- Acceptance: 1. A PDF page with two highlights on pages 1 and 2 shows two rows, with `p. 1` and `p. 2` and the `#h/` colour on the bar. 2. Creating one highlight in the pane's reader adds one row without a manual reload, and closing the pane drops `stats.pageWatches` by one. 3. A row whose uid is already a card shows On board. 4. Clicking the page-2 row sets the reader page input to 2 and writes nothing (`:edit/time` of the board unchanged). 5. The snippet filter hides a row whose text does not contain the query. 6. An area highlight row shows the image. 7. `npm run check` is green.
- Out of scope: Dragging a row (PDFH-3). Sorting by `:create/time`. A graph-wide highlight app.
- Revisit when: n/a

### PDFH-3 — Drag a highlight from the list onto the board
- Phase: P27 · Version: 2.18.0 · Effort: M · Priority: high · Depends: PDFH-2
- Summary: Dragging a list row onto the board creates one highlight card at the drop point. Place on the focused row creates one card beside the PDF cover. A highlight that is already a card pulses that card and creates nothing.
- Roam model: One `((highlightUid))` child of the board per new card, through the existing ref-card create. No `:pdf-highlight` write. The 45 cap stays on the modal. This gesture places one.
- Design: `dragstart` sets `application/x-plexus-card` to `((uid))`. The drop lands in the current board drop handler. Place uses the origin already computed beside the PDF card (cover right edge plus 40 px). Both paths select the new card. A placed uid pulses and does not call create.
- Build tips: `CARD_MIME` and `parseDropPayload` (`src/model/drop.js` lines 7 and 12) already prefer that mime. The drop listener is `src/view/board-view.js` line 4622, and `openHighlightPicker`'s origin is lines 4563–4566. `session.addRefCards` is what the modal's `onPlace` calls (line 4573). Placed detection is `placedSet` (`src/model/highlight-pick.js` line 60). The 2026-10-05 measure says overlay marks are not draggable, so the list row is the drag source. Do not try to drag `.rm-pdf-container`. One undo group, one create.
- Acceptance: 1. Dragging a list row that is not On board creates one card whose string is `((uid))` of that highlight, and one undo removes it. 2. Dragging an On board row creates zero blocks and pulses the existing card. 3. Place on a new row creates one card to the right of the cover and selects it. 4. A drop of five rows is five creates only if the user dragged five, and a single row drag is one create. 5. The board's highlight props for that uid are unchanged across the create (`:pdf-highlight` deep-equal before and after). 6. `npm run check` is green.
- Out of scope: Dragging the painted mark inside Roam's reader. The 45-card grid. Removing Add highlights….
- Revisit when: n/a

### PDFH-4 — A highlight card opens the pane on its page and flashes
- Phase: P27 · Version: 2.18.0 · Effort: M · Priority: high · Depends: PDFH-1
- Summary: The footer on a highlight card, and Open in reader, open the pane and set the reader to that highlight's page, then flash the card. This works when the PDF card on the board is still a cover. The native colour-icon click is not dispatched.
- Roam model: Read-only. Page change goes through the reader input (`writeReaderPage`). No graph write. The pdf block is found by `:pdf/url` on the highlight's page.
- Design: The footer is a button. The card body still drags and edits. Flash is class `pxd-item--flash` for 2 seconds. If no pdf block uid can be resolved, keep `openBlock` plus the toast "Click the highlight to open the PDF". A scroll-to-rect inside the reader ships in this task only when a Test Lab measure shows a scroller whose coordinates match `position.boundingRect`. Otherwise the task records the miss in `docs/roadmap.md` §8 and ships the page jump alone.
- Build tips: `openHighlightInReader` (`src/view/board-view.js` line 3160), `pdfCardForUrl` (`src/model/pdf.js` line 234), `pdfPageUrl` (`src/host/roam.js` line 1246), `writeReaderPage` (line 245 of `src/model/pdf.js`), `openPdfAt` (`src/view/cards.js` line 2499). The forbid is measured in `docs/roadmap.md` §8 on 2026-10-05: a click on `.rm-pdf-highlight-color-icon` opened fullscreen and left Test Lab. Lookup of the pdf block is a read of blocks whose string contains the url, scoped to the `:pdf/url` page's refs, and it must not fetch the file. Do not add a document listener.
- Acceptance: 1. With the PDF card on the board in cover state, activating the footer opens `.pxd-read`, sets the page input to the highlight's `pageNumber`, and adds `pxd-item--flash` to that card. 2. The click writes nothing. 3. With no resolvable pdf block, `openBlock` runs once and the toast shows, and no pane is left mounted. 4. A test that dispatches a click on `.rm-pdf-highlight-color-icon` is absent from the implementation. 5. The §8 row says whether rect scroll matched, and a mismatch leaves the page-input behaviour in place. 6. Dragging the card body still moves the card. 7. `npm run check` is green.
- Out of scope: Flashing the ink inside the PDF. A custom scroll coordinate system invented without the measure.
- Revisit when: n/a

### PDFH-5 — Show the note on the highlight card
- Phase: P27 · Version: 2.18.0 · Effort: M · Priority: medium · Depends: PDFH-2
- Summary: The highlight card shows the note Roam already stored, and a Note action edits that note. The action's write is chosen only after a live trace of Roam's own note button. Until that trace, the card shows a child when one exists and does not create one.
- Roam model: The note is a child of the highlight block if the trace says so. The create, when allowed, is one plain child block. No `:pdf-highlight` write. No second store.
- Design: `highlightModel` gains `note`, the string of the first child that fails `highlightRecord`. `paintHighlight` renders it under the quote, clipped. The list row shows a note mark when `note` is non-empty. The Note action is hidden until the trace. After the trace: if Roam already created the child, the action focuses it with `renderBlock` and creates nothing; if Roam stores the note in the highlight string, the action is omitted and the string is what the card shows; if Roam stores no note, the action creates one child and focuses it. The trace is a §8 row before the create ships.
- Build tips: `HIGHLIGHT_TREE_PATTERN` (`src/host/roam.js` line 158) already pulls one level under the highlight. `rowFrom` (`src/model/highlight-pick.js` line 72) omits children today. `highlightModel` (`src/model/highlight.js` line 121) and `paintHighlight` (`src/view/cards.js` line 2542). Focus uses `renderBlock` on the child, the same mount discipline as other card editors, and must not stop `mouseup` inside that editor. Gate the create behind the §8 row so a wrong guess cannot write.
- Acceptance: 1. A highlight block with one non-highlight child renders that child's string on the card and a note mark on the list row. 2. A highlight with no children renders no note and writes nothing when the card is painted. 3. The §8 row names what Roam's note button created (child uid, string edit, or neither) on Test Lab. 4. The Note action creates a block only in the "neither" case, exactly one create, and one undo removes it. 5. `:pdf-highlight` on the parent is deep-equal before and after the note create. 6. `npm run check` is green.
- Out of scope: Rich notes (images, tasks) as a designed layout. Editing the quoted highlight string. Rewriting Roam's highlight props.
- Revisit when: n/a

### PDFH-6 — Area rows and colour stay on Roam's data
- Phase: P27 · Version: 2.18.0 · Effort: S · Priority: medium · Depends: PDFH-2
- Summary: Area highlights in the list and on the card stay images. Colour stays the `#h/` tag. The pane does not promise that a tag rewrite recolours the mark painted on the page, because a 2026-10-05 measure showed the page mark staying yellow.
- Roam model: No new writes. `setHighlightColor` remains the one string rewrite. Area `:image-size` and `:pdf-highlight` are read.
- Design: An area row uses the image renderer and the PDF footer, and it drags through PDFH-3 as the same `((uid))`. The colour control on a highlight card still offers the seven names. The tooltip on that control says the card and the list follow the tag, and the mark in the PDF changes when Roam's reader changes it. Lens and Kanban "Highlight colour" stay.
- Build tips: `naturalSize` and `highlightModel` (`src/model/highlight.js` lines 108 and 121). `setHighlightColor` (`src/session.js` line 1613) and `rewriteHighlightTag` (line 100). The measure is `docs/roadmap.md` §8, 2.11.2: tag rewrite turned the outline swatch green (167,232,200) and the page marks stayed yellow (255,234,133), prop keys unchanged. Do not add a props write to "fix" the page mark.
- Acceptance: 1. An area row shows the image at the `:image-size` ratio and drags as one card. 2. Setting the card colour from yellow to green changes the block string's tag and leaves `:pdf-highlight` and `:image-size` deep-equal. 3. The list bar and the card bar are green after that write. 4. The tooltip text includes the measured limit that the page mark may stay yellow. 5. The highlight-colour lens still dims the other cards. 6. `npm run check` is green.
- Out of scope: A new colour name. Repainting Roam's page mark. Region editing (PDF-5 already does that).
- Revisit when: A later measure shows the page mark follows a tag rewrite. Then delete the tooltip sentence.

### PDFH-7 — One reader, every PDF on the board, no new command
- Phase: P27 · Version: 2.18.0 · Effort: S · Priority: medium · Depends: PDFH-1, PDFH-3
- Summary: The pane header switches among PDF cards on this board and keeps a single live reader. Keyboard shortcuts for the list live on the pane. The command palette stays at two entries. Roam's find box is the PDF search.
- Roam model: None. Switching readers unmounts one `renderBlock` and mounts another. No block write.
- Design: The header lists kind `pdf` items on the current board by `coverModel` title. Choosing one runs `readerRule`. Arrow keys while the list (not the reader) is focused move the row selection. Enter jumps to that row's page. The Place button is in the row. `Cmd/Ctrl+F` is not rebound. No `document` listener and no palette command.
- Build tips: `readerRule` (`src/model/pdf.js` line 68). Palette rule is roadmap §3.7, and `docs/roadmap.md` records the two-entry cap. Bind `keydown` on `.pxd-read` and ignore events whose target passes `isTextEntryTarget` or sits inside `.rm-pdf-container`. `coverModel` is `src/model/pdf.js` line 40. Confirm the palette array length in the test rather than adding a command.
- Acceptance: 1. A board with two PDF cards shows both titles in the pane header, and choosing the second leaves one `.rm-pdf-container`. 2. Enter on a list row sets the page input and creates no block. 3. A keydown whose target is inside `.rm-pdf-container` is ignored by the pane handler. 4. The command palette registration count is unchanged by this phase. 5. `npm run check` is green.
- Out of scope: A shortcut that creates a highlight (that stays Roam's S inside the reader). Two readers. A full-text index.
- Revisit when: n/a

### DOC-27 — P27 gate and release 2.18.0
- Phase: P27 · Version: 2.18.0 · Effort: S · Priority: high · Depends: PDFH-1, PDFH-2, PDFH-3, PDFH-4, PDFH-5, PDFH-6, PDFH-7
- Summary: Standing gate for the reading pane, then release 2.18.0. The gate checks that a highlight session writes no `:pdf-*` props, that the palette stays at two entries, and that unload removes the pane.
- Roam model: None.
- Design: CHANGELOG 2.18.0 and a README paragraph of at most 120 words: the pane, the drag from the list, and the footer jump. Shortcuts in the README stay inside the existing two palette commands. The §8 rows from PDFH-4 (rect scroll) and PDFH-5 (note shape) are filled before the tag.
- Build tips: `npm run check`. Run `node tools/live/perf-gate.mjs "Readwisenotes - "` and `node tools/live/smoke.mjs "Readwisenotes - "`. Typing bench on Test Lab: pane closed, no board, median at most +0.1 ms per key; pane open, record the median and keep it at most +0.5, the DOC-20 reader allowance. Tag `v2.18.0` only after the Pages `cmp` matches. P22 stays 3.0.0 and ships after this. Git author Svyatoslav Kleshchev, new commits only.
- Acceptance: 1. `npm run check` green. 2. `node tools/live/perf-gate.mjs "Readwisenotes - "` exits 0. 3. `node tools/live/smoke.mjs "Readwisenotes - "` exits 0. 4. One live check from each of PDFH-1, PDFH-3, and PDFH-4 passes on this build, and the PDFH-4 check records zero `:pdf-highlight` writes. 5. Unload leaves 0 `.pxd-*`, including `.pxd-read`, listeners and watches at baseline, and `window.__plexusDiagram` removed. 6. The command palette still has two Plexus entries. 7. Published files byte-identical to the build. 8. Ledger empty.
- Out of scope: A Depot PR. 3.0 planning. Readwise or Zotero.
- Revisit when: n/a

## 6. Risks and open questions

These are decisions the measurements cannot make.

1. Pane against Roam's right sidebar. This design puts `.pxd-read` inside the board mount so a drag never crosses a Roam window boundary. Roam's sidebar (`openInSidebar`) is the other reading surface, and highlight drag out of it is the path the 2026-10-05 measure already failed for overlay marks. The recommendation is the in-mount pane. Say if you want the sidebar instead.
2. Where the jump is clicked. The footer is the target so a drag of the card body still moves the card. A click on the whole card is closer to Heptabase and will fight the drag. Say if you want the whole card, with a movement threshold.
3. Note shape is unmeasured. PDFH-5 shows an existing child immediately and refuses to create one until a Test Lab trace of Roam's note button is in §8. If you already know the note is a child, say so and the create can ship in the same task.
4. Rect scroll is unmeasured. The page input is proven. Scrolling to `boundingRect` ships only if the reader's scroller uses that space. Expect the first release to land on the page and flash the card.
5. One reader. Heptabase can hold several cards in the right sidebar. A second live PDF reader doubles the heavy embed and the typing cost DOC-20 capped. The switcher is the proposal. Say if a second reader is worth the cost.
6. Sidebar boards. A board open in Roam's right sidebar is narrow, so the pane stacks under it below 720 px. Say if sidebar boards should keep today's in-card reader and leave the pane to the main window only.
7. Page-mark colour. Rewriting `#h/` updates the card and, on 2026-10-05, the outline swatch, and it left the yellow ink on the page. The design does not paper over that with a props write. Say if you would rather hide the colour control until Roam's ink follows the tag.
8. Quote editing. Heptabase lets you edit the highlight text. Doing that here rewrites the block Roam's reader paints from. It stays out of scope unless you want a measured experiment.
9. Creation-time sort. The public wiki sorts PDF highlights by page or by creation time. The tree pull does not request `:create/time`. Page order is the default. Say if you want the extra pull field and a toggle.

## Sources

Official:

- Heptabase Public Wiki, "Read PDFs, media, eBooks & webpages", fetched 2026-10-06. https://wiki.heptabase.com/pdf-annotation
- Heptabase Public Wiki, "User Interface Logic", fetched 2026-10-06. https://wiki.heptabase.com/user-interface-logic
- Heptabase Public Wiki, "Keyboard Shortcuts", fetched 2026-10-06. The PDF table is under "Reading and highlighting PDFs". https://wiki.heptabase.com/keyboard-shortcuts
- Heptabase Public Wiki, "Fundamental Elements", whiteboards do not own cards. https://wiki.heptabase.com/fundamental-elements
- Heptabase Public Wiki, newsletter 28 September 2023, highlight colour and sort. https://wiki.heptabase.com/newsletters/2023-09-28
- Heptabase Public Wiki, newsletter 28 December 2023, highlight cards, library filter, multiple right-sidebar items. https://wiki.heptabase.com/newsletters/2023-12-28
- Heptabase Public Wiki, newsletter 25 October 2024, highlight cards as mind-map nodes. https://wiki.heptabase.com/newsletters/2024-10-25
- Heptabase Public Wiki, "Work with AI", chat over a PDF is a separate tool. https://wiki.heptabase.com/work-with-ai
- Heptabase Public Wiki, changelog 2025, display fixes for highlights made in other products. https://wiki.heptabase.com/changelog/2025
- Heptabase Help Center, "Connect and sync Readwise". https://support.heptabase.com/en/articles/10447319-connect-and-sync-readwise
- Heptabase, "How to annotate a PDF and place annotations onto the whiteboard?", 25 September 2025. https://www.youtube.com/watch?v=JFIcuMPD0Zk
- Heptabase, "Get Started with Heptabase: Visualize your PDF highlights", 27 November 2025. https://www.youtube.com/watch?v=8fAz8zWZa2g
- Heptabase Fundamentals 101, 3 January 2024, locate, area highlight, notes, right sidebar. https://www.youtube.com/watch?v=HgvR2QkfwG0

Third party, used where the wiki is silent, and labelled as such in the text:

- fpnotes, "Drag-and-drop PDF highlights in Heptabase", 3 November 2023. Colour bar, note travels with the card, no import of highlights made in another app. https://www.youtube.com/watch?v=3VhtS6dmJrc
- Alexander Rink, "Unleashing the Mind: Heptabase", 11 February 2024. Seven colours, notes as blocks, sidebar search. https://www.goedel.io/p/unleashing-the-mind-heptabase

Plexus, this worktree:

- `src/model/pdf.js`, `src/model/highlight.js`, `src/model/highlight-pick.js`, `src/model/pdf-chips.js`, `src/model/drop.js`
- `src/view/pdf-chip-strip.js`, `src/view/cards.js`, `src/view/board-view.js`, `src/view/chrome.js`
- `src/host/roam.js`, `src/session.js`, `src/boardchips.js`
- `docs/roadmap-3.md` P20 and the Roam native PDF Annotator facts
- `docs/roadmap.md` §8 entries dated 2026-10-05 for 2.11.1 through 2.11.4
- `CHANGELOG.md` 2.11.0 through 2.11.4
