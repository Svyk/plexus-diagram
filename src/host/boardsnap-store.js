// INSTANT-1. Board open snapshots. Own IndexedDB database "plexus-diagram-snapshots"
// (version 1); the shared "plexus-diagram" database is never opened from here.
// Stores: "boards" (graph\0uid -> { uid, savedAt, text }), "thumbs" (key -> data URL),
// "meta" ("recent\0graph" -> [{ uid, savedAt }], newest first).
// An in-memory LRU of 20 parsed snapshots serves the mount synchronously. Install warms
// it from IndexedDB in the background. Writes wait out a 1 s debounce and an idle slot.
// No Roam call, no graph write.

import { openDb } from "./diagram-db.js";
import { packSnapshot, parseSnapshot, snapThumbKeys } from "../model/boardsnap.js";

export const SNAP_DB = "plexus-diagram-snapshots";
export const SNAP_DB_VERSION = 1;
export const SNAP_STORE_BOARDS = "boards";
export const SNAP_STORE_THUMBS = "thumbs";
export const SNAP_STORE_META = "meta";
export const SNAP_LRU = 20;
export const SNAP_KEEP = 40;
export const SNAP_DEBOUNCE_MS = 1000;
export const THUMB_CAP = 300;

const STORES = [SNAP_STORE_BOARDS, SNAP_STORE_THUMBS, SNAP_STORE_META];

function request(req) {
  return new Promise((resolve) => {
    if (!req) { resolve(null); return; }
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = (event) => {
      try { event?.preventDefault?.(); } catch { /* ignore */ }
      resolve(null);
    };
  });
}

