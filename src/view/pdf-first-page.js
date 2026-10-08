// P32-2. Page 1 of a PDF without mounting Roam's reader: the pdf.js build Roam already loaded draws the
// page to an offscreen canvas. Everything is behind detection; a missing or unready pdf.js resolves null
// and the hidden-reader warm (pdf-warm.js) takes over. No graph write, no console, no document listener.

import { COVER_MAX_W, isBlankCanvas, scaleBox, sharpBox } from "../model/pdf-cover.js";
import { parsePageGeometry, quickPageTitle } from "../model/parse/index.js";
import { loadPageData } from "./parse-engine.js";

export const FIRST_PAGE_TIMEOUT_MS = 8000;
export const FIRST_PAGE_JPEG = 0.72;

const GLOBAL_KEYS = ["pdfjsLib", "pdfjs-dist/build/pdf", "pdfjs", "PDFJS"];

// The pdf.js module as a global, if Roam's bundle exposes one. getDocument is the only call we need; a
// worker (workerSrc or workerPort) must already be configured, because Plexus never ships or sets one.
export function detectPdfjs(win) {
  const scope = win && typeof win === "object" ? win : null;
  if (!scope) return null;
  for (const key of GLOBAL_KEYS) {
    let lib = null;
    try { lib = scope[key]; } catch { lib = null; }
    if (!lib || typeof lib !== "object" && typeof lib !== "function") continue;
    if (typeof lib.getDocument !== "function") continue;
    const options = lib.GlobalWorkerOptions;
    const workerReady = Boolean(options && (options.workerSrc || options.workerPort));
    return { lib, key, workerReady, version: typeof lib.version === "string" ? lib.version : "" };
  }
  return null;
}

// Roam encrypts some uploads (`.enc`); only Roam's reader can open those. Everything else is a plain fetch.
export function firstPageAllowed(url) {
  const text = typeof url === "string" ? url.trim() : "";
  if (!text) return false;
  if (/\.enc(?:[?#]|$)/i.test(text)) return false;
  return /^(?:https?:|blob:)/i.test(text);
}

function timersOf(timers) {
  const set = typeof timers?.setTimeout === "function" ? timers.setTimeout.bind(timers) : setTimeout;
  const clear = typeof timers?.clearTimeout === "function" ? timers.clearTimeout.bind(timers) : clearTimeout;
  return { set, clear };
}

function blobFrom(canvas, timers) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (blob) => {
      if (done) return;
      done = true;
      if (timer != null) { try { timers.clear(timer); } catch { /* cleared */ } }
      resolve(blob || null);
    };
    try {
      if (!canvas || typeof canvas.toBlob !== "function") { finish(null); return; }
      if (isBlankCanvas(canvas)) { finish(null); return; }
      timer = timers.set(() => finish(null), FIRST_PAGE_TIMEOUT_MS);
      const returned = canvas.toBlob((blob) => finish(blob), "image/jpeg", FIRST_PAGE_JPEG);
      if (returned && typeof returned.then === "function") returned.then((blob) => finish(blob), () => finish(null));
    } catch {
      finish(null);
    }
  });
}

// The page title from the text of pages 1-2 of an open document (quickPageTitle). Fonts are known for
// page 1 once it is drawn (`first`: that page); `fonts` asks pdf.js for them when it was not. Never throws.
export async function readPageTitle(pdf, { fonts = false, first = null } = {}) {
  try {
    const records = [];
    const count = Number.isInteger(pdf?.numPages) ? Math.min(2, pdf.numPages) : 1;
    for (let n = 1; n <= count; n += 1) {
      const page = n === 1 && first ? first : await pdf.getPage(n);
      records.push(parsePageGeometry(await loadPageData(page, { includeOps: fonts && n === 1 }), n));
    }
    const found = quickPageTitle(records);
    return { pageTitle: found.pageTitle || "", titleLines: found.lines || [] };
  } catch {
    return { pageTitle: "", titleLines: [] };
  }
}

