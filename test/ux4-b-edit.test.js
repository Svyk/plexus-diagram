// UX4 lane B: a card editor stays inside its card (B4) and Roam's Reference Path line stays inside the card (B5).
import assert from "node:assert/strict";
import test from "node:test";

import { installRoamStack } from "../src/view/roam-stack.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// Roam wraps every active block textarea in .rm-autocomplete__wrapper; the results list is the overlay.
function editingCard(doc) {
  doc.body.classList.add("pxd-has-board");
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const card = doc.createElement("div");
  card.className = "pxd-item pxd-item--page pxd-item--editing";
  const body = doc.createElement("div");
  body.className = "pxd-item__body";
  const editor = doc.createElement("div");
  editor.className = "pxd-item__editor pxd-page-edit";
  body.append(editor);
  card.append(body);
  root.append(card);
  doc.body.append(root);
  return { root, card, editor };
}

test("B4: the textarea's own autocomplete wrapper does not lift the card out of its clip; an open results list does, until it closes", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const off = installRoamStack(stub.document);
  try {
    const doc = stub.document;
    const { card, editor } = editingCard(doc);
    stub.flushMutations();
    const wrap = doc.createElement("div");
    wrap.className = "rm-autocomplete__wrapper";
    const ta = doc.createElement("textarea");
    ta.className = "rm-block-input rm-block__input";
    wrap.append(ta);
    editor.append(wrap);
    stub.flushMutations();
    assert.equal(card.classList.contains("pxd-item--pop"), false, "typing in a long page card keeps the editor clipped to the card");
    const results = doc.createElement("div");
    results.className = "rm-autocomplete__results";
    wrap.append(results);
    stub.flushMutations();
    assert.equal(card.classList.contains("pxd-item--pop"), true, "the [[ menu paints outside the card");
    results.remove();
    stub.flushMutations();
    assert.equal(card.classList.contains("pxd-item--pop"), false, "the clip comes back when the menu closes");
  } finally {
    off();
    restore();
  }
});

import { blk, editorHost, mount, settleEdit, show } from "./fixtures/ux4-b.js";

const rect = (top, height, left = 0, width = 240) => ({ top, height, left, width, bottom: top + height, right: left + width, x: left, y: top });

test("B4: while typing, the caret row is kept inside the card editor's own scroller (not Roam's window scroll)", async () => {
  const rendered = [];
  const kids = Array.from({ length: 30 }, (_, i) => blk(`kidL${String(i).padStart(5, "0")}`, `row ${i}`));
  const f = mount({ cards: [{ uid: "cardLN001", string: "Long note", plexus: { ":kids": true, ":h": 200 }, children: kids }], host: editorHost(rendered) });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardLN001]");
    f.stub.dispatch(card.querySelector(".pxd-item__string"), "dblclick", { clientX: 30, clientY: 10 });
    await settleEdit(f.stub);
    assert.equal(card.classList.contains("pxd-item--editing"), true);
    const body = card.querySelector(".pxd-item__body");
    body._rect = rect(0, 200);
    body.scrollTop = 0;
    const ta = card.querySelector("textarea");
    ta._rect = rect(260, 20);
    f.stub.dispatch(ta, "input", {});
    f.stub.flushFrames();
    assert.equal(body.scrollTop, 88, "scrolled by the overflow (280 - 200) plus an 8px margin, in world px at zoom 1");
    ta._rect = rect(-30, 20);
    body.scrollTop = 100;
    f.stub.dispatch(ta, "keyup", { key: "ArrowUp" });
    f.stub.flushFrames();
    assert.equal(body.scrollTop, 62, "back up so the row's top shows");
    ta._rect = rect(50, 20);
    f.stub.dispatch(ta, "input", {});
    f.stub.flushFrames();
    assert.equal(body.scrollTop, 62, "a visible caret does not scroll");
  } finally {
    f.view.dispose();
    f.restore();
  }
});
