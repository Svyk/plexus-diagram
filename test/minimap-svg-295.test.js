// REG-7: the view map, and the relation preview moved beside it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard } from "../src/model/board.js";
import { itemLabel } from "../src/model/schema.js";
import { previewFont as previewFontFromChips, previewModel } from "../src/relchips.js";
import { drawPreview, drawViewMap, minimapSvg, previewFont, viewMapModel } from "../src/view/minimap-svg.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": props,
  ":block/children": kids,
});
const cardId = (n) => `c${String(n).padStart(8, "0")}`;

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.02, `${actual} near ${expected}`);
}

function viewBoard() {
  const cards = [];
  for (let i = 0; i < 41; i += 1) {
    cards.push(raw(cardId(i), i === 0 ? "[[Alpha page]]" : `Card ${i}`, plx({ x: i * 40, y: 0, w: 30, h: 20 }), [], i + 2));
  }
  const far = raw("s00000002", "Far", plx({ type: "section", x: 4000, y: 0, w: 200, h: 120 }), [
    raw("n00000001", "Nested", plx({ x: 0, y: 0, w: 40, h: 20 })),
  ], 0);
  const nearSection = raw("s00000001", "Outline", plx({ type: "section", x: 0, y: 40, w: 500, h: 80 }), [], 1);
  const outside = raw("o00000001", "Outside", plx({ x: 5000, y: 0, w: 40, h: 20 }), [], 100);
  return buildBoard(raw("board0001", "{{[[diagram]]:Views}}", plx({ v: 2 }), [far, nearSection, ...cards, outside]));
}

test("REG-7 viewMapModel keeps v, highlights three ids, drops the 41st card, and outlines a section", () => {
  const board = viewBoard();
  assert.equal(board.edges.size, 0, "no edge is required");
  const v = { x: 0, y: 0, w: 2000, h: 400 };
  const hi = [cardId(0), cardId(1), cardId(2)];
  const model = viewMapModel(board, v, hi);
  assert.deepEqual(model.viewBox, v);
  assert.equal(model.path, undefined);
  assert.deepEqual(model.cards.filter((c) => c.role === "hi").map((c) => c.uid), hi);
  assert.equal(model.cards.filter((c) => c.type !== "section").length, 40);
  assert.equal(model.cards.some((c) => c.uid === cardId(40)), false, "the 41st intersecting card is dropped");
  assert.equal(model.cards.some((c) => c.uid === "o00000001"), false, "a card outside v is dropped");
  assert.equal(model.cards.some((c) => c.uid === "n00000001"), false, "a nested card uses its world rect");
  const section = model.cards.find((c) => c.uid === "s00000001");
  assert.equal(section.type, "section");
  assert.equal(section.role, "muted");
  assert.equal(section.title, itemLabel(board.items.get("s00000001")));
  assert.equal(model.cards.find((c) => c.uid === cardId(0)).title, itemLabel(board.items.get(cardId(0))));
  assert.equal(model.cards.find((c) => c.uid === cardId(0)).title, "Alpha page");
  const fromArray = viewMapModel(board, [0, 0, 2000, 400], hi);
  assert.deepEqual(fromArray.viewBox, v);
  assert.equal(fromArray.cards.length, model.cards.length);

  const stub = createDomStub();
  const restore = stub.install();
  try {
    const parent = stub.document.createElement("div");
    const svg = drawViewMap(stub.document, parent, model);
    assert.equal(svg.parentElement, parent);
    assert.equal(svg.getAttribute("class"), "pxd-viewmap");
    assert.equal(svg.getAttribute("viewBox"), "0 0 2000 400");
    assert.equal(svg.style.display, "inline-block");
    near(parseFloat(svg.style.width), 240);
    near(parseFloat(svg.style.height), 48);
    assert.ok(parseFloat(svg.style.width) <= 240 && parseFloat(svg.style.height) <= 140);
    assert.equal(svg.querySelectorAll(".pxd-viewmap__card--hi").length, 3);
    assert.equal(svg.querySelectorAll(".pxd-viewmap__card--muted.pxd-viewmap__card--section").length, 1);
    assert.equal(svg.querySelector("[x='1600']"), null, "the dropped card is not drawn");
    for (const rect of svg.querySelectorAll("rect")) assert.equal(rect.getAttribute("fill"), null);
  } finally {
    restore();
  }
});

