// FAST-6. Layout-shift attribution, the gate row, and height reserved before content mounts.
import assert from "node:assert/strict";
import test from "node:test";

import { createCardCache } from "../src/model/card-cache.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { PDF_READER_H, PDF_READER_W, coverModel, coverOuterBox } from "../src/model/pdf.js";
import { createCardChips } from "../src/cardchips.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createItemRenderer } from "../src/view/cards.js";
import {
  attributeShiftNode,
  createShiftWatch,
  shiftEntryFails,
  summarizeGateShifts,
} from "../src/view/shift-watch.js";
import { formatTable, judge, planText } from "../tools/live/perf-gate.mjs";
import { createDomStub } from "./fixtures/dom-stub.js";

const VIDEO = "{{[[video]]: https://cdn.example/clip.mp4}}";

function shift(value, startTime, extra = {}) {
  return { value, startTime, hadRecentInput: false, ...extra };
}

test("a shift before usable fails only the later shift, and recent input does not", () => {
  const usableAt = 100;
  const before = shift(0.2, 40, { region: "cards" });
  const after = shift(0.3, 140, { region: "cards" });
  const input = shift(0.9, 180, { region: "page", hadRecentInput: true });
  assert.equal(shiftEntryFails(before, usableAt), false);
  assert.equal(shiftEntryFails(after, usableAt), true);
  assert.equal(shiftEntryFails(input, usableAt), false);
  assert.equal(shiftEntryFails(shift(0, 180, { region: "cards" }), usableAt), false);
  assert.equal(shiftEntryFails(shift(0.2, 100, { region: "cards" }), usableAt), false);
  assert.equal(summarizeGateShifts({ entries: [before, after, input], usableAt, grown: 0 }), 1);
  assert.equal(summarizeGateShifts({ entries: [after], usableAt, grown: 2 }), 3);
  assert.equal(summarizeGateShifts({ entries: [after], usableAt: null, grown: 4 }), 0);
});

test("sources attribute to cards, chrome, panel, or the page, and an in-root miss does not fail", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const item = doc.createElement("div");
    item.className = "pxd-item";
    const cardBit = doc.createElement("span");
    item.append(cardBit);
    const toolbar = doc.createElement("div");
    toolbar.className = "pxd-toolbar";
    const toolBit = doc.createElement("span");
    toolbar.append(toolBit);
    const dock = doc.createElement("div");
    dock.className = "pxd-dock";
    const dockBit = doc.createElement("span");
    dock.append(dockBit);
    const panel = doc.createElement("div");
    panel.className = "pxd-panel";
    const panelBit = doc.createElement("span");
    panel.append(panelBit);
    const stray = doc.createElement("div");
    stray.className = "pxd-minimap";
    root.append(item, toolbar, dock, panel, stray);
    const page = doc.createElement("div");
    doc.body.append(root, page);
    const text = { nodeType: 3, parentElement: cardBit };

    assert.equal(attributeShiftNode(cardBit), "cards");
    assert.equal(attributeShiftNode(text), "cards");
    assert.equal(attributeShiftNode(toolBit), "chrome");
    assert.equal(attributeShiftNode(dockBit), "chrome");
    assert.equal(attributeShiftNode(panelBit), "panel");
    assert.equal(attributeShiftNode(page), "page");
    assert.equal(attributeShiftNode(stray), null);
    assert.equal(attributeShiftNode(null), null);

    const at = 10;
    const entry = (node) => shift(0.4, 20, { sources: [{ node }] });
    assert.equal(shiftEntryFails(entry(cardBit), at), true);
    assert.equal(shiftEntryFails(entry(toolBit), at), true);
    assert.equal(shiftEntryFails(entry(panelBit), at), true);
    assert.equal(shiftEntryFails(entry(page), at), true);
    assert.equal(shiftEntryFails(entry(stray), at), false);
    assert.equal(summarizeGateShifts({
      entries: [entry(cardBit), entry(toolBit), entry(panelBit), entry(page), entry(stray)],
      usableAt: at,
    }), 4);
  } finally {
    restore();
  }
});

