// What each PDF in the Add panel is: a kept parse, else page 1 (and 2 when 1 is a cover) read with the
// pdf.js Roam already loaded, the same fetch the cover warm makes. One PDF at a time, at idle, only for
// PDFs the panel asked about; nothing runs while the panel is closed. Cached by url in the parse store's
// meta records (one record, key IDENTS_KEY); no new database and no version bump. No graph write.

import { IDENT_V, identFromLines, identFromParse, identMatches, linesOfRecord } from "../model/pdf-ident.js";
import { parsePageGeometry, quickPageTitle } from "../model/parse/index.js";
import { TITLE_REV } from "../model/title-cap.js";
import { loadPageData } from "./parse-engine.js";
import { firstPageAllowed } from "./pdf-first-page.js";

export const IDENTS_KEY = `pdf-idents:${IDENT_V}:${TITLE_REV}`;
export const IDENTS_CAP = 600;
export const READ_TIMEOUT_MS = 12000;
export const RETRY_FAILED_MS = 7 * 86400000;
const COVER_CHARS = 200;

function raceAbort(promise, signal, ms, timers) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; try { timers.clear(id); } catch { /* cleared */ } signal?.removeEventListener?.("abort", onAbort); fn(v); };
    const onAbort = () => finish(reject, new Error("aborted"));
    const id = timers.set(() => finish(reject, new Error("timeout")), ms);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener?.("abort", onAbort);
    Promise.resolve(promise).then((v) => finish(resolve, v), (e) => finish(reject, e));
  });
}

// One PDF's identity from pdf.js: metadata Title, page count, title/authors/venue from page 1 (page 2 joins
// when page 1 has under 200 characters). Resolves null on any failure; the document is always destroyed.
export async function readPdfIdent(lib, url, { signal = null, timeoutMs = READ_TIMEOUT_MS, timers = null } = {}) {
  if (!lib || typeof lib.getDocument !== "function" || !firstPageAllowed(url)) return null;
  const time = {
    set: typeof timers?.setTimeout === "function" ? timers.setTimeout.bind(timers) : setTimeout,
    clear: typeof timers?.clearTimeout === "function" ? timers.clearTimeout.bind(timers) : clearTimeout,
  };
  let task = null;
  let pdf = null;
  try {
    task = lib.getDocument({ url });
    pdf = await raceAbort(task?.promise ?? task, signal, timeoutMs, time);
    if (!pdf || typeof pdf.getPage !== "function") return null;
    let metaTitle = "";
    try { metaTitle = String((await raceAbort(pdf.getMetadata?.(), signal, timeoutMs, time))?.info?.Title ?? ""); } catch (e) { if (signal?.aborted) throw e; }
    const records = [];
    const count = Number.isInteger(pdf.numPages) ? pdf.numPages : 1;
    for (let n = 1; n <= Math.min(2, count); n += 1) {
      const page = await raceAbort(pdf.getPage(n), signal, timeoutMs, time);
      records.push(parsePageGeometry(await raceAbort(loadPageData(page, { includeOps: n === 1 }), signal, timeoutMs, time), n));
      const chars = linesOfRecord(records[0]).reduce((s, l) => s + l.text.length, 0);
      if (n === 1 && chars >= COVER_CHARS) break;
    }
    const found = quickPageTitle(records);
    const first = linesOfRecord(records[0]);
    const lines = first.reduce((s, l) => s + l.text.length, 0) < COVER_CHARS && records[1] ? [...first, ...linesOfRecord(records[1])] : first;
    const ident = identFromLines(lines, { pageTitle: found.pageTitle || "", pageCount: Number.isInteger(pdf.numPages) ? pdf.numPages : null, metaTitle });
    return { ...ident, meta: metaTitle.replace(/\s+/g, " ").trim(), from: "page1" };
  } catch {
    return null;
  } finally {
    try { await pdf?.destroy?.(); } catch { /* gone */ }
    try { await task?.destroy?.(); } catch { /* gone */ }
  }
}

