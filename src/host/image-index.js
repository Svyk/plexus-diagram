// Background index of images for search inside them: a colour palette and, when the user opts in, the text in the picture.
// Records live in the store "image-index" of their own database "plexus-diagram-images", keyed by source key (graph image: its URL; PDF figure: imageKey).
// Nothing runs while the user types in the panel, and nothing runs at all until enqueue() is called.
// Record: { palette: [{hex, lab, weight}], text?, w, h, at, v } or { failed: true, at }.

import { colorPalette } from "../model/color.js";
import { IMAGE_DB_VERSION, STORE_IMAGE_INDEX, openImageDb } from "./diagram-db.js";

export const IMAGE_INDEX_V = 1;
export const RETRY_MS = 7 * 86400000;
export const TYPING_PAUSE_MS = 600;
export const MAX_FETCHES = 2;
export const OCR_MIN_W = 200;
export const OCR_MIN_H = 120;
export const OCR_SESSION_CAP = 40;
export const OCR_MAX_SIDE = 1280;
const SAMPLE = 64;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

// A 64x64 downscale of the picture: { rgba, w, h } with the original size.
export async function decodeSample(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = makeCanvas(SAMPLE, SAMPLE);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, SAMPLE, SAMPLE);
    return { rgba: ctx.getImageData(0, 0, SAMPLE, SAMPLE).data, w: bitmap.width, h: bitmap.height };
  } finally {
    try { bitmap.close?.(); } catch { /* gone */ }
  }
}

// The picture as RGB, longest side at most maxSide: { rgb, width, height, w, h } (w, h = original size).
export async function decodeRgb(blob, maxSide = OCR_MAX_SIDE) {
  const bitmap = await createImageBitmap(blob);
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * k));
    const height = Math.max(1, Math.round(bitmap.height * k));
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const px = ctx.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
    return { rgb, width, height, w: bitmap.width, h: bitmap.height };
  } finally {
    try { bitmap.close?.(); } catch { /* gone */ }
  }
}

function requestResult(req) {
  return new Promise((resolve) => {
    try {
      req.onsuccess = () => resolve({ ok: true, result: req.result });
      req.onerror = (event) => {
        try { event?.preventDefault?.(); } catch { /* ignore */ }
        resolve({ ok: false, result: null });
      };
    } catch {
      resolve({ ok: false, result: null });
    }
  });
}

