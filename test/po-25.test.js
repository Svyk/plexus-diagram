import assert from "node:assert/strict";
import test from "node:test";

import { invZoom } from "../src/model/geometry.js";
import { buildBoard } from "../src/model/board.js";
import { createRelChips, placePopover, previewModel, rowBarRect, rowFraction } from "../src/relchips.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const timers = { later: () => () => {}, frame: () => () => {} };
const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": props, ":block/children": kids });
const rawBoard = () => raw("board001", "{{[[diagram]]:Roadmap}}", plx({ v: 2 }), [
  raw("cardA001", "Alpha idea", plx({ x: 0, y: 0, w: 200, h: 100 }), [], 0),
  raw("cardB001", "[[Beta page]]", plx({ x: 500, y: 0, w: 360, h: 480 }), [], 1),
  raw("conn0001", "Connections", plx({ type: "edges" }), [
    raw("edge0001", "((cardA001)) → causes → ((rowBlk003))", plx({ type: "edge", from: "cardA001", to: "cardB001", toBlock: "rowBlk003", color: "blue" }), [], 0),
  ], 2),
]);
const outline = [
  { uid: "rowBlk001", string: "one", children: [] },
  { uid: "rowBlk002", string: "two", children: [{ uid: "kid00001", string: "kid", children: [] }] },
  { uid: "rowBlk003", string: "A very long target sentence that cannot possibly fit inside a narrow page card", children: [] },
  { uid: "rowBlk004", string: "four", children: [] },
];
const texts = { rowBlk003: outline[2].string };

// ------------------------------------------------------------------ PO-2 geometry
test("PO-2 rowBarRect keeps the bar inside the card at every fraction and card size", () => {
  for (const rect of [{ x: 500, y: 0, w: 360, h: 480 }, { x: 0, y: 0, w: 120, h: 60 }, { x: 10, y: 20, w: 40, h: 12 }]) {
    for (const frac of [0, 0.25, 0.5, 1, null, NaN, -3, 9]) {
      const b = rowBarRect(rect, frac, 14);
      assert.ok(b.x >= rect.x && b.x + b.w <= rect.x + rect.w, `x inside ${JSON.stringify(rect)} ${frac}`);
      assert.ok(b.y >= rect.y && b.y + b.h <= rect.y + rect.h, `y inside ${JSON.stringify(rect)} ${frac}`);
      assert.ok(b.maxChars * 14 * 0.58 <= b.w, "the text budget fits the bar");
    }
  }
  const top = rowBarRect({ x: 0, y: 0, w: 300, h: 400 }, 0, 14);
  const bottom = rowBarRect({ x: 0, y: 0, w: 300, h: 400 }, 1, 14);
  assert.ok(bottom.y > top.y, "a later row sits lower");
  assert.ok(top.y >= 14 * 2, "below the title strip");
});

test("PO-2 rowFraction is the row's place among visible rows; folded kids and Better Tasks attrs are not rows", () => {
  assert.equal(rowFraction(outline, "rowBlk001"), 0.5 / 5);
  assert.equal(rowFraction(outline, "kid00001"), 2.5 / 5);
  const folded = [{ uid: "a", string: "a", open: false, children: [{ uid: "b", string: "b", children: [] }] }, { uid: "c", string: "c", children: [] }];
  assert.equal(rowFraction(folded, "b"), null);
  assert.equal(rowFraction(folded, "c"), 1.5 / 2);
  const due = [{ uid: "d", string: "BT_attrDue:: [[x]]", children: [] }, { uid: "e", string: "e", children: [] }];
  assert.equal(rowFraction(due, "e"), 0.5);
  assert.equal(rowFraction([], "x"), null);
});

test("PO-2 the preview model puts the target bar inside the page card and the arrow into it", () => {
  const board = buildBoard(rawBoard());
  const model = previewModel(board, "edge0001", { blockText: (u) => texts[u], rowFrac: (item, uid) => (item.uid === "cardB001" ? rowFraction(outline, uid) : null) });
  const card = model.cards.find((c) => c.uid === "cardB001").rect;
  const bar = model.toBar;
  assert.ok(bar, "a target bar");
  assert.ok(bar.x >= card.x && bar.x + bar.w <= card.x + card.w && bar.y >= card.y && bar.y + bar.h <= card.y + card.h, "inside the card");
  assert.ok(bar.label.endsWith("…") && bar.label.length <= bar.maxChars, "the long text is cut to the bar");
  assert.equal(bar.frac, rowFraction(outline, "rowBlk003"));
  assert.equal(model.toInner.angle, 0, "the arrow enters the card from its left side, heading right");
  assert.equal(model.toInner.tip.y, bar.y + bar.h / 2, "and lands on the bar's middle");
  assert.ok(model.toInner.tip.x > card.x, "the tip is inside the card");
  assert.equal(model.fromBar, null);
  const noFrac = previewModel(board, "edge0001", { blockText: (u) => texts[u] });
  assert.equal(noFrac.toBar.frac, 0.5, "no known row index: the vertical middle");
});

