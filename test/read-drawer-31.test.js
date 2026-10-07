// PDF-U4. Highlight drawer: filters, new-highlight pill, keys, drag payload.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CARD_MIME } from "../src/model/drop.js";
import {
  cardDragPayload,
  colorsPresent,
  diffNew,
  fillCardDrag,
  filterRows,
  highlightRows,
  pagesPresent,
  placedUidSet,
  readKeyPair,
  sortRows,
  writeKeyPair,
} from "../src/model/read-drawer-model.js";
import { createReadDrawer } from "../src/view/read-drawer.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function row(uid, color, page, snippet, extra = {}) {
  return { uid, color, page, snippet, placed: false, note: "", ...extra };
}

function treeNode(uid, text, color, page) {
  return {
    uid,
    string: `${text} #h/${color}`,
    props: { ":pdf-highlight": { position: { boundingRect: { pageNumber: page } } } },
    children: [],
  };
}

function memory(seed) {
  const map = new Map(seed || []);
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
  };
}

function mountDrawer(stub, opts = {}) {
  const doc = stub.document;
  const pane = doc.createElement("div");
  pane.className = "pxd-read";
  pane._rect = { left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600, x: 0, y: 0 };
  const mount = doc.createElement("div");
  mount.className = "pxd-read__drawer";
  pane.append(mount);
  doc.body.append(pane);
  const drawer = createReadDrawer({ doc, mount, ...opts });
  return { doc, pane, mount, drawer };
}

function uids(root) {
  return [...root.querySelectorAll(".pxd-read-drawer__row")].map((node) => node.getAttribute("data-uid"));
}

function byAttr(root, sel, name, value) {
  return [...root.querySelectorAll(sel)].find((node) => node.getAttribute(name) === value);
}

function windowListeners(stub) {
  let n = 0;
  for (const entry of stub.listeners) {
    if (entry.target === stub.window || entry.target === stub.document) n += 1;
  }
  return n;
}

const SAMPLE = [
  row("a", "yellow", 1, "Lagrange point"),
  row("b", "blue", 1, "other"),
  row("c", "yellow", 3, "Lagrange again"),
  row("d", "red", 2, "none"),
];

test("filterRows combines colour, page and needle", () => {
  const yellow = new Set(["yellow"]);
  assert.deepEqual(filterRows(SAMPLE, { colors: yellow }).map((r) => r.uid), ["a", "c"]);
  assert.deepEqual(filterRows(SAMPLE, { page: 1 }).map((r) => r.uid), ["a", "b"]);
  assert.deepEqual(filterRows(SAMPLE, { colors: yellow, page: 1 }).map((r) => r.uid), ["a"]);
  assert.deepEqual(filterRows(SAMPLE, { needle: "  lagrange " }).map((r) => r.uid), ["a", "c"]);
  assert.deepEqual(filterRows(SAMPLE, { colors: new Set(["blue"]), needle: "lagrange" }), []);
  assert.equal(filterRows(SAMPLE, { colors: new Set() }).length, 4);
  assert.equal(filterRows(SAMPLE, {}).length, 4);
  assert.deepEqual(filterRows(null, { needle: "x" }), []);
});

test("diffNew returns uids that were not in the previous set", () => {
  assert.deepEqual(diffNew(["a"], SAMPLE), ["b", "c", "d"]);
  assert.deepEqual(diffNew(new Set(["a", "b", "c", "d"]), SAMPLE), []);
  assert.deepEqual(diffNew(null, SAMPLE), ["a", "b", "c", "d"]);
  assert.deepEqual(diffNew(new Set(), [{ uid: "a" }, { uid: "a" }, { uid: "" }, "b"]), ["a", "b"]);
});

test("sortRows and highlightRows keep the pane's page order", () => {
  const sorted = sortRows(highlightRows([
    treeNode("late", "later", "blue", 2),
    treeNode("early", "first", "yellow", 1),
    treeNode("same", "second", "yellow", 1),
    { uid: "loose", string: "no page #h/red", props: { ":pdf-highlight": {} }, children: [] },
  ], { placed: new Set(["early"]) }));
  assert.deepEqual(sorted.map((r) => r.uid), ["early", "same", "late", "loose"]);
  assert.equal(sorted[0].placed, true);
  assert.equal(sorted[0].color, "yellow");
  assert.equal(sorted[0].page, 1);
  assert.deepEqual(colorsPresent(sorted), ["yellow", "blue", "red"]);
  assert.deepEqual(pagesPresent(sorted), [1, 2]);
  assert.deepEqual(placedUidSet([{ kind: "highlight", uid: "card", target: { uid: "early" } }]), new Set(["early"]));
});