export function createImageIndex({
  indexedDB: factory = null,
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  decode = decodeSample,
  decodeFull = decodeRgb,
  ocr = null,
  settings = {},
  now = () => Date.now(),
  idle = (fn) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 500 });
    else setTimeout(fn, 16);
  },
  later = (fn, ms) => setTimeout(fn, ms),
  onProgress = null,
  ocrCap = OCR_SESSION_CAP,
} = {}) {
  const wantColors = () => (typeof settings.colors === "function" ? settings.colors() !== false : true);
  const wantText = () => (typeof settings.readText === "function" ? settings.readText() === true : false);
  const records = new Map();
  const colorQ = [];
  const ocrQ = [];
  const queued = new Set();
  let loaded = null;
  let dbPromise = null;
  let dead = !factory;
  let pausedUntil = 0;
  let pumpTimer = false;
  let activeColor = 0;
  let activeOcr = 0;
  let ocrDone = 0;
  let ocrBlocked = false;
  let disposed = false;

  const openDb = () => {
    if (dead) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = openImageDb(factory).then((db) => {
        if (!db) dead = true;
        return db;
      });
    }
    return dbPromise;
  };

  async function withStore(mode, fn) {
    if (dead) return { ok: false };
    try {
      const db = await openDb();
      if (!db || typeof db.transaction !== "function") { dead = true; return { ok: false }; }
      const store = db.transaction(STORE_IMAGE_INDEX, mode).objectStore(STORE_IMAGE_INDEX);
      return await fn(store);
    } catch {
      dead = true;
      return { ok: false };
    }
  }

  // Reads the whole store once; later calls share the result.
  function load() {
    if (!loaded) {
      loaded = (async () => {
        const keys = await withStore("readonly", (store) => requestResult(store.getAllKeys()));
        if (keys?.ok && Array.isArray(keys.result)) {
          for (const key of keys.result) {
            const got = await withStore("readonly", (store) => requestResult(store.get(key)));
            if (got?.ok && got.result && typeof got.result === "object" && !records.has(key)) records.set(key, got.result);
          }
        }
        return records;
      })();
    }
    return loaded;
  }

  async function save(key, record) {
    records.set(key, record);
    await withStore("readwrite", (store) => requestResult(store.put(record, key)));
  }

  const paused = () => pausedUntil > now();
  const progress = () => { try { onProgress?.(status()); } catch { /* listener */ } };

  function status() {
    const textRuns = ocrQ.length > 0 && wantText() && !ocrBlocked && ocrDone < ocrCap;
    const colorRuns = colorQ.length > 0 && wantColors();
    return {
      pending: colorQ.length + activeColor,
      textPending: ocrQ.length + activeOcr,
      indexed: records.size,
      busy: activeColor + activeOcr > 0 || colorRuns || textRuns,
    };
  }

  function whenIdle() {
    return new Promise((resolve) => {
      const go = () => {
        if (disposed) { resolve(); return; }
        if (paused()) { later(go, pausedUntil - now() + 10); return; }
        idle(resolve);
      };
      go();
    });
  }

  async function loadBlob(item) {
    if (typeof item.bytes === "function") {
      const bytes = await item.bytes();
      if (bytes == null) throw Object.assign(new Error("no bytes"), { skip: true });
      return new Blob([bytes]);
    }
    if (typeof fetchImpl !== "function" || !item.url) throw new Error("no source");
    const res = await fetchImpl(item.url, { mode: "cors" });
    if (!res?.ok) throw new Error(`fetch ${res?.status || ""}`);
    return res.blob();
  }

  async function colorJob(item) {
    activeColor += 1;
    try {
      await whenIdle();
      const blob = await loadBlob(item);
      await whenIdle();
      const { rgba, w, h } = await decode(blob);
      await whenIdle();
      const palette = colorPalette(rgba);
      const old = records.get(item.key);
      const keep = old && !old.failed && old.text !== undefined ? { text: old.text } : {};
      await save(item.key, { ...keep, palette, w, h, at: now(), v: IMAGE_INDEX_V });
    } catch (error) {
      // Bytes not stored yet (a figure not extracted): try again next time instead of waiting a week.
      if (!error?.skip) await save(item.key, { failed: true, at: now() });
    } finally {
      activeColor -= 1;
      queued.delete(item.key);
      progress();
      schedulePump(0);
    }
  }

  async function ocrJob(item) {
    activeOcr += 1;
    let counted = false;
    try {
      await whenIdle();
      const blob = await loadBlob(item);
      await whenIdle();
      const full = await decodeFull(blob, OCR_MAX_SIDE);
      const old = records.get(item.key) || {};
      let text = "";
      if (full.w >= OCR_MIN_W && full.h >= OCR_MIN_H) {
        const got = await ocr.readImageText({ rgb: full.rgb, width: full.width, height: full.height });
        if (got === null) { ocrBlocked = true; return; }
        text = got;
        counted = true;
      }
      await save(item.key, { ...old, text, w: old.w || full.w, h: old.h || full.h, at: now(), v: IMAGE_INDEX_V });
    } catch (error) {
      const old = records.get(item.key) || {};
      if (!old.failed && !error?.skip) await save(item.key, { ...old, text: "", at: now(), v: IMAGE_INDEX_V });
    } finally {
      if (counted) ocrDone += 1;
      activeOcr -= 1;
      queued.delete(`t:${item.key}`);
      progress();
      schedulePump(0);
    }
  }

  function pump() {
    pumpTimer = false;
    if (disposed) return;
    if (paused()) { schedulePump(pausedUntil - now() + 10); return; }
    while (activeColor < MAX_FETCHES && colorQ.length && wantColors()) void colorJob(colorQ.shift());
    // Text comes after colour and one at a time, only with models already on this device.
    if (!activeColor && !colorQ.length && !activeOcr && ocrQ.length && wantText() && !ocrBlocked && ocrDone < ocrCap) {
      void ocrJob(ocrQ.shift());
    }
  }

  function schedulePump(ms = 0) {
    if (pumpTimer || disposed) return;
    pumpTimer = true;
    later(pump, Math.max(0, ms));
  }

  // Panel typing. Indexing waits until the user has been idle for TYPING_PAUSE_MS.
  function pause(ms = TYPING_PAUSE_MS) {
    pausedUntil = now() + ms;
  }

  // items: [{ key, url? , bytes?: () => Promise<Uint8Array> }]. Skips what is already indexed.
  async function enqueue(items) {
    await load();
    ocrBlocked = false;
    const t = now();
    for (const item of Array.isArray(items) ? items : []) {
      if (!item?.key || (!item.url && typeof item.bytes !== "function")) continue;
      const rec = records.get(item.key);
      const fresh = rec && !rec.failed && rec.v === IMAGE_INDEX_V && rec.palette;
      if (rec?.failed && t - (rec.at || 0) < RETRY_MS) continue;
      if (!fresh) {
        if (wantColors() && !queued.has(item.key)) { queued.add(item.key); colorQ.push(item); }
      }
      const needText = (!rec || rec.text === undefined) && !(rec?.failed);
      if (needText && ocr && wantText() && !queued.has(`t:${item.key}`)) {
        const small = rec && rec.w && rec.h && (rec.w < OCR_MIN_W || rec.h < OCR_MIN_H);
        if (!small) { queued.add(`t:${item.key}`); ocrQ.push(item); }
      }
    }
    progress();
    schedulePump(0);
    return status();
  }

  function dispose() {
    disposed = true;
    colorQ.length = 0;
    ocrQ.length = 0;
    const opened = dbPromise;
    dbPromise = null;
    dead = true;
    if (opened) opened.then((db) => { try { db?.close?.(); } catch { /* gone */ } }, () => {});
  }

  return { load, enqueue, pause, status, records, dispose, version: IMAGE_DB_VERSION };
}