test("PO-2 the drawn map holds the bar in a clip of its own card; no text leaves a card", (t) => {
  const stub = createDomStub();
  const restore = stub.install();
  t.after(restore);
  const doc = stub.document;
  const host = {
    graph: "Svy",
    listConnectionBlocks: () => [["edge0001", "board001"]],
    pullBoard: () => rawBoard(),
    blockString: (u) => texts[u] ?? null,
    pageOutline: () => ({ uid: "p", exists: true, blocks: outline }),
  };
  const chips = createRelChips({ doc, win: stub.window, host, graph: () => "Svy", timers });
  chips.start();
  const container = doc.createElement("div");
  container.className = "roam-block-container";
  const input = doc.createElement("div");
  input.className = "rm-block__input roam-block";
  input.id = "block-input-Svy-body-outline-pageUID01-edge0001";
  container.append(input);
  doc.body.append(container);
  chips.scan(container);
  stub.dispatch([...container.children].find((c) => c.classList.contains("pxd-relchip")), "click", {});
  const pop = doc.body.querySelector(".pxd-relpop");
  const row = pop.querySelector(".pxd-relpop__row");
  assert.ok(row.getAttribute("clip-path")?.startsWith("url(#pxd-relclip-"), "clipped to the card");
  assert.ok(pop.querySelector("clipPath"), "the clip path exists");
  assert.ok(pop.querySelectorAll(".pxd-relpop__head").length >= 1, "an arrowhead");
  assert.equal(pop.querySelectorAll(".pxd-relpop__inner").length, 1, "the arrow runs into the bar");
  const rect = row.querySelector("rect");
  const card = pop.querySelectorAll(".pxd-relpop__card--to rect")[0];
  assert.ok(Number(rect.getAttribute("x")) >= Number(card.getAttribute("x")));
  assert.ok(Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) <= Number(card.getAttribute("x")) + Number(card.getAttribute("width")));
  assert.match(row.querySelector("text").textContent, /…$/);
});

// ------------------------------------------------------------------ PO-3 placement
const vp = { left: 0, top: 0, right: 1000, bottom: 800 };
const size = { w: 380, h: 300 };

test("PO-3 placePopover prefers below, then above, then right, then left", () => {
  const below = placePopover({ anchor: { left: 100, top: 100, right: 300, bottom: 140 }, size, viewport: vp });
  assert.equal(below.side, "below");
  assert.equal(below.top, 148, "8px under the chip");
  const above = placePopover({ anchor: { left: 100, top: 600, right: 300, bottom: 640 }, size, viewport: vp });
  assert.equal(above.side, "above");
  assert.equal(above.top, 600 - 8 - 300, "8px over the chip");
  const right = placePopover({ anchor: { left: 50, top: 350, right: 150, bottom: 390 }, size: { w: 380, h: 740 }, viewport: vp });
  assert.equal(right.side, "right");
  assert.equal(right.left, 158);
  const left = placePopover({ anchor: { left: 800, top: 350, right: 950, bottom: 390 }, size: { w: 380, h: 740 }, viewport: vp });
  assert.equal(left.side, "left");
  assert.equal(left.left, 800 - 8 - 380);
});

test("PO-3 placePopover never overlaps the anchor, and shrinks with a scroll when nothing fits", () => {
  const anchor = { left: 100, top: 380, right: 300, bottom: 420 };
  const p = placePopover({ anchor, size: { w: 380, h: 700 }, viewport: { ...vp, right: 500 } });
  assert.equal(p.scroll, true);
  assert.ok(p.maxHeight >= 80 && p.maxHeight < 700);
  const box = { left: p.left, top: p.top, right: p.left + p.width, bottom: p.top + p.maxHeight };
  const apart = box.bottom <= anchor.top || box.top >= anchor.bottom || box.right <= anchor.left || box.left >= anchor.right;
  assert.ok(apart, "the shrunk popover still clears the chip");
  assert.ok(box.top >= 8 && box.bottom <= 800 - 8, "inside the viewport");
});

