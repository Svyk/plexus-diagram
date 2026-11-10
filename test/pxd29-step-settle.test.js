import assert from "node:assert/strict";
import test from "node:test";

import { resetSharedBgBudget } from "../src/bg-budget.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { plainText, setPlainTextCache } from "../src/model/schema.js";
import { noteSpeedFlags } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createGestureUnderlay } from "../src/view/gesture-underlay.js";
import { createQueryCards } from "../src/view/query-card.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const QUERY = "{{[[query]]: [[Lab]]}}";

test.afterEach(() => {
  noteSpeedFlags(null);
  setPlainTextCache(null);
  resetSharedBgBudget();
});

function queryBackend(hits) {
  return {
    hits: async () => {
      hits.n += 1;
      return { uids: ["aaaaaaaa1"], partial: false };
    },
    times: () => new Map([["aaaaaaaa1", 1]]),
    details: (order) => order.map((uid) => ({ uid, string: `row ${uid}`, page: "Lab" })),
  };
}

function queryHarness({ keep = null, busy = () => false } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const parent = stub.document.createElement("div");
  stub.document.body.append(parent);
  const queue = [];
  const arm = (fn) => { queue.push(fn); };
  let now = 0;
  const hits = { n: 0 };
  const cards = createQueryCards({
    doc: stub.document,
    host: { q: () => [], pullTree: () => [] },
    storage: { getItem: () => null, setItem: () => {} },
    graph: "G",
    backend: queryBackend(hits),
    now: () => now,
    schedule: arm,
    keep,
    busy,
    idle: arm,
  });
  const drain = async (max = 24) => {
    for (let i = 0; i < max && queue.length; i += 1) {
      const batch = queue.splice(0, queue.length);
      for (const fn of batch) fn();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return {
    stub, parent, cards, hits, queue,
    setNow: (n) => { now = n; },
    drain,
    done() { restore(); },
  };
}

test("PXD-29: kept query rows survive a settle past the 15s reuse, and a graph change reads again", async () => {
  const on = queryHarness({ keep: () => true });
  const off = queryHarness();
  try {
    on.cards.mount(on.parent, "queryUID1", QUERY);
    await on.drain();
    assert.equal(on.hits.n, 1);
    on.setNow(20000);
    const again = on.stub.document.createElement("div");
    on.stub.document.body.append(again);
    on.cards.mount(again, "queryUID1", QUERY);
    await on.drain();
    assert.equal(on.hits.n, 1, "the same query text does not read again");
    on.cards.noteGraph();
    await on.drain();
    assert.equal(on.hits.n, 2, "a graph change reads once the board is idle");

    off.cards.mount(off.parent, "queryUID1", QUERY);
    await off.drain();
    assert.equal(off.hits.n, 1);
    off.setNow(20000);
    const againOff = off.stub.document.createElement("div");
    off.stub.document.body.append(againOff);
    off.cards.mount(againOff, "queryUID1", QUERY);
    await off.drain();
    assert.equal(off.hits.n, 2, "without the flag the 15s reuse expires");
  } finally {
    on.done();
    off.done();
  }
});

test("PXD-29: a kept query does not read while the board is busy, and refresh still runs", async () => {
  let busy = false;
  const h = queryHarness({ keep: () => true, busy: () => busy });
  try {
    const root = h.cards.mount(h.parent, "queryUID1", QUERY);
    await h.drain();
    assert.equal(h.hits.n, 1);
    busy = true;
    h.cards.noteGraph();
    await h.drain(4);
    assert.equal(h.hits.n, 1, "a gesture or a settle holds the read");
    busy = false;
    await h.drain();
    assert.equal(h.hits.n, 2);
    root.querySelector(".pxd-qc__refresh").click();
    await h.drain();
    assert.equal(h.hits.n, 3, "the card's own refresh runs again");
  } finally {
    h.done();
  }
});

function badgeRenderer(stepSettle) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const r = createItemRenderer({
    doc,
    host: {
      renderString(node, string) { node.textContent = string; },
      renderBlock(node, uid) { node.textContent = uid; },
      unmount() {},
      blockString: () => null,
      pullTree: () => [],
    },
    session: {},
    itemsLayer,
    sectionsLayer,
    timers: { idle() { return () => {}; }, frame() { return () => {}; }, later() { return () => {}; } },
    settings: { stepSettle },
  });
  const raw = {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:T}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [{
      ":block/uid": "cardAAAA1",
      ":block/string": "Alpha",
      ":block/order": 0,
      ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 80 } },
      ":block/children": [],
    }],
  };
  const board = buildBoard(raw);
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  r.setLod("detail");
  r.setShowBadges(true);
  return { r, done() { r.dispose(); restore(); } };
}

