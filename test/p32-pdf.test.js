// P32: PDF on the board, round 2. Covers at every tier, page 1 without a reader (pdf.js path), page
// width in the pane, one open per highlight click, no inline reader on select, the single-tab strip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COVER_LS_KEY } from "../src/host/cover-store.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { FIT_GUTTER, FIT_MAX_CLICKS, fitWidthStep, fitsWidth, pdfDocumentFromFiber, viewerFromFiber } from "../src/model/read-pane-model.js";
import { settingsDefaults } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createItemRenderer } from "../src/view/cards.js";
import { buildMenu } from "../src/view/menu-model.js";
import { FIRST_PAGE_TIMEOUT_MS, createFirstPageRenderer, createPdfMetaLookup, detectPdfjs, firstPageAllowed } from "../src/view/pdf-first-page.js";
import { createPdfWarm } from "../src/view/pdf-warm.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const BOARD = "board0001";
const PDF_URL = "https://example.com/notes.pdf";
const PDF = `{{[[pdf]]: ${PDF_URL}}}`;
const HL = "hlmark001";
const PAGE = "pagepdf01";
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- pdf-first-page ----------

function fakeTimers() {
  let next = 1;
  const items = [];
  return {
    items,
    setTimeout(fn, ms) { const id = next; next += 1; items.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout(id) { const item = items.find((t) => t.id === id); if (item) item.cleared = true; },
    flush(ms) {
      const due = items.filter((t) => !t.cleared && t.ms === ms);
      for (const t of due) t.cleared = true;
      for (const t of due) t.fn();
    },
    pending(ms) { return items.filter((t) => !t.cleared && t.ms === ms).length; },
  };
}

function fakeLib({ pages = 9, width = 612, height = 792, hang = false, fail = false } = {}) {
  const log = [];
  const lib = {
    version: "3.11.174",
    GlobalWorkerOptions: { workerSrc: "https://roamresearch.com/pdf.worker.js" },
    getDocument(spec) {
      log.push(["getDocument", spec.url]);
      const pdf = {
        numPages: pages,
        getPage(n) {
          log.push(["getPage", n]);
          return Promise.resolve({
            getViewport({ scale }) { return { width: width * scale, height: height * scale }; },
            render({ canvasContext, viewport }) {
              log.push(["render", Math.round(viewport.width), Math.round(viewport.height)]);
              canvasContext.fillRect?.(0, 0, viewport.width, viewport.height);
              return { promise: Promise.resolve(), cancel() { log.push(["cancel"]); } };
            },
          });
        },
        destroy() { log.push(["destroy"]); },
      };
      return {
        promise: fail ? Promise.reject(new Error("bad pdf")) : hang ? new Promise(() => {}) : Promise.resolve(pdf),
        destroy() { log.push(["task.destroy"]); },
      };
    },
  };
  return { lib, log };
}

function canvasDoc() {
  const stub = createDomStub();
  const doc = stub.document;
  const orig = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const node = orig(tag);
    if (String(tag).toLowerCase() !== "canvas") return node;
    node.getContext = () => ({ fillRect() {} });
    node.toBlob = (cb, type) => { cb(new Blob([`page1-${node.width}x${node.height}`], { type })); };
    return node;
  };
  return doc;
}

test("P32-2: detectPdfjs finds Roam's global only with getDocument and a worker", () => {
  assert.equal(detectPdfjs(null), null);
  assert.equal(detectPdfjs({}), null);
  assert.equal(detectPdfjs({ pdfjsLib: { version: "x" } }), null);
  const noWorker = detectPdfjs({ pdfjsLib: { getDocument() {}, GlobalWorkerOptions: {} } });
  assert.equal(noWorker.key, "pdfjsLib");
  assert.equal(noWorker.workerReady, false);
  const { lib } = fakeLib();
  const found = detectPdfjs({ "pdfjs-dist/build/pdf": lib });
  assert.equal(found.key, "pdfjs-dist/build/pdf");
  assert.equal(found.workerReady, true);
  assert.equal(found.version, "3.11.174");
  const port = detectPdfjs({ PDFJS: { getDocument() {}, GlobalWorkerOptions: { workerPort: {} } } });
  assert.equal(port.workerReady, true);
});

