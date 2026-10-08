// In-browser PP-OCR source. Constructing it and calling health() fetch nothing.
// ocr() verifies onnxruntime-web and the ONNX weights, then reads pages.

import { preparePageImage, recognizeCells } from "../model/ocr/recognize.js";
import {
  CACHE_NAME, ENGINE, MODEL_FILES, ORT_BASE, ORT_FILES, PAGES_ORIGIN, SCHEMA, dictLines, joinUrl,
} from "../model/ocr/manifest.js";
import { createOrtRunners } from "./ocr-ort.js";

const GLOBAL_KEYS = ["pdfjsLib", "pdfjs-dist/build/pdf", "pdfjs", "PDFJS"];
const DPI = 300;

function abortError() {
  const error = new Error("ocr aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function findPdfjs(explicit) {
  if (explicit && typeof explicit.getDocument === "function") return explicit;
  const root = globalThis;
  for (const key of GLOBAL_KEYS) {
    const lib = root[key];
    if (lib && typeof lib.getDocument === "function") return lib;
  }
  return null;
}

async function sha256Hex(cryptoImpl, buffer) {
  const digest = await cryptoImpl.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function blobUrl(buffer, type) {
  return URL.createObjectURL(new Blob([buffer], { type }));
}

export function createOcrWeb({
  assetBase = PAGES_ORIGIN,
  ortBase = ORT_BASE,
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  caches: cachesImpl = globalThis.caches,
  crypto: cryptoImpl = globalThis.crypto,
  inline = null,
  renderPage = null,
  pdfjs = null,
  workerUrl = null,
  useWorker = true,
  dpi = DPI,
} = {}) {
  let state = "cold";
  const fetched = [];
  const prepared = new Map();
  let engine = null;

  async function openCache() {
    if (!cachesImpl || typeof cachesImpl.open !== "function") return null;
    try { return await cachesImpl.open(CACHE_NAME); } catch { return null; }
  }

  async function loadVerified(url, expect, signal) {
    throwIfAborted(signal);
    const cache = await openCache();
    if (cache) {
      const hit = await cache.match(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        const hash = await sha256Hex(cryptoImpl, buf);
        if (hash === expect.sha256 && buf.byteLength === expect.bytes) return buf;
      }
    }
    if (typeof fetchImpl !== "function") throw new Error("fetch is not available");
    fetched.push(url);
    const res = await fetchImpl(url, signal ? { signal } : undefined);
    if (!res?.ok) throw new Error(`fetch failed ${res?.status || ""} ${url}`.trim());
    const buf = await res.arrayBuffer();
    const hash = await sha256Hex(cryptoImpl, buf);
    if (hash !== expect.sha256 || buf.byteLength !== expect.bytes) {
      throw new Error(`sha256 mismatch for ${url}`);
    }
    if (cache) {
      await cache.put(url, new Response(buf.slice(0), { headers: { "content-type": "application/octet-stream" } }));
    }
    return buf;
  }

  async function loadModel(spec, signal) {
    const own = joinUrl(assetBase, `assets/ocr/${spec.file}`);
    try {
      return await loadVerified(own, spec, signal);
    } catch (error) {
      if (error?.name === "AbortError" || !spec.url) throw error;
      return loadVerified(spec.url, spec, signal);
    }
  }

  function localEngine(runDet, runRec, dict) {
    return {
      async page(n, bytes, signal) {
        if (prepared.has(n)) return prepared.get(n).record;
        const rendered = await renderOne(bytes, n, signal);
        const prep = await preparePageImage({
          ...rendered, dpi: rendered.dpi || dpi, page: n, runDet, runRec, dict, signal,
        });
        prepared.set(n, prep);
        return prep.record;
      },
      async cells(list, bytes, signal) {
        const need = [...new Set(list.map((c) => c.page))];
        for (const n of need) if (!prepared.has(n)) await this.page(n, bytes, signal);
        return (await recognizeCells({ pages: prepared, cells: list, runRec, dict, signal })).cells;
      },
    };
  }

  async function renderOne(bytes, n, signal) {
    throwIfAborted(signal);
    if (typeof renderPage === "function") return renderPage({ bytes, page: n, dpi, signal });
    const lib = findPdfjs(pdfjs);
    if (!lib) throw new Error("pdf.js is not available");
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const task = lib.getDocument({ data, isEvalSupported: false, verbosity: 0 });
    const doc = await task.promise;
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height)
      : globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport }).promise;
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
      rgb[j] = pixels[i];
      rgb[j + 1] = pixels[i + 1];
      rgb[j + 2] = pixels[i + 2];
    }
    return {
      rgb, width, height, dpi,
      pointW: viewport.width * 72 / dpi,
      pointH: viewport.height * 72 / dpi,
      pageCount: doc.numPages,
    };
  }

  async function bootWorker(signal) {
    const ortMjs = await loadVerified(joinUrl(ortBase, ORT_FILES.mjs.file), ORT_FILES.mjs, signal);
    const wasmMjs = await loadVerified(joinUrl(ortBase, ORT_FILES.wasmMjs.file), ORT_FILES.wasmMjs, signal);
    const wasm = await loadVerified(joinUrl(ortBase, ORT_FILES.wasm.file), ORT_FILES.wasm, signal);
    const det = await loadModel(MODEL_FILES.det, signal);
    const rec = await loadModel(MODEL_FILES.rec, signal);
    const dictBuf = await loadModel(MODEL_FILES.dict, signal);
    const dictText = new TextDecoder().decode(dictBuf);
    const urls = {
      ortUrl: blobUrl(ortMjs, "text/javascript"),
      wasmMjsUrl: blobUrl(wasmMjs, "text/javascript"),
      wasmUrl: blobUrl(wasm, "application/wasm"),
    };
    const scriptUrl = workerUrl || joinUrl(assetBase, "assets/ocr/ocr-worker.js");
    fetched.push(scriptUrl);
    const worker = new Worker(scriptUrl, { type: "module" });
    const pending = new Map();
    let seq = 0;
    const records = new Map();
    const rejectAll = (error) => {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    };
    worker.onmessage = (ev) => {
      const msg = ev.data || {};
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.type === "error") waiter.reject(Object.assign(new Error(msg.message), { name: msg.message === "ocr aborted" ? "AbortError" : "Error" }));
      else waiter.resolve(msg);
    };
    worker.onerror = (ev) => rejectAll(new Error(ev?.message || "ocr worker failed"));
    function call(msg, transfers) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { worker.postMessage({ ...msg, id }, transfers || []); }
        catch (error) { pending.delete(id); reject(error); }
      });
    }
    await call({ type: "init", ...urls, det, rec, dictText }, [det, rec]);
    return {
      stop() { try { worker.postMessage({ type: "abort" }); } catch { /* gone */ } },
      async page(n, bytes, signal) {
        throwIfAborted(signal);
        if (records.has(n)) return records.get(n);
        const rendered = await renderOne(bytes, n, signal);
        const rgb = rendered.rgb;
        const msg = await call({
          type: "page", n, width: rendered.width, height: rendered.height, dpi: rendered.dpi,
          pointW: rendered.pointW, pointH: rendered.pointH, rgb,
        }, [rgb.buffer]);
        records.set(n, msg.record);
        return msg.record;
      },
      async cells(list, bytes, signal) {
        const need = [...new Set(list.map((c) => c.page))];
        for (const n of need) if (!records.has(n)) await this.page(n, bytes, signal);
        const msg = await call({ type: "cells", cells: list });
        return msg.cells;
      },
    };
  }

  async function ensure(signal) {
    if (engine) return engine;
    throwIfAborted(signal);
    if (inline?.runDet && inline?.runRec) {
      state = "ready";
      engine = localEngine(inline.runDet, inline.runRec, inline.dict || []);
      return engine;
    }
    state = "loading";
    if (useWorker && typeof Worker === "function") {
      try {
        engine = await bootWorker(signal);
        state = "ready";
        return engine;
      } catch (error) {
        if (error?.name === "AbortError") { state = "cold"; throw error; }
        engine = null;
      }
    }
    const ortMjs = await loadVerified(joinUrl(ortBase, ORT_FILES.mjs.file), ORT_FILES.mjs, signal);
    const wasmMjs = await loadVerified(joinUrl(ortBase, ORT_FILES.wasmMjs.file), ORT_FILES.wasmMjs, signal);
    const wasm = await loadVerified(joinUrl(ortBase, ORT_FILES.wasm.file), ORT_FILES.wasm, signal);
    const det = await loadModel(MODEL_FILES.det, signal);
    const rec = await loadModel(MODEL_FILES.rec, signal);
    const dictBuf = await loadModel(MODEL_FILES.dict, signal);
    const ort = await import(blobUrl(ortMjs, "text/javascript"));
    if (ort.env?.wasm) {
      ort.env.wasm.wasmPaths = {
        mjs: blobUrl(wasmMjs, "text/javascript"),
        wasm: blobUrl(wasm, "application/wasm"),
      };
      if (typeof crossOriginIsolated === "undefined" || !crossOriginIsolated) ort.env.wasm.numThreads = 1;
    }
    const runners = await createOrtRunners(ort, det, rec);
    engine = localEngine(runners.runDet, runners.runRec, dictLines(new TextDecoder().decode(dictBuf)));
    state = "ready";
    return engine;
  }

  async function health() {
    return { state, schema: SCHEMA, engine: ENGINE };
  }

  async function ocr({ bytes, sha256 = null, pages, cells, signal } = {}) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    throwIfAborted(signal);
    const ready = await ensure(signal);
    let body;
    if (cells?.length) {
      body = { cells: await ready.cells(cells, bytes, signal) };
    } else {
      const wanted = pages?.length ? pages : [1];
      const out = [];
      for (const n of wanted) out.push(await ready.page(n, bytes, signal));
      body = { pageCount: out.length, pages: out };
    }
    const elapsedMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    return { schema: SCHEMA, engine: ENGINE, sha256, elapsedMs, ...body };
  }

  return {
    health,
    ocr,
    schema: SCHEMA,
    engine: ENGINE,
    fetches: () => fetched.slice(),
  };
}
