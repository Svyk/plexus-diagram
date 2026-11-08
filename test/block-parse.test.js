// Parse PDF on a normal block: model, docFromPdf, the DOM-free runner, and the dialog's no-write open.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createDomStub } from "./fixtures/dom-stub.js";
import { createParseStore } from "../src/host/parse-store.js";
import { createPdfTables } from "../src/host/pdf-tables.js";
import {
  BLOCK_PARSE_LABEL,
  PARSED_PROP,
  containerString,
  highlightRefLines,
  parsePageRange,
  parsedMarker,
  parsedOf,
  pdfSourceOf,
  planBlockParse,
  scanNote,
} from "../src/model/block-parse.js";
import { findParsedKid, openBlockParse, runBlockParse, closeBlockParse } from "../src/view/block-parse.js";
import { FIX } from "./parse-engine-fixtures.js";

const OCR = JSON.parse(readFileSync(join(FIX, "report-scan.ocr.json"), "utf8"));

async function pdfjs() {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return { version: lib.version, getDocument: (o) => lib.getDocument({ ...o, useSystemFonts: true, disableFontFace: true, verbosity: 0 }) };
}

function rig(file) {
  return pdfjs().then((pdf) => ({
    make: (deps = {}) => createPdfTables({
      pdfjs: pdf,
      store: createParseStore({}),
      fetchBytes: async () => new Uint8Array(readFileSync(join(FIX, file))),
      ...deps,
    }),
  }));
}

test("label", () => assert.equal(BLOCK_PARSE_LABEL, "Plexus: Parse PDF"));

test("pdfSourceOf: macros, links, uploads, and what is not a PDF", () => {
  const fb = "https://firebasestorage.googleapis.com/v0/b/x/o/imgs%2Fapp%2FG%2Fabc.pdf?alt=media&token=1";
  assert.deepEqual(pdfSourceOf(`{{[[pdf]]: ${fb}}}`), { url: fb, kind: "pdf" });
  assert.deepEqual(pdfSourceOf("{{pdf: https://x.org/a.pdf}}"), { url: "https://x.org/a.pdf", kind: "pdf" });
  assert.deepEqual(pdfSourceOf("[report.pdf](https://x.org/a/report.pdf)"), { url: "https://x.org/a/report.pdf", kind: "link" });
  assert.deepEqual(pdfSourceOf("see https://x/a.pdf.enc now"), { url: "https://x/a.pdf.enc", kind: "link" });
  assert.deepEqual(pdfSourceOf(fb), { url: fb, kind: "link" });
  assert.equal(pdfSourceOf("https://x/a.png"), null);
  assert.equal(pdfSourceOf("plain"), null);
  assert.equal(pdfSourceOf(null), null);
});

test("parsePageRange", () => {
  assert.deepEqual(parsePageRange("", "", 12), { ok: true, whole: true, from: 1, to: 12 });
  assert.deepEqual(parsePageRange("2", "5", 12), { ok: true, whole: false, from: 2, to: 5 });
  assert.deepEqual(parsePageRange("3", "", 12), { ok: true, whole: false, from: 3, to: 12 });
  assert.deepEqual(parsePageRange("", "4", 12), { ok: true, whole: false, from: 1, to: 4 });
  assert.deepEqual(parsePageRange("0", "99", 12).ok, false);
  assert.deepEqual(parsePageRange("5", "99", 12), { ok: true, whole: false, from: 5, to: 12 });
  assert.deepEqual(parsePageRange("1", "12", 12), { ok: true, whole: true, from: 1, to: 12 });
  assert.equal(parsePageRange("6", "2", 12).error, "First page is after the last page");
  assert.deepEqual(parsePageRange("3", "", null), { ok: true, whole: false, from: 3, to: null });
  assert.equal(parsePageRange("a", "", 3).ok, false);
});

test("containerString, marker and parsedOf", () => {
  assert.equal(containerString({ from: 1, to: 12, pageCount: 40 }), "Parsed PDF · pages 1–12");
  assert.equal(containerString({ from: 3, to: 3, pageCount: 40 }), "Parsed PDF · page 3");
  assert.equal(containerString({ from: 1, to: 12, pageCount: 12 }), "Parsed PDF · 12 pages");
  const marker = parsedMarker({ url: "u", sha256: "h", from: 1, to: 2, pageCount: 9, highlights: 1, at: "2026-11-07T00:00:00Z" });
  assert.deepEqual(Object.keys(marker), [PARSED_PROP]);
  assert.equal(marker[PARSED_PROP].highlights, true);
  assert.equal(marker.plexus, undefined);
  assert.equal(parsedOf(marker).url, "u");
  assert.equal(parsedOf({ [`:${PARSED_PROP}`]: { ":v": 1, ":url": "z" } }).url, "z");
  assert.equal(parsedOf({}), null);
  assert.equal(parsedOf(null), null);
});