test("the watcher is off until the timing log or the debug flag, and dispose disconnects it", async () => {
  const previousPO = globalThis.PerformanceObserver;
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const previousDebug = globalThis.__PXD_SHIFT_DEBUG;
  const made = [];
  globalThis.PerformanceObserver = class {
    constructor() { made.push(this); this.alive = false; }
    observe() { this.alive = true; }
    disconnect() { this.alive = false; }
  };
  let queued = [];
  globalThis.requestAnimationFrame = (fn) => { queued.push(fn); return queued.length; };
  globalThis.cancelAnimationFrame = () => { queued = []; };
  const stats = {};
  const watch = createShiftWatch();
  const life = createLifecycle();
  try {
    watch.start({ stats, lifecycle: life, enabled: false });
    assert.equal(made.length, 0);
    assert.equal(watch.enabled, false);
    assert.equal(stats.perf, undefined);
    assert.equal(stats.shifts, null);
    watch.watchMount();
    assert.equal(queued.length, 0);

    watch.start({ stats, lifecycle: life, enabled: true });
    assert.equal(made.length, 1);
    assert.equal(made[0].alive, true);
    assert.equal(stats.perf, undefined);
    assert.equal(stats.shifts.failing, 0);

    const mount = {
      classList: { contains() { return false; } },
      querySelector() { return null; },
    };
    watch.watchMount(mount);
    assert.equal(queued.length, 1);
    queued[0]();
    mount.querySelector = () => ({});
    queued[1]();
    assert.equal(typeof stats.shifts.usableAt, "number");

    const fresh = createShiftWatch();
    const bag = {};
    fresh.start({ stats: bag, enabled: true });
    fresh.markUsable(100);
    fresh.ingest(shift(0.2, 40, { region: "cards" }));
    fresh.ingest(shift(0.3, 140, { region: "chrome" }));
    fresh.ingest(shift(0.9, 160, { region: "panel", hadRecentInput: true }));
    assert.equal(bag.shifts.failing, 1);
    assert.equal(bag.shifts.cards, 1);
    assert.equal(bag.shifts.chrome, 1);
    assert.equal(bag.shifts.before, 1);
    assert.equal(bag.shifts.after, 2);
    assert.equal(bag.perf, undefined);
    fresh.stop();

    delete globalThis.__PXD_SHIFT_DEBUG;
    globalThis.__PXD_SHIFT_DEBUG = true;
    const debugStats = {};
    const debug = createShiftWatch();
    const before = made.length;
    debug.start({ stats: debugStats, enabled: false });
    assert.equal(debug.enabled, true);
    assert.equal(made.length, before + 1);
    debug.stop();

    await life.dispose();
    assert.equal(made[0].alive, false);
    assert.equal(watch.enabled, false);
    assert.equal(stats.shifts, null);
    assert.equal(stats.perf, undefined);
  } finally {
    globalThis.PerformanceObserver = previousPO;
    globalThis.requestAnimationFrame = previousRaf;
    globalThis.cancelAnimationFrame = previousCancel;
    if (previousDebug === undefined) delete globalThis.__PXD_SHIFT_DEBUG;
    else globalThis.__PXD_SHIFT_DEBUG = previousDebug;
  }
});

test("the gate fails one after-usable shift and ignores a missing sample", () => {
  const passing = {
    main: { longMs: 0, frames: 10 },
    sidebar: { loadedLongMs: 0, parkedLongMs: 0, boardLongMs: 0, outlineAfter2s: 0 },
    typing: { mountedMedian: 0.4, parkedMedian: 0.05 },
    pointerup: { listeners: 1, boards: 1 },
    dataCalls: 18,
  };
  const quiet = judge(passing);
  assert.equal(quiet.ok, true);
  const row = quiet.extra.find((entry) => entry.id === "layout-shift after usable");
  assert.equal(row.metric, "shifts");
  assert.equal(row.value, 0);
  assert.equal(row.limit, 0);
  assert.equal(row.ok, true);
  assert.match(formatTable(quiet), /layout-shift after usable \| shifts \| 0 \| <= 0 \| pass/);
  assert.match(planText("Readwisenotes - "), /layout-shift after usable/);

  const zero = judge({ ...passing, layoutShiftsAfterUsable: 0 });
  assert.equal(zero.ok, true);
  const one = judge({ ...passing, layoutShiftsAfterUsable: 1 });
  assert.equal(one.ok, false);
  assert.equal(one.extra.find((entry) => entry.id === "layout-shift after usable").ok, false);
  const broken = judge({ ...passing, layoutShiftsAfterUsable: null });
  assert.equal(broken.ok, false);
});

test("coverModel stays the same shape, and the outer box honors w and h", () => {
  assert.deepEqual(coverModel({ title: "Paper", url: "https://example.test/a.pdf", count: 2 }), {
    title: "Paper",
    count: 2,
    label: "2 highlights",
  });
  const box = coverOuterBox({ title: "Paper", w: 240, h: 160, count: 2 });
  assert.deepEqual(Object.keys(coverModel({ count: 0 })).sort(), ["count", "label", "title"]);
  assert.equal(box.title, "Paper");
  assert.equal(box.w, 240);
  assert.equal(box.h, 160);
  assert.equal(coverOuterBox({}).w, PDF_READER_W);
  assert.equal(coverOuterBox({ w: 0, h: -3 }).h, PDF_READER_H);
});

function raw(children) {
  return {
    ":block/uid": "boardfast6",
    ":block/string": "{{[[diagram]]:Shifts}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

function child(uid, string, order, plexus = {}, children = []) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": order * 260, ":y": 0, ":w": 240, ":h": 160, ...plexus } },
    ":block/children": children,
  };
}

