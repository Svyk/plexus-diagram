// tablesFromPdf: cached parse, built-in parse, scanned pages via helper or an injected source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createParseStore } from "../src/host/parse-store.js";
import { createPdfTables, PDF_TABLES_CAPABILITIES } from "../src/host/pdf-tables.js";
import { createPublicApi } from "../src/model/public-api.js";
import { toGridModelSpec } from "../src/model/parse-to-grid.js";
import { tableFromTruth } from "../src/model/parse-schema.js";
import { FIX } from "./parse-engine-fixtures.js";

const OCR = JSON.parse(readFileSync(join(FIX, "report-scan.ocr.json"), "utf8"));
const truth = JSON.parse(readFileSync(join(FIX, "report.truth.json"), "utf8"));

async function pdfjs() {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return { version: lib.version, getDocument: (o) => lib.getDocument({ ...o, useSystemFonts: true, disableFontFace: true, verbosity: 0 }) };
}

function rig(file, extra = {}) {
  const fetched = [];
  return pdfjs().then((pdf) => ({
    fetched,
    store: extra.store || createParseStore({}),
    make: (deps = {}) => createPdfTables({
      pdfjs: pdf,
      store: createParseStore({}),
      fetchBytes: async (url) => { fetched.push(url); return new Uint8Array(readFileSync(join(FIX, file))); },
      ...deps,
    }),
  }));
}

test("toGridModelSpec: header count, column alignments, widths in px from the ruled grid", () => {
  const table = tableFromTruth(truth.tables[0]);
  const spec = toGridModelSpec(table);
  assert.equal(typeof spec.headerRows, "number");
  assert.equal(spec.headerRows, table.headerRows);
  assert.ok(spec.merges.length >= 1);
  assert.ok(spec.columnAlignments === null || spec.columnAlignments.length === spec.rows[0].length);
  assert.equal(spec.widths, null, "no ruled grid on a truth table");
  const ruled = toGridModelSpec({ ...table, grid: { xs: Array.from({ length: spec.rows[0].length + 1 }, (_, i) => i * 72) } });
  assert.deepEqual(ruled.widths[0], 96);
  assert.equal(Object.keys(ruled.widths).length, spec.rows[0].length);
});

test("text PDF: built-in parse returns tables with grid specs, caches, and reads the cache next time", async () => {
  const r = await rig("report.pdf");
  const tables = r.make({ store: r.store });
  const first = await tables.tablesFromPdf({ url: "https://x/report.pdf" });
  assert.equal(first.from, "parse");
  assert.equal(first.scanned, false);
  assert.deepEqual(first.needsOcr, []);
  assert.ok(first.tables.length >= 2);
  const t = first.tables[0];
  assert.equal(typeof t.page, "number");
  assert.equal(t.rows, t.spec.rows.length);
  assert.equal(t.cols, t.spec.rows[0].length);
  assert.equal(t.merged, t.spec.merges.length);
  assert.equal(typeof t.spec.headerRows, "number");
  assert.equal(t.spec.enhance, true);
  assert.equal(r.fetched.length, 1);
  const second = await tables.tablesFromPdf({ url: "https://x/report.pdf" });
  assert.equal(second.from, "cache");
  assert.equal(r.fetched.length, 1, "cache hit does not read the bytes");
  assert.equal(second.tables.length, first.tables.length);
});

test("pages restricts the tables and a partial parse is not cached", async () => {
  const r = await rig("report.pdf");
  const store = createParseStore({});
  const tables = r.make({ store });
  const all = await tables.tablesFromPdf({ url: "u", pages: [1, 2, 3] });
  const pages = [...new Set(all.tables.map((t) => t.page))];
  const one = await r.make({ store }).tablesFromPdf({ url: "u2", pages: [pages[0]] });
  assert.ok(one.tables.length >= 1);
  assert.ok(one.tables.every((t) => t.page === pages[0]));
  assert.equal(await store.findByUrl("u2"), null);
});

test("scanned PDF without any OCR source reports needsOcr and the helper state", async () => {
  const r = await rig("report-scan.pdf");
  const helper = { async health() { return { state: "not-running" }; }, async ocr() { throw new Error("must not run"); } };
  const out = await r.make({ helper }).tablesFromPdf({ url: "s" });
  assert.equal(out.scanned, true);
  assert.deepEqual(out.needsOcr, out.scanPages);
  assert.ok(out.needsOcr.length >= 1);
  assert.equal(out.ocr.state, "not-running");
  assert.equal(out.ocr.source, null);
  assert.equal(out.tables.length, 0);
});

