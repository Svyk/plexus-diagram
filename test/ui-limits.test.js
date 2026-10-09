// Arrow toolbar: one short row, every action still reaches its command, and the bar misses the end cards.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PALETTE } from "../src/model/schema.js";
import { EDGE_BAR_MAX, edgeToolbarWidth, placeBarClear } from "../src/model/card-face.js";
import { createChrome } from "../src/view/chrome.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const timers = { later: () => () => {}, frame: () => () => {} };
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const box = (p) => ({ left: p.left, top: p.top, right: p.left + p.w, bottom: p.top + p.h });

function chromeOf(on = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  root._rect = { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0 };
  stub.document.body.append(root);
  const chrome = createChrome({ doc: stub.document, root, version: "3.9.0", settings: {}, timers, on });
  const ctx = root.querySelector(".pxd-ctx");
  ctx._rect = { left: 0, top: 0, right: 320, bottom: 36, width: 320, height: 36, x: 0, y: 0 };
  return { stub, restore, root, chrome, ctx };
}

const click = (node) => node.click();
const valued = (root, sel, value) => [...root.querySelectorAll(sel)].find((n) => n.dataset.value === String(value));

test("the arrow bar stays under 360 px and keeps direction, color, label, delete and more on the row", async () => {
  assert.ok(edgeToolbarWidth() <= EDGE_BAR_MAX, `budget ${edgeToolbarWidth()} px`);
  assert.equal(EDGE_BAR_MAX, 360);
  const css = await readFile(new URL("../src/css/ctx-toolbar.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \.pxd-ctx\[data-kind="edge"\]\s*\{[^}]*max-width:\s*360px/);
  const f = chromeOf();
  try {
    f.chrome.ctx.show("edge", { dir: "one", route: "curve", dash: "solid", weight: 2, color: "teal" }, () => ({
      kind: "edge", rect: { x: 400, y: 300, w: 1, h: 1 },
    }));
    assert.equal(f.ctx.dataset.kind, "edge");
    assert.equal(f.ctx.style.maxWidth, "360px");
    const row = f.ctx.querySelector(".pxd-ctx__row");
    const inline = [...row.children].map((n) => n.className);
    assert.equal(inline.length, 7, inline.join(" | "));
    assert.match(inline[0], /pxd-ctx__dir/);
    assert.match(inline[1], /pxd-ctx__style/);
    assert.match(inline[2], /pxd-ctx__width/);
    assert.match(inline[3], /pxd-ctx__color/);
    assert.match(inline[4], /pxd-ctx__label/);
    assert.match(inline[5], /pxd-ctx__delete/);
    assert.match(inline[6], /pxd-ctx__edge-more/);
    assert.equal(row.querySelector(".pxd-swatches, .pxd-ctx__route, .pxd-ctx__dash, .pxd-ctx__weight, .pxd-ctx__flip"), null);
    assert.equal(f.ctx.querySelector(".pxd-ctx__dot").classList.contains("pxd-c-teal"), true);
    assert.equal(f.ctx.querySelector(".pxd-ctx__color").getAttribute("data-tip"), "ctx.edge-color");
    assert.equal(f.ctx.querySelector(".pxd-ctx__style").getAttribute("data-tip"), "ctx.style");
    assert.equal(f.ctx.querySelector(".pxd-ctx__width").getAttribute("data-tip"), "ctx.width");
    assert.equal(f.ctx.querySelector(".pxd-ctx__edge-more").getAttribute("data-tip"), "ctx.edge-more");
  } finally {
    f.chrome.dispose();
    f.restore();
  }
});

test("each arrow action still dispatches the same command from its popover", () => {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  const f = chromeOf({
    edgeDir: rec("edgeDir"),
    route: rec("route"),
    dash: rec("dash"),
    weight: rec("weight"),
    setColor: rec("setColor"),
    label: rec("label"),
    delete: rec("delete"),
    flip: rec("flip"),
    notes: rec("notes"),
    writeToGraph: rec("writeToGraph"),
    unblock: rec("unblock"),
  });
  try {
    const model = { dir: "one", route: "curve", dash: "solid", weight: 1, color: "gray", fromBlock: "blk000001" };
    f.chrome.ctx.show("edge", model, () => ({ kind: "edge", rect: { x: 400, y: 300, w: 1, h: 1 } }));
    click(valued(f.ctx, ".pxd-ctx__dir .pxd-seg__btn", "two"));
    click(f.ctx.querySelector(".pxd-ctx__label"));
    click(f.ctx.querySelector(".pxd-ctx__delete"));
    click(f.ctx.querySelector(".pxd-ctx__style"));
    assert.equal(f.ctx.querySelector(".pxd-ctx__pop") != null, true);
    assert.equal(valued(f.ctx, ".pxd-ctx__dash .pxd-seg__btn", "dashed").getAttribute("data-tip"), "ctx.dash.dashed");
    assert.equal(valued(f.ctx, ".pxd-ctx__route .pxd-seg__btn", "elbow").getAttribute("data-tip"), "ctx.route.elbow");
    click(valued(f.ctx, ".pxd-ctx__dash .pxd-seg__btn", "dashed"));
    click(f.ctx.querySelector(".pxd-ctx__style"));
    click(valued(f.ctx, ".pxd-ctx__route .pxd-seg__btn", "elbow"));
    click(f.ctx.querySelector(".pxd-ctx__width"));
    assert.equal(valued(f.ctx, ".pxd-ctx__weight .pxd-seg__btn", "3").getAttribute("data-tip"), "ctx.weight.3");
    click(valued(f.ctx, ".pxd-ctx__weight .pxd-seg__btn", "3"));
    click(f.ctx.querySelector(".pxd-ctx__color"));
    const swatches = [...f.ctx.querySelectorAll(".pxd-ctx__pop .pxd-swatch")];
    assert.equal(swatches.length, PALETTE.length + 1, "none plus the named colors");
    click(swatches.find((n) => n.dataset.color === "red"));
    click(f.ctx.querySelector(".pxd-ctx__edge-more"));
    assert.equal(f.ctx.querySelector(".pxd-ctx__flip").getAttribute("data-tip"), "ctx.flip");
    assert.equal(f.ctx.querySelector(".pxd-ctx__unblock").getAttribute("data-tip"), "ctx.unblock");
    assert.equal(f.ctx.querySelector(".pxd-ctx__notes").getAttribute("data-tip"), "ctx.notes");
    assert.equal(f.ctx.querySelector(".pxd-ctx__write").getAttribute("data-tip"), "ctx.write");
    click(f.ctx.querySelector(".pxd-ctx__flip"));
    click(f.ctx.querySelector(".pxd-ctx__edge-more"));
    click(f.ctx.querySelector(".pxd-ctx__notes"));
    click(f.ctx.querySelector(".pxd-ctx__edge-more"));
    click(f.ctx.querySelector(".pxd-ctx__write"));
    click(f.ctx.querySelector(".pxd-ctx__edge-more"));
    click(f.ctx.querySelector(".pxd-ctx__unblock"));
    assert.deepEqual(calls, [
      ["edgeDir", "two"],
      ["label"],
      ["delete"],
      ["dash", "dashed"],
      ["route", "elbow"],
      ["weight", 3],
      ["setColor", "red"],
      ["flip"],
      ["notes"],
      ["writeToGraph"],
      ["unblock"],
    ]);
    f.chrome.ctx.show("edge", { dir: "one" }, () => ({ kind: "edge", rect: { x: 400, y: 300, w: 1, h: 1 } }));
    click(f.ctx.querySelector(".pxd-ctx__edge-more"));
    assert.equal(f.ctx.querySelector(".pxd-ctx__unblock"), null, "page-instead only when an end is a block");
  } finally {
    f.chrome.dispose();
    f.restore();
  }
});

test("placeBarClear tries above the midpoint, then below, then beside, and misses the end cards", () => {
  const bar = { w: 320, h: 36 };
  const gap = 28;
  const bounds = { left: 8, top: 56, right: 1192, bottom: 712 };
  const left = { left: 26, top: 160, right: 234, bottom: 310 };
  const image = { left: 386, top: 50, right: 694, bottom: 570 };
  const label = { left: 246, top: 210, right: 314, bottom: 236 };
  const anchor = { x: 280, y: 230, w: 1, h: 1 };
  const clear = placeBarClear(bar, { anchor, soft: [], hard: [], gap, margin: 8, bounds });
  assert.equal(clear.where, "above");
  const placed = placeBarClear(bar, { anchor, soft: [left, image, label], hard: [], gap, margin: 8, bounds });
  const spot = box(placed);
  for (const [name, o] of [["left card", left], ["image", image], ["label", label]]) {
    assert.equal(overlaps(spot, o), false, `${placed.where} ${JSON.stringify(spot)} hits the ${name}`);
  }
  assert.equal(placed.where, "beside");
  assert.ok(spot.left >= bounds.left && spot.top >= bounds.top && spot.right <= bounds.right && spot.bottom <= bounds.bottom);
  // Above and below the midpoint both cut the tall image; beside it does not.
  assert.ok(spot.left >= image.right);
});

test("the arrow bar misses both end cards in the letterboxed-image case", () => {
  const f = chromeOf();
  try {
    const toolbar = f.root.querySelector(".pxd-toolbar");
    toolbar._rect = { left: 0, top: 0, right: 1200, bottom: 48, width: 1200, height: 48, x: 0, y: 0 };
    const left = { x: 40, y: 180, w: 180, h: 110 };
    const image = { x: 400, y: 70, w: 280, h: 480 };
    const label = { x: 250, y: 214, w: 60, h: 18 };
    f.chrome.ctx.show("edge", { uid: "e1", dir: "one" }, () => ({
      kind: "edge",
      rect: { x: 280, y: 230, w: 1, h: 1 },
      cards: [left, image],
      label,
    }));
    const leftPx = Number.parseFloat(f.ctx.style.left);
    const topPx = Number.parseFloat(f.ctx.style.top);
    const spot = { left: leftPx, top: topPx, right: leftPx + 320, bottom: topPx + 36 };
    const grow = (c) => ({ left: c.x - 14, top: c.y - 20, right: c.x + c.w + 14, bottom: c.y + c.h + 20 });
    const lab = { left: label.x - 4, top: label.y - 4, right: label.x + label.w + 4, bottom: label.y + label.h + 4 };
    assert.equal(overlaps(spot, grow(left)), false, JSON.stringify(spot));
    assert.equal(overlaps(spot, grow(image)), false, JSON.stringify(spot));
    assert.equal(overlaps(spot, lab), false, JSON.stringify(spot));
    assert.ok(spot.top >= 56, "below the board bar");
    assert.ok(spot.left >= image.x + image.w, "beside the tall image, not across its top edge");
  } finally {
    f.chrome.dispose();
    f.restore();
  }
});

test("a card bar steps below when another card sits directly above", () => {
  const above = { left: 196, top: 130, right: 384, bottom: 250 };
  const anchor = { x: 220, y: 260, w: 140, h: 90 };
  const moved = placeBarClear({ w: 320, h: 36 }, {
    anchor,
    soft: [above],
    hard: [],
    gap: 24,
    margin: 8,
    bounds: { left: 8, top: 8, right: 1192, bottom: 792 },
  });
  assert.equal(moved.where, "below");
  assert.equal(overlaps(box(moved), above), false);
  assert.ok(moved.top >= anchor.y + anchor.h);

  const f = chromeOf();
  try {
    const card = { x: 220, y: 260, w: 140, h: 90 };
    const over = { x: 210, y: 150, w: 160, h: 80 };
    f.chrome.ctx.show("card", { kind: "note" }, () => ({ kind: "items", rect: card, cards: [over] }));
    const cardTop = Number.parseFloat(f.ctx.style.top);
    const cardLeft = Number.parseFloat(f.ctx.style.left);
    const spot = { left: cardLeft, top: cardTop, right: cardLeft + 320, bottom: cardTop + 36 };
    const overBox = { left: over.x - 14, top: over.y - 20, right: over.x + over.w + 14, bottom: over.y + over.h + 20 };
    assert.equal(overlaps(spot, overBox), false, JSON.stringify(spot));
    assert.ok(cardTop >= card.y + card.h, `card bar top ${cardTop} is below the card`);
  } finally {
    f.chrome.dispose();
    f.restore();
  }
});

test("a small board keeps the arrow bar off the dock and the board bar", () => {
  const f = chromeOf();
  try {
    f.root._rect = { left: 0, top: 0, right: 480, bottom: 340, width: 480, height: 340, x: 0, y: 0 };
    f.ctx._rect = { left: 0, top: 0, right: 200, bottom: 32, width: 200, height: 32, x: 0, y: 0 };
    const toolbar = f.root.querySelector(".pxd-toolbar");
    toolbar._rect = { left: 0, top: 0, right: 480, bottom: 40, width: 480, height: 40, x: 0, y: 0 };
    const dock = f.root.querySelector(".pxd-dock__bar");
    dock._rect = { left: 20, top: 280, right: 460, bottom: 328, width: 440, height: 48, x: 20, y: 280 };
    f.chrome.ctx.show("edge", { dir: "one" }, () => ({
      kind: "edge",
      rect: { x: 140, y: 120, w: 1, h: 1 },
      cards: [
        { x: 16, y: 70, w: 100, h: 80 },
        { x: 180, y: 56, w: 200, h: 200 },
      ],
    }));
    const leftPx = Number.parseFloat(f.ctx.style.left);
    const topPx = Number.parseFloat(f.ctx.style.top);
    const spot = { left: leftPx, top: topPx, right: leftPx + 200, bottom: topPx + 32 };
    const bar = { left: 0, top: 0, right: 480, bottom: 48 };
    const dockBox = { left: 20, top: 280, right: 460, bottom: 328 };
    assert.equal(overlaps(spot, bar), false, `bar ${JSON.stringify(spot)} covers the board bar`);
    assert.equal(overlaps(spot, dockBox), false, `bar ${JSON.stringify(spot)} covers the dock`);
    assert.ok(spot.top >= 48 && spot.bottom <= 340 && spot.left >= 0 && spot.right <= 480);
  } finally {
    f.chrome.dispose();
    f.restore();
  }
});
