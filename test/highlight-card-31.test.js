// PDF-U2 highlight card: source chip, quote class, hover callbacks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const TEXT = "selected passage";
const TITLE = "SuperlonghighlighttitleYZ";
const MACRO = "![](https://example.test/figure.png)";

const textProps = {
  ":pdf-highlight": {
    ":type": "text",
    ":content": { ":text": TEXT },
    ":position": { ":boundingRect": { ":pageNumber": 1, ":x1": 1, ":y1": 2, ":x2": 9, ":y2": 4 } },
  },
};

const areaProps = {
  ":pdf-highlight": {
    ":type": "area",
    ":content": { ":image-id": "zqJy0wsTc", ":text": "not the picture" },
    ":position": { ":boundingRect": { ":pageNumber": 2 } },
  },
};

function raw(children) {
  return {
    ":block/uid": "boardhlu2",
    ":block/string": "{{[[diagram]]:Highlights}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

function child(uid, string, order) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": order * 320, ":y": 0, ":w": 240, ":h": 180 } },
    ":block/children": [],
  };
}

function mount(opts = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const opened = [];
  const hovers = [];
  const strings = new Map([
    ["hltext01", `${TEXT} #h/yellow`],
    ["hlarea01", `${MACRO} #h/orange`],
  ]);
  const props = new Map([
    ["hltext01", { props: textProps, string: strings.get("hltext01"), pageTitle: TITLE }],
    ["hlarea01", { props: areaProps, string: strings.get("hlarea01"), pageTitle: TITLE }],
  ]);
  const host = {
    renderString(node, string) { node.textContent = string; },
    unmount() {},
    blockString(uid) { return strings.get(uid) || ""; },
  };
  const r = createItemRenderer({
    doc,
    host,
    session: { updateProps() {}, setString() {} },
    itemsLayer,
    sectionsLayer,
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later() { return () => {}; },
    },
    onHighlightOpen(item) { opened.push(item?.uid || ""); },
    onHighlightHover: opts.hover === false ? undefined : (uid, on) => { hovers.push([uid, on]); },
  });
  const board = buildBoard(raw([
    child("hlcard01", "((hltext01))", 0),
    child("areacard1", "((hlarea01))", 1),
  ]), {
    resolve: (uid) => strings.get(uid) || "",
    propsOf: (uid) => props.get(uid) || null,
  });
  const rects = worldRects(board);
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 });
  };
  r.sync({ board, rects, structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
  flush();
  return {
    stub, r, flush, opened, hovers,
    restore() { r.dispose(); restore(); },
  };
}

test("the source chip shows the glyph, a 24-character title, and the page", () => {
  assert.equal(TITLE.length, 25);
  const ctx = mount();
  try {
    const card = ctx.r.shellOf("hlcard01");
    const kids = [...card.querySelector(".pxd-item__body").children];
    assert.equal(kids[0].classList.contains("pxd-highlight-bar"), true);
    assert.equal(kids[0].getAttribute("data-color"), "yellow");
    assert.equal(kids[1].classList.contains("pxd-highlight-quote"), true);
    const foot = kids[2];
    assert.equal(foot.classList.contains("pxd-highlight-chip"), true);
    assert.ok(foot.querySelector(".pxd-pdf-glyph"));
    assert.equal(foot.querySelector(".pxd-highlight-chip__title").textContent, TITLE.slice(0, 24));
    assert.equal(foot.querySelector(".pxd-highlight-chip__page").textContent, " · p. 1");
    assert.equal(foot.textContent, `${TITLE.slice(0, 24)} · p. 1`);
    foot.click();
    assert.deepEqual(ctx.opened, ["hlcard01"]);
  } finally {
    ctx.restore();
  }
});

test("hover reports the highlight block uid, and map lod drops the chip", () => {
  const ctx = mount();
  try {
    const card = ctx.r.shellOf("hlcard01");
    ctx.stub.dispatch(card, "mouseenter");
    ctx.stub.dispatch(card, "mouseleave");
    assert.deepEqual(ctx.hovers, [["hltext01", true], ["hltext01", false]]);

    const area = ctx.r.shellOf("areacard1");
    const areaKids = [...area.querySelector(".pxd-item__body").children];
    assert.equal(areaKids[0].classList.contains("pxd-highlight-media"), true);
    assert.equal(areaKids[2].classList.contains("pxd-highlight-chip"), true);
    assert.equal(areaKids[2].querySelector(".pxd-highlight-chip__page").textContent, " · p. 2");

    ctx.r.setLod("map", 0.3);
    ctx.flush();
    const map = ctx.r.shellOf("hlcard01");
    assert.ok(map.querySelector(".pxd-highlight-bar"));
    assert.equal(map.querySelector(".pxd-highlight-chip"), null);
    assert.equal(map.querySelector(".pxd-highlight-foot"), null);
    ctx.hovers.length = 0;
    ctx.stub.dispatch(map, "mouseenter");
    assert.deepEqual(ctx.hovers, [["hltext01", true]]);
  } finally {
    ctx.restore();
  }
});

test("hover listeners stay off when no callback is passed", () => {
  const ctx = mount({ hover: false });
  try {
    ctx.stub.dispatch(ctx.r.shellOf("hlcard01"), "mouseenter");
    assert.deepEqual(ctx.hovers, []);
  } finally {
    ctx.restore();
  }
});

test("highlight css keeps the 3px bar token and puts chip borders after the PDF-2 block", () => {
  const css = readFileSync(new URL("../src/css/highlight-card.css", import.meta.url), "utf8");
  const start = css.indexOf("PDF-2 highlight card.");
  const slice = css.slice(start, css.indexOf("PDF-U2", start));
  assert.ok(start > 0);
  assert.match(slice, /width:\s*var\(--pxd-hl-bar-w,\s*3px\)/);
  assert.equal(/border\s*:/.test(slice), false);
  assert.match(css, /--pxd-hl-bar-w:\s*3px/);
  assert.match(css, /--pxd-hl-chip-h:\s*20px/);
  assert.equal(css.includes("prefers-color-scheme"), false);
});
