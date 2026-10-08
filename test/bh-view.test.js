// Bug-hunt fixes, view side (v3.7.0..59da6b1 items 4, 8, 10, 12): the cover-warm title pass without a renderer,
// a ready cover that stays painted, no layout read without a PDF card, and the header highlight count.
import assert from "node:assert/strict";
import test from "node:test";

import { COVER_LS_KEY } from "../src/host/cover-store.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const BOARD = "board0001";
const PDF_URL = "https://example.com/notes.pdf";
const PDF = `{{[[pdf]]: ${PDF_URL}}}`;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function mountView({ settings = {}, count = () => 0, cards = null, hostOverrides = {}, pdfjs = null } = {}) {
  const stub = createDomStub();
  const restoreDom = stub.install();
  const realNow = Date.now;
  // Cover warm waits 1.5 s, then 400 ms between jobs: shrink real timers and start the clock "10 s ago".
  let skew = -10000;
  Date.now = () => realNow() + skew;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, Math.min(Number(ms) || 0, 4), ...rest);
  const prevReader = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      Promise.resolve(blob?.arrayBuffer?.()).then((buf) => {
        this.result = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;
        this.onload?.();
      }).catch(() => { this.onerror?.(); });
    }
  };
  stub.localStorage.setItem(`plexus-diagram:vp:Svy:${BOARD}`, JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  stub.localStorage.setItem(COVER_LS_KEY, JSON.stringify({
    order: [PDF_URL],
    items: { [PDF_URL]: { url: PDF_URL, hash: "", first: `data:image/jpeg;base64,${Buffer.from("seed").toString("base64")}`, last: null, lastPage: 2, pageCount: 10, w: 120, h: 160, ts: 1 } },
  }));
  if (pdfjs) stub.window.pdfjsLib = pdfjs;
  const children = (cards || [["pdfcard01", PDF]]).map(([uid, string], order) => ({
    ":block/uid": uid, ":block/string": string, ":block/order": order,
    ":block/props": { ":plexus": { ":x": 40 + order * 300, ":y": 40, ":w": 240, ":h": 320 } }, ":block/children": [],
  }));
  const board = buildBoard({ ":block/uid": BOARD, ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": children }, { resolve: () => "", propsOf: () => null });
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
    on() { return () => {}; }, emit() {}, release() {}, setLinkMode() {},
    setBoard(next) { session.board = next; session.rects = worldRects(next); },
  };
  for (const name of ["commitMove", "commitRects", "createCard", "addRefCards", "setString"]) session[name] = () => Promise.resolve(`${name}-uid`);
  const calls = { pdfCover: 0 };
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString: (uid) => (uid === "pdfcard01" ? PDF : null),
    pageUid: () => "pgBeta001",
    openBlock() {}, openInSidebar() {},
    searchPages: () => [], searchBlocks: () => [], related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    blockPageUid: () => "", pdfPageUrl: () => "",
    pdfCover: () => { calls.pdfCover += 1; return { title: "Notes", pageUid: "pagepdf01", count: count() }; },
    ...hostOverrides,
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  mountEl._rect = { left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700, x: 0, y: 0 };
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: (key) => settings[key] }, version: "3.7.0", autofocus: true });
  const flush = () => { stub.flushFrames(); stub.flushIdle(); stub.flushFrames(); };
  flush();
  return {
    stub, view, calls, flush, root: view.root, skew: (ms) => { skew = ms; },
    restore() { view.dispose(); Date.now = realNow; globalThis.setTimeout = realSetTimeout; restoreDom(); if (prevReader) globalThis.FileReader = prevReader; else delete globalThis.FileReader; },
  };
}

async function cycle(f, times) {
  for (let i = 0; i < times; i += 1) {
    f.flush();
    f.stub.flushTimers();
    await tick(0);
    f.flush();
    f.stub.flushMutations?.();
  }
}

