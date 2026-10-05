// 2.13.0 review fixes in the card renderer: A6/D5 transient classes, B1 reader box, B2 PDF chips, C4 snapshot holder,
// C13 drawing refresh, D12 unmount grace.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { UNMOUNT_GRACE_MS } from "../src/view/offscreen.js";
import { PDF_READER_H, PDF_READER_W } from "../src/model/pdf.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

afterEach(() => { delete globalThis.RoamPlexus; });

const PDF = "{{[[pdf]]: https://example.test/a.pdf}}";
const HL_PROPS = { "pdf-highlight": { type: "text", content: { text: "x" }, position: { boundingRect: { pageNumber: 2 } } } };

function raw(children) {
  return {
    ":block/uid": "boardfix1",
    ":block/string": "{{[[diagram]]:Fix}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}
const child = (uid, string, order, plexus) => ({
  ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": { ":plexus": plexus }, ":block/children": [],
});

function mk({ host: extra = {}, plexus = null, ...opts } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  if (plexus) { globalThis.RoamPlexus = plexus; stub.window.RoamPlexus = plexus; }
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const laters = [];
  const host = {
    renderString(node, string) { node.textContent = string; },
    renderBlock(node) { const box = doc.createElement("div"); box.className = "rm-pdf-container"; node.append(box); },
    unmount() {},
    blockString: () => "",
    pdfCover: () => ({ title: "Paper", count: 0, label: "0 highlights", pageUid: null }),
    pullTree: () => [],
    ...extra,
  };
  const r = createItemRenderer({
    doc, host, session: {}, itemsLayer, sectionsLayer,
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later(fn, ms) { const rec = { fn, ms, off: false }; laters.push(rec); return () => { rec.off = true; }; },
    },
    ...opts,
  });
  const flush = () => { let guard = 0; while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 }); };
  return { stub, restore, doc, root, itemsLayer, r, laters, flush, host };
}
const wide = { x: -100, y: -100, w: 4000, h: 3000 };

test("A6/D5 a re-sync keeps the offscreen, future, fresh and pulse classes on a shell", () => {
  const t = mk();
  try {
    const board = buildBoard(raw([child("cardA0001", "Alpha", 0, { ":x": 0, ":y": 0, ":w": 200, ":h": 100 })]));
    t.r.sync({ board, rects: worldRects(board), structural: true });
    const shell = t.r.shellOf("cardA0001");
    for (const name of ["pxd-item--offscreen", "pxd-item--future", "pxd-item--fresh", "pxd-item--pulse"]) shell.classList.add(name);
    t.r.sync({ board, rects: worldRects(board), dirty: new Set(["cardA0001"]) });
    for (const name of ["pxd-item--offscreen", "pxd-item--future", "pxd-item--fresh", "pxd-item--pulse"]) {
      assert.equal(shell.classList.contains(name), true, name);
    }
    assert.equal(shell.classList.contains("pxd-item"), true);
  } finally { t.restore(); }
});

test("B1 an open PDF reader is culled by its 640x820 box, not by the card rect", () => {
  const t = mk();
  try {
    const board = buildBoard(raw([child("pdfcard01", PDF, 0, { ":x": 0, ":y": 0, ":w": 280, ":h": 160 })]));
    const rects = worldRects(board);
    t.r.sync({ board, rects, structural: true });
    t.r.setLod("detail", 1);
    t.r.openPdf("pdfcard01");
    assert.deepEqual(t.r.drawnRect("pdfcard01"), { ...rects.get("pdfcard01"), w: PDF_READER_W, h: PDF_READER_H });
    // The camera sees only the lower part of the reader; the 280x160 card is out of it.
    t.r.scheduleContent({ visibleRect: { x: 300, y: 300, w: 200, h: 200 }, zoom: 1, tier: "detail" });
    assert.equal(t.r.shellOf("pdfcard01").classList.contains("pxd-item--offscreen"), false);
    t.flush();
    assert.equal(t.r.mountedUids().includes("pdfcard01"), true);
    t.r.endPdfInteract();
  } finally { t.restore(); }
});

test("B2 a highlight card change re-reads the chips of the PDF card, though that card is not dirty", async () => {
  const reads = [];
  const t = mk({ pdfChips: (item) => { reads.push(item.uid); return []; } });
  try {
    const board = buildBoard(raw([
      child("pdfcard01", PDF, 0, { ":x": 0, ":y": 0, ":w": 280, ":h": 160 }),
      child("hlcard001", "((hlblock01))", 1, { ":x": 400, ":y": 0, ":w": 280, ":h": 160 }),
    ]), {
      resolve: (id) => (id === "hlblock01" ? "text #h/yellow" : null),
      propsOf: () => ({ props: HL_PROPS, string: "text #h/yellow", pageTitle: "a.pdf" }),
    });
    assert.equal(board.items.get("hlcard001").kind, "highlight");
    t.r.sync({ board, rects: worldRects(board), structural: true });
    t.flush();
    await Promise.resolve();
    reads.length = 0;
    t.r.sync({ board, rects: worldRects(board), dirty: new Set(["hlcard001"]) });
    assert.equal(reads.includes("pdfcard01"), true);
  } finally { t.restore(); }
});

