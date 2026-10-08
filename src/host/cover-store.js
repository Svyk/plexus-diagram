// PDF-U1 cover cache. IndexedDB database "plexus-diagram" (version 2, shared
// with the parse stores; see diagram-db.js), object store "covers", key = pdf url.
// localStorage key "plexus-diagram:covers" holds at most 8 when IndexedDB is
// missing, throws, or rejects. get() never writes.
// Every method returns a promise and resolves null on failure. No graph write.

import { TITLE_REV } from "../model/title-cap.js";
import { coverKey } from "../model/pdf-cover.js";
import { DIAGRAM_DB, DIAGRAM_DB_VERSION, STORE_COVERS, openDiagramDb } from "./diagram-db.js";

export const COVER_DB = DIAGRAM_DB;
export const COVER_STORE = STORE_COVERS;
export const COVER_DB_VERSION = DIAGRAM_DB_VERSION;
export const COVER_LS_KEY = "plexus-diagram:covers";
export const COVER_LS_CAP = 8;
// A 320px JPEG is about 34KB on disk, ~46KB as base64. Leave room for two images.
const IMAGE_CHAR_CAP = 120000;
const OPEN_CAP_MS = 2000;

function emptyBook() {
  return { order: [], items: {} };
}

function arm(ms, fn) {
  try {
    const id = setTimeout(fn, ms);
    try { id?.unref?.(); } catch { /* a browser id is a number */ }
    return id;
  } catch {
    return null;
  }
}

function withCap(work, ms) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (value) => {
      if (settled) return;
      settled = true;
      if (timer != null) {
        try { clearTimeout(timer); } catch { /* ignore */ }
      }
      resolve(value);
    };
    timer = arm(ms, () => done(null));
    Promise.resolve()
      .then(work)
      .then((value) => done(value), () => done(null));
  });
}

function requestResult(req) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      req.onsuccess = () => done({ ok: true, result: req.result });
      req.onerror = (event) => {
        try { event?.preventDefault?.(); } catch { /* ignore */ }
        try { req.preventDefault?.(); } catch { /* ignore */ }
        done({ ok: false, result: null });
      };
    } catch {
      done({ ok: false, result: null });
    }
  });
}

function openDb(factory) {
  return openDiagramDb(factory, { capMs: OPEN_CAP_MS });
}

