// Reopening a scanned PDF restores the OCR-merged parse, the in-browser read runs the cell re-read,
// and parse doc titles never cut a word.
import assert from "node:assert/strict";
import test from "node:test";

import { assembleDocument, parsePageGeometry } from "../src/model/parse/index.js";
import { createParseStore } from "../src/host/parse-store.js";
import { createDeviceOcr } from "../src/host/device-ocr.js";
import { createParseView } from "../src/view/parse-view.js";
import { rereadCells } from "../src/view/parse-engine.js";
import { parsedDocTitle } from "../src/model/pdf.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function word(str, x, base, conf = 1) {
  return { str, transform: [6, 0, 0, 6, x, base], width: str.length * 3.3, height: 6, y0: base - 4.8, y1: base + 1.3, fontName: "ocr", conf };
}

function ocrPage(n = 1) {
  const items = [];
  const cols = [20, 120, 160, 200, 240];
  ["Disease", "1980", "1979", "1978", "1977"].forEach((t, c) => items.push(word(t, cols[c], 30)));
  const rows = [
    ["Amebiasis", "2.38", "1.90", "1.84", "1.41"],
    ["Anthrax", "0.00", "0.D0", "0.00", "0.00"],
    ["Chancroid", "0.35", "0.38", "0.24", "0.21"],
    ["Cholera", "0.00", "0.01", "0.01", ""],
    ["Mumps", "3.86", "6.55", "7.81", "10.02"],
  ];
  rows.forEach((row, r) => row.forEach((t, c) => { if (t) items.push(word(t, cols[c], 40 + r * 7, t === "0.D0" ? 0.5 : 1)); }));
  const rules = [
    { x0: 10, y0: 24, x1: 280, y1: 24, thick: 0.5 },
    { x0: 10, y0: 33, x1: 280, y1: 33, thick: 0.5 },
    { x0: 10, y0: 74, x1: 280, y1: 74, thick: 0.5 },
    ...[110, 150, 190, 230].map((x) => ({ x0: x, y0: 24, x1: x, y1: 74, thick: 0.5 })),
  ];
  return { n, w: 300, h: 120, rotation: 0, transform: [1, 0, 0, 1, 0, 0], scan: true, dpi: 300, deskew: 0, fonts: { ocr: { name: "ocr" } }, items, rules, ops: { fnArray: [], argsArray: [] } };
}

function scanGeometry(n) {
  const rec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 300, h: 120, rotation: 0, fonts: {} }, n);
  rec.kind = "scan";
  return rec;
}

const URL_A = "https://example.test/scan.pdf";
const hasTable = (doc) => doc.order.some((id) => doc.blocks[id].type === "table");

async function firstSession(store, stub, extra = {}) {
  const view = createParseView({
    doc: stub.document,
    store,
    storage: stub.localStorage,
    url: URL_A,
    getPdf: async () => ({ numPages: 1, getData: async () => new Uint8Array([1, 2, 3]) }),
    loadGeometry: async (n) => scanGeometry(n),
    ...extra,
  });
  await view.parseBuiltin();
  return view;
}

test("reopen restores the OCR-merged parse, not the scan-only one saved before the read", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const store = createParseStore({});
    const view = await firstSession(store, stub);
    assert.equal(hasTable(view.parsed ? view.parsed() : { order: [], blocks: {} }), false);
    assert.equal(await view.applyOcr([ocrPage(1)]), true);
    view.dispose();

    const reopened = createParseView({ doc: stub.document, store, storage: stub.localStorage, url: URL_A });
    const found = await reopened.restore();
    assert.ok(found, "restored");
    assert.equal(hasTable(found), true, "the table doc");
    assert.equal(found.options.ocr, "vision");
    assert.equal(found.pages[0].ocr, true);
    reopened.dispose();
  } finally {
    restore();
  }
});

test("reopen with only the scan-only parse (no OCR read) is unchanged", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const store = createParseStore({});
    const view = await firstSession(store, stub);
    view.dispose();
    const reopened = createParseView({ doc: stub.document, store, storage: stub.localStorage, url: URL_A });
    const found = await reopened.restore();
    assert.ok(found);
    assert.equal(hasTable(found), false);
    assert.equal(found.options.ocr, "none");
    assert.equal(found.pages[0].kind, "scan");
    reopened.dispose();
  } finally {
    restore();
  }
});

