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
import { createGestureUnderlay } from "../src/view/gesture-underlay.js";
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

// A cluster far from the open camera, still inside the zoom-0.1 view, and past the nearest 150.
function clusterBoard() {
  const children = spreadBoard();
  for (let i = 0; i < 8; i += 1) {
    children.push(blk(
      `clu${String(i).padStart(5, "0")}`,
      i === 0 ? "cluster target" : `cluster ${i}`,
      { ":x": 160 + (i % 4) * 48, ":y": 440 + Math.floor(i / 4) * 36, ":w": 40, ":h": 28 },
      300 + i,
    ));
  }
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

// Layout reads during mountBoardView are the MessagePort task. A read after a card is appended is the
// shell frame. Indicator writes must follow the offset reads, not sit between them.
function spyLayout(stub) {
  const counts = { mountRect: 0, mountStyle: 0, afterItem: 0 };
  const events = [];
  let phase = "mount";
  let itemAppended = false;
  const isShell = (node) => {
    const cls = typeof node?.className === "string" ? node.className : "";
    return cls.split(/\s+/).some((name) => name === "pxd-item" || name === "pxd-section");
  };
  const watch = (el) => {
    if (!el || el._layoutSpy || typeof el.getBoundingClientRect !== "function") return el;
    el._layoutSpy = true;
    const rect = el.getBoundingClientRect.bind(el);
    el.getBoundingClientRect = () => {
      events.push("read");
      if (phase === "mount") counts.mountRect += 1;
      if (phase === "frame" && itemAppended) counts.afterItem += 1;
      return rect();
    };
    const append = el.append.bind(el);
    el.append = (...nodes) => {
      if (phase === "frame") for (const node of nodes) if (isShell(node)) itemAppended = true;
      return append(...nodes);
    };
    const insertBefore = el.insertBefore.bind(el);
    el.insertBefore = (node, ref) => {
      if (phase === "frame" && isShell(node)) itemAppended = true;
      return insertBefore(node, ref);
    };
    const setProperty = el.style.setProperty.bind(el.style);
    el.style.setProperty = (name, value) => {
      if (String(name).startsWith("--pxd-ind-")) events.push("ind");
      return setProperty(name, value);
    };
    return el;
  };
  const orig = stub.document.createElement.bind(stub.document);
  stub.document.createElement = (tag) => watch(orig(tag));
  const origNS = stub.document.createElementNS.bind(stub.document);
  stub.document.createElementNS = (ns, tag) => watch(origNS(ns, tag));
  watch(stub.document.body);
  watch(stub.document.documentElement);
  const origStyle = stub.window.getComputedStyle.bind(stub.window);
  stub.window.getComputedStyle = (el) => {
    events.push("style");
    if (phase === "mount") counts.mountStyle += 1;
    if (phase === "frame" && itemAppended) counts.afterItem += 1;
    return origStyle(el);
  };
  globalThis.getComputedStyle = stub.window.getComputedStyle;
  const flushOne = () => {
    const frame = stub.frames.shift();
    if (!frame) return false;
    phase = "frame";
    itemAppended = false;
    frame.fn(16);
    phase = "between";
    return true;
  };
  return { counts, events, flushOne };
}

function mountSpread(stub) {
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
  return view;
}

test("map zoom mount reads no layout, and the shell frame does not read after a card", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const spy = spyLayout(stub);
  const view = mountSpread(stub);
  try {
    assert.equal(spy.counts.mountRect, 0);
    assert.equal(spy.counts.mountStyle, 0);
    const btn = view.root.querySelector(".pxd-dock__btn--on");
    assert.ok(btn);
    btn._rect = { left: 4, top: 8, width: 36, height: 32, right: 40, bottom: 40, x: 4, y: 8 };
    let built = 0;
    let guard = 0;
    while (stub.frames.length && guard < 8 && built === 0) {
      guard += 1;
      const before = spy.counts.afterItem;
      const had = view.stats().shells;
      spy.flushOne();
      const next = view.stats().shells;
      if (next > had) {
        built = next - had;
        assert.equal(spy.counts.afterItem, before);
      }
    }
    assert.ok(built > 0 && built <= 30, `first shell frame built ${built}`);
    const inds = spy.events.map((event, index) => (event === "ind" ? index : -1)).filter((index) => index >= 0);
    assert.ok(inds.length >= 4);
    const between = spy.events.slice(inds[0], inds[inds.length - 1] + 1);
    assert.equal(between.filter((event) => event === "read").length, 0);
  } finally {
    view.dispose();
    restore();
  }
});

