// PDF-2 cards: bar, passage, footer. The colour is not a card class.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const TEXT = "selected passage";
const TITLE = "Risk model.pdf";
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
    ":block/uid": "boardhl01",
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
    ":block/props": { ":plexus": { ":x": order * 320, ":y": 0, ":w": 240, ":h": 140 } },
    ":block/children": [],
  };
}

function mount() {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const rendered = [];
  const fileGets = [];
  const fetched = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetched.push(args);
    return Promise.resolve({ ok: true });
  };
  const strings = new Map([
    ["hltext01", `${TEXT} #h/yellow`],
    ["hlarea01", `${MACRO} #h/orange`],
    ["plain001", "just a note"],
  ]);
  const props = new Map([
    ["hltext01", { props: textProps, string: strings.get("hltext01"), pageTitle: TITLE }],
    ["hlarea01", { props: areaProps, string: strings.get("hlarea01"), pageTitle: TITLE }],
    ["plain001", { props: {}, string: "just a note", pageTitle: TITLE }],
  ]);
  const host = {
    renderString(node, string) {
      rendered.push(string);
      node.textContent = string;
    },
    unmount() {},
    blockString(uid) { return strings.get(uid) || ""; },
    file: { get(...args) { fileGets.push(args); } },
  };
  const session = { updateProps() {}, setString() {} };
  const r = createItemRenderer({
    doc,
    host,
    session,
    itemsLayer,
    sectionsLayer,
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later() { return () => {}; },
    },
  });
  const board = buildBoard(raw([
    child("hlcard01", "((hltext01))", 0),
    child("areacard1", "((hlarea01))", 1),
    child("plaincard", "((plain001))", 2),
  ]), {
    resolve: (uid) => strings.get(uid) || "",
    propsOf: (uid) => props.get(uid) || null,
  });
  const rects = worldRects(board);
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 });
  };
  const show = () => {
    r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
    flush();
  };
  r.sync({ board, rects, structural: true });
  r.setLod("detail", 1);
  show();
  return {
    r,
    board,
    rects,
    rendered,
    fileGets,
    fetched,
    flush,
    show,
    restore() {
      globalThis.fetch = origFetch;
      r.dispose();
      restore();
    },
  };
}

test("a yellow text highlight shows the bar, the passage, and p. 1", () => {
  const ctx = mount();
  try {
    const item = ctx.board.items.get("hlcard01");
    const card = ctx.r.shellOf("hlcard01");
    const body = card.querySelector(".pxd-item__body");
    const kids = [...body.children];
    assert.equal(item.kind, "highlight");
    assert.equal(item.color == null, true);
    assert.equal(card.classList.contains("pxd-c-yellow"), false);
    assert.equal(kids[0].classList.contains("pxd-highlight-bar"), true);
    assert.equal(kids[0].getAttribute("data-color"), "yellow");
    assert.equal(kids[1].classList.contains("pxd-rs"), true);
    assert.equal(kids[1].querySelector(".pxd-rs__live").textContent, TEXT);
    assert.equal(kids[2].classList.contains("pxd-highlight-foot"), true);
    assert.equal(kids[2].textContent, `p. 1 · ${TITLE}`);
    assert.equal(ctx.rendered.includes(TEXT), true);
    assert.equal(ctx.rendered.some((s) => String(s).includes("#h/")), false);
    assert.equal(card.textContent.includes(TEXT), true);
    assert.equal(card.textContent.includes("p. 1"), true);
    assert.equal(ctx.fileGets.length, 0);
    assert.equal(ctx.fetched.length, 0);

    item.highlight = { ...item.highlight, color: "green", page: 3, text: "next passage\nsecond line", footer: `p. 3 · ${TITLE}` };
    ctx.r.sync({ board: ctx.board, rects: ctx.rects, structural: false });
    ctx.show();
    const again = ctx.r.shellOf("hlcard01");
    assert.equal(again.querySelector(".pxd-highlight-bar").getAttribute("data-color"), "green");
    assert.equal(again.querySelector(".pxd-rs__live").textContent, "next passage\nsecond line");
    assert.equal(again.querySelector(".pxd-highlight-foot").textContent, `p. 3 · ${TITLE}`);
    assert.equal(again.classList.contains("pxd-c-green"), false);
    assert.equal(item.color == null, true);
  } finally {
    ctx.restore();
  }
});

