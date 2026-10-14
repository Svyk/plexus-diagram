// P10. Overview live does not wait for every map-tier shell. Background slices stay small.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { defaultSpeedFlags, parseSpeedFlags } from "../src/settings.js";
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

function openRenderer({ children, lod = "overview", zoom = 0.1, settings = {}, view = { x: 0, y: 0, w: 8000, h: 6000 } } = {}) {
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
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers, settings });
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
    assert.equal(h.r.shellCount(), 151);
    assert.equal(h.r.shellOf("far000001"), null);
    assert.ok(h.r.shellOf("sec000001"));
    assert.ok(h.r.shellCount() < h.board.order.length);
  } finally {
    h.done();
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
