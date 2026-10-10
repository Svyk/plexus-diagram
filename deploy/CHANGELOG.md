# Changelog

## 3.12.0 — 2026-10-10

Photographed and scanned pages: figures found inside the page, no invented tables, and more tables read right on old scans.

- **Figures inside photos and scans.** A photographed or scanned page is one picture, so Plexus now finds the charts, plates, sketches and maps inside it from the ink, and links their captions, including chart titles without "Fig." and German "Abb." plates. On our set of 57 newer pages (photos, handwriting, modern documents, mixed layouts) figures are found at F1 0.85 (was 0.39) and half of the captions are linked (was 7%).
- **No invented tables.** Letters, handwritten notes, photographed title pages, contents lists and the labels inside a chart are no longer turned into tables; a table needs real tabular content (a value column or a header over body rows).
- **Tables on old scans.** Columns split by partial rules or a short right edge are kept, unit lines and lab-id rows are header rows, and when two readings disagree the one the page text supports wins. On our 27-page set of 1890–1920 scans, High accuracy now reads 74% of table cells exactly (was 39% in 3.11.0).
- Cached parses from earlier versions are refreshed automatically.

## 3.11.0 — 2026-10-10

Scanned and born-digital PDFs read more accurately: fewer false figures, captions found, more tables right, and a High accuracy read that gives the same answer every time.

- **Figures and captions on scans.** Library stamps, page-edge stripes, rules and text blocks are no longer taken for figures; a real drawing is never dropped, even when its caption runs across it. Captions that start with Fig., Figure, Plate, Abb. or Tafel are linked to their figure, including a caption set sideways beside a plate. On our set of 62 scanned technical pages (1900–1950), High accuracy now finds figures at F1 0.98 (was 0.92) and links 89% of captions (was 77%).
- **Tables on old scans.** Narrow numeric columns that a spanning header had glued together are split again; contents lists under a plate stay lists; a numbered index or an equation is not turned into a table.
- **Tables in born-digital PDFs.** Booktabs-style rows, leader-dot columns and regression tables stay tables. High accuracy also asks the layout model about tables on pages with a text layer, and keeps a table only when its words are on the page.
- **High accuracy.** The same PDF gives the same reading every time (fixed decoding; the model weights are pinned and checked by SHA-256 on first use). The layout model and the reader run only on pages where they can change the result.
- **Fixes:** a blank High accuracy cell no longer erases text the page shows; a running head is not taken for a plate title.
- Cached parses from earlier versions are refreshed automatically.

## 3.10.0 — 2026-10-09

Draw a region freehand, delete an arrow cleanly, read PDFs with LlamaParse, and read old scans far better on your own Mac.

- **Image regions.** Regions sit exactly on the picture, even on a tall card with empty space below the image, and stay there after a redraw, resize or zoom. Draw around a part of an image with the pen (press P while marking, or pick Pen): the outline follows your hand and is saved in the freehand format Roam Plexus also reads. An arrow to a region enters the picture and stops on the region's edge, and hovering or selecting that arrow outlines its region in blue.
- **Deleting an arrow cleans up.** Deleting an arrow (Delete, Backspace in its empty label, the toolbar trash, the right-click menu or Cut) also deletes the region it made, when nothing else uses that region. One ⌘Z brings both back.
- **Arrow toolbar.** The toolbar for a selected arrow is about 290 px wide instead of 800: direction, colour, label and delete stay on the bar; style, width and the rest open from small menus. It sits clear of both cards the arrow connects.
- **LlamaParse (cloud).** Read with LlamaParse sends a PDF to LlamaParse with your own key, after a confirm that shows the tier, the page count and the cost (Agentic is 10 credits, about $0.0125, a page; re-reading within 48 hours is free). Without a local helper it goes through a relay that stores nothing. Plexus keeps LlamaParse's tables and text and uses its own figure boxes where it has read the page, which scored better than LlamaParse alone in our tests. Mistral OCR is there as a second, no-install choice.
- **Local helper.** The default helper is now a 15 MB program (was 1.1 GB) that reads scans with Apple Vision as well as the old one did. Docling stays available as an add-on (`install.sh --docling`). A beta High accuracy read (`install.sh --docling --vlm`, about 2 GB of models) adds a layout model and PaddleOCR-VL for tables.
- **Old scans.** Typewritten and hand-ruled tables, hand-drawn plates and their captions, two-column pages, small-caps titles, patent drawing sheets and faded typewriting all read much better: on our set of 1900–1950 technical scans, figures found went from 0.49 to 0.98 and text errors from 6% to about 2%.
- **Fixes:** the High accuracy read never replaces a table with a worse one; sideways margin titles are not headings; titles never fall back to "PDF" after a cloud read.

## 3.9.0 — 2026-10-08

Link back to the PDF, copy the way you mean it, and point arrows at anything: a cell, a row, a region of an image, a PDF pin, or another arrow.

- **Source pins.** Turn on "With source" in a chip's ▾ menu (or hold ⌥ for one drag or click) and the card gets a pin to the exact spot in the PDF: a `{{[[plexus-pin]]}}` block under the PDF that shows the page crop wherever Roam renders it, plus `Source:: ((pin))` on the card. Click a pin for a larger crop, the surrounding paragraph, Open in reader (jumps and flashes the spot), Sidebar and the boards that cite it. One ⌘Z removes the whole gesture.
- **Copy menu.** The copy button beside a parsed box now opens a menu (▾, right-click or long-press): Copy, Copy as plain text (⇧⌘C), Copy as card (⌥⌘C, pastes onto a board as a real card), Copy with source (⌥⇧⌘C, writes the pin), Copy crop as image, Copy link (opens the reader at the pin). Figures copy as an image with their caption.
- **Arrows to anything.** Start an arrow on a Roam Grid or table cell (Connect) or a page-card row (⌥-drag). Point at part of an image: hold ⌥ when you release over it and drag a box, or ⌥-drag on the picture to start from a new region — a plain drop on an image still points at the card. Arrows can end on a PDF pin or on another arrow's label. Each end is a real block, so the connection reads `((cell)) → label → ((region))` in Roam, and the block shows a "⇢ N on <board>" chip elsewhere in Roam that opens the board centred on that arrow.
- **Figures from complex PDFs.** Multi-panel figures become one figure with their caption; patent drawing sheets are found; a text page is never one giant figure; boxes stay on the page and inside their column; contents lines are not captions. Dragging a figure makes an image card sized to the crop, with the caption as alt text.
- **Fixes:** cards move when dragged at high zoom (including table and grid cards); arrows start from grid-table cards; the arrow label editor is one field and no longer makes table cards flicker; paragraph copy works and says so when it cannot; the reader keeps your zoom when it jumps and fits the width again on current Roam.
- **Docs:** a "Which engine" table compares the built-in parser, in-browser reading, the local helper and the coming cloud engine.

## 3.8.0 — 2026-10-08

PDFs on the board feel finished: clean cards with real titles, a proper Quick Look, a reader that opens where you expect, and scanned pages read in the browser without freezing Roam.

- **PDF cards.** A small highlighter button with the highlight count replaces Roam's big white "Add highlights…" button; the title gets the room. Hover shows solid Open / Parse pills that stay readable over any cover and move above the dock and toolbar. "1 ref", not "1 refs"; one-page PDFs show no page arrows.
- **Real titles.** Cards, the reader, the PDF switcher and Quick Look show the paper's title from the largest type on page 1 — not the journal banner ("Science of the Total Environment"), not a running date ("22.12.2005"), not a table note. Titles appear at rest, read in the background one PDF at a time, and saved titles show at once. Run-together words in a title are split when the word list is on this device ("Summaryofreportedcasesper" → "Summary of reported cases per").
- **Quick Look (Q)** shows the card's title, opens at the card's page (page 1 by default), turns pages with a pill and the arrow keys, and falls back to Roam's reader when a PDF will not load.
- **Open and Parse.** The reader keeps the board at least 360 px wide, centres the card in what is left, and themes its PDF switcher. Parse opens at the card's page with the parsed boxes; on a narrow reader the outline is a tab, starts at the top, and rows are one line. Copy buttons on parsed boxes show on hover beside the box (never under its chip) and confirm with "Copied"; a figure copies as an image with its caption; tiny marks get no box; and the dock and card toolbar fit a narrow board (extra tools behind "…") without covering the minimap.
- **Reading order.** A sidebar column next to an abstract no longer interleaves with it line by line (the column gap is measured beside the column, and full-width rules separate bands).
- **Superscripts.** Footnote marks land between the right words ("Kleshchev¹, Boyd¹˒²", "whole zone³" linked to its note); unit superscripts like cm² stay inline.
- **Scans in the browser.** In-browser reading now runs in a background worker: a scan read no longer freezes Roam (longest pause 23 s → 0.3 s on a dense table page). Doubtful text lines are re-read up close and checked against a word list (the CDC 1980 title now reads exactly), centred cells in wrapped rows stay in their row, and the page is rendered the same way the reader shows it.
- **Fixes:** covers never go blank after heavy zooming; a reopened scan keeps its read; PDFs parsed by an older version are re-parsed quietly on open (scans you read are kept); left/right docks keep their tools; the header highlight count updates; no repaint loop or per-frame layout work while panning with a selection.

## 3.7.0 — 2026-10-08

Parsed text you can see and copy, scans read without installing anything, arrows to table cells, PDF footnotes that work in Roam, and typing that never drops a key.