test("PO-3 placePopover respects the scroll container's bounds", () => {
  const p = placePopover({ anchor: { left: 100, top: 100, right: 300, bottom: 140 }, size, viewport: vp, bounds: { left: 0, top: 0, right: 600, bottom: 300 } });
  assert.notEqual(p.side, "below", "the container ends at 300, so there is no room under the chip");
  const q = placePopover({ anchor: { left: 560, top: 100, right: 590, bottom: 120 }, size: { w: 380, h: 150 }, viewport: vp, bounds: { left: 0, top: 0, right: 600, bottom: 800 } });
  assert.ok(q.left + q.width <= 600 - 8, "kept inside the right edge of the container");
});

function popFixture(t, anchorRect, avoidRect) {
  const stub = createDomStub();
  const restore = stub.install();
  t.after(restore);
  const doc = stub.document;
  const host = { graph: "Svy", listConnectionBlocks: () => [["edge0001", "board001"]], pullBoard: () => rawBoard(), blockString: (u) => texts[u] ?? null };
  const chips = createRelChips({ doc, win: stub.window, host, graph: () => "Svy", timers });
  chips.start();
  const container = doc.createElement("div");
  container.className = "roam-block-container";
  const main = doc.createElement("div");
  main.className = "rm-block-main";
  const input = doc.createElement("div");
  input.className = "rm-block__input roam-block";
  input.id = "block-input-Svy-body-outline-pageUID01-edge0001";
  main.append(input);
  container.append(main);
  doc.body.append(container);
  chips.scan(container);
  const chip = [...container.children].find((c) => c.classList.contains("pxd-relchip"));
  chip._rect = anchorRect;
  main._rect = avoidRect;
  return { stub, doc, chip, main, chips };
}

test("PO-3 the popover opens clear of its chip and of the block line, and follows the chip on scroll", (t) => {
  const f = popFixture(t,
    { left: 40, top: 560, right: 340, bottom: 580, width: 300, height: 20 },
    { left: 40, top: 530, right: 900, bottom: 556, width: 860, height: 26 });
  f.stub.dispatch(f.chip, "click", {});
  const pop = f.doc.body.querySelector(".pxd-relpop");
  assert.ok(pop, "open");
  assert.equal(pop.getAttribute("data-side"), "above", "no room below 580 in a 768px window, so above the block line");
  const natural = 300;
  assert.ok(Number.parseInt(pop.style.top, 10) + natural <= 530 - 8 + 1, "ends above the block line with an 8px gap");
  f.chip._rect = { left: 40, top: 100, right: 340, bottom: 120, width: 300, height: 20 };
  f.main._rect = { left: 40, top: 70, right: 900, bottom: 96, width: 860, height: 26 };
  f.stub.dispatch(f.stub.window, "scroll", {});
  assert.equal(pop.getAttribute("data-side"), "above", "nothing moves until the frame");
  f.stub.flushFrames();
  assert.equal(pop.getAttribute("data-side"), "below", "repositioned under the chip");
  assert.equal(Number.parseInt(pop.style.top, 10), 128, "8px under the chip");
});

test("PO-3 resize repositions once per frame, and closing removes the listeners", (t) => {
  const f = popFixture(t, { left: 40, top: 100, right: 340, bottom: 120, width: 300, height: 20 }, { left: 40, top: 70, right: 900, bottom: 96, width: 860, height: 26 });
  f.stub.dispatch(f.chip, "click", {});
  for (let i = 0; i < 5; i += 1) f.stub.dispatch(f.stub.window, "resize", {});
  assert.equal(f.stub.frames.length, 1, "rAF-throttled: one pending frame for five events");
  f.chips.closePop();
  assert.equal(f.stub.frames.length, 0, "the pending frame is cancelled on close");
  assert.equal(f.doc.body.querySelector(".pxd-relpop"), null);
});

test("PO-5 invZoom is 1/zoom clamped to 0.25..4", () => {
  assert.equal(invZoom(1), 1);
  assert.equal(invZoom(0.5), 2);
  assert.equal(invZoom(2), 0.5);
  assert.equal(invZoom(0.05), 4);
  assert.equal(invZoom(10), 0.25);
  assert.equal(invZoom(0), 1);
  assert.equal(invZoom(NaN), 1);
});

