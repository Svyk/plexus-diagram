// Parse cache. Same IndexedDB database as the cover store (plexus-diagram,
// version 2): stores "parse", "parse-images", and "parse-index".
// 50 documents LRU, 200 MB of images LRU. When IndexedDB is missing or fails,
// the same API runs on an in-memory fallback. No graph writes.

import { scanPagesOf } from "../model/scan-pages.js";
import { bestLocalDoc, fillFreePages, paidPagesOnly } from "../model/cloud-merge.js";
import { parsedDocTitle, parsedTitleLines } from "../model/pdf.js";
import { forgetDiagramDb, openDiagramDb, STORE_PARSE, STORE_PARSE_IMAGES, STORE_PARSE_INDEX } from "./diagram-db.js";
import { optionsHash } from "../model/parse-hash.js";
import { PARSE_REV } from "../model/parse/index.js";

export const PARSE_DOC_CAP = 50;
export const PARSE_IMAGE_CAP = 200 * 1024 * 1024;
const META_KEY = "meta:lru";

// One shared listener list for every store instance (boards each build their own store).
const storedListeners = new Set();

// fn({ sha256, engine }) runs after a parse is written. Returns the unsubscribe.
export function subscribeParseStored(fn) {
  if (typeof fn !== "function") return () => {};
  storedListeners.add(fn);
  return () => { storedListeners.delete(fn); };
}

function notifyParseStored(doc) {
  for (const fn of [...storedListeners]) {
    try { fn({ sha256: doc.sha256, engine: doc.engine }); } catch { /* a listener must not fail a write */ }
  }
}

export function parseKey(sha256, engine, optsHash) {
  return `${sha256}|${engine}|${optsHash}`;
}

function ocrRead(doc) {
  const mode = doc?.options?.ocr;
  return (mode && mode !== "none") || Boolean(doc?.ocr?.pages?.length) || (doc?.pages || []).some((p) => p.ocr);
}

// A built-in, non-OCR doc from an older engine revision: treated as absent so it is parsed again.
// OCR-read docs are kept (re-reading costs OCR); helper docs are not ours to judge.
export function isStaleParse(doc) {
  if (!doc || doc.engine !== "builtin" || ocrRead(doc)) return false;
  return !(Number(doc.parseRev) >= PARSE_REV);
}

// The parse to restore for a PDF. Per engine (in order): the newest OCR-read parse (no scanned page
// left unread) wins over the scan-only one saved before the read; otherwise the plain options hash.
// Pages a stored parse actually holds.
const pagesSeen = (doc) => (Array.isArray(doc?.pages) ? doc.pages.length : 0) || Number(doc?.pageCount) || 0;

export async function restorableParse(store, sha, { engines, plainHash, readHashOf = null } = {}) {
  if (!store || !sha) return null;
  let listed = [];
  try { listed = typeof store.listParses === "function" ? await store.listParses(sha) : []; } catch { listed = []; }
  listed = listed.filter((row) => !isStaleParse(row.doc));
  // A stored cloud parse is the one the user paid for. Its pages win, even over a fuller free parse;
  // the best free parse fills the pages it does not hold (a paid page range inside a whole-file parse).
  const paid = engines?.includes?.("cloud") ? listed.filter((row) => row.engine === "cloud").pop() : null;
  const free = await freeParse(store, sha, listed.filter((row) => row.engine !== "cloud"), {
    engines: (engines || []).filter((e) => e !== "cloud"), plainHash, readHashOf,
  });
  return paid ? fillFreePages(paid.doc, free) : free;
}

async function freeParse(store, sha, listed, { engines, plainHash, readHashOf }) {
  // A parse that covers fewer pages than another parse of the same file (a page range, or a PDF that was
  // not loaded yet) loses to the fuller one.
  const most = Math.max(0, ...listed.map((row) => pagesSeen(row.doc)));
  const whole = listed.filter((row) => pagesSeen(row.doc) >= most);
  if (whole.length) listed = whole;
  // A finished scan read (no unread scan pages) of any engine comes before a plain parse.
  for (const engine of engines) {
    const read = listed.filter((row) => row.engine === engine && row.doc?.options?.ocr === "vision" && !scanPagesOf(row.doc).length).pop();
    if (read) return read.doc;
  }
  // Then plain parses, Docling before the instant built-in one: Parse runs Docling first, so its read is the
  // one the user asked for.
  const plainOrder = engines.includes("docling") && engines.includes("builtin")
    ? ["docling", ...engines.filter((e) => e !== "docling")] : engines;
  for (const engine of plainOrder) {
    const mine = listed.filter((row) => row.engine === engine);
    let plain = await store.getParse(sha, engine, plainHash);
    if (isStaleParse(plain) || (plain && pagesSeen(plain) < most)) plain = null;
    plain = plain || mine.pop()?.doc || null;
    if (!plain) continue;
    if (scanPagesOf(plain).length && readHashOf) {
      const alt = await store.getParse(sha, engine, await readHashOf(plain));
      if (alt && !isStaleParse(alt) && pagesSeen(alt) >= most) return alt;
    }
    return plain;
  }
  return null;
}