- **Parsed text shows on the page.** Every block the parser found gets a soft gray box with a copy button (tables copy as Markdown). Boxes now fit sideways tables exactly (the old outline was drawn in the wrong frame on rotated pages). "Show parsed" in the reader's mode bar turns them off.
- **Read scans with nothing installed (beta).** Without the local helper, Read text reads a scanned page in the browser: 39 MB of models downloaded once from this site and cached, then about 20 s for a dense table page. Shaded table rows and slightly tilted scans are handled; doubtful cells are re-read up close. On a 1980 CDC table scan: cell F1 0.922 (the helper: 0.957). The helper stays first when it runs. A read scan reopens with its boxes, table chips and title.
- **Click to place.** Insert from a chip (Roam Grid, Native, Flat, Card, Figure, Section) now attaches a preview to the pointer; click the board to place it, Esc to cancel. "Insert beside PDF" keeps the old behaviour. The preview stays readable when the board is zoomed far out, with a dashed outline showing the real size.
- **Arrows to a table cell.** Point an arrow at one cell of a Roam table or a Roam Grid table, the way arrows already point at a block: the cell lights up while you connect, the end follows the cell through scroll and zoom, and clamps with a marker when the cell leaves view.
- **PDF footnotes in the Footnotes extension's format.** Marks like ¹, ** or (3) become `#sup^^[(N)](((note)))^^` aliases with the notes under the page's `#footnotes` block, numbered after the ones already there — in paragraphs and in table cells (Roam Grid and native). Setting "PDF footnotes": Footnotes extension / plain / off.
- **Roam Grid import.** With Roam Grid 0.18.5, "Roam Grid: Import from a PDF on this page…" turns a PDF table (born-digital or scanned) into a grid, through `PlexusDiagram.tablesFromPdf`.
- **Fixes:** keys typed right after making a card are kept and land in order (they were lost for up to a second); the right-click menu opens at the pointer; the board never scrolls under the reader; the board bar and the card toolbar stay one row in a narrow board (extra tools move to "…"); folded cards are header-high and a folded table says "Table · N rows"; PDF titles skip junk metadata ("I", "Untitled") and fill the PDF switcher as they are found; copy buttons never stack.

## 3.6.0 — 2026-10-07

The PDF page is the workspace: select, copy, highlight and drag text straight off the page — scans included — plus structure chips, a smoother drag, setup without dead ends, and office files on the board.

- **Text on every page, scans too.** A scanned page gets an invisible text layer from the local helper's OCR. Select across the page image, copy it, or press a colour in Roam's own highlight tip: the highlight is a real Roam block, also on scans. A read scan reopens with its text in about a second, no new read.
- **Selection bar**: Copy · Card · Quote · drag handle, placed beside Roam's tip, never over it.
- **Card-shaped drag.** Dragging a selection, a highlight or an outline row shows a ghost of the card that will land, and drops exactly where the ghost is.
- **Structure chips on the page.** Hover a table: "Table 7×7 · Roam Grid ▾" (Native, Flat, Copy as Markdown, Card). Figures, sections, lists and formulas get their own chip. Hold Shift to see the reading order.
- **Read / Read + Outline.** The Parsed tab became an Outline: an index of headings, tables and figures with page numbers, filters and bulk actions. Every PDF is parsed quietly when it opens (no writes, no network), so chips and the title are there in Read mode.
- **No dead ends.** A one-line strip under the reader says what is happening and always has a button. The Engines panel (pane ⚙) shows each reading engine with one action. The local helper installs with one copied command and pairs with one click — no token to paste.
- **Word, Excel, PowerPoint, OpenDocument, EPUB and CSV on the board** (anydoc, WebAssembly, loaded from this site only when you convert, then cached): a document becomes section cards, a deck one card per slide, a sheet a Roam Grid table.
- Roam Grid table cards grow with the card; the reader pill hides in the outline; titles come from the parse when the PDF has none.

## 3.5.0 — 2026-10-07

Parse a PDF into clean blocks and real tables, on the board, with merged cells, and better than Heptabase on tables.

- **Parse / Parsed / Both** in the reading pane. The built-in parser needs no install and reads a 30-page paper in under a second: headings with their levels, paragraphs in two-column reading order, lists, footnotes linked to their marks, figures and formulas as page crops, and tables, ruled or borderless, with merged cells and header rows. Running headers, footers and page numbers are removed and listed, never silently dropped. Results are cached on this device; nothing is written to your graph until you insert.
- Hover a parsed block and its region lights up on the page; click to jump there. Each table shows the grid it found over the PDF with a confidence chip, and you can drag a column boundary to fix it.
- **Insert, send, or drag.** Insert below the PDF, send sections to the board as cards, or drag any block or table onto the board. A table becomes a table card: with Roam Grid 0.18.3+ it keeps merged cells, header rows, alignment and column widths (one Roam write, one undo); without it, a native Roam table. Make highlight turns a parsed passage into a Roam PDF highlight.
- **Optional local helper** (`tools/parse-helper`, Docling on your Mac): formulas as LaTeX, OCR, and **Read the scan** for scanned pages — Apple Vision word boxes and the scan's own ruling lines go through the same table engine, numbers misread by OCR are repaired and re-read cell by cell.
- Measured on the ICDAR 2013 table benchmark (67 government PDFs): built-in table structure F1 0.979 and exact-cell F1 0.932, against Docling's 0.865 and 0.795, in 2.5 s for all 67 against 5 minutes. On a 1980 CDC table scanned as an image only: structure 1.000 and cell F1 0.957, against Docling's 0.082. Small scanned type can still misread words (e.g. disease names in 6 pt print); numbers are checked against their column.
- Roam Grid tables in cards scale with the board and get the whole card (no Roam row spacer, no break-out padding); columns are sized from the text.
- The reading pane title falls back to the parsed title; the tool dock stays left of the pane.

## 3.4.0 — 2026-10-06

Boards that wear your Roam theme, edits that hold still, wider PDFs, and Roam tables on the board.

- Plexus follows the theme your graph is using: the canvas, cards, text, borders and links take Roam's own colours, light or dark, and change when the theme does. Setting **Theme**: Follow Roam (default) or Plexus. Pastel sections are stronger in light mode.
- Editing in place holds still. In page cards the bullet and fold arrow stay in the gutter and nested rows keep their indent; note, block and task editors keep the resting line height; a sticky no longer shows a blue box while you type. Links keep the same colour at rest and in edit.
- Roam tables on the board. A card holding a `{{[[table]]}}` shows Roam's table, scrolls sideways when it is wider than the card and is never clipped. Enter or a double-click edits a cell with Roam's editor; Tab, arrows, typing, the wheel and right-click stay with the table while you work in it. New **Table** tool (B) and a **Table** item in the canvas menu add a 3×3 table in one undo. With Roam Grid installed, an enhanced table works inside the card, and **Open grid** shows it at full size.
- PDF cards can be as wide as you like (up to 4000 px), and a large card redraws page 1 sharp instead of stretching a small cover. The pane title uses the PDF's own title, never a storage path; a zero highlight count is hidden; the format bar no longer covers the pane; a slow PDF shows its cover until the first page paints.

## 3.3.0 — 2026-10-06

Edit in place without the card changing, PDFs you flip through on the board, PDF dark mode, and three Heptabase looks.

- Editing a note, block, task or page card no longer changes how it looks: the text stays in the same place, at the same size, with the same line breaks, at every zoom. Roam's bullet, its spacer and the reference-count slot no longer squeeze the text into a narrow column, the editor grows with its text, and the card keeps its size. Double-click a word and the cursor lands on it. With Roam Caret installed, its caret follows the board's zoom inside the card.
- Clicking a PDF card selects it, as in Heptabase: the card becomes a small reader you flip through with the wheel, ← and →, or the `‹ 3 / 9 ›` bar. The side pane opens only from **Open**, a double-click, Enter, the card menu, or a highlight.
- PDF pages in dark mode (setting **PDF pages in dark mode**): Dim (default) softens white pages on a dark board, Invert turns them dark, Off keeps white paper. Highlights stay readable.
- Three Heptabase looks, all off by default: **Canvas** flat grey instead of dots, **Section fill** pastel, **Highlight cards** tinted instead of a colour bar. In dark mode they show as coloured borders.

## 3.2.0 — 2026-10-06

PDF round 2: covers at every zoom, page 1 without opening the PDF, pages at reading width, one open per click.

