import assert from "node:assert/strict";
import test from "node:test";

import { placeEditorMenus } from "../src/view/editor-menus.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const box = (x, y, width, height) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height });

test("ED-4: a menu inside the board is pinned to the textarea and leaves the scaled viewport", () => {
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

    assert.equal(placeEditorMenus(stub.document, textarea), 1);
    assert.equal(menu.closest(".pxd-viewport"), null);
    assert.equal(menu.parentElement, stub.document.body);
    assert.equal(menu.style.position, "fixed");
    assert.equal(menu.style.transform, "none");
    assert.equal(menu.style.left, "100px");
    assert.equal(menu.style.top, "226px");
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

test("ED-4: a date picker trapped in the board is pinned to the textarea", () => {
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
    assert.equal(placeEditorMenus(stub.document, textarea), 1);
    assert.equal(picker.parentElement, stub.document.body);
    assert.equal(picker.style.position, "fixed");
    assert.equal(picker.style.transform, "none");
    assert.equal(picker.style.left, "100px");
    assert.equal(picker.style.top, "226px");
  } finally {
    restore();
  }
});
