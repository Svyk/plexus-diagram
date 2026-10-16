// D1. The board search haystack is built once, in idle slices, never on a key.
// Cmd+F and the search field both call searchFilter, and that is the only hayOf caller.
import assert from "node:assert/strict";
import test from "node:test";

import { BG_QUIET_MS, createBgBudget, resetSharedBgBudget } from "../src/bg-budget.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { HAY_SLICE_MS, createHayIndex, findOnBoard, scheduleHayIndex } from "../src/model/find.js";
import { noteSpeedFlags } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

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

function card(uid, string, order, children = []) {
  return blk(uid, string, { ":x": (order % 40) * 30, ":y": Math.floor(order / 40) * 30, ":w": 200, ":h": 80 }, order, children);
}

function bigBoard() {
  const children = [];
  for (let i = 0; i < 1564; i += 1) {
    if (i === 3) children.push(card("c3", "((target001))", i));
    else if (i === 42) children.push(card("c42", "needle quartz in the hay", i));
    else children.push(card(`c${i}`, `card ${i} filler text`, i));
  }
  return buildBoard(rawBoard(children));
}

const resolveRef = (uid) => (uid === "target001" ? "Resolved first line\nsecond line" : null);

function clockHarness() {
  let t = 10000;
  const idleQ = [];
  const timers = [];
  const listeners = new Map();
  const win = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const now = () => {
    t += 1;
    return t;
  };
  const budget = createBgBudget({
    win,
    now,
    ric: (fn) => { idleQ.push(fn); return idleQ.length; },
    cic: () => {},
    setTimer: (fn, ms) => { const e = { at: t + ms, fn }; timers.push(e); return e; },
    clearTimer: (e) => { const i = timers.indexOf(e); if (i >= 0) timers.splice(i, 1); },
  });
  return {
    budget,
    now,
    idle() {
      const start = t;
      const list = idleQ.splice(0);
      for (const fn of list) fn({ didTimeout: false, timeRemaining: () => Math.max(0, 50 - (t - start)) });
      return list.length;
    },
    wait(ms) {
      t += ms;
      const due = timers.splice(0);
      for (const e of due) { if (e.at <= t) e.fn(); else timers.push(e); }
    },
    input(type = "keydown") { listeners.get(type)?.({ type }); },
  };
}

function finish(ix) {
  let guard = 0;
  while (!ix.ready() && guard < 20000) {
    guard += 1;
    ix.step();
  }
  assert.equal(ix.ready(), true, "the hay index finished");
}

function snapshotBoard() {
  const board = buildBoard(rawBoard([
    card("cardAAAA1", "Alpha", 0, [
      { ":block/uid": "kidAAAA01", ":block/string": "child pebble", ":block/order": 0 },
    ]),
    blk("sectCCCC3", "Evidence", { ":type": "section", ":x": 0, ":y": 200, ":w": 400, ":h": 200 }, 1),
    card("ref00001", "((target001))", 2),
    card("img00001", "![sunset over the bay](https://example.test/a.png)", 3),
    blk("nestCARD9", "{{[[diagram]]:Inner}}", { ":x": 800, ":y": 0, ":w": 220, ":h": 120 }, 4),
    blk("edgesEEE5", "Connections", { ":type": "edges" }, 5, [
      blk("edgeFFFF6", "((cardAAAA1)) → causes → [[Evidence]]", { ":type": "edge", ":from": "cardAAAA1", ":to": "sectCCCC3" }, 0),
    ]),
  ]));
  const child = buildBoard(rawBoard([
    card("deepCARD1", "nested quartz", 0),
  ]));
  child.uid = "nestCARD9";
  const deeper = buildBoard({
    ":block/uid": "deep0001",
    ":block/string": "{{[[diagram]]:Deep}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [card("secret001", "hidden garnet", 0)],
  });
  return { board, nested: [{ parentUid: "nestCARD9", board: child }], deeper, child };
}

