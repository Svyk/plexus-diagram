import test from "node:test";
import assert from "node:assert/strict";
import { buildBoard, worldRects } from "../src/model/board.js";
import { blockAnchor } from "../src/model/geometry.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createInteractions } from "../src/view/interactions.js";
import { cellUidOf, findCell, measureCell, revealCell, watchTable } from "../src/view/table-cells.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": props, ":block/children": kids });
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
const TABLE = "{{[[table]]}}";

function tableCardHarness({ cells = ["cellAAAA1", "cellBBBB2", "cellCCCC3"] } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const host = {
    renderString(node, string) { node.textContent = string; },
    renderBlock(el) {
      const root = doc.createElement("div");
      root.className = "rg-root";
      for (const uid of cells) {
        const cell = doc.createElement("div");
        cell.className = "rg-cell";
        cell.setAttribute("data-uid", uid);
        root.append(cell);
      }
      el.append(root);
    },
    unmount() {},
    renderPage() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pageOutline: () => ({ exists: false, blocks: [] }),
    pageUid: () => null,
    watchPage: () => () => {},
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const laterQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => {}; },
    later(fn, ms) { const t = { fn, ms }; laterQueue.push(t); return () => {}; },
  };
  const layouts = [];
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers, onPageLayout: (uid) => layouts.push(uid) });
  const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [raw("tbl000001", TABLE, plx({ x: 0, y: 0, w: 480, h: 260 }), [], 0)]));
  r.setLayoutWatch(new Set(["tbl000001"]));
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -9999, y: -9999, w: 20000, h: 20000 }, zoom: 1, tier: "detail" });
  while (idleQueue.length) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  const shell = r.shellOf("tbl000001");
  const cell = (uid) => findCell(shell.querySelector(".pxd-roam-table"), uid);
  return { r, stub, layouts, laterQueue, shell, cell, body: shell.querySelector(".pxd-item__body"), done() { r.dispose(); restore(); } };
}

test("cellUidOf reads Roam Grid data-uid and native table input ids, and ignores everything else", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const grid = doc.createElement("div"); grid.className = "rg-cell"; grid.setAttribute("data-uid", "abc123XYZ");
    const inner = doc.createElement("span"); grid.append(inner);
    assert.equal(cellUidOf(inner), "abc123XYZ");
    assert.equal(cellUidOf(grid), "abc123XYZ");
    const bare = doc.createElement("div"); bare.className = "rg-cell";
    assert.equal(cellUidOf(bare), null, "a cell without a uid is not a target");
    assert.equal(cellUidOf(doc.createElement("div")), null);
    assert.equal(cellUidOf(null), null);
    const table = doc.createElement("table"); table.className = "rm-table";
    const td = doc.createElement("td");
    const input = doc.createElement("div"); input.className = "rm-block__input"; input.id = "block-input-g-body-outline-page00001-nat000001";
    td.append(input); table.append(td);
    assert.equal(cellUidOf(input), "nat000001");
    assert.equal(findCell(table, "nat000001"), td);
    const stray = doc.createElement("td"); stray.append(doc.createElement("span"));
    assert.equal(cellUidOf(stray.firstElementChild), null, "a td outside .rm-table is not a cell");
  } finally { restore(); }
});

test("measureCell: card-relative offsets in world px, zoom divides, a missing cell is unrendered", () => {
  const h = tableCardHarness();
  try {
    const table = h.shell.querySelector(".pxd-roam-table");
    h.shell._rect = rect(100, 1000, 480, 260);
    h.body._rect = rect(100, 1030, 480, 230);
    table._rect = rect(100, 1030, 480, 230);
    h.cell("cellAAAA1")._rect = rect(140, 1060, 80, 20);
    const m = measureCell({ card: h.shell, host: table, body: h.body, uid: "cellAAAA1", zoom: 1 });
    assert.deepEqual(m, { bodyTop: 30, bodyBottom: 260, rowTop: 60, rowHeight: 20, rowLeft: 40, rowRight: 120, rendered: true });
    const z = measureCell({ card: h.shell, host: table, body: h.body, uid: "cellAAAA1", zoom: 2 });
    assert.equal(z.rowTop, 30);
    assert.equal(z.rowHeight, 10);
    assert.equal(measureCell({ card: h.shell, host: table, body: h.body, uid: "nope00001" }).rendered, false);
    assert.equal(measureCell({ card: h.shell, host: table, body: h.body, uid: "nope00001" }).rowTop, null);
  } finally { h.done(); }
});

