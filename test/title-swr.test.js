// Stale-while-revalidate PDF titles: a title read by an older splitter is shown until a fresh read replaces it,
// and the re-read runs (offscreen too, after a late pdf.js, with bounded retries).
import assert from "node:assert/strict";
import test from "node:test";

import { COVER_LS_KEY, createCoverStore } from "../src/host/cover-store.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { WARM_AFTER_MS, warmPlan } from "../src/model/pdf-cover.js";
import { TITLE_REV } from "../src/model/title-cap.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createPdfWarm, needsPageTitle } from "../src/view/pdf-warm.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const IMG = "data:image/jpeg;base64,AAAA";

function lsStore(seed) {
  const stub = createDomStub();
  if (seed) stub.localStorage.setItem(COVER_LS_KEY, JSON.stringify({ order: seed.map((r) => r.url), items: Object.fromEntries(seed.map((r) => [r.url, r])) }));
  const store = createCoverStore({ indexedDB: null, storage: stub.localStorage });
  const puts = [];
  const put = store.put.bind(store);
  store.put = (record) => { puts.push(record); return put(record); };
  return { stub, store, puts };
}

function warmRig(store, renderFirst) {
  const stub = createDomStub();
  const root = stub.document.createElement("div");
  stub.document.body.append(root);
  const timers = { setTimeout: (fn, ms) => Number(setTimeout(fn, ms)), clearTimeout: (id) => clearTimeout(id) };
  return createPdfWarm({ doc: stub.document, root, host: { renderBlock() {}, unmount() {} }, store, renderFirst, timers });
}

const URL1 = "https://example.test/old.pdf";
const staleSeed = () => [{ url: URL1, hash: "", first: IMG, w: 10, h: 12, pageCount: 3, pageTitle: "Old splitter title", titleLines: ["Old splitter title"], ts: 1 }];

test("a stored title from an older splitter is returned, marked stale, and still needs a read", async () => {
  const { store } = lsStore(staleSeed());
  const got = await store.get(URL1);
  assert.equal(got.pageTitle, "Old splitter title");
  assert.equal(got.titleStale, true);
  assert.equal(needsPageTitle(got), true);
  await store.put({ ...got, pageTitle: "Fresh", titleRev: TITLE_REV });
  const fresh = await store.get(URL1);
  assert.equal(fresh.titleStale, false);
  assert.equal(needsPageTitle(fresh), false);
});

test("a fresh read replaces a stale title and is stored at TITLE_REV", async () => {
  const { store } = lsStore(staleSeed());
  const warm = warmRig(store, async () => ({ pageCount: 3, pageTitle: "Fresh title", titleLines: ["Fresh title"] }));
  const got = await warm.request({ uid: "c1", blockUid: "b1", url: URL1 });
  assert.equal(got.pageTitle, "Fresh title");
  assert.equal(got.titleStale, false);
  const kept = await store.get(URL1);
  assert.equal(kept.pageTitle, "Fresh title");
  assert.equal(kept.titleRev, TITLE_REV);
  assert.ok(kept.first, "the image is kept");
});

test("a failed read over a stale title stores nothing: the old title stays", async () => {
  const { store, puts } = lsStore(staleSeed());
  const warm = warmRig(store, async () => null);
  await warm.request({ uid: "c1", blockUid: "b1", url: URL1 });
  assert.equal(puts.length, 0);
  const kept = await store.get(URL1);
  assert.equal(kept.pageTitle, "Old splitter title");
  assert.equal(kept.titleStale, true, "still read again later");
});

test("a fresh empty answer over a stale title keeps the old title and accepts it", async () => {
  const { store } = lsStore(staleSeed());
  const warm = warmRig(store, async () => ({ pageCount: 3, pageTitle: "", titleLines: [] }));
  await warm.request({ uid: "c1", blockUid: "b1", url: URL1 });
  const kept = await store.get(URL1);
  assert.equal(kept.pageTitle, "Old splitter title", "never replaced by nothing");
  assert.equal(kept.titleRev, TITLE_REV);
  assert.equal(needsPageTitle(kept), false, "not read again");
});

