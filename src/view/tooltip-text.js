// Every hover tooltip string, keyed by control id (PL-3). Edit the words here; nothing else holds them.
// A control carries `data-tip="<id>"` and, when its meaning changes, `data-tip-state="<state>"`;
// the lookup tries `<id>:<state>` first, then `<id>`.
// Entry: name (bold), key (shortcut, string or array, shown in <kbd>), desc (one line), hint (second line).

import { PALETTE } from "../model/schema.js";
import { SHAPES } from "../model/shapes.js";

const LOCK = "Double-click to keep this tool.";
const e = (name, desc, key, hint) => {
  const out = { name, desc };
  if (key) out.key = key;
  if (hint) out.hint = hint;
  return out;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const TIP_TEXT = {
  // ---- board bar
  crumb: e(null, "Go back up to this board."),
  "crumb.current": e(null, "The board you are looking at."),
  "crumb.more": e("Hidden boards", "Show the boards between the first and the last crumb."),
  "toolbar.add": e("Add", "Open the panel to search the graph and drag pages, blocks and today's notes onto the board."),
  "toolbar.info": e("Info", "Show details for the selected card: references, attributes, tasks and the boards it sits on.", "I"),
  "toolbar.links": e("Graph links", "Cycle the lines drawn from page references and attributes.", "L"),
  "toolbar.links:off": e("Links: Off", "No graph lines. Only the arrows you drew are shown.", "L", "Click to show attribute links."),
  "toolbar.links:attributes": e("Links: Attributes", "Draw lines only for shared Name:: attributes.", "L", "Click to show all links."),
  "toolbar.links:all": e("Links: All", "Draw lines for every shared page reference and attribute.", "L", "Click to turn links off."),
  "toolbar.table": e("Table", "Show this board's cards as a table you can sort and edit."),
  "toolbar.table:on": e("Board", "Go back from the table to the canvas."),
  "toolbar.kanban": e("Kanban", "Group the cards into columns by status or tag."),
  "toolbar.kanban:on": e("Board", "Go back from the kanban columns to the canvas."),
  "toolbar.bg": e("Background", "Choose the pattern and the tone of this board, or reset it to the default."),
  "toolbar.lens": e("Tags", "Tag lens: keep the cards with one tag bright and dim the rest."),
  "toolbar.focus": e("Focus", "Fade everything except the selected cards and what they connect to.", "F"),
  "toolbar.present": e("Present", "Step through the sections full screen, one frame at a time.", "P"),
  "toolbar.more": e("More", "More board actions: export, templates, dock position, layouts and views."),
  "toolbar.zoom-out": e("Zoom out", "Make everything on the board smaller.", "⌘ −"),
  "toolbar.zoom": e("Zoom", "The current zoom. Click to return to 100%.", "⇧ 0"),
  "toolbar.zoom-in": e("Zoom in", "Make everything on the board larger.", "⌘ ="),
  "toolbar.fit": e("Fit", "Zoom and pan so every card is in view.", "⇧ 1"),
  "toolbar.minimap": e("Minimap", "Show or hide the small map of the whole board."),
  "toolbar.edit": e("Edit block", "Open the diagram block itself in Roam to edit its text or children."),
  "toolbar.fullscreen": e("Fullscreen", "Open this board full screen. Esc leaves it."),
  "toolbar.fullscreen:on": e("Exit fullscreen", "Return the board to its place on the page.", "Esc"),
  badge: e("Version", "The installed Plexus version. Click to read what changed in it."),
  "rail.badge": e("Version", "The installed Plexus version. Click to read what changed in it."),
  sync: e("Saved", "Every change is written to Roam."),
  "sync:idle": e("Saved", "Every change is written to Roam."),
  "sync:writing": e("Saving", "Your last change is being written to Roam."),
  "sync:retrying": e("Retrying", "Roam did not take the last write. Plexus is trying again."),
  "sync:failed": e("Could not save", "The last change did not reach Roam. Undo it or try the action again."),

  // ---- tool dock and board-bar tools
  "tool.select": e("Select", "Click cards to select them and drag to move them. Drag empty space to pan; Shift-drag to select.", "V", LOCK),
  "tool.hand": e("Hand", "Drag a card to move it. Drag empty space to pan; Shift-drag to select.", "H", LOCK),
  "tool.card": e("Card", "Click the board to make a card, or drag to size one. It is a Roam block.", "N", LOCK),
  "tool.task": e("Task", "Click the board to make a task card: a Roam TODO block. Better Tasks sets its due date and project from the chips.", "K", LOCK),
  "tool.text": e("Text", "Click the board to place a free text label.", "T", LOCK),
  "tool.sticky": e("Sticky", "Click the board to place a colored sticky note.", "S", LOCK),
  "tool.shape": e("Shape", "Click or drag to draw a shape. Pick its kind in the options beside the dock.", "R", LOCK),
  "tool.section": e("Section", "Drag a colored frame. Cards dropped inside become its members.", "G", LOCK),
  "tool.board": e("Board", "Click to make a nested board you can open in place.", "W", LOCK),
  "tool.table": e("Table", "Click the board to make a Roam table. Cells edit in Roam.", "B", LOCK),
  "tool.connect": e("Connect", "Drag from one card to another to draw an arrow, which is saved as a Roam block. Drag empty space to pan; Shift-drag to select.", "C", LOCK),
  "dock.look.block": e("Block look", "Show new cards, or the selected one, as a plain Roam block."),
  "dock.look.card": e("Card look", "Show new cards, or the selected one, with a title row."),
  "backtocontent": e("Back to content", "Fit the view back to your cards."),

  // ---- right control rail
  "rail.zoom-in": e("Zoom in", "Make everything on the board larger.", "⌘ ="),
  "rail.zoom-out": e("Zoom out", "Make everything on the board smaller.", "⌘ −"),
  "rail.fit": e("Fit view", "Zoom and pan so every card is in view.", "⇧ 1"),
  "rail.minimap": e("Minimap", "Show or hide the small map of the whole board."),
  "rail.png": e("Save PNG", "Save the board as an image."),
  "rail.outline": e("Open outline", "Open the board's blocks as an outline in the right sidebar."),
  "rail.edit": e("Edit block", "Open the diagram block itself in Roam to edit its text or children."),
  "rail.fullscreen": e("Maximize", "Open this board full screen. Esc leaves it."),
  "rail.fullscreen:on": e("Minimize", "Return the board to its place on the page.", "Esc"),
  "rail.zoom": e("Zoom", "The current zoom. Click to return to 100%.", "⇧ 0"),

  // ---- background popover
  "bg.default": e("Use as default", "Use this pattern and tone for every board that does not set its own."),
  "bg.reset": e("Reset", "Clear this board's own pattern and tone."),
  "swatch.none": e("No color", "Clear the color, or use the default tone."),
  "swatch.paper": e("Paper", "A warm off-white tone for the board."),

  // ---- card hover toolbar and the other context bars
  "ctx.color": e("Color", "Open the color picker for this card."),
  "ctx.expand": e("Show children", "Show this block's children as an outline inside the card."),
  "ctx.expand:on": e("Hide children", "Fold the children away so the card shows only its own block."),
  "ctx.refs": e("References", "Show the blocks that link to this card."),
  "ctx.edit": e("Edit", "Edit the card's text in place.", "Enter"),
  "ctx.mark-region": e("Mark region", "Drag a rectangle on this image."),
  "ctx.sidebar": e("Open in sidebar", "Open the block or page in Roam's right sidebar."),
  "ctx.collapse": e("Collapse", "Shrink the card to its title row."),
  "ctx.collapse:on": e("Expand", "Show the whole card again."),
  "ctx.related": e("Related", "Find pages and blocks related to this card."),
  "ctx.pin-toggle": e("Pin", "Lock the position and size so it cannot be moved or resized by accident."),
  "ctx.pin-toggle:on": e("Unpin", "Allow moving and resizing again."),
  "ctx.fit-height": e("Fit height", "Grow or shrink the card to the height of its text."),
  "ctx.copy-ref": e("Copy ref", "Copy a block or page reference for this card to paste into Roam."),
  "ctx.duplicate": e("Duplicate", "Make a copy of the selection next to it.", "⌘ D"),
  "ctx.send-to": e("Send to board", "Move the selection into another board."),
  "ctx.mindmap": e("Mind map", "Lay the card's children out as cards around it, with arrows."),
  "ctx.same-color": e("Select same color", "Select every card or section of this color."),
  "ctx.connected": e("Select connected", "Select the cards linked to this one by an arrow or a graph link."),
  "ctx.wrap": e("Wrap in section", "Put the selected cards in a new section.", "⌘ G"),
  "ctx.wrap-board": e("Move into new board", "Move the selection into a new nested board."),
  "ctx.save-view": e("Save view", "Save a view framed on the selected cards."),
  "ctx.fold": e("Fold", "Collapse the selected cards to their titles.", "⌘ ⌥ Enter"),
  "ctx.fold:on": e("Unfold", "Expand the collapsed cards again.", "⌘ ⌥ Enter"),
  "ctx.delete": e("Delete", "Remove the selection. On a section, the cards stay; Shift+Delete removes them too.", "Delete"),
  "ctx.open-board": e("Open", "Open this board in place.", "Enter"),
  "ctx.own-page": e("Own page", "Open the nested board on its own Roam page."),
  "ctx.rename-board": e("Rename board", "Change the board's name."),
  "ctx.rename": e("Rename", "Edit the section's title.", "Enter"),
  "ctx.contents": e("Select contents", "Select the cards inside this section."),
  "ctx.all-in-section": e("Select all in section", "Select everything inside the section, nested sections too."),
  "ctx.collapse-section": e("Collapse", "Fold the section down to its title."),
  "ctx.collapse-section:on": e("Expand", "Show the section's cards again."),
  "ctx.section-note": e("Description", "Add a one-line description under the section's title."),
  "ctx.section-note:on": e("Remove note", "Delete the section's description line."),
  "ctx.lock": e("Lock", "Pin the section and everything inside it."),
  "ctx.lock:on": e("Unlock", "Unpin the section and everything inside it."),
  "ctx.present-section": e("Present", "Present this section full screen."),
  "ctx.fit-section": e("Fit to contents", "Resize the section around its cards."),
  "ctx.auto-fit": e("Auto-fit", "Keep the section sized to its cards as they move."),
  "ctx.auto-fit:on": e("Auto-fit is on", "The section grows around its cards. Click to stop."),
  "ctx.fold-all": e("Fold all", "Collapse every card in the section to its title."),
  "ctx.flip": e("Flip", "Swap the arrow's two ends."),
  "ctx.unblock": e("Connect to the page", "End the arrow on the whole page instead of one block."),
  "ctx.label": e("Label", "Edit the text on the arrow."),
  "ctx.notes": e("Notes", "Open the arrow's own block in the sidebar to add notes."),
  "ctx.write": e("Write to graph", "Write this link as a Name:: attribute on the source block."),
  "ctx.source": e(null, "Open the block that makes this link in the sidebar."),
  "ctx.pin": e("Pin as connection", "Turn this graph link into an arrow you can style."),
  "ctx.align.left": e("Align left", "Line the selected cards up on their left edges."),
  "ctx.align.center": e("Align centers", "Line the selected cards up on their horizontal centers."),
  "ctx.align.right": e("Align right", "Line the selected cards up on their right edges."),
  "ctx.align.top": e("Align top", "Line the selected cards up on their top edges."),
  "ctx.align.middle": e("Align middles", "Line the selected cards up on their vertical centers."),
  "ctx.align.bottom": e("Align bottom", "Line the selected cards up on their bottom edges."),
  "ctx.distribute.h": e("Distribute horizontally", "Space the selected cards evenly from left to right."),
  "ctx.distribute.v": e("Distribute vertically", "Space the selected cards evenly from top to bottom."),
  "ctx.tidy.grid": e("Tidy into a grid", "Arrange the selection in rows and columns."),
  "ctx.tidy.row": e("Tidy into a row", "Arrange the selection in one row."),
  "ctx.tidy.column": e("Tidy into a column", "Arrange the selection in one column."),
  "ctx.same-size.width": e("Same width", "Give the selected cards the width of the first one."),
  "ctx.same-size.height": e("Same height", "Give the selected cards the height of the first one."),
  "ctx.same-size.both": e("Same size", "Give the selected cards the width and height of the first one."),
  "ctx.dir.one": e("One way", "An arrowhead at the end only."),
  "ctx.dir.two": e("Two way", "An arrowhead at both ends."),
  "ctx.dir.none": e("No arrow", "A plain line with no arrowheads."),
  "ctx.route.curve": e("Curve", "Draw the connection as a smooth curve."),
  "ctx.route.straight": e("Straight", "Draw the connection as a straight line."),
  "ctx.route.elbow": e("Elbow", "Draw the connection with right-angle bends."),
  "ctx.dash.solid": e("Solid", "A solid line."),
  "ctx.dash.dashed": e("Dashed", "A dashed line."),
  "ctx.dash.animated": e("Animated", "A dashed line that moves from start to end."),
  "bg.pattern.dots": e("Dots", "A dotted grid behind the cards."),
  "bg.pattern.lines": e("Lines", "Horizontal lines behind the cards."),
  "bg.pattern.cross": e("Cross", "Small crosses behind the cards."),
  "bg.pattern.grid": e("Grid", "A square grid behind the cards."),
  "bg.pattern.plain": e("Plain", "No pattern behind the cards."),

  // ---- Properties panel
  "props.toggle": e("Properties", "Show or hide the style panel. Its state is remembered on this device."),
  "props.group.blocks": e("Blocks", "Text size, color, alignment, fill and border for the selected cards and text."),
  "props.group.edge": e("Connection", "Direction, line style, shape, weight and color of the selected arrow."),
  "props.group.group": e("Group", "Title size, colors and border of the selected sections."),
  "props.group.defaults": e("Default groups", "The look every new section on this board starts with."),
  "props.group.diagram": e("Diagram", "The background color and pattern of this board."),
  "props.reset": e("Reset", "Remove the custom styles shown in this group."),
  "props.step.dec": e("Smaller", "Lower this size by one pixel."),
  "props.step.inc": e("Larger", "Raise this size by one pixel."),
  "props.step.input": e(null, "Type a size in pixels, then press Enter."),
  "props.chip": e(null, "Open the color picker for this style. Pick again to close it."),
  "props.choice.align": e(null, "Align the text in the selected cards. Default follows the card look."),
  "props.choice.dir": e(null, "Set where the selected arrow has arrowheads."),
  "props.choice.dash": e(null, "Set the line style of the selected arrow."),
  "props.choice.route": e(null, "Set how the selected arrow is drawn between its ends."),
  "props.choice.weight": e(null, "Set the line thickness of the selected arrow in pixels."),
  "props.choice.texture": e(null, "Set the pattern behind this board's cards. Default uses the board setting."),
  "picker.swatch": e(null, "Use this color for the style you are editing."),
  // ---- sticky header (EK-5)
  "sticky.drag": e("Sticky", "Drag the header to move the note. Click in the note to type."),
  "sticky.min": e("Minimize", "Collapse this sticky to its header. It stays on the board."),
  "sticky.expand": e("Expand", "Show the whole sticky again."),
  "sticky.color": e("Sticky color", "Pick a color for this sticky."),
  "sticky.swatch": e(null, "Use this color for the sticky."),

  // ---- the board itself
  minimap: e("Minimap", "The whole board at a glance. Click or drag to move the view."),
  kids: e("Children", "This block has children. Click to show them as an outline inside the card; hover to peek."),
  "kids:on": e("Children", "The children are shown. Click to hide them again."),
  "edge.bend": e("Arrow end on a block", "This arrow ends on one block of the page card, not the whole page."),
  "edge.bend:clamped": e("Arrow end on a block", "The block is scrolled out of view. Click to scroll the card to it."),
  relchip: e("Connection", "This block is a connection on a board. Click to see where it sits."),
  "relpop.board": e("Open on board", "Go to the board and select this connection."),
  "relpop.sidebar": e("Open in sidebar", "Open the board in the right sidebar."),
  "edge.row": e("Linked block", "An arrow on the board ends on this block."),

  // ---- PDF parse (settings descriptions, and the flat-merge chip)
  "parse.helper-url": e("Parse helper address", "Address of the local parse helper. The default is http://127.0.0.1:48765. Plexus calls it only when you parse."),
  "parse.helper-token": e("Parse helper token", "Secret from the helper's first start. Empty turns the helper off. Plexus sends it only to that address."),
  "parse.engine": e("Default parse engine", "Auto uses the built-in parser and offers Docling when the helper is ready. Built-in never calls the helper. Docling uses the helper."),
  "parse.formula": e("Formula enrichment", "Ask Docling to read formulas as LaTeX. Off leaves a formula as a crop. This is the slow part of a Docling parse."),
  "parse.ocr": e("Parse OCR", "Auto lets the helper decide. On forces OCR. Off skips it. Scanned pages need OCR."),
  "parse.link-safe": e("Safe links when inserting", "Wrap [[pages]], ((blocks)), {{macros}}, #tags and Name:: so a parsed insert does not create pages. On by default."),
  "parse.numbered": e("Numbered lists when inserting", "On writes ordered lists with Roam's 1. syntax. Off keeps the original number as text on a bullet."),
  "parse.footnotes": e("Footnotes", "Inline places each note after the paragraph that cites it. End places every note after the insert."),
  "parse.merges-flat": e("Merged cells shown flat", "Roam Grid draws merges. Native Roam shows the covered cells empty.", null, "Insert as flat table repeats the anchor text into covered cells."),
  "parse.insert-flat": e("Insert as flat table", "Repeat the anchor text into covered cells so a native table still reads."),
};

for (const c of PALETTE) TIP_TEXT[`swatch.${c}`] = e(cap(c), `Color the selection ${c}, or tone the board ${c}.`);
for (const s of SHAPES) TIP_TEXT[`dock.shape.${s}`] = e(cap(s), `Draw ${s === "rounded" ? "rounded rectangles" : `${s}s`} with the Shape tool, or change the selected shape.`);
for (const n of [16, 24, 32, 48]) {
  const word = { 16: "Small", 24: "Medium", 32: "Large", 48: "Extra large" }[n];
  TIP_TEXT[`ctx.size.${n}`] = e(`${word} text`, `Set the label to ${n} px.`);
}
for (const n of [1, 2, 3, 4]) TIP_TEXT[`ctx.weight.${n}`] = e(`Weight ${n}`, `Draw the connection ${n} px thick.`);

export function tipEntry(id, state) {
  if (!id) return null;
  if (state && TIP_TEXT[`${id}:${state}`]) return TIP_TEXT[`${id}:${state}`];
  return TIP_TEXT[id] || null;
}

// Class-derived id for a chrome button: the LAST `pxd-toolbar__x` / `pxd-rail__x` / `pxd-ctx__x` / `pxd-bg__x` token.
const BLOCKS = /^pxd-(toolbar|rail|ctx|bg)__([a-z0-9-]+)$/;
const SKIP = new Set(["btn", "row", "group", "tools", "picker", "sources", "extra", "pattern", "tones"]);
export function tipIdForClass(cls) {
  let found = null;
  for (const token of String(cls || "").split(/\s+/)) {
    const m = BLOCKS.exec(token);
    if (m && !SKIP.has(m[2])) found = `${m[1]}.${m[2]}`;
  }
  if (!found && /(^|\s)pxd-badge(\s|$)/.test(String(cls || ""))) return "badge";
  return found;
}
