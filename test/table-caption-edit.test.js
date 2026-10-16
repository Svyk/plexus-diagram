// D2. Editing a folded table card edits the caption. The rendered table stays
// the same node. A click inside the grid does not open a textarea.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createItemRenderer } from "../src/view/cards.js";
import { mountBoardView } from "../src/view/board-view.js";
import { resetSharedBgBudget } from "../src/bg-budget.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const MACRO = "{{[[table]]}}";

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});

function rawBoard(children) {
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

const CAP_LAYOUT = { ":x": 0, ":y": 0, ":w": 300, ":h": 200 };
const OLD_LAYOUT = { ":x": 340, ":y": 0, ":w": 300, ":h": 200 };

function captionTree() {
  return rawBoard([
    blk("cap00001", "Quarterly sales", CAP_LAYOUT, 0, [
      blk("tbl00001", MACRO, null, 0, [
        blk("row00001", "Salt", null, 0),
      ]),
    ]),
    blk("old00001", MACRO, OLD_LAYOUT, 1, [
      blk("orow0001", "Pepper", null, 0),
    ]),
  ]);
}

function paintCell(doc, el) {
  const cell = doc.createElement("div");
  cell.className = "pxd-test-cell";
  cell.setAttribute("contenteditable", "true");
  cell.textContent = "Salt | Water [[salt]]";
  el.append(cell);
  return cell;
}

function rendererHarness() {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const rendered = [];
  const writes = [];
  const host = {
    renderString(node, string) { node.textContent = string; },
    unmount() {},
    renderBlock(el, uid, opts) {
      rendered.push({ uid, open: opts?.open });
      if (opts && opts.open === false) paintCell(doc, el);
      else el.textContent = MACRO;
    },
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    openBlock() {},
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const board = buildBoard(captionTree());
  const r = createItemRenderer({
    doc,
    host,
    session: { setString(uid, text) { writes.push([uid, text]); } },
    itemsLayer,
    sectionsLayer,
    timers: { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } },
  });
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -10000, y: -10000, w: 20000, h: 20000 }, zoom: 1, tier: "detail" });
  let guard = 0;
  while (idleQueue.length && guard++ < 100) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  return {
    stub, doc, r, rendered, writes, board,
    done() {
      r.dispose();
      restore();
      noteSpeedFlags(null);
    },
  };
}

function sample(shell) {
  const body = shell.querySelector(".pxd-item__body");
  const header = shell.querySelector(".pxd-item__header");
  const table = body?.querySelector(".pxd-roam-table") || null;
  const ghost = body?.querySelector(".pxd-item__ghost") || null;
  const field = header?.querySelector("textarea.pxd-table-caption") || null;
  const raw = Boolean(body?.textContent?.includes(MACRO));
  return { body, header, table, ghost, field, raw };
}

test("enter edit keeps the same table node and puts the caption in the header", () => {
  const h = rendererHarness();
  try {
    const shell = h.r.shellOf("cap00001");
    const before = sample(shell);
    assert.ok(before.table, "the table is mounted before edit");
    assert.equal(before.table.getAttribute("data-pxd-table"), "tbl00001");
    const calls = h.rendered.length;
    const pending = h.r.enterEdit("cap00001");
    const mid = sample(shell);
    assert.equal(mid.table === before.table, true, "same table node on the enter frame");
    assert.equal(mid.body.contains(before.table), true);
    assert.equal(before.table.closest(".pxd-item__ghost") == null, true);
    assert.equal(mid.ghost == null, true);
    assert.equal(mid.raw, false, "the body is not the raw table source");
    assert.ok(mid.field, "caption field is in the header");
    assert.equal(mid.field.value, "Quarterly sales");
    assert.equal(mid.field.getAttribute("aria-label"), "Table caption");
    assert.equal(h.rendered.length, calls, "enter does not renderBlock the caption");
    assert.equal(shell.classList.contains("pxd-item--editing"), true);
    mid.field.value = "Updated sales";
    h.stub.dispatch(mid.field, "keydown", { key: "Enter" });
    const after = sample(shell);
    assert.equal(after.table === before.table, true, "same table node after commit");
    assert.equal(after.body.contains(before.table), true);
    assert.equal(after.field == null, true);
    assert.equal(after.raw, false);
    assert.equal(shell.classList.contains("pxd-item--editing"), false);
    assert.deepEqual(h.writes, [["cap00001", "Updated sales"]]);
    assert.equal(pending instanceof Promise, true);

    const again = h.r.enterEdit("cap00001");
    const open = sample(shell);
    open.field.value = "Nope";
    h.stub.dispatch(open.field, "keydown", { key: "Escape" });
    assert.deepEqual(h.writes, [["cap00001", "Updated sales"]], "Escape does not write");
    assert.equal(sample(shell).table === before.table, true);
    assert.equal(sample(shell).raw, false);
    assert.equal(shell.querySelector(".pxd-item__header").textContent, "Quarterly sales");

    const third = h.r.enterEdit("cap00001");
    const blur = sample(shell);
    blur.field.value = "Blurred sales";
    h.stub.dispatch(blur.field, "blur", {});
    h.stub.dispatch(blur.field, "keydown", { key: "Enter" });
    assert.deepEqual(h.writes, [["cap00001", "Updated sales"], ["cap00001", "Blurred sales"]]);

    const macro = h.r.enterEdit("cap00001");
    const bad = sample(shell);
    bad.field.value = MACRO;
    h.stub.dispatch(bad.field, "keydown", { key: "Enter" });
    assert.equal(h.writes.length, 2, "writing the table macro does not replace the caption");
    void again; void third; void macro;

    const old = h.r.shellOf("old00001");
    const oldBefore = sample(old);
    h.r.enterEdit("old00001");
    const oldMid = sample(old);
    assert.equal(oldMid.table === oldBefore.table, true);
    assert.equal(oldMid.raw, false);
    assert.equal(oldMid.field.value, "Table · 1 row");
    oldMid.field.value = "Renamed";
    h.stub.dispatch(oldMid.field, "keydown", { key: "Enter" });
    assert.equal(h.writes.some((row) => row[0] === "old00001"), false, "an old-form card does not setString the macro");
    assert.equal(sample(old).table === oldBefore.table, true);
  } finally {
    h.done();
  }
});

