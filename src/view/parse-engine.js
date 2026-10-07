// Thin pdf.js adapter for the built-in parse engine. Runs on Roam's window.pdfjsLib (or any
// pdfjs-dist build): page -> { items, ops, w, h, rotation, transform, fonts }. No graph access.

import { assembleDocument, parsePageGeometry, parsePdf } from "../model/parse/index.js";
import { applyCellOcr, cellsToReread } from "../model/parse/ocr-fix.js";
import { mergeOcrDocument, scanPagesOf } from "../model/parse/ocr-merge.js";

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
// are sent back for a 3x re-read. No graph access, no writes.
export async function readScan({ helper, bytes, sha256, base, records, pages, numPages, info = null, options = {}, from, to, signal, onPhase } = {}) {
  if (!helper || typeof helper.ocr !== "function") throw new Error("helper has no ocr");
  const wanted = (pages && pages.length ? pages : scanPagesOf(base)).filter((n) => !from || !to || (n >= from && n <= to));
  if (!wanted.length) return { doc: base, choices: [], rereads: [], pages: [] };
  const throwIfAborted = () => { if (signal && signal.aborted) throw Object.assign(new Error("parse aborted"), { name: "AbortError" }); };
  onPhase?.({ phase: "ocr", pages: wanted });
  const got = await helper.ocr({ bytes, sha256, pages: wanted, signal });
  throwIfAborted();
  const byPage = new Map((got?.pages || []).map((p) => [p.n, p]));
  const next = records.map((rec) => (byPage.has(rec.n) ? parsePageGeometry(byPage.get(rec.n), rec.n) : rec));
  for (const n of wanted) if (byPage.has(n) && !records.some((r) => r.n === n)) next.push(parsePageGeometry(byPage.get(n), n));
  next.sort((a, b) => a.n - b.n);
  const lo = from ?? next[0]?.n ?? 1;
  const hi = to ?? next[next.length - 1]?.n ?? numPages;
  const fresh = assembleDocument(next, { numPages: numPages || base?.pageCount || hi, info, sha256: sha256 || base?.sha256 || null, options: { ...(base?.options || {}), ...options, ocr: "vision" }, from: lo, to: hi });
  const merged = mergeOcrDocument(base, fresh, { pages: wanted });
  const doc = merged.doc;
  // Second read for cells the numeric repair left unreadable or empty.
  const tables = doc.order.map((id) => doc.blocks[id]).filter((b) => b && b.type === "table" && b.repairs && b.ocrSource !== "layer");
  const requests = tables.flatMap((t) => cellsToReread(t, { numericCols: t.repairs.numericCols }));
  let rereads = [];
  if (requests.length) {
    onPhase?.({ phase: "cells", count: requests.length });
    const answer = await helper.ocr({ bytes, sha256, cells: requests, signal });
    throwIfAborted();
    const results = (answer?.cells || []).map((c, i) => ({ ...requests[i], ...c }));
    for (const t of tables) {
      const applied = applyCellOcr(t, results.filter((r) => r.id === t.id));
      if (applied.length) rereads.push({ id: t.id, applied });
    }
  }
  doc.ocr = { ...(doc.ocr || {}), rereads: rereads.reduce((n, r) => n + r.applied.length, 0), elapsedMs: got?.elapsedMs ?? null };
  return { doc, choices: merged.choices, rereads, pages: wanted, records: next };
}
