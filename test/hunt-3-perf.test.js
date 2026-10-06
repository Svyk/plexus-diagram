// HUNT-3: page-chip placement is not a document walk per added node, and the
// editor-menu loop does not rewrite position while the caret is still.
import assert from "node:assert/strict";
import test from "node:test";

import { createCardChips } from "../src/cardchips.js";
import { createCardCache } from "../src/model/card-cache.js";
import { watchEditorMenus } from "../src/view/editor-menus.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const PLACE = [".rm-title-display-container", ".rm-reference-main", ".rm-block-children", ".pxd-cardchip-row"];

const box = (x, y, width, height) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height });

function countPlace(node) {
  const orig = node.querySelectorAll.bind(node);
  let n = 0;
  node.querySelectorAll = (sel) => {
    if (PLACE.includes(sel)) n += 1;
    return orig(sel);
  };
  return () => n;
}

function countBody(body) {
  const all = body.querySelectorAll.bind(body);
  const one = body.querySelector.bind(body);
  let n = 0;
  body.querySelectorAll = (...args) => { n += 1; return all(...args); };
  body.querySelector = (...args) => { n += 1; return one(...args); };
  return () => n;
}

function articleOf(stub) {
  const article = stub.document.createElement("div");
  article.className = "roam-article";
  const title = stub.document.createElement("h1");
  title.className = "rm-title-display";
  const kids = stub.document.createElement("div");
  kids.className = "rm-block-children";
  const block = stub.document.createElement("div");
  block.className = "roam-block-container";
  block.setAttribute("data-block-uid", "block1");
  const nested = stub.document.createElement("div");
  nested.className = "rm-block-children";
  block.append(nested);
  kids.append(block);
  article.append(title, kids);
  stub.document.body.append(article);
  return { article, title, kids, block, nested };
}

test("a scan of an added block does not query document.body, and page placement is one article walk per frame", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "P18 fixture", [{ uid: "card", target: "page1" }, { uid: "c1", target: "block1" }]);
    const chips = createCardChips({ doc: stub.document, cache, pageUid: () => "page1" });
    const { article, title, kids, block, nested } = articleOf(stub);
    const bodyQueries = countBody(stub.document.body);
    const walks = countPlace(article);

    for (let i = 0; i < 10; i += 1) chips.scan(block);
    assert.equal(bodyQueries(), 0);
    assert.equal(walks(), 0, "a block burst waits for one frame");
    assert.equal(block.querySelector(".pxd-cardchip").textContent, "▦ on P18 fixture");
    stub.flushFrames();
    const once = walks();
    assert.equal(once > 0, true, "a page with no row gets one article walk");
    assert.equal(kids.querySelector(".pxd-cardchip-row").textContent.includes("▦ on P18 fixture"), true);

    for (let i = 0; i < 10; i += 1) chips.scan(block);
    stub.flushFrames();
    assert.equal(walks(), once, "once the row exists, block inserts do not walk the article");
    for (let i = 0; i < 10; i += 1) chips.scan(nested);
    stub.flushFrames();
    assert.equal(walks(), once, "a nested child list is not the page list");
    assert.equal(bodyQueries(), 0);

    for (let i = 0; i < 10; i += 1) chips.scan(title);
    const beforeTitle = walks();
    stub.flushFrames();
    assert.equal(walks() - beforeTitle > 0, true, "a title burst re-places the row in one frame");
    const settled = walks();
    stub.flushFrames();
    assert.equal(walks(), settled, "a quiet frame does not walk the article again");
    assert.equal(bodyQueries(), 0, "placement is scoped to the article");

    const other = stub.document.createElement("div");
    other.className = "roam-article";
    const otherWalks = countPlace(other);
    stub.document.body.append(other);
    for (let i = 0; i < 5; i += 1) chips.scan(title);
    stub.flushFrames();
    assert.equal(otherWalks(), 0, "the other article is not walked");
    assert.equal(bodyQueries(), 0, "placement is scoped to the article");

    for (let i = 0; i < 5; i += 1) chips.scan(title);
    chips.dispose();
    stub.flushFrames();
    assert.equal(article.querySelector(".pxd-cardchip-row"), null, "dispose drops a placement that was still waiting");
  } finally {
    restore();
  }
});

test("the page row is placed only when the open page is a card target, and an article scan still places it now", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "P18 fixture", [{ uid: "c1", target: "block1" }]);
    const chips = createCardChips({ doc: stub.document, cache, pageUid: () => "page1" });
    const { article, title } = articleOf(stub);
    const walks = countPlace(article);
    const bodyQueries = countBody(stub.document.body);
    chips.scan(article);
    chips.scan(title);
    stub.flushFrames();
    assert.equal(walks(), 0);
    assert.equal(article.querySelector(".pxd-cardchip-row"), null);
    assert.equal(bodyQueries(), 0);

    cache.setBoard("b1", "P18 fixture", [{ uid: "card", target: "page1" }]);
    chips.scan(article);
    assert.ok(article.querySelector(".pxd-cardchip-row"), "scanning the article places the row in this turn");
    assert.equal(bodyQueries(), 0);
    chips.dispose();
  } finally {
    restore();
  }
});

test("the menu loop writes position once while the anchor and the menus stay put, and follows a moved caret", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const textarea = doc.createElement("textarea");
    textarea.className = "rm-block__input";
    textarea._rect = box(100, 200, 180, 24);
    const menu = doc.createElement("div");
    menu.className = "rm-autocomplete__results";
    menu._rect = box(10, 10, 280, 80);
    root.append(textarea, menu);
    doc.body.append(root);

    let leftWrites = 0;
    const orig = menu.style.setProperty.bind(menu.style);
    menu.style.setProperty = (name, value, priority) => {
      if (name === "left") leftWrites += 1;
      return orig(name, value, priority);
    };

    const stop = watchEditorMenus(doc, () => textarea);
    try {
      assert.equal(leftWrites, 1);
      assert.equal(menu.style.position, "fixed");
      assert.equal(menu.style.left, "100px");
      assert.equal(menu.style.top, "226px");
      assert.equal(menu.parentElement, doc.body);
      for (let i = 0; i < 10; i += 1) stub.flushFrames();
      assert.equal(leftWrites, 1, "ten steady frames are one write, not ten");

      textarea._rect = box(160, 240, 180, 24);
      stub.flushFrames();
      assert.equal(leftWrites, 2);
      assert.equal(menu.style.left, "160px");
      assert.equal(menu.style.top, "266px");
    } finally {
      stop();
    }
  } finally {
    restore();
  }
});
