// src/view/parse-engine.js: the pdf.js adapter, against a fake pdf.js document.
import assert from "node:assert/strict";
import test from "node:test";

import { createEngine, detectPdfjs, loadPageData, parseDocument } from "../src/view/parse-engine.js";

function fakePage(n) {
  return {
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale, rotation: 0, transform: [1, 0, 0, -1, 0, 792] }),
    getTextContent: async () => ({ items: [{ str: `Page ${n} text here`, transform: [10, 0, 0, 10, 50, 700], width: 80, height: 10, fontName: "g_f1", hasEOL: false }], styles: { g_f1: { fontFamily: "sans-serif" } } }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
    commonObjs: { has: (k) => k === "g_f1", get: () => ({ name: "ABC+Helvetica-Bold", bold: false }) },
    cleanup: () => { fakePage.cleaned = (fakePage.cleaned || 0) + 1; },
  };
}
const fakeDoc = { numPages: 2, getPage: async (n) => fakePage(n), getMetadata: async () => ({ info: { Title: "Fake" } }) };

test("detectPdfjs finds a pdf.js global by its known names", () => {
  assert.equal(detectPdfjs(null), null);
  assert.equal(detectPdfjs({}), null);
  const lib = { getDocument() {}, version: "5.4.149" };
  assert.equal(detectPdfjs({ pdfjsLib: lib }), lib);
  assert.equal(detectPdfjs({ PDFJS: lib }), lib);
});

test("loadPageData returns the engine page shape with resolved font flags", async () => {
  const data = await loadPageData(fakePage(1));
  assert.deepEqual([data.w, data.h, data.rotation], [612, 792, 0]);
  assert.deepEqual(data.transform, [1, 0, 0, -1, 0, 792]);
  assert.equal(data.items.length, 1);
  assert.equal(data.fonts.g_f1.name, "ABC+Helvetica-Bold");
  assert.ok(Array.isArray(data.ops.fnArray));
});

test("parseDocument parses every page through the pure engine, reports progress, and cleans pages", async () => {
  const seen = [];
  const doc = await parseDocument(fakeDoc, { onPage: (p) => seen.push(p.page), sha256: "abc" });
  assert.equal(doc.schema, "pxd-parse/1");
  assert.equal(doc.sha256, "abc");
  assert.equal(doc.title, "Fake");
  assert.deepEqual(seen, [1, 2]);
  assert.equal(doc.pages.length, 2);
  assert.ok(fakePage.cleaned >= 2);
});

test("parseDocument honours an abort signal before touching the next page", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(parseDocument(fakeDoc, { signal: ctrl.signal }), { name: "AbortError" });
});

test("createEngine reports availability and parses a document proxy or a getDocument source", async () => {
  const none = createEngine({ pdfjs: null });
  assert.equal(none.available, false);
  await assert.rejects(none.parse(fakeDoc), /not available/);
  const lib = { version: "5.4.149", getDocument: () => ({ promise: Promise.resolve(fakeDoc) }) };
  const engine = createEngine({ pdfjs: lib });
  assert.equal(engine.version, "5.4.149");
  const a = await engine.parse(fakeDoc);
  assert.equal(a.engineVersion, "plexus-builtin/pdfjs-5.4.149");
  const b = await engine.parse({ url: "x" });
  assert.equal(b.pages.length, 2);
});