test("tableCaptionEdit off still swaps the body for the raw source", () => {
  noteSpeedFlags({ tableCaptionEdit: false });
  const h = rendererHarness();
  try {
    const shell = h.r.shellOf("cap00001");
    const before = sample(shell);
    h.r.enterEdit("cap00001");
    const mid = sample(shell);
    assert.equal(mid.body.querySelector(".pxd-item__editor") != null, true);
    assert.equal(mid.raw, true, "the kill switch still shows the source line");
    assert.equal(mid.field == null, true);
    assert.ok(h.rendered.some((row) => row.uid === "cap00001" && row.open !== false));
    assert.equal(before.table.closest(".pxd-item__ghost") != null || !mid.body.contains(before.table), true);
  } finally {
    h.done();
  }
});

function mountTableBoard(tree = captionTree()) {
  resetSharedBgBudget();
  const stub = createDomStub();
  const restore = stub.install();
  const board = buildBoard(tree);
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid, opts) {
      if (opts && opts.open === false) paintCell(stub.document, el);
      else el.textContent = MACRO;
    },
    renderPage() {},
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
    q: () => [],
    openBlock() {},
    openInSidebar() {},
  };
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
    on() { return () => {}; }, emit() {}, handlerCount: () => 0, release() {}, setLinkMode() {},
    setString() {},
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
  for (let i = 0; i < 8; i += 1) {
    stub.flushFrames();
    stub.flushIdle();
    stub.flushTimers();
  }
  return {
    stub, view,
    done() {
      view.dispose();
      restore();
      resetSharedBgBudget();
      noteSpeedFlags(null);
    },
  };
}

test("a header double-click edits the caption, and a grid click does not", () => {
  const f = mountTableBoard();
  try {
    const card = f.view.root.querySelector('[data-uid="cap00001"]');
    const header = card.querySelector(".pxd-item__header");
    const body = card.querySelector(".pxd-item__body");
    const table = card.querySelector(".pxd-roam-table");
    assert.ok(table);
    const cell = table.querySelector(".pxd-test-cell");
    assert.ok(cell, "the folded table painted a cell");
    assert.equal(cell.getAttribute("contenteditable"), "true");
    const down = f.stub.dispatch(cell, "pointerdown", { button: 0, clientX: 40, clientY: 80 });
    const mouse = f.stub.dispatch(cell, "mousedown", { button: 0, clientX: 40, clientY: 80 });
    assert.equal(down.defaultPrevented, true);
    assert.equal(mouse.defaultPrevented, true);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.equal(card.querySelector(".pxd-table-caption"), null);
    const open = card.querySelector(".pxd-roam-table__open");
    const openDown = f.stub.dispatch(open, "pointerdown", { button: 0, clientX: 40, clientY: 70 });
    assert.equal(openDown.defaultPrevented, false);
    f.stub.dispatch(header, "dblclick", { button: 0, clientX: 40, clientY: 8 });
    const field = header.querySelector("textarea.pxd-table-caption");
    assert.ok(field);
    assert.equal(field.value, "Quarterly sales");
    assert.equal(body.contains(table), true);
    assert.equal(table.closest(".pxd-item__ghost") == null, true);
    assert.equal(body.textContent.includes(MACRO), false);
    assert.equal(table.parentElement === body, true);
  } finally {
    f.done();
  }
});

