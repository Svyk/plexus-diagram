// Tables from a PDF for other extensions (Roam Grid). Cached parse first, else the built-in
// engine on the PDF's own bytes, else for scanned pages the helper or an injected OCR source.
// Reads only: nothing is written to the graph, and nothing is fetched until a caller asks.

import { sha256Hex, optionsHash } from "../model/parse-hash.js";
import { assembleDocument, parsePageGeometry } from "../model/parse/index.js";
import { scanPagesOf } from "../model/parse/ocr-merge.js";
import { toGridModelSpec } from "../model/parse-to-grid.js";
import { restorableParse } from "./parse-store.js";
import { helperCanOcr } from "./parse-helper-client.js";
import { detectPdfjs, loadPageData, readScan } from "../view/parse-engine.js";

export const PDF_TABLES_CAPABILITIES = Object.freeze(["tablesFromPdf", "tablesFromPdf.cache", "tablesFromPdf.scan.helper", "tablesFromPdf.scan.source"]);

const OPTIONS = Object.freeze({ ocr: "none", formula: false, tables: "builtin" });
const ENGINES = ["builtin", "docling", "mixed", "anydoc"];

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function pageSet(pages, total) {
  if (pages == null) return null;
  const list = Array.isArray(pages) ? pages : [pages];
  const set = new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && (!total || n <= total)));
  return set.size ? set : null;
}

export function tablesOfDoc(doc, wanted = null) {
  const out = [];
  for (const id of doc?.order || []) {
    const block = doc.blocks?.[id];
    if (!block || block.type !== "table") continue;
    if (wanted && !wanted.has(block.page)) continue;
    const spec = toGridModelSpec(block);
    if (!spec.rows.length || !spec.rows[0].length) continue;
    out.push({
      id,
      page: block.page,
      caption: (block.caption && doc.blocks[block.caption]?.text) || "",
      rows: spec.rows.length,
      cols: spec.rows[0].length,
      merged: spec.merges.length,
      confidence: block.confidence ?? null,
      source: block.ocrSource || (block.engine === "docling" ? "docling" : "builtin"),
      spec,
    });
  }
  return out;
}

function covers(doc, wanted) {
  if (!doc) return false;
  if (!wanted) return (doc.pages || []).every((p) => p.parsed !== false);
  const parsed = new Set((doc.pages || []).filter((p) => p.parsed !== false).map((p) => p.n));
  for (const n of wanted) if (!parsed.has(n)) return false;
  return true;
}

export function createPdfTables({ store = null, helper = null, pdfjs, fetchBytes, sha256 = sha256Hex, ocrSource = null } = {}) {
  const lib = () => (pdfjs !== undefined ? pdfjs : detectPdfjs());

  async function cached(url) {
    if (!store || typeof store.findByUrl !== "function") return null;
    const hit = await store.findByUrl(url);
    if (!hit?.sha256) return null;
    const hash = await optionsHash(OPTIONS);
    const doc = await restorableParse(store, hit.sha256, {
      engines: ENGINES,
      plainHash: hash,
      readHashOf: (plain) => optionsHash({ ...(plain.options || OPTIONS), ocr: "vision" }),
    });
    if (doc) return { doc, sha256: hit.sha256 };
    return null;
  }

  async function builtin(url, wanted, signal) {
    const pdfjsLib = lib();
    if (!pdfjsLib) throw fail("no-pdfjs", "pdf.js is not available");
    if (typeof fetchBytes !== "function") throw fail("no-fetch", "no way to read the PDF bytes");
    let bytes;
    try { bytes = await fetchBytes(url); } catch (error) { throw fail("fetch-failed", `Could not read the PDF: ${error?.message || error}`); }
    const sha = await sha256(bytes);
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes).slice() }).promise;
    const numPages = pdf.numPages;
    const want = wanted ? [...wanted].filter((n) => n <= numPages) : null;
    const from = want ? Math.min(...want) : 1;
    const to = want ? Math.max(...want) : numPages;
    let info = null;
    try { info = (await pdf.getMetadata()).info || null; } catch { info = null; }
    const records = [];
    for (let n = from; n <= to; n += 1) {
      if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      const page = await pdf.getPage(n);
      records.push(parsePageGeometry(await loadPageData(page), n));
      try { page.cleanup?.(); } catch { /* ignore */ }
    }
    const doc = assembleDocument(records, { numPages, info, sha256: sha, options: OPTIONS, from, to, engineVersion: `plexus-builtin/pdfjs-${pdfjsLib.version || "unknown"}` });
    return { doc, records, bytes, sha256: sha, numPages, info, full: from === 1 && to === numPages };
  }

  async function ocrState(source) {
    if (source) return { source: source === helper ? "helper" : "injected", state: "ready" };
    if (helper && typeof helper.health === "function") {
      try {
        const health = await helper.health();
        return { source: null, state: health?.state || "not-running", ocr: health?.ocr, docling: health?.docling };
      } catch { /* below */ }
    }
    return { source: null, state: "none" };
  }

  async function tablesFromPdf({ url, pages, scan = "auto", ocrSource: injected = null, signal } = {}) {
    if (!url || typeof url !== "string") throw fail("bad-url", "url is required");
    let wanted = pageSet(pages, 0);
    let hit = await cached(url);
    if (hit && !covers(hit.doc, wanted)) hit = null;
    let doc = hit?.doc || null;
    let ctx = null;
    let from = hit ? "cache" : "parse";
    if (!doc) {
      ctx = await builtin(url, wanted, signal);
      doc = ctx.doc;
      if (store && ctx.full) {
        try {
          await store.putParse(doc);
          await store.indexUrl?.(url, { sha256: ctx.sha256, pageCount: ctx.numPages });
        } catch { /* cache is optional */ }
      }
    }
    if (wanted) wanted = pageSet([...wanted], doc.pageCount || 0);
    const scanPages = scanPagesOf(doc).filter((n) => !wanted || wanted.has(n));
    let ocr = { source: null, state: "none" };
    let engine = doc.engine;
    if (scanPages.length && scan !== "off") {
      let source = injected || ocrSource || null;
      if (!source && helper && typeof helper.ocr === "function") {
        const health = await ocrState(null);
        ocr = health;
        if (helperCanOcr(health)) source = helper;
      }
      if (source && typeof source.ocr === "function") {
        ocr = { source: source === helper ? "helper" : "injected", state: "ready" };
        if (!ctx) ctx = await builtin(url, null, signal);
        const read = await readScan({ helper: source, bytes: ctx.bytes, sha256: ctx.sha256, base: ctx.doc, records: ctx.records, pages: scanPages, numPages: ctx.numPages, info: ctx.info, options: OPTIONS, signal });
        doc = read.doc;
        engine = doc.engine;
        from = from === "cache" ? "cache+ocr" : "ocr";
        if (store && ctx.full) {
          try { await store.putParse({ ...doc, options: { ...(doc.options || OPTIONS), ocr: "vision" } }); } catch { /* cache is optional */ }
        }
      }
    }
    const needsOcr = scanPagesOf(doc).filter((n) => !wanted || wanted.has(n));
    return {
      tables: tablesOfDoc(doc, wanted),
      engine,
      scanned: scanPages.length > 0,
      scanPages,
      ocrPages: (doc.pages || []).filter((p) => p.ocr && (!wanted || wanted.has(p.n))).map((p) => p.n),
      needsOcr: scan === "off" ? scanPages : needsOcr,
      ocr,
      from,
      pageCount: doc.pageCount ?? null,
    };
  }

  return { tablesFromPdf, capabilities: PDF_TABLES_CAPABILITIES };
}
