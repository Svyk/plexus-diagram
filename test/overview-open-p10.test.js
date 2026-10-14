// P10. Overview live does not wait for every map-tier shell. Background slices stay small.
import assert from "node:assert/strict";
import test from "node:test";

import { resetSharedBgBudget } from "../src/bg-budget.js";
import { createHost } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { defaultSpeedFlags, parseSpeedFlags } from "../src/settings.js";
import { createCoverRepaintJob, mountBoardView } from "../src/view/board-view.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

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

// 200 cards around the camera centre, one card and one section far from it but still inside the view.
function spreadBoard() {
  const children = [];
  for (let i = 0; i < 200; i += 1) {
    const col = i % 20;
    const row = Math.floor(i / 20);
    children.push(blk(
      `c${String(i).padStart(8, "0")}`,
      `card ${i}`,
      { ":x": 3600 + col * 40, ":y": 2700 + row * 30, ":w": 36, ":h": 24 },
      i,
    ));
  }
  children.push(blk("far000001", "far card", { ":x": 80, ":y": 80, ":w": 160, ":h": 100 }, 200));
  children.push(blk("sec000001", "Far section", { type: "section", ":x": 80, ":y": 220, ":w": 280, ":h": 180 }, 201));
  return children;
}

function openRenderer({ children, lod = "overview", zoom = 0.1, settings = {}, view = { x: 0, y: 0, w: 8000, h: 6000 }, onOverviewQueue = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const host = {
    stats: {},
    renderString(node, string) { node.textContent = string; },
    renderBlock(node, uid) { node.textContent = uid; },
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
  };
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const frameQueue = [];
  const bgParts = [];
  const timers = {
    frame(fn) {
      frameQueue.push(fn);
      return () => {
        const i = frameQueue.indexOf(fn);
        if (i >= 0) frameQueue.splice(i, 1);
      };
    },
    idle() { return () => {}; },
    later() { return () => {}; },
    bgRun(part, opts) {
      bgParts.push({ part, opts });
      return () => {
        const i = bgParts.findIndex((row) => row.part === part);
        if (i >= 0) bgParts.splice(i, 1);
      };
    },
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers, settings, onOverviewQueue });
  const board = buildBoard(rawBoard(children));
  if (lod) r.setLod(lod, zoom);
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true, view });
  let live = false;
  r.whenViewBuilt(() => { live = true; });
  return {
    r, board, frameQueue, bgParts, live: () => live, stub,
    done() { r.dispose(); restore(); },
  };
}

const freezeClock = () => {
  const prev = globalThis.performance;
  globalThis.performance = { now: () => 0 };
  return () => { globalThis.performance = prev; };
};

const drainFrames = (queue) => {
  let guard = 0;
  while (queue.length && guard < 80) {
    guard += 1;
    const fn = queue.shift();
    fn();
  }
  return guard;
};

test("overviewFast defaults on and parses off", () => {
  assert.equal(defaultSpeedFlags().overviewFast, true);
  assert.equal(parseSpeedFlags('{"overviewFast":false}').overviewFast, false);
  assert.equal(parseSpeedFlags({}).overviewFast, true);
});

test("overview goes live once the priority shells exist, and a far section is one of them", () => {
  const h = openRenderer({ children: spreadBoard(), lod: "overview", zoom: 0.1 });
  try {
    assert.equal(h.live(), true);
    assert.ok(h.r.shellCount() > 0 && h.r.shellCount() <= 30);
    assert.equal(h.r.shellOf("far000001"), null);
    assert.ok(h.r.shellOf("sec000001"));
    assert.ok(h.r.shellCount() < h.board.order.length);
  } finally {
    h.done();
  }
});

