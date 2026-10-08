import { TITLE_REV } from "../src/model/title-cap.js";
// Round 2 live: PDF titles at rest (cover-warm page title), the journal-banner rule for metadata and
// page titles, and the OCR raster keeping image smoothing on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCoverStore } from "../src/host/cover-store.js";
import { imageScaling, renderPdfPage, steadyImageScaling } from "../src/host/ocr-web.js";
import { warmPlan, WARM_AFTER_MS } from "../src/model/pdf-cover.js";
import { parsedDocTitle, parsedTitleLines } from "../src/model/pdf.js";
import { parsePageGeometry, quickPageTitle } from "../src/model/parse/index.js";
import { findPageTitle } from "../src/model/parse/title.js";
import { isBannerOf, isMetaBanner } from "../src/model/title-cap.js";
import { loadPageData } from "../src/view/parse-engine.js";
import { createFirstPageRenderer, readPageTitle } from "../src/view/pdf-first-page.js";
import { createPdfWarm, needsPageTitle } from "../src/view/pdf-warm.js";
import { FIX, parseFile } from "./parse-engine-fixtures.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const REPORT = `${FIX}/report.pdf`;

async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

async function openReport() {
  const { getDocument } = await pdfjs();
  return getDocument({ data: new Uint8Array(readFileSync(REPORT)), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
}

function line(text, { size = 10, bold = false, base = 100, x0 = 40, x1 = 400 } = {}) {
  return { words: text.split(" ").map((t) => ({ text: t })), size, bold, base, x0, x1 };
}

test("a journal name inside its running header is a banner; a lone page number is not", () => {
  const header = "Science of the Total Environment 877 (2023) 162730";
  assert.equal(isBannerOf("Science of the Total Environment", header, { exact: false }), true);
  assert.equal(isBannerOf("Science of the Total Environment", "Science of the Total Environment"), true);
  assert.equal(isBannerOf("Science of the Total Environment", "Science of the Total Environment", { exact: false }), false);
  assert.equal(isBannerOf("LLaMA: Open and Efficient Foundation Language Models", "LLaMA: Open and Efficient Foundation Language Models 3", { exact: false }), false);
  assert.equal(isBannerOf("Total Environment", "Science of the Total Environment 877 (2023) 162730", { exact: false }), false, "other words around it");
  assert.equal(isBannerOf("Science of the Total Env", header, { exact: false }), false, "word boundary");
});

test("findPageTitle skips the journal banner and takes the paper title", () => {
  const page = {
    n: 1,
    free: [
      line("Contents lists available at ScienceDirect", { size: 8, base: 70 }),
      line("Science of the Total Environment", { size: 14, base: 101 }),
      line("Novel risk assessment model of food quality and safety considering", { size: 13.5, base: 178, x0: 38, x1: 500 }),
      line("physical-chemical and pollutant indexes based on coefficient of variance", { size: 13.5, base: 195, x0: 38, x1: 500 }),
      line("integrating entropy weight", { size: 13.5, base: 213, x0: 38, x1: 300 }),
      line("Food safety is important for sustainable social development", { size: 7, base: 527 }),
    ],
  };
  const removed = [{ page: 1, reason: "running-header", text: "Science of the Total Environment 877 (2023) 162730" }];
  assert.equal(findPageTitle([page], { bodySize: 7, removed }),
    "Novel risk assessment model of food quality and safety considering physical-chemical and pollutant indexes based on coefficient of variance integrating entropy weight");
  assert.equal(findPageTitle([page], { bodySize: 7, removed: [] }), "Science of the Total Environment", "without the header the biggest type still wins");
});

test("a metadata title that repeats a page-1 banner loses to the page title; a real one is kept", () => {
  const lines = ["Science of the Total Environment 877 (2023) 162730", "Contents lists available at ScienceDirect", "Science of the Total Environment"];
  const pageTitle = "Novel risk assessment model of food quality and safety considering…";
  assert.equal(isMetaBanner("Science of the Total Environment", { pageTitle, lines }), true);
  assert.equal(isMetaBanner("Novel risk assessment model of food quality", { pageTitle, lines }), false, "a cut-off title is the title");
  assert.equal(isMetaBanner("Plexus parse fixture: Environmental monitoring report", { pageTitle: "Environmental Monitoring of a Dry-Blend Powder Line", lines: ["Environmental Monitoring of a Dry-Blend Powder Line"] }), false);
  assert.equal(isMetaBanner("Science of the Total Environment", { pageTitle: "", lines }), false, "no page title, keep metadata");
  assert.equal(isMetaBanner("Science of the Total Environment", { pageTitle: "Science of the Total Environment", lines }), false);
});

test("the engine keeps a real metadata title and drops one that is a running header of page 1", async () => {
  const real = await parseFile(REPORT);
  assert.equal(real.title, "Plexus parse fixture: Environmental monitoring report");
  const header = real.removed.find((r) => r.reason === "running-header" && r.page === 1)?.text;
  assert.ok(header, "the report has a page-1 running header");
  const banner = await parseFile(REPORT, { info: { Title: header } });
  assert.equal(banner.title, banner.pageTitle);
  assert.equal(banner.pageTitle, "Environmental Monitoring of a Dry-Blend Powder Line");
});

test("parsedDocTitle ignores a stored banner title; parsedTitleLines carries headers and page-1 text", () => {
  const doc = {
    title: "Science of the Total Environment",
    pageTitle: "Science of the Total Environment",
    removed: [{ page: 2, reason: "running-header", text: "Science of the Total Environment 877 (2023) 162730" }, { page: 2, reason: "page-number", text: "2" }],
    order: ["h1", "h2", "p1"],
    blocks: {
      h1: { id: "h1", type: "heading", level: 1, page: 1, text: "Science of the Total Environment" },
      h2: { id: "h2", type: "heading", level: 1, page: 1, text: "Novel risk assessment model of food quality" },
      p1: { id: "p1", type: "para", page: 2, text: "Later text" },
    },
  };
  assert.equal(parsedDocTitle(doc), "Novel risk assessment model of food quality");
  const lines = parsedTitleLines(doc);
  assert.ok(lines.includes("Science of the Total Environment 877 (2023) 162730"));
  assert.ok(lines.includes("Novel risk assessment model of food quality"));
  assert.equal(lines.includes("2"), false);
  assert.equal(lines.includes("Later text"), false);
});

test("quickPageTitle reads the title from pages 1-2 of the report fixture", async () => {
  const pdf = await openReport();
  try {
    const records = [];
    for (let n = 1; n <= 2; n += 1) records.push(parsePageGeometry(await loadPageData(await pdf.getPage(n), { includeOps: n === 1 }), n));
    const got = quickPageTitle(records);
    assert.equal(got.pageTitle, "Environmental Monitoring of a Dry-Blend Powder Line");
    assert.ok(got.lines.length > 0 && got.lines.length <= 60);
    const read = await readPageTitle(pdf, { fonts: true });
    assert.equal(read.pageTitle, "Environmental Monitoring of a Dry-Blend Powder Line");
    assert.deepEqual(await readPageTitle(null), { pageTitle: "", titleLines: [] });
  } finally { await pdf.destroy(); }
});

test("title-only render opens the PDF, reads the title, draws nothing and destroys the document", async () => {
  const { getDocument } = await pdfjs();
  const calls = [];
  const lib = {
    getDocument(spec) {
      calls.push(Object.keys(spec));
      return getDocument({ data: new Uint8Array(readFileSync(REPORT)), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
    },
  };
  const stub = createDomStub();
  let canvases = 0;
  const orig = stub.document.createElement.bind(stub.document);
  stub.document.createElement = (tag) => { if (String(tag).toLowerCase() === "canvas") canvases += 1; return orig(tag); };
  const renderer = createFirstPageRenderer({ doc: stub.document, lib });
  const got = await renderer.render({ url: "https://example.test/report.pdf", titleOnly: true });
  assert.equal(got.pageTitle, "Environmental Monitoring of a Dry-Blend Powder Line");
  assert.equal(got.pageCount, 3);
  assert.equal(got.blob, undefined);
  assert.equal(canvases, 0, "no canvas for a title read");
  assert.equal(renderer.busy(), false);
});

test("the cover store keeps the page title and its lines; an older title is kept, marked stale, and read again", async () => {
  const stub = createDomStub();
  const store = createCoverStore({ indexedDB: null, storage: stub.localStorage });
  const url = "https://example.test/a.pdf";
  await store.put({ url, first: "data:image/jpeg;base64,AAAA", w: 10, h: 12, ts: 1 });
  const old = await store.get(url);
  assert.equal(old.pageTitle, null);
  assert.equal(needsPageTitle(old), true);
  await store.put({ ...old, pageTitle: "A paper", titleRev: TITLE_REV, titleLines: ["Journal 1 (2020) 2", "A paper"] });
  const got = await store.get(url);
  assert.equal(got.pageTitle, "A paper");
  assert.deepEqual(got.titleLines, ["Journal 1 (2020) 2", "A paper"]);
  assert.equal(needsPageTitle(got), false);
  await store.put({ ...got, pageTitle: "" });
  assert.equal(needsPageTitle(await store.get(url)), false, "a page with no title is not read again");
  await store.put({ ...got, pageTitle: "Trace ability", titleRev: TITLE_REV - 1 });
  const stale = await store.get(url);
  assert.equal(stale.pageTitle, "Trace ability", "a title from an older splitter is still shown");
  assert.equal(stale.titleStale, true);
  assert.equal(needsPageTitle(stale), true, "and read again");
});

test("warmPlan picks a covered card that still needs its title, never one that has it", () => {
  const base = { visible: new Set(["c1"]), sinceOpenMs: WARM_AFTER_MS + 1, done: 0 };
  assert.equal(warmPlan({ ...base, cards: [{ uid: "c1", blockUid: "b1", kind: "pdf", hasCover: true }] }), null);
  assert.deepEqual(warmPlan({ ...base, cards: [{ uid: "c1", blockUid: "b1", kind: "pdf", hasCover: true, needsTitle: true }] }), { uid: "c1", blockUid: "b1" });
});

function warmRig(store, renderFirst) {
  const stub = createDomStub();
  const root = stub.document.createElement("div");
  stub.document.body.append(root);
  // Plain numbers: the warm unrefs Node timers, which would let the test's event loop end early.
  const timers = { setTimeout: (fn, ms) => Number(setTimeout(fn, ms)), clearTimeout: (id) => clearTimeout(id) };
  const warm = createPdfWarm({ doc: stub.document, root, host: { renderBlock() {}, unmount() {} }, store, renderFirst, timers });
  return warm;
}

function memoryStore(seed = []) {
  const map = new Map(seed.map((r) => [r.url, r]));
  const puts = [];
  return {
    map,
    puts,
    async get(url) { return map.get(url) || null; },
    async put(record) { puts.push(record); map.set(record.url, record); return record; },
  };
}

test("the warm fills the title of a cached cover with one title-only read, then stops asking", async () => {
  const url = "https://example.test/paper.pdf";
  const store = memoryStore([{ url, hash: "", first: "data:image/jpeg;base64,AAAA", w: 10, h: 12, pageCount: 4, ts: 1 }]);
  const asks = [];
  const renderFirst = async (spec) => { asks.push(spec); return { pageCount: 4, pageTitle: "A paper title", titleLines: ["Journal 1 (2020) 3"] }; };
  const warm = warmRig(store, renderFirst);
  const got = await warm.request({ uid: "c1", blockUid: "b1", url });
  assert.equal(asks.length, 1);
  assert.equal(asks[0].titleOnly, true);
  assert.equal(got.pageTitle, "A paper title");
  assert.equal(store.map.get(url).first, "data:image/jpeg;base64,AAAA", "the image is kept");
  assert.deepEqual(store.map.get(url).titleLines, ["Journal 1 (2020) 3"]);
  await tick();
  await warm.request({ uid: "c1", blockUid: "b1", url });
  assert.equal(asks.length, 1, "a known title is not read again");
});

test("a failed title read stores an empty title so board opens do not fetch it again", async () => {
  const url = "https://example.test/paper.pdf";
  const store = memoryStore([{ url, hash: "", first: "data:image/jpeg;base64,AAAA", w: 10, h: 12, ts: 1 }]);
  const warm = warmRig(store, async () => null);
  await warm.request({ uid: "c1", blockUid: "b1", url });
  assert.equal(store.map.get(url).pageTitle, "");
});

test("a fresh cover from pdf.js is stored with its page title", async () => {
  const url = "https://example.test/fresh.pdf";
  const store = memoryStore();
  const blob = new Blob(["x"], { type: "image/jpeg" });
  const warm = warmRig(store, async () => ({ blob, w: 320, h: 414, pageCount: 2, pageTitle: "Fresh title", titleLines: ["Fresh title"] }));
  const got = await warm.request({ uid: "c1", blockUid: "b1", url });
  assert.equal(got.pageTitle, "Fresh title");
  assert.equal(store.puts.length, 1);
});

test("OCR raster scaling: whole-number upscales copy pixels, other upscales are bilinear, downscales smooth", () => {
  assert.equal(imageScaling(1659, 1125, 2489, 1688), true, "a 200 dpi scan at 300 dpi (1.5x)");
  assert.equal(imageScaling(1289, 1660, 2578, 3320), false, "a 150 dpi scan at 300 dpi (2x)");
  assert.equal(imageScaling(100, 100, 300, 300), false);
  assert.equal(imageScaling(100, 100, 100, 100), true, "1:1");
  assert.equal(imageScaling(300, 300, 150, 150), true, "downscale");
  assert.equal(imageScaling(0, 100, 10, 10), null);
});

function fakeCtx(transform = { a: 1, b: 0, c: 0, d: 1 }) {
  const seen = [];
  const ctx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "high",
    getTransform: () => transform,
    drawImage(...args) { seen.push({ n: args.length, smooth: this.imageSmoothingEnabled, quality: this.imageSmoothingQuality }); },
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  return { ctx, seen };
}

test("steadyImageScaling decides smoothing per image draw and puts pdf.js's setting back", () => {
  const { ctx, seen } = fakeCtx();
  steadyImageScaling(ctx);
  ctx.drawImage({}, 0, 0, 200, 100, 0, 0, 300, 150);
  ctx.drawImage({}, 0, 0, 100, 100, 0, 0, 200, 200);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage({}, 0, 0, 100, 100, 0, 0, 200, 200);
  ctx.drawImage({}, 0, 0);
  assert.deepEqual(seen.map((s) => s.smooth), [true, false, false, true]);
  assert.equal(seen[0].quality, "low");
  assert.equal(ctx.imageSmoothingEnabled, true, "restored after the draw");
  assert.equal(ctx.imageSmoothingQuality, "high");
  const flipped = fakeCtx({ a: 1, b: 0, c: 0, d: -1 });
  steadyImageScaling(flipped.ctx);
  flipped.ctx.drawImage({}, 0, 0, 200, 100, 0, 0, 300, 150);
  assert.equal(flipped.seen[0].smooth, true, "a flipped axis is still a 1.5x upscale");
  assert.equal(steadyImageScaling(null), null);
});

test("renderPdfPage draws the page through the steady scaling context", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const made = fakeCtx();
  const orig = stub.document.createElement.bind(stub.document);
  stub.document.createElement = (tag) => {
    const node = orig(tag);
    if (String(tag).toLowerCase() === "canvas") node.getContext = () => made.ctx;
    return node;
  };
  const hadOffscreen = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = undefined;
  try {
    const pdfDoc = {
      numPages: 1,
      async getPage() {
        return {
          getViewport: ({ scale }) => ({ width: 10 * scale, height: 10 * scale }),
          render({ canvasContext }) {
            canvasContext.imageSmoothingEnabled = false;
            canvasContext.drawImage({}, 0, 0, 200, 100, 0, 0, 300, 150);
            return { promise: Promise.resolve() };
          },
        };
      },
    };
    const page = await renderPdfPage(pdfDoc, 1, 72);
    assert.equal(page.width, 10);
    assert.deepEqual(made.seen.map((s) => s.smooth), [true], "the 1.5x scan is smoothed even though pdf.js asked for nearest");
  } finally {
    globalThis.OffscreenCanvas = hadOffscreen;
    restore();
  }
});