async function blobToDataUrl(blob) {
  try {
    if (typeof blob?.arrayBuffer !== "function") return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const step = 0x4000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    const type = typeof blob.type === "string" && blob.type ? blob.type : "image/jpeg";
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function dataUrlToBlob(value) {
  try {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
    if (!match) return null;
    const type = match[1] || "image/jpeg";
    const payload = match[3] || "";
    if (!match[2]) return new Blob([decodeURIComponent(payload)], { type });
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 255;
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

// null means "no image". false means "could not encode".
async function storeImage(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    if (value.length > IMAGE_CHAR_CAP) return false;
    return value;
  }
  const url = await blobToDataUrl(value);
  if (!url || url.length > IMAGE_CHAR_CAP) return false;
  return url;
}

function reviveImage(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  if (value.startsWith("data:")) return dataUrlToBlob(value) || value;
  return value;
}

function revive(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = coverKey(raw.url);
  if (!url) return null;
  return {
    url,
    hash: typeof raw.hash === "string" ? raw.hash : "",
    first: reviveImage(raw.first),
    last: reviveImage(raw.last),
    lastPage: Number.isInteger(raw.lastPage) && raw.lastPage >= 1 ? raw.lastPage : null,
    pageCount: Number.isInteger(raw.pageCount) && raw.pageCount >= 1 ? raw.pageCount : null,
    w: Number.isInteger(raw.w) && raw.w >= 1 ? raw.w : null,
    h: Number.isInteger(raw.h) && raw.h >= 1 ? raw.h : null,
    ...titleOf(raw),
    ts: typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : 0,
  };
}

const TITLE_LINES = 60;
const TITLE_LINE_CHARS = 160;

// The page title read during a warm and the page-1 lines behind it (null: never read).
// A title made by an older splitter (titleRev below TITLE_REV) reads as never read: it is read again.
function titleOf(raw) {
  const titleRev = Number.isInteger(raw?.titleRev) && raw.titleRev > 0 ? raw.titleRev : 0;
  const fresh = titleRev >= TITLE_REV;
  const pageTitle = typeof raw?.pageTitle === "string" && fresh ? raw.pageTitle.slice(0, 300) : null;
  const lines = Array.isArray(raw?.titleLines) ? raw.titleLines.filter((t) => typeof t === "string").slice(0, TITLE_LINES).map((t) => t.slice(0, TITLE_LINE_CHARS)) : [];
  return { pageTitle, titleRev: pageTitle === null ? 0 : titleRev, titleLines: lines };
}

export function createCoverStore({ indexedDB, storage } = {}) {
  const factory = indexedDB || null;
  const ls = storage || null;
  let dbPromise = null;
  let idbDead = !factory;
  let book = null;

  const loadBook = () => {
    if (book) return book;
    book = emptyBook();
    if (!ls || typeof ls.getItem !== "function") return book;
    try {
      const raw = ls.getItem(COVER_LS_KEY);
      if (!raw) return book;
      const parsed = JSON.parse(raw);
      const order = Array.isArray(parsed?.order) ? parsed.order.filter((url) => typeof url === "string" && url) : [];
      const items = parsed?.items && typeof parsed.items === "object" ? parsed.items : {};
      const keep = [];
      for (const url of order) {
        if (!Object.prototype.hasOwnProperty.call(items, url)) continue;
        keep.push(url);
      }
      book = { order: keep, items };
    } catch {
      book = emptyBook();
    }
    return book;
  };

  const saveBook = () => {
    if (!ls || typeof ls.setItem !== "function") return false;
    try {
      if (!book.order.length && typeof ls.removeItem === "function") {
        ls.removeItem(COVER_LS_KEY);
        return true;
      }
      ls.setItem(COVER_LS_KEY, JSON.stringify(book));
      return true;
    } catch {
      return false;
    }
  };

  const remember = (url) => {
    const data = loadBook();
    const at = data.order.indexOf(url);
    if (at >= 0) data.order.splice(at, 1);
    data.order.push(url);
  };

  const open = () => {
    if (idbDead) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = openDb(factory).then((db) => {
        if (!db) { idbDead = true; dbPromise = null; }
        return db;
      });
    }
    return dbPromise;
  };

  const run = async (mode, fn) => {
    if (idbDead) return { ok: false, result: null };
    try {
      const db = await open();
      if (!db || typeof db.transaction !== "function") {
        idbDead = true;
        return { ok: false, result: null };
      }
      let tx = null;
      let store = null;
      try {
        tx = db.transaction(COVER_STORE, mode);
        store = tx.objectStore(COVER_STORE);
      } catch {
        idbDead = true;
        return { ok: false, result: null };
      }
      try {
        tx.onerror = (event) => { try { event?.preventDefault?.(); } catch { /* ignore */ } };
        tx.onabort = () => {};
      } catch { /* the request result still settles */ }
      return await fn(store);
    } catch {
      idbDead = true;
      return { ok: false, result: null };
    }
  };

  const idbGet = (url) => withCap(
    () => run("readonly", (store) => requestResult(store.get(url))),
    OPEN_CAP_MS,
  );

  const idbPut = (url, record) => withCap(
    () => run("readwrite", (store) => requestResult(store.put(record, url))),
    OPEN_CAP_MS,
  );

  const idbDelete = (url) => withCap(
    () => run("readwrite", (store) => requestResult(store.delete(url))),
    OPEN_CAP_MS,
  );

  const lsGet = (url) => {
    try {
      const data = loadBook();
      if (!Object.prototype.hasOwnProperty.call(data.items, url)) return null;
      remember(url);
      return revive(data.items[url]);
    } catch {
      return null;
    }
  };

  const lsPut = async (record) => {
    try {
      const first = await storeImage(record.first);
      if (first === false) return null;
      let last = await storeImage(record.last);
      if (last === false) last = null;
      const data = loadBook();
      data.items[record.url] = {
        url: record.url,
        hash: typeof record.hash === "string" ? record.hash : "",
        first,
        last,
        lastPage: record.lastPage ?? null,
        pageCount: record.pageCount ?? null,
        w: record.w ?? null,
        h: record.h ?? null,
        ...titleOf(record),
        ts: typeof record.ts === "number" ? record.ts : 0,
      };
      remember(record.url);
      while (data.order.length > COVER_LS_CAP) {
        const oldest = data.order.shift();
        if (oldest) delete data.items[oldest];
      }
      if (!saveBook()) return null;
      return revive(data.items[record.url]) || record;
    } catch {
      return null;
    }
  };

  const lsDelete = (url) => {
    try {
      const data = loadBook();
      const at = data.order.indexOf(url);
      const had = at >= 0 || Object.prototype.hasOwnProperty.call(data.items, url);
      // A miss is success. Do not write localStorage just to confirm it.
      if (!had) return true;
      if (at >= 0) data.order.splice(at, 1);
      delete data.items[url];
      return saveBook();
    } catch {
      return false;
    }
  };

  return {
    async get(url) {
      try {
        const key = coverKey(url);
        if (!key) return null;
        if (!idbDead) {
          const hit = await idbGet(key);
          if (hit?.ok) {
            if (hit.result == null) return lsGet(key);
            return revive(hit.result) || hit.result;
          }
        }
        return lsGet(key);
      } catch {
        return null;
      }
    },
    async put(record) {
      try {
        if (!record || typeof record !== "object") return null;
        const key = coverKey(record.url);
        if (!key) return null;
        const stored = {
          url: key,
          hash: typeof record.hash === "string" ? record.hash : "",
          first: record.first ?? null,
          last: record.last ?? null,
          lastPage: Number.isInteger(record.lastPage) && record.lastPage >= 1 ? record.lastPage : null,
          pageCount: Number.isInteger(record.pageCount) && record.pageCount >= 1 ? record.pageCount : null,
          w: Number.isInteger(record.w) && record.w >= 1 ? record.w : null,
          h: Number.isInteger(record.h) && record.h >= 1 ? record.h : null,
          ...titleOf(record),
          ts: typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : 0,
        };
        if (!idbDead) {
          const wrote = await idbPut(key, stored);
          if (wrote?.ok) return stored;
        }
        return lsPut(stored);
      } catch {
        return null;
      }
    },
    async remove(url) {
      try {
        const key = coverKey(url);
        if (!key) return null;
        const haveIdb = !idbDead;
        const haveLs = Boolean(ls);
        if (!haveIdb && !haveLs) return null;
        // A miss is success. A throw is not: the next get would revive a copy
        // that survived. Clear both backends even when one of them fails.
        let idbOk = true;
        if (haveIdb) {
          const removed = await idbDelete(key);
          idbOk = removed?.ok === true;
        }
        const lsOk = haveLs ? lsDelete(key) : true;
        return idbOk && lsOk ? true : null;
      } catch {
        return null;
      }
    },
  };
}