test("a busy renderer over a stale title stores nothing and spends no slot", async () => {
  const { store, puts } = lsStore(staleSeed());
  const warm = warmRig(store, async () => ({ busy: true }));
  await warm.request({ uid: "c1", blockUid: "b1", url: URL1 });
  assert.equal(puts.length, 0);
  assert.equal(warm.spent(), 0);
});

test("warmPlan: a covered card that only needs its title warms offscreen when asked, visible cards first", () => {
  const base = { sinceOpenMs: WARM_AFTER_MS + 1, done: 0 };
  const off = { uid: "c1", blockUid: "b1", kind: "pdf", hasCover: true, needsTitle: true };
  const vis = { uid: "c2", blockUid: "b2", kind: "pdf", hasCover: false };
  assert.equal(warmPlan({ ...base, visible: new Set(), cards: [off] }), null, "off by default");
  assert.deepEqual(warmPlan({ ...base, visible: new Set(), cards: [off], offscreenTitles: true }), { uid: "c1", blockUid: "b1" });
  assert.deepEqual(warmPlan({ ...base, visible: new Set(["c2"]), cards: [off, vis], offscreenTitles: true }), { uid: "c2", blockUid: "b2" });
  assert.equal(warmPlan({ ...base, visible: new Set(), cards: [{ ...off, needsTitle: false }], offscreenTitles: true }), null, "an offscreen cover is never drawn");
});

// ------------------------------------------------------------------ board view
const BOARD = "board0001";

function pdfLib({ onGet } = {}) {
  const calls = { get: 0 };
  const lib = {
    GlobalWorkerOptions: { workerSrc: "w.js" },
    getDocument() {
      calls.get += 1;
      onGet?.();
      // Page 1 has no text: readPageTitle answers "", which is a real (empty) read.
      const pdf = { numPages: 1, getPage: async () => { throw new Error("no page"); }, getMetadata: async () => ({ info: {} }), destroy() {} };
      return { promise: Promise.resolve(pdf), destroy() {} };
    },
  };
  return { lib, calls };
}