// A frozen clock never leaves the time budget, so the chunk cap is what stops the frame.
test("overview live is the first chunk of at most 30 shells, then one chunk per frame", () => {
  const thaw = freezeClock();
  const h = openRenderer({ children: spreadBoard(), lod: "overview", zoom: 0.1 });
  try {
    assert.equal(h.live(), true);
    const first = h.r.shellCount();
    assert.ok(first > 0 && first <= 30, `first chunk ${first}`);
    assert.ok(h.r.shellOf("sec000001"), "a section is in the first chunk");
    assert.equal(h.r.shellOf("far000001"), null);
    assert.ok(h.r.queuedCount() > 30);
    assert.ok(h.frameQueue.length >= 1, "the next priority chunk waits for a frame");
    const before = h.r.shellCount();
    const queued = h.frameQueue.length;
    h.frameQueue.shift()();
    const step = h.r.shellCount() - before;
    assert.ok(step > 0 && step <= 30, `frame chunk ${step}`);
    assert.ok(h.r.shellCount() < h.board.order.length);
    assert.ok(h.frameQueue.length >= queued, "another chunk is scheduled while priority shells remain");
  } finally {
    h.done();
    thaw();
  }
});

test("detail zoom does not paint the overview cover before it goes live", () => {
  const thaw = freezeClock();
  let notes = 0;
  const detail = openRenderer({
    children: spreadBoard(),
    lod: "detail",
    zoom: 0.75,
    onOverviewQueue: () => { notes += 1; },
  });
  try {
    assert.equal(notes, 0);
    assert.equal(detail.live(), false);
    assert.equal(detail.bgParts.length, 0);
    assert.ok(detail.frameQueue.length > 0);
  } finally {
    detail.done();
    thaw();
  }
});

test("map zoom goes live the same way", () => {
  const h = openRenderer({ children: spreadBoard(), lod: "map", zoom: 0.3 });
  try {
    assert.equal(h.live(), true);
    assert.equal(h.r.shellOf("far000001"), null);
    assert.ok(h.r.shellOf("sec000001"));
  } finally {
    h.done();
  }
});

test("overviewFast off and detail zoom still wait until every in-view shell is built", () => {
  const thaw = freezeClock();
  const off = openRenderer({ children: spreadBoard(), lod: "overview", zoom: 0.1, settings: { overviewFast: false } });
  const detail = openRenderer({ children: spreadBoard(), lod: "detail", zoom: 0.75 });
  try {
    assert.equal(off.live(), false);
    assert.equal(detail.live(), false);
    assert.equal(off.r.shellOf("far000001"), null);
    assert.equal(detail.r.shellOf("far000001"), null);
    drainFrames(off.frameQueue);
    drainFrames(detail.frameQueue);
    assert.equal(off.live(), true);
    assert.equal(detail.live(), true);
    assert.equal(off.r.shellCount(), off.board.order.length);
    assert.equal(detail.r.shellCount(), detail.board.order.length);
    assert.ok(off.r.shellOf("far000001"));
    assert.ok(detail.r.shellOf("far000001"));
  } finally {
    off.done();
    detail.done();
    thaw();
  }
});

test("ensureShell builds one queued card and leaves the rest queued", () => {
  const h = openRenderer({ children: spreadBoard(), lod: "overview", zoom: 0.1 });
  try {
    assert.equal(h.live(), true);
    assert.equal(h.r.shellOf("far000001"), null);
    const before = h.r.shellCount();
    const el = h.r.ensureShell("far000001");
    assert.ok(el);
    assert.equal(h.r.shellOf("far000001"), el);
    assert.equal(h.r.shellCount(), before + 1);
    assert.equal(h.r.ensureShell("far000001"), el);
    assert.ok(h.r.shellCount() < h.board.order.length);
  } finally {
    h.done();
  }
});

test("a click or hover on an unbuilt overview card builds that shell and hits it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 0.1 }));
  const board = buildBoard(rawBoard(spreadBoard()));
  const host = {
    stats: {},
    graph: "Svy",
    renderString(node, string) { node.textContent = string; },
    renderBlock(node, uid) { node.textContent = uid; },
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
    assert.equal(view.state().lod, "overview");
    assert.equal(view.snapshotSource().shellOf("far000001"), null);
    const root = view.root;
    stub.dispatch(root, "pointermove", { clientX: 16, clientY: 13, buttons: 0, pointerId: 1 });
    const shell = view.snapshotSource().shellOf("far000001");
    assert.ok(shell, "hover builds the shell under the pointer");
    const ctx = root.querySelector(".pxd-ctx");
    assert.ok(ctx);
    assert.notEqual(ctx.style.display, "none");
    stub.dispatch(root, "pointerdown", { button: 0, buttons: 1, clientX: 16, clientY: 13, pointerId: 2 });
    assert.deepEqual(view.state().selection, ["far000001"]);
    // A press starts a gesture. The empty click is a full click: clear-on-click runs on pointerup.
    stub.dispatch(root, "pointerup", { button: 0, buttons: 0, clientX: 16, clientY: 13, pointerId: 2 });
    stub.dispatch(root, "pointerdown", { button: 0, buttons: 1, clientX: 760, clientY: 20, pointerId: 3 });
    stub.dispatch(root, "pointerup", { button: 0, buttons: 0, clientX: 760, clientY: 20, pointerId: 3 });
    assert.deepEqual(view.state().selection, []);
  } finally {
    view.dispose();
    restore();
  }
});