test("an area highlight calls renderString with the image macro", () => {
  const ctx = mount();
  try {
    const card = ctx.r.shellOf("areacard1");
    assert.equal(ctx.rendered.includes(MACRO), true);
    assert.equal(card.querySelector(".pxd-rs__live").textContent, MACRO);
    assert.equal(card.querySelector(".pxd-highlight-bar").getAttribute("data-color"), "orange");
    assert.equal(card.querySelector(".pxd-highlight-foot").textContent, `p. 2 · ${TITLE}`);
    assert.equal(card.classList.contains("pxd-c-orange"), false);
    assert.equal(ctx.board.items.get("areacard1").color == null, true);
    assert.equal(ctx.fileGets.length, 0);
    assert.equal(ctx.fetched.length, 0);

    const before = ctx.rendered.length;
    ctx.r.setLod("map", 0.3);
    ctx.flush();
    const map = ctx.r.shellOf("areacard1");
    assert.ok(map.querySelector(".pxd-highlight-bar"));
    assert.equal(map.querySelector(".pxd-highlight-bar").getAttribute("data-color"), "orange");
    assert.equal(map.querySelector(".pxd-rs"), null);
    assert.equal(map.querySelector(".pxd-highlight-foot"), null);
    assert.equal(ctx.rendered.slice(before).includes(MACRO), false);
    assert.equal(map.textContent.includes("https://example.test/figure.png"), false);
    assert.equal(map.textContent.includes("zqJy0wsTc"), false);
    assert.equal(ctx.fileGets.length, 0);
    assert.equal(ctx.fetched.length, 0);
  } finally {
    ctx.restore();
  }
});

test("a block ref without highlight does not get the bar", () => {
  const ctx = mount();
  try {
    const item = ctx.board.items.get("plaincard");
    const card = ctx.r.shellOf("plaincard");
    assert.equal(item.kind, "block");
    assert.equal(item.highlight, undefined);
    assert.equal(card.querySelector(".pxd-highlight-bar"), null);
    assert.equal(card.querySelector(".pxd-highlight-foot"), null);
    assert.equal(card.classList.contains("pxd-item--highlight"), false);
    assert.equal(ctx.rendered.includes("just a note"), true);
    assert.equal(ctx.fileGets.length, 0);
    assert.equal(ctx.fetched.length, 0);
  } finally {
    ctx.restore();
  }
});

test("map lod keeps the bar and the first line of a text highlight", () => {
  const ctx = mount();
  try {
    const item = ctx.board.items.get("hlcard01");
    item.highlight = { ...item.highlight, text: "next passage\nsecond line", footer: `p. 4 · ${TITLE}` };
    ctx.r.sync({ board: ctx.board, rects: ctx.rects, structural: false });
    ctx.show();
    const before = ctx.rendered.length;
    ctx.r.setLod("map", 0.3);
    ctx.flush();
    const card = ctx.r.shellOf("hlcard01");
    assert.equal(card.querySelector(".pxd-highlight-bar").getAttribute("data-color"), "yellow");
    assert.equal(card.querySelector(".pxd-highlight-line").textContent, "next passage");
    assert.equal(card.querySelector(".pxd-highlight-foot"), null);
    assert.equal(card.querySelector(".pxd-rs"), null);
    assert.equal(card.textContent.includes("second line"), false);
    assert.equal(card.textContent.includes("p. 4"), false);
    assert.equal(ctx.rendered.length, before);
  } finally {
    ctx.restore();
  }
});

test("highlight bar css stays under .pxd-root and does not paint a card fill", () => {
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const start = css.indexOf("PDF-2 highlight card.");
  assert.ok(start > 0);
  const slice = css.slice(start, css.indexOf("Focus mode dims", start));
  assert.match(slice, /\.pxd-root \.pxd-item\.pxd-item--highlight[\s\S]*background:\s*transparent/);
  assert.match(slice, /\.pxd-root \.pxd-highlight-bar \{[\s\S]*position:\s*absolute;[\s\S]*left:\s*0;[\s\S]*top:\s*0;[\s\S]*bottom:\s*0;[\s\S]*width:\s*4px;/);
  assert.match(slice, /\.pxd-root \.pxd-highlight-bar\[data-color="yellow"\] \{ background: var\(--pxd-yellow-line\); \}/);
  assert.match(slice, /\.pxd-root\.pxd-lod-map \.pxd-item\.pxd-item--highlight > \.pxd-item__body \{[\s\S]*display:\s*block;/);
  assert.match(slice, /\.pxd-root \.pxd-item\.pxd-item--highlight:not\(\.pxd-item--collapsed\):not\(\.pxd-item--bare\) > \.pxd-item__header[\s\S]*display:\s*none;/);
  const selectors = [...slice.matchAll(/([^{}]+)\{/g)].map((m) => m[1]);
  assert.ok(selectors.length > 0);
  for (const sel of selectors) assert.equal(sel.includes(".pxd-root"), true, sel);
  assert.equal(slice.includes(".rm-"), false);
  assert.equal(/border\s*:/.test(slice), false);
});