function mountView({ cards, seed, settings = { "pdf-cover-warm": true }, pdfjs = null } = {}) {
  const stub = createDomStub();
  const restoreDom = stub.install();
  const realNow = Date.now;
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
  stub.localStorage.setItem(COVER_LS_KEY, JSON.stringify({ order: seed.map((r) => r.url), items: Object.fromEntries(seed.map((r) => [r.url, r])) }));
  if (pdfjs) stub.window.pdfjsLib = pdfjs;
  const children = cards.map(([uid, string, x], order) => ({
    ":block/uid": uid, ":block/string": string, ":block/order": order,
    ":block/props": { ":plexus": { ":x": x, ":y": 40, ":w": 240, ":h": 320 } }, ":block/children": [],
  }));
  const board = buildBoard({ ":block/uid": BOARD, ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": children }, { resolve: () => "", propsOf: () => null });
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
    on() { return () => {}; }, emit() {}, release() {}, setLinkMode() {},
    setBoard(next) { session.board = next; session.rects = worldRects(next); },
  };
  for (const name of ["commitMove", "commitRects", "createCard", "addRefCards", "setString"]) session[name] = () => Promise.resolve(`${name}-uid`);
  const strings = new Map(cards.map(([uid, string]) => [uid, string]));
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString: (uid) => strings.get(uid) ?? null,
    pageUid: () => "pgBeta001",
    openBlock() {}, openInSidebar() {},
    searchPages: () => [], searchBlocks: () => [], related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    blockPageUid: () => "", pdfPageUrl: () => "",
    pdfCover: () => ({ title: "", pageUid: "pagepdf01", count: 0 }),
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  mountEl._rect = { left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700, x: 0, y: 0 };
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: (key) => settings[key] }, version: "3.7.0", autofocus: true });
  const flush = () => { stub.flushFrames(); stub.flushIdle(); stub.flushFrames(); };
  flush();
  return {
    stub, view, flush, root: view.root, skew: (ms) => { skew = ms; },
    header: (uid) => view.root.querySelector(`[data-uid=${uid}] .pxd-item__header`)?.textContent || "",
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

const PDF_A = "https://example.com/a.pdf";
const PDF_B = "https://example.com/b.pdf";
const seedOf = (url, title) => ({ url, hash: "", first: `data:image/jpeg;base64,${Buffer.from("seed").toString("base64")}`, last: null, lastPage: null, pageCount: 4, w: 120, h: 160, pageTitle: title, titleLines: [title], ts: 1 });

test("view: a stale stored title is shown at once, never 'PDF'", async () => {
  const { lib } = pdfLib();
  const f = mountView({ cards: [["pdfcard01", `{{[[pdf]]: ${PDF_A}}}`, 40]], seed: [seedOf(PDF_A, "LLaMA: Open and Efficient Foundation Language Models")], pdfjs: lib, settings: {} });
  try {
    await cycle(f, 4);
    assert.equal(f.header("pdfcard01"), "LLaMA: Open and Efficient Foundation Language Models");
  } finally { f.restore(); }
});

test("view: an offscreen card with a stale title is re-read, and keeps its title through an empty answer", async () => {
  const { lib, calls } = pdfLib();
  const f = mountView({
    cards: [["pdfcard01", `{{[[pdf]]: ${PDF_A}}}`, 40], ["pdfcard02", `{{[[pdf]]: ${PDF_B}}}`, 6000]],
    seed: [seedOf(PDF_A, "Visible paper"), seedOf(PDF_B, "Offscreen paper")],
    pdfjs: lib,
  });
  try {
    await cycle(f, 3);
    f.skew(0);
    await cycle(f, 30);
    const probe = f.view.pdfProbe().covers;
    assert.ok(probe.firstPage.tried >= 2, `both titles were read (tried ${probe.firstPage.tried}, ${probe.why})`);
    const titles = Object.fromEntries(probe.titles.map((t) => [t.url, t]));
    assert.equal(titles["le.com/b.pdf"]?.title, "Offscreen paper", JSON.stringify(probe.titles));
    assert.equal(titles["le.com/b.pdf"]?.stale, false, "accepted after the fresh read");
    assert.equal(f.header("pdfcard01"), "Visible paper");
    const stored = JSON.parse(f.stub.localStorage.getItem(COVER_LS_KEY)).items[PDF_B];
    assert.equal(stored.titleRev, TITLE_REV);
    assert.equal(stored.pageTitle, "Offscreen paper");
    const before = calls.get;
    await cycle(f, 30);
    assert.equal(calls.get, before, "a fresh title is not read again");
  } finally { f.restore(); }
});

test("view: pdf.js that turns up after the first look still gets the title read", async () => {
  const { lib } = pdfLib();
  const f = mountView({ cards: [["pdfcard01", `{{[[pdf]]: ${PDF_A}}}`, 40]], seed: [seedOf(PDF_A, "Late paper")] });
  try {
    await cycle(f, 3);
    f.skew(0);
    await cycle(f, 4);
    assert.equal(f.view.pdfProbe().covers.firstPage, null, "no renderer yet");
    f.stub.window.pdfjsLib = lib;
    await cycle(f, 30);
    const probe = f.view.pdfProbe().covers;
    assert.ok(probe.firstPage?.tried >= 1, `read after pdf.js appeared (${probe.why})`);
    assert.equal(f.header("pdfcard01"), "Late paper");
  } finally { f.restore(); }
});

test("view: failing reads over a stale title are bounded and the title stays", async () => {
  const lib = {
    GlobalWorkerOptions: { workerSrc: "w.js" },
    getDocument: () => ({ promise: Promise.reject(new Error("offline")), destroy() {} }),
  };
  const f = mountView({ cards: [["pdfcard01", `{{[[pdf]]: ${PDF_A}}}`, 40]], seed: [seedOf(PDF_A, "Kept paper")], pdfjs: lib });
  try {
    await cycle(f, 3);
    let t = 0;
    // Walk the clock past every backoff step.
    for (let i = 0; i < 12; i += 1) { t += 20000; f.skew(t); await cycle(f, 6); }
    const probe = f.view.pdfProbe().covers;
    assert.equal(probe.titles[0].tries, 3, `three title reads, then stop (${probe.why})`);
    assert.equal(f.header("pdfcard01"), "Kept paper");
    const tried = probe.firstPage.tried;
    for (let i = 0; i < 6; i += 1) { t += 60000; f.skew(t); await cycle(f, 6); }
    assert.equal(f.view.pdfProbe().covers.firstPage.tried, tried, "no more reads after the cap");
  } finally { f.restore(); }
});