test("overview shell pump shares the background budget and detail keeps the frame pump", () => {
  const thaw = freezeClock();
  const view = { x: 0, y: 0, w: 8000, h: 6000 };
  let held = null;
  const fast = openRenderer({ children: spreadBoard(), lod: "overview", zoom: 0.1 });
  const off = openRenderer({ children: spreadBoard(), lod: "overview", zoom: 0.1, settings: { overviewFast: false } });
  const detail = openRenderer({ children: spreadBoard(), lod: "detail", zoom: 0.75 });
  try {
    assert.equal(fast.live(), true);
    assert.ok(fast.r.shellCount() <= 30);
    assert.equal(fast.bgParts.length, 0, "priority chunks take the frames; the budget starts after them");
    let frames = 0;
    while (fast.frameQueue.length && frames < 20) {
      frames += 1;
      fast.frameQueue.shift()();
    }
    assert.ok(frames > 1);
    assert.equal(fast.bgParts.length, 1);
    assert.equal(fast.bgParts[0].opts.label, "shells");
    assert.equal(fast.bgParts[0].opts.partMs, 4);
    const before = fast.r.shellCount();
    assert.equal(fast.bgParts[0].part({ timeRemaining: () => 0 }), false);
    assert.ok(fast.r.shellCount() > before);
    assert.ok(fast.r.shellCount() - before <= 40);
    assert.ok(fast.r.shellCount() < fast.board.order.length);
    fast.r.sync({ board: fast.board, rects: worldRects(fast.board), dirty: null, structural: true, view });
    assert.equal(fast.bgParts.length, 0);
    assert.equal(fast.r.queuedCount(), 0);
    held = openRenderer({ children: spreadBoard(), lod: "overview", zoom: 0.1 });
    held.r.dispose();
    assert.equal(held.bgParts.length, 0);
    assert.equal(off.bgParts.length, 0);
    assert.ok(off.frameQueue.length > 0);
    assert.equal(detail.bgParts.length, 0);
    assert.ok(detail.frameQueue.length > 0);
  } finally {
    held?.done();
    detail.done();
    off.done();
    fast.done();
    thaw();
  }
});

test("pending boxes cover queued cards and clear when the queue finishes", () => {
  let notes = 0;
  const h = openRenderer({ children: spreadBoard(), lod: "overview", zoom: 0.1, onOverviewQueue: () => { notes += 1; } });
  try {
    assert.ok(notes >= 1);
    const boxes = h.r.pendingBoxes();
    assert.ok(boxes.some((box) => box.uid === "far000001" && box.rect));
    assert.equal(boxes.length, h.r.queuedCount());
    let guard = 0;
    while (h.frameQueue.length && guard < 20) {
      guard += 1;
      h.frameQueue.shift()();
    }
    guard = 0;
    while (h.r.queuedCount() && h.bgParts[0] && guard < 20) {
      guard += 1;
      h.bgParts[0].part({ timeRemaining: () => 0 });
    }
    assert.equal(h.r.queuedCount(), 0);
    assert.equal(h.r.pendingBoxes().length, 0);
    assert.ok(notes >= 2);
  } finally {
    h.done();
  }
});

