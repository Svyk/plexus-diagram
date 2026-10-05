import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCardChips } from "../src/cardchips.js";
import { createCardCache } from "../src/model/card-cache.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function box(doc, uid) {
  const container = doc.createElement("div");
  container.className = "roam-block-container";
  container.setAttribute("data-block-uid", uid);
  const kids = doc.createElement("div");
  kids.className = "rm-block-children";
  container.append(kids);
  return container;
}

function layer(stub, cache, extra = {}) {
  const opened = [];
  const chips = createCardChips({
    doc: stub.document,
    cache,
    onOpen: (row) => opened.push(row),
    onPreview: () => ({ title: "P18 fixture", section: "Notes", svg: stub.document.createElement("svg") }),
    ...extra,
  });
  return { chips, opened };
}

test("two boards make two chips, and a fourth board is a +1", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "P18 fixture", [{ uid: "c1", target: "block1" }]);
    cache.setBoard("b2", "Other", [{ uid: "c2", target: "block1" }]);
    const { chips, opened } = layer(stub, cache);
    const root = stub.document.createElement("div");
    const carded = box(stub.document, "block1");
    root.append(carded);
    stub.document.body.append(root);
    chips.scan(root);
    const found = [...carded.querySelectorAll(".pxd-cardchip")];
    assert.equal(found.length, 2);
    assert.deepEqual(found.map((node) => node.textContent).sort(), ["▦ on Other", "▦ on P18 fixture"]);
    assert.equal(found[0].closest(".rm-block-children"), null);
    const down = stub.dispatch(found[0], "pointerdown");
    assert.equal(down.propagationStopped, true);
    const other = stub.dispatch(root, "click");
    assert.equal(other.propagationStopped, false);
    assert.equal(opened.length, 0);
    stub.dispatch(found[0], "click");
    assert.equal(opened.length, 1);
    assert.equal(opened[0].boardUid, found[0].getAttribute("data-board"));
    assert.equal(opened[0].cardUid, found[0].getAttribute("data-uid"));

    cache.setBoard("b3", "Third", [{ uid: "c3", target: "block1" }]);
    cache.setBoard("b4", "Fourth", [{ uid: "c4", target: "block1" }]);
    chips.scan(root);
    assert.equal(carded.querySelectorAll(".pxd-cardchip").length, 3);
    assert.equal(carded.querySelector(".pxd-cardchip-more").textContent, "+1");
    chips.dispose();
    assert.equal(stub.document.body.querySelector(".pxd-cardchip"), null);
  } finally {
    restore();
  }
});

test("chips skip a highlight, a board card, search, a focused block, and an opted-out page", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "P18 fixture", [{ uid: "c1", target: "hid" }, { uid: "c2", target: "note" }]);
    const { chips } = layer(stub, cache);
    const root = stub.document.createElement("div");
    const highlight = box(stub.document, "hid");
    const view = stub.document.createElement("span");
    view.className = "rm-block-highlight-view";
    highlight.append(view);
    const board = stub.document.createElement("div");
    board.className = "pxd-root";
    const inside = box(stub.document, "note");
    board.append(inside);
    const search = stub.document.createElement("div");
    search.className = "rm-search-results";
    const found = box(stub.document, "note");
    search.append(found);
    const editing = box(stub.document, "note");
    const area = stub.document.createElement("textarea");
    editing.append(area);
    root.append(highlight, board, search, editing);
    stub.document.body.append(root);
    area.focus();
    chips.scan(root);
    assert.equal(highlight.querySelector(".pxd-cardchip"), null);
    assert.equal(inside.querySelector(".pxd-cardchip"), null);
    assert.equal(found.querySelector(".pxd-cardchip"), null);
    assert.equal(editing.querySelector(".pxd-cardchip"), null);

    const article = stub.document.createElement("div");
    article.className = "roam-article";
    const tag = stub.document.createElement("span");
    tag.className = "rm-page-ref";
    tag.setAttribute("data-link-title", "plexus-no-chips");
    const opted = box(stub.document, "note");
    article.append(tag, opted);
    stub.document.body.append(article);
    chips.scan(article);
    assert.equal(opted.querySelector(".pxd-cardchip"), null);
    chips.dispose();
  } finally {
    restore();
  }
});

