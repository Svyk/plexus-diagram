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
  assert.match(css, /body\.pxd-has-board > \.bp3-portal \{[^}]*z-index:\s*2500/);
  assert.match(css, /body\.pxd-has-board > \.bp3-portal:has\(\.bp3-dialog\)[^}]*z-index:\s*400000\s*!important/);
  assert.match(css, /body\.pxd-has-board > \.bp3-portal:has\(\.bp3-alert\)/);
});

test("dialogs keep a floor; a menu or date portal stacks above it; the pin toast stays below both", () => {
  const ordinary = /body\.pxd-has-board > \.bp3-portal \{[^}]*\}/.exec(css)?.[0] || "";
  assert.match(ordinary, /z-index:\s*2500/);
  assert.doesNotMatch(ordinary, /!important/);
  const dialogAt = css.search(/body\.pxd-has-board > \.bp3-portal:has\(\.bp3-dialog\)[^}]*z-index:\s*400000\s*!important/);
  assert.ok(dialogAt >= 0, "dialogs keep their floor");
  assert.match(css, /body\.pxd-has-board > \.bp3-portal:has\(\.bp3-alert\)/);
  for (const sel of [".bp3-menu", ".bp3-datepicker", ".bp3-select-popover", ".rm-date-picker", ".bp3-context-menu", ".rm-autocomplete__results"]) {
    assert.match(css, new RegExp(`body\\.pxd-has-board > \\.bp3-portal:has\\(\\${sel}\\)`), sel);
  }
  const menuAt = css.search(/z-index:\s*400010\s*!important/);
  assert.ok(menuAt > dialogAt, "a menu portal comes after the dialog floor so it paints above the dialog");
  const commands = readFileSync(new URL("../src/css/commands.css", import.meta.url), "utf8");
  const toast = Number(/\.pxd-toast\.pxd-toast--pin \{[^}]*z-index:\s*(\d+)/.exec(commands)[1]);
  assert.ok(toast < 4000, "toast stays under a slash menu or date picker pinned at 4000");
  assert.ok(toast < 400000);
  assert.ok(toast < 400010);
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

test("a host added inside a card raises that card; a plain hover and a body portal do not", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    doc.body.classList.add("pxd-has-board");
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
    stub.flushMutations();
    assert.equal(ignored.parentElement, root, "a portal with no card stays put");
    assert.equal(plain.classList.contains("pxd-item--pop"), false);
    stub.dispatch(ref, "pointerover");
    stub.flushFrames();
    const card = doc.createElement("div");
    card.className = "pxd-item";
    const portal = doc.createElement("div");
    portal.className = "bp3-portal";
    const date = doc.createElement("div");
    date.className = "bp3-datepicker";
    portal.append(date);
    card.append(portal);
    root.append(card);
    stub.flushMutations();
    assert.equal(portal.parentElement, card);
    assert.equal(card.classList.contains("pxd-item--pop"), true);
    assert.equal(portal.style["z-index"], undefined);
    const late = doc.createElement("div");
    late.className = "bp3-portal";
    doc.body.append(late);
    stub.flushMutations();
    assert.equal(late.parentElement, doc.body);
    assert.equal(late.style["z-index"], undefined);
    off();
    assert.equal(card.classList.contains("pxd-item--pop"), false);
    const after = doc.createElement("div");
    after.className = "bp3-portal";
    doc.body.append(after);
    stub.flushMutations();
    assert.equal(after.style["z-index"], undefined);
    assert.equal(after.parentElement, doc.body);
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

test("pointerover does not scan the document; only an added host on a mounted board raises its card", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    doc.body.classList.add("pxd-has-board");
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const card = doc.createElement("div");
    card.className = "pxd-item";
    const input = doc.createElement("div");
    input.className = "rm-block__input";
    card.append(input);
    root.append(card);
    doc.body.append(root);
    const off = installRoamStack(doc);
    let scans = 0;
    const orig = doc.querySelectorAll.bind(doc);
    doc.querySelectorAll = (sel) => {
      scans += 1;
      return orig(sel);
    };
    stub.dispatch(input, "pointerover");
    stub.dispatch(input, "focusin");
    stub.dispatch(input, "pointerdown");
    stub.flushFrames();
    assert.equal(scans, 0, "pointerover must not query the document");
    assert.equal(card.classList.contains("pxd-item--pop"), false);

    const noise = doc.createElement("div");
    noise.className = "rm-block";
    doc.body.append(noise);
    stub.flushMutations();
    assert.equal(scans, 0, "a non-host added outside the board must not scan");

    const portal = doc.createElement("div");
    portal.className = "bp3-portal";
    const date = doc.createElement("div");
    date.className = "bp3-datepicker";
    portal.append(date);
    card.append(portal);
    stub.flushMutations();
    assert.equal(scans, 0, "an added host is claimed without a document scan");
    assert.equal(portal.parentElement, card);
    assert.equal(card.classList.contains("pxd-item--pop"), true);
    assert.equal(portal.style["z-index"], undefined);

    const menu = doc.createElement("div");
    menu.className = "bp3-menu";
    card.append(menu);
    stub.flushMutations();
    assert.equal(card.classList.contains("pxd-item--pop"), true);
    portal.remove();
    stub.flushMutations();
    assert.equal(card.classList.contains("pxd-item--pop"), true, "the other host still holds the card up");
    menu.remove();
    stub.flushMutations();
    assert.equal(card.classList.contains("pxd-item--pop"), false);

    const wrap = doc.createElement("div");
    const inner = doc.createElement("div");
    inner.className = "rm-autocomplete__results";
    wrap.append(inner);
    card.append(wrap);
    stub.flushMutations();
    assert.equal(scans, 0);
    assert.equal(card.classList.contains("pxd-item--pop"), true, "a wrapper's host still raises the card");
    wrap.remove();
    stub.flushMutations();
    assert.equal(card.classList.contains("pxd-item--pop"), false);

    doc.body.classList.remove("pxd-has-board");
    card.append(portal);
    stub.flushMutations();
    assert.equal(scans, 0);
    assert.equal(card.classList.contains("pxd-item--pop"), false, "no board class, no raise");
    off();
    assert.equal(card.classList.contains("pxd-item--pop"), false);
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