test("B12 chip rows are read once per card in one turn", () => {
  const reads = [];
  const t = mk({ pdfChips: (item) => { reads.push(item.uid); return []; } });
  try {
    const board = buildBoard(raw([child("pdfcard01", PDF, 0, { ":x": 0, ":y": 0, ":w": 280, ":h": 160 })]));
    t.r.sync({ board, rects: worldRects(board), structural: true });
    t.r.setLod("detail", 1);
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    assert.equal(reads.length <= 1, true, `read ${reads.length} times`);
  } finally { t.restore(); }
});

test("C4 a fallback drawing thumbnail renders in a hidden holder inside the board root and dispose removes it", () => {
  const unmounted = [];
  const t = mk({ host: { blockString: () => "{{[[excalidraw]]}}", unmount: (node) => unmounted.push(node) }, plexus: { apiVersion: 5 } });
  try {
    const board = buildBoard(raw([child("drawref01", "((draw00001))", 0, { ":x": 0, ":y": 0, ":w": 280, ":h": 160 })]), {
      resolve: () => "{{[[excalidraw]]}}",
    });
    assert.equal(board.items.get("drawref01").kind, "drawing-ref");
    t.r.sync({ board, rects: worldRects(board), structural: true });
    t.r.setLod("detail", 1);
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    const holder = t.root.querySelector(".pxd-snap-holder");
    assert.ok(holder, "the holder sits inside .pxd-root");
    assert.equal(Array.from(t.doc.body.children).some((node) => node !== t.root), false, "nothing is appended to the body");
    t.r.dispose();
    assert.equal(t.root.querySelector(".pxd-snap-holder"), null);
    assert.equal(unmounted.length >= 1, true);
  } finally { t.restore(); }
});

test("C13 a drawing-ref card remounts when its drawing's regions change", () => {
  let regions = [{ uid: "reg1", kind: "area", caption: "One" }];
  const listeners = {};
  const t = mk({
    host: { blockString: () => "{{[[excalidraw]]}}" },
    plexus: {
      apiVersion: 7,
      thumbnail: () => null,
      regionsOf: () => regions,
      addEventListener(type, fn) { listeners[type] = fn; },
      removeEventListener() {},
    },
  });
  try {
    const board = buildBoard(raw([child("drawref01", "((draw00001))", 0, { ":x": 0, ":y": 0, ":w": 280, ":h": 160 })]), { resolve: () => "{{[[excalidraw]]}}" });
    t.r.sync({ board, rects: worldRects(board), structural: true });
    t.r.setLod("detail", 1);
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    const shell = t.r.shellOf("drawref01");
    assert.equal(shell.querySelectorAll(".pxd-drawing-region").length, 1);
    regions = [...regions, { uid: "reg2", kind: "area", caption: "Two" }];
    assert.equal(typeof listeners.change, "function", "the renderer listens to the region api");
    listeners.change({ uid: "draw00001" });
    t.flush();
    assert.equal(t.r.shellOf("drawref01").querySelectorAll(".pxd-drawing-region").length, 2);
  } finally { t.restore(); }
});

test("D12 a body past the grace unmounts through unmountDue, and one inside it stays", () => {
  const t = mk();
  const realNow = Object.getOwnPropertyDescriptor(globalThis, "performance");
  let clock = 1000;
  Object.defineProperty(globalThis, "performance", { value: { now: () => clock }, configurable: true, writable: true });
  try {
    const board = buildBoard(raw([child("cardA0001", "Alpha", 0, { ":x": 0, ":y": 0, ":w": 200, ":h": 100 })]));
    t.r.sync({ board, rects: worldRects(board), structural: true });
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    assert.equal(t.r.mountedUids().includes("cardA0001"), true);
    t.r.scheduleContent({ visibleRect: { x: 9000, y: 9000, w: 10, h: 10 }, zoom: 1, tier: "detail" });
    const timer = t.laters.find((rec) => rec.ms === UNMOUNT_GRACE_MS && !rec.off);
    assert.ok(timer, "the grace timer is armed");
    clock += UNMOUNT_GRACE_MS - 500;
    timer.fn();
    assert.equal(t.r.mountedUids().includes("cardA0001"), true, "inside the grace");
    const again = t.laters.filter((rec) => rec.ms === UNMOUNT_GRACE_MS && !rec.off).pop();
    clock += UNMOUNT_GRACE_MS;
    again.fn();
    assert.equal(t.r.mountedUids().includes("cardA0001"), false, "past the grace");
  } finally {
    if (realNow) Object.defineProperty(globalThis, "performance", realNow);
    t.restore();
  }
});