test("overview cover reads colours before it writes the canvas", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const world = doc.createElement("div");
    root.append(world);
    const order = [];
    const origStyle = stub.window.getComputedStyle.bind(stub.window);
    stub.window.getComputedStyle = (el) => { order.push("style"); return origStyle(el); };
    const origCreate = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
      if (tag === "canvas") order.push("canvas");
      return origCreate(tag);
    };
    const origInsert = world.insertBefore.bind(world);
    world.insertBefore = (node, ref) => { order.push("insert"); return origInsert(node, ref); };
    const underlay = createGestureUnderlay({ doc, world, root });
    const box = { x: 0, y: 0, w: 10, h: 10 };
    underlay.draw({ items: [{ uid: "a", rect: box }], zoom: 0.1 });
    const styleAt = order.indexOf("style");
    assert.ok(styleAt >= 0);
    assert.ok(styleAt < order.indexOf("canvas"));
    assert.ok(styleAt < order.indexOf("insert"));
    const styles = order.filter((event) => event === "style").length;
    underlay.draw({ items: [{ uid: "b", rect: { x: 20, y: 0, w: 10, h: 10 } }], zoom: 0.1 });
    assert.equal(order.filter((event) => event === "style").length, styles);
    underlay.dispose();
  } finally {
    restore();
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
    const shellsBefore = fast.r.shellCount();
    const queuedBefore = fast.r.queuedCount();
    assert.ok(queuedBefore > 0);
    fast.r.sync({ board: fast.board, rects: worldRects(fast.board), dirty: null, structural: true, view });
    assert.equal(fast.r.shellCount(), shellsBefore, "a full sync keeps the shells already built");
    assert.equal(fast.r.queuedCount(), queuedBefore, "a full sync keeps the queue");
    assert.equal(fast.bgParts.length, 1, "the shell pump stays armed");
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

test("a later sync builds only the dirty card, drops a deleted uid, and leaves the queue", () => {
  const thaw = freezeClock();
  const children = spreadBoard();
  const view = { x: 0, y: 0, w: 8000, h: 6000 };
  const h = openRenderer({ children, lod: "overview", zoom: 0.1, view });
  try {
    const before = h.r.shellCount();
    const queued = h.r.queuedCount();
    assert.ok(before > 0 && before <= 30);
    assert.ok(queued > 30);
    assert.equal(h.r.shellOf("far000001"), null);
    h.r.sync({ board: h.board, rects: worldRects(h.board), dirty: new Set(["sec000001"]), structural: false, view });
    assert.equal(h.r.shellCount(), before, "a partial sync does not build the queue");
    assert.equal(h.r.queuedCount(), queued);
    h.r.sync({ board: h.board, rects: worldRects(h.board), dirty: new Set(["far000001"]), structural: false, view });
    assert.ok(h.r.shellOf("far000001"), "the dirty queued card is built");
    assert.equal(h.r.shellCount(), before + 1);
    assert.equal(h.r.queuedCount(), queued - 1);
    let gone = null;
    for (const uid of h.board.order) {
      if (!h.r.shellOf(uid)) { gone = uid; break; }
    }
    assert.ok(gone);
    const next = buildBoard(rawBoard(children.filter((child) => child[":block/uid"] !== gone)));
    const queuedAfter = h.r.queuedCount();
    h.r.sync({ board: next, rects: worldRects(next), dirty: new Set([gone]), structural: true, view });
    assert.equal(h.r.shellOf(gone), null);
    assert.equal(h.r.queuedCount(), queuedAfter - 1, "a deleted uid leaves the queue");
    assert.ok(h.r.shellCount() < next.order.length);
    const addedKids = [
      ...children.filter((child) => child[":block/uid"] !== gone),
      blk("new000001", "added", { ":x": 120, ":y": 120, ":w": 80, ":h": 48 }, 400),
    ];
    const added = buildBoard(rawBoard(addedKids));
    const shellsMid = h.r.shellCount();
    h.r.sync({ board: added, rects: worldRects(added), dirty: null, structural: true, view });
    assert.equal(h.r.shellOf("new000001"), null, "a full sync queues a new card instead of building the board");
    assert.equal(h.r.shellCount(), shellsMid);
    assert.ok(h.r.queuedCount() > 0);
    h.r.sync({ board: added, rects: worldRects(added), dirty: new Set(["new000001"]), structural: true, view });
    assert.ok(h.r.shellOf("new000001"));
    assert.equal(h.r.shellCount(), shellsMid + 1);
    assert.ok(h.r.shellCount() < added.order.length);
  } finally {
    h.done();
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

// Search, outline, and Enter used to move the camera to detail and drop the cover while the card stayed queued.
test("search and Enter build the queued card, keep the cover at detail, and pump the new view first", async () => {
  const thaw = freezeClock();
  const stub = createDomStub();
  const restore = stub.install();
  resetSharedBgBudget();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 0.1 }));
  const board = buildBoard(rawBoard(clusterBoard()));
  const host = {
    stats: {}, graph: "Svy",
    renderString(node, string) { node.textContent = string; },
    renderBlock(node) {
      const ta = stub.document.createElement("textarea");
      ta.className = "rm-block__input";
      node.append(ta);
    },
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
    let guard = 0;
    while (stub.frames.length && guard < 30) {
      guard += 1;
      stub.flushFrames();
    }
    assert.equal(view.state().lod, "overview");
    assert.equal(view.snapshotSource().shellOf("clu00000"), null);
    assert.equal(view.snapshotSource().shellOf("clu00001"), null);
    const parked = board.order.find((uid) => uid.startsWith("c0") && !view.snapshotSource().shellOf(uid));
    assert.ok(parked, "a grid card past the priority prefix is still queued");
    const cover = view.root.querySelector(".pxd-underlay");
    assert.ok(cover, "the open paints the cover");
    assert.notEqual(cover.style.display, "none");

    view.root.focus();
    stub.dispatch(stub.window, "keydown", { key: "f", metaKey: true });
    const input = view.root.querySelector(".pxd-search__input");
    assert.ok(input);
    input.value = "cluster target";
    stub.dispatch(input, "input", {});
    stub.dispatch(input, "keydown", { key: "Enter" });

    const hit = view.snapshotSource().shellOf("clu00000");
    assert.ok(hit, "search builds the queued card before the next frame");
    assert.equal(hit.classList.contains("pxd-item--hit"), true);

    stub.flushFrames();
    assert.equal(view.state().lod, "detail");
    stub.flushTimers();
    const held = view.root.querySelector(".pxd-underlay");
    assert.ok(held);
    assert.notEqual(held.style.display, "none", "the cover stays up at detail until the queue is empty");

    stub.flushFrames();
    assert.ok(view.snapshotSource().shellOf("clu00001"), "the new view is pumped before the open-time tail");
    assert.equal(view.snapshotSource().shellOf(parked), null, "a card outside the new view stays queued");

    view.controller.select([parked]);
    view.root.focus();
    stub.dispatch(stub.window, "keydown", { key: "Enter" });
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(
      view.snapshotSource().shellOf(parked)?.querySelector("textarea.rm-block__input"),
      "Enter opens the editor on a card that was still queued",
    );
  } finally {
    view.dispose();
    restore();
    thaw();
    resetSharedBgBudget();
  }
});

// The cover used to fill shellQueue order, so a nearer card later in board.order was painted underneath.
function coverStackBoard() {
  const children = spreadBoard();
  const section = children.find((child) => child[":block/uid"] === "sec000001");
  section[":block/children"] = [
    blk("mem000001", "member card", { ":x": 4000, ":y": 4000, ":w": 36, ":h": 24 }, 0),
  ];
  children.push(blk("big000001", "big far", { ":x": 40, ":y": 40, ":w": 400, ":h": 400 }, 210));
  children.push(blk("sml000001", "small top", { ":x": 300, ":y": 300, ":w": 40, ":h": 40 }, 211));
  children.push(blk("sib000001", "sibling card", { ":x": 4200, ":y": 4200, ":w": 36, ":h": 24 }, 212));
  return children;
}

test("the overview cover stacks like the board, follows a dragged section, and drops colours on a theme change", () => {
  let notes = 0;
  const h = openRenderer({
    children: coverStackBoard(),
    lod: "overview",
    zoom: 0.1,
    onOverviewQueue: () => { notes += 1; },
  });
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const boxes = h.r.pendingBoxes();
    const bigAt = boxes.findIndex((box) => box.uid === "big000001");
    const smallAt = boxes.findIndex((box) => box.uid === "sml000001");
    assert.ok(bigAt >= 0 && smallAt >= 0);
    assert.ok(smallAt > bigAt, "the later card in board.order is painted last");
    assert.equal(h.r.shellOf("sec000001") == null, false);
    assert.equal(h.r.shellOf("mem000001"), null);
    const rects = worldRects(h.board);
    const memberBefore = boxes.find((box) => box.uid === "mem000001").rect;
    const siblingBefore = boxes.find((box) => box.uid === "sib000001").rect;
    h.r.previewMove(["sec000001"], 25, -15, h.board, rects);
    const shifted = h.r.pendingBoxes();
    const member = shifted.find((box) => box.uid === "mem000001").rect;
    const sibling = shifted.find((box) => box.uid === "sib000001").rect;
    assert.equal(member.x, memberBefore.x + 25);
    assert.equal(member.y, memberBefore.y - 15);
    assert.equal(sibling.x, siblingBefore.x);
    assert.equal(sibling.y, siblingBefore.y);
    h.r.previewMove(["sec000001"], 0, 0, h.board, rects);
    const back = h.r.pendingBoxes().find((box) => box.uid === "mem000001").rect;
    assert.equal(back.x, memberBefore.x);
    assert.equal(back.y, memberBefore.y);
    const noted = notes;
    h.r.sync({ board: h.board, rects, dirty: null, structural: true, view: { x: 0, y: 0, w: 8000, h: 6000 } });
    assert.ok(notes > noted, "a later sync repaints the queue");

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
      const canvas = view.root.querySelector(".pxd-underlay");
      assert.ok(canvas);
      const fills = [];
      canvas.getContext = () => {
        const ctx = {
          clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, rect() {}, fill() {}, stroke() {},
          save() {}, restore() {}, scale() {}, translate() {}, setTransform() {},
          strokeStyle: "", lineWidth: 1,
        };
        let fill = "";
        Object.defineProperty(ctx, "fillStyle", {
          get() { return fill; },
          set(value) { fill = String(value); fills.push(fill); },
        });
        return ctx;
      };
      const origStyle = stub.window.getComputedStyle;
      stub.window.getComputedStyle = (el) => {
        const style = origStyle(el);
        return {
          getPropertyValue(name) {
            if (name === "--pxd-card") return "rgb(9, 9, 9)";
            return style.getPropertyValue(name);
          },
        };
      };
      globalThis.getComputedStyle = stub.window.getComputedStyle;
      // A theme class change (E5: a class record whose classes did not change is skipped).
      stub.document.documentElement.className = `${stub.document.documentElement.className || ""} rm-theme-other`.trim();
      for (const obs of stub.observers) {
        if (!obs.queue || !obs.active) continue;
        obs.queue.push({ type: "attributes", attributeName: "class", target: stub.document.documentElement });
      }
      stub.flushMutations();
      assert.equal(fills.at(-1), "rgb(9, 9, 9)");
    } finally {
      view.dispose();
    }
  } finally {
    h.done();
    restore();
    resetSharedBgBudget();
  }
});

