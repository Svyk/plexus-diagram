// Thin pdf.js adapter for the built-in parse engine. Runs on Roam's window.pdfjsLib (or any
// pdfjs-dist build): page -> { items, ops, w, h, rotation, transform, fonts }. No graph access.

import { assembleDocument, parsePageGeometry, parsePdf } from "../model/parse/index.js";
import { applyCellOcr, cellsToReread } from "../model/parse/ocr-fix.js";
import { applyLineReads, linePages, linesToReread } from "../model/parse/ocr-lines.js";
import { mergeOcrDocument, scanPagesOf } from "../model/parse/ocr-merge.js";
import { voteOcrBodies } from "../model/parse/ocr-vote.js";
import { applyVlmTables, tableRegions } from "../model/parse/vlm-tables.js";

const GLOBAL_KEYS = ["pdfjsLib", "pdfjs-dist/build/pdf", "pdfjs", "PDFJS"];

export function detectPdfjs(win = typeof window !== "undefined" ? window : null) {
  if (!win) return null;
  for (const key of GLOBAL_KEYS) {
    const lib = win[key];
    if (lib && typeof lib.getDocument === "function") return lib;
  }
  return null;
}

// One page of pdf.js data in the shape the pure engine consumes.
export async function loadPageData(page, { includeOps = true } = {}) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent({ includeMarkedContent: false });
  const ops = includeOps ? await page.getOperatorList() : { fnArray: [], argsArray: [] };
  const fonts = {};
  for (const name of Object.keys(content.styles || {})) {
    let font = null;
    try { font = page.commonObjs && page.commonObjs.has && page.commonObjs.has(name) ? page.commonObjs.get(name) : null; } catch { font = null; }
    const style = content.styles[name] || {};
    fonts[name] = {
      name: (font && font.name) || style.fontFamily || name,
      bold: Boolean(font && (font.bold || font.black)),
      italic: Boolean(font && font.italic),
      fontFamily: style.fontFamily || null,
    };
  }
  return {
    items: content.items,
    ops: { fnArray: ops.fnArray, argsArray: ops.argsArray },
    w: viewport.width,
    h: viewport.height,
    rotation: viewport.rotation || 0,
    transform: Array.from(viewport.transform),
    fonts,
  };
}

// doc: a pdf.js PDFDocumentProxy. Returns the parse promise; `signal` cancels between pages.
export async function parseDocument(doc, { pages, signal, onPage, sha256 = null, options = {}, engineVersion } = {}) {
  let info = null;
  try { info = (await doc.getMetadata()).info || null; } catch { info = null; }
  const cache = new Map();
  const getPage = async (n) => {
    if (signal && signal.aborted) throw Object.assign(new Error("parse aborted"), { name: "AbortError" });
    const page = await doc.getPage(n);
    const data = await loadPageData(page);
    cache.set(n, page);
    if (typeof page.cleanup === "function") { try { page.cleanup(); } catch { /* ignore */ } }
    return data;
  };
  return parsePdf({ getPage, numPages: doc.numPages, pages, signal, onPage, info, sha256, options, engineVersion: engineVersion || `plexus-builtin/pdfjs-${versionOf(doc)}` });
}

function versionOf(doc) {
  const lib = doc && doc._transport && doc._transport.loadingTask ? null : null;
  return lib || "unknown";
}

export function createEngine({ pdfjs = detectPdfjs() } = {}) {
  return {
    available: Boolean(pdfjs),
    version: pdfjs && pdfjs.version ? pdfjs.version : null,
    async parse(source, opts = {}) {
      if (!pdfjs) throw new Error("pdf.js is not available");
      const doc = source && typeof source.getPage === "function" ? source : await pdfjs.getDocument(source).promise;
      return parseDocument(doc, { ...opts, engineVersion: opts.engineVersion || `plexus-builtin/pdfjs-${pdfjs.version || "unknown"}` });
    },
  };
}

