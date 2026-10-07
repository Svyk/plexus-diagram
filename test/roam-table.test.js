import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import {
  TABLE_ROOT,
  TABLE_SIZE,
  TABLE_WRITES,
  appendTable,
  createKeyOwner,
  escapeKeeps,
  isRoamTableString,
  keyGate,
  ownershipOf,
  planTableCreates,
} from "../src/model/roam-table.js";
import { mountRoamTable, syncTableZoom, tableCounterStyle } from "../src/view/table-card.js";
import { createItemRenderer } from "../src/view/cards.js";
import { mountBoardView } from "../src/view/board-view.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createHost } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";

afterEach(() => resetSessions());

const KEYS = ["F2", "Enter", "Escape", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a"];

test("isRoamTableString accepts a table macro and rejects everything else", () => {
  for (const value of ["{{[[table]]}}", "{{table}}", "{{ table }}", "{{[[TABLE]]}}", "  {{[[table]]}}  "]) {
    assert.equal(isRoamTableString(value), true, value);
  }
  for (const value of ["{{[[diagram]]}}", "{{[[table]]}} extra", "table", "{{[[TODO]]}}", "", null]) {
    assert.equal(isRoamTableString(value), false, String(value));
  }
});

test("planTableCreates is one 3x3 of empty cells under {{[[table]]}}, columns nested", () => {
  const plan = planTableCreates();
  assert.equal(plan.writes, TABLE_WRITES);
  assert.equal(plan.writes, 10);
  assert.equal(plan.ops[0].string, "{{[[table]]}}");
  const rows = plan.ops.filter((op) => op.parent === plan.root);
  assert.equal(rows.length, 3);
  rows.forEach((row, index) => {
    assert.equal(row.string, "");
    assert.equal(row.order, index);
    // Roam reads a row as a chain: each cell's single child is the next column.
    let cell = row;
    for (let col = 1; col < 3; col += 1) {
      const kids = plan.ops.filter((op) => op.parent === cell.uid);
      assert.equal(kids.length, 1);
      cell = kids[0];
      assert.equal(cell.string, "");
    }
    assert.equal(plan.ops.filter((op) => op.parent === cell.uid).length, 0);
  });
  assert.equal(plan.ops.length, 10);
});

test("keyboard ownership yields only while it is verified and Escape keeps the source bytes", () => {
  const stub = createDomStub();
  const board = stub.document.createElement("div");
  board.className = "pxd-root";
  const grid = stub.document.createElement("div");
  grid.className = "rg-root";
  grid.setAttribute("data-roam-grid-uid", "grid0001");
  const host = stub.document.createElement("div");
  host.className = "pxd-roam-table";
  host.setAttribute("data-pxd-table", "table0001");
  host.append(grid);
  board.append(host);
  const outside = stub.document.createElement("textarea");
  const portal = stub.document.createElement("div");
  portal.className = "rg-portal";
  portal.setAttribute("data-rg-owner", "grid0001");
  const stranger = stub.document.createElement("div");
  stranger.className = "rg-portal";
  stranger.setAttribute("data-rg-owner", "other0001");
  const source = "{{[[table]]}}";
  const owner = createKeyOwner();
  owner.claim("grid0001", source);
  assert.equal(owner.release("nope") ?? owner.owns("grid0001"), true);
  const owned = ownershipOf({ active: grid, boardRoot: board, sourceText: owner.sourceText() });
  assert.equal(owned.verified, true);
  for (const key of KEYS) {
    const gate = keyGate({ key }, owned);
    assert.equal(gate.yield, true, key);
    assert.equal(gate.sourceText, source);
    if (key === "Escape") {
      assert.equal(gate.reason, "escape");
      assert.equal(escapeKeeps(source, gate.sourceText), true);
    }
  }
  assert.equal(source, "{{[[table]]}}");
  const hovered = ownershipOf({ active: outside, pointerTarget: grid, boardRoot: board, sourceText: source });
  assert.equal(hovered.verified, false);
  assert.equal(keyGate({ key: "a" }, hovered).yield, false);
  const portaled = ownershipOf({ active: portal, boardRoot: board, sourceText: source });
  assert.equal(portaled.verified, true);
  assert.equal(portaled.reason, "portal");
  assert.equal(keyGate({ key: "ArrowLeft" }, portaled).yield, true);
  const foreign = ownershipOf({ active: stranger, boardRoot: board, sourceText: source });
  assert.equal(foreign.verified, false);
  owner.release("grid0001");
  assert.equal(owner.owns("grid0001"), false);
  const released = owner.owns("grid0001")
    ? ownershipOf({ active: grid, boardRoot: board, sourceText: owner.sourceText() })
    : { verified: false, sourceText: source };
  assert.equal(keyGate({ key: "ArrowLeft" }, released).yield, false);
  assert.equal(escapeKeeps(source, source), true);
});

test("appendTable writes ten creates and nothing else", () => {
  const ops = [];
  const t = {
    create(spec) {
      const uid = `id${ops.length}`;
      ops.push(spec);
      return uid;
    },
  };
  const root = appendTable(t, { parent: "board", plexus: { x: 1, y: 2, w: 3, h: 4 } });
  assert.equal(root, "id0");
  assert.equal(ops.length, 10);
  assert.equal(ops[0].string, "{{[[table]]}}");
  assert.deepEqual(ops[0].plexus, { x: 1, y: 2, w: 3, h: 4 });
  assert.equal(ops.slice(1).every((op) => op.string === "" && op.plexus === undefined), true);
});

test("mountRoamTable renders the block once, counter-scales a grid, and opens at board scale", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const world = doc.createElement("div");
    world.className = "pxd-world";
    root.append(world);
    doc.body.append(root);
    const calls = [];
    const host = mountRoamTable(doc, world, {
      uid: "table0001",
      zoom: 2,
      portalParent: root,
      renderBlock(el, uid) { calls.push(uid); el.dataset.rendered = uid; },
      unmount(el) { el.dataset.unmounted = "1"; },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0], "table0001");
    assert.equal(host.querySelectorAll(".pxd-rs__live").length, 1);
    assert.equal(host.classList.contains("pxd-roam-table--grid"), false);
    assert.equal(host.querySelector(".pxd-roam-table__fit").style.transform || "", "");
    const grid = doc.createElement("div");
    grid.className = "rg-root";
    grid.setAttribute("data-roam-grid-uid", "grid0001");
    host.querySelector(".pxd-rs__live").append(grid);
    stub.flushMutations();
    assert.equal(host.classList.contains("pxd-roam-table--grid"), true);
    const fit = host.querySelector(".pxd-roam-table__fit");
    assert.match(fit.style.transform, /scale\(/);
    assert.equal(fit.style.width, "200%");
    syncTableZoom(1);
    assert.equal(fit.style.transform || "", "");
    syncTableZoom(2);
    assert.equal(fit.style.width, "200%");
    assert.match(fit.style.transform, /scale\(0\.5\)/);
    assert.equal(tableCounterStyle(1), null);
    host.querySelector(".pxd-roam-table__open").click();
    const overlay = root.querySelector(".pxd-table-overlay");
    assert.ok(overlay);
    assert.equal(overlay.parentElement, root);
    assert.equal(world.querySelector(".pxd-table-overlay"), null);
    assert.equal(calls.length, 2);
    const escape = stub.dispatch(stub.window, "keydown", { key: "Escape" });
    assert.equal(escape.defaultPrevented, false);
    assert.equal(root.querySelector(".pxd-table-overlay"), null);
    assert.equal(calls.length, 2);
    host.__pxdEmbedMo.disconnect();
    syncTableZoom(4);
    assert.equal(fit.style.width, "200%");
  } finally {
    restore();
  }
});

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});