test("queued overview cards stay drawn after the gesture underlay hides", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 0.1 }));
  const board = buildBoard(rawBoard(spreadBoard()));
  const host = {
    stats: {}, graph: "Svy",
    renderString(node, string) { node.textContent = string; },
    renderBlock(node, uid) { node.textContent = uid; },
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
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(),
    on() { return () => {}; }, release() {}, setLinkMode() {},
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
  try {
    stub.flushFrames();
    assert.equal(view.snapshotSource().shellOf("far000001"), null);
    const canvas = view.root.querySelector(".pxd-underlay");
    assert.ok(canvas, "queued cards have a drawn cover");
    assert.notEqual(canvas.style.display, "none");
    assert.match(String(canvas.style.cssText), /pointer-events:\s*none/);
    const root = view.root;
    stub.dispatch(root, "pointerdown", { button: 0, buttons: 1, clientX: 760, clientY: 20, pointerId: 4 });
    stub.dispatch(root, "pointerup", { button: 0, buttons: 0, clientX: 760, clientY: 20, pointerId: 4 });
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(view.snapshotSource().shellOf("far000001"), null);
    const still = view.root.querySelector(".pxd-underlay");
    assert.ok(still);
    assert.notEqual(still.style.display, "none");
  } finally {
    view.dispose();
    restore();
  }
});

test("cover repaint paints six cards and counts highlights in their own part", () => {
  const uids = Array.from({ length: 13 }, (_, i) => `pdf${i}`);
  const paints = [];
  let counts = 0;
  let paintedAtCount = -1;
  const step = createCoverRepaintJob({
    takeUrls: () => uids,
    repaint: (part) => paints.push(part.slice()),
    count: () => { counts += 1; paintedAtCount = paints.length; },
  });
  assert.equal(step(), false);
  assert.deepEqual(paints, [uids.slice(0, 6)]);
  assert.equal(counts, 0);
  assert.equal(step(), false);
  assert.deepEqual(paints[1], uids.slice(6, 12));
  assert.equal(counts, 0);
  assert.equal(step(), false);
  assert.deepEqual(paints[2], ["pdf12"]);
  assert.equal(counts, 0);
  assert.equal(step(), true);
  assert.equal(counts, 1);
  assert.equal(paintedAtCount, 3);
  assert.equal(paints.length, 3);
});

test("cardStatsJob runs one collection query per step and remembers only at the end", () => {
  const queries = [];
  const ids = {
    ":block/uid:note1": 1,
    ":block/uid:board1": 10,
    ":block/uid:board2": 11,
    ":node/title:TODO": 100,
    ":node/title:DONE": 101,
  };
  const pull = (_pattern, entity) => {
    const key = Array.isArray(entity) ? `${entity[0]}:${entity[1]}` : "";
    return key in ids ? { ":db/id": ids[key] } : null;
  };
  const data = {
    pull,
    pull_many() { throw new Error("datascript"); },
    q(text) { queries.push(String(text)); return []; },
  };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const host = createHost({ api: { data, util: { generateUID: () => "u" } }, storage, graph: "g" });
  const targets = [{ kind: "block", uid: "note1" }];
  const job = host.cardStatsJob(targets, { boardUid: "board1" });
  assert.equal(job.step(), false);
  assert.equal(queries.length, 1);
  assert.equal(job.step(), false);
  assert.equal(queries.length, 2);
  assert.equal(job.step(), false);
  assert.equal(queries.length, 3);
  const mid = host.cardStats(targets, { boardUid: "board1" });
  assert.equal(queries.length, 7);
  assert.equal(job.step(), true);
  assert.equal(queries.length, 8);
  assert.deepEqual([...job.result()], [...mid]);
  const cached = host.cardStatsJob(targets, { boardUid: "board1" });
  assert.equal(cached.step(), true);
  assert.equal(queries.length, 8);
  assert.deepEqual([...cached.result()], [...job.result()]);
  const pulled = [];
  const fast = createHost({
    api: {
      data: {
        pull,
        pull_many(_pattern, eids) { pulled.push([...eids]); return eids.map((id) => ({ ":db/id": id })); },
        q(text) { queries.push(String(text)); return []; },
      },
      util: { generateUID: () => "u" },
    },
    storage,
    graph: "g",
  });
  const one = fast.cardStatsJob(targets, { boardUid: "board2" });
  assert.equal(one.step(), true);
  assert.equal(pulled.length, 1);
  assert.deepEqual([...one.result()], [...fast.cardStats(targets, { boardUid: "board2" })]);
  assert.equal(pulled.length, 1);
});