// Scanned pages. `records` are the built-in geometry records of the parsed range (OCR'd pages
// are replaced by records built from the helper's pxd-ocr/1 pages); the document is assembled
// again so furniture, numbering and continuations stay whole; a scanLayer page keeps whichever
// reading of each table has the better numeric columns; then cells the repair could not read
// are sent back for a 3x re-read. Doubtful text lines of in-browser OCR pages are read again
// first (rereadLines). No graph access, no writes.
export async function readScan({ helper, bytes, sha256, base, records, pages, numPages, info = null, options = {}, from, to, signal, onPhase, lexicon = null, lines = true, alt = null } = {}) {
  if (!helper || typeof helper.ocr !== "function") throw new Error("helper has no ocr");
  const wanted = (pages && pages.length ? pages : scanPagesOf(base)).filter((n) => !from || !to || (n >= from && n <= to));
  if (!wanted.length) return { doc: base, choices: [], rereads: [], pages: [] };
  const throwIfAborted = () => { if (signal && signal.aborted) throw Object.assign(new Error("parse aborted"), { name: "AbortError" }); };
  onPhase?.({ phase: "ocr", pages: wanted });
  const gotRaw = await helper.ocr({ bytes, sha256, pages: wanted, signal });
  throwIfAborted();
  let got = gotRaw;
  if (alt && typeof alt.ocr === "function" && gotRaw?.pages) {
    let words = null;
    try { words = typeof lexicon === "function" ? await lexicon({ signal }) : lexicon; } catch { words = null; }
    throwIfAborted();
    let otherPages = [];
    try {
      const other = await alt.ocr({ pages: wanted, bytes, sha256, signal });
      otherPages = other?.pages || [];
    } catch (error) {
      if (error?.name === "AbortError") throw error;
    }
    throwIfAborted();
    got = { ...gotRaw, pages: voteOcrBodies(gotRaw.pages, otherPages, words instanceof Set ? words : null) };
  }
  const ask = (req) => helper.ocr({ bytes, sha256, cells: req, signal });
  let merged = mergeOcrPageRecords({ base, ocrPages: got?.pages || [], records, pages: wanted, numPages, info, options, from, to, sha256 });
  const lined = lines ? await rereadLines({ doc: merged.doc, ocrPages: got?.pages || [], ocr: ask, lexicon, signal, onPhase }) : { pages: got?.pages || [], applied: [] };
  if (lined.applied.length) merged = mergeOcrPageRecords({ base, ocrPages: lined.pages, records, pages: wanted, numPages, info, options, from, to, sha256 });
  const doc = merged.doc;
  const next = merged.records;
  let vlmApplied = [];
  // Only a helper that advertised vlm-tables. A mock that implements ocr() alone
  // must not be asked for tables. A failed reading leaves the rule-assembly tables.
  if (helper.vlmTables === true && typeof helper.tables === "function") {
    const regions = tableRegions(doc, wanted);
    if (regions.length) {
      try {
        onPhase?.({ phase: "vlm", count: regions.length });
        const read = await helper.tables({ bytes, sha256, pages: wanted, tables: regions, signal });
        throwIfAborted();
        const applied = applyVlmTables(doc, read?.tables || [], { method: read?.model || "vlm" });
        vlmApplied = applied.applied;
        if (applied.applied.length) Object.assign(doc, { blocks: applied.doc.blocks, order: applied.doc.order });
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        doc.ocr = { ...(doc.ocr || {}), vlmError: err?.message || String(err) };
      }
    }
  }
  const rereads = await rereadCells({ doc, ocr: ask, signal, onPhase });
  doc.ocr = { ...(doc.ocr || {}), rereads: rereads.reduce((n, r) => n + r.applied.length, 0), lines: lined.applied.length, vlm: vlmApplied.length, elapsedMs: got?.elapsedMs ?? null };
  return { doc, choices: merged.choices, rereads, lines: lined.applied, pages: wanted, records: next, ocrPages: lined.pages };
}