test("scanNote and highlightRefLines", () => {
  assert.equal(scanNote([], { helper: false }), "");
  assert.equal(scanNote([4], { helper: true }), "Page 4 is a scan and needs OCR, so it was left as a placeholder.");
  assert.equal(scanNote([4, 7, 9], { helper: true }), "Pages 4, 7 and 9 are scans and need OCR, so they were left as placeholders.");
  assert.match(scanNote([4], { helper: false }), / Start the Plexus helper to read scans, then run Parse PDF again\.$/);
  const rows = [{ uid: "a", page: 1 }, { uid: "b", page: 9 }, { uid: "c", page: null }];
  assert.equal(highlightRefLines(rows, 1, 3), "- Highlights\n  - ((a))\n  - ((c))");
  assert.equal(highlightRefLines([{ uid: "b", page: 9 }], 1, 3), "");
});

test("docFromPdf: onPage per page, abort, scans with and without OCR", async () => {
  const r = await rig("report.pdf");
  const seen = [];
  const out = await r.make().docFromPdf({ url: "u", pages: [1, 2], onPage: (p) => seen.push(p.page) });
  assert.deepEqual(seen, [1, 2]);
  assert.ok(out.doc.blocks);
  assert.deepEqual(out.needsOcr, []);
  const ctl = new AbortController();
  const stop = r.make().docFromPdf({ url: "u2", signal: ctl.signal, onPage: () => ctl.abort() });
  await assert.rejects(stop, { name: "AbortError" });
  const scan = await rig("report-scan.pdf");
  const bare = await scan.make().docFromPdf({ url: "s" });
  assert.ok(bare.needsOcr.length >= 1);
  const source = { async ocr(req) { return req.pages ? { pages: OCR.pages.filter((p) => req.pages.includes(p.n)) } : { cells: [] }; } };
  const read = await scan.make().docFromPdf({ url: "s2", ocrSource: source });
  assert.deepEqual(read.needsOcr, []);
  const store = createParseStore({});
  const tables = scan.make({ store });
  await tables.tablesFromPdf({ url: "s3" });
  assert.equal(typeof (await tables.pageCountOf("s3")), "number");
  assert.equal(await tables.pageCountOf("never"), null);
  const full = await r.make({ store }).docFromPdf({ url: "full" });
  assert.equal(typeof full.pageCount, "number");
});

test("docFromPdf uses the override fetch", async () => {
  const r = await rig("report.pdf");
  let used = 0;
  const tables = r.make({ fetchBytes: async () => { throw new Error("default must not run"); } });
  await tables.docFromPdf({ url: "o", pages: [1], fetchBytes: async () => { used += 1; return new Uint8Array(readFileSync(join(FIX, "report.pdf"))); } });
  assert.equal(used, 1);
});

test("planBlockParse: document order, table steps, no duplicated caption, chunks within 400", async () => {
  const r = await rig("report.pdf");
  const { doc } = await r.make().docFromPdf({ url: "p" });
  const plan = planBlockParse(doc, { from: null, to: null });
  assert.equal(plan.ok, true);
  const tableSteps = plan.steps.filter((s) => s.kind === "table");
  assert.ok(tableSteps.length >= 2);
  const mdText = plan.steps.filter((s) => s.kind === "md").map((s) => s.markdown).join("\n");
  const captions = Object.values(doc.blocks).filter((b) => b.type === "caption" && b.for && doc.blocks[b.for]?.type === "table" && b.text);
  for (const c of captions) assert.ok(!mdText.includes(c.text.trim()), `caption repeated as text: ${c.text}`);
  for (const s of plan.steps.filter((x) => x.kind === "md")) assert.ok((s.markdown.match(/^\s*- /gm) || []).length <= 400);
  const tablePages = tableSteps.map((s) => s.table.page);
  assert.deepEqual(tablePages, [...tablePages].sort((a, b) => a - b));
  const firstPage = Math.min(...doc.order.map((id) => doc.blocks[id].page));
  const some = planBlockParse(doc, { from: firstPage, to: firstPage });
  assert.equal(some.ok, true);
  assert.ok(some.blocks <= plan.blocks);
  assert.equal(planBlockParse({ blocks: {}, order: [] }, {}).steps.length, 0);
});

