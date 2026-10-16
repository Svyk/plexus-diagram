import assert from "node:assert/strict";
import test from "node:test";

import { placeEditorMenus } from "../src/view/editor-menus.js";
import { installRoamStack } from "../src/view/roam-stack.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// React's removeChild throws NotFoundError when a node was moved out from under it.
const reactRemove = (parent, node) => {
  if (!parent || node?.parentElement !== parent) {
    const err = new Error("The node to be removed is not a child of this node.");
    err.name = "NotFoundError";
    throw err;
  }
  parent.removeChild(node);
};

const box = (x, y, width, height) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height });

test("a block editor and its menus stay in the card while hover and autocomplete run", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    doc.body.classList.add("pxd-has-board");
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const card = doc.createElement("div");
    card.className = "pxd-item";
    const textarea = doc.createElement("textarea");
    textarea.className = "rm-block__input";
    textarea._rect = box(100, 200, 180, 24);
    const menu = doc.createElement("div");
    menu.className = "rm-autocomplete__results";
    const picker = doc.createElement("div");
    picker.className = "bp3-datepicker";
    card.append(textarea);
    root.append(card);
    doc.body.append(root);
    const off = installRoamStack(doc);
    stub.dispatch(card, "pointerover");
    stub.flushFrames();
    card.append(menu, picker);
    stub.flushMutations();
    const menuHome = menu.parentElement;
    const pickerHome = picker.parentElement;
    assert.equal(placeEditorMenus(doc, textarea), 0);
    assert.equal(textarea.parentElement === card, true, "the textarea stays in the card");
    assert.equal(menu.parentElement === menuHome, true, "autocomplete stays in the card");
    assert.equal(picker.parentElement === pickerHome, true, "date picker stays in the card");
    assert.equal(menuHome === card, true, "autocomplete home is the card");
    assert.equal(pickerHome === card, true, "date picker home is the card");
    assert.doesNotThrow(() => reactRemove(menuHome, menu));
    assert.doesNotThrow(() => reactRemove(pickerHome, picker));
    assert.equal(card.classList.contains("pxd-item--pop"), true);
    off();
    assert.equal(card.classList.contains("pxd-item--pop"), false);
  } finally {
    restore();
  }
});

test("ED-4: a menu inside the board stays where Roam rendered it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    const viewport = stub.document.createElement("div");
    viewport.className = "pxd-viewport";
    const textarea = stub.document.createElement("textarea");
    textarea.className = "rm-block__input";
    textarea._rect = box(100, 200, 180, 24);
    const menu = stub.document.createElement("div");
    menu.className = "rm-autocomplete__results";
    menu.style.transform = "matrix(1, 0, 0, 1, 10, 10)";
    menu._rect = box(10, 10, 280, 80);
    viewport.append(textarea, menu);
    root.append(viewport);
    stub.document.body.append(root);

    assert.equal(placeEditorMenus(stub.document, textarea), 0);
    assert.equal(menu.parentElement === viewport, true, "autocomplete stays in the board");
    assert.equal(menu.style.position || "", "");
    assert.equal(menu.style.left || "", "");
    assert.doesNotThrow(() => reactRemove(viewport, menu));
  } finally {
    restore();
  }
});

test("ED-4: a portaled date picker is left to Roam, even when it sits near the textarea", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const textarea = stub.document.createElement("textarea");
    textarea._rect = box(100, 200, 180, 24);
    const picker = stub.document.createElement("div");
    picker.className = "bp3-datepicker";
    picker._rect = box(120, 230, 220, 240);
    stub.document.body.append(textarea, picker);
    assert.equal(placeEditorMenus(stub.document, textarea), 0);
    assert.equal(picker.style.position || "", "");
    assert.equal(picker.parentElement, stub.document.body);
  } finally {
    restore();
  }
});

test("ED-4: a portaled date picker is pinned to the card and loses Blueprint's transform", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    const textarea = stub.document.createElement("textarea");
    textarea._rect = box(100, 200, 180, 24);
    root.append(textarea);
    const overlay = stub.document.createElement("div");
    overlay.className = "bp3-overlay bp3-overlay-open";
    const trans = stub.document.createElement("div");
    trans.className = "bp3-transition-container";
    trans.style.transform = "matrix(1, 0, 0, 1, 5, 425)";
    const picker = stub.document.createElement("div");
    picker.className = "bp3-datepicker";
    picker._rect = box(5, 425, 265, 256);
    trans.append(picker);
    overlay.append(trans);
    stub.document.body.append(root, overlay);

    assert.equal(placeEditorMenus(stub.document, textarea), 1);
    assert.equal(trans.style.transform, "none");
    assert.equal(overlay.style["pointer-events"], "none");
    assert.equal(picker.style["pointer-events"], "auto");
    assert.equal(picker.style.position, "fixed");
    assert.equal(picker.style.left, "100px");
    assert.equal(picker.style.top, "226px");
    assert.equal(picker.parentElement, trans);
  } finally {
    restore();
  }
});

test("ED-4: a date picker trapped in the board stays in the board", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    const viewport = stub.document.createElement("div");
    viewport.className = "pxd-viewport";
    const textarea = stub.document.createElement("textarea");
    textarea._rect = box(100, 200, 180, 24);
    const picker = stub.document.createElement("div");
    picker.className = "bp3-datepicker";
    picker._rect = box(40, 40, 220, 240);
    viewport.append(textarea, picker);
    root.append(viewport);
    stub.document.body.append(root);
    assert.equal(placeEditorMenus(stub.document, textarea), 0);
    assert.equal(picker.parentElement === viewport, true, "date picker stays in the board");
    assert.equal(picker.style.position || "", "");
    assert.equal(root.style.transform || "", "");
    assert.doesNotThrow(() => reactRemove(viewport, picker));
  } finally {
    restore();
  }
});