test("the page chip sits after the reference header, or first in the block list, never on the title", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "P18 fixture", [{ uid: "card", target: "page1" }]);
    const { chips } = layer(stub, cache, { pageUid: () => "page1" });
    const page = stub.document.createElement("div");
    page.className = "roam-article";
    const title = stub.document.createElement("h1");
    title.className = "rm-title-display";
    title.textContent = "Lab";
    const kids = stub.document.createElement("div");
    kids.className = "rm-block-children";
    kids.append(stub.document.createElement("div"));
    page.append(title, kids);
    stub.document.body.append(page);
    chips.scan(page);
    assert.equal(title.querySelector(".pxd-cardchip"), null);
    assert.equal(kids.firstChild.className, "pxd-cardchip-row");
    assert.equal(kids.querySelector(".pxd-cardchip").textContent, "▦ on P18 fixture");

    const header = stub.document.createElement("div");
    header.className = "rm-reference-main";
    page.insertBefore(header, kids);
    chips.scan(page);
    const row = page.querySelector(".pxd-cardchip-row");
    assert.equal(header.nextElementSibling, row);
    assert.equal(title.querySelector(".pxd-cardchip"), null);
    chips.dispose();
  } finally {
    restore();
  }
});

test("an input id resolves to the block, and the scan stops at 60", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    const children = [];
    for (let i = 0; i < 61; i += 1) children.push({ uid: `c${i}`, target: `t${i}` });
    cache.setBoard("b1", "P18 fixture", children);
    const before = stub.listenerCount();
    const { chips } = layer(stub, cache);
    assert.ok(stub.listenerCount() > before);
    const root = stub.document.createElement("div");
    const input = box(stub.document, "");
    input.removeAttribute?.("data-block-uid");
    const area = stub.document.createElement("textarea");
    area.id = "block-input-page-t0";
    input.append(area);
    root.append(input);
    for (let i = 1; i < 61; i += 1) root.append(box(stub.document, `t${i}`));
    stub.document.body.append(root);
    chips.scan(root);
    assert.equal(input.querySelector(".pxd-cardchip").getAttribute("data-uid"), "c0");
    assert.equal(root.querySelector('[data-block-uid="t60"] .pxd-cardchip'), null);
    assert.equal(root.querySelector('[data-block-uid="t59"] .pxd-cardchip') == null, false);
    const down = stub.dispatch(area, "pointerdown");
    assert.equal(down.propagationStopped, false);
    assert.equal(input.querySelector(".pxd-cardchip"), null);
    chips.dispose();
    assert.equal(stub.listenerCount(), before);
    stub.flushTimers();
    assert.equal(root.querySelector('[data-block-uid="t60"] .pxd-cardchip'), null);
  } finally {
    restore();
  }
});

test("the block past 60 gets a chip on a later slice", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    const children = [];
    for (let i = 0; i < 61; i += 1) children.push({ uid: `c${i}`, target: `t${i}` });
    cache.setBoard("b1", "P18 fixture", children);
    const { chips } = layer(stub, cache);
    const root = stub.document.createElement("div");
    for (let i = 0; i < 61; i += 1) root.append(box(stub.document, `t${i}`));
    stub.document.body.append(root);
    chips.scan(root);
    chips.scan(root);
    assert.equal(root.querySelector('[data-block-uid="t60"] .pxd-cardchip'), null);
    assert.equal(root.querySelector('[data-block-uid="t59"] .pxd-cardchip') == null, false);
    stub.flushTimers();
    assert.equal(root.querySelector('[data-block-uid="t60"] .pxd-cardchip').getAttribute("data-uid"), "c60");
    chips.dispose();
    stub.flushTimers();
    assert.equal(root.querySelector(".pxd-cardchip"), null);
  } finally {
    restore();
  }
});

test("card chips keep a 1px border and a clear fill", () => {
  const css = readFileSync(new URL("../src/css/cardchips.css", import.meta.url), "utf8");
  const blocks = [...css.matchAll(/([^{]+)\{([^}]+)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((part) => part.trim()),
    body: match[2],
  }));
  for (const selector of [".pxd-cardchip.pxd-cardchip", ".bp3-dark .pxd-cardchip.pxd-cardchip", "body.bt-theme-dark .pxd-cardchip.pxd-cardchip"]) {
    const block = blocks.find((entry) => entry.selectors.includes(selector));
    assert.ok(block, selector);
    assert.match(block.body, /border:\s*1px solid/);
    assert.match(block.body, /background:\s*transparent/);
  }
});