function mount(children, { pageOutline = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const writes = [];
  const host = {
    renderString(node, string) { node.textContent = string; },
    renderBlock(node, uid) {
      if (uid === "videocard1" || uid === "rowvideo1") node.append(doc.createElement("video"));
      else node.textContent = uid;
    },
    unmount() {},
    blockString() { return ""; },
    pdfCover() { return coverModel({ count: 0 }); },
    pageOutline,
    updateProps() { writes.push("host.updateProps"); },
  };
  const session = {
    updateProps() { writes.push("session.updateProps"); },
    setString() { writes.push("session.setString"); },
    setBlockOpen() { writes.push("session.setBlockOpen"); },
  };
  const board = buildBoard(raw(children), { resolve: () => "" });
  const r = createItemRenderer({
    doc,
    host,
    session,
    itemsLayer,
    sectionsLayer,
    timers: { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } },
  });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 30) idleQueue.shift()({ timeRemaining: () => 10 });
  };
  r.sync({ board, rects: worldRects(board), structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
  flush();
  return { root, r, writes, flush, restore };
}

test("opening a poster keeps the card height and the same outer box", () => {
  const f = mount([child("videocard1", VIDEO, 0)]);
  try {
    const card = f.root.querySelector("[data-uid=videocard1]");
    const before = card.style.height;
    const poster = card.querySelector(".pxd-embed-poster");
    assert.equal(poster.style.width, "240px");
    assert.equal(poster.style.height, "160px");
    card.querySelector("button.pxd-embed-open").click();
    const live = card.querySelector(".pxd-embed-live");
    assert.equal(live.style.width, poster.style.width);
    assert.equal(live.style.height, poster.style.height);
    const delta = Math.abs(parseFloat(card.style.height) - parseFloat(before));
    assert.ok(delta <= 1, `card height ${before} -> ${card.style.height}`);
    assert.deepEqual(f.writes, []);
  } finally {
    f.r.dispose();
    f.restore();
  }
});

test("a page row reserves its height before the live upgrade", () => {
  const f = mount([
    child("pagecard1", "[[Lab Page]]", 0, { ":w": 320, ":h": 240 }),
  ], {
    pageOutline() {
      return {
        uid: "labpage1",
        title: "Lab Page",
        exists: true,
        blocks: [
          child("rowplain1", "Hello row", 0),
          child("rowvideo1", VIDEO, 1),
        ],
      };
    },
  });
  try {
    const card = f.root.querySelector("[data-uid=pagecard1]");
    const before = card.style.height;
    const plain = card.querySelector("[data-pxd-row=rowplain1]");
    assert.equal(plain.style.minHeight, "22px");
    const videoRow = card.querySelector("[data-uid=rowvideo1]");
    assert.equal(videoRow.style.minHeight, `${PDF_READER_H}px`);
    const poster = videoRow.querySelector(".pxd-embed-poster");
    const posterBox = { w: poster.style.width, h: poster.style.height };
    assert.equal(posterBox.h, `${PDF_READER_H}px`);
    assert.equal(posterBox.w, `${PDF_READER_W}px`);
    videoRow.querySelector("button.pxd-embed-open").click();
    const live = card.querySelector(".pxd-embed-live");
    assert.equal(live.style.height, posterBox.h);
    assert.equal(live.style.width, posterBox.w);
    const delta = Math.abs(parseFloat(card.style.height) - parseFloat(before));
    assert.ok(delta <= 1, `page card height ${before} -> ${card.style.height}`);
    assert.deepEqual(f.writes, []);
  } finally {
    f.r.dispose();
    f.restore();
  }
});

test("the page chip row reserves its height before the chips attach", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const cache = createCardCache();
    cache.setBoard("b1", "P18 fixture", [{ uid: "card", target: "page1" }]);
    const chips = createCardChips({
      doc: stub.document,
      cache,
      pageUid: () => "page1",
      onOpen() {},
      onPreview: () => ({ title: "P18 fixture", section: "Notes", svg: stub.document.createElement("svg") }),
    });
    const page = stub.document.createElement("div");
    page.className = "roam-article";
    const title = stub.document.createElement("h1");
    title.className = "rm-title-display";
    const kids = stub.document.createElement("div");
    kids.className = "rm-block-children";
    kids.append(stub.document.createElement("div"));
    page.append(title, kids);
    stub.document.body.append(page);
    chips.scan(page);
    const row = kids.querySelector(".pxd-cardchip-row");
    assert.equal(row.className, "pxd-cardchip-row");
    assert.equal(row.style.height, "28px");
    assert.equal(row.style.minHeight, "28px");
    assert.equal(row.style.boxSizing, "border-box");
    assert.equal(row.style.overflow, "hidden");
    assert.equal(row.querySelectorAll(".pxd-cardchip").length, 1);
    cache.setBoard("b2", "Other", [{ uid: "card2", target: "page1" }]);
    chips.scan(page);
    assert.equal(row.style.height, "28px");
    assert.equal(row.querySelectorAll(".pxd-cardchip").length, 2);

    const block = stub.document.createElement("div");
    block.className = "roam-block-container";
    block.setAttribute("data-block-uid", "block1");
    stub.document.body.append(block);
    cache.setBoard("b1", "P18 fixture", [{ uid: "c1", target: "block1" }]);
    chips.scan(block);
    assert.equal(block.querySelector(".pxd-cardchip-row"), null);
    const blockChip = block.querySelector(".pxd-cardchip");
    assert.ok(blockChip);
    assert.equal(blockChip.style.height, undefined);
    assert.equal(blockChip.style.minHeight, undefined);
    chips.dispose();
  } finally {
    restore();
  }
});