test("P32-2: firstPageAllowed takes http(s) and blob, never .enc or empty", () => {
  assert.equal(firstPageAllowed(PDF_URL), true);
  assert.equal(firstPageAllowed("blob:https://roamresearch.com/abc"), true);
  assert.equal(firstPageAllowed("https://firebasestorage.googleapis.com/x/y.pdf.enc?alt=media"), false);
  assert.equal(firstPageAllowed("https://x/y.pdf.ENC"), false);
  assert.equal(firstPageAllowed("data:application/pdf;base64,AAAA"), false);
  assert.equal(firstPageAllowed(""), false);
  assert.equal(firstPageAllowed(null), false);
});

test("P32-2: the renderer draws page 1 at the cover width, destroys the document, and reports", async () => {
  const { lib, log } = fakeLib();
  const timers = fakeTimers();
  const r = createFirstPageRenderer({ doc: canvasDoc(), lib, timers });
  const shot = await r.render({ url: PDF_URL, maxW: 320 });
  assert.equal(shot.w, 320);
  assert.equal(shot.h, 414);
  assert.equal(shot.pageCount, 9);
  assert.equal(await shot.blob.text(), "page1-320x414");
  assert.deepEqual(log, [["getDocument", PDF_URL], ["getPage", 1], ["render", 320, 414], ["destroy"], ["task.destroy"]]);
  assert.equal(timers.pending(FIRST_PAGE_TIMEOUT_MS), 0, "the kill timer is cleared");
  assert.deepEqual({ ...r.report(), lastMs: 0 }, { tried: 1, ok: 1, failed: 0, lastMs: 0 });
  assert.equal(r.busy(), false);
});

test("P32-2: a sharp maxW scales a PDF-point page up instead of stopping at the point width", async () => {
  const { lib, log } = fakeLib({ width: 595, height: 792 });
  const r = createFirstPageRenderer({ doc: canvasDoc(), lib, timers: fakeTimers() });
  const shot = await r.render({ url: PDF_URL, maxW: 1600 });
  assert.equal(shot.w, 1600);
  assert.equal(shot.h, 2130);
  assert.equal(await shot.blob.text(), "page1-1600x2130");
  assert.deepEqual(log.filter((row) => row[0] === "render"), [["render", 1600, 2130]]);
});

test("P32-2: a second render while one is in flight resolves null, and the timeout destroys", async () => {
  const { lib, log } = fakeLib({ hang: true });
  const timers = fakeTimers();
  const r = createFirstPageRenderer({ doc: canvasDoc(), lib, timers });
  const first = r.render({ url: PDF_URL });
  assert.equal(r.busy(), true);
  assert.equal(await r.render({ url: PDF_URL }), null);
  assert.equal(timers.pending(FIRST_PAGE_TIMEOUT_MS), 1);
  timers.flush(FIRST_PAGE_TIMEOUT_MS);
  assert.equal(await first, null);
  assert.ok(log.some((row) => row[0] === "task.destroy"));
  assert.equal(r.report().failed, 1);
  assert.equal(r.busy(), false);
});

test("P32-2: a failing document, an .enc url, or a missing lib resolve null without throwing", async () => {
  const { lib } = fakeLib({ fail: true });
  const r = createFirstPageRenderer({ doc: canvasDoc(), lib, timers: fakeTimers() });
  assert.equal(await r.render({ url: PDF_URL }), null);
  assert.equal(await r.render({ url: "https://x/y.pdf.enc" }), null);
  assert.equal(r.report().tried, 1, ".enc never counts as a try");
  const none = createFirstPageRenderer({ doc: canvasDoc(), lib: null, timers: fakeTimers() });
  assert.equal(await none.render({ url: PDF_URL }), null);
});

test("P32-2: metadata title is cached per url and does not take the page-1 lock", async () => {
  const docs = [];
  const lib = {
    getDocument(spec) {
      docs.push(spec.url);
      const pdf = {
        getMetadata() {
          return Promise.resolve({ info: { Title: spec.url.includes("nature") ? "Nature methods" : "" } });
        },
        destroy() { docs.push("destroy"); },
      };
      return { promise: Promise.resolve(pdf), destroy() { docs.push("task"); } };
    },
  };
  const lookup = createPdfMetaLookup({ lib });
  const first = lookup.want("https://example.com/nature.pdf");
  const again = lookup.want("https://example.com/nature.pdf");
  assert.equal(again, first);
  assert.equal(await first, "Nature methods");
  assert.equal(lookup.title("https://example.com/nature.pdf"), "Nature methods");
  assert.equal(lookup.want("https://example.com/nature.pdf"), null);
  assert.equal(await lookup.want("https://example.com/empty.pdf"), "");
  assert.equal(lookup.want("https://x/y.pdf.enc"), null);
  assert.equal(docs.filter((row) => row === "https://example.com/nature.pdf").length, 1);
  const page = createFirstPageRenderer({ doc: canvasDoc(), lib: fakeLib().lib, timers: fakeTimers() });
  const meta = createPdfMetaLookup({ lib });
  assert.equal(page.busy(), false);
  assert.equal(await meta.want("https://example.com/nature.pdf"), "Nature methods");
  assert.equal(page.busy(), false);
});