// createFirstPageRenderer({ doc, lib, timers }) → { render({ url, maxW, titleOnly }) }.
// render resolves { blob, w, h, pageCount, pageTitle, titleLines } or null; with `titleOnly` nothing is
// drawn and it resolves { pageCount, pageTitle, titleLines }. One document at a time; a second call while
// one is in flight resolves null. The document is destroyed on every path, including the timeout.
export function createFirstPageRenderer({ doc, lib, timers, now } = {}) {
  const time = timersOf(timers);
  const clock = typeof now === "function" ? now : () => Date.now();
  let busy = false;
  let count = { tried: 0, ok: 0, failed: 0, lastMs: 0 };

  async function render(spec) {
    const url = typeof spec?.url === "string" ? spec.url.trim() : "";
    const maxW = Number(spec?.maxW) > 0 ? Number(spec.maxW) : COVER_MAX_W;
    if (!url || !firstPageAllowed(url) || busy) return null;
    if (!lib || typeof lib.getDocument !== "function" || !doc || typeof doc.createElement !== "function") return null;
    busy = true;
    count.tried += 1;
    const started = clock();
    let task = null;
    let pdf = null;
    let killId = null;
    let timedOut = false;
    const destroy = () => {
      try { pdf?.destroy?.(); } catch { /* gone */ }
      try { task?.destroy?.(); } catch { /* gone */ }
      pdf = null;
      task = null;
    };
    try {
      task = lib.getDocument(spec?.loadingTask && typeof spec.loadingTask === "object" ? spec.loadingTask : { url });
      const loaded = task && typeof task.promise?.then === "function" ? task.promise : Promise.resolve(task);
      const timeout = new Promise((resolve) => {
        killId = time.set(() => { timedOut = true; resolve(null); }, FIRST_PAGE_TIMEOUT_MS);
      });
      pdf = await Promise.race([loaded, timeout]);
      if (timedOut || !pdf || typeof pdf.getPage !== "function") { destroy(); count.failed += 1; return null; }
      if (spec?.titleOnly) {
        const read = await Promise.race([readPageTitle(pdf, { fonts: true }), timeout]);
        if (timedOut || !read) { destroy(); count.failed += 1; return null; }
        const pages = Number.isInteger(pdf.numPages) && pdf.numPages >= 1 ? pdf.numPages : null;
        destroy();
        count.ok += 1;
        return { pageCount: pages, pageTitle: read.pageTitle, titleLines: read.titleLines };
      }
      const page = await Promise.race([pdf.getPage(1), timeout]);
      if (timedOut || !page || typeof page.getViewport !== "function") { destroy(); count.failed += 1; return null; }
      const base = page.getViewport({ scale: 1 });
      const pageW = Number(base?.width) || 0;
      // A cover stays inside the page's own pixel size. A sharp pass may scale
      // a PDF-point viewport up so a wide card is not a blurry 595px bitmap.
      const box = maxW > pageW ? sharpBox(pageW, base?.height, maxW) : scaleBox(pageW, base?.height, maxW);
      if (!box) { destroy(); count.failed += 1; return null; }
      const scale = box.w / Number(base.width);
      const viewport = page.getViewport({ scale });
      const canvas = doc.createElement("canvas");
      canvas.width = box.w;
      canvas.height = box.h;
      const ctx = canvas.getContext?.("2d");
      if (!ctx) { destroy(); count.failed += 1; return null; }
      const job = page.render({ canvasContext: ctx, viewport });
      await Promise.race([job && typeof job.promise?.then === "function" ? job.promise : Promise.resolve(job), timeout]);
      if (timedOut) { try { job?.cancel?.(); } catch { /* fine */ } destroy(); count.failed += 1; return null; }
      const pageCount = Number.isInteger(pdf.numPages) && pdf.numPages >= 1 ? pdf.numPages : null;
      const read = spec?.title === false ? null : await Promise.race([readPageTitle(pdf, { first: page }), timeout]);
      destroy();
      const blob = await blobFrom(canvas, time);
      if (!blob) { count.failed += 1; return null; }
      count.ok += 1;
      const titled = read && !timedOut ? { pageTitle: read.pageTitle, titleLines: read.titleLines } : {};
      return { blob, w: box.w, h: box.h, pageCount, ...titled };
    } catch {
      destroy();
      count.failed += 1;
      return null;
    } finally {
      if (killId != null) { try { time.clear(killId); } catch { /* cleared */ } }
      count.lastMs = Math.max(0, clock() - started);
      busy = false;
    }
  }

  return {
    render,
    busy: () => busy,
    report: () => ({ ...count }),
  };
}

function metaTitleOf(meta) {
  const info = meta && typeof meta === "object" && meta.info && typeof meta.info === "object" ? meta.info : meta;
  const title = typeof info?.Title === "string" ? info.Title.trim() : "";
  return title;
}

// A second document, not the page-1 canvas lock. The cache is per url, including an empty title.
// want() returns null when the url is cached or disallowed, and the same promise when a fetch is already running.
export function createPdfMetaLookup({ lib } = {}) {
  const cache = new Map();
  const inflight = new Map();

  function title(url) {
    const key = typeof url === "string" ? url.trim() : "";
    return cache.has(key) ? cache.get(key) : "";
  }

  async function fetchOne(url) {
    let task = null;
    let pdf = null;
    const destroy = () => {
      try { pdf?.destroy?.(); } catch { /* gone */ }
      try { task?.destroy?.(); } catch { /* gone */ }
      pdf = null;
      task = null;
    };
    try {
      if (!lib || typeof lib.getDocument !== "function") return "";
      task = lib.getDocument({ url });
      const loaded = task && typeof task.promise?.then === "function" ? task.promise : Promise.resolve(task);
      pdf = await loaded;
      if (!pdf || typeof pdf.getMetadata !== "function") { destroy(); return ""; }
      const meta = await pdf.getMetadata();
      const got = metaTitleOf(meta);
      destroy();
      return got;
    } catch {
      destroy();
      return "";
    }
  }

  function want(url) {
    const key = typeof url === "string" ? url.trim() : "";
    if (!key || !firstPageAllowed(key) || !lib || typeof lib.getDocument !== "function") return null;
    if (cache.has(key)) return null;
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = fetchOne(key).then((got) => {
      const text = typeof got === "string" ? got : "";
      cache.set(key, text);
      inflight.delete(key);
      return text;
    }, () => {
      cache.set(key, "");
      inflight.delete(key);
      return "";
    });
    inflight.set(key, job);
    return job;
  }

  return { title, want };
}
