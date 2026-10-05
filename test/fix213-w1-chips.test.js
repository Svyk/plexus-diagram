// 2.13.0 fix W1: outline-side chips (A1, A2, A10, A11, A12, B6).
import assert from "node:assert/strict";
import test from "node:test";

import { createBoardChips } from "../src/boardchips.js";
import { createCardChips } from "../src/cardchips.js";
import { createCardCache } from "../src/model/card-cache.js";
import { createResurface } from "../src/view/resurface-panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const el = (stub, tag, className) => {
  const node = stub.document.createElement(tag);
  if (className) node.className = className;
  return node;
};

const block = (stub, uid) => {
  const container = el(stub, "div", "roam-block-container");
  container.setAttribute("data-block-uid", uid);
  container.append(el(stub, "div", "rm-block-main"), el(stub, "div", "rm-block-children"));
  return container;
};

function page(stub) {
  const article = el(stub, "div", "roam-article");
  const title = el(stub, "h1", "rm-title-display");
  const header = el(stub, "div", "rm-reference-main");
  const kids = el(stub, "div", "rm-block-children");
  article.append(title, header, kids);
  stub.document.body.append(article);
  return { article, header, kids };
}

test("A1: the page chip row is placed after the reference header on a real children collection", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "Board", [{ uid: "card", target: "page1" }]);
    const chips = createCardChips({ doc: stub.document, cache, pageUid: () => "page1" });
    const { article, header } = page(stub);
    assert.equal(typeof article.children.indexOf, "undefined", "the stub children are HTMLCollection-like");
    assert.doesNotThrow(() => chips.scan(article));
    const row = article.querySelector(".pxd-cardchip-row");
    assert.ok(row);
    assert.equal(header.nextElementSibling, row);
    chips.dispose();
  } finally {
    restore();
  }
});

test("A2: chips written by a scan do not feed the mutation observer back into a rebuild loop", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "Board", [{ uid: "card", target: "page1" }]);
    cache.setBoard("b2", "Other", [{ uid: "card2", target: "page1" }]);
    const chips = createCardChips({ doc: stub.document, cache, pageUid: () => "page1" });
    const { article } = page(stub);
    let callbacks = 0;
    const observer = new stub.window.MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          callbacks += 1;
          chips.scan(node);
        }
      }
    });
    observer.observe(stub.document.body, { childList: true, subtree: true });
    chips.scan(article);
    let rounds = 0;
    while (stub.flushMutations() > 0 && rounds < 50) rounds += 1;
    assert.ok(rounds < 50, "the observer settles");
    assert.ok(callbacks < 20, `callbacks stay small, got ${callbacks}`);
    assert.equal(article.querySelectorAll(".pxd-cardchip").length, 2);
    observer.disconnect();
    chips.dispose();
  } finally {
    restore();
  }
});

test("A2: a second scan with the same boards keeps the same chip nodes", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "Board", [{ uid: "card", target: "page1" }]);
    const chips = createCardChips({ doc: stub.document, cache, pageUid: () => "page1" });
    const { article } = page(stub);
    chips.scan(article);
    const first = article.querySelector(".pxd-cardchip");
    chips.scan(article);
    assert.equal(article.querySelector(".pxd-cardchip"), first);
    cache.setBoard("b1", "Renamed", [{ uid: "card", target: "page1" }]);
    chips.scan(article);
    assert.equal(article.querySelector(".pxd-cardchip").textContent, "▦ on Renamed");
    chips.dispose();
  } finally {
    restore();
  }
});

test("A10: the hover popover closes after the pointer leaves, and on an outside press", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "Board", [{ uid: "c1", target: "block1" }]);
    const chips = createCardChips({
      doc: stub.document,
      cache,
      onPreview: () => ({ title: "Board", section: "", svg: null }),
    });
    const root = el(stub, "div");
    const carded = block(stub, "block1");
    root.append(carded);
    stub.document.body.append(root);
    chips.scan(root);
    const chip = carded.querySelector(".pxd-cardchip");
    stub.dispatch(chip, "pointerover");
    stub.flushTimers();
    assert.ok(stub.document.body.querySelector(".pxd-cardpop"), "open after the delay");
    stub.dispatch(chip, "pointerout", { relatedTarget: root });
    assert.ok(stub.document.body.querySelector(".pxd-cardpop"), "a grace period before it closes");
    stub.flushTimers();
    assert.equal(stub.document.body.querySelector(".pxd-cardpop"), null);

    stub.dispatch(chip, "pointerover");
    stub.flushTimers();
    const pop = stub.document.body.querySelector(".pxd-cardpop");
    assert.ok(pop);
    stub.dispatch(chip, "pointerout", { relatedTarget: pop });
    stub.flushTimers();
    assert.ok(stub.document.body.querySelector(".pxd-cardpop"), "moving into the popover keeps it");
    stub.dispatch(root, "pointerdown");
    assert.equal(stub.document.body.querySelector(".pxd-cardpop"), null, "an outside press closes it");
    chips.dispose();
  } finally {
    restore();
  }
});