function cardHarness(children, hostOverrides = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = [];
  const host = {
    renderString(node, string) { node.textContent = string; },
    renderBlock(el, uid) { calls.push(uid); el.dataset.rendered = uid; },
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
    ...hostOverrides,
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const r = createItemRenderer({
    doc,
    host,
    session: {},
    itemsLayer,
    sectionsLayer,
    timers: { idle(fn) { idleQueue.push(fn); return () => {}; }, later(fn) { fn(); return () => {}; } },
  });
  const raw = {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
  const board = buildBoard(raw);
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 40) idleQueue.shift()({ timeRemaining: () => 20, didTimeout: false });
  };
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -1000, y: -1000, w: 8000, h: 8000 }, zoom: 1, tier: "detail" });
  flush();
  return { stub, r, calls, flush, done() { r.dispose(); restore(); } };
}

test("a table card mounts renderBlock and does not flatten its rows", () => {
  const h = cardHarness([
    blk("table0001", "{{[[table]]}}", { ":x": 0, ":y": 0, ":w": 480, ":h": 260, ":kids": true }, 0, [
      blk("rowleak01", "ROW-LEAK", {}, 0, [blk("cellleak1", "CELL-LEAK", {}, 0)]),
    ]),
  ]);
  try {
    const shell = h.r.shellOf("table0001");
    assert.ok(shell.querySelector(".pxd-roam-table"));
    assert.equal(shell.classList.contains("pxd-item--roam-table"), true);
    assert.deepEqual(h.calls, ["table0001"]);
    assert.equal(shell.textContent.includes("ROW-LEAK"), false);
    assert.equal(shell.textContent.includes("CELL-LEAK"), false);
    assert.equal(shell.querySelector(".pxd-kids"), null);
  } finally {
    h.done();
  }
});

