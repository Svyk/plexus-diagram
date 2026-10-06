// PDF-5 cards: area image ratio before renderString, both classes, hidden header. No fill. No file.get.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const TITLE = "Risk model.pdf";
const MACRO = "![](https://example.test/figure.png)";
const CAPTION = "selected figure";

const areaProps = {
  ":pdf-highlight": {
    ":type": "area",
    ":content": { ":image-id": "zqJy0wsTc", ":text": "not the picture" },
    ":position": { ":boundingRect": { ":pageNumber": 2 } },
  },
  ":image-size": {
    url: { ":width": 1, ":height": 2 },
    "https://example.test/figure.png": { ":width": 133, ":height": 47 },
  },
};

const textProps = {
  ":pdf-highlight": {
    ":type": "text",
    ":content": { ":text": "selected passage" },
    ":position": { ":boundingRect": { ":pageNumber": 1 } },
  },
};

function raw(children) {
  return {
    ":block/uid": "boardhl02",
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
  const ratiosAtRender = [];
  const fileGets = [];
  const fetched = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetched.push(args);
    return Promise.resolve({ ok: true });
  };
  const strings = new Map([
    ["hlarea02", `${CAPTION}\n${MACRO} #h/orange`],
    ["hltext02", "selected passage #h/yellow"],
  ]);
  const props = new Map([
    ["hlarea02", { props: areaProps, string: strings.get("hlarea02"), pageTitle: TITLE }],
    ["hltext02", { props: textProps, string: strings.get("hltext02"), pageTitle: TITLE }],
  ]);
  const host = {
    renderString(node, string) {
      rendered.push(string);
      const media = node.closest?.(".pxd-highlight-media");
      ratiosAtRender.push(media ? media.style.aspectRatio : "");
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
    child("areacard2", "((hlarea02))", 0),
    child("textcard2", "((hltext02))", 1),
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
    ratiosAtRender,
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

test("an area highlight with natural 133 by 47 sets the ratio and both classes", () => {
  const ctx = mount();
  try {
    const item = ctx.board.items.get("areacard2");
    const card = ctx.r.shellOf("areacard2");
    const body = card.querySelector(".pxd-item__body");
    const kids = [...body.children];
    const media = kids[0];
    assert.equal(item.kind, "highlight");
    assert.equal(item.highlight.image, true);
    assert.deepEqual(item.highlight.natural, { w: 133, h: 47 });
    assert.equal(item.color == null, true);
    assert.equal(card.classList.contains("pxd-item--highlight"), true);
    assert.equal(card.classList.contains("pxd-item--image"), true);
    assert.equal(/pxd-c-/.test(card.className), false);
    assert.equal(card.style.background || "", "");
    assert.equal(card.style.backgroundColor || "", "");
    assert.equal(media.classList.contains("pxd-highlight-media"), true);
    assert.equal(media.style.aspectRatio, "133 / 47");
    assert.equal(media.style.background || "", "");
    assert.equal(kids[1].classList.contains("pxd-highlight-bar"), true);
    assert.equal(kids[1].getAttribute("data-color"), "orange");
    assert.equal(kids[2].classList.contains("pxd-highlight-foot"), true);
    assert.equal(kids[2].textContent, `p. 2 · ${TITLE}`);
    assert.equal(media.querySelector(".pxd-rs__live").textContent.includes(MACRO), true);
    // The ratio is set before the media renders, whatever order the scheduler mounts cards in.
    const mediaRatios = ctx.ratiosAtRender.filter(Boolean);
    assert.equal(mediaRatios.length > 0, true);
    assert.equal(mediaRatios.every((r) => r === "133 / 47"), true);
    assert.equal(ctx.rendered.some((s) => String(s).includes(MACRO)), true);
    assert.equal(ctx.fileGets.length, 0);
    assert.equal(ctx.fetched.length, 0);

    const text = ctx.r.shellOf("textcard2");
    assert.equal(text.classList.contains("pxd-item--highlight"), true);
    assert.equal(text.classList.contains("pxd-item--image"), false);
    assert.equal(text.querySelector(".pxd-highlight-media"), null);
    const textKids = [...text.querySelector(".pxd-item__body").children];
    assert.equal(textKids[0].classList.contains("pxd-highlight-bar"), true);
    assert.equal(textKids[1].classList.contains("pxd-rs"), true);
    assert.equal(textKids[2].classList.contains("pxd-highlight-foot"), true);
  } finally {
    ctx.restore();
  }
});

test("map lod keeps the bar and the first line and paints no image", () => {
  const ctx = mount();
  try {
    const before = ctx.rendered.length;
    ctx.r.setLod("map", 0.3);
    ctx.flush();
    const card = ctx.r.shellOf("areacard2");
    assert.equal(card.classList.contains("pxd-item--highlight"), true);
    assert.equal(card.classList.contains("pxd-item--image"), true);
    assert.equal(card.querySelector(".pxd-highlight-bar").getAttribute("data-color"), "orange");
    assert.equal(card.querySelector(".pxd-highlight-line").textContent, CAPTION);
    assert.equal(card.querySelector(".pxd-highlight-media"), null);
    assert.equal(card.querySelector(".pxd-highlight-foot"), null);
    assert.equal(card.querySelector(".pxd-rs"), null);
    assert.equal(card.textContent.includes("https://example.test/figure.png"), false);
    assert.equal(card.textContent.includes("zqJy0wsTc"), false);
    assert.equal(ctx.rendered.length, before);
    assert.equal(ctx.fileGets.length, 0);
    assert.equal(ctx.fetched.length, 0);
  } finally {
    ctx.restore();
  }
});

test("the highlight header rule still matches display none and the card has no fill", () => {
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const start = css.indexOf("PDF-2 highlight card.");
  assert.ok(start > 0);
  const slice = css.slice(start, css.indexOf("Focus mode dims", start));
  assert.match(slice, /\.pxd-root \.pxd-item\.pxd-item--highlight[\s\S]*background:\s*transparent/);
  assert.match(slice, /\.pxd-root \.pxd-item\.pxd-item--highlight:not\(\.pxd-item--collapsed\):not\(\.pxd-item--bare\) > \.pxd-item__header[\s\S]*display:\s*none;/);
  assert.equal(slice.includes(":not(.pxd-item--image)"), false);
  assert.match(slice, /\.pxd-root \.pxd-highlight-media \{/);
  assert.equal(/background\s*:/.test(css.slice(css.indexOf(".pxd-root .pxd-highlight-media {"), css.indexOf(".pxd-root .pxd-highlight-media {") + 180)), false);
  const ctx = mount();
  try {
    const card = ctx.r.shellOf("areacard2");
    const header = card.querySelector(":scope > .pxd-item__header") || [...card.children].find((node) => node.classList.contains("pxd-item__header"));
    assert.ok(header);
    assert.equal(card.classList.contains("pxd-item--collapsed"), false);
    assert.equal(card.classList.contains("pxd-item--bare"), false);
    assert.equal(header.style.display || "", "");
  } finally {
    ctx.restore();
  }
});