test("scanned PDF with a ready helper reads the scan and returns tables", async () => {
  const r = await rig("report-scan.pdf");
  const calls = [];
  const helper = {
    async health() { return { state: "ready" }; },
    async ocr(req) { calls.push(req); return req.pages ? { pages: OCR.pages.filter((p) => req.pages.includes(p.n)) } : { cells: [] }; },
  };
  const out = await r.make({ helper }).tablesFromPdf({ url: "s" });
  assert.equal(out.ocr.source, "helper");
  assert.ok(calls.length >= 1);
  assert.deepEqual(out.needsOcr, []);
  assert.ok(out.ocrPages.length >= 1);
  assert.ok(out.tables.length >= 1);
  assert.equal(out.from, "ocr");
});

test("an OCR-only helper reads scans and a Docling-less missing state does not", async () => {
  const r = await rig("report-scan.pdf");
  const calls = [];
  const ocrOnly = {
    async health() { return { state: "ready", ocr: true, docling: false, engines: ["ocr"] }; },
    async ocr(req) { calls.push(req); return req.pages ? { pages: OCR.pages.filter((p) => req.pages.includes(p.n)) } : { cells: [] }; },
  };
  const out = await r.make({ helper: ocrOnly }).tablesFromPdf({ url: "s" });
  assert.equal(out.ocr.source, "helper");
  assert.ok(calls.length >= 1);
  const quiet = {
    async health() { return { state: "models-missing", ocr: false, docling: false }; },
    async ocr() { throw new Error("must not run"); },
  };
  const skipped = await r.make({ helper: quiet }).tablesFromPdf({ url: "s2" });
  assert.equal(skipped.ocr.source, null);
  assert.equal(skipped.ocr.state, "models-missing");
  const whileDownloading = {
    async health() { return { state: "models-missing", ocr: true, docling: false, engines: ["docling", "ocr"] }; },
    async ocr(req) { return req.pages ? { pages: OCR.pages.filter((p) => req.pages.includes(p.n)) } : { cells: [] }; },
  };
  const during = await r.make({ helper: whileDownloading }).tablesFromPdf({ url: "s3" });
  assert.equal(during.ocr.source, "helper");
});

test("an injected OCR source wins over the helper and scan: off skips OCR", async () => {
  const r = await rig("report-scan.pdf");
  const helper = { async health() { return { state: "ready" }; }, async ocr() { throw new Error("helper must not be used"); } };
  const source = { async ocr(req) { return req.pages ? { pages: OCR.pages.filter((p) => req.pages.includes(p.n)) } : { cells: [] }; } };
  const out = await r.make({ helper }).tablesFromPdf({ url: "s", ocrSource: source });
  assert.equal(out.ocr.source, "injected");
  assert.ok(out.tables.length >= 1);
  const off = await r.make({ helper }).tablesFromPdf({ url: "s", ocrSource: source, scan: "off" });
  assert.equal(off.tables.length, 0);
  assert.deepEqual(off.needsOcr, off.scanPages);
});

test("a bad url, no pdf.js and a failed fetch carry codes", async () => {
  const pdf = await pdfjs();
  await assert.rejects(() => createPdfTables({}).tablesFromPdf({}), { code: "bad-url" });
  await assert.rejects(() => createPdfTables({ pdfjs: null, fetchBytes: async () => new Uint8Array(1) }).tablesFromPdf({ url: "u" }), { code: "no-pdfjs" });
  await assert.rejects(() => createPdfTables({ pdfjs: pdf, fetchBytes: async () => { throw new Error("CORS"); } }).tablesFromPdf({ url: "u" }), { code: "fetch-failed" });
});

test("creating the module fetches and reads nothing", () => {
  let touched = 0;
  const tables = createPdfTables({
    pdfjs: { getDocument() { touched += 1; } },
    store: { findByUrl() { touched += 1; }, getParse() { touched += 1; } },
    helper: { health() { touched += 1; } },
    fetchBytes() { touched += 1; },
  });
  assert.equal(touched, 0);
  assert.deepEqual([...tables.capabilities], [...PDF_TABLES_CAPABILITIES]);
});

test("public API: tablesFromPdf and capabilities are feature-detectable", async () => {
  const calls = [];
  const api = createPublicApi({ host: { graphName: () => "g" }, capabilities: PDF_TABLES_CAPABILITIES, tablesFromPdf: async (o) => { calls.push(o); return { tables: [] }; } });
  assert.ok(api.capabilities.includes("tablesFromPdf"));
  assert.ok(api.spec().capabilities.includes("tablesFromPdf.scan.source"));
  assert.ok(api.spec().methods.includes("tablesFromPdf"));
  assert.deepEqual(await api.tablesFromPdf({ url: "u" }), { tables: [] });
  assert.deepEqual(calls, [{ url: "u" }]);
  const bare = createPublicApi({ host: { graphName: () => "g" } });
  assert.deepEqual([...bare.capabilities], []);
  await assert.rejects(() => bare.tablesFromPdf({ url: "u" }), /not available/);
});