test("a nested table mounts that block and leaves the sibling text", () => {
  const h = cardHarness([
    blk("note00001", "Keep me", { ":x": 0, ":y": 0, ":w": 280, ":h": 200, ":kids": true }, 0, [
      blk("nesttab01", "{{table}}", {}, 0, [blk("nestleak1", "NEST-LEAK", {}, 0)]),
      blk("sibling01", "Still here", {}, 1),
    ]),
  ]);
  try {
    const shell = h.r.shellOf("note00001");
    assert.equal(shell.classList.contains("pxd-item--roam-table"), false);
    assert.ok(shell.querySelector(".pxd-roam-table"));
    assert.deepEqual(h.calls, ["nesttab01"]);
    assert.match(shell.textContent, /Keep me/);
    assert.match(shell.textContent, /Still here/);
    assert.equal(shell.textContent.includes("NEST-LEAK"), false);
  } finally {
    h.done();
  }
});

test("a block ref of a table mounts the referenced block", () => {
  const h = cardHarness([
    blk("refcard01", "((target01))", { ":x": 0, ":y": 0, ":w": 280, ":h": 160 }, 0),
  ], { blockString: (uid) => (uid === "target01" ? "{{[[table]]}}" : null), pullTree: () => [] });
  try {
    const shell = h.r.shellOf("refcard01");
    assert.equal(shell.classList.contains("pxd-item--roam-table"), true);
    assert.deepEqual(h.calls, ["target01"]);
  } finally {
    h.done();
  }
});

test("a page outline row that is a table does not emit its children", () => {
  const h = cardHarness([
    blk("pagecard1", "[[Tables]]", { ":x": 0, ":y": 0, ":w": 360, ":h": 480 }, 0),
  ], {
    pageOutline: () => ({
      exists: true,
      title: "Tables",
      uid: "pageuid01",
      blocks: [{
        uid: "outtable1",
        string: "{{[[table]]}}",
        children: [{ uid: "outleak01", string: "OUT-LEAK", children: [] }],
      }],
    }),
  });
  try {
    h.flush();
    const shell = h.r.shellOf("pagecard1");
    assert.ok(shell.querySelector(".pxd-roam-table"));
    assert.deepEqual(h.calls, ["outtable1"]);
    assert.equal(shell.textContent.includes("OUT-LEAK"), false);
    assert.equal(shell.classList.contains("pxd-item--roam-table"), false);
  } finally {
    h.done();
  }
});