test("readKeyPair keeps the pane width as the first token", () => {
  assert.deepEqual(readKeyPair("480"), { width: 480, drawer: null });
  assert.deepEqual(readKeyPair("480 0.5"), { width: 480, drawer: 0.5 });
  assert.equal(writeKeyPair("480", 0.5), "480 0.5");
  assert.equal(writeKeyPair("480 0.25", 0.5), "480 0.5");
  assert.equal(writeKeyPair("", 0.5), "0 0.5");
  assert.equal(Number("480 0.5"), NaN);
  assert.equal(cardDragPayload("abc"), "((abc))");
  assert.equal(cardDragPayload(""), "");
  const bag = new Map();
  const data = {
    setData(type, value) { bag.set(type, value); },
    getData(type) { return bag.get(type) || ""; },
  };
  assert.equal(fillCardDrag(data, "abc"), "((abc))");
  assert.equal(bag.get(CARD_MIME), "((abc))");
  assert.equal(bag.get("text/plain"), "((abc))");
  assert.equal(data.effectAllowed, "copy");
});

test("strip count, chips, search and the placed glyph", () => {
  const stub = createDomStub();
  let data = [row("a", "yellow", 1, "Lagrange point"), row("b", "blue", 2, "other text")];
  const { drawer } = mountDrawer(stub, {
    rows: () => data,
    placed: () => [{ kind: "highlight", target: { uid: "a" } }],
  });
  const root = drawer.element();
  const count = root.querySelector(".pxd-read-drawer__count");
  drawer.setCount(4);
  assert.equal(count.textContent, "4 highlights");
  drawer.refresh();
  assert.equal(count.textContent, "2 highlights");
  assert.equal(drawer.isOpen(), false);
  assert.deepEqual(
    [...root.querySelectorAll(".pxd-read-drawer__dot")].map((dot) => dot.getAttribute("data-color")),
    ["yellow", "blue"],
  );
  assert.deepEqual(
    [...root.querySelectorAll(".pxd-pdf-chip")].map((chip) => chip.textContent),
    ["p.1", "p.2"],
  );
  const placed = root.querySelector('.pxd-read-drawer__row[data-uid="a"] .pxd-read-drawer__on');
  assert.equal(placed.getAttribute("aria-label"), "On board");
  assert.equal(placed.textContent, "");
  assert.equal(root.querySelector(".pxd-read-drawer__row").textContent.includes("On board"), false);
  assert.equal(root.querySelector(".pxd-read-drawer__pg").textContent, "p. 1");

  byAttr(root, ".pxd-read-drawer__dot", "data-color", "yellow").click();
  assert.deepEqual(uids(root), ["a"]);
  assert.equal(count.textContent, "2 highlights");
  byAttr(root, ".pxd-pdf-chip", "data-page", "2").click();
  assert.deepEqual(uids(root), []);
  byAttr(root, ".pxd-read-drawer__dot", "data-color", "yellow").click();
  assert.deepEqual(uids(root), ["b"]);
  byAttr(root, ".pxd-pdf-chip", "data-page", "2").click();
  assert.deepEqual(uids(root), ["a", "b"]);

  const find = root.querySelector(".pxd-read-drawer__find");
  drawer.focusSearch();
  assert.equal(find.hasAttribute("hidden"), false);
  assert.equal(stub.document.activeElement, find);
  find.value = "Lagrange";
  stub.dispatch(find, "input", {});
  assert.deepEqual(uids(root), ["a"]);
  assert.equal(count.textContent, "2 highlights");
  drawer.dispose();
});

