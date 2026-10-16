import assert from "node:assert/strict";
import test from "node:test";

import { zoomBoardTarget } from "../src/model/zoom-board.js";
import { addedZoomHost, createZoomChip } from "../src/view/zoom-chip.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const chain = (rows) => {
  const parent = new Map(rows);
  return {
    parentOf: (uid) => (parent.has(uid) ? { parentUid: parent.get(uid) } : null),
    isDiagram: (uid) => uid === "diagram",
    isSection: (uid) => uid === "section" || uid === "section2",
    blockString: (uid) => (uid === "connections" ? "Connections" : uid),
  };
};

test("a zoomed grandchild on a board page names the board, the card, and the block", () => {
  const hit = zoomBoardTarget("grandchild", chain([
    ["grandchild", "child"],
    ["child", "card"],
    ["card", "section"],
    ["section", "diagram"],
    ["diagram", "page"],
  ]));
  assert.deepEqual(hit, { boardUid: "diagram", cardUid: "card", blockUid: "grandchild" });
});

test("zooming the card itself names that card and does not look for a child", () => {
  const hit = zoomBoardTarget("card", chain([
    ["card", "diagram"],
  ]));
  assert.deepEqual(hit, { boardUid: "diagram", cardUid: "card", blockUid: "card" });
});

test("zooming the diagram, a block with no diagram ancestor, or the diagram's sibling is not a board card", () => {
  const readers = chain([
    ["diagram", "page"],
    ["sibling", "page"],
    ["note", "page"],
    ["connections", "diagram"],
  ]);
  assert.equal(zoomBoardTarget("diagram", readers), null);
  assert.equal(zoomBoardTarget("sibling", readers), null);
  assert.equal(zoomBoardTarget("note", readers), null);
  assert.equal(zoomBoardTarget("connections", readers), null);
  assert.equal(zoomBoardTarget("", readers), null);
});

test("a block on a referenced page never reaches the diagram", () => {
  const hit = zoomBoardTarget("line", chain([
    ["line", "pageblock"],
    ["pageblock", "otherpage"],
  ]));
  assert.equal(hit, null);
});

test("a section and a Connections header are skipped; the walk stops at 24 and on a cycle", () => {
  const under = zoomBoardTarget("edge", chain([
    ["edge", "connections"],
    ["connections", "diagram"],
  ]));
  assert.deepEqual(under, { boardUid: "diagram", cardUid: "edge", blockUid: "edge" });
  const nested = zoomBoardTarget("card", chain([
    ["card", "section2"],
    ["section2", "section"],
    ["section", "diagram"],
  ]));
  assert.deepEqual(nested, { boardUid: "diagram", cardUid: "card", blockUid: "card" });
  const loop = chain([]);
  loop.parentOf = () => ({ parentUid: "a" });
  loop.isDiagram = () => false;
  assert.equal(zoomBoardTarget("a", loop), null);
  const long = chain([]);
  const parents = new Map();
  for (let i = 0; i < 30; i += 1) parents.set(`n${i}`, `n${i + 1}`);
  parents.set("n30", "diagram");
  long.parentOf = (uid) => (parents.has(uid) ? { parentUid: parents.get(uid) } : null);
  long.isDiagram = (uid) => uid === "diagram";
  assert.equal(zoomBoardTarget("n0", long), null);
});

test("Open on board is our button on the zoomed outline and a board mutation does not search for it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const article = doc.createElement("div");
    article.className = "rm-article-wrapper";
    const zoom = doc.createElement("div");
    zoom.className = "rm-zoom";
    article.append(zoom);
    const board = doc.createElement("div");
    board.className = "pxd-root";
    const inner = doc.createElement("div");
    inner.className = "rm-zoom";
    let queried = false;
    const orig = inner.querySelector;
    inner.querySelector = (...args) => { queried = true; return orig.call(inner, ...args); };
    board.append(inner);
    doc.body.append(article, board);
    assert.equal(addedZoomHost(inner), null);
    assert.equal(queried, false);
    assert.equal(addedZoomHost(zoom), zoom);

    const opened = [];
    const target = { boardUid: "diagram", cardUid: "card", blockUid: "grandchild" };
    let current = target;
    const chip = createZoomChip({
      doc,
      readTarget: () => current,
      onOpen: (hit) => opened.push(hit),
    });
    chip.sync();
    chip.sync();
    const buttons = [...zoom.querySelectorAll(".pxd-zoomchip")];
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, "Open on board");
    assert.equal(buttons[0].parentElement === zoom, true);
    let bubbled = false;
    zoom.addEventListener("click", () => { bubbled = true; });
    stub.dispatch(buttons[0], "mousedown");
    stub.dispatch(buttons[0], "click");
    assert.equal(bubbled, false);
    assert.deepEqual(opened, [target]);
    chip.sync();
    assert.equal(zoom.querySelectorAll(".pxd-zoomchip").length, 1);
    current = null;
    chip.sync();
    assert.equal(doc.querySelector(".pxd-zoomchip"), null);
    assert.deepEqual(opened, [target]);
    chip.drop();
  } finally {
    restore();
  }
});