test("an in-browser read result goes through the cell re-read, under the signal, with progress", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const store = createParseStore({});
    const view = await firstSession(store, stub);
    const ctl = new AbortController();
    const phases = [];
    const seen = [];
    const readCells = async (cells) => {
      seen.push(cells.length);
      return { cells: cells.map((c) => ({ page: c.page, bbox: c.bbox, text: c.r === 4 && c.c === 4 ? "0.02" : "", conf: 1, glyph: null })) };
    };
    assert.equal(await view.applyOcr([ocrPage(1)], { readCells, signal: ctl.signal, onPhase: (p) => phases.push(p.phase) }), true);
    assert.deepEqual(phases, ["cells"]);
    assert.equal(seen.length, 1);
    view.dispose();
    const reopened = createParseView({ doc: stub.document, store, storage: stub.localStorage, url: URL_A });
    const found = await reopened.restore();
    const table = found.order.map((id) => found.blocks[id]).find((b) => b.type === "table");
    assert.equal(table.cells.find((k) => k.r === 4 && k.c === 4).text, "0.02", "doubtful cell corrected");
    assert.equal(found.ocr.rereads, 1);
    reopened.dispose();
  } finally {
    restore();
  }
});

test("rereadCells honours an aborted signal and skips when there is nothing doubtful", async () => {
  const doc = assembleDocument([parsePageGeometry(ocrPage(1), 1)], { numPages: 1, from: 1, to: 1 });
  const ctl = new AbortController();
  await assert.rejects(() => rereadCells({ doc, ocr: async () => { ctl.abort(); return { cells: [] }; }, signal: ctl.signal }), { name: "AbortError" });
  assert.deepEqual(await rereadCells({ doc: { order: [], blocks: {} }, ocr: async () => { throw new Error("no"); } }), []);
});

test("device readCells uses the same source and never downloads", async () => {
  const calls = [];
  const source = {
    cached: async () => true,
    prefetch: async () => { throw new Error("must not download"); },
    ocr: async (arg) => { calls.push(arg); return { cells: [{ text: "1.5" }] }; },
  };
  const pdf = { numPages: 1, getPage: async () => ({}) };
  const device = createDeviceOcr({ env: { WebAssembly: {}, crypto: { subtle: {} }, caches: {}, fetch: () => { throw new Error("no fetch"); } }, source });
  const ctl = new AbortController();
  const got = await device.readCells({ cells: [{ page: 1, bbox: [0, 0, 1, 1] }], getPdf: async () => pdf, signal: ctl.signal });
  assert.deepEqual(got.cells, [{ text: "1.5" }]);
  assert.equal(calls[0].signal, ctl.signal);

  const cold = createDeviceOcr({ env: { WebAssembly: {}, crypto: { subtle: {} }, caches: {}, fetch: () => { throw new Error("no fetch"); } }, source: { ...source, cached: async () => false, ocr: async () => { throw new Error("must not read"); } } });
  assert.deepEqual((await cold.readCells({ cells: [{ page: 1 }], getPdf: async () => pdf })).cells, []);
});

test("parsedDocTitle prefers the first heading line and never cuts mid-word", () => {
  const long = "NOTIFIABLE DISEASES AND DEATHS IN SELECTED CITIES OF THE UNITED STATES REPORTED DURING THE WEEK ENDING";
  const title = parsedDocTitle({ title: "NOTIFIABL", order: ["h"], blocks: { h: { type: "heading", level: 1, text: long } } });
  assert.ok(title.length <= 81, title);
  assert.ok(title.endsWith("…"));
  assert.ok(long.startsWith(title.slice(0, -1).trimEnd()));
  assert.equal(/\s…$/.test(title), false);
  assert.equal(long.slice(title.slice(0, -1).length, title.slice(0, -1).length + 1), " ", "cut at a word boundary");
});

test("restore finds the OCR-read parse even when its options hash is not the expected one", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const store = createParseStore({});
    const scanOnly = { ...assembleDocument([scanGeometry(1)], { numPages: 1, sha256: "zz" }), engine: "builtin" };
    scanOnly.optsHash = "scanonlyhash";
    const read = { ...assembleDocument([parsePageGeometry(ocrPage(1), 1)], { numPages: 1, sha256: "zz", options: { ocr: "vision", extra: 1 } }), engine: "builtin", optsHash: "oddhash" };
    await store.putParse(scanOnly);
    await store.putParse(read);
    await store.indexUrl(URL_A, { sha256: "zz", pageCount: 1 });
    const view = createParseView({ doc: stub.document, store, storage: stub.localStorage, url: URL_A });
    const found = await view.restore();
    assert.equal(found.optsHash, "oddhash");
    assert.equal(hasTable(found), true);
    view.dispose();
  } finally {
    restore();
  }
});
