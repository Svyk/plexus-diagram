// Roam overlays trapped in a board, or painted under the fullscreen layer, must sit above it.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { installRoamStack, liftRoamOverlay, syncBoardClass } from "../src/view/roam-stack.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");

test("fullscreen stays at 40 and Roam's top bar and portals paint above the board", () => {
  const fullscreenZ = Number(/\.pxd-mount--fullscreen \{[^}]*z-index: (\d+)/.exec(css)[1]);
  assert.equal(fullscreenZ, 40);
  assert.match(css, /body\.pxd-has-board \.rm-topbar \{[^}]*z-index:\s*80/);
  assert.match(css, /body\.pxd-has-board > \.bp3-portal \{[^}]*z-index:\s*2500\s*!important/);
  assert.match(css, /body\.pxd-has-board > \.bp3-portal:has\(\.bp3-dialog\)[^}]*z-index:\s*400000\s*!important/);
  assert.match(css, /body\.pxd-has-board > \.bp3-portal:has\(\.bp3-alert\)/);
});

test("a trapped overlay is not moved; a topbar search stays; a body portal keeps its inline z-index", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const mount = doc.createElement("div");
    mount.className = "pxd-mount";
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const portal = doc.createElement("div");
    portal.className = "bp3-portal";
    const pop = doc.createElement("div");
    pop.className = "bp3-popover";
    portal.append(pop);
    root.append(portal);
    mount.append(root);
    const topbar = doc.createElement("div");
    topbar.className = "rm-topbar";
    const find = doc.createElement("div");
    find.className = "rm-find-or-create-wrapper";
    topbar.append(find);
    const menu = doc.createElement("div");
    menu.className = "bp3-portal";
    menu.style.setProperty("z-index", "4000", "important");
    const dialog = doc.createElement("div");
    dialog.className = "bp3-portal";
    const dialogBox = doc.createElement("div");
    dialogBox.className = "bp3-dialog";
    dialog.append(dialogBox);
    doc.body.append(mount, topbar, menu, dialog);

    assert.equal(liftRoamOverlay(pop, doc), false);
    assert.equal(portal.parentElement, root);
    assert.equal(portal.style["z-index"], undefined);
    assert.equal(liftRoamOverlay(find, doc), false);
    assert.equal(find.parentElement, topbar);
    assert.equal(liftRoamOverlay(menu, doc), false);
    assert.equal(menu.style["z-index"], "4000");
    assert.equal(liftRoamOverlay(dialog, doc), false);
    assert.equal(dialog.style["z-index"], undefined);
    assert.equal(dialog.parentElement, doc.body);
  } finally {
    restore();
  }
});

test("hovering a block ref lifts the portal that appears after the pointer; a plain card hover does not", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const ref = doc.createElement("span");
    ref.className = "rm-block-ref";
    const plain = doc.createElement("div");
    plain.className = "pxd-item";
    root.append(ref, plain);
    doc.body.append(root);
    const off = installRoamStack(doc);
    stub.dispatch(plain, "pointerover");
    const ignored = doc.createElement("div");
    ignored.className = "bp3-portal";
    root.append(ignored);
    stub.flushFrames();
    assert.equal(ignored.parentElement, root, "a card hover does not lift");
    stub.dispatch(ref, "pointerover");
    const card = doc.createElement("div");
    card.className = "pxd-item";
    const portal = doc.createElement("div");
    portal.className = "bp3-portal";
    const date = doc.createElement("div");
    date.className = "bp3-datepicker";
    portal.append(date);
    card.append(portal);
    root.append(card);
    stub.flushFrames();
    assert.equal(portal.parentElement, card);
    assert.equal(card.classList.contains("pxd-item--pop"), true);
    assert.equal(portal.style["z-index"], undefined);
    const late = doc.createElement("div");
    late.className = "bp3-portal";
    doc.body.append(late);
    stub.flushMutations();
    stub.flushFrames();
    assert.equal(late.parentElement, doc.body);
    assert.equal(late.style["z-index"], undefined);
    off();
    assert.equal(card.classList.contains("pxd-item--pop"), false);
    const after = doc.createElement("div");
    after.className = "bp3-portal";
    doc.body.append(after);
    stub.flushMutations();
    stub.flushFrames();
    assert.equal(after.style["z-index"], undefined);
  } finally {
    restore();
  }
});

test("a trapped overlay stays in its card, the card rises, and uninstall lowers it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const mount = doc.createElement("div");
    mount.className = "pxd-mount";
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const card = doc.createElement("div");
    card.className = "pxd-item";
    const portal = doc.createElement("div");
    portal.className = "bp3-portal";
    const pop = doc.createElement("div");
    pop.className = "bp3-popover";
    portal.append(pop);
    card.append(portal);
    root.append(card);
    mount.append(root);
    const menu = doc.createElement("div");
    menu.className = "bp3-portal";
    menu.style.setProperty("z-index", "4000", "important");
    doc.body.append(mount, menu);

    assert.equal(liftRoamOverlay(pop, doc), true);
    assert.equal(portal.parentElement, card);
    assert.equal(card.classList.contains("pxd-item--pop"), true);
    assert.equal(menu.parentElement, doc.body);
    assert.equal(liftRoamOverlay(menu, doc), false);
    assert.equal(menu.style["z-index"], "4000");
    const off = installRoamStack(doc);
    off();
    assert.equal(card.classList.contains("pxd-item--pop"), false);
    assert.equal(portal.parentElement, card);
  } finally {
    restore();
  }
});

test("the board class is on the body only while a board is mounted", () => {
  const stub = createDomStub();
  const doc = stub.document;
  syncBoardClass(doc, true);
  assert.equal(doc.body.classList.contains("pxd-has-board"), true);
  syncBoardClass(doc, false);
  assert.equal(doc.body.classList.contains("pxd-has-board"), false);
});