test("P32-2: the first-page module has no graph write, no console, and no document listener", () => {
  const src = readFileSync(new URL("../src/view/pdf-first-page.js", import.meta.url), "utf8");
  assert.equal(src.includes("roamAlphaAPI"), false);
  assert.equal(src.includes("console."), false);
  assert.equal(src.includes("addEventListener"), false);
  assert.equal(src.includes("workerSrc ="), false, "Plexus never sets a worker");
});

// ---------- pdf-warm with the pdf.js path ----------

function warmHarness({ renderFirst } = {}) {
  const stub = createDomStub();
  const doc = stub.document;
  const root = doc.createElement("div");
  doc.body.append(root);
  const rendered = [];
  const map = new Map();
  const store = {
    map,
    async get(url) { return map.get(url) || null; },
    async put(record) { map.set(record.url, record); return record; },
    async remove(url) { map.delete(url); return true; },
  };
  const timers = fakeTimers();
  const warm = createPdfWarm({ doc, root, host: { renderBlock(el, uid) { rendered.push(uid); } }, store, timers, now: () => 42, renderFirst });
  return { stub, doc, root, warm, store, timers, rendered };
}

async function settle(n = 8) {
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("P32-2: a pdf.js page stores as the first cover and mounts no reader", async () => {
  const asked = [];
  const h = warmHarness({
    renderFirst: async (spec) => { asked.push(spec); return { blob: new Blob(["jpg"], { type: "image/jpeg" }), w: 320, h: 414, pageCount: 9 }; },
  });
  const job = h.warm.request({ uid: "card00001", blockUid: "blk000001", url: PDF_URL, hash: "h1" });
  h.timers.flush(0);
  const record = await job;
  assert.equal(record.url, PDF_URL);
  assert.equal(record.pageCount, 9);
  assert.equal(record.w, 320);
  assert.equal(record.hash, "h1");
  assert.equal(record.ts, 42);
  assert.equal(await record.first.text(), "jpg");
  assert.deepEqual(asked.map((s) => [s.url, s.maxW]), [[PDF_URL, 320]]);
  assert.deepEqual(h.rendered, []);
  assert.equal(h.root.querySelector(".pxd-pdf-warm"), null);
  assert.equal(h.warm.outcome("card00001"), "ready");
  assert.deepEqual(h.warm.report(), { spent: 1, pending: 0, paths: { pdfjs: 1, reader: 0 } });
});

test("P32-2: a null pdf.js result falls through to the hidden reader, and .enc skips pdf.js", async () => {
  let calls = 0;
  const h = warmHarness({ renderFirst: async () => { calls += 1; return null; } });
  h.warm.request({ uid: "card00001", blockUid: "blk000001", url: PDF_URL });
  h.timers.flush(0);
  await settle();
  assert.equal(calls, 1);
  assert.deepEqual(h.rendered, ["blk000001"]);
  assert.ok(h.root.querySelector(".pxd-pdf-warm"));
  assert.deepEqual(h.warm.report().paths, { pdfjs: 0, reader: 1 });
  h.warm.cancelAll();

  const enc = warmHarness({ renderFirst: async () => { calls += 1; return null; } });
  enc.warm.request({ uid: "card00002", blockUid: "blk000002", url: "https://x/y.pdf.enc?alt=media" });
  enc.timers.flush(0);
  await settle();
  assert.equal(calls, 1, ".enc never asks pdf.js");
  assert.deepEqual(enc.rendered, ["blk000002"]);
  enc.warm.cancelAll();
});

test("P32-2: a cancel during the pdf.js render stores nothing", async () => {
  let release = null;
  const h = warmHarness({ renderFirst: () => new Promise((resolve) => { release = resolve; }) });
  const job = h.warm.request({ uid: "card00001", blockUid: "blk000001", url: PDF_URL });
  h.timers.flush(0);
  await settle();
  h.warm.cancelAll();
  release({ blob: new Blob(["late"]), w: 320, h: 414, pageCount: 2 });
  assert.equal(await job, null);
  await settle();
  assert.equal(h.store.map.size, 0);
  assert.deepEqual(h.rendered, []);
});

// ---------- read-pane-model: page width ----------

test("P32-3: fitsWidth accepts a page within 64px of the viewer and never an overflow", () => {
  assert.equal(fitsWidth({ pageWidth: 595, viewerWidth: 617 }), true);
  assert.equal(fitsWidth({ pageWidth: 469, viewerWidth: 617 }), false);
  assert.equal(fitsWidth({ pageWidth: 640, viewerWidth: 617 }), false);
  assert.equal(fitsWidth({ pageWidth: 0, viewerWidth: 617 }), false);
  assert.equal(fitsWidth({}), false);
});

test("P32-3: fitWidthStep zooms in while the next step still fits, out on overflow, and never ping-pongs", () => {
  assert.equal(FIT_GUTTER, 24);
  assert.equal(FIT_MAX_CLICKS, 8);
  // Live 3.1.0: Roam's fit page gives 469 in a 617 pane; one zoom in gives 595.
  assert.equal(fitWidthStep({ pageWidth: 469, viewerWidth: 617 }), "in");
  assert.equal(fitWidthStep({ pageWidth: 595, viewerWidth: 617, lastPageWidth: 469, clicks: 1, prev: "in" }), "stop");
  // A measured ratio replaces the 1.25 guess.
  assert.equal(fitWidthStep({ pageWidth: 300, viewerWidth: 617, lastPageWidth: 240, clicks: 1, prev: "in" }), "in");
  assert.equal(fitWidthStep({ pageWidth: 500, viewerWidth: 617, lastPageWidth: 400, clicks: 1, prev: "in" }), "stop");
  // Overflow zooms out, once; after an out the step stops.
  assert.equal(fitWidthStep({ pageWidth: 700, viewerWidth: 617 }), "out");
  assert.equal(fitWidthStep({ pageWidth: 700, viewerWidth: 617, prev: "in", clicks: 1 }), "out");
  assert.equal(fitWidthStep({ pageWidth: 560, viewerWidth: 617, prev: "out", clicks: 2 }), "stop");
  assert.equal(fitWidthStep({ pageWidth: 700, viewerWidth: 617, prev: "out", clicks: 2 }), "out");
  // Budget and bad geometry.
  assert.equal(fitWidthStep({ pageWidth: 100, viewerWidth: 617, clicks: 8 }), "stop");
  assert.equal(fitWidthStep({ pageWidth: 0, viewerWidth: 617 }), "stop");
  assert.equal(fitWidthStep({}), "stop");
});

test("P32-3: viewerFromFiber walks up to the instance that owns a pdf.js viewer", () => {
  const viewer = { currentScaleValue: "auto" };
  const leaf = { stateNode: null, return: { stateNode: {}, return: { stateNode: { viewer }, return: null } } };
  assert.equal(viewerFromFiber(leaf), viewer);
  assert.equal(viewerFromFiber({ stateNode: { viewer: {} }, return: null }), null);
  assert.equal(viewerFromFiber(null), null);
  const loop = { stateNode: null };
  loop.return = loop;
  assert.equal(viewerFromFiber(loop), null);
});

test("viewerFromFiber reads getViewer() on the highlighter context (function-component Roam build)", () => {
  const viewer = { currentScaleValue: "0.75", currentScale: 0.75 };
  // Live shape 2026-10-08: .PdfHighlighter div → Provider { value: { getViewer, scrollToHighlight, … } } → X_ { pdfScaleValue }.
  const leaf = { stateNode: {}, memoizedProps: { className: "PdfHighlighter" }, return: {
    stateNode: null, memoizedProps: { value: { getViewer: () => viewer, scrollToHighlight() {} } }, return: {
      stateNode: null, memoizedProps: { pdfScaleValue: 0.75 }, return: null } } };
  assert.equal(viewerFromFiber(leaf), viewer);
  const empty = { stateNode: null, memoizedProps: { value: { getViewer: () => null } }, return: null };
  assert.equal(viewerFromFiber(empty), null, "a viewer that is not mounted yet");
  const throws = { stateNode: null, memoizedProps: { value: { getViewer: () => { throw new Error("x"); } } }, return: null };
  assert.equal(viewerFromFiber(throws), null);
});

test("pdfDocumentFromFiber finds the document on the viewer, on props two levels up, and nowhere else", () => {
  const doc = { getPage() {}, numPages: 3 };
  const viaViewer = { stateNode: null, return: { stateNode: { viewer: { currentScaleValue: "auto", pdfDocument: doc } }, return: null } };
  assert.equal(pdfDocumentFromFiber(viaViewer), doc);
  const viaProps = { stateNode: null, return: { stateNode: null, return: { memoizedProps: { pdfDocument: doc }, return: null } } };
  assert.equal(pdfDocumentFromFiber(viaProps), doc);
  assert.equal(pdfDocumentFromFiber({ stateNode: { props: { pdfDocument: doc } }, return: null }), doc);
  assert.equal(pdfDocumentFromFiber({ memoizedProps: { pdf: doc }, return: null }), doc);
  assert.equal(pdfDocumentFromFiber({ stateNode: {}, memoizedProps: {}, return: { stateNode: null, return: null } }), null);
  assert.equal(pdfDocumentFromFiber(null), null);
  assert.equal(pdfDocumentFromFiber({ memoizedProps: { pdfDocument: { numPages: 3 }, pdf: "x" }, return: null }), null);
  const loop = { memoizedProps: {} };
  loop.return = loop;
  assert.equal(pdfDocumentFromFiber(loop), null);
});

// ---------- cards: the chip ▾ and Shift-click ----------

const TEXT_PROPS = {
  ":pdf-highlight": {
    ":type": "text",
    ":content": { ":text": "selected passage" },
    ":position": { ":boundingRect": { ":pageNumber": 3, ":x1": 1, ":y1": 2, ":x2": 9, ":y2": 4 } },
  },
};

function mountChip({ menu = true } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const opened = [];
  const menus = [];
  const host = {
    renderString(node, string) { node.textContent = string; },
    unmount() {},
    blockString(uid) { return uid === "hltext01" ? "selected passage #h/yellow" : ""; },
  };
  const r = createItemRenderer({
    doc,
    host,
    session: { updateProps() {}, setString() {} },
    itemsLayer,
    sectionsLayer,
    timers: { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } },
    onHighlightOpen(item, opts) { opened.push([item?.uid || "", opts?.mode ?? null]); },
    ...(menu ? { onHighlightMenu(item, anchor) { menus.push([item?.uid || "", anchor?.className || ""]); } } : {}),
  });
  const board = buildBoard({
    ":block/uid": "boardhlp32",
    ":block/string": "{{[[diagram]]:Highlights}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [{
      ":block/uid": "hlcard01",
      ":block/string": "((hltext01))",
      ":block/order": 0,
      ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 240, ":h": 180 } },
      ":block/children": [],
    }],
  }, {
    resolve: (uid) => (uid === "hltext01" ? "selected passage #h/yellow" : ""),
    propsOf: (uid) => (uid === "hltext01" ? { props: TEXT_PROPS, string: "selected passage #h/yellow", pageTitle: "Notes" } : null),
  });
  r.sync({ board, rects: worldRects(board), structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
  let guard = 0;
  while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 });
  return { stub, r, opened, menus, restore() { r.dispose(); restore(); } };
}