test("A11: the opt-out is not read for blocks that are on no board, and a disabled layer returns at once", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "Board", [{ uid: "c1", target: "block1" }]);
    let enabled = true;
    const chips = createCardChips({ doc: stub.document, cache, enabled: () => enabled });
    const article = el(stub, "div", "roam-article");
    const root = el(stub, "div");
    for (let i = 0; i < 5; i += 1) root.append(block(stub, `plain${i}`));
    const carded = block(stub, "block1");
    root.append(carded);
    article.append(root);
    stub.document.body.append(article);
    let reads = 0;
    const original = article.querySelectorAll;
    article.querySelectorAll = (selector) => {
      if (selector === ".rm-page-ref") reads += 1;
      return original(selector);
    };
    chips.scan(root);
    assert.equal(reads, 1, "one opt-out read for the whole scan");
    assert.ok(carded.querySelector(".pxd-cardchip"));

    enabled = false;
    chips.scan(root);
    assert.equal(carded.querySelector(".pxd-cardchip"), null, "turning the setting off removes the chips");
    let walked = 0;
    const bodyAll = stub.document.body.querySelectorAll;
    stub.document.body.querySelectorAll = (selector) => { walked += 1; return bodyAll(selector); };
    chips.scan(root);
    chips.scan(root);
    assert.equal(walked, 0, "a disabled layer does not walk the document");
    chips.dispose();
  } finally {
    restore();
  }
});

test("A12: resurface does no work without a button, prunes a disconnected one, and keeps its rows read to one", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    let reads = 0;
    const resurface = createResurface({
      doc: stub.document,
      pageTitle: () => "October 1st, 2026",
      intervals: () => "7,30",
      rows: () => { reads += 1; return []; },
    });
    const root = el(stub, "div");
    stub.document.body.append(root);
    resurface.scan(root);
    resurface.scan(stub.document.body);
    assert.equal(reads, 0, "no button and no panel: the rows are never read");

    const button = el(stub, "button", "rm-xparser-default-plexus-resurface");
    root.append(button);
    resurface.scan(root);
    assert.equal(root.querySelectorAll(".pxd-resurface").length, 1);
    const afterMount = reads;
    resurface.scan(root);
    resurface.scan(root);
    assert.equal(reads, afterMount + 2, "the cached list is read, not rebuilt into a signature again");

    button.remove();
    resurface.scan(stub.document.body);
    assert.equal(stub.document.body.querySelectorAll(".pxd-resurface").length, 0, "the panel of a removed button goes too");
    resurface.dispose();
  } finally {
    restore();
  }
});

test("B6: an On board chip goes when its card leaves the board, and a carded parent of a highlight gets none", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "Board", [{ uid: "c1", target: "hl1" }, { uid: "c2", target: "parent1" }]);
    const chips = createBoardChips({ doc: stub.document, cache });
    const root = el(stub, "div");
    const hl = block(stub, "hl1");
    hl.querySelector(".rm-block-main").append(el(stub, "div", "rm-block-highlight-view"));
    const parent = block(stub, "parent1");
    const child = block(stub, "child1");
    child.querySelector(".rm-block-main").append(el(stub, "div", "rm-block-highlight-view"));
    parent.querySelector(".rm-block-children").append(child);
    root.append(hl, parent);
    stub.document.body.append(root);
    chips.scan(root);
    assert.equal(hl.querySelectorAll(".pxd-boardchip").length, 1);
    assert.equal(parent.querySelectorAll(".pxd-boardchip").length, 0, "the highlight belongs to the child block");
    assert.equal(chips.count(), 1);

    cache.setBoard("b1", "Board", []);
    chips.scanUids(["hl1"]);
    assert.equal(hl.querySelector(".pxd-boardchip"), null, "the card left, the chip left");
    assert.equal(chips.count(), 0);

    cache.setBoard("b1", "Board", [{ uid: "c1", target: "hl1" }]);
    chips.scanUids(["hl1"]);
    assert.equal(chips.count(), 1);
    hl.remove();
    chips.scan(root);
    assert.equal(chips.count(), 0, "a chip whose block left the page is not kept");
    chips.dispose();
  } finally {
    restore();
  }
});

test("page chip row sits right under the page title when Roam renders a title container", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "Board", [{ uid: "card", target: "page1" }]);
    const chips = createCardChips({ doc: stub.document, cache, pageUid: () => "page1" });
    const article = el(stub, "div", "roam-article");
    const top = el(stub, "div", "");
    const titleBox = el(stub, "div", "rm-title-display-container");
    titleBox.append(el(stub, "h1", "rm-title-display"));
    const kids = el(stub, "div", "rm-block-children");
    top.append(titleBox, kids);
    const refs = el(stub, "div", "rm-reference-wrapper");
    refs.append(el(stub, "div", "rm-reference-main"));
    article.append(top, refs);
    stub.document.body.append(article);
    chips.scan(article);
    const row = article.querySelector(".pxd-cardchip-row");
    assert.ok(row);
    assert.equal(titleBox.nextElementSibling, row);
    assert.equal(row.nextElementSibling, kids);
    chips.dispose();
  } finally {
    restore();
  }
});