function fakeHost({ failFromMarkdownAt = 0 } = {}) {
  const calls = [];
  let n = 0;
  let md = 0;
  return {
    calls,
    generateUid: () => `uid${(n += 1)}`,
    createBlock: async (a) => { calls.push({ op: "create", ...a }); return a.uid; },
    fromMarkdown: async (a) => {
      md += 1;
      if (failFromMarkdownAt && md === failFromMarkdownAt) throw new Error("boom");
      calls.push({ op: "md", ...a });
      return [`r${md}`];
    },
    deleteBlock: async (uid) => { calls.push({ op: "delete", uid }); },
    canCreateGridTable: () => true,
    createGridTable: async (spec) => { calls.push({ op: "grid", parentUid: spec.parentUid }); return { uid: `grid${calls.length}` }; },
  };
}

test("runner writes the container, then the steps in order under it", async () => {
  const r = await rig("report.pdf");
  const host = fakeHost();
  const res = await runBlockParse({ host, pdfTables: r.make(), blockUid: "blk", source: { url: "u", kind: "pdf" }, range: { ok: true, whole: true, from: 1, to: null }, highlights: [{ uid: "hl1", page: null }] });
  assert.equal(res.ok, true);
  const first = host.calls[0];
  assert.equal(first.op, "create");
  assert.equal(first.parentUid, "blk");
  assert.equal(first.order, "last");
  assert.match(first.string, /^Parsed PDF · /);
  assert.equal(first.props[PARSED_PROP].highlights, true);
  const rest = host.calls.slice(1);
  assert.ok(rest.every((c) => c.parentUid === res.container || c.op === "grid" || c.op === "md" || c.op === "create"));
  assert.ok(rest.some((c) => c.op === "grid"));
  const last = rest[rest.length - 1];
  assert.equal(last.op, "md");
  assert.equal(last.parentUid, res.container);
  assert.match(last.markdown, /- Highlights\n {2}- \(\(hl1\)\)/);
  assert.ok(!host.calls.some((c) => c.op === "delete"));
});

test("runner replacing: new container at the old order, old one deleted last", async () => {
  const r = await rig("report.pdf");
  const host = fakeHost();
  const res = await runBlockParse({ host, pdfTables: r.make(), blockUid: "blk", source: { url: "u", kind: "link" }, range: { ok: true, whole: true, from: 1, to: null }, existing: { uid: "oldC", order: 2 } });
  assert.equal(res.ok, true);
  assert.equal(host.calls[0].order, 2);
  assert.deepEqual(host.calls[host.calls.length - 1], { op: "delete", uid: "oldC" });
});

test("runner: abort during writing deletes the new container, a write failure too", async () => {
  const r = await rig("report.pdf");
  const host = fakeHost();
  const ctl = new AbortController();
  const origMd = host.fromMarkdown;
  host.fromMarkdown = async (a) => { const out = await origMd(a); ctl.abort(); return out; };
  const res = await runBlockParse({ host, pdfTables: r.make(), blockUid: "blk", source: { url: "u", kind: "link" }, range: { ok: true, whole: true, from: 1, to: null }, existing: { uid: "oldC", order: 0 }, signal: ctl.signal });
  assert.equal(res.reason, "aborted-write");
  const created = host.calls[0].uid;
  assert.deepEqual(host.calls[host.calls.length - 1], { op: "delete", uid: created });
  assert.ok(!host.calls.some((c) => c.op === "delete" && c.uid === "oldC"));
  const bad = fakeHost({ failFromMarkdownAt: 1 });
  const failed = await runBlockParse({ host: bad, pdfTables: r.make(), blockUid: "blk", source: { url: "u", kind: "link" }, range: { ok: true, whole: true, from: 1, to: null } });
  assert.equal(failed.reason, "write-failed");
  assert.deepEqual(bad.calls[bad.calls.length - 1], { op: "delete", uid: bad.calls[0].uid });
});

test("runner: abort while reading writes nothing; scans-only is reported", async () => {
  const r = await rig("report.pdf");
  const host = fakeHost();
  const ctl = new AbortController();
  const res = await runBlockParse({ host, pdfTables: r.make(), blockUid: "blk", source: { url: "u", kind: "link" }, range: null, signal: ctl.signal, onProgress: () => ctl.abort() });
  assert.equal(res.reason, "aborted-read");
  assert.equal(host.calls.length, 0);
  const scan = await rig("report-scan.pdf");
  const h2 = fakeHost();
  const all = await runBlockParse({ host: h2, pdfTables: scan.make(), blockUid: "blk", source: { url: "s", kind: "link" }, range: null });
  assert.equal(all.reason, "all-scans");
  assert.match(all.note, /scan/);
  assert.equal(h2.calls.length, 0);
});