test("P32-4: a plain chip click carries no mode, Shift-click carries sidebar, and ▾ opens the menu", () => {
  const ctx = mountChip();
  try {
    const card = ctx.r.shellOf("hlcard01");
    const foot = card.querySelector(".pxd-highlight-chip");
    ctx.stub.dispatch(foot, "click", { shiftKey: false });
    ctx.stub.dispatch(foot, "click", { shiftKey: true });
    assert.deepEqual(ctx.opened, [["hlcard01", ""], ["hlcard01", "sidebar"]]);
    const more = card.querySelector(".pxd-highlight-chip__more");
    assert.equal(more.tagName.toLowerCase(), "button");
    assert.equal(more.getAttribute("aria-haspopup"), "menu");
    assert.equal(more.textContent, "▾");
    const down = ctx.stub.dispatch(more, "pointerdown", { button: 0 });
    assert.equal(down.propagationStopped, true, "the ▾ never starts a drag");
    ctx.stub.dispatch(more, "click");
    assert.deepEqual(ctx.menus, [["hlcard01", "pxd-highlight-chip__more pxd-chrome"]]);
    assert.equal(ctx.opened.length, 2, "the ▾ opens nothing by itself");
  } finally {
    ctx.restore();
  }
});

test("P32-4: without a menu callback the chip has no ▾", () => {
  const ctx = mountChip({ menu: false });
  try {
    assert.equal(ctx.r.shellOf("hlcard01").querySelector(".pxd-highlight-chip__more"), null);
  } finally {
    ctx.restore();
  }
});