test("item 4: with no usable pdf.js, a cached cover without a title is not re-warmed forever", async () => {
  const f = mountView({ settings: { "pdf-cover-warm": true } });
  try {
    await cycle(f, 2);
    f.skew(0);
    await cycle(f, 8);
    const early = f.calls.pdfCover;
    await cycle(f, 40);
    assert.equal(f.calls.pdfCover, early, "no repaint cycles after the retry cap");
  } finally { f.restore(); }
});

test("item 12: the header highlight count follows the card repaint signal", async () => {
  let n = 2;
  const f = mountView({ count: () => n });
  try {
    await cycle(f, 3);
    const label = () => f.root.querySelector("[data-uid=pdfcard01] .pxd-pdf-highlights__count");
    assert.equal(label()?.textContent, "2");
    n = 5;
    f.view.setSettings({ get: (key) => (key === "pdf-cover" ? "last-read" : undefined) });
    f.flush();
    assert.equal(label()?.textContent, "5", "refreshed without a structural sync");
  } finally { f.restore(); }
});

// The lift code is the only caller that looks the dock up by selector: count those lookups.
function spyLift(f) {
  const looked = [];
  const raw = f.root.querySelector.bind(f.root);
  f.root.querySelector = (sel) => { if (/^\.pxd-dock(__bar)?$/.test(sel)) looked.push(sel); return raw(sel); };
  return looked;
}

test("item 10: with a note card selected, wheel pan and zoom read no dock or minimap rect", async () => {
  const f = mountView({ cards: [["notecard01", "plain note"]] });
  try {
    await cycle(f, 2);
    f.view.controller.select(["notecard01"]);
    f.flush();
    const reads = spyLift(f);
    for (let i = 0; i < 5; i += 1) { f.view.restoreViewport({ x: -20 * i, y: -10, zoom: 1 + i / 10 }); f.flush(); }
    await tick(10);
    f.flush();
    assert.deepEqual(reads, [], "no obstacle measured for a note card");
  } finally { f.restore(); }
});

test("item 10: with a PDF card selected, a burst of viewport changes measures once, after the idle gap", async () => {
  const f = mountView();
  try {
    await cycle(f, 2);
    f.view.controller.select(["pdfcard01"]);
    f.flush();
    await tick(10);
    f.flush();
    const reads = spyLift(f);
    for (let i = 0; i < 6; i += 1) { f.view.restoreViewport({ x: -20 * i, y: -10, zoom: 1 }); f.flush(); }
    const during = reads.length;
    assert.equal(during, 0, "no measurement while the wheel is still turning");
    await tick(10);
    f.flush();
    assert.equal(reads.length, 1, "one measurement after the gap");
  } finally { f.restore(); }
});

test("item 8: a title-only warm pass keeps the ready cover painted (never back to the skeleton)", async () => {
  const lib = { GlobalWorkerOptions: { workerSrc: "w.js" }, getDocument: () => ({ promise: Promise.reject(new Error("no title here")), destroy() {} }) };
  const f = mountView({ settings: { "pdf-cover-warm": true }, pdfjs: lib });
  try {
    await cycle(f, 3);
    const state = () => f.root.querySelector("[data-uid=pdfcard01] [data-cover]")?.getAttribute("data-cover");
    assert.equal(state(), "ready", "the seeded cover is painted before the pass");
    const seen = new Set();
    const make = f.stub.document.createElement.bind(f.stub.document);
    f.stub.document.createElement = (tag) => {
      const node = make(tag);
      const set = node.setAttribute.bind(node);
      node.setAttribute = (name, value) => { if (name === "data-cover") seen.add(value); return set(name, value); };
      return node;
    };
    f.skew(0);
    await cycle(f, 12);
    seen.add(state());
    assert.ok(f.view.pdfProbe().covers.firstPage, "the title-only pass ran through the shared renderer");
    assert.ok(!seen.has("loading"), `the cover never fell back to the skeleton (saw ${[...seen].join(",")})`);
    assert.equal(state(), "ready");
  } finally { f.restore(); }
});
