// Structure chips on the reader page: plan per type, hover, actions, selection, Shift dots, leaks.
import assert from "node:assert/strict";
import test from "node:test";

import { chipPlan, createPageChips, runChipAction, sectionIds } from "../src/view/page-chips.js";
import { TIP_TEXT } from "../src/view/tooltip-text.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function sample() {
  return {
    sha256: "abc",
    engine: "builtin",
    optsHash: "h",
    pages: [{ n: 1, w: 100, h: 200, rotation: 0 }],
    order: ["h1", "p1", "t1", "f1", "h2", "l1", "m1"],
    blocks: {
      h1: { id: "h1", type: "heading", page: 1, text: "A", bbox: [0, 0, 100, 10] },
      p1: { id: "p1", type: "para", page: 1, text: "x", bbox: [0, 12, 100, 20] },
      t1: { id: "t1", type: "table", page: 1, bbox: [0, 30, 100, 60], grid: { xs: [0, 50, 100], ys: [30, 45, 60] }, cells: [] },
      f1: { id: "f1", type: "figure", page: 1, bbox: [0, 70, 100, 100] },
      h2: { id: "h2", type: "heading", page: 1, text: "B", bbox: [0, 105, 100, 115] },
      l1: { id: "l1", type: "list", page: 1, bbox: [0, 120, 100, 150] },
      m1: { id: "m1", type: "formula", page: 1, bbox: [0, 160, 100, 180] },
    },
  };
}

function rig({ selection = false, latex = false } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = globalThis.document;
  const page = doc.createElement("div");
  page.className = "page";
  page.setAttribute("data-page-number", "1");
  page._rect = { left: 0, top: 0, width: 100, height: 200, right: 100, bottom: 200 };
  doc.body.append(page);
  const state = { selection };
  const calls = [];
  const before = stub.listenerCount();
  const chips = createPageChips({
    doc,
    getParsed: () => sample(),
    pageEl: (n) => (n === 1 ? page : null),
    pageOf: () => ({ w: 100, h: 200, rotation: 0 }),
    isLatexReady: () => latex,
    getSelection: () => (state.selection ? { isCollapsed: false, toString: () => "text" } : null),
    run: (act, item) => calls.push({ act, ...item }),
  });
  const move = (x, y, target = page) => stub.dispatch(target, "pointermove", { clientX: x, clientY: y });
  const chip = () => page.querySelector(".pxd-page-chip");
  return { stub, restore, doc, page, state, calls, before, chips, move, chip };
}

test("chipPlan: one plan per block type, none for others", () => {
  const doc = sample();
  const label = (id) => chipPlan(doc.blocks[id], doc)?.label;
  assert.equal(label("t1"), "Table 2×2 · Roam Grid");
  assert.equal(label("f1"), "Figure · Card");
  assert.equal(label("h1"), "Insert section");
  assert.equal(label("l1"), "Insert list");
  assert.equal(label("m1"), "Card");
  assert.equal(chipPlan(doc.blocks.p1, doc), null);
  assert.deepEqual(chipPlan(doc.blocks.t1, doc).menu.map((m) => m.label), ["Native", "Flat", "Copy as Markdown", "Card"]);
  assert.deepEqual(chipPlan(doc.blocks.m1, doc).menu, []);
  assert.deepEqual(chipPlan(doc.blocks.m1, doc, { latexReady: true }).menu.map((m) => m.label), ["LaTeX"]);
});

test("sectionIds: heading to the next heading", () => {
  const doc = sample();
  assert.deepEqual(sectionIds(doc, "h1"), ["h1", "p1", "t1", "f1"]);
  assert.deepEqual(sectionIds(doc, "h2"), ["h2", "l1", "m1"]);
  assert.deepEqual(sectionIds(doc, "nope"), []);
  assert.deepEqual(chipPlan(doc.blocks.h1, doc).primary.ids, ["h1", "p1", "t1", "f1"]);
});

test("hover shows an outline and one chip per type; nothing is written", () => {
  const h = rig();
  try {
    for (const [y, cls, text] of [
      [45, "pxd-page-chip--table", "Table 2×2 · Roam Grid"],
      [85, "pxd-page-chip--figure", "Figure · Card"],
      [5, "pxd-page-chip--heading", "Insert section"],
      [130, "pxd-page-chip--list", "Insert list"],
      [170, "pxd-page-chip--formula", "Card"],
    ]) {
      h.move(50, y);
      assert.ok(h.chip().classList.contains(cls), cls);
      assert.equal(h.chip().querySelector(".pxd-page-chip__main").textContent, text);
      assert.ok(h.page.querySelector(".pxd-page-outline"));
      assert.equal(h.chip().style.pointerEvents, "auto");
      assert.equal(h.page.querySelector(".pxd-page-outline").style.pointerEvents, "none");
      assert.equal(h.page.querySelectorAll(".pxd-page-chip").length, 1);
    }
    h.move(50, 16);
    assert.ok(h.chip(), "para gets no chip but the grace delay keeps the last one");
    assert.equal(h.calls.length, 0);
    h.stub.flushTimers();
    assert.equal(h.chip(), null);
    assert.equal(h.page.querySelector(".pxd-page-outline"), null);
  } finally { h.chips.dispose(); h.restore(); }
});