// ---------- menu-model and settings ----------

test("P32-5: the card menu offers Read inside the card for PDFs only, and Show the cover while inline", () => {
  const flat = (rows) => rows.flatMap((row) => (row.items ? row.items : [row])).map((row) => [row.id, row.label]);
  const pdf = flat(buildMenu("card", { isPdf: true }));
  assert.ok(pdf.some(([id, label]) => id === "read-inline" && label === "Read inside the card"));
  const inline = flat(buildMenu("card", { isPdf: true, inlineReader: true }));
  assert.ok(inline.some(([id, label]) => id === "read-inline" && label === "Show the cover"));
  assert.equal(flat(buildMenu("card", {})).some(([id]) => id === "read-inline"), false);
});

test("P32-4: the highlight-open setting defaults to reader and takes only reader or sidebar", () => {
  assert.equal(settingsDefaults()["highlight-open"], "reader");
});

// ---------- board view ----------

function pulled(children) {
  return { ":block/uid": BOARD, ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": children };
}

function card(uid, string, order, plexus = {}) {
  return { ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": { ":plexus": { ":x": 40, ":y": 40, ":w": 240, ":h": 320, ...plexus } }, ":block/children": [] };
}

function seedCover(storage) {
  storage.setItem(COVER_LS_KEY, JSON.stringify({
    order: [PDF_URL],
    items: { [PDF_URL]: { url: PDF_URL, hash: "", first: `data:image/jpeg;base64,${Buffer.from("seed").toString("base64")}`, last: null, lastPage: 2, pageCount: 10, w: 120, h: 160, ts: 1 } },
  }));
}

function mountView({ settings = {}, seed = false, hostOverrides = {} } = {}) {
  const stub = createDomStub();
  const restoreDom = stub.install();
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
  if (seed) seedCover(stub.localStorage);
  const children = [card("pdfcard01", PDF, 0), card("hlcard001", `((${HL}))`, 1, { ":x": 400 })];
  const board = buildBoard(pulled(children), {
    resolve(uid) { return uid === HL ? "selected passage #h/yellow" : ""; },
    propsOf(uid) { return uid === HL ? { props: TEXT_PROPS, string: "selected passage #h/yellow", pageTitle: "Notes.pdf" } : null; },
  });
  const handlers = new Map();
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); return () => handlers.get(name).delete(fn); },
    emit() {}, release() {}, setLinkMode() {},
    setBoard(next) { session.board = next; session.rects = worldRects(next); },
  };
  for (const name of ["commitMove", "commitRects", "createCard", "addRefCards", "setString"]) session[name] = () => Promise.resolve(`${name}-uid`);
  const calls = { sidebar: [], main: [], rendered: [] };
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid) { calls.rendered.push([uid, el]); },
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString: (uid) => (uid === "pdfcard01" ? PDF : null),
    pageUid: () => "pgBeta001",
    openBlock(uid) { calls.main.push(uid); },
    openInSidebar(uid, kind) { calls.sidebar.push([uid, kind]); },
    searchPages: () => [], searchBlocks: () => [], related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    blockPageUid: (uid) => (uid === HL ? PAGE : ""),
    pdfPageUrl: (uid) => (uid === PAGE ? PDF_URL : ""),
    pdfCover: () => ({ title: "Notes", pageUid: PAGE }),
    ...hostOverrides,
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: (key) => settings[key] }, version: "3.1.0", autofocus: true });
  const flush = () => { stub.flushFrames(); stub.flushIdle(); stub.flushFrames(); };
  flush();
  return {
    stub, view, host, calls, flush, root: view.root,
    restore() { view.dispose(); restoreDom(); if (prevReader) globalThis.FileReader = prevReader; else delete globalThis.FileReader; },
  };
}