// createPdfNames({ store, lib, readParse, idle, onChange }) → { get, pending, want, stop, matchUrls, ... }.
// store: { getMeta, putMeta } (the parse store). lib(): pdf.js or null. readParse(url): a stored parse doc
// (+ title) or null. idle(fn): run fn at idle, returns a cancel. onChange(urls): identities landed.
export function createPdfNames({ store, lib = () => null, readParse = async () => null, idle, onChange = () => {}, now = () => Date.now(), read = readPdfIdent, timers = null } = {}) {
  const idents = new Map();
  const queue = [];
  const queued = new Set();
  let loading = null;
  let running = "";
  let controller = null;
  let cancelIdle = null;
  let saveCancel = null;
  let stopped = false;
  let stats = { read: 0, parse: 0, failed: 0, ms: 0 };
  const later = typeof idle === "function" ? idle : (fn) => { const id = setTimeout(fn, 30); return () => clearTimeout(id); };

  const load = () => {
    if (loading) return loading;
    loading = (async () => {
      let saved = null;
      try { saved = await store?.getMeta?.(IDENTS_KEY); } catch { saved = null; }
      const rows = saved && typeof saved === "object" && saved.items && typeof saved.items === "object" ? saved.items : {};
      for (const [url, ident] of Object.entries(rows)) if (!idents.has(url) && ident && typeof ident === "object") idents.set(url, ident);
      return idents.size;
    })();
    return loading;
  };

  const save = () => {
    saveCancel?.();
    saveCancel = later(() => {
      saveCancel = null;
      const entries = [...idents.entries()].slice(-IDENTS_CAP);
      void Promise.resolve(store?.putMeta?.(IDENTS_KEY, { v: IDENT_V, items: Object.fromEntries(entries) })).catch(() => {});
    });
  };

  const known = (url) => {
    const got = idents.get(url);
    if (!got) return false;
    if (got.failed) return now() - (Number(got.at) || 0) < RETRY_FAILED_MS;
    return true;
  };

  const pump = () => {
    cancelIdle = null;
    if (stopped || running) return;
    const url = queue.shift();
    if (!url) return;
    queued.delete(url);
    if (known(url)) { schedule(); return; }
    running = url;
    controller = typeof AbortController === "function" ? new AbortController() : null;
    const signal = controller?.signal ?? null;
    const t0 = now();
    (async () => {
      let ident = null;
      try {
        const parsed = await readParse(url);
        if (parsed?.doc) { ident = identFromParse(parsed.doc, { title: parsed.title || "" }); if (ident) { ident.from = "parse"; stats.parse += 1; } }
      } catch { ident = null; }
      if (signal?.aborted) return;
      if (!ident || !ident.title) {
        const pdfLib = (() => { try { return lib(); } catch { return null; } })();
        const got = pdfLib ? await read(pdfLib, url, { signal, timers }) : null;
        if (signal?.aborted) return;
        if (got) { ident = ident ? { ...got, title: got.title || ident.title } : got; stats.read += 1; }
      }
      if (!ident) { stats.failed += 1; idents.set(url, { failed: true, at: now() }); }
      else idents.set(url, { ...ident, at: now() });
      save();
      try { onChange([url]); } catch { /* view */ }
    })().catch(() => {}).finally(() => {
      stats.ms += Math.max(0, now() - t0);
      if (running === url) running = "";
      controller = null;
      schedule();
    });
  };

  const schedule = () => {
    if (stopped || running || cancelIdle || !queue.length) return;
    cancelIdle = later(pump);
  };

  return {
    load,
    // The identity, or null (unknown or failed).
    get(url) {
      const got = idents.get(String(url || ""));
      return got && !got.failed ? got : null;
    },
    // True once the url was read (named or failed); a failure is retried after a week.
    known: (url) => known(String(url || "")),
    // True while the url waits in the queue or is being read.
    pending: (url) => queued.has(url) || running === url,
    // Queue urls (front: read these before the rest). Known urls are skipped.
    async want(urls, { front = false } = {}) {
      stopped = false;
      await load();
      const fresh = [];
      for (const u of Array.isArray(urls) ? urls : []) {
        const url = String(u || "").trim();
        if (!url || known(url) || running === url) continue;
        if (queued.has(url)) {
          if (front) { queue.splice(queue.indexOf(url), 1); fresh.push(url); }
          continue;
        }
        queued.add(url);
        fresh.push(url);
      }
      if (front) queue.unshift(...fresh);
      else queue.push(...fresh.filter((u) => !queue.includes(u)));
      schedule();
      return fresh.length;
    },
    // Panel closed: the queue empties and the read in flight is aborted.
    stop() {
      stopped = true;
      cancelIdle?.();
      cancelIdle = null;
      queue.length = 0;
      queued.clear();
      try { controller?.abort(); } catch { /* gone */ }
    },
    // Urls whose identity holds every term.
    matchUrls(terms) {
      const out = new Set();
      for (const [url, ident] of idents) if (!ident.failed && identMatches(ident, terms)) out.add(url);
      return out;
    },
    report: () => ({ ...stats, known: idents.size, queued: queue.length, running }),
    dispose() { this.stop(); saveCancel?.(); },
  };
}