// Second read for doubtful OCR text lines (in-browser OCR pages only), then the case and lexicon
// fixes. `ocr(requests)` is the same cell source rereadCells uses; `lexicon` is a Set, null, or a
// function returning one (a failed load reads without it). Returns { pages, applied } with
// `pages` the OCR page records to merge again (unchanged when nothing applied).
export async function rereadLines({ doc, ocrPages, ocr, lexicon = null, signal, onPhase } = {}) {
  const pages = ocrPages || [];
  if (!doc || !linePages(pages).length) return { pages, applied: [] };
  const throwIfAborted = () => { if (signal && signal.aborted) throw Object.assign(new Error("parse aborted"), { name: "AbortError" }); };
  let words = null;
  try { words = typeof lexicon === "function" ? await lexicon() : lexicon; } catch { words = null; }
  throwIfAborted();
  const requests = linesToReread(doc, pages, { lexicon: words });
  if (!requests.length) return { pages, applied: [] };
  onPhase?.({ phase: "lines", count: requests.length });
  let results = [];
  if (typeof ocr === "function") {
    const answer = await ocr(requests);
    throwIfAborted();
    results = answer?.cells || [];
  }
  return applyLineReads(pages, requests, results, { lexicon: words, doc });
}

// Second read for cells the numeric repair left unreadable or empty. `ocr(requests)` answers with
// { cells } in request order (helper or on-device source); applied in place on the tables of `doc`.
export async function rereadCells({ doc, ocr, signal, onPhase } = {}) {
  const throwIfAborted = () => { if (signal && signal.aborted) throw Object.assign(new Error("parse aborted"), { name: "AbortError" }); };
  const tables = doc.order.map((id) => doc.blocks[id]).filter((b) => b && b.type === "table" && b.repairs && b.ocrSource !== "layer");
  const requests = tables.flatMap((t) => cellsToReread(t, { numericCols: t.repairs.numericCols }));
  const rereads = [];
  if (!requests.length || typeof ocr !== "function") return rereads;
  onPhase?.({ phase: "cells", count: requests.length });
  const answer = await ocr(requests);
  throwIfAborted();
  const results = (answer?.cells || []).map((c, i) => ({ ...requests[i], ...c }));
  for (const t of tables) {
    const applied = applyCellOcr(t, results.filter((r) => r.id === t.id));
    if (applied.length) rereads.push({ id: t.id, applied });
  }
  return rereads;
}

// The offline half of readScan: pxd-ocr/1 page records (helper or on-device) replace the geometry of
// their pages, the document is assembled again, and the merge keeps the better table reading.
export function mergeOcrPageRecords({ base, ocrPages, records, pages, numPages, info = null, options = {}, from, to, sha256 } = {}) {
  const wanted = pages && pages.length ? pages : scanPagesOf(base);
  const byPage = new Map((ocrPages || []).map((p) => [p.n, p]));
  const next = (records || []).map((rec) => (byPage.has(rec.n) ? parsePageGeometry(byPage.get(rec.n), rec.n) : rec));
  for (const n of wanted) if (byPage.has(n) && !next.some((r) => r.n === n)) next.push(parsePageGeometry(byPage.get(n), n));
  next.sort((a, b) => a.n - b.n);
  const lo = from ?? next[0]?.n ?? 1;
  const hi = to ?? next[next.length - 1]?.n ?? numPages;
  const fresh = assembleDocument(next, { numPages: numPages || base?.pageCount || hi, info, sha256: sha256 || base?.sha256 || null, options: { ...(base?.options || {}), ...options, ocr: "vision" }, from: lo, to: hi });
  const merged = mergeOcrDocument(base, fresh, { pages: wanted });
  return { doc: merged.doc, choices: merged.choices, records: next };
}
