import assert from "node:assert/strict";
import test from "node:test";

import { createBoardChips } from "../src/boardchips.js";
import { createCardCache } from "../src/model/card-cache.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function box(doc, uid, { highlight = true } = {}) {
  const container = doc.createElement("div");
  container.className = "roam-block-container";
  container.setAttribute("data-block-uid", uid);
  const main = doc.createElement("div");
  main.className = "rm-block-main";
  if (highlight) {
    const view = doc.createElement("span");
    view.className = "rm-block-highlight-view";
    const icon = doc.createElement("span");
    icon.className = "rm-pdf-highlight-color-icon";
    view.append(icon);
    main.append(view);
  }
  const kids = doc.createElement("div");
  kids.className = "rm-block-children";
  container.append(main, kids);
  return container;
}

test("On board sits outside the highlight view, and only for a cached highlight", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const cache = createCardCache();
    cache.setBoard("b1", "", [{ uid: "card1", target: "hid" }]);
    const layer = createBoardChips({ doc, cache });
    const root = doc.createElement("div");
    const carded = box(doc, "hid");
    const plain = box(doc, "other");
    const note = box(doc, "note1", { highlight: false });
    cache.setBoard("b1", "", [
      { uid: "card1", target: "hid" },
      { uid: "card2", target: "note1" },
    ]);
    const reader = doc.createElement("div");
    reader.className = "rm-pdf-container";
    const inside = box(doc, "hid");
    reader.append(inside);
    const board = doc.createElement("div");
    board.className = "pxd-root";
    const onCard = box(doc, "hid");
    board.append(onCard);
    root.append(carded, plain, note, reader, board);
    doc.body.append(root);

    layer.scan(root);
    const chip = carded.querySelector(".pxd-boardchip");
    assert.equal(chip.textContent, "On board");
    assert.equal(chip.parentElement, carded);
    assert.equal(chip.closest(".rm-block-main"), null);
    assert.equal(chip.closest(".rm-block-highlight-view"), null);
    assert.equal(carded.querySelectorAll(".pxd-boardchip").length, 1);
    assert.equal(plain.querySelector(".pxd-boardchip"), null);
    assert.equal(note.querySelector(".pxd-boardchip"), null);
    assert.equal(inside.querySelector(".pxd-boardchip"), null);
    assert.equal(onCard.querySelector(".pxd-boardchip"), null);

    layer.scan(root);
    assert.equal(carded.querySelectorAll(".pxd-boardchip").length, 1);

    const event = stub.dispatch(chip, "click");
    assert.equal(event.propagationStopped, true);
    layer.dispose();
    assert.equal(doc.body.querySelectorAll(".pxd-boardchip").length, 0);
    assert.equal(layer.count(), 0);
  } finally {
    restore();
  }
});
