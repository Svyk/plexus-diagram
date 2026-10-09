// In-browser reading (beta) for the reading pane and the Engines panel. Wraps createOcrWeb in
// the read-pane `deviceOcr` contract:
//   status()   -> { state: "ready"|"not-downloaded"|"downloading"|"unavailable", progress?, mb }
//   download() -> fetches, hash-checks and caches onnxruntime-web + the PP-OCR models (explicit only)
//   cancel()   -> stops a running download
//   lexicon({ signal }) -> Set of words for the text-line pass, or null (never downloads models)
//   read({ pages, url, getPdf, signal, onProgress }) -> { schema: "pxd-ocr/1", engine, pages: [page records] }
// Constructing it and calling status() fetch nothing; status() only looks in Cache Storage.

import { LEXICON_FILE, MODEL_FILES, ORT_FILES, SCHEMA, ENGINE } from "../model/ocr/manifest.js";
import { createOcrWeb, renderPdfPage } from "./ocr-web.js";
import { setTitleLexicon } from "../model/title-cap.js";
import { buildLines } from "../model/parse/lines.js";
import { titleFromBand } from "../model/parse/title.js";

export const DEVICE_OCR_BYTES = [...Object.values(ORT_FILES), ...Object.values(MODEL_FILES), LEXICON_FILE].reduce((n, f) => n + f.bytes, 0);
const MB = Math.round(DEVICE_OCR_BYTES / (1024 * 1024));

function abortError() {
  const error = new Error("ocr aborted");
  error.name = "AbortError";
  return error;
}

function supported(env) {
  return typeof env.WebAssembly === "object" && Boolean(env.caches) && typeof env.fetch === "function" && Boolean(env.crypto?.subtle);
}

export function createDeviceOcr({ source = null, env = globalThis, dpi = 300, createSource = createOcrWeb } = {}) {
  let currentPdf = null;
  let ocrWeb = source;
  const web = () => {
    if (!ocrWeb) ocrWeb = createSource({ dpi, renderPage: ({ page }) => renderPdfPage(currentPdf, page, dpi) });
    return ocrWeb;
  };
  let downloading = null;
  let progress = 0;
  let ready = false;
  let docKey = "";

  async function status() {
    if (!source && !supported(env)) return { state: "unavailable", mb: MB };
    if (downloading) return { state: "downloading", progress, mb: MB };
    if (!ready) {
      try { ready = Boolean(await web().cached()); } catch { ready = false; }
    }
    return { state: ready ? "ready" : "not-downloaded", mb: MB };
  }

  async function download() {
    if (downloading) return downloading.done;
    const ctl = new AbortController();
    progress = 0;
    const done = (async () => {
      try {
        await web().prefetch({ signal: ctl.signal, onProgress: (got, total) => { progress = total ? got / total : 0; } });
        ready = true;
        return true;
      } catch (error) {
        if (error?.name === "AbortError" || ctl.signal.aborted) return false;
        throw error;
      } finally {
        downloading = null;
      }
    })();
    downloading = { ctl, done };
    return done;
  }

  function cancel() {
    try { downloading?.ctl.abort(); } catch { /* abort */ }
  }

  async function openPdf({ url, getPdf, signal }) {
    let pdf = typeof getPdf === "function" ? await getPdf() : null;
    if (!pdf || typeof pdf.getPage !== "function") {
      // No open reader: the PDF itself, through Roam's pdf.js.
      const lib = env.pdfjsLib;
      if (!url || typeof env.fetch !== "function" || typeof lib?.getDocument !== "function") throw new Error("no PDF to read");
      const res = await env.fetch(url, signal ? { signal } : undefined);
      if (!res?.ok) throw new Error(`fetch failed ${res?.status || ""}`.trim());
      pdf = await lib.getDocument({ data: new Uint8Array(await res.arrayBuffer()), isEvalSupported: false, verbosity: 0 }).promise;
    }
    return pdf;
  }

  async function read({ pages = [], url = "", getPdf = null, signal = null, onProgress = null } = {}) {
    if (signal?.aborted) throw abortError();
    const pdf = await openPdf({ url, getPdf, signal });
    currentPdf = pdf;
    const key = `${url}|${pdf?.fingerprints?.[0] || pdf?.numPages || ""}`;
    const src = web();
    if (key !== docKey) { src.forget?.(); docKey = key; }
    const wanted = (pages || []).filter((n) => Number.isFinite(Number(n)) && Number(n) > 0).map(Number);
    const list = wanted.length ? wanted : [1];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (signal?.aborted) throw abortError();
      const got = await src.ocr({ pages: [list[i]], signal });
      out.push(...(got.pages || []));
      onProgress?.((i + 1) / list.length);
    }
    ready = true;
    return { schema: SCHEMA, engine: ENGINE, pages: out };
  }

  // Top band of page 1, only when the models are already cached and the PDF is already open.
  // Never downloads models and never fetches the file. "" when either is missing.
  async function readBandTitle({ getPdf = null, signal = null, fraction = 0.18 } = {}) {
    if (signal?.aborted) return "";
    const st = await status();
    if (st.state !== "ready") return "";
    let pdf = null;
    try { pdf = typeof getPdf === "function" ? await getPdf() : null; } catch { return ""; }
    if (!pdf || typeof pdf.getPage !== "function") return "";
    currentPdf = pdf;
    let got = null;
    try { got = await web().ocr({ pages: [1], signal, band: fraction }); }
    catch (error) { if (error?.name === "AbortError") throw error; return ""; }
    const page = (got?.pages || [])[0];
    if (!page?.items?.length) return "";
    const { lines } = buildLines(page.items, { transform: page.transform || [1, 0, 0, 1, 0, 0], fonts: page.fonts || {} });
    return titleFromBand(lines) || "";
  }

  // Doubtful-cell re-read at higher zoom on the same source. Never downloads: without cached
  // models it answers nothing, so an automatic read cannot start a fetch.
  async function readCells({ cells = [], url = "", getPdf = null, signal = null } = {}) {
    if (signal?.aborted) throw abortError();
    if (!cells.length) return { cells: [] };
    const st = await status();
    if (st.state !== "ready") return { cells: [] };
    currentPdf = await openPdf({ url, getPdf, signal });
    const got = await web().ocr({ cells, signal });
    return { cells: got?.cells || [] };
  }

  // Word list for the text-line pass. Like readCells it never starts the model download: without
  // cached models it answers null. With them it loads the list (cache, else one small fetch).
  let words = null;
  async function lexicon({ signal = null } = {}) {
    if (words) return words;
    const st = await status();
    if (st.state !== "ready") return null;
    const src = web();
    if (typeof src.lexicon !== "function") return null;
    try { words = (await src.lexicon({ signal })) || null; } catch { words = null; }
    return words;
  }

  // Hands the cached word list (never fetched) to the title splitter.
  let warmJob = null;
  function warmTitleLexicon() {
    if (!warmJob) {
      warmJob = (async () => {
        try {
          const set = typeof web().cachedLexicon === "function" ? await web().cachedLexicon() : null;
          if (set) setTitleLexicon(set);
          return Boolean(set);
        } catch { return false; }
      })();
    }
    return warmJob;
  }

  return { status, download, cancel, read, readCells, readBandTitle, lexicon, warmTitleLexicon, label: "In-browser reading (beta)" };
}

let shared = null;

// One per window: boards share the download state and the worker.
export function sharedDeviceOcr() {
  if (!shared) {
    shared = createDeviceOcr();
    if (supported(globalThis)) shared.warmTitleLexicon();
  }
  return shared;
}