test("chip click calls the action with the right ids and mode", () => {
  const h = rig();
  try {
    h.move(50, 45);
    h.chip().querySelector(".pxd-page-chip__main").click();
    assert.deepEqual(h.calls[0].act, "table");
    assert.deepEqual(h.calls[0].ids, ["t1"]);
    assert.deepEqual(h.calls[0].extra, { mode: "grid", kind: "table" });
    assert.equal(h.chip(), null, "chip closes after the click");

    h.move(50, 45);
    const caret = h.chip().querySelector(".pxd-page-chip__more");
    const menu = h.chip().querySelector(".pxd-page-chip__menu");
    assert.equal(menu.hidden, true);
    caret.click();
    assert.equal(menu.hidden, false);
    const flat = menu.querySelectorAll(".pxd-page-chip__item").find((n) => n.getAttribute("data-mode") === "flat");
    flat.click();
    assert.equal(h.calls[1].extra.mode, "flat");

    h.move(50, 5);
    h.chip().querySelector(".pxd-page-chip__main").click();
    assert.equal(h.calls[2].act, "board");
    assert.deepEqual(h.calls[2].ids, ["h1", "p1", "t1", "f1"]);

    h.move(50, 85);
    h.chip().querySelector(".pxd-page-chip__main").click();
    assert.equal(h.calls[3].act, "card");
    assert.deepEqual(h.calls[3].ids, ["f1"]);

    h.move(50, 130);
    h.chip().querySelector(".pxd-page-chip__main").click();
    assert.equal(h.calls[4].act, "below");
  } finally { h.chips.dispose(); h.restore(); }
});

test("runChipAction maps acts onto session methods", () => {
  const seen = [];
  const session = {};
  for (const name of ["insertParsedTable", "insertParsedCard", "sendParsedToBoard", "insertParsedBelow"]) session[name] = (p) => seen.push([name, p]);
  const payload = (ids) => ({ ids, kind: "blocks" });
  const copied = [];
  const ctx = { session, payload, copy: (ids) => copied.push(ids) };
  runChipAction({ act: "table", ids: ["t1"], extra: { mode: "native", kind: "table" } }, ctx);
  runChipAction({ act: "card", ids: ["f1"] }, ctx);
  runChipAction({ act: "board", ids: ["h1", "p1"] }, ctx);
  runChipAction({ act: "below", ids: ["l1"] }, ctx);
  runChipAction({ act: "copy", ids: ["t1"] }, ctx);
  assert.deepEqual(seen.map((s) => s[0]), ["insertParsedTable", "insertParsedCard", "sendParsedToBoard", "insertParsedBelow"]);
  assert.deepEqual(seen[0][1], { ids: ["t1"], kind: "table", mode: "native" });
  assert.deepEqual(copied, [["t1"]]);
  assert.equal(runChipAction({ act: "card", ids: [] }, { session: {}, payload }), false);
});

test("chips stay hidden while a text selection is active", () => {
  const h = rig({ selection: true });
  try {
    h.move(50, 45);
    assert.equal(h.chip(), null);
    h.state.selection = false;
    h.move(50, 45);
    assert.ok(h.chip());
    h.state.selection = true;
    h.stub.dispatch(h.doc, "selectionchange");
    assert.equal(h.chip(), null);
    assert.equal(h.page.querySelector(".pxd-page-outline"), null);
  } finally { h.chips.dispose(); h.restore(); }
});

test("Shift shows numbered reading-order dots, release removes them", () => {
  const h = rig();
  try {
    h.stub.dispatch(globalThis.window, "keydown", { key: "Shift" });
    const dots = h.page.querySelectorAll(".pxd-page-dot");
    assert.equal(dots.length, 7);
    assert.deepEqual(dots.map((d) => d.textContent), ["1", "2", "3", "4", "5", "6", "7"]);
    assert.ok(dots.every((d) => d.style.pointerEvents === "none"));
    h.stub.dispatch(globalThis.window, "keyup", { key: "Shift" });
    assert.equal(h.page.querySelectorAll(".pxd-page-dot").length, 0);
  } finally { h.chips.dispose(); h.restore(); }
});

test("dispose removes nodes and every listener", () => {
  const h = rig({ latex: true });
  try {
    h.move(50, 45);
    h.stub.dispatch(globalThis.window, "keydown", { key: "Shift" });
    assert.ok(h.stub.listenerCount() > h.before);
    h.chips.dispose();
    assert.equal(h.stub.listenerCount(), h.before);
    assert.equal(h.page.querySelector(".pxd-page-chip"), null);
    assert.equal(h.page.querySelectorAll(".pxd-page-dot").length, 0);
    h.move(50, 45);
    assert.equal(h.chip(), null);
  } finally { h.restore(); }
});

test("hiding a chip releases its own listeners", () => {
  const h = rig();
  try {
    const base = h.stub.listenerCount();
    h.move(50, 45);
    assert.ok(h.stub.listenerCount() > base);
    h.chips.hide();
    assert.equal(h.stub.listenerCount(), base);
  } finally { h.chips.dispose(); h.restore(); }
});

test("tooltip entries exist for every chip id", () => {
  for (const id of ["table", "more", "figure", "formula", "heading", "list"]) assert.ok(TIP_TEXT[`page-chip.${id}`]?.desc, id);
});