// ------------------------------------------------------------------ PO-4 breadcrumb
function crumbFixture(t) {
  const stub = createDomStub();
  const restore = stub.install();
  t.after(restore);
  const doc = stub.document;
  stub.window.location = { hash: "#/app/Svy/page/x" };
  const host = { graph: "Svy", listConnectionBlocks: () => [["edge0001", "board001"]], pullBoard: () => rawBoard(), blockString: (u) => texts[u] ?? null, blockPageUid: () => "pageUID01" };
  const chips = createRelChips({ doc, win: stub.window, host, graph: () => "Svy", timers });
  chips.start();
  const mk = (tag, cls, parent) => { const n = doc.createElement(tag); n.className = cls; parent?.append(n); return n; };
  // The real shape: .rm-reference-item > div > [.rm-zoom.zoom-mentions-view > .rm-zoom-item x2, .roam-block-container]
  const item = mk("div", "rm-reference-item", doc.body);
  const holder = mk("div", "", item);
  const zoom = mk("div", "rm-zoom zoom-mentions-view", holder);
  const a = mk("div", "rm-zoom-item", zoom);
  const mask = mk("div", "rm-zoom-mask", a);
  const b = mk("div", "rm-zoom-item", zoom);
  const container = mk("div", "roam-block-container rm-block", holder);
  container.setAttribute("data-block-uid", "edge0001");
  const main = mk("div", "rm-block-main", container);
  const input = mk("div", "rm-block__input roam-block", main);
  input.id = "block-input-Svy-mentions-page-pageUID01-edge0001";
  return { stub, doc, chips, zoom, a, b, mask, container, item };
}

test("PO-4 a connection block's breadcrumb gets the board glyph; a plain click opens the preview and Roam never sees it", (t) => {
  const f = crumbFixture(t);
  f.chips.scan(f.item);
  const glyph = f.zoom.querySelector(".pxd-relcrumb");
  assert.ok(glyph, "glyph on the breadcrumb");
  assert.equal(glyph.title, "Open the connection preview");
  assert.equal(f.chips.crumbCount(), 1);
  f.chips.scan(f.item);
  assert.equal(f.zoom.querySelectorAll(".pxd-relcrumb").length, 1, "scanning twice adds one");
  let roamSaw = 0;
  f.doc.body.addEventListener("click", () => { roamSaw += 1; });
  f.stub.dispatch(f.mask, "click", { button: 0 });
  assert.ok(f.doc.body.querySelector(".pxd-relpop"), "plain click on the breadcrumb opens the preview");
  assert.equal(roamSaw, 0, "Roam's own navigation handler never ran");
  f.chips.closePop();
  f.stub.dispatch(glyph, "click", { button: 0 });
  assert.ok(f.doc.body.querySelector(".pxd-relpop"), "the glyph opens it too");
});

test("PO-4 Shift, Cmd, Ctrl, Alt and non-primary clicks keep Roam's behavior", (t) => {
  const f = crumbFixture(t);
  f.chips.scan(f.item);
  let roamSaw = 0;
  f.doc.body.addEventListener("click", () => { roamSaw += 1; });
  for (const extra of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { button: 1 }]) {
    f.stub.dispatch(f.b, "click", { button: 0, ...extra });
  }
  assert.equal(f.doc.body.querySelector(".pxd-relpop"), null, "no preview");
  assert.equal(roamSaw, 5, "every modified click reached Roam");
});

test("PO-4 a breadcrumb over a block that is not a connection is left alone", (t) => {
  const f = crumbFixture(t);
  f.container.setAttribute("data-block-uid", "plain0001");
  f.chips.scan(f.item);
  assert.equal(f.zoom.querySelector(".pxd-relcrumb"), null);
  assert.equal(f.chips.crumbCount(), 0);
});

test("PO-4 dispose removes the glyphs and the breadcrumb listeners", (t) => {
  const f = crumbFixture(t);
  f.chips.scan(f.item);
  f.chips.dispose();
  assert.equal(f.doc.body.querySelectorAll(".pxd-relcrumb").length, 0);
  let roamSaw = 0;
  f.doc.body.addEventListener("click", () => { roamSaw += 1; });
  f.stub.dispatch(f.a, "click", { button: 0 });
  assert.equal(roamSaw, 1, "after unload the click is Roam's again");
  assert.equal(f.doc.body.querySelector(".pxd-relpop"), null);
});

// ------------------------------------------------------------------ PO-6 polish
test("PO-6 the chip never runs past its container, and the light accent clears 4.5:1 on white", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/css/relchips.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-relchip \{[^}]*max-width: calc\(100% - 24px\);[^}]*margin: 2px 0 4px 24px;/);
  const m = /--pxd-rc-accent: hsl\((\d+) (\d+)% (\d+)%\);/.exec(css);
  const [h, s, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
  assert.ok(1.05 / (lum + 0.05) >= 4.5, `contrast ${(1.05 / (lum + 0.05)).toFixed(2)}`);
});