test("PXD-29: badges are not walked again when their inputs are unchanged", () => {
  class CountingMap extends Map {
    gets = 0;
    get(key) { this.gets += 1; return super.get(key); }
  }
  const stats = { refs: 2, boards: 0, open: 0, done: 0, comments: 0 };
  const on = badgeRenderer(true);
  const off = badgeRenderer(false);
  try {
    const first = new CountingMap([["cardAAAA1", stats]]);
    on.r.setBadges(first);
    const afterFirst = first.gets;
    assert.ok(afterFirst > 0, "the first apply still reads each card");
    on.r.setBadges(new CountingMap([["cardAAAA1", { ...stats }]]));
    assert.equal(first.gets, afterFirst, "an equal signature does not walk the cards");

    const offMap = new CountingMap([["cardAAAA1", stats]]);
    off.r.setBadges(offMap);
    const offFirst = offMap.gets;
    off.r.setBadges(offMap);
    assert.ok(offMap.gets > offFirst, "with the flag off the same map is walked again");
  } finally {
    on.done();
    off.done();
  }
});

test("PXD-29: a second canvas paint does not measure a title it already laid out", () => {
  const paint = (stepSettle) => {
    noteSpeedFlags({ stepSettle });
    const stub = createDomStub({ width: 800, height: 600 });
    const restore = stub.install();
    try {
      const world = stub.document.createElement("div");
      const root = stub.document.createElement("div");
      stub.document.body.append(root, world);
      const underlay = createGestureUnderlay({ doc: stub.document, world, root });
      const items = [{ uid: "cardAAAA1", title: "Hello world title", rect: { x: 0, y: 0, w: 240, h: 120 } }];
      const view = { x: -20, y: -20, w: 800, h: 600 };
      const drawn = underlay.drawOverview({ items, zoom: 1, look: "detail", view });
      assert.ok(drawn > 0, "the first paint draws the card");
      const ctx = world.querySelector("canvas").__ctx;
      let measures = 0;
      const orig = ctx.measureText;
      ctx.measureText = (text) => { measures += 1; return orig.call(ctx, text); };
      underlay.drawOverview({ items, zoom: 1, look: "detail", view });
      underlay.dispose();
      return measures;
    } finally {
      restore();
    }
  };
  assert.equal(paint(true), 0, "the cached lines are filled without measuring");
  assert.ok(paint(false) > 0, "with the flag off every paint measures the title");
});

test("PXD-29: plain text of a title is cached while the flag is on", () => {
  const raw = "[[Hello]] **world**";
  setPlainTextCache(() => false);
  assert.equal(plainText(raw), "Hello world");
  let reads = 0;
  setPlainTextCache(() => { reads += 1; return true; });
  assert.equal(plainText(raw), "Hello world");
  assert.equal(plainText(raw), "Hello world");
  assert.ok(reads >= 2, "the hook is asked on each call; the stored string is the cache");
  setPlainTextCache(() => false);
  assert.equal(plainText(raw), "Hello world");
});