const rowFor = (root, id) => [...root.querySelectorAll(".pxd-menu__item")].find((row) => row.dataset.id === id) || null;
const inCard = (f, uid) => f.calls.rendered.filter(([u, el]) => u === uid && el.closest?.(`[data-uid="${uid}"]`));

test("P32-4: a chip click opens the reader only; Shift-click opens the sidebar only; the setting flips the default", async () => {
  const f = mountView();
  try {
    const chip = () => f.root.querySelector("[data-uid=hlcard001] .pxd-highlight-chip");
    f.stub.dispatch(chip(), "click", { shiftKey: false });
    await tick(0);
    f.flush();
    assert.equal(f.root.querySelector(".pxd-read")?.isConnected, true, "reader pane opened");
    assert.deepEqual(f.calls.sidebar, []);
    assert.deepEqual(f.calls.main, []);

    f.stub.dispatch(chip(), "click", { shiftKey: true });
    await tick(0);
    assert.deepEqual(f.calls.sidebar, [[HL, "block"]]);
    assert.deepEqual(f.calls.main, []);
  } finally {
    f.restore();
  }

  const side = mountView({ settings: { "highlight-open": "sidebar" } });
  try {
    side.stub.dispatch(side.root.querySelector("[data-uid=hlcard001] .pxd-highlight-chip"), "click", { shiftKey: false });
    await tick(0);
    side.flush();
    assert.deepEqual(side.calls.sidebar, [[HL, "block"]]);
    assert.equal(side.root.querySelector(".pxd-read"), null, "no reader open from a sidebar click");
  } finally {
    side.restore();
  }
});