test("the hay index builds in slices of at most 8 ms and a key does not index", () => {
  assert.equal(HAY_SLICE_MS, 8);
  const board = bigBoard();
  const h = clockHarness();
  const ix = createHayIndex({ resolve: resolveRef, now: h.now });
  ix.note(board, []);
  const beforeOpen = ix.stats().hayBuilds;
  const stop = scheduleHayIndex(ix, { budget: h.budget, now: h.now });
  assert.equal(ix.stats().hayBuilds, beforeOpen, "scheduling the index built hay on the open");
  assert.equal(ix.ready(), false);
  const beforeFind = ix.stats().hayBuilds;
  ix.find(board, "needle");
  assert.equal(ix.stats().hayBuilds, beforeFind, "a search before the index is built still walks cards");

  const slices = [];
  let guard = 0;
  while (!ix.ready() && guard < 8000) {
    guard += 1;
    const calls = ix.stats().sliceCalls;
    const built = ix.stats().hayBuilds;
    const ran = h.idle();
    if (!ran) {
      h.wait(BG_QUIET_MS + 80);
      continue;
    }
    const steps = ix.stats().sliceCalls - calls;
    const posted = ix.stats().hayBuilds - built;
    if (posted > 0) {
      slices.push(posted);
      assert.equal(steps, 1, "one budget slice indexed once");
      assert.ok(ix.stats().lastSliceMs <= HAY_SLICE_MS, `slice took ${ix.stats().lastSliceMs} ms`);
    }
    if (!ix.ready()) h.wait(80);
  }
  assert.equal(ix.ready(), true);
  assert.ok(slices.length >= 3, `expected several slices, saw ${slices.length}`);
  const total = slices.reduce((sum, n) => sum + n, 0);
  assert.ok(slices.every((n) => n < total), "one slice indexed every row");
  assert.equal(ix.stats().resolveCalls, 1, "the block ref was resolved once during the build");
  const resolved = ix.stats().resolveCalls;
  const hit = ix.find(board, "needle");
  assert.deepEqual(hit.map((row) => row.uid), ["c42"]);
  assert.equal(ix.stats().resolveCalls, resolved, "the keystroke resolved a block");
  assert.deepEqual(ix.find(board, "second line").map((row) => row.uid), ["c3"]);

  const more = bigBoard();
  const ix2 = createHayIndex({ resolve: resolveRef, now: h.now });
  ix2.note(more, []);
  scheduleHayIndex(ix2, { budget: h.budget, now: h.now });
  h.input("keydown");
  const paused = ix2.stats().hayBuilds;
  h.idle();
  assert.equal(ix2.stats().hayBuilds, paused, "a keydown slice still indexed");
  stop();
});

test("a string edit, an add, and a delete refresh only that item", () => {
  const board = buildBoard(rawBoard([
    card("a", "alpha stone", 0),
    card("b", "beta stone", 1),
    card("c", "gamma stone", 2),
  ]));
  const ix = createHayIndex({ resolve: () => null });
  ix.note(board, []);
  finish(ix);
  const built = ix.stats().hayBuilds;
  assert.equal(built, 3);
  const beta = ix.find(board, "beta");

  board.items.get("a").string = "alpha renamed quartz";
  board.items.get("a").title = "alpha renamed quartz";
  ix.touch(board, new Set(["a"]), false);
  finish(ix);
  assert.equal(ix.stats().hayBuilds, built + 1, "a string edit rebuilt every card");
  assert.deepEqual(ix.find(board, "beta"), beta);
  assert.deepEqual(ix.find(board, "quartz").map((row) => row.uid), ["a"]);

  board.items.get("b").x += 40;
  ix.touch(board, new Set(["b"]), false);
  finish(ix);
  assert.equal(ix.stats().hayBuilds, built + 1, "a move rebuilt hay");

  board.items.delete("c");
  ix.touch(board, new Set(["c"]), true);
  finish(ix);
  assert.equal(ix.stats().hayBuilds, built + 1, "a delete rebuilt the other cards");
  assert.equal(ix.find(board, "gamma").length, 0);

  board.items.set("d", {
    uid: "d", type: "card", kind: "note", string: "delta zeolite", title: "delta zeolite",
    target: { kind: "self", uid: "d" }, content: [],
  });
  ix.touch(board, new Set(["d"]), true);
  finish(ix);
  assert.equal(ix.stats().hayBuilds, built + 2, "an add rebuilt more than the new card");
  assert.deepEqual(ix.find(board, "zeolite").map((row) => row.uid), ["d"]);
});