test("parking the view stops the priority shell pump, and resume builds one chunk after the sync", () => {
  const thaw = freezeClock();
  const stub = createDomStub();
  const restore = stub.install();
  resetSharedBgBudget();
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
    const built = view.stats().shells;
    assert.ok(built > 0 && built <= 30, `go-live built ${built}`);
    view.suspend();
    stub.flushFrames();
    assert.equal(view.stats().shells, built, "a parked view does not build the next priority chunk");
    view.resume();
    stub.flushFrames();
    assert.equal(view.stats().shells, built, "resume syncs before it builds more shells");
    stub.flushFrames();
    const step = view.stats().shells - built;
    assert.ok(step > 0 && step <= 30, `resume chunk ${step}`);
  } finally {
    view.dispose();
    restore();
    thaw();
    resetSharedBgBudget();
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

test("an idle ref pull reads one outline level, sized to the slice, and a deep child stays readable", () => {
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
    assert.ok(idle.every((c) => c.n <= 4), `a frozen slice asks for at most the start size ${idle.map((c) => c.n).join(",")}`);
    assert.ok(idle.every((c) => !c.pattern.includes("...")), "idle pulls are one level");
    assert.ok(idle.some((c) => c.n === 4), "the wide level goes out at the sizer's start size");
    assert.equal(host.blockString("deepKid"), "deep line");
  } finally {
    globalThis.requestIdleCallback = previousIdle;
    globalThis.performance.now = previousNow;
    resetSharedBgBudget();
  }
});

test("a costly outline level shrinks the next idle ref batch below 20", () => {
  const kids = Array.from({ length: 25 }, (_, i) => ({
    ":block/uid": `s${i}`,
    ":block/string": `row ${i}`,
    ":block/order": i,
    ":block/children": [],
  }));
  const page = {
    ":block/uid": "slowPage",
    ":node/title": "Slow",
    ":block/string": "",
    ":block/order": 0,
    ":block/children": kids,
  };
  const byId = new Map([[page[":node/title"], page], [page[":block/uid"], page]]);
  for (const kid of kids) byId.set(kid[":block/uid"], kid);
  const calls = [];
  let now = 0;
  const fake = createFakeRoam();
  fake.seedBoard({
    uid: "slowBoard",
    props: { plexus: { v: 2 } },
    children: [{ uid: "cardSlow", string: "[[Slow]]", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } }],
  });
  fake.api.data.pull_many = (pattern, entities) => {
    const text = String(pattern);
    if (!text.includes(":block/children")) return entities.map(() => null);
    now += 20;
    calls.push({ n: entities.length, pattern: text });
    return entities.map((entity) => {
      const id = Array.isArray(entity) ? entity[1] : entity;
      const node = byId.get(id);
      if (!node) return null;
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
  const queued = [];
  const previousIdle = globalThis.requestIdleCallback;
  const previousNow = globalThis.performance.now;
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); return queued.length; };
  globalThis.performance.now = () => now;
  resetSharedBgBudget();
  try {
    host.pullBoard("slowBoard", { light: true, deferRefs: true });
    assert.equal(calls.length, 0);
    queued[0]({ timeRemaining: () => 40, didTimeout: false });
    assert.equal(calls.length, 2, "the slice fits the root and one more level");
    assert.equal(calls[0].n, 1, "the root is its own pull");
    assert.equal(calls[1].n, 1, "a 20 ms pull shrinks the next batch to one node");
    assert.ok(calls.every((c) => !c.pattern.includes("...")));
  } finally {
    globalThis.requestIdleCallback = previousIdle;
    globalThis.performance.now = previousNow;
    resetSharedBgBudget();
  }
});

test("a thrown badge step is not cached, and the next change asks again", () => {
  const thawPerf = freezeClock();
  const realNow = Date.now;
  Date.now = () => 1700000000000;
  const stub = createDomStub();
  const restore = stub.install();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = stub.window.setTimeout.bind(stub.window);
  globalThis.clearTimeout = stub.window.clearTimeout.bind(stub.window);
  resetSharedBgBudget();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard(rawBoard([
    blk("ref000001", "((note1))", { ":x": 40, ":y": 40, ":w": 200, ":h": 120 }, 0),
  ]));
  const card = board.items.get("ref000001");
  assert.equal(card.kind, "block");
  assert.equal(card.target.uid, "note1");
  let fail = true;
  let steps = 0;
  const zeros = { refs: 0, boards: 0, open: 0, done: 0 };
  const ready = { refs: 4, boards: 1, open: 2, done: 1 };
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
    cardStats: () => new Map([["uid:note1", ready]]),
    cardStatsJob: () => ({
      step() {
        steps += 1;
        if (fail) throw new Error("refs");
        return true;
      },
      result() { return new Map([["uid:note1", fail ? zeros : ready]]); },
    }),
  };
  const listeners = {};
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(),
    on(name, fn) {
      (listeners[name] ||= []).push(fn);
      return () => {};
    },
    release() {},
    setLinkMode() {},
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
  const pumpBg = () => {
    for (let i = 0; i < 8; i += 1) {
      const timers = stub.flushTimers();
      const idle = stub.flushIdle();
      if (!timers && !idle) break;
    }
  };
  try {
    assert.equal(view.state().lod, "detail");
    stub.flushFrames();
    stub.flushFrames();
    pumpBg();
    assert.equal(steps, 1, "the thrown step ran once");
    assert.equal(view.snapshotSource().badges.size, 0, "a thrown badge step is not stored");
    fail = false;
    for (const fn of listeners.change) fn({});
    stub.flushFrames();
    pumpBg();
    assert.equal(steps, 2, "the next change asks again");
    assert.equal(view.snapshotSource().badges.get("ref000001")?.refs, 4);
  } finally {
    view.dispose();
    restore();
    Date.now = realNow;
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
    thawPerf();
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

test("the go-live frame draws the cover and the first shells, and leaves the snapshot and the remaining edges", () => {
  const thaw = freezeClock();
  const stub = createDomStub();
  const restore = stub.install();
  resetSharedBgBudget();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 0.1 }));
  const children = spreadBoard();
  const edges = [];
  for (let i = 0; i < 320; i += 1) {
    edges.push(blk(
      `e${String(i).padStart(8, "0")}`,
      "→",
      { ":type": "edge", ":from": "c00000000", ":to": "c00000001" },
      i,
    ));
  }
  children.push({
    ":block/uid": "connections1",
    ":block/string": "Connections",
    ":block/order": 900,
    ":block/props": { ":plexus": { ":type": "edges" } },
    ":block/children": edges,
  });
  const board = buildBoard(rawBoard(children));
  assert.ok(board.edges.size > 250, `edges ${board.edges.size}`);
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
  let painted = 0;
  const view = mountBoardView({
    host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0",
    onFirstPaint: () => { painted += 1; },
  });
  let rectReads = 0;
  const watchRect = (el) => {
    if (!el?.getBoundingClientRect || el._rectWatched) return;
    el._rectWatched = true;
    const orig = el.getBoundingClientRect;
    el.getBoundingClientRect = () => { rectReads += 1; return orig.call(el); };
  };
  try {
    watchRect(view.root);
    watchRect(view.root.querySelector(".pxd-viewport"));
    watchRect(view.root.querySelector(".pxd-toolbar"));
    // Boot queues the measure frame ahead of the shell frame. The shell frame is the one that builds cards.
    let guard = 0;
    let goLive = false;
    while (stub.frames.length && guard < 8 && !goLive) {
      guard += 1;
      rectReads = 0;
      const frame = stub.frames.shift();
      const before = view.stats().shells;
      frame.fn(16);
      goLive = view.stats().shells > before;
    }
    assert.equal(goLive, true, "a boot frame builds the first shells");
    const attached = view.stats().edgesAttached;
    assert.ok(attached > 0 && attached <= 250, `the go-live frame places ${attached} edges`);
    assert.equal(painted, 0, "the snapshot stays up through the go-live frame");
    assert.equal(rectReads, 0, "the go-live frame does not measure");
    const shells = view.stats().shells;
    assert.ok(shells > 0 && shells <= 30, `the go-live frame builds ${shells} shells`);
    assert.ok(view.root.querySelector("canvas.pxd-underlay"), "the cover is drawn in the go-live frame");
    const follow = stub.frames.splice(0, stub.frames.length);
    assert.ok(follow.length >= 1, "first paint waits for a later frame");
    for (const frame of follow) frame.fn(16);
    assert.equal(painted, 1, "a later frame takes the snapshot down");
    assert.ok(view.stats().edgesAttached > attached, "a later frame continues the edges");
  } finally {
    view.dispose();
    restore();
    thaw();
    resetSharedBgBudget();
  }
});