test("hover and focus mount the icon buttons only while the row is hot", () => {
  const stub = createDomStub();
  const notes = [];
  const places = [];
  const locates = [];
  const hovers = [];
  const { drawer } = mountDrawer(stub, {
    rows: () => [row("a", "yellow", 1, "Lagrange point")],
    onNote: (row) => notes.push(row.uid),
    onPlace: (row) => places.push(row.uid),
    onLocate: (row) => locates.push(row.uid),
    onHover: (uid, on) => hovers.push([uid, on]),
  });
  drawer.refresh();
  const node = drawer.element().querySelector(".pxd-read-drawer__row");
  assert.equal(node.querySelector("button"), null);
  stub.dispatch(node, "pointerover", {});
  assert.equal(node.classList.contains("pxd-read-drawer__row--hot"), true);
  assert.deepEqual(
    [...node.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
    ["Note", "Place", "Locate"],
  );
  assert.deepEqual(hovers, [["a", true]]);
  node.querySelector(".pxd-read-drawer__place").click();
  assert.deepEqual(places, ["a"]);
  assert.deepEqual(locates, []);
  stub.dispatch(node, "pointerout", {});
  assert.equal(node.querySelector("button"), null);
  assert.deepEqual(hovers[1], ["a", false]);

  stub.dispatch(node, "focusin", {});
  assert.equal(node.classList.contains("pxd-read-drawer__row--hot"), true);
  assert.equal(node.querySelectorAll("button").length, 3);
  stub.dispatch(node, "focusout", {});
  assert.equal(node.querySelector("button"), null);
  drawer.dispose();
});

test("a new uid raises the pill and a plain refresh does not", () => {
  const stub = createDomStub();
  const places = [];
  let data = [row("a", "yellow", 1, "Lagrange point"), row("b", "blue", 2, "other")];
  const { drawer } = mountDrawer(stub, {
    rows: () => data,
    onPlace: (row) => places.push(row.uid),
  });
  const root = drawer.element();
  const pill = root.querySelector(".pxd-read-drawer__pill");
  drawer.refresh();
  assert.equal(pill.hasAttribute("hidden"), true);
  assert.equal(stub.timers.size, 0);
  drawer.refresh();
  assert.equal(pill.hasAttribute("hidden"), true);
  data = data.concat(row("c", "green", 3, "fresh line"));
  drawer.refresh();
  assert.equal(root.querySelector(".pxd-read-drawer__count").textContent, "3 highlights");
  assert.equal(pill.hasAttribute("hidden"), false);
  assert.match(pill.textContent, /New highlight · Place on board/);
  assert.deepEqual([...stub.timers].map((timer) => timer.ms).sort((a, b) => a - b), [600, 6000]);
  assert.equal(root.querySelector('[data-uid="c"]').classList.contains("pxd-read-drawer__row--new"), true);
  assert.equal(root.querySelector('[data-uid="a"]').classList.contains("pxd-read-drawer__row--new"), false);
  pill.querySelector("button").click();
  pill.querySelector("button").click();
  assert.deepEqual(places, ["c"]);
  assert.equal(pill.hasAttribute("hidden"), true);
  stub.flushTimers();
  assert.equal(root.querySelector('[data-uid="c"]').classList.contains("pxd-read-drawer__row--new"), false);
  drawer.dispose();
});

test("keys locate, note and place the focused row and ignore the reader", () => {
  const stub = createDomStub();
  const notes = [];
  const places = [];
  const locates = [];
  const { drawer } = mountDrawer(stub, {
    rows: () => [row("a", "yellow", 1, "Lagrange point"), row("b", "blue", 2, "other")],
    onNote: (row) => notes.push(row.uid),
    onPlace: (row) => places.push(row.uid),
    onLocate: (row) => locates.push(row.uid),
  });
  drawer.refresh();
  const root = drawer.element();
  const list = root.querySelector(".pxd-read-drawer__list");
  const find = root.querySelector(".pxd-read-drawer__find");
  stub.dispatch(find, "keydown", { key: "n" });
  stub.dispatch(list, "keydown", { key: "n", ctrlKey: true });
  assert.deepEqual(notes, []);
  const down = stub.dispatch(list, "keydown", { key: "ArrowDown" });
  assert.equal(down.defaultPrevented, true);
  const entered = stub.dispatch(list, "keydown", { key: "Enter" });
  assert.equal(entered.defaultPrevented, true);
  assert.deepEqual(locates, ["a"]);
  stub.dispatch(list, "keydown", { key: "n" });
  stub.dispatch(list, "keydown", { key: "p" });
  assert.deepEqual(notes, ["a"]);
  assert.deepEqual(places, ["a"]);
  stub.dispatch(list, "keydown", { key: "ArrowDown" });
  stub.dispatch(list, "keydown", { key: "Enter" });
  assert.deepEqual(locates, ["a", "b"]);

  const reader = stub.document.createElement("div");
  reader.className = "rm-pdf-container";
  const inner = stub.document.createElement("span");
  reader.append(inner);
  root.append(reader);
  stub.dispatch(inner, "keydown", { key: "n" });
  assert.deepEqual(notes, ["a"]);
  drawer.dispose();
});

test("dragstart writes the CARD_MIME payload and a resize keeps the pane width", () => {
  const stub = createDomStub();
  const storage = memory([["plexus-diagram:read:notes", "480"]]);
  const { drawer } = mountDrawer(stub, {
    rows: () => [row("a", "yellow", 1, "Lagrange point")],
    storage,
    key: "plexus-diagram:read:notes",
  });
  drawer.refresh();
  const root = drawer.element();
  const bag = new Map();
  const data = {
    setData(type, value) { bag.set(type, value); },
    getData(type) { return bag.get(type) || ""; },
  };
  stub.dispatch(root.querySelector(".pxd-read-drawer__row"), "dragstart", { dataTransfer: data });
  assert.equal(bag.get(CARD_MIME), "((a))");
  assert.equal(bag.get("text/plain"), "((a))");

  assert.equal(windowListeners(stub), 0);
  drawer.open();
  assert.equal(root.style.height, "240px");
  const edge = root.querySelector(".pxd-read-drawer__edge");
  stub.dispatch(edge, "pointerdown", { button: 0, clientY: 200 });
  assert.ok(windowListeners(stub) > 0);
  stub.dispatch(stub.window, "pointermove", { clientY: 140 });
  stub.dispatch(stub.window, "pointerup", { clientY: 140 });
  assert.equal(windowListeners(stub), 0);
  assert.equal(root.style.height, "300px");
  assert.equal(storage.getItem("plexus-diagram:read:notes"), "480 0.5");
  drawer.dispose();
});

test("the strip opens the drawer, dispose drops every listener, and rows add none", () => {
  const stub = createDomStub();
  const before = stub.listenerCount();
  let data = [row("a", "yellow", 1, "one")];
  const { mount, drawer } = mountDrawer(stub, {
    rows: () => data,
    storage: memory([["plexus-diagram:read:notes", "480 0.5"]]),
    key: "plexus-diagram:read:notes",
  });
  const root = drawer.element();
  assert.equal(windowListeners(stub), 0);
  assert.equal(mount.querySelector(".pxd-read-drawer"), root);
  const strip = root.querySelector(".pxd-read-drawer__strip");
  const chevron = root.querySelector(".pxd-read-drawer__chevron");
  stub.dispatch(strip, "click", {});
  assert.equal(drawer.isOpen(), true);
  assert.equal(root.style.height, "300px");
  stub.dispatch(strip, "click", {});
  assert.equal(drawer.isOpen(), true);
  chevron.click();
  assert.equal(drawer.isOpen(), false);
  chevron.click();
  assert.equal(drawer.isOpen(), true);
  drawer.close();
  assert.equal(drawer.isOpen(), false);
  const armed = stub.listenerCount();
  drawer.refresh();
  data = Array.from({ length: 20 }, (_, i) => row(`u${i}`, "yellow", 1, `line ${i}`));
  drawer.refresh();
  assert.equal(uids(root).length, 20);
  assert.equal(stub.listenerCount(), armed);
  drawer.dispose();
  assert.equal(stub.listenerCount(), before);
  assert.equal(mount.querySelector(".pxd-read-drawer"), null);
  assert.equal(windowListeners(stub), 0);
});

test("dark colour dots are rings and the strip metrics match the drawer", () => {
  const css = readFileSync(new URL("../src/css/read-drawer.css", import.meta.url), "utf8");
  assert.match(css, /\.bp3-dark \.pxd-read-drawer__dotmark,[\s\S]*?\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*inset 0 0 0 1\.5px/);
  assert.match(css, /\.bp3-dark \.pxd-read-drawer__row--new,[\s\S]*?\{[^}]*background:\s*transparent;/);
  assert.match(css, /height:\s*var\(--pxd-read-strip-h,\s*32px\)/);
  assert.match(css, /width:\s*160px/);
  assert.match(css, /width:\s*24px;\s*\n\s*height:\s*24px;/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /var\(--pxd-hl-bar-w,\s*3px\)/);
  assert.match(css, /\.pxd-read-drawer__dotmark \{[^}]*width:\s*10px;[^}]*height:\s*10px;/);
  assert.doesNotMatch(css, /prefers-color-scheme/);
});