test("createTable is one undo of ten writes and a 3x3 of empty cells", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "note", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      {
        uid: "s1",
        string: "Group",
        props: { plexus: { type: "section", x: 0, y: 300, w: 500, h: 300 } },
        children: [],
      },
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  const uid = await session.createTable({ x: 2000, y: 2000 });
  assert.equal(fake.block(uid).string, "{{[[table]]}}");
  const rows = fake.children(uid);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(fake.block(row).string, "");
    let cell = row;
    for (let col = 1; col < 3; col += 1) {
      const kids = fake.children(cell);
      assert.equal(kids.length, 1);
      cell = kids[0];
      assert.equal(fake.block(cell).string, "");
    }
    assert.equal(fake.children(cell).length, 0);
  }
  const writes = fake.writesLog();
  assert.equal(writes.length, 10);
  assert.equal(writes.every((row) => row[0] === "create"), true);
  assert.equal(host.stats.lastAction.writes, 10);
  const blob = JSON.stringify(fake.props(uid));
  assert.equal(blob.includes(":diagram"), false);
  assert.equal(blob.includes("BT_attr"), false);
  assert.equal(TABLE_SIZE.w, 480);
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 10);
});

test("a focused grid inside a card keeps board keys and the wheel", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const item = (uid, string, plexus, order, children = []) => ({
      ":block/uid": uid,
      ":block/string": string,
      ":block/order": order,
      ":block/props": plexus ? { ":plexus": plexus } : {},
      ":block/children": children,
    });
    const tree = {
      ":block/uid": "board0001",
      ":block/string": "{{[[diagram]]:Test}}",
      ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": [
        item("table0001", "{{[[table]]}}", { ":x": 0, ":y": 0, ":w": 480, ":h": 260 }, 0, [
          item("rowleak01", "ROW-LEAK", {}, 0, [item("cellleak1", "CELL-LEAK", {}, 0)]),
        ]),
      ],
    };
    const board = buildBoard(tree);
    const mutations = [];
    const session = {
      uid: board.uid,
      board,
      rects: worldRects(board),
      links: [],
      coveredEdges: new Set(),
      busy: false,
      mutations,
      on() { return () => {}; },
      emit() {},
      handlerCount: () => 0,
      release() {},
      setLinkMode() {},
      setString: (...args) => { mutations.push(["setString", ...args]); return Promise.resolve(); },
      createCard: () => Promise.resolve("x"),
      createTable: () => Promise.resolve("x"),
      undo: () => Promise.resolve(),
      redo: () => Promise.resolve(),
    };
    const host = {
      graph: "Svy",
      renderString(el, string) { el.textContent = string; },
      renderBlock(el) {
        const input = stub.document.createElement("textarea");
        input.className = "rm-block__input";
        el.append(input);
      },
      renderPage() {},
      unmount() {},
      blockString: () => null,
      pullTree: () => [],
      pagePreview: () => ({ exists: false, blocks: [] }),
      openBlock() {},
      openInSidebar() {},
    };
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
    const flush = async () => {
      stub.flushFrames();
      await new Promise((r) => setTimeout(r, 0));
      stub.flushIdle();
      stub.flushFrames();
    };
    for (let i = 0; i < 8; i += 1) await flush();
    const live = view.root.querySelector(".pxd-roam-table .pxd-rs__live");
    assert.ok(live);
    assert.equal(view.root.textContent.includes("ROW-LEAK"), false);
    const grid = stub.document.createElement("div");
    grid.className = "rg-root";
    grid.setAttribute("data-roam-grid-uid", "grid0001");
    live.append(grid);
    stub.flushMutations();
    grid.focus();
    for (const key of KEYS) {
      const ev = stub.dispatch(grid, "keydown", { key, code: key === "a" ? "KeyA" : key });
      assert.equal(ev.defaultPrevented, false, key);
    }
    assert.equal(mutations.some((row) => row[0] === "setString"), false);
    const down = stub.dispatch(grid, "pointerdown", { button: 0, clientX: 8, clientY: 8 });
    assert.equal(down.defaultPrevented, false);
    const wheel = stub.dispatch(grid, "wheel", { deltaY: 12 });
    assert.equal(wheel.defaultPrevented, false);
    view.dispose();
  } finally {
    restore();
  }
});
