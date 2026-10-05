# Batch 3-12 — 2.10.2 ECO-4 and ECO-5

ECO-4 is drawing cards in plexus-Diagram. ECO-5 is board nodes in roam-compass. Depends are done. Typing bench is waived. Palette stays two entries. Do not edit roam-plexus. Do not replace window.RoamCompass. It is frozen with isAvailable and focus only.

Measurements are the 2.10.2 bullets in docs/roadmap.md section 8.

## ECO-4 data model

A drawing card is a `((drawingUid))` ref. The drawing block is never the card. Never write props on a drawing.

A drop creates one ref and does not move the source. Toast: "Drawings stay where they are; this is a reference".

New drawing with Roam Plexus calls create once with parentUid of the board, then one ref card. Two writes. Without it, create the excalidraw macro as a board child, then the ref. Children that start with that macro are not items.

The body uses RoamPlexus.thumbnail when apiVersion is at least 6. Pass maxWidth only. Otherwise one hidden renderBlock, copy img.rm-inline-img--excalidraw, then unmount. Map tier is the title. Offscreen cards do not request a picture. A click on the image does nothing.

Open drawing calls RoamPlexus.open with no region flag. Sidebar passes sidebar true. With no API, open the block and toast that the expand control is Roam's.

Regions lists regionsOf. One pick adds one region ref. One write. A roam-plexus region becomes an ECO-3 card.

"New drawing here" is a canvas menu row and a Plexus Commands row.

## ECO-4 files

src/model/drawing-card.js owns detection, the drop plan, and the create plan. Test: test/drawing-card-2102.test.js.

src/view/drawing-card.js owns the image, Open drawing, Open in sidebar, and Regions. Fake-DOM test: test/drawing-card-view-2102.test.js.

src/css/drawing-card.css owns the image fit and a 1px button border.

The integrator wires drop.js, board.js, cards.js, session.js, and feature.js.

## ECO-4 acceptance

Drag a drawing: one ref card with the image. Props length on that drawing stays the same. Regions lists regionsOf, and one pick adds one card. New drawing calls create once and the card appears. Without Roam Plexus: macro child plus ref, no error. Dark and light shots.

## ECO-5

Compass reads only. It calls boardsWith, cardsOf, thumbnail, and open. Leave window.RoamCompass unchanged.

Setting Boards defaults on when the API exists, like Drawings. isBoardLike is a diagram macro. If the API is missing, there are no board nodes and no throw.

A page on boards shows those boards north-west, labelled On board, with a 160 px thumbnail. Hover is 480 px, under the drawing thumbnail cap. Click a board: its cards hang south, capped by Nodes per side.

Connection blocks become edges. Copy the label parse. Do not import Plexus. The edge label is the connection label.

Menu rows: Open on board, and Open in sidebar. The first argument is the board uid. The card uid is the option that pulses.

## ECO-5 files

src/model/boards.js in roam-compass owns isBoardLike, the node plan, and the edge label. Test: test/boards.test.js with a stub PlexusDiagram.

The integrator wires neighborhood.js, overlay.js, and settings.js. Run the Compass test script. Do not bump its version in this pass.

## ECO-5 acceptance

A page on two boards shows two board nodes with thumbnails. Click one: the south count matches cardsOf, capped. A labelled connection shows that label. Open on board pulses the card. With Plexus Diagram unloaded, no board nodes and no error.

## Amendments

These override earlier sentences.

Create the drawing with a string-only create. Pass no props. The second write is only the ref, and only that block gets plexus props. A block whose string starts with the excalidraw macro is not an item at any depth.

When apiVersion is at least 6, call thumbnail with maxWidth. If that is null, call once more with render true. Do not renderBlock the drawing inside the card. With no API, renderBlock once offscreen, copy the pixels to a canvas, then unmount. Revoke our URL on card unmount. A drawing card never enters edit.

regionsOf includes group, cframe, and poly. List every row. A pick adds one ref. Only area, rect, and frame become ECO-3 cards.

Open drawing calls RoamPlexus.open(drawingUid, { sidebar }). Never pass the card uid. Skip the call when that drawing's editor is already mounted. With no API, open the block and toast that the expand control is Roam's.

Open on board calls PlexusDiagram.open(boardUid, { card: cardUid }). Sidebar adds sidebar true. The first argument is the board.

Compass reads connection children itself. Do not add a Plexus method.