test("REG-7 drawViewMap does not upscale a map already smaller than 240 by 140", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const parent = stub.document.createElement("div");
    const small = drawViewMap(stub.document, parent, { viewBox: { x: 5, y: 6, w: 80, h: 40 }, cards: [] });
    assert.equal(small.getAttribute("viewBox"), "5 6 80 40");
    assert.equal(small.style.width, "80px");
    assert.equal(small.style.height, "40px");
    const wide = drawViewMap(stub.document, parent, { viewBox: { x: 0, y: 0, w: 100, h: 50 }, cards: [] });
    assert.equal(wide.style.width, "100px");
    assert.equal(wide.style.height, "50px");
    const tall = drawViewMap(stub.document, parent, { viewBox: [10, 20, 800, 600], cards: [] });
    assert.equal(tall.getAttribute("viewBox"), "10 20 800 600");
    const tw = parseFloat(tall.style.width);
    const th = parseFloat(tall.style.height);
    assert.ok(tw <= 240 && th <= 140);
    near(th, 140);
    near(tw / th, 800 / 600);
  } finally {
    restore();
  }
});

test("REG-7 view map css is strokes, with an accent stroke and a 12% fill only on hi", () => {
  const css = readFileSync(new URL("../src/css/region-view.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-viewmap \.pxd-viewmap__card--muted\s*\{[^}]*fill:\s*none;[^}]*stroke:\s*currentColor;/s);
  assert.match(css, /\.pxd-viewmap \.pxd-viewmap__card--hi\s*\{[^}]*stroke:\s*var\(--pxd-accent[^}]*12%/s);
  assert.match(css, /\.pxd-viewmap \.pxd-viewmap__card--section\s*,[\s\S]*fill:\s*none;/);
  assert.match(css, /\.bp3-dark \.pxd-viewmap\.pxd-viewmap\s*,[\s\S]*\.pxd-root--dark \.pxd-viewmap\.pxd-viewmap\s*\{[^}]*color:\s*#fff;/);
  assert.doesNotMatch(css, /\.pxd-viewmap(\.pxd-viewmap)?\s*\{[^}]*width:\s*240px/s);
  assert.match(css, /background:\s*transparent/);
});

test("REG-6 minimapSvg is unchanged", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const svg = minimapSvg(stub.document, { v: [0, 0, 100, 80], items: [{ x: 1, y: 2, w: 3, h: 4 }] });
    assert.equal(svg.getAttribute("class"), "pxd-view-map");
    assert.equal(svg.getAttribute("width"), "96");
    assert.equal(svg.getAttribute("height"), "96");
    for (const rect of svg.querySelectorAll("rect")) assert.equal(rect.getAttribute("fill"), "none");
  } finally {
    restore();
  }
});

test("drawPreview(doc, parent, model) keeps the relpop cards, arrow, bar, and clip", () => {
  const board = buildBoard(raw("board001", "{{[[diagram]]:Roadmap}}", plx({ v: 2 }), [
    raw("cardA001", "Alpha idea", plx({ x: 0, y: 0, w: 200, h: 100 }), [], 0),
    raw("cardB001", "[[Beta page]]", plx({ x: 500, y: 0, w: 360, h: 480 }), [], 1),
    raw("sect00001", "Lane", plx({ type: "section", x: 40, y: 140, w: 120, h: 60 }), [], 2),
    raw("conn0001", "Connections", plx({ type: "edges" }), [
      raw("edge0001", "((cardA001)) → ((cardB001))", plx({ type: "edge", from: "cardA001", to: "cardB001", toBlock: "rowBlk001", color: "blue" }), [], 0),
    ], 3),
  ]));
  const model = previewModel(board, "edge0001", { blockText: () => "The target sentence" });
  assert.ok(model.toBar, "the bar still comes from previewModel");
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const parent = stub.document.createElement("div");
    const svg = drawPreview(stub.document, parent, model);
    assert.equal(svg.getAttribute("class"), "pxd-relpop__map");
    assert.equal(svg.querySelectorAll(".pxd-relpop__card--from").length, 1);
    assert.equal(svg.querySelectorAll(".pxd-relpop__card--to").length, 1);
    assert.equal(svg.querySelectorAll(".pxd-relpop__card--section").length, 1);
    assert.equal(svg.querySelectorAll(".pxd-relpop__line").length, 1);
    assert.ok(svg.querySelector(".pxd-relpop__head"));
    const row = svg.querySelector(".pxd-relpop__row");
    assert.ok(row.getAttribute("clip-path")?.startsWith("url(#pxd-relclip-"));
    assert.ok(svg.querySelector("clipPath"));
    assert.equal(svg.querySelectorAll(".pxd-relpop__inner").length, 1);
  } finally {
    restore();
  }
});

test("previewFont lives on the map module and is re-exported from relchips", () => {
  assert.equal(previewFont(320), 12);
  assert.equal(previewFont(640), 20);
  assert.equal(previewFontFromChips, previewFont);
  const rel = readFileSync(new URL("../src/relchips.js", import.meta.url), "utf8");
  const map = readFileSync(new URL("../src/view/minimap-svg.js", import.meta.url), "utf8");
  assert.match(rel, /drawPreview\(doc, el, model\)/);
  assert.doesNotMatch(rel, /const drawPreview|function drawPreview/);
  assert.match(map, /export function drawPreview\(doc, parent, model\)/);
  assert.doesNotMatch(map, /relchips/);
});