export const RESTORE_ENGINES = Object.freeze(["builtin", "docling", "mixed", "anydoc", "cloud"]);

// restorableParse for a PDF url: the url index gives the sha, `plainOptions` the options of the plain parse.
export async function restorableByUrl(store, url, { plainOptions, engines = RESTORE_ENGINES } = {}) {
  if (!store || !url) return null;
  const hit = await store.findByUrl(url);
  if (!hit?.sha256) return null;
  return restorableParse(store, hit.sha256, {
    engines,
    plainHash: await optionsHash(plainOptions),
    readHashOf: (plain) => optionsHash({ ...(plain.options || plainOptions), ocr: "vision" }),
  });
}

// A parse to READ text from (part search, Ask AI). Stale built-in parses are fine here: the words are
// the same, only the layout analysis is older. Falls back to any stored parse of the url:
// cloud first, then an OCR-read doc with no unread scan pages, then the newest by `at`.
export async function readableParse(store, url, { plainOptions, engines = RESTORE_ENGINES } = {}) {
  if (!store || !url) return null;
  const fresh = await restorableByUrl(store, url, { plainOptions, engines });
  if (fresh) return fresh;
  const hit = await store.findByUrl(url);
  if (!hit?.sha256 || typeof store.listParses !== "function") return null;
  let listed = [];
  try { listed = await store.listParses(hit.sha256); } catch { listed = []; }
  const rows = listed.filter((row) => row?.doc?.blocks);
  const newest = (list) => list.slice().sort((x, y) => (Number(y.at) || 0) - (Number(x.at) || 0))[0]?.doc || null;
  const cloud = rows.filter((row) => (row.engine || row.doc.engine) === "cloud");
  if (cloud.length) return newest(cloud);
  const read = rows.filter((row) => row.doc.options?.ocr === "vision" && !scanPagesOf(row.doc).length);
  if (read.length) return newest(read);
  return newest(rows);
}

// The document to show, plus a title that does not degrade when the cloud read has none.
// `linesDoc` is the document the title came from (for the banner check).
export async function restorableTitle(store, url, plainOptions) {
  const found = await restorableByUrl(store, url, { plainOptions });
  if (!found) return { doc: null, title: "", lines: [] };
  let title = parsedDocTitle(found);
  let linesDoc = found;
  if (!title && found.engine === "cloud" && found.sha256 && typeof store.listParses === "function") {
    let listed = [];
    try { listed = await store.listParses(found.sha256); } catch { listed = []; }
    const local = bestLocalDoc(listed);
    const localTitle = parsedDocTitle(local);
    if (localTitle) {
      title = localTitle;
      linesDoc = local;
    }
  }
  return { doc: found, title, lines: parsedTitleLines(linesDoc) };
}

export function imageKey(sha256, blockId) {
  return `${sha256}/${blockId}`;
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
        done({ ok: false, result: null });
      };
    } catch {
      done({ ok: false, result: null });
    }
  });
}

function byteLengthOf(bytes) {
  if (bytes == null) return 0;
  if (typeof bytes === "string") return new TextEncoder().encode(bytes).byteLength;
  if (bytes instanceof ArrayBuffer) return bytes.byteLength;
  if (ArrayBuffer.isView(bytes)) return bytes.byteLength;
  if (typeof bytes.size === "number") return bytes.size;
  return 0;
}

function copyBytes(bytes) {
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes).slice();
  return bytes;
}

function emptyMeta() {
  return { docs: [], images: [] };
}