test("P32-4: the chip ▾ lists reader, sidebar and main, and each row fires one open", async () => {
  const f = mountView();
  try {
    const more = f.root.querySelector("[data-uid=hlcard001] .pxd-highlight-chip__more");
    f.stub.dispatch(more, "click");
    const rows = [...f.root.querySelectorAll(".pxd-menu__item")].map((row) => [row.dataset.id, row.textContent]);
    assert.deepEqual(rows.map((r) => r[0]), ["hl-open:reader", "hl-open:sidebar", "hl-open:main"]);
    assert.match(rows[1][1], /Open in sidebar/);
    assert.match(rows[1][1], /Shift Click/);
    rowFor(f.root, "hl-open:main").click();
    await tick(0);
    assert.deepEqual(f.calls.main, [HL]);
    assert.deepEqual(f.calls.sidebar, []);
    assert.equal(f.root.querySelector(".pxd-read"), null);

    f.stub.dispatch(f.root.querySelector("[data-uid=hlcard001] .pxd-highlight-chip__more"), "click");
    rowFor(f.root, "hl-open:sidebar").click();
    await tick(0);
    assert.deepEqual(f.calls.sidebar, [[HL, "block"]]);
    assert.deepEqual(f.calls.main, [HL]);
  } finally {
    f.restore();
  }
});

test("P32-5: selecting, double-clicking or Enter on a PDF card never mounts Roam's reader inside the card", async () => {
  const f = mountView();
  try {
    const shell = f.root.querySelector("[data-uid=pdfcard01]");
    f.view.controller.select(["pdfcard01"]);
    f.flush();
    f.stub.dispatch(shell, "dblclick", { button: 0, clientX: 60, clientY: 60 });
    await tick(0);
    f.flush();
    f.stub.dispatch(f.stub.window, "keydown", { key: "Enter", code: "Enter", altKey: false, metaKey: false, ctrlKey: false, shiftKey: false });
    await tick(0);
    f.flush();
    assert.equal(f.root.querySelector("[data-uid=pdfcard01] .pxd-pdf-reader"), null);
    assert.deepEqual(inCard(f, "pdfcard01"), []);
    assert.equal(f.view.pdfProbe().inline, "");
  } finally {
    f.restore();
  }
});

test("P32-5: Read inside the card is the one way to the inline reader, and Show the cover takes it back", async () => {
  const f = mountView();
  try {
    const shell = f.root.querySelector("[data-uid=pdfcard01]");
    f.stub.dispatch(shell, "contextmenu", { button: 2, clientX: 60, clientY: 60 });
    const row = rowFor(f.root, "read-inline");
    assert.equal(row.textContent.trim(), "Read inside the card");
    row.click();
    await tick(0);
    f.flush();
    assert.equal(f.view.pdfProbe().inline, "pdfcard01");
    assert.ok(f.root.querySelector("[data-uid=pdfcard01] .pxd-pdf-reader"));
    assert.equal(inCard(f, "pdfcard01").length, 1);

    f.stub.dispatch(f.root.querySelector("[data-uid=pdfcard01]"), "contextmenu", { button: 2, clientX: 60, clientY: 60 });
    const back = rowFor(f.root, "read-inline");
    assert.equal(back.textContent.trim(), "Show the cover");
    back.click();
    await tick(0);
    f.flush();
    assert.equal(f.view.pdfProbe().inline, "");
    assert.equal(f.root.querySelector("[data-uid=pdfcard01] .pxd-pdf-reader"), null);
  } finally {
    f.restore();
  }
});