test("tableCaptionEdit off leaves a grid click to the cell", () => {
  noteSpeedFlags({ tableCaptionEdit: false });
  const f = mountTableBoard();
  try {
    const card = f.view.root.querySelector('[data-uid="cap00001"]');
    const cell = card.querySelector(".pxd-test-cell");
    assert.ok(cell, "the folded table painted a cell");
    const down = f.stub.dispatch(cell, "pointerdown", { button: 0, clientX: 40, clientY: 80 });
    const mouse = f.stub.dispatch(cell, "mousedown", { button: 0, clientX: 40, clientY: 80 });
    assert.equal(down.defaultPrevented, false);
    assert.equal(mouse.defaultPrevented, false);
    assert.equal(card.querySelector(".pxd-table-caption"), null);
  } finally {
    f.done();
  }
});

// R4: a "block"-look card has no header row at detail, so the header cannot be double-clicked.
// A double-click on the folded table (outside an interactive Roam Grid) or its bar edits the caption.
function blockLookTree() {
  return rawBoard([
    blk("cap00001", "Quarterly sales", { ...CAP_LAYOUT, ":look": "block" }, 0, [
      blk("tbl00001", MACRO, null, 0, [blk("row00001", "Salt", null, 0)]),
    ]),
  ]);
}

test("R4: a block-look table card edits its caption from a double-click on the table", () => {
  const f = mountTableBoard(blockLookTree());
  try {
    const card = f.view.root.querySelector('[data-uid="cap00001"]');
    assert.equal(card.classList.contains("pxd-card--block"), true);
    const table = card.querySelector(".pxd-roam-table");
    const cell = table.querySelector(".pxd-test-cell");
    assert.ok(cell);
    const dbl = f.stub.dispatch(cell, "dblclick", { button: 0, clientX: 40, clientY: 80 });
    const field = card.querySelector("textarea.pxd-table-caption");
    assert.ok(field, "the caption field opens");
    assert.equal(field.value, "Quarterly sales");
    assert.equal(dbl.defaultPrevented, true);
    assert.equal(table.parentElement === card.querySelector(".pxd-item__body"), true);
    assert.equal(card.querySelector(".pxd-item__body").textContent.includes(MACRO), false);
  } finally {
    f.done();
  }
});

test("R4: the bar of a block-look grid edits the caption; the grid keeps its own double-click", () => {
  const f = mountTableBoard(blockLookTree());
  try {
    const card = f.view.root.querySelector('[data-uid="cap00001"]');
    const table = card.querySelector(".pxd-roam-table");
    const grid = f.stub.document.createElement("div");
    grid.className = "rg-root";
    const gcell = f.stub.document.createElement("div");
    grid.append(gcell);
    table.querySelector(".pxd-rs__live").append(grid);
    f.stub.dispatch(gcell, "dblclick", { button: 0, clientX: 40, clientY: 80 });
    assert.equal(Boolean(card.querySelector("textarea.pxd-table-caption")), false, "a grid cell double-click stays with the grid");
    f.stub.dispatch(table.querySelector(".pxd-roam-table__bar"), "dblclick", { button: 0, clientX: 40, clientY: 50 });
    assert.ok(card.querySelector("textarea.pxd-table-caption"));
  } finally {
    f.done();
  }
});

test("R4: the card look (header shown) still leaves a table-body double-click alone", () => {
  const f = mountTableBoard(rawBoard([
    blk("cap00001", "Quarterly sales", { ...CAP_LAYOUT, ":look": "card" }, 0, [
      blk("tbl00001", MACRO, null, 0, [blk("row00001", "Salt", null, 0)]),
    ]),
  ]));
  try {
    const card = f.view.root.querySelector('[data-uid="cap00001"]');
    f.stub.dispatch(card.querySelector(".pxd-test-cell"), "dblclick", { button: 0, clientX: 40, clientY: 80 });
    assert.equal(Boolean(card.querySelector("textarea.pxd-table-caption")), false);
  } finally {
    f.done();
  }
});

test("R4: the caption field shows over a block-look card without moving the table", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/css/table-card.css", import.meta.url), "utf8");
  assert.match(css, /pxd-card--block\.pxd-item--roam-table\.pxd-item--editing > \.pxd-item__header[^{]*\{[^}]*display: block;[^}]*position: absolute;/);
});