- Zoomed out, a PDF card is still its page. Map and overview paint the saved cover on the card itself, as in Heptabase at 11-17 %, with no image element, title or strip at those tiers.
- A PDF you have never opened gets a cover in the background: a quiet board (1.5 s after first paint, idle, one at a time, at most three per visit, never while you move or read) draws page 1 with Roam's own PDF engine, so nothing is opened or written. A capture that comes out blank is thrown away. Setting **Prepare PDF covers in the background** (on).
- The reading pane fills its width: Roam's reader no longer stops short of the pane's right edge (its block row kept a separator and a reference-count slot beside the PDF). After the first page paints, the page is set to page width (through the viewer when it is reachable, otherwise by stepping Roam's own zoom buttons until the page fills the pane). Your own zoom is kept; resizing the pane refits.
- One click on a highlight card does one thing. A plain click opens it in the reader (setting **Highlight click opens**: Reader or Sidebar). Shift-click opens Roam's sidebar. The chip's **▾** lists Open in reader, Open in sidebar and Open page in main. Nothing opens twice.
- Selecting a PDF card never mounts Roam's reader inside the card. **Read inside the card** in the card menu is the one way to the inline reader; **Show the cover** takes it back, and opening the pane does too.
- The fullscreen tab strip shows only from two tabs up, is 28 px tall, and reserves nothing while hidden. Tabs, their persistence and Cmd+1..9 are unchanged.
- The reader's pages float on a soft grey bed in light mode; dark keeps the chrome colour.

## 3.1.0 — 2026-10-06

PDFs that read like Heptabase, page cards that hold still while you edit, and tools that do what your hand expects.

- PDF cards show the page itself: white paper, no text on the face. Hover for the title, highlight count and page chips, and an **Open** pill; double-click or Enter opens it too. A thin strip on the edge marks where the highlights are; click a mark to open that page. The cover is saved on this device the first time you read the PDF (nothing is written to your graph); until page 1 has been on screen, the card shows the last page you read. Setting **PDF card cover**: first page or last page read.
- The PDF opens in a pane beside the board with one slim header (title, other PDFs on the board, highlights, Roam's tools, close) and the pages at reading width. A floating pill drives Roam's own zoom out, zoom in, fit width and search, and shows `3 / 9`. Roam's toolbar is still there behind the tools button. The card you are reading gets an outline until you close the pane.
- Highlights moved into a drawer at the bottom of the pane: colour and page chips, search, and Note, Place and Locate on hover. A new highlight pulses in the list and offers **Place on board** for a few seconds. Hovering a highlight card flashes its mark in the reader, and hovering a row pulses its card.
- Highlight cards are quote cards with a colour bar and a source chip (`title · p. 3`).
- Editing a page card keeps the card exactly as it looked: same rows, same spacing, nothing rewraps or moves, and the cursor lands where you clicked. One click on an already selected page card starts editing there.
- Hand tool: drag a card to move it, drag empty board to pan. In Select and Connect, dragging empty board pans too; Shift-drag draws the selection box and Alt-drag the lasso. Setting **Drag on empty canvas** brings the old box-select back.
- With Roam Caret 0.6.6 installed, its caret now shows inside cards at every zoom (Plexus tells it when the board moves).
- The board bar, tab strip, legend and Properties are solid, and an empty tab strip no longer shows.
- New PDF cards are 240 × 320.

## 3.0.0 — 2026-10-06

Plexus 3.0: the 3.x roadmap is complete. This release makes large boards open fast, makes every new surface usable from the keyboard, caps every bulk gesture at what one Roam undo can take back, and documents the data model and module contracts as built.

- Large boards open fast. A board with 300 cards, 20 sections and 150 connections shows its cards in about 360 ms and is idle by about 450 ms (it was about 1.3 s, with long pauses after the first paint). Card reference and board counts now come from one indexed read instead of four searches across the whole graph, and fullscreen no longer forces a page layout in the middle of opening.
- Keyboard: trail stops in the panel take focus; Alt+↑ and Alt+↓ move a stop and Enter walks the trail from it. The region overlay nudges with the arrow keys (Shift for 10 px), Enter confirms and Esc cancels. The status, halo, why and task popovers take focus when they open, move with the arrow keys and give focus back on Esc. Trail strips, crops, PDF chips, timeline rows and the resurface panel open with Enter. Every button has a name, and focus rings show in light and dark even when another extension hides outlines. The `?` sheet lists the new keys.
- Undo: every bulk gesture stops at 45 changes so one Roam undo takes it back, with a toast that says how many were added: adding cards to a trail, a new trail from a selection, landmarks on a selection, and Lay out by date. README, Limits has a table of writes and undo steps per gesture.
- Fixed: moving a trail stop down (by keyboard or by dragging) did nothing.
- Docs: `docs/spec-plexus-3.0.md` (every block kind and prop key, what is stored where, decorated macros, the public API, interop) and `docs/api-plexus-3.0.md` (module contracts). The README follows the 3.0 order and has an integrations table. `tools/spec-keys.mjs` and `tools/doc-check.mjs` fail when code and docs drift.

## 2.21.0 — 2026-10-06

Trails, landmarks, a timeline, strength and dust lenses, source chips, and an Integrations section in settings.

- Trails: a named path through cards with a note at each stop. Add a card to a trail from its menu; Walk trail plays it stop by stop in present mode. A trail is a block under the board's collapsed `Trails` child, so `((trail))` pasted anywhere in Roam shows as a strip of stops you can click. The panel has a Trails tab.
- Landmarks: make a card, sticky or section a landmark and it keeps a large glyph at every zoom, including the overview, and shows on the minimap. Walk the board tours landmarks left to right, then down, or along a trail.
- Timeline in the Info tab: the daily pages that mention any card on the board, with a count per day; click a day to open it. Lay out by date can now place cards by the day they were first or last mentioned, not only by a date attribute.
- Strength and Dust lenses (More menu). Strength draws a connection thicker when its two ends are referenced a lot, share other boards, and were edited recently; hover a line to see why. Dust dims cards untouched for 6 months, 1 year or 2 years. Both are views: nothing is written, and turning them off puts every line and card back.
- Source chip: a highlight dragged from an `Articles/` or `Media Captures/` page shows the page title, and the author when the page has an `Author::` line. Click the chip to open the page in the sidebar. Renaming the author updates the chip.
- Settings has an Integrations section: Better Tasks, Task Status Tags, Roam Plexus, Compass and the colour highlighter, each shown as detected (with its version) or not installed. It updates when one of them loads or unloads. Switches turn each integration off; with "Roam Plexus and Compass" off, Open in Compass is hidden and drawing cards stop asking Roam Plexus for thumbnails.
- Kanban card titles no longer show the status tag, and lane counts have a space before them.
- Fullscreen tabs drop boards that were deleted.

## 2.20.0 — 2026-10-06

Statuses, journal, fullscreen tabs, touch, and a round of reliability work.

- Task statuses (with Roam Task Status Tags 0.9.0 or later loaded). A task card shows its status as the same glyph Task Status Tags draws on the checkbox (Active, Waiting, In Review, Holding, Incubating, Alert, Cancelled) and as a chip. A small ring left of the checkbox opens a status chooser; Shift-click removes the status. The card menu and a multi-selection have Status ▸ (up to 45 cards at a time). Every status change is written by Task Status Tags, not by Plexus. Without it, the glyphs still show from a built-in table and the ring is not there.
- Kanban "Lanes: Status": one column per status, plus No status and Done. Dropping a card on a column sets that status; dropping on Done completes it the same way the checkbox does. `[` and `]` move a focused card one column.
- Journal tab in the panel: the day's top-level blocks with a day stepper. Drag a row onto the board for a card. Looking and stepping write nothing.
- Fullscreen board tabs: boards you open while fullscreen collect as tabs above the board bar (up to 9). Cmd+1 to Cmd+9 switch. The tabs come back the next time you go fullscreen in this graph.
- Touch and tablet: pinch to zoom, two fingers to pan, long-press for the menu, larger resize grips under a coarse pointer.
- PDF highlights: a Note button on a highlight card opens its note the way Roam's own note button does (in the sidebar, focused), creating the note block only when there is none; one undo removes it. The pane's PDF switcher names a PDF without highlights by its page, and the arrow keys and Enter move through the list.
- New drawing (Roam Plexus) is one undo step with its card.
- Fixed: Plexus no longer replaces Roam's global `pull` function. Since 2.14.0 it answered other extensions' reads from its own cache. After updating, reload Roam once to clear the old copy's replacement.
- Fixed: a board shown in its own linked references, or in the right sidebar, no longer goes fullscreen a second time on top of the main board (clicks and drops went to the hidden copy).
- Developers: `node tools/live/smoke.mjs "Readwisenotes - "` runs a ten-step live check and cleans up only its own blocks; callback errors are counted and a callback that keeps failing is paused for a minute (Settings shows "N errors" when there are any); `npm run size` prints the bundle report.

## 2.19.0 — 2026-10-06

- Clicking into a page card no longer changes how it looks. The editor keeps the card's own text size, row spacing, indent and line wrapping. Roam's bullets, guide lines and extra scrollbar stay hidden, and the row you clicked stays where it was.
- Drag a highlight straight out of the PDF onto the board, as in Heptabase. Hover a highlight in the reading pane (the cursor becomes a hand), then drag it onto the board: a card lands where you drop it. A highlight that is already on the board pulses instead of being added twice. A plain click on a highlight still opens Roam's highlight menu, and selecting text to make a new highlight works as before.
- Clicking a highlight in the pane's list, or the page footer on a highlight card, scrolls the PDF to that highlight and flashes it, not just to the top of its page.
- The PDF reader fills its part of the pane. There is no longer a second scrollbar around it, and Roam's toolbar (highlight tools, zoom, page number) stays in view.
- The link legend (the chips that turn link types on and off) sits under the board bar, beside Properties, instead of on top of the bar's buttons.
- While you edit a page card, hovering a row shows a faint bullet in the margin; drag it to move the block, click it for Roam's block menu.
- A board that is open in the right sidebar while the main window is zoomed into the same board stays in the sidebar. Before, both copies went fullscreen and the sidebar copy covered the main board, so clicks and drops on the board did nothing.

## 2.18.0 — 2026-10-06

PDF highlights closer to Heptabase (roadmap P27), page cards you can edit in place, and two speed and freshness fixes:

- Open reader on a PDF card opens a reading pane beside the board instead of inside the card. The card stays a cover. Drag the pane's edge to resize it; on a narrow board it sits below.
- The pane lists every highlight in that PDF with its colour, page, and note. Filter by colour, page, or text. Place puts one card on the board; a highlight already on the board pulses instead of being added twice. Drag a row onto the board for a card at that spot.
- A highlight card's footer opens the pane at that highlight's page and flashes the card. The page holds after Roam restores the last page it showed.
- A note under a highlight (a child block) shows on its card and follows edits.
- Clicking into a page card edits it in place. The card keeps its size and look; the row you clicked gets the cursor; Escape returns to the same view.
- A `((ref))` card follows edits to its source, including edits made while the card was off screen or the board was closed.
- Graph links are drawn after the board's first paint, so opening a board feels faster.
- The colour tooltip on a highlight now says what changes: the card and the list follow the tag, the mark inside the PDF keeps the colour Roam painted.

## 2.17.0 — 2026-10-06

Feel instant (roadmap P26), after the claude.ai speed work:

- Going back to a board you just left is instant: the last two boards stay ready (paused, nothing running) and come back as they were, fullscreen included, with no rebuild.
- A board opens with a quick sketch of its last layout while the real board loads.
- Hovering a board chip, a board card, a breadcrumb, or a link to a board quietly reads that board ahead of the click.
- Cards load in small batches nearest the middle of the screen first, so a big board never freezes the page.
- Selecting a card no longer touches every other card (the same cost on a 300-card board as on a 40-card one).
- Faster text checks on every card (tags, regions, attributes, diagram detection).
- Cards and page rows keep their size while their content loads, so nothing jumps.
- Optional speed log in settings (off by default): open time, click time, pan smoothness, Plexus long tasks.
- Developers: `npm run perf:ratchet` keeps measured counts from getting worse; a hidden `speed-flags` setting turns each speed feature off without a release.

## 2.14.1 — 2026-10-06

- Typing stays light while a board sits in an open right sidebar. Plexus read Roam's whole sidebar window list every 400 ms (about 6 ms each time with 140 windows); it now reads the window's own open/closed arrow instead.

## 2.14.0 — 2026-10-06

- PDFs, videos, tweets and other heavy embeds on a card, a page row or an outline row show a poster until you open them. Only one stays live per board.
- A board you scroll away from, a collapsed sidebar window, or a board under a closed block stops working in the background and comes back where you left it.
- Opening a board reads Roam about six times less (about 24 calls instead of 155 on a 39-card board), so other extensions keep their share of Roam's limit.
- Typing in a card updates that card only. Typing on a page that is a page card updates the changed row only.
- Typing outside a board keeps the board open instead of closing and reopening it.
- Panning no longer measures every arrow handle on each mouse move.
- Board chips at the top of a page are placed once per frame instead of scanning the whole page for every change.
- A live speed check for developers: `node tools/live/perf-gate.mjs`.

## 2.13.2 — 2026-10-05

- A board in the right sidebar opens as the board. Outline is still in the mode bar, and the last choice is remembered on this device.
- Outline rows render when they scroll near the window. A row that scrolls far away unmounts and keeps its height, so a PDF lower down does not stay open.
- Clicking and panning a board stays fast in a window that has been open for days. Old copies of a board no longer keep listening after they close, and loading Plexus again cleans up an earlier copy that never unloaded. One click had been waking thousands of leftover copies.
- A board that fails to open waits before trying again, instead of retrying every 400 ms.

## 2.13.1 — 2026-10-05

- An image card keeps its picture at map zoom. A collapsed or empty card still shows its title.
- A card that cites part of an image shows that crop. A region inside the card still uses its own block.

## 2.13.0 — 2026-10-05

- Every diagram opens as a Plexus board by default. Nothing is saved until you change the board. Your first edit writes the board marker in the same undo step, and folds the outline when Collapse the outline is on.
- A diagram that already has native shapes stays Roam's own. An Open as Plexus board button over it imports the shapes and arrows.
- Settings has Every diagram is a Plexus board. Turn it off to open only diagrams you enhance or create with New whiteboard here. Turning it off gives the native diagram back to boards you have not changed.
- Plexus: Restore native diagram now sticks, even with the setting on. Plexus: Enhance clears it.
- Fixes from a review of 2.8 to 2.12:
  - A page that is a card on a board no longer throws or loops when it opens. Its board chip sits under the page title.
  - The references drawer lists top-level blocks again.
  - Cutting or duplicating an image card keeps its regions. Deleting one asks first and shows how many regions it has.
  - Clearing a connection's why no longer deletes a note that has children.
  - An open PDF reader stays mounted while it is in view, and arrows meet its edge. Page chips refresh when highlight cards change.
  - Encrypted-graph PDFs (`.enc`) show their highlights.
  - Each image highlight reuses one regions block.
  - Fewer reads on large boards: highlight watches are capped, block props are read only for highlights, and the Info panel counts references without pulling them all.
  - Memory lane arrows follow the cards. Suggested lines follow a dragged card, and their menu sits at the line.
  - Escape works on a full-screen board. Annotate is one undo step.
  - Popovers close when the pointer leaves. Unload no longer removes Roam's own nodes.
- The command palette stays two entries.

## 2.12.1 — 2026-10-05

- Double-click a connection label to edit the label and a why note. Enter saves both. The outline chip adds "because …". An empty why writes no child.
- Shift+T opens a memory lane. Play fades cards that did not exist yet. A snapshot tick restores that layout and writes nothing.
- The references button on a block card lists blocks that mention it, grouped by year.
- The links menu can draw dotted lines for shared page references. Connect makes the connection. Link text wraps the mention.
- Plexus Commands has Resurface here. It inserts a button that lists cards from a week, a month, or a year ago. The command palette stays two entries.

## 2.12.0 — 2026-10-05

- Hover the info button on a card or a connection to see when it was made, the board, the section, cards from the same day, and how often it is referenced. A block on a board shows one chip per board. Hover the chip for a map. Click the chip to open that card. Nothing here writes. The command palette stays two entries.

## 2.11.4 — 2026-10-05

- A PDF card shows one chip per page that has a highlight on the board. The badge is the count. A click pulses those cards. A double-click opens that page in the card reader. An arrow into a highlight shows the page at the tip. A highlight in the outline says On board when that highlight is a card. None of these write. The command palette stays two entries.

## 2.11.3 — 2026-10-05

- Open in reader on a highlight card opens that page in the PDF card on the same board. The mark stays in view. If that PDF card is not on the board, Roam opens the highlight and a note says to click it. The click does not write. The command palette stays two entries.

## 2.11.2 — 2026-10-05

- Add highlights on a PDF card places the ones you pick, as a grid or a column. One undo removes them. Dragging a highlight bullet onto the board makes one card. Dropping a date asks before adding only the highlights under that date.
- An area highlight keeps the picture's shape. Mark region on that card stores a region under the highlight. The page mark keeps the colour Roam painted.
- The tag lens can show one highlight colour. The command palette stays two entries.

## 2.11.1 — 2026-10-05

- A block ref of a PDF highlight is a card. It shows a colour bar, the passage or the area picture, and the page. Changing the colour tag updates the bar. A block that is not a highlight stays a normal ref. The command palette stays two entries.

## 2.11.0 — 2026-10-05

- A pdf block on the board is a card. The cover shows the file name and the highlight count. Open reader mounts Roam's own reader. Interact lets you use that reader. Escape or a board click puts the shield back. A second reader closes the first. Moving the card does not change the PDF settings. The command palette stays two entries.

## 2.10.3 — 2026-10-05

- With Compass loaded, a card menu can open Compass on that page. Compass can open the board that holds the card, and asks which board when there are two.
- An image card can start an empty drawing beside it. The connection reads annotates. A note says to drop the image into the drawing, and it stays up after the drawing opens. The outline chip names the drawing. Without Roam Plexus that row stays hidden. The command palette stays two entries.

## 2.10.2 — 2026-10-05

- A block ref of a Roam drawing shows the drawing. Regions lists that drawing's regions, and picking one adds a reference on the board. New drawing here creates the drawing and a reference card. The drawing block is not rewritten. Without Roam Plexus the new drawing is still an ordinary drawing. The command palette stays two entries.

## 2.10.1 — 2026-10-04

- window.PlexusDiagram lists boards on a page, boards that show a block, and the cards and views on a board. It can open a card or a saved view, add one card, and return a small PNG of a board. Opening and the picture do not write. Adding a card writes that one block.
- A block ref of a Roam Plexus region shows the caption, a crop, Open drawing, and Open in sidebar. Open drawing uses Roam Plexus. If Roam Plexus is missing, the card is an ordinary block ref. The command palette stays two entries.

## 2.9.6 — 2026-10-04

- An image card shows a small region count when it has regions. The card menu lists them: Go, Copy ref, Rename, and Delete. Rename changes only the caption. Delete asks when another block still references the region, and can open those mentions. Badges off hides the count. The command palette stays two entries.

## 2.9.5 — 2026-10-04

- Hover an image crop for a larger preview, the picture dimmed and the region lit. Click opens that image on its board, zoomed to the region, or scrolls the outline to the image and pulses the region. Shift-click opens the board in the sidebar. An inline view draws a small map. Hover enlarges it. Click opens the board at that view and pulses the highlighted cards. Shift-click opens the board in the sidebar. Neither click writes to the graph.

## 2.9.4 — 2026-10-04

- On an image block, the block menu item Plexus: Mark image region lets you drag a rectangle. Confirm stores the region under the image, copies a block ref, and toasts. Escape writes nothing. A plexus-region image button in the outline, a block ref, an embed, the sidebar, and linked references draws the crop at most 160px tall, with a 1px border and no shadow, and hides that button. A Roam Plexus region such as a rectangle is left alone. The command palette does not gain an entry.

## 2.9.3 — 2026-10-04

- On an image card, Mark region lets you drag a rectangle on the picture and add a short caption. Confirm stores that region under the image, copies a block ref, and toasts that it copied. The first undo removes the region. The next undo removes the empty container. The card stays put, and the image viewer does not open. The command palette stays two entries.

## 2.9.2 — 2026-10-04

- Save view, in More or with Shift+V, writes the current camera as one view block at the end of the board. A selection can save its own view from the context bar. The Boards tab lists those views, each with a 96px outline map. Go puts the camera back and writes nothing. Delete removes the view block, and undo puts that row back. The command palette stays two entries.

## 2.9.1 — 2026-10-04

- A new card is placed before the Connections list, snapshots, and a region container, so those stay at the end of the block. The library card count skips a region container the same way it skips Connections. Leaving a new empty card that only holds a region container no longer deletes that card.

## 2.9.0 — 2026-10-04

- A region container `{{[[plexus-regions]]}}` and its `{{[[plexus-region]]}}` children stay off the board. They are not cards. A card's child badge does not count them. Image regions and saved views can be stored in that shape. A Roam Plexus region is recognized and left as theirs. Nothing is drawn yet.

## 2.8.0 — 2026-10-04

- Better Tasks and the Task tool start off. Settings, Integrations, has four controls: Better Tasks integration, Task tool, Task chips, and Default project for new tasks. With both switches off, the dock has no Task button, K does nothing, and the ? sheet does not list K. A Task tool you already saved stays on. Turning Better Tasks on draws the light checkbox and the chips, and asks Better Tasks for attributes once. Turning it off puts Roam's own checkbox back. Opening, panning, and clicking a board does not call Better Tasks while the integration is off.
- A card whose text has #bg-blue or #[[bg-blue]] takes that colour on the board when the colour highlighter's variables are on the page, in light and in dark. #c:red still colours bold text inside the card, and Plexus does not paint over it. A fill you set in the picker wins; clearing that fill brings the tag colour back. With no highlighter variables, named colours use a fixed palette and the tag stays visible in the card.
- The colour picker's gear, Write as highlighter tag, is saved on that board. In that mode a named colour writes one #[[bg-name]] into the block and clears the card's fill. One undo restores the text and the fill together. Hex, darker, and lighter still change only the fill.
- A key pressed outside the board no longer switches the tool or adds a card, while nothing on the board is selected. A selected card still receives the board's keys.
- A card more than one screen outside the view keeps its size and skips layout. The card you are editing stays fully drawn. A card that stays outside the view for 10 seconds drops its live Roam body and draws it again when it comes back.


## 2.7.1 — 2026-10-04

- Dropping a repeating task on Done in the Kanban view now makes the next occurrence, the same as ticking its checkbox. Before, only a real checkbox click did, because Better Tasks starts the next occurrence from its own checkbox. The task is now finished through that same checkbox, out of sight, so you get the completed date and the next task together.
- Popovers stay clear of the board's own controls. The task chip popovers, the children peek, the Background and tag popovers, the card colour picker and the right-click menu move aside or flip instead of opening under the dock, the top bar, the rail, the minimap or the Properties panel. When there is no room, they shrink and scroll.
- Task cards are readable when you zoom out. At the map zoom the check box is at least 20 pixels on screen, with the due date under the title (teal today, red overdue). Zoomed far out, a task is one clear box: empty, checked or crossed, in the same colours.
- The pill that shows a scrolled-out block arrow ("↓ the block's first words") stays inside its card. It is cut to the card's width less 16 pixels with an ellipsis and keeps the same size on screen at any zoom.
- A board with many tasks no longer uses up Better Tasks' limit of 100 decorated checkboxes. A task card now draws a light checkbox of its own instead of a real Roam block, so a 40-task board added 40 real checkboxes before and adds none now, and Better Tasks keeps decorating the rest of the page. Clicking the box still completes the task through Better Tasks.
- Checked for a freeze when the bench is run back to back with a task board open: five runs and five load-and-unload cycles did not reproduce it.

## 2.7.0 — 2026-10-03

- Task cards. A card whose block is a Roam TODO now looks like a task: Roam's own checkbox, the title, and a row of chips under it for the due date, project, priority, repeat, status, waiting-for and GTD. Today's due date has a teal border, an overdue task a red one, a done task is dimmed and struck through, and a cancelled one is struck through. Better Tasks' own pills are hidden inside the card so the chips are not doubled. At map zoom a task shows a check box, its title and its due date; zoomed far out it is a single check box.
- New Task tool. Press K, or pick it in the dock or the canvas menu, then click the board: a TODO card appears and opens for typing. A task left with no text disappears when you click away, like an empty card. Cmd+Z right after makes one undo step. The card menu has Make task for a plain note.
- Change a task from its chips. Click the due date, project, priority or repeat chip and pick from a small popover (today, tomorrow, next week or any date; a project from Better Tasks' list; low, medium or high; a repeat rule). The change is made by Better Tasks itself, so the attribute blocks keep their uid and Plexus still never writes a `BT_attr` block. Cmd+Z after a chip change is Roam's undo, not the board's. Without Better Tasks the tool makes a plain TODO card and the chips are read-only.
- Finishing a task works the way it does in Roam. Tick the checkbox on the card and Better Tasks writes the completed date and, for a repeating task, the next occurrence on its daily or project page. A toast tells you the date and offers Add to board. Dropping a card on Done in the Kanban view does the same through Better Tasks.
- Drag a task card onto a daily-page card (or a section named for a day) and its due date becomes that day, in the same attribute block. Hold Shift to move the card without changing the date.
- Better Tasks' attribute blocks and its Activity log no longer count as children: they are never rows, never in the outline or the peek, and never a "▸ N" badge. Renamed attributes are read from Better Tasks.
- Three new settings: Task tool (show it in the dock), Task chips (full, due only or none) and Default project for new tasks.

## 2.6.0 — 2026-10-03

- Editing a card no longer shrinks it. Opening a card or a sticky for editing used to let it collapse toward the height of one line, and its arrows came loose. The card now keeps its size for the whole edit, the editor fills it, and the text is no longer cut to one line when you start typing. Edges stay attached.
- Sticky notes are rebuilt to work like the RoamJS sticky notes, and they stay saved. Each one has a coloured header bar you drag, with a short title, a colour dot and a minimize button. The body is the live Roam block: click once and type, with tags, images, links and the slash menu. Drag a corner or edge to resize. Minimize folds a note to its header and remembers it. There is no close button; Delete or the menu removes a sticky and Cmd+Z brings it back.
- Page cards open faster. A card now shows all its rows as plain text at once, then turns the rows you can see into live Roam blocks a few at a time. Rows scrolled out of view, and heavy rows such as charts, embeds and images, wait until they are on screen. A page you pulled once is reused while the card is open. A 146-row page card used to block for about 150 ms while it drew; now it paints in about 20 ms.
- Arrows to blocks now stay on their block. When a chart or an image above the target row loads late, or a row turns live, the card re-measures its rows and the arrow follows. Each linked row shows a small dot in its own arrow's colour, so two arrows into one card stay apart, and hovering one arrow lights only its row.
- New tooltips for the sticky header: drag, minimize or expand, and the colour dot.

## 2.5.0 — 2026-10-03

- The connection preview is cleaner. The target block is now a highlighted bar inside its page card, at the block's real place in the page, with its text cut to the card's width, and the arrow runs into the bar with a head like the one on the board. Nothing spills over a neighbouring card any more.
- The preview opens where it never covers the chip or the block line it belongs to: under it, else above, else beside it, shrinking and scrolling inside when the window is small. It follows the chip while you scroll or resize and closes when the chip leaves the screen.
- Roam's breadcrumb above a connection block (in linked references and when you zoom into the block) now opens the same preview on a plain click, because Roam's own link there only led to "Board › Connections". A small ▦ marks it. Shift-click, Cmd-click and Ctrl-click still do what Roam does. Unloading removes the marks and the listeners.
- Resize grips, connection dots and arrow-end handles keep the same size on screen at every zoom, so they are easy to grab on a zoomed-out board and no longer huge when zoomed in.
- Light mode was checked on every new surface. Fixed: the connection chip could run past the edge of its block, and its teal was too pale on white.

## 2.4.0 — 2026-10-03

- The Add and Info panel now opens to the left of the control rail instead of covering it. The minimap steps left of an open panel. The rail keeps one fixed width, so the version badge no longer pushes it wider.
- An arrow that ends on a block now visibly points at it. The line continues into the page card and its head stops beside the row's text. The row keeps a mark in the arrow's color (a left rule and a light tint; in the dark theme a border only, no fill). Hover the arrow and the row lights up; hover the row and the arrow thickens and a tooltip names the other card and the label. When the row has scrolled out of view, the arrow ends in a pill at the card edge with an arrow and the block's first words; click it to scroll the row back.
- Connections now show up where Roam draws them. Under every connection block in the outline, the sidebar or a block's linked references, a small chip reads "A —label→ B · on Board" and names the block when the arrow ends on one. Click the chip to see a preview: a map of the two cards with the arrow and the target row, plus Open on board and Open in sidebar. Open on board opens the page, enters a nested board if needed, and selects the connection. Nothing is written, and unloading removes every chip.
- The card's hover toolbar no longer disappears on the way to it. It waits 400 ms after the pointer leaves the card, so you can reach it and open its color picker. Moving to a different card switches the toolbar at once with no flicker. Escape, panning and zooming hide it immediately.
- With the Hand tool you can now resize: a press on a resize grip resizes, anything else pans, and Space-drag still pans over grips. Page cards have a wider grip band on the right and bottom edges and a larger corner that sits above the scrollbar. The grips show when you hover a card in hand mode.

## 2.3.0 — 2026-10-03

- Board rows in page cards. A page card for a page that holds a board shows that board as a small map with its title and item count, not a grey box. After four maps on one card, the rest are one-line chips. The row for the board you are looking at says "this board". Click opens the board; Shift-click opens it in the right sidebar.
- A row that Roam cannot render inside a card, such as an empty `{{[[roam/render]]}}`, now shows its raw text, muted, instead of "Failed to render". This also ends the Roam console errors the old page-card row caused.
- Hover tooltips. Every control on the board bar, the dock, the rail, the card toolbar and the Properties panel shows its name, its shortcut and a one-line description after a short hover. Keyboard focus shows it at once. The tip sits below the board bar, above the dock, left of the rail, and stays inside the board. Settings, Hover tooltips, turns them off and hands the text back to the browser. Tooltip delay is instant, 350 ms or 800 ms.
- A tooltip no longer stays on screen after the control it described is removed.
- Ref cards and image cards show readable titles everywhere: Table, Kanban, Graph, Timeline, Gallery and Find use the first line of the referenced block or the image's alt text, never `((uid))` or a blank. Find matches the text a ref card shows.
- Graph view draws a line for every connection, fits all cards inside its window and no longer scrolls them out of sight.
- The end handles of a short arrow with a label can be grabbed. The label steps aside while the arrow is selected.
- Gallery captions show the image's alt text, or nothing. They never show raw markdown.
- The Escape that closes Search, a menu, or Gallery, Timeline and Graph no longer also leaves fullscreen.
- Present mode hides the board bar, dock, Properties, rail, minimap and side panel, and brings them back on exit.
- Shift-click only extends the selection. It no longer opens the Info panel.
- Gallery, Timeline and Graph, the board bar and the Properties pill are opaque now, so nothing shows through. A collapsed Properties pill is only as wide as its label.
- Section titles in the zoomed-out overview may run wider than a small frame before they are cut off.
- Gallery, Timeline and Graph are also under More, Views, and under Views in the canvas menu. The template entry is now "Timeline template". An empty Timeline says that a date attribute or a daily-page reference makes a card dated.
- The thin dotted curves that run across a board between cards are graph links, drawn for every shared page reference or attribute. They are not a stray line. Links, in the board bar or the L key, switches them off or to attributes only.

## 2.2.0 — 2026-10-03

- Board bar and tool dock. The top bar is now the board bar: breadcrumbs, Add, Info, links, views, background, present and More. The nine tools moved into a floating dock along the bottom. Settings, Toolbar layout, brings back the 2.1 look (Classic) or hides the top bar until the pointer nears the top edge (Dock only).
- Dock settings: position (bottom, left or top), shape (pill or strip), tool names under the icons, and button size. A board can set its own dock position from the More menu, Dock position for this board; opening a board still writes nothing.
- The active tool slides a highlight behind it. A locked tool (double-click) shows a padlock. In dark mode the active tool is a border and a dot, so it stays visible without a fill.
- Dock options. With Card, Sticky, Section or Shape active, the dock shows that tool's colors, the block or card look, or the shape kinds. With nothing selected, a pick styles the next item you create with that tool and is forgotten when the board closes; with cards selected, it restyles them as before. One undo reverses it.
- The last breadcrumb carries the board's own color, and the bar's bottom edge takes the same tone.
- Overview zoom keeps Select, Hand and Board in the dock. A board narrower than 560 px gets smaller buttons and no options. A left dock no longer sits on the Properties panel.
- The active and locked tool styles in the top bar lost to Roam's own button rules in dark mode. They hold now.

## 2.1.0 — 2026-10-03

- Enter in a card adds a line to the card's block, like a node in a native Roam diagram. Settings, Cards, "Enter in a card" set to Child brings back the old behavior of making a child block.
- An empty white panel with a Close button no longer covers boards.
- Pasting one image into a card inserted it twice. It now inserts once.
- Dragging an image onto a card that is being edited works. Dropping an image on a card adds it after the card's text instead of replacing the text.
- Whole-page cards: a page card shows the page title as a header and the whole outline, scrolls inside the card, and edits where you click. Add page… in the canvas menu adds a page by search. Dropping a page from the left sidebar makes a page card.
- Arrows to a single block. Drag an arrow end over a page card and the row under the pointer lights up; dropping there connects to that block with a real `((ref))`, so it shows in Roam's backlinks. Dropping on the title connects to the page. Ends follow their row as the card scrolls and clamp to the edge with a marker when the row is out of view. A selected arrow has end handles to re-aim it, and the arrow menu has Connect to the page instead.
- Card children. A note, block or ref card shows only its own block. A ▸ N badge opens the children as an editable outline inside the card, remembered per card, and hovering the badge peeks at them. Spread children as cards makes one card per child with an arrow back.
- Note: note and ref cards now show only their own block until the badge is opened.
- A selected arrow's end handle could only be grabbed on the half outside the card it ends on. The whole handle now grabs.

## 2.0.0 — 2026-10-03

- Card editing, outline navigation, templates, the table, snapshots, and the graph tools that landed after 1.3.0.
- Gallery, timeline, and a read-only graph of the board. A section can lay cards out by date. Connections can bend or route around cards. Present shows a section's first child as notes, plus a laser and a pen that are dropped on exit.
- A diagram in the right sidebar stays a gap until that window is on screen. Opening the sidebar parks the boards on the page.
- A 300-card board shows its first shells in about 1 second and finishes the rest over the following frames. Detail and overview pan hold 60 fps. Zooming across the detail threshold is about 57 to 59 fps, and that switch no longer produces a long task.
- The same board in two Roam windows kept the same 6 cards and 4 connections across 30 moves.

## 1.3.0 — 2026-10-01

- Native parity on an enhanced board: plain block cards, a node hover toolbar, a right-hand control rail, a properties panel, PNG export, outline in the sidebar, boards in the sidebar, edge styles, native embeds, style import on Enhance, per-card expand, minimap drag, keyboard parity, and Edit Block.

## 1.2.0 — 2026-09-29

Fixes from the second round of testing on 1.1.0:

- **Zoomed-out cards stay inside their box.** Map view is a clean title-only tile: three-line clamp, font capped by the tile height, nothing spills below the card. Ref titles are cut at 120 characters and header text at 160. The level of detail now switches while you zoom (with hysteresis, one class toggle), not only when the gesture ends. A third tier below 20% shows section titles only.
- **Nested board thumbnails are real thumbnails.** A padded frame with mini cards (border, fill, title), sections as tinted frames, connections, and an "Empty board" state, instead of one white box.
- **Sections auto-fit.** A card moved, resized, created, or pasted past a section edge grows the section to contain it (24 px padding), live during the drag and saved as one undo step. It cascades through nested sections, never shrinks by itself, and can be turned off per section or with the `auto-fit-sections` setting.
- **Board backgrounds.** Dots, lines, grid, and plain patterns and paper or ten palette tones, chosen per board from the Background button (stored in the board block's props) with a default in Settings.

Added:

- **Right-click menus** for the board, cards, sections, text, connections, multi-selection, and the More menu.
- **Duplicate and clipboard.** Alt+drag and Cmd+D duplicate (Alt+Shift makes `((ref))` cards); copy and paste as refs or as copies, across boards; pasted text and images become cards. Send to board, Boards tab (every board in the graph), Outline tab.
- **Keyboard.** Tab and Shift+Tab step through the outline, F focus mode, Q quick look, P presentation, M mind map from a card's child blocks, Cmd/Ctrl+Alt+Enter fold, double-click a bottom or corner grip to fit or reset height. Arrow keys nudge the selection 1 px (Shift for 10 px); Alt+Arrow selects the nearest card in that direction (Alt+Shift adds), as in Heptabase.
- **Layout tools.** Tidy (row, column, grid, outline order), same size, fit height, reset size, fit section, fold all, optional space-out after a move, "Back to content" button.
- **Pin.** Pinned items do not move, resize, or delete.
- **Card badges.** References, boards, and open and done TODO counts, read from Roam (never written); a `((ref))` to a board renders its thumbnail; journal cards for today and this week.
- **Export.** Export board as SVG and Copy board as text (commands and board menu).
- **Review fixes.** Cut and paste now moves a note, text or section (the clipboard carries a snapshot; before, the paste was a dead `((ref))`). The Open button, double-click and Enter open a whiteboard-shortcut card. Settings changes reach open boards' sessions live. A pinned section is never grown by auto-fit. Fit height can shrink a card. Fit / Reset size / Same size never leave a card outside its section. A pinned card no longer pushes other cards in space-out. Escape closes the Background popover first. Right-clicking a ref, tag, link or image inside a card keeps Roam's or the browser's menu. Tab is only taken while the board itself has focus. A tall menu scrolls inside a small board. Thumbnails title `((ref))` and image cards. The section grows live while you type in a card at its edge. Card badge queries run in idle slots and are cached for two minutes.
- New settings: default board tone, map view threshold, auto-fit sections, space out cards, show card badges; grid accepts `grid`. API and build: see `docs/api-plexus-1.0.md` ("1.2 additions") and `docs/spec-plexus-1.2.md`; `src/css/*.css` is appended to the bundle.

Fixed after live testing in Roam Desktop:

- **One Cmd+Z per operation.** Duplicate, Alt+drag, mind map, Tidy, and a drag that grows a section each took one Cmd+Z per block written; the Undo toast button undid one block. Writes of a transaction are now grouped, and Undo and Redo step over the whole group.
- Map-view cards clamp to exactly three lines (no fourth-line sliver, no ellipsis in the middle of a tall card); section titles show an ellipsis; far zoom-out no longer paints a dot moire; colored cards read at overview zoom; whiteboard-shortcut cards keep their thumbnail at map zoom.
- Ctrl-wheel zoom and paste use the board's current position after the Roam page scrolls (they were off by the scroll distance).
- Pasted images are `![](url)`, not `![](![](url))`.
- The section preview no longer snaps back while you type in a card at its edge.
- Fit keeps content below the toolbar and left of an open panel (Outline click fits the visible area); the context bar no longer covers the toolbar or the panel; double-click on the middle of a card's bottom edge fits its height.
- Mind map from a card that already has child cards on the board lays the rest out around them, and says when the 24-branch cap left nodes out. Add this week no longer stacks a card on an existing one. Duplicating a section says "section".
- The OS dark-mode hint no longer darkens a board on a light Roam theme.
- **Typing in a card: Enter no longer drops you out of the card.** Root cause: the card editor stopped the mouseup that Roam uses to end its block drag-select, so a new block created under the resting pointer turned the edit into a block selection. Mouseup now passes through.
- **Undo limits.** Roam keeps only the last 50 changes, so one Cmd+Z sequence can undo an operation only if it fits. Mind maps cap at 24 branches ("Mind map: 24 of 45 branches (cap)") and bulk adds (large pastes, multi-drops, Add all) at 45 cards ("Added 45 of N (Roam undo holds 50 changes)").

## 1.1.0 — 2026-09-29

From the first round of testing on 1.0.0:

- **Cards show their content.** Note and block-reference cards render the whole block (and its children) instead of a truncated first line over an empty body. A long single-line `((ref))` card is readable again.
- **Drag blocks in from Roam.** Dragging a bullet from the outline or the right sidebar onto a board adds it as a `((ref))` card (a page becomes a `[[page]]` card). Multi-block drags stack. The source block is never moved.
- **Typing in a card.** Enter adds lines inside the card and keeps the caret there; if Roam drops focus while it moves between blocks, the editor takes it back. The card header no longer repeats and lags behind what you type, and text items keep their heading size while editing.
- **Nested boards (Heptabase sub-whiteboards).** New Board tool (W): click or drag to add a board card, or select cards and choose **Move into new board**. Board cards show a mini map, item count, and a name field. Double-click or Open goes into the board in place with a `Parent › Child` breadcrumb; click a crumb or press Esc to go back up. Drag a card onto a board card to move it inside (with Undo). Boards opened from their own page get crumbs for their parent boards.
- **Collapsed board blocks.** The board block is collapsed once so Roam does not list its cards as bullets under an inline board; expand the bullet to see them. Turn it off with **Collapse board blocks in the outline**. A nested board no longer opens a second overlay from an expanded outline.
- Import and Restore keep a nested board's marker; a board deleted while open closes cleanly (a nested one pops to its parent).

## 1.0.0 — 2026-09-28

Rewrite. The 0.6 canvas (one 2,200-line closure) is replaced by a model / host / session / view split with 204 unit tests and a live CDP gate on Roam Desktop.

- **Everything is a Roam object.** Card layout lives in each block's `:block/props` (`plexus` key), not on `[[plexus-diagram/metadata]]`. Sections are parent blocks of their cards. Connections are blocks under a collapsed **Connections** child that read `[[A]] → label → [[B]]`, so both ends get a backlink and notes live as children.
- **Graph links.** References and attributes that already exist between cards are drawn as dashed arrows colored by relation (`causes`, `Detected by`, `mentions`). **Write to graph** turns a labelled connection into `label:: [[B]]` on the source.
- **Heptabase features.** 10 colors for cards, sections, text, and connections; sections drawn by drag or Cmd+G around a selection, with titles above the frame; ports on every edge; curve / straight / elbow routes, direction, dash, weight; selection box, alignment guides, align / distribute; text headings; minimap; board search; Add panel with Search and Related; card editing with Roam's own editor (page cards open the whole page); zoomed-out map view with readable titles.
- **Fast by construction.** Pan and zoom move one transform (p95 frame 4.5 ms on a 120-card board, no renders, no writes). Only on-screen cards render content; zoomed out, cards show titles only. Opening a board writes nothing; the viewport is per device.
- **Fixed from 0.6.4:** Section tool made two frames per drag and one per click; sections did not hold cards and had no color; the connection inspector covered the connection; text typed into a new card was lost; the sync indicator went pending on pan and zoom; diagrams on normal (non-daily) pages were never discovered; `[[links]]` inside cards did not open; keyboard shortcuts were swallowed by the diagram block.
- **Migration.** Boards enhanced with 0.6 upgrade once on first open (positions, colors, sections with their cards, connections with labels and styles). Native diagrams import on **Enhance** (positions, groups as sections, edges as connections). Diagrams you never enhance are never written.
- Commands: Enhance this diagram, New whiteboard here, Restore native diagram, Fullscreen this diagram.

## 0.6.4 — 2026-09-05

- **Inspector Comment** — converts the edge label to native Roam comments (one-way → target, two-way → both) then clears the pill.

## 0.6.3 — 2026-09-05

- **Idle card children** — after click-away, idle cards `renderBlock` the card uid so child bullets stay visible; deep pull includes nested `:block/children`; empty placeholder only when string is blank and there are no children.
- **Board background** — toolbar cycles Dots / Lines / Solid (`grid-style` persisted).

## 0.6.2 — 2026-09-05

- **Connect hit-test** — targets resolve from the painted card rects (`getBoundingClientRect`, 12px handle inflate) before `elementsFromPoint` and world-rect math, and the card hovered on the last pointermove is the fallback for a captured pointerup.
- **Rubber-band** — the edge and temp-wire SVGs cover content ∪ viewport (2000px pad) so the dashed wire paints across a panned board.
- **No junk cards** — a click-click that misses a card cancels the arm; only a real drag onto empty board creates a linked card.
- **Version badge** — the toolbar stamps the package version, not Roam's `DEV` developer-extension version.

## 0.6.1 — 2026-09-05

- **Connect hit-test** — when Electron's `elementsFromPoint` misses cards under `.pxd-world`, resolve targets from world-space node rects (12px handle inflate). Click-click arms and drag-to-card both work.
- **Delete cards** — Delete/Backspace on a selected card removes it from the diagram (adapter + metadata), not just edges.
- **Scratch children** — `blankScratch` deletes scratch-host children so a new card editor never inherits the previous card's bullet tree.

## 0.6.0 — 2026-09-05

- **Visible arrows** — connector stroke and marker fill are resolved colors, not `var()` in SVG attributes. Marker ids are unique per canvas. Heads scale with zoom (`clamp(10 / zoom, 6, 24)`).
- **Ports** — drag from a card handle stores `from::` / `to::` (`auto|top|right|bottom|left`). Click-click and connect-to-empty still work.
- **Per-edge direction** — `direction::` `oneWay|twoWay|none` on `edge A->B`. Global Arrowheads is the default for new edges only.
- **Inspector** — click a line for a floating cluster: direction, Flip (disabled if the reverse exists), Route, Label, color, Delete. Mutations `await flushLayout()`.
- **Schema** — optional `from::` `to::` `direction::` `color::` children under the existing edge row. `[[plexus-diagram/metadata]]` only. No `:diagram/*` / `:harc/*`.

## 0.5.0 — 2026-08-29

- **Connect two-click + temp wire** — Connect stays on after an edge. Click-click or drag; the rubber-band lives on `.pxd-edges-temp` above the cards and follows the cursor immediately. Handles are a 12px disc with a larger hit target.
- **In-place nested boards** — opening a nested diagram does not call `openBlock` / change the hash. The parent session stays loaded; crumbs sit on the toolbar and Esc pops one level.
- **Section and card color** — toolbar swatches (eight Blueprint-ish ids plus default) write `color::` on nodes and sections. Dark mode uses the border as the signal.
- **Section click-rename** — a single click on the section title starts rename; pointerdown on the label does not drag the frame.
- **Review pack** — session swap flushes the outgoing board then cancels persist timers; unused parent pull-watches stop; Esc nest-pop only when the overlay owns the pointer; connect-to-empty rolls back a failed edge persist.

## 0.4.2 — 2026-08-28

- **Svy Beam caret** — overlay inputs use native `caret-color` and `cursor: text` (higher specificity than Beam's custom hotspot cursor). `focus({ preventScroll: true })` plus a capture-phase guard stop Roam from scrolling the outline copy of an editing card into view.
- **Right sidebar inset** — fullscreen also ResizeObserves the right sidebar and re-places on the next two animation frames after the article class changes. When the article's right edge is within 8px of the viewport, the overlay `right` inset is 0.
- **Library portal** — the drawer mounts on `document.body` (fixed, 320px, 14px) so it is not scaled by `.pxd-world`. Items are opaque `#f5f8fa` / `#182026`. Empty search hides `roam/js/` and `roam/css` pages.
- **Nested crumbs** — opening a nested board pushes the parent onto a crumb stack (`Parent › Current`). Clicking a crumb opens that block (or page). Nested cards show the parsed name; unnamed boards get an inline "Name this board…" field.
- **Connect to empty** — dragging a handle onto empty board creates a card at the drop point, links it, and enters edit (Heptabase pull-from-port). Handles are 14px. An existing edge is kept if you connect the same pair again.
- **Review pack** — nested open passes parent uid explicitly; nest stack truncates on multi-level back; drop parsing no longer treats incidental 9-char tokens as block refs; connect failures do not leave dangling edges; nested name timers clear on repaint and dispose.

## 0.4.1 — 2026-08-28

- **Pending-changes patch** — layout persist no longer delete-all/recreates the metadata tree. Existing diagram blocks are patched in place: only changed `pos::` / `size::` / `color::` / edge / section rows are written, identical strings are skipped, and gone ids are the only deletes. Viewport persist is still the one-line `setViewport` path.
- **Article-pane fullscreen** — fullscreen follows `.rm-article-wrapper` (below the topbar, inset with the left sidebar) instead of `sidebar.right`. ResizeObserver on the article and sidebar plus a class MutationObserver re-place the overlay when the sidebar opens or closes. Drop `[[page]]` / block uid from the sidebar onto the board to add a card.
- **Visible sections** — sections use a 2px solid border, a light blue fill, `pointer-events: auto`, a default "Section" label, drag, corner resize, and double-click rename.
- **Opaque library** — the drawer sets its own `#ffffff` / `#1c2127` background so it stays readable when mounted outside `.pxd-root`. Blank titles and `roam/js/` pages are hidden until you search.
- **Nested overlay** — adding or opening a nested `{{[[diagram]]}}` card registers it as enhanced and opens our overlay fullscreen, not native Empty Roam Diagram. Nested cards show "Nested diagram" instead of the raw macro. Nested open no longer waits on the parent canvas.
- **Connect hit-testing** — `cardFromPoint` walks `elementsFromPoint` and ignores edge-hit strokes; temp edges are `pointer-events: none`; connect-tool handles stay visible.

## 0.4.0 — 2026-08-28

- **Fullscreen vs breadcrumbs** — fullscreen hides `#roam-breadcrumbs-panel` / `.breadcrumbs-content` only while `body.pxd-has-fullscreen`. The overlay sits below the remaining topbar and to the right of the left sidebar (article fill, not the whole window). Resize recomputes the inset. Inline boards leave breadcrumbs alone.
- **Scratch-host card editor** — double-click no longer `renderBlock`s the card uid (the hidden native diagram still owns it). Edit mounts on a `pxd:scratch` child of `[[plexus-diagram/metadata]]`, hydrates until MutationObserver-quiet, then a trusted mousedown/mouseup/click. Commit pulls the scratch string onto the card; empty pulls never overwrite known text.
- **Connection notes** — labels live on the connector (`label::` under `edge A->B`), not as extra cards. Double-click the line or click the midpoint pill. `show-edge-labels` defaults on.
- **Commands** — palette and slash keep Enhance, Restore, and Fullscreen only. Toolbar is a single nowrap row. `V` / `C` / `N` / `F` when the overlay owns the pointer.
- **Sync silence on open** — remounting an already-enhanced diagram no longer rewrites `[[plexus-diagram/metadata]]` or `:rf-diagram` viewport props when the stored snapshot already matches.
- **Viewport-only persist** — pan/zoom/fit writes only the `viewport::` metadata line; node/edge/section children are left intact.
- **Dirty flags** — initial fit, fullscreen resize, and dispose no longer schedule Roam writes; persist runs only after real user gestures (pan, zoom, drag, Fit, etc.).

## 0.3.2 — 2026-08-28

Double-clicking a card no longer blanks its text: `setBlockFocusAndSelection` was focusing the outline copy of the same uid (Roam then cleared the overlay mount), and a same-tick `focusout` committed an empty pull. Overlay editors now keep a text fallback until `renderBlock` hydrates, ignore focusout for 1s, and refuse to commit an empty pull over known text. Fullscreen sits below `.rm-topbar` so RoamJS breadcrumbs stay clickable and the Plexus toolbar is not hidden under it.

## 0.3.1 — 2026-08-28

House / daily-tab navigation left a `position:fixed` overlay covering the daily notes. Native Maximize unmounts on route change; our mount often survives because the diagram block is still in the outline. `hashchange` / `popstate` now exit fullscreen, drop `--zoomed`, and restore the inline height whenever the open page uid is no longer the diagram. The 250ms reconcile does not do this, so a Fullscreen click on an inline embed is not immediately undone.

## 0.3.0 — 2026-08-28

Canvas rewrite: the board is usable. Imported native React Flow nodes (165×83 on the live graph) are floored to real cards (min 240×140, default 280×160), and a viewport that paints any card under 140px, has zoom below 0.7, or shows no card at all is rejected and replaced by a fit once the root has a size (single card fits at zoom 1.5, centred; fitted viewport persisted once). Pan, wheel zoom, card drag and corner resize touch only CSS (`.pxd-world` transform, one card's box, the edges hanging off it) — no `innerHTML` rebuild, no Roam write per pixel; viewport/layout persist on pointer-up and wheel-end with a 150 ms debounce, serialized through one queue per session. Cards render with `renderString`; double-click swaps in the native block editor (`renderBlock`) and blur/Esc commits it back, so Roam chrome no longer paints into every card. `render()` reconciles card elements by uid, so a pull during editing never tears down the caret. Drag from a card's connect dots (or any card with the Connect tool) onto another card to link. Double-click empty board adds a card at that point; Card/Nested tool clicks still add. A hint pill explains pan/add/fullscreen on boards with ≤1 card until the first pointer down. Zoomed diagram pages open in fullscreen (`fullscreen-on-zoom`, default on; inline embeds stay inline). Grid lives outside the world and tracks pan/zoom; a live minimap replaces the empty box; toolbar buttons are grouped, high-contrast, with a zoom readout. Dark mode: card and toolbar backgrounds from `--bc-main` / `--bc-menu`, 1px visible borders, 2px `--cl-blue` ring for selection — no tinted fills. `applyPull` keeps in-memory positions, sizes, edges, sections, and viewport (a pull only refreshes content), so a debounced persist can no longer be undone by a concurrent add.

## 0.2.1 — 2026-08-27

Fix dead board on zoomed block pages. Navigating to `#/app/<graph>/page/<uid>` destroys the overlay DOM and the MutationObserver never remounted it. A reconcile pass (hashchange/popstate + 250ms interval) now prunes detached views, finds the native canvas — via the dated `block-input-…-body-outline-MM-DD-YYYY-<uid>` suffix or the location hash when ancestors carry no `data-uid` — and remounts the overlay. The pre-paint guard uses `display: none` (React Flow nodes punch through `visibility: hidden` by re-setting `visibility: visible` on themselves) and also hides the native `.rm-diagram-title-panel` and `.react-flow` chrome. Zoomed mounts fill the article (`pxd-mount--zoomed`). Every mount is stamped `data-diagram-uid` and remounts are idempotent per uid.

## 0.2.0 — 2026-08-27

Heptabase-usable overlay: full-bleed board sizing from native diagram (min 560px), horizontal labeled toolbar with zoom/fit/**Fullscreen** (Esc exits; covers the window like native Maximize), empty-canvas pan and cursor-anchored wheel zoom, Roam bullet/ref-count chrome hidden on cards, searchable library drawer that toggles without covering the board, and card titles off by default.

## 0.1.4 — 2026-08-27

Slash/command Enhance was a no-op: typing `/enh` puts the diagram block in edit mode, which unmounts `.rm-diagram`. The command now remembers the uid and waits for the native canvas to remount before overlaying.

## 0.1.3 — 2026-08-27

Slash commands use the same labels as the command palette (Roam Grid pattern), so `/enh` lists **Plexus Diagram: Enhance this diagram**.

## 0.1.2 — 2026-08-27

Metadata writes now generate UIDs before `block.create` / `page.create`. Live roamAlphaAPI returns `undefined` from those calls, so the first enhance was dropping `schema-version::`, `enhanced::`, and node/edge lines. Nested-diagram open uses `roamAlphaAPI.ui.mainWindow.openBlock`.

## 0.1.1 — 2026-08-27

Live-wire fixes against roamAlphaAPI (CDP, Svy graph):

- Fix native hide inversion: `.pxd-native-hidden` now sets `display: none`; pending state uses visibility
- Use EDN string pull pattern for `data.pull`; strip keyword colons from pull results
- Generate child block UIDs via `util.generateUID()`; default create order `"last"`
- Viewport writes try `roamAlphaAPI.updateBlock` before `data.block.update`
- Register slash/context commands via `addCommand`/`removeCommand` with live callback shapes
- Auto-enhance and focus checks pull `[:block/string]` via `roamAlphaAPI.data.pull`
- Find native diagram hosts via `diagramElForUid` (id suffix, data-uid, block-ref)
- Library mounts as overlay drawer; queries `roamAlphaAPI.data.q`; filters daily pages by UID
- Card/Section toolbar tools place items at click position; library uses viewport center
- Default `restore-native-on-unload` to false; unload disposes sessions without deleting metadata

## 0.1.0 — 2026-08-27

Initial release of Plexus Diagram.

- Hide native `.rm-diagram` React Flow renderer for enhanced diagrams and mount a vanilla DOM/SVG canvas overlay
- Keep Roam diagram children as the canonical card store; persist layout on `[[plexus-diagram/metadata]]`
- Writable viewport via native `:rf-diagram` props; import native node positions when metadata is absent
- Heptabase-like toolbar, cards, connectors, sections, library sidebar, and fat settings panel
- Command palette, slash command, and block context menu integration
- GitHub Pages developer extension at https://svyk.github.io/plexus-diagram