test("measureCell: a cell scrolled out of the table clamps to the card edge with a marker, either axis", () => {
  const h = tableCardHarness();
  try {
    const table = h.shell.querySelector(".pxd-roam-table");
    h.shell._rect = rect(0, 1000, 480, 260);
    h.body._rect = rect(0, 1030, 480, 230);
    table._rect = rect(0, 1030, 480, 230);
    const geo = (uid) => {
      const m = measureCell({ card: h.shell, host: table, body: h.body, uid });
      return blockAnchor({ rect: { x: 0, y: 0, w: 480, h: 260 }, ...m, other: { x: 900, y: 100 } });
    };
    h.cell("cellAAAA1")._rect = rect(10, 1500, 80, 20);
    assert.equal(geo("cellAAAA1").clamped, "bottom", "below the visible rows");
    h.cell("cellBBBB2")._rect = rect(10, 900, 80, 20);
    assert.equal(geo("cellBBBB2").clamped, "top", "above the visible rows");
    h.cell("cellCCCC3")._rect = rect(2000, 1100, 80, 20);
    assert.equal(geo("cellCCCC3").clamped, "top", "scrolled out sideways");
    h.cell("cellCCCC3")._rect = rect(300, 1100, 80, 20);
    assert.equal(geo("cellCCCC3").clamped, null, "back in view");
  } finally { h.done(); }
});

test("measureCell: a scroller between the cell and the card clips the cell", () => {
  const h = tableCardHarness();
  try {
    const table = h.shell.querySelector(".pxd-roam-table");
    const gridRoot = table.querySelector(".rg-root");
    h.shell._rect = rect(0, 1000, 480, 260);
    h.body._rect = rect(0, 1030, 480, 230);
    table._rect = rect(0, 1030, 480, 230);
    gridRoot._rect = rect(0, 1030, 480, 100);
    gridRoot.scrollHeight = 400;
    h.cell("cellAAAA1")._rect = rect(10, 1200, 80, 20);
    const m = measureCell({ card: h.shell, host: table, body: h.body, uid: "cellAAAA1" });
    assert.ok(m.rowTop > m.bodyBottom, "inside the card body but past the grid viewport: reported past the bottom");
    assert.equal(blockAnchor({ rect: { x: 0, y: 0, w: 480, h: 260 }, ...m, other: { x: 900, y: 0 } }).clamped, "bottom");
    h.cell("cellAAAA1")._rect = rect(10, 1060, 80, 20);
    assert.equal(blockAnchor({ rect: { x: 0, y: 0, w: 480, h: 260 }, ...measureCell({ card: h.shell, host: table, body: h.body, uid: "cellAAAA1" }), other: { x: 900, y: 0 } }).clamped, null);
  } finally { h.done(); }
});

test("measureRow on a table card measures cells; markRows and setRowHot use attributes the grid cannot erase", () => {
  const h = tableCardHarness();
  try {
    const table = h.shell.querySelector(".pxd-roam-table");
    h.shell._rect = rect(0, 1000, 480, 260);
    h.body._rect = rect(0, 1030, 480, 230);
    table._rect = rect(0, 1030, 480, 230);
    h.cell("cellBBBB2")._rect = rect(100, 1100, 60, 20);
    assert.equal(h.r.measureRow("tbl000001", "cellBBBB2").rendered, true);
    assert.equal(h.r.measureRow("tbl000001", "nope00001").rendered, false);
    h.r.markRows([{ card: "tbl000001", row: "cellBBBB2", edges: ["e1"], color: "red", tip: "Links to A" }]);
    const cell = h.cell("cellBBBB2");
    assert.equal(cell.getAttribute("data-pxd-edges"), "e1");
    cell.className = "rg-cell rg-cell--header";
    assert.equal(cell.getAttribute("data-pxd-edges"), "e1", "a class rewrite by the grid keeps the mark");
    h.r.setRowHot("tbl000001", "cellBBBB2", true);
    assert.ok(cell.hasAttribute("data-pxd-hot"));
    h.r.setRowHot("tbl000001", "cellBBBB2", false);
    assert.ok(!cell.hasAttribute("data-pxd-hot"));
    h.r.markRows([]);
    assert.ok(!cell.hasAttribute("data-pxd-edges"));
    assert.ok(!cell.hasAttribute("data-pxd-hot"));
  } finally { h.done(); }
});