test("P32-5: opening the pane puts an inline card back to its cover", async () => {
  const f = mountView();
  try {
    f.stub.dispatch(f.root.querySelector("[data-uid=pdfcard01]"), "contextmenu", { button: 2, clientX: 60, clientY: 60 });
    rowFor(f.root, "read-inline").click();
    await tick(0);
    f.flush();
    assert.equal(f.view.pdfProbe().inline, "pdfcard01");
    f.stub.dispatch(f.root.querySelector("[data-uid=hlcard001] .pxd-highlight-chip"), "click", { shiftKey: false });
    await tick(0);
    f.flush();
    assert.equal(f.root.querySelector(".pxd-read")?.isConnected, true);
    assert.equal(f.view.pdfProbe().inline, "");
    assert.equal(f.root.querySelector("[data-uid=pdfcard01] .pxd-pdf-reader"), null);
  } finally {
    f.restore();
  }
});

test("P32-1: a ready cover paints map and overview as the page itself, with no <img> and no title", async () => {
  const f = mountView({ seed: true });
  try {
    const ready = async () => {
      for (let i = 0; i < 40; i += 1) {
        f.flush();
        if (f.root.querySelector(".pxd-pdf-cover")?.getAttribute("data-cover") === "ready") return;
        await tick(0);
      }
      assert.fail("cover ready");
    };
    await ready();
    const detail = f.root.querySelector(".pxd-pdf-cover");
    assert.equal(detail.getAttribute("data-cover-img"), "1");
    assert.match(detail.style["--pxd-cover"], /^url\("data:image\/jpeg;base64,/);
    assert.ok(detail.querySelector(".pxd-pdf-img"));

    f.view.setZoom?.(0.3);
    f.view.setLod?.("map");
    f.flush();
    await ready();
    const map = f.root.querySelector(".pxd-pdf-cover");
    assert.equal(map.getAttribute("data-cover-img"), "1");
    assert.equal(map.querySelector(".pxd-pdf-title--face"), null, "map with an image is the page alone");
    const css = readFileSync(new URL("../src/css/pdf-cover.css", import.meta.url), "utf8");
    assert.match(css, /\.pxd-root\.pxd-lod-map \.pxd-pdf-cover\[data-cover-img\] > \.pxd-pdf-paper,\n\.pxd-root\.pxd-lod-overview \.pxd-pdf-cover\[data-cover-img\] > \.pxd-pdf-paper \{[^}]*background-image: var\(--pxd-cover\)/);
  } finally {
    f.restore();
  }
});

test("P32-6: the strip CSS is 28px and reserves nothing while hidden", () => {
  const css = readFileSync(new URL("../src/css/tabs.css", import.meta.url), "utf8");
  assert.match(css, /--pxd-fstabs-h: 28px/);
  assert.match(css, /height: var\(--pxd-fstabs-h, 28px\)/);
  assert.match(css, /margin-top: calc\(var\(--pxd-fstabs-h, 28px\) \+ 8px\)/);
  assert.equal(css.includes("margin-top: 46px"), false);
  const src = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
  assert.match(src, /if \(!isFullscreen \|\| !Array\.isArray\(tabs\) \|\| tabs\.length < 2\)/);
});

test("P32-7: the reading bed is light grey in light mode and the chrome colour in dark", () => {
  const css = readFileSync(new URL("../src/css/read-pane.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \{\n  --pxd-read-bed: #eef0f3;\n\}/);
  assert.match(css, /\.pxd-root\.pxd-root--dark \{\n  --pxd-read-bed: var\(--pxd-chrome-bg, transparent\);\n\}/);
  assert.match(css, /\.pxd-read \.pxd-read__live \.PdfHighlighter \{\n  background: var\(--pxd-read-bed, transparent\);/);
});

test("P32 live fix: an all-white capture is blank and is never stored as a cover", async () => {
  const { isBlankCanvas } = await import("../src/model/pdf-cover.js");
  const canvas = (pixel) => ({ width: 320, height: 427, getContext: () => ({ getImageData: (x, y) => ({ data: pixel(x, y) }) }) });
  assert.equal(isBlankCanvas(canvas(() => [255, 255, 255, 255])), true);
  assert.equal(isBlankCanvas(canvas((x, y) => (x > 100 && y > 100 ? [20, 20, 20, 255] : [255, 255, 255, 255]))), false);
  assert.equal(isBlankCanvas({ width: 0, height: 0 }), false);
});