test("a 1564-card keystroke stays under 5 ms and matches findOnBoard", () => {
  const board = bigBoard();
  let calls = 0;
  const ix = createHayIndex({
    resolve: (uid) => { calls += 1; return resolveRef(uid); },
  });
  ix.note(board, []);
  finish(ix);
  const before = calls;
  const t0 = performance.now();
  const hit = ix.find(board, "needle");
  const ms = performance.now() - t0;
  assert.deepEqual(hit.map((row) => row.uid), ["c42"]);
  assert.ok(ms < 5, `keystroke took ${ms} ms`);
  assert.equal(calls, before, "find() called resolve");

  const { board: snap, nested, deeper, child } = snapshotBoard();
  const queries = ["pebble", "evidence", "causes", "second line", "sunset", "quartz", "garnet", "alpha", "   "];
  const indexed = createHayIndex({ resolve: resolveRef });
  indexed.note(snap, nested);
  finish(indexed);
  for (const q of queries) {
    assert.deepEqual(indexed.find(snap, q), findOnBoard(snap, q, nested, resolveRef), q);
  }
  assert.equal(findOnBoard(child, "garnet", [{ parentUid: "deepCARD1", board: deeper }]).length, 1);
  assert.equal(indexed.find(null, "alpha").length, 0);
});

function mountSearch({ flag = true } = {}) {
  resetSharedBgBudget();
  noteSpeedFlags(flag ? null : { searchHay: false });
  const stub = createDomStub();
  const restore = stub.install();
  const nested = {
    ":block/uid": "nestCARD9",
    ":block/string": "{{[[diagram]]:Inner}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [blk("deepCARD1", "nested pebble", { ":x": 0, ":y": 0, ":w": 200, ":h": 80 }, 0)],
  };
  const board = buildBoard(rawBoard([
    card("cardAAAA1", "Alpha card", 0),
    card("ref00001", "((target001))", 1),
    blk("nestCARD9", "{{[[diagram]]:Inner}}", { ":x": 800, ":y": 0, ":w": 220, ":h": 120 }, 2),
  ]));
  const calls = { block: 0, pull: 0, q: 0 };
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {},
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }),
    pullTree: () => [],
    blockString(uid) {
      calls.block += 1;
      if (uid === "target001") return "Resolved first line\nsecond line";
      if (uid === "nestCARD9") return "{{[[diagram]]:Inner}}";
      return null;
    },
    pullBoard(uid) {
      calls.pull += 1;
      return uid === "nestCARD9" ? nested : null;
    },
    q() { calls.q += 1; return []; },
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
  };
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
    on() { return () => {}; }, emit() {}, handlerCount: () => 0, release() {}, setLinkMode() {},
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0", autofocus: true });
  const pump = () => {
    for (let i = 0; i < 40; i += 1) {
      stub.flushFrames();
      stub.flushIdle();
      stub.flushTimers();
    }
  };
  return {
    stub, view, calls, pump,
    done() {
      view.dispose();
      restore();
      resetSharedBgBudget();
      noteSpeedFlags(null);
    },
  };
}

test("the search field calls no host pull, blockString, or q per key once the index is built", () => {
  const f = mountSearch({ flag: true });
  try {
    f.pump();
    f.view.root.focus();
    f.stub.dispatch(f.stub.window, "keydown", { key: "f", metaKey: true });
    const input = f.view.root.querySelector(".pxd-search__input");
    assert.ok(input);
    const before = { ...f.calls };
    input.value = "pebble";
    f.stub.dispatch(input, "input", {});
    assert.equal(f.calls.block, before.block, "blockString on the key");
    assert.equal(f.calls.pull, before.pull, "pullBoard on the key");
    assert.equal(f.calls.q, before.q, "q on the key");
    assert.equal(f.view.root.querySelector(".pxd-search__count").textContent, "1");
    assert.equal(f.view.root.querySelector('[data-uid="nestCARD9"]').classList.contains("pxd-item--hit"), true);
    input.value = "second line";
    f.stub.dispatch(input, "input", {});
    assert.equal(f.calls.block, before.block, "blockString on the second key");
    assert.equal(f.calls.pull, before.pull, "pullBoard on the second key");
    assert.equal(f.view.root.querySelector(".pxd-search__count").textContent, "1");
  } finally {
    f.done();
  }
});

test("searchHay off keeps the per-key blockString path", () => {
  const f = mountSearch({ flag: false });
  try {
    f.pump();
    const input = f.view.root.querySelector(".pxd-search__input");
    const before = f.calls.block;
    input.value = "second";
    f.stub.dispatch(input, "input", {});
    assert.ok(f.calls.block > before, "the kill switch still read the ref on the key");
  } finally {
    f.done();
  }
});