test("revealRow on a table card scrolls the scrollers to center the cell, flashes it, and reports a missing cell", () => {
  const h = tableCardHarness();
  try {
    const table = h.shell.querySelector(".pxd-roam-table");
    table._rect = rect(0, 1000, 400, 200);
    table.scrollHeight = 900;
    table.scrollWidth = 400;
    table.scrollTop = 0;
    h.body._rect = rect(0, 1000, 400, 200);
    const cell = h.cell("cellAAAA1");
    cell._rect = rect(0, 1500, 80, 20);
    assert.equal(h.r.revealRow("tbl000001", "cellAAAA1"), true);
    assert.equal(table.scrollTop, 410, "cell center 1510 minus view center 1100");
    assert.ok(cell.classList.contains("pxd-row--flash"));
    assert.equal(h.r.revealRow("tbl000001", "gone00001"), false);
    assert.equal(revealCell(null, h.body), false);
  } finally { h.done(); }
});

test("a table card with a block arrow watches its table, re-announces layout once per frame on scroll, and cleans up", () => {
  const h = tableCardHarness();
  try {
    const table = h.shell.querySelector(".pxd-roam-table");
    const scrolls = table.listeners.get("scroll");
    assert.equal(scrolls.size, 1, "one capture scroll listener on the table host");
    h.stub.flushFrames();
    const before = h.layouts.length;
    const fire = [...scrolls.keys()][0];
    fire(); fire(); fire();
    h.stub.flushFrames();
    assert.equal(h.layouts.length, before + 1, "three scrolls in one frame make one layout announcement");
    h.r.setLayoutWatch(new Set());
    assert.equal(table.listeners.get("scroll")?.size ?? 0, 0, "dropping the watch removes the listener");
  } finally { h.done(); }
});

test("watchTable ignores a missing host and returns a working off", () => {
  assert.equal(typeof watchTable({}), "function");
  watchTable({})();
});

function gestureHarness({ target } = {}) {
  const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [
    raw("noteA0001", "a note", plx({ x: 0, y: 0, w: 200, h: 100 }), [], 0),
    raw("tbl000001", TABLE, plx({ x: 400, y: 0, w: 480, h: 260 }), [], 1),
    raw("plain0001", "plain card", plx({ x: 400, y: 400, w: 200, h: 100 }), [], 2),
  ]));
  const rects = worldRects(board);
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const ctl = createInteractions({
    actions: {
      board: () => board,
      rects: () => rects,
      viewport: () => ({ x: 0, y: 0, zoom: 1 }),
      size: () => ({ width: 1000, height: 800 }),
      onSelection: rec("onSelection"),
      onTool: rec("onTool"),
      onHover: rec("onHover"),
      setGesturing: rec("setGesturing"),
      showTempWire: rec("showTempWire"),
      cancelPreview: rec("cancelPreview"),
      blockTarget: (pt) => { calls.push(["blockTarget", pt]); return target ?? null; },
      clearBlockTarget: rec("clearBlockTarget"),
      revealBlockEnd: rec("revealBlockEnd"),
      addEdge: (p) => { calls.push(["addEdge", p]); return Promise.resolve("new1"); },
      updateEdge: rec("updateEdge"),
    },
    settings: { get: () => undefined },
  });
  const ev = (type, world, extra = {}) => ({ type, screen: world, world, client: world, target: { kind: "empty" }, button: 0, buttons: 1, shift: false, alt: false, meta: false, ctrl: false, ...extra });
  const named = (name) => calls.filter((c) => c[0] === name);
  return { ctl, ev, named };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("dropping a new arrow on a table cell writes one addEdge with toBlock = the cell uid", async () => {
  const h = gestureHarness({ target: { uid: "tbl000001", row: "cellBBBB2", header: false, cell: true } });
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "noteA0001", side: "right" } }));
  h.ctl.handle(h.ev("pointermove", { x: 500, y: 100 }));
  assert.equal(h.named("blockTarget").length, 1, "a table card is hit-tested for a cell");
  h.ctl.handle(h.ev("pointerup", { x: 500, y: 100 }));
  await tick();
  assert.deepEqual(h.named("addEdge")[0][1], { from: "noteA0001", to: "tbl000001", fromSide: "right", toSide: "left", toBlock: "cellBBBB2" });
});

test("a drop on a table card but not on a cell connects to the card, and a plain card is never hit-tested for a block", async () => {
  const h = gestureHarness({ target: { uid: "tbl000001", row: null, header: false, cell: false } });
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "noteA0001", side: "right" } }));
  h.ctl.handle(h.ev("pointermove", { x: 500, y: 100 }));
  h.ctl.handle(h.ev("pointerup", { x: 500, y: 100 }));
  await tick();
  assert.equal("toBlock" in h.named("addEdge")[0][1], false);
  const p = gestureHarness({ target: { uid: "plain0001", row: null, header: false } });
  p.ctl.handle(p.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "noteA0001", side: "right" } }));
  p.ctl.handle(p.ev("pointermove", { x: 500, y: 450 }));
  assert.equal(p.named("blockTarget").length, 0);
});