test("runner waits for the write window after 1200 writes", async () => {
  const ids = Array.from({ length: 1300 }, (_, i) => `p${i}`);
  const doc = { pageCount: 1, sha256: "h", blocks: Object.fromEntries(ids.map((id) => [id, { id, type: "para", page: 1, text: `line ${id}` }])), order: ids };
  const pdfTables = { docFromPdf: async () => ({ doc, pageCount: 1, needsOcr: [], ocr: { state: "none" } }) };
  const host = fakeHost();
  let t = 1000;
  const waits = [];
  const res = await runBlockParse({
    host, pdfTables, blockUid: "blk", source: { url: "u", kind: "link" }, range: null,
    now: () => t,
    sleep: async (ms) => { waits.push(ms); t += ms; },
  });
  assert.equal(res.ok, true);
  assert.equal(waits.length, 1);
  assert.equal(waits[0], 60000);
  assert.equal(host.calls.filter((c) => c.op === "md").length, 4);
});

test("the dialog opens without writing, finds an earlier parse, and Escape closes it", async () => {
  const dom = createDomStub();
  dom.document.head = dom.document.createElement("head");
  const restore = dom.install();
  try {
    const host = fakeHost();
    host.outlineKids = () => new Map([["blk", [{ uid: "kid1", order: 3 }]]]);
    host.pullProps = (uid) => (uid === "kid1" ? parsedMarker({ url: "u", from: 1, to: 3, at: "2026-11-07T10:00:00Z" }) : {});
    host.pdfCover = () => ({ pageUid: "pg" });
    host.pdfHighlightTree = () => [{ uid: "h1", string: "x", props: { "pdf-highlight": { position: { boundingRect: { pageNumber: 2 } } } }, children: [] }];
    assert.deepEqual(findParsedKid(host, "blk").uid, "kid1");
    const dialog = openBlockParse({ doc: dom.document, host, pdfTables: { pageCountOf: async () => 5, docFromPdf: async () => { throw new Error("no read on open"); } }, blockUid: "blk", string: "{{[[pdf]]: https://x.org/a.pdf}}", fetchBytes: async () => { throw new Error("no fetch on open"); } });
    assert.ok(dialog);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(host.calls.length, 0);
    const box = dom.document.querySelector(".pxd-blockparse");
    assert.ok(box);
    assert.match(box.textContent, /Parsed before: pages 1–3, 2026-11-07\. Parsing again replaces it, including any edits under it\./);
    assert.match(box.textContent, /Also bring in highlights \(1\)/);
    assert.equal(dom.document.querySelector(".pxd-blockparse__go").textContent, "Replace");
    dom.document.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() {} });
    assert.equal(dom.document.querySelector(".pxd-blockparse"), null);
    closeBlockParse();
    assert.equal(host.calls.length, 0);
    assert.equal(openBlockParse({ doc: dom.document, host, pdfTables: {}, blockUid: "blk", string: "plain" }), null);
  } finally {
    restore();
  }
});

test("runner waits before a step that would pass 1200 writes in the minute", async () => {
  const blocks = {};
  const order = [];
  for (let i = 0; i < 1500; i += 1) {
    const id = `p${i}`;
    blocks[id] = { id, type: "para", text: `Line ${i}`, page: 1 };
    order.push(id);
  }
  const doc = { blocks, order, pageCount: 1, pages: [{ n: 1 }] };
  const pdfTables = { docFromPdf: async () => ({ doc, pageCount: 1, needsOcr: [], scanPages: [], ocr: { state: "none" } }) };
  const host = fakeHost();
  const waits = [];
  const written = [];
  const origMd = host.fromMarkdown;
  host.fromMarkdown = async (a) => { written.push(waits.length); return origMd(a); };
  const res = await runBlockParse({ host, pdfTables, blockUid: "blk", source: { url: "u", kind: "link" }, range: { ok: true, whole: true, from: 1, to: null }, now: () => 0, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(res.ok, true);
  // Chunks of 400, 400, 400, 300 after the container: the third would make 1201, so it waits first.
  assert.deepEqual(written, [0, 0, 1, 1]);
  assert.equal(waits[0], 60000);
});
