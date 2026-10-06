import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, diffBoards, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createRowScheduler, mountFpsFromStamps } from "../src/view/progressive.js";
import { MAIN_IDLE_LONG_TASK_MS, SIDEBAR_BOARD_LONG_TASK_MS, SIDEBAR_PARKED_LONG_TASK_MS } from "../tools/live/perf-gate.mjs";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const blk = (uid, string, plexus, order) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": [],
});

const rawBoard = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});

const visible = { x: 0, y: 0, w: 1000, h: 800 };

function renderer({ children, hostOverrides = {}, clock = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = { renderString: [], renderBlock: [] };
  const host = {
    stats: {},
    renderString(node, string) {
      calls.renderString.push(string);
      if (clock) clock.advance();
      node.textContent = string;
    },
    renderBlock(node, uid) {
      calls.renderBlock.push(uid);
      if (clock) clock.advance();
      node.textContent = uid;
    },
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
    ...hostOverrides,
  };
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const frameQueue = [];
  const timers = {
    idle(fn) {
      idleQueue.push(fn);
      return () => {
        const i = idleQueue.indexOf(fn);
        if (i >= 0) idleQueue.splice(i, 1);
      };
    },
    frame(fn) {
      frameQueue.push(fn);
      return () => {
        const i = frameQueue.indexOf(fn);
        if (i >= 0) frameQueue.splice(i, 1);
      };
    },
    later() { return () => {}; },
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const board = buildBoard(rawBoard(children));
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const pump = () => {
    const fn = idleQueue.shift();
    assert.ok(fn, "a content pump was queued");
    fn({ timeRemaining: () => 100 });
  };
  const show = (dirty) => {
    r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail", ...(dirty === undefined ? {} : { dirty }) });
  };
  return {
    stub, host, calls, r, board, idleQueue, frameQueue, pump, show,
    done() { r.dispose(); restore(); },
  };
}

test("FAST-8: an 8 ms clock mounts one row per pump, light and nearest first", () => {
  const order = [];
  const idleQueue = [];
  let clock = 0;
  const s = createRowScheduler({
    idle: (fn) => { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    now: () => clock,
    budgetMs: 8,
    render: (id) => { order.push(id); clock += 8; },
  });
  // Heavy card sits on the centre. It still waits until every light card has mounted.
  s.place("farLight", { near: 400, wanted: true });
  s.place("nearHeav", { heavy: true, near: 0, wanted: true });
  s.place("nearLite", { near: 10, wanted: true });
  assert.equal(idleQueue.length, 1);
  idleQueue.shift()({ timeRemaining: () => 100 });
  assert.deepEqual(order, ["nearLite"]);
  assert.equal(idleQueue.length, 1, "the rest continues on the next pump");
  idleQueue.shift()({ timeRemaining: () => 100 });
  assert.deepEqual(order, ["nearLite", "farLight"]);
  idleQueue.shift()({ timeRemaining: () => 100 });
  assert.deepEqual(order, ["nearLite", "farLight", "nearHeav"]);
  assert.equal(s.pending(), 0);
  assert.equal(idleQueue.length, 0);
  s.want("nearLite", true);
  assert.equal(idleQueue.length, 0, "a finished uid is not mounted again");
  s.reopen("farLight", { near: 400 });
  idleQueue.shift()({ timeRemaining: () => 100 });
  assert.deepEqual(order, ["nearLite", "farLight", "nearHeav", "farLight"]);
});

test("FAST-8: mountFps is the median rAF delta", () => {
  assert.equal(mountFpsFromStamps([0, 20, 40]), 50);
  assert.equal(mountFpsFromStamps([16]), null);
  assert.equal(mountFpsFromStamps([0, 0, 0]), null);
  assert.equal(mountFpsFromStamps([]), null);
});

test("FAST-8: a card body stops at 8 ms and the nearest light card mounts first", () => {
  const prev = globalThis.performance;
  const clock = { t: 0, advance() { this.t += 8; } };
  globalThis.performance = { now: () => clock.t };
  const h = renderer({
    clock,
    children: [
      blk("farLight1", "far", { ":x": 20, ":y": 20, ":w": 160, ":h": 100 }, 0),
      blk("nearHeav1", "{{[[query]]: {and: [[A]]}}}", { ":x": 470, ":y": 360, ":w": 160, ":h": 100 }, 1),
      blk("nearL0001", "near", { ":x": 420, ":y": 340, ":w": 160, ":h": 100 }, 2),
    ],
  });
  try {
    h.show(null);
    assert.equal(h.calls.renderString.length, 0);
    assert.equal(h.calls.renderBlock.length, 0);
    h.pump();
    assert.deepEqual(h.calls.renderString, ["near"]);
    assert.deepEqual(h.calls.renderBlock, []);
    h.pump();
    assert.deepEqual(h.calls.renderString, ["near", "far"]);
    h.pump();
    assert.deepEqual(h.calls.renderBlock, ["nearHeav1"]);
    assert.equal(h.idleQueue.length, 0);
  } finally {
    globalThis.performance = prev;
    h.done();
  }
});

test("FAST-8: a second diff that dirties one uid calls renderBlock for that uid only", () => {
  const uids = ["qryA00001", "qryB00002", "qryC00003"];
  const query = (name) => `{{[[query]]: {and: [[${name}]]}}}`;
  const children = (names) => names.map((name, i) => blk(
    uids[i],
    query(name),
    { ":x": 40 + i * 200, ":y": 40, ":w": 160, ":h": 100 },
    i,
  ));
  const h = renderer({ children: children(["A", "B", "C"]) });
  try {
    h.show(null);
    while (h.idleQueue.length) h.pump();
    // All three are heavy, so the only order is distance to the viewport centre.
    assert.deepEqual(h.calls.renderBlock, ["qryC00003", "qryB00002", "qryA00001"]);
    const first = h.board;
    const second = buildBoard(rawBoard(children(["A", "B2", "C"])));
    const diff = diffBoards(first, second);
    assert.equal(diff.dirty.size, 1);
    assert.equal(diff.dirty.has("qryB00002"), true);
    h.r.sync({ board: second, rects: worldRects(second), dirty: diff.dirty, structural: diff.structural });
    assert.deepEqual(h.calls.renderBlock, ["qryC00003", "qryB00002", "qryA00001"], "sync does not mount");
    h.show(diff.dirty);
    while (h.idleQueue.length) h.pump();
    assert.deepEqual(h.calls.renderBlock, ["qryC00003", "qryB00002", "qryA00001", "qryB00002"]);
    assert.equal(h.calls.renderString.length, 0);
    const before = h.calls.renderBlock.length;
    h.show(new Set());
    while (h.idleQueue.length) h.pump();
    assert.equal(h.calls.renderBlock.length, before, "an empty dirty set does not mount again");
  } finally {
    h.done();
  }
});

test("FAST-8: open reports mountFps from rAF timestamps with speed-log off", () => {
  const prev = globalThis.performance;
  const clock = { t: 0, advance() { this.t += 8; } };
  globalThis.performance = { now: () => clock.t };
  const h = renderer({
    clock,
    children: [
      blk("note00001", "one", { ":x": 420, ":y": 340, ":w": 160, ":h": 100 }, 0),
      blk("note00002", "two", { ":x": 20, ":y": 20, ":w": 160, ":h": 100 }, 1),
    ],
  });
  try {
    assert.equal(h.host.stats.perf, undefined);
    h.show(null);
    assert.equal(h.frameQueue.length, 1);
    h.pump();
    assert.deepEqual(h.calls.renderString, ["one"]);
    h.frameQueue.shift()(0);
    assert.equal(h.host.stats.mountFps, undefined);
    h.pump();
    assert.deepEqual(h.calls.renderString, ["one", "two"]);
    assert.equal(h.idleQueue.length, 0);
    h.frameQueue.shift()(20);
    assert.equal(h.host.stats.mountFps, 50);
    assert.equal(h.frameQueue.length, 0);
  } finally {
    globalThis.performance = prev;
    h.done();
  }
});

test("FAST-8: a paused renderer does not mount card bodies", () => {
  const h = renderer({
    children: [blk("note00001", "one", { ":x": 40, ":y": 40, ":w": 160, ":h": 100 }, 0)],
  });
  try {
    h.r.setPaused(true);
    h.show(null);
    assert.equal(h.idleQueue.length, 0);
    assert.equal(h.calls.renderString.length, 0);
    h.r.setPaused(false);
    assert.equal(h.idleQueue.length, 1);
    h.pump();
    assert.deepEqual(h.calls.renderString, ["one"]);
  } finally {
    h.done();
  }
});

test("FAST-8: a pan writes the world transform and does not mount bodies", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const raw = rawBoard([
    blk("note00001", "one", { ":x": 40, ":y": 40, ":w": 160, ":h": 100 }, 0),
    blk("note00002", "two", { ":x": 240, ":y": 40, ":w": 160, ":h": 100 }, 1),
  ]);
  const board = buildBoard(raw);
  const calls = { renderString: 0, renderBlock: 0 };
  const host = {
    stats: {},
    graph: "Svy",
    renderString(el, string) { calls.renderString += 1; el.textContent = string; },
    renderBlock(el, uid) { calls.renderBlock += 1; el.textContent = uid; },
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
  };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on() { return () => {}; },
    release() {},
    setLinkMode() {},
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "1.0.0",
  });
  try {
    stub.flushFrames();
    const world = view.root.querySelector(".pxd-world");
    const before = world.style.transform;
    assert.equal(calls.renderString, 0);
    assert.equal(calls.renderBlock, 0);
    const viewport = view.root.querySelector(".pxd-viewport");
    stub.dispatch(viewport, "pointerdown", { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    stub.dispatch(stub.document, "pointermove", { clientX: 160, clientY: 120, pointerId: 1 });
    stub.flushFrames();
    stub.flushIdle();
    assert.notEqual(world.style.transform, before);
    assert.match(world.style.transform, /translate\(60px, 20px\)/);
    assert.equal(calls.renderString, 0, "a pan frame does not mount bodies");
    assert.equal(calls.renderBlock, 0);
    stub.dispatch(stub.document, "pointerup", { clientX: 160, clientY: 120, pointerId: 1 });
    await tick(140);
    stub.flushFrames();
    stub.flushIdle();
    stub.flushFrames();
    assert.ok(calls.renderString > 0, "bodies mount after the gesture settles");
  } finally {
    view.dispose();
    restore();
  }
});

test("FAST-8: the view passes one dirty uid through to renderBlock", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const query = (name) => `{{[[query]]: {and: [[${name}]]}}}`;
  const raw = rawBoard([
    blk("qryView01", query("A"), { ":x": 40, ":y": 40, ":w": 160, ":h": 100 }, 0),
    blk("qryView02", query("B"), { ":x": 240, ":y": 40, ":w": 160, ":h": 100 }, 1),
  ]);
  const board = buildBoard(raw);
  const blocks = [];
  const host = {
    stats: {},
    graph: "Svy",
    renderString() {},
    renderBlock(el, uid) { blocks.push(uid); el.textContent = uid; },
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
  };
  const handlers = new Map();
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of handlers.get(name) || []) fn(payload); },
    release() {},
    setLinkMode() {},
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "1.0.0",
  });
  try {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
    assert.deepEqual(blocks, ["qryView02", "qryView01"]);
    board.items.get("qryView02").string = query("B2");
    session.emit("change", { dirty: new Set(["qryView02"]), structural: false });
    stub.flushFrames();
    stub.flushIdle();
    assert.deepEqual(blocks, ["qryView02", "qryView01", "qryView02"]);
  } finally {
    view.dispose();
    restore();
  }
});

test("FAST-8: PERF-8 long-task ceilings stay at 350 ms", () => {
  assert.equal(MAIN_IDLE_LONG_TASK_MS, 350);
  assert.equal(SIDEBAR_BOARD_LONG_TASK_MS, 350);
  assert.equal(SIDEBAR_PARKED_LONG_TASK_MS, 350);
});