// Detail zoom waits for the in-view shells, then the snapshot comes off in that same frame and every
// edge is placed. Deferring the snapshot and slicing the first edge render belong to the overview-fast open.
test("a detail-zoom open does not defer onFirstPaint or slice the first edges", () => {
  const thaw = freezeClock();
  const stub = createDomStub();
  const restore = stub.install();
  resetSharedBgBudget();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 0.75 }));
  const children = [];
  for (let i = 0; i < 180; i += 1) {
    const col = i % 15;
    const row = Math.floor(i / 15);
    children.push(blk(
      `d${String(i).padStart(8, "0")}`,
      `card ${i}`,
      { ":x": 40 + col * 48, ":y": 40 + row * 36, ":w": 40, ":h": 28 },
      i,
    ));
  }
  const edges = [];
  for (let i = 0; i < 320; i += 1) {
    edges.push(blk(
      `e${String(i).padStart(8, "0")}`,
      "→",
      { ":type": "edge", ":from": "d00000000", ":to": "d00000001" },
      i,
    ));
  }
  children.push({
    ":block/uid": "connections1",
    ":block/string": "Connections",
    ":block/order": 900,
    ":block/props": { ":plexus": { ":type": "edges" } },
    ":block/children": edges,
  });
  const board = buildBoard(rawBoard(children));
  assert.ok(board.edges.size > 250, `edges ${board.edges.size}`);
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
  let painted = 0;
  const view = mountBoardView({
    host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0",
    onFirstPaint: () => { painted += 1; },
  });
  try {
    assert.equal(view.state().lod, "detail");
    assert.equal(view.state().zoom, 0.75);
    let guard = 0;
    let firstEdges = 0;
    let finished = false;
    while (stub.frames.length && guard < 40 && !finished) {
      guard += 1;
      const frame = stub.frames.shift();
      const shellsBefore = view.stats().shells;
      const paintedBefore = painted;
      frame.fn(16);
      if (!firstEdges && view.stats().edgesAttached > 0) firstEdges = view.stats().edgesAttached;
      if (shellsBefore < 180 && view.stats().shells >= 180) {
        finished = true;
        assert.equal(paintedBefore, 0, "the snapshot stays up until the in-view shells exist");
        assert.equal(painted, 1, "onFirstPaint runs in the frame that finishes the detail view");
      }
    }
    assert.equal(finished, true, "the detail open builds every in-view shell");
    assert.ok(firstEdges > 250, `the first edge frame places ${firstEdges} edges`);
    assert.equal(view.root.querySelector("canvas.pxd-underlay"), null, "a detail open does not paint the overview cover");
  } finally {
    view.dispose();
    restore();
    thaw();
    resetSharedBgBudget();
  }
});