function mountTiny(viewport = null) {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  const raw = {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:T}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      { ":block/uid": "cardAAAA1", ":block/string": "Alpha", ":block/order": 0, ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 80 } }, ":block/children": [] },
      { ":block/uid": "cardBBBB2", ":block/string": "Beta", ":block/order": 1, ":block/props": { ":plexus": { ":x": 400, ":y": 0, ":w": 200, ":h": 80 } }, ":block/children": [] },
    ],
  };
  const board = buildBoard(raw);
  const host = {
    stats: {}, graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid) { el.textContent = uid; },
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
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0", ...(viewport ? { initialViewport: viewport } : {}) });
  const click = (world) => {
    const ev = (type, buttons) => ({
      type, screen: { x: 10, y: 10 }, world,
      target: { kind: "empty" }, button: 0, buttons, shift: false, alt: false, meta: false, ctrl: false,
    });
    view.controller.handle(ev("pointerdown", 1));
    view.controller.handle(ev("pointerup", 0));
  };
  return { stub, view, click, done() { view.dispose(); restore(); } };
}

test("PXD-29: a click that changes neither camera nor selection does not settle", () => {
  const empty = { x: 9000, y: 9000 };
  noteSpeedFlags({ stepSettle: true });
  const on = mountTiny();
  try {
    const onBefore = on.view.stats().timers;
    on.click(empty);
    assert.equal(on.view.stats().timers, onBefore, "an empty click adds no settle timer");
    on.view.controller.select(["cardAAAA1"]);
    on.stub.flushFrames();
    const selected = on.view.stats().timers;
    on.click(empty);
    assert.ok(on.view.stats().timers > selected, "clearing a selection still settles");
  } finally {
    on.done();
  }
  noteSpeedFlags({ stepSettle: false });
  const off = mountTiny();
  try {
    const offBefore = off.view.stats().timers;
    off.click(empty);
    assert.ok(off.view.stats().timers > offBefore, "with the flag off the same click still settles");
  } finally {
    off.done();
  }
});

test("PXD-29: a zoom button paints the camera and leaves the zoom label to the settle", () => {
  const paint = (stub) => { for (let i = 0; i < 12 && stub.flushFrames(); i += 1) { /* queued frames */ } };
  const labelOf = (root) => root.querySelector(".pxd-toolbar__zoom").textContent;
  const run = (stepSettle) => {
    noteSpeedFlags({ stepSettle });
    const m = mountTiny({ x: 0, y: 0, zoom: 0.6 });
    paint(m.stub);
    const before = {
      label: labelOf(m.view.root),
      lod: m.view.state().lod,
      flips: m.view.flipStats().flips,
    };
    const queued = [];
    const realTimeout = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    globalThis.setTimeout = (fn, ms) => {
      const rec = { fn, ms, dead: false };
      queued.push(rec);
      return rec;
    };
    globalThis.clearTimeout = (id) => { if (id && typeof id === "object") id.dead = true; };
    try {
      m.view.root.querySelector(".pxd-rail__zoom-in").click();
      m.stub.flushFrames();
      const frame = {
        label: labelOf(m.view.root),
        lod: m.view.state().lod,
        flips: m.view.flipStats().flips,
        zoom: m.view.state().zoom,
        transform: m.view.root.querySelector(".pxd-world").style.transform,
      };
      for (const rec of queued) if (!rec.dead && rec.ms === 120) rec.fn();
      return {
        before,
        frame,
        settled: { label: labelOf(m.view.root), lod: m.view.state().lod, flips: m.view.flipStats().flips },
      };
    } finally {
      globalThis.setTimeout = realTimeout;
      globalThis.clearTimeout = realClear;
      m.done();
    }
  };
  const on = run(true);
  assert.equal(on.before.lod, "detail");
  assert.equal(on.before.label, "60%");
  assert.ok(on.frame.zoom > 0.6 && on.frame.zoom < 0.8, "the click stays inside the detail tier");
  assert.match(on.frame.transform, new RegExp(`scale\\(${on.frame.zoom}\\)`));
  assert.equal(on.frame.label, "60%", "the zoom click does not rewrite the zoom label");
  assert.equal(on.frame.lod, "detail");
  assert.equal(on.frame.flips, on.before.flips);
  assert.equal(on.settled.label, "72%");
  assert.equal(on.settled.lod, "detail");

  const off = run(false);
  assert.equal(off.frame.label, "72%", "with the flag off the click's frame rewrites the zoom label");
  assert.equal(off.frame.lod, "detail");
  assert.equal(off.frame.flips, off.before.flips);
});