export function createParseStore({ indexedDB: factory, now, docCap = PARSE_DOC_CAP, imageCap = PARSE_IMAGE_CAP } = {}) {
  const clock = typeof now === "function" ? now : () => Date.now();
  const memory = {
    parse: new Map(),
    images: new Map(),
    index: new Map(),
  };
  let idbDead = !factory;

  // The shared connection is cached by openDiagramDb, which drops it when it closes or a newer version asks. The
  // store never holds a connection of its own, so a closed one is replaced on the next call.
  const open = () => {
    if (idbDead) return Promise.resolve(null);
    return openDiagramDb(factory).then((db) => {
      if (!db) idbDead = true;
      return db;
    });
  };

  const run = async (storeName, mode, fn) => {
    if (idbDead) return { ok: false };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let store = null;
      try {
        const db = await open();
        if (!db || typeof db.transaction !== "function") {
          idbDead = true;
          return { ok: false };
        }
        try {
          store = db.transaction(storeName, mode).objectStore(storeName);
        } catch {
          // A connection that closed under us: open a fresh one once.
          forgetDiagramDb(factory);
          continue;
        }
      } catch {
        idbDead = true;
        return { ok: false };
      }
      try {
        return await fn(store);
      } catch {
        idbDead = true;
        return { ok: false };
      }
    }
    idbDead = true;
    return { ok: false };
  };

  const backend = {
    async get(storeName, key) {
      if (!idbDead) {
        const hit = await run(storeName, "readonly", (store) => requestResult(store.get(key)));
        if (hit?.ok) return hit.result === undefined ? null : hit.result;
      }
      const map = storeName === STORE_PARSE ? memory.parse : storeName === STORE_PARSE_IMAGES ? memory.images : memory.index;
      return map.has(key) ? map.get(key) : null;
    },
    async put(storeName, key, value) {
      if (!idbDead) {
        const wrote = await run(storeName, "readwrite", (store) => requestResult(store.put(value, key)));
        if (wrote?.ok) return true;
      }
      const map = storeName === STORE_PARSE ? memory.parse : storeName === STORE_PARSE_IMAGES ? memory.images : memory.index;
      map.set(key, value);
      return true;
    },
    async delete(storeName, key) {
      if (!idbDead) {
        const removed = await run(storeName, "readwrite", (store) => requestResult(store.delete(key)));
        if (removed?.ok) return true;
      }
      const map = storeName === STORE_PARSE ? memory.parse : storeName === STORE_PARSE_IMAGES ? memory.images : memory.index;
      map.delete(key);
      return true;
    },
    async keys(storeName) {
      if (!idbDead) {
        const hit = await run(storeName, "readonly", (store) => {
          if (typeof store.getAllKeys === "function") return requestResult(store.getAllKeys());
          if (typeof store.getAll === "function") {
            return requestResult(store.getAll()).then((res) => {
              if (!res?.ok || !Array.isArray(res.result)) return res;
              const keys = res.result.map((row) => row?.key).filter((key) => key != null);
              return { ok: true, result: keys };
            });
          }
          return Promise.resolve({ ok: false, result: null });
        });
        if (hit?.ok && Array.isArray(hit.result)) return hit.result;
      }
      const map = storeName === STORE_PARSE ? memory.parse : storeName === STORE_PARSE_IMAGES ? memory.images : memory.index;
      return [...map.keys()];
    },
  };

  const loadMeta = async () => {
    const raw = await backend.get(STORE_PARSE_INDEX, META_KEY);
    if (!raw || typeof raw !== "object") return emptyMeta();
    return {
      docs: Array.isArray(raw.docs) ? raw.docs.filter((key) => typeof key === "string") : [],
      images: Array.isArray(raw.images)
        ? raw.images.filter((row) => row && typeof row.key === "string" && typeof row.bytes === "number")
        : [],
    };
  };

  const saveMeta = (meta) => backend.put(STORE_PARSE_INDEX, META_KEY, meta);

  const touch = (list, key) => {
    const next = list.filter((item) => item !== key);
    next.push(key);
    return next;
  };

  return {
    async getParse(sha, engine, optsHash) {
      try {
        if (!sha || !engine || !optsHash) return null;
        const key = parseKey(sha, engine, optsHash);
        const record = await backend.get(STORE_PARSE, key);
        if (!record?.doc) return null;
        const meta = await loadMeta();
        meta.docs = touch(meta.docs, key);
        await saveMeta(meta);
        return record.doc;
      } catch {
        return null;
      }
    },

    // Every cached parse of one PDF: [{ engine, optsHash, at, doc }], oldest first.
    async listParses(sha) {
      try {
        if (!sha) return [];
        const prefix = `${sha}|`;
        const keys = (await backend.keys(STORE_PARSE)).filter((key) => typeof key === "string" && key.startsWith(prefix));
        const out = [];
        for (const key of keys) {
          const record = await backend.get(STORE_PARSE, key);
          if (!record?.doc) continue;
          out.push({ engine: record.doc.engine || key.split("|")[1], optsHash: record.optsHash || key.split("|")[2], at: record.at || 0, doc: record.doc });
        }
        return out.sort((a, b) => a.at - b.at);
      } catch {
        return [];
      }
    },

    async putParse(doc) {
      try {
        doc = paidPagesOnly(doc);
        if (!doc || typeof doc !== "object" || !doc.sha256 || !doc.engine) return null;
        const optsHash = typeof doc.optsHash === "string" && doc.optsHash
          ? doc.optsHash
          : await optionsHash(doc.options || {});
        const key = parseKey(doc.sha256, doc.engine, optsHash);
        const stored = { ...doc, optsHash };
        const record = { doc: stored, optsHash, at: clock() };
        if (!(await backend.put(STORE_PARSE, key, record))) return null;
        const meta = await loadMeta();
        meta.docs = touch(meta.docs, key);
        while (meta.docs.length > docCap) {
          const oldest = meta.docs.shift();
          if (oldest) await backend.delete(STORE_PARSE, oldest);
        }
        if (stored.engine === "builtin" && !isStaleParse(stored)) {
          const prefix = `${stored.sha256}|builtin|`;
          for (const old of (await backend.keys(STORE_PARSE)).filter((k) => typeof k === "string" && k.startsWith(prefix) && k !== key)) {
            const rec = await backend.get(STORE_PARSE, old);
            if (rec?.doc && isStaleParse(rec.doc)) {
              await backend.delete(STORE_PARSE, old);
              meta.docs = meta.docs.filter((k) => k !== old);
            }
          }
        }
        await saveMeta(meta);
        notifyParseStored(stored);
        return stored;
      } catch {
        return null;
      }
    },

    async findByUrl(url) {
      try {
        if (!url) return null;
        const record = await backend.get(STORE_PARSE_INDEX, url);
        if (!record || record.sha256 == null) return null;
        return {
          sha256: record.sha256,
          pageCount: record.pageCount ?? null,
          at: record.at ?? null,
        };
      } catch {
        return null;
      }
    },

    // Every PDF url with a stored parse (the Parsed PDFs filter): one key read, no records.
    async parsedUrls() {
      try {
        const keys = await backend.keys(STORE_PARSE_INDEX);
        return (Array.isArray(keys) ? keys : []).filter((k) => typeof k === "string" && k !== META_KEY && !k.startsWith("meta:"));
      } catch {
        return [];
      }
    },

    async indexUrl(url, info) {
      try {
        if (!url || !info || !info.sha256) return null;
        const record = {
          sha256: info.sha256,
          pageCount: Number.isInteger(info.pageCount) ? info.pageCount : null,
          at: clock(),
        };
        if (!(await backend.put(STORE_PARSE_INDEX, url, record))) return null;
        return record;
      } catch {
        return null;
      }
    },

    // Small key/value records beside the URL index, under "meta:" so they never collide with a PDF URL.
    async getMeta(key) {
      try {
        if (!key) return null;
        const got = await backend.get(STORE_PARSE_INDEX, `meta:${key}`);
        return got === undefined ? null : got;
      } catch {
        return null;
      }
    },

    async putMeta(key, value) {
      try {
        if (!key) return false;
        return Boolean(await backend.put(STORE_PARSE_INDEX, `meta:${key}`, value));
      } catch {
        return false;
      }
    },

    async getImage(key) {
      try {
        if (!key) return null;
        const record = await backend.get(STORE_PARSE_IMAGES, key);
        if (!record || record.bytes == null) return null;
        const meta = await loadMeta();
        meta.images = meta.images.filter((row) => row.key !== key).concat(
          meta.images.filter((row) => row.key === key),
        );
        await saveMeta(meta);
        return record.bytes;
      } catch {
        return null;
      }
    },

    async putImage(key, bytes) {
      try {
        if (!key || bytes == null) return null;
        const size = byteLengthOf(bytes);
        if (size <= 0 || size > imageCap) return null;
        const stored = copyBytes(bytes);
        const meta = await loadMeta();
        meta.images = meta.images.filter((row) => row.key !== key);
        let used = meta.images.reduce((sum, row) => sum + row.bytes, 0);
        while (meta.images.length && used + size > imageCap) {
          const oldest = meta.images.shift();
          used -= oldest.bytes;
          await backend.delete(STORE_PARSE_IMAGES, oldest.key);
        }
        if (!(await backend.put(STORE_PARSE_IMAGES, key, { bytes: stored, byteLength: size, at: clock() }))) return null;
        meta.images.push({ key, bytes: size });
        await saveMeta(meta);
        return stored;
      } catch {
        return null;
      }
    },

    async clear() {
      try {
        const meta = await loadMeta();
        for (const key of meta.docs) await backend.delete(STORE_PARSE, key);
        for (const row of meta.images) await backend.delete(STORE_PARSE_IMAGES, row.key);
        const indexKeys = await backend.keys(STORE_PARSE_INDEX);
        for (const key of indexKeys) await backend.delete(STORE_PARSE_INDEX, key);
        const parseKeys = await backend.keys(STORE_PARSE);
        for (const key of parseKeys) await backend.delete(STORE_PARSE, key);
        const imageKeys = await backend.keys(STORE_PARSE_IMAGES);
        for (const key of imageKeys) await backend.delete(STORE_PARSE_IMAGES, key);
        memory.parse.clear();
        memory.images.clear();
        memory.index.clear();
        return true;
      } catch {
        return null;
      }
    },
  };
}