test("an idle ref pull reads one outline level, at most 20 nodes, and a deep child stays readable", () => {
  const kids = Array.from({ length: 25 }, (_, i) => ({
    ":block/uid": `k${i}`,
    ":block/string": `row ${i}`,
    ":block/order": i,
    ":block/children": i === 3 ? [{ ":block/uid": "deepKid", ":block/string": "deep line", ":block/order": 0, ":block/children": [] }] : [],
  }));
  const page = {
    ":block/uid": "deepPage",
    ":node/title": "Deep",
    ":block/string": "",
    ":block/order": 0,
    ":block/children": kids,
  };
  const byId = new Map();
  const index = (node) => {
    if (node[":block/uid"]) byId.set(node[":block/uid"], node);
    if (node[":node/title"]) byId.set(node[":node/title"], node);
    for (const kid of node[":block/children"] || []) index(kid);
  };
  index(page);
  const calls = [];
  const fake = createFakeRoam();
  const card = (uid, string) => ({ uid, string, props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } });
  fake.seedBoard({ uid: "syncBoard", props: { plexus: { v: 2 } }, children: [card("cardSync", "[[Other]]")] });
  fake.seedBoard({ uid: "idleBoard", props: { plexus: { v: 2 } }, children: [card("cardIdle", "[[Deep]]")] });
  fake.api.data.pull_many = (pattern, entities) => {
    const text = String(pattern);
    if (!text.includes(":block/children")) return entities.map(() => null);
    calls.push({ pattern: text, n: entities.length });
    return entities.map((entity) => {
      const id = Array.isArray(entity) ? entity[1] : entity;
      const node = byId.get(id);
      if (!node) return null;
      if (text.includes("...")) return node;
      return {
        ":block/uid": node[":block/uid"],
        ":node/title": node[":node/title"],
        ":block/string": node[":block/string"] ?? "",
        ":block/order": node[":block/order"] ?? 0,
        ":block/children": (node[":block/children"] || []).map((kid) => ({ ":block/uid": kid[":block/uid"], ":block/order": kid[":block/order"] ?? 0 })),
      };
    });
  };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.pullBoard("syncBoard");
  const sync = calls.filter((c) => c.pattern.includes(":block/children"));
  assert.ok(sync.some((c) => c.pattern.includes("...")), "a synchronous ref pull still uses the recursive body");
  calls.length = 0;
  const queued = [];
  const previousIdle = globalThis.requestIdleCallback;
  const previousNow = globalThis.performance.now;
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); return queued.length; };
  globalThis.performance.now = () => 0;
  resetSharedBgBudget();
  try {
    host.pullBoard("idleBoard", { light: true, deferRefs: true });
    assert.equal(calls.length, 0, "deferred refs wait for idle");
    const spent = { timeRemaining: () => 0, didTimeout: false };
    let i = 0;
    while (i < queued.length && i < 40) {
      const fn = queued[i];
      i += 1;
      fn(spent);
    }
    const idle = calls.filter((c) => c.pattern.includes(":block/children"));
    assert.ok(idle.length >= 2, "a deep page takes more than one pull");
    assert.ok(idle.every((c) => c.n <= 20), `a pull names at most 20 nodes ${idle.map((c) => c.n).join(",")}`);
    assert.ok(idle.every((c) => !c.pattern.includes("...")), "idle pulls are one level");
    assert.ok(idle.some((c) => c.n === 20), "the wide level goes out 20 at a time");
    assert.equal(host.blockString("deepKid"), "deep line");
  } finally {
    globalThis.requestIdleCallback = previousIdle;
    globalThis.performance.now = previousNow;
    resetSharedBgBudget();
  }
});

test("a normal board builds every shell before live and does not queue a pump", () => {
  const children = [];
  for (let i = 0; i < 40; i += 1) {
    children.push(blk(`n${String(i).padStart(8, "0")}`, `n ${i}`, { ":x": 40 + (i % 8) * 180, ":y": 40 + Math.floor(i / 8) * 120, ":w": 160, ":h": 100 }, i));
  }
  const h = openRenderer({ children, lod: "overview", zoom: 0.1 });
  try {
    assert.equal(h.live(), true);
    assert.equal(h.r.shellCount(), 40);
    assert.equal(h.frameQueue.length, 0);
    assert.equal(h.bgParts.length, 0);
  } finally {
    h.done();
  }
});
