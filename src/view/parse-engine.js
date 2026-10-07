// Thin pdf.js adapter for the built-in parse engine. Runs on Roam's window.pdfjsLib (or any
// pdfjs-dist build): page -> { items, ops, w, h, rotation, transform, fonts }. No graph access.

import { parsePdf } from "../model/parse/index.js";

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