function done(tx) {
  return new Promise((resolve) => {
    if (!tx) { resolve(false); return; }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

const boardKey = (graph, uid) => `${graph}\u0000${uid}`;
const metaKey = (graph) => `recent\u0000${graph}`;

function defaultIdle(fn) {
  const ric = globalThis.requestIdleCallback;
  if (typeof ric === "function") return ric(() => fn(), { timeout: 2000 });
  const t = setTimeout(fn, 50);
  t?.unref?.();
  return t;
}

export function createBoardSnapStore({
  indexedDB = globalThis.indexedDB,
  graph = "",
  now = Date.now,
  idle = defaultIdle,
  lruSize = SNAP_LRU,
  keep = SNAP_KEEP,
  debounceMs = SNAP_DEBOUNCE_MS,
  enabled = () => true,
} = {}) {
  const graphOf = typeof graph === "function" ? graph : () => graph;
  const lru = new Map(); // uid -> { snap, text }
  const thumbs = new Map(); // key -> data URL
  const pendingThumbs = new Set();
  const pending = new Map(); // uid -> text
  const timers = new Map();
  let recent = null; // [{ uid, savedAt }]
  let dbPromise = null;
  let disposed = false;
  let writing = Promise.resolve();
  const allow = () => {
    if (disposed) return false;
    try { return enabled() !== false; } catch { return true; }
  };

  const db = () => {
    if (!dbPromise) {
      dbPromise = openDb(indexedDB, { name: SNAP_DB, version: SNAP_DB_VERSION, stores: STORES }).catch(() => null);
    }
    return dbPromise;
  };

  const touch = (uid, entry) => {
    lru.delete(uid);
    lru.set(uid, entry);
    while (lru.size > lruSize) {
      const oldest = lru.keys().next().value;
      lru.delete(oldest);
    }
  };

  const capThumbs = () => {
    if (thumbs.size <= THUMB_CAP) return;
    const used = new Set();
    for (const { snap } of lru.values()) for (const key of snapThumbKeys(snap)) used.add(key);
    for (const key of [...thumbs.keys()]) {
      if (thumbs.size <= THUMB_CAP) break;
      if (!used.has(key)) thumbs.delete(key);
    }
  };

  async function loadThumbs(handle, keys) {
    const missing = [...keys].filter((key) => !thumbs.has(key));
    if (!missing.length || !handle) return;
    let tx;
    try { tx = handle.transaction([SNAP_STORE_THUMBS], "readonly"); } catch { return; }
    const store = tx.objectStore(SNAP_STORE_THUMBS);
    const rows = await Promise.all(missing.map((key) => request(store.get(key))));
    rows.forEach((value, i) => {
      if (typeof value === "string" && value.startsWith("data:image/")) thumbs.set(missing[i], value);
    });
    capThumbs();
  }

  async function loadBoards(handle, uids) {
    if (!handle || !uids.length) return [];
    const g = graphOf();
    let tx;
    try { tx = handle.transaction([SNAP_STORE_BOARDS], "readonly"); } catch { return []; }
    const store = tx.objectStore(SNAP_STORE_BOARDS);
    const rows = await Promise.all(uids.map((uid) => request(store.get(boardKey(g, uid)))));
    const out = [];
    rows.forEach((row, i) => {
      const snap = parseSnapshot(row?.text);
      if (snap) out.push({ uid: uids[i], snap, text: row.text });
    });
    return out;
  }

  async function readRecent(handle) {
    if (recent) return recent;
    if (!handle) return [];
    let tx;
    try { tx = handle.transaction([SNAP_STORE_META], "readonly"); } catch { return []; }
    const list = await request(tx.objectStore(SNAP_STORE_META).get(metaKey(graphOf())));
    recent = Array.isArray(list) ? list.filter((row) => row && typeof row.uid === "string").slice(0, keep * 2) : [];
    return recent;
  }

  // Newest first into the LRU (oldest touched first so the newest ends most recent).
  async function warm() {
    if (!allow()) return 0;
    const handle = await db();
    if (!handle || disposed) return 0;
    const list = await readRecent(handle);
    const uids = list.slice(0, lruSize).map((row) => row.uid).filter((uid) => !lru.has(uid));
    const loaded = await loadBoards(handle, uids);
    if (disposed) return 0;
    for (const entry of loaded.reverse()) {
      if (!lru.has(entry.uid)) {
        lru.set(entry.uid, { snap: entry.snap, text: entry.text });
        while (lru.size > lruSize) lru.delete(lru.keys().next().value);
      }
    }
    const keys = new Set();
    for (const { snap } of lru.values()) for (const key of snapThumbKeys(snap)) keys.add(key);
    await loadThumbs(handle, keys);
    return loaded.length;
  }

  // One board read into the LRU (hover prefetch, or a board past the warm set).
  async function load(uid) {
    if (!allow() || !uid) return null;
    if (lru.has(uid)) return lru.get(uid).snap;
    const handle = await db();
    if (!handle || disposed) return null;
    const [entry] = await loadBoards(handle, [uid]);
    if (!entry || disposed) return null;
    if (!lru.has(uid)) touch(uid, { snap: entry.snap, text: entry.text });
    await loadThumbs(handle, snapThumbKeys(entry.snap));
    return lru.get(uid)?.snap ?? null;
  }

  async function writeNow(uids) {
    const handle = await db();
    if (!handle) return false;
    const g = graphOf();
    const rows = [];
    for (const uid of uids) {
      if (!pending.has(uid)) continue;
      rows.push({ uid, text: pending.get(uid) });
      pending.delete(uid);
    }
    const thumbRows = [];
    for (const key of [...pendingThumbs]) {
      if (thumbs.has(key)) thumbRows.push([key, thumbs.get(key)]);
      pendingThumbs.delete(key);
    }
    if (!rows.length && !thumbRows.length) return true;
    const list = (await readRecent(handle)).slice();
    const at = now();
    for (const row of rows) {
      const index = list.findIndex((entry) => entry.uid === row.uid);
      if (index >= 0) list.splice(index, 1);
      list.unshift({ uid: row.uid, savedAt: at });
    }
    const dropped = list.splice(keep);
    recent = list;
    let tx;
    try { tx = handle.transaction(STORES, "readwrite"); } catch { return false; }
    try {
      const boards = tx.objectStore(SNAP_STORE_BOARDS);
      for (const row of rows) boards.put({ uid: row.uid, savedAt: at, text: row.text }, boardKey(g, row.uid));
      for (const row of dropped) boards.delete(boardKey(g, row.uid));
      const thumbStore = tx.objectStore(SNAP_STORE_THUMBS);
      for (const [key, value] of thumbRows) thumbStore.put(value, key);
      tx.objectStore(SNAP_STORE_META).put(list, metaKey(g));
    } catch {
      try { tx.abort(); } catch { /* already done */ }
      return false;
    }
    return done(tx);
  }

  const schedule = (uid) => {
    if (timers.has(uid)) return;
    const timer = setTimeout(() => {
      timers.delete(uid);
      if (disposed) return;
      idle(() => {
        if (disposed) return;
        writing = writing.then(() => writeNow([uid])).catch(() => false);
      });
    }, debounceMs);
    timer?.unref?.();
    timers.set(uid, timer);
  };

  const ready = allow() ? warm().catch(() => 0) : Promise.resolve(0);

  return {
    ready,
    warm,
    load,
    // Synchronous: the LRU only. A miss means "paint the old way".
    get(uid) {
      if (!allow() || !uid) return null;
      const hit = lru.get(uid);
      if (!hit) return null;
      touch(uid, hit);
      return hit.snap;
    },
    has(uid) { return lru.has(uid); },
    thumb(key) { return thumbs.get(key) ?? null; },
    thumbs: { get: (key) => thumbs.get(key) ?? null, has: (key) => thumbs.has(key) },
    putThumb(key, dataUrl) {
      if (!allow() || typeof key !== "string" || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return false;
      if (thumbs.get(key) === dataUrl) return true;
      thumbs.set(key, dataUrl);
      pendingThumbs.add(key);
      capThumbs();
      return true;
    },
    // snap is a raw snapshot object; thumbData is the key -> data URL map captured with it.
    // Returns false when the board is too large or the JSON is over the cap.
    set(uid, snap, thumbData = null) {
      if (!allow() || !uid || !snap) return false;
      const text = packSnapshot(snap);
      if (!text) return false;
      const parsed = parseSnapshot(text);
      if (!parsed) return false;
      const used = snapThumbKeys(parsed);
      if (thumbData) {
        for (const key of used) {
          const value = thumbData.get?.(key);
          if (typeof value === "string" && value.startsWith("data:image/") && thumbs.get(key) !== value) {
            thumbs.set(key, value);
            pendingThumbs.add(key);
          }
        }
      }
      const prev = lru.get(uid);
      touch(uid, { snap: parsed, text });
      capThumbs();
      if (prev?.text === text && !pendingThumbs.size) return true;
      pending.set(uid, text);
      schedule(uid);
      return true;
    },
    // Unmount and unload: skip the debounce, keep the idle-free async write.
    flush() {
      const uids = [...timers.keys()];
      for (const uid of uids) clearTimeout(timers.get(uid));
      timers.clear();
      if (!pending.size && !pendingThumbs.size) return writing;
      const all = [...new Set([...uids, ...pending.keys()])];
      writing = writing.then(() => writeNow(all)).catch(() => false);
      return writing;
    },
    forget(uid) {
      lru.delete(uid);
      pending.delete(uid);
      const timer = timers.get(uid);
      if (timer) clearTimeout(timer);
      timers.delete(uid);
    },
    size() { return lru.size; },
    // Pending writes still land, then the connection closes.
    dispose() {
      if (disposed) return writing;
      const uids = [...timers.keys()];
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      const all = [...new Set([...uids, ...pending.keys()])];
      const tail = (all.length || pendingThumbs.size) && dbPromise
        ? writing.then(() => writeNow(all)).catch(() => false)
        : writing;
      disposed = true;
      lru.clear();
      const close = () => {
        pending.clear();
        thumbs.clear();
        void dbPromise?.then((handle) => { try { handle?.close?.(); } catch { /* closed */ } });
      };
      return Promise.resolve(tail).then(close, close);
    },
  };
}
