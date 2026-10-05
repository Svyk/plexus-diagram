# Batch 3-13 — 2.10.3 ECO-6, ECO-7, and DOC-19

Depends are done. The typing bench is waived, including DOC-19 item 3. The palette stays two entries. Do not edit roam-plexus. The 2.10.3 bullet in section 8 is the measurement.

## ECO-6

Keep the frozen RoamCompass object. Keep isAvailable and focus. Add apiVersion 1, open, focusBlock, and isOpen. Keep roam-compass:ready and roam-compass:unload.

open(uid) uses the same path as focus(uid). sidecar true turns on the sidecar Compass already has for that open. No new sync loop. focusBlock(uid) is that same path for a block. isOpen is true when the overlay is visible.

The Plexus card row "Open in Compass" exists only when RoamCompass.open is a function, checked when the menu is built. A page card passes the page uid. Any other card passes the block uid.

Compass node menu "Show on board…" appears when PlexusDiagram.boardsWith returns one or more boards. One board calls open(boardUid, { card }). Several boards show a picker of titles, and a pick calls the same open. The card pulses. Keep "Open on board".

## ECO-6 files

roam-compass src/extension.js owns the global. Extend test/extension.test.js.

roam-compass src/model/boards.js owns the one-board versus picker plan. Extend test/boards.test.js.

The Compass integrator wires overlay.js only. Do not drop existing menu rows.

plexus src/view/menu-model.js adds the row from ctx.compass. Extend test/menu.test.js.

The Plexus integrator wires the click to RoamCompass.open from the existing menu handler. One owner for that click.

## ECO-7

The card row "Annotate as drawing" exists only when the card kind is image and RoamPlexus.create is a function. Checked when the menu is built.

create cannot place an image. Call create once with the board as parentUid. Then one ref card to the right of the image, same width and height, 40 px gap.

Then one connection under the existing Connections child. If that child is missing, create it first. The edge string uses label annotates, from the drawing uid, to the image uid. Then RoamPlexus.open on the drawing uid. Toast text is "Drop the image into the drawing".

The creates are sequential. Do not invent an undo group. Record the undo count live. Without Roam Plexus the row is absent. The outline chip stays chipText and must contain the annotates mark between the two names.

## ECO-7 files

src/model/annotate.js owns the plan: create args, card rect, edge string. Test: test/annotate-2103.test.js.

menu-model.js adds the row from ctx.canAnnotate. The same implementer owns that file for both rows.

The integrator wires the three writes, the open, and the toast in the existing menu action path. Do not add a command-palette entry.

## DOC-19

docs/interop.md is a matrix. Rows: drawing card, region card, compass boards, open in compass, show on board, annotate. Columns: needs Plexus, needs Compass, needs Roam Plexus. Every cell is feature-detected.

README gets a short Works with paragraph. CHANGELOG entries go in plexus and compass only. roam-plexus stays 0.33.0, apiVersion 7.

The live matrix is four configurations: all three loaded, then each one alone. Zero console errors from the three. Unload each: no global of its own, and no .pxd-*, .compass-*, or .plexus-* nodes. Do not run a typing bench.

## Acceptance

ECO-6. From a page card, Open in Compass centres Compass on that page. Show on board with one board pulses the card. With two boards it shows a picker. After Compass unloads, the Plexus row is gone on the next menu.

ECO-7. Annotate as drawing creates the drawing, the card, and the connection, then opens the drawing and shows the toast. The chip contains the annotates mark. Without Roam Plexus the row is absent.

DOC-19. npm run check is green in all three repos. The matrix is recorded. Unload is clean. Pages cmp covers plexus and compass.

## Out of scope

Sidecar sync. Placing the image inside the drawing. A roam-plexus release.

## Amendments

These override earlier sentences.

Show on board calls PlexusDiagram.open(boardUid, { card }). boardsWith already finds the card uid and drops it. Add card on each result. One board uses that card. A picker row does too. Never pass the page uid as the card.

Open in Compass resolves a page with host.pageUid(item.target.title), the same path as Open. A block ref passes target.uid. A plain block passes the card uid.

The drawing child is not a card. Only the ref is. The image end of the edge is the image card uid.

open(uid) calls focusUid, then hides the results list. A closed Compass must not leave Find a page open. sidecar true uses the sidecar flag load already syncs. No new loop.

Show on board calls PlexusDiagram.open(board.uid, { card: board.card }). The card is query column 3, row[2]. row[1] is the board's page. Never pass it.

addEdge from the ref card uid to the image card uid, label annotates. The drawing block is not an end. The chip is the existing chipText and includes the annotates mark.

Review must-fix, checked 2026-10-05, is not a bug. addEdge stores semanticRef, so the block text is ((drawing uid)) then annotates then ((image uid)). That matches the Roam model. The chip names come from the two cards. Do not replace that string with annotatePlan.edge.string.

Undo is 4 creates when Connections is created, and 3 when it already exists. No undo group.

RoamPlexus.open(drawingUid) only runs mainWindow.openBlock. Do not call whenOpen. Show the toast. The editor can stay closed.

Unload one extension and only its own global is gone, and only if it still owns that global. Compass removes .compass-root. Plexus removes .pxd-*. Roam Plexus removes its portal, root, offscreen, and dock. Leave an open Excalidraw shell. Do not require the other prefixes to be gone.











