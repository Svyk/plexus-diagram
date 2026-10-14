// P9. Stored board models for the trusted open. A big board's tree (the BOARD_PATTERN shape a consistent read gave)
// is kept with the page stamp (:page/edit-time|:page/edit-nonce) read in the same task. A cold open whose page stamp
// is still that stamp mounts from it with no board read; a background read then verifies it.
// Same database as the open snapshots ("plexus-diagram-snapshots", version 1, no new store, so no upgrade that an
// older Plexus's open connection could block): the trees go into the "boards" store under "model\0graph\0uid", and
// the list (newest first) into "meta" under "models\0graph". The shared "plexus-diagram" database is never opened.
// A tree is stored as preorder rows in JSON parts, so a load is a cheap structured clone of strings and the decode
// runs in parts (one structured clone of a 28k-block object tree is one long task).

import { openDb } from "./diagram-db.js";
import { SNAP_DB, SNAP_DB_VERSION, SNAP_STORE_BOARDS, SNAP_STORE_META, SNAP_STORE_THUMBS } from "./boardsnap-store.js";

export const MODEL_VERSION = 1;
export const MODEL_PART_ROWS = 1500;
// At most this many boards, and this many characters of parts over all of them (oldest dropped first).
export const MODEL_KEEP = 6;
export const MODEL_BUDGET = 40_000_000;

const UID = ":block/uid";
const KIDS = ":block/children";
const FIELDS = [":block/string", ":block/order", ":block/heading", ":block/open", ":block/props"];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const perfNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

// Row: [mask, childCount, uid, ...the FIELDS present in mask order]. A key the node does not have stays absent.
export function createTreeEncoder(tree, { partRows = MODEL_PART_ROWS } = {}) {
  const stack = tree?.[UID] ? [tree] : [];
  const parts = [];
  let rows = [];
  let n = 0;
  let size = 0;
  let failed = !stack.length;
  const flush = () => {
    if (!rows.length) return;
    const text = JSON.stringify(rows);
    parts.push(text);
    size += text.length;
    rows = [];
  };
  return {
    step(ms = Infinity, clock = perfNow) {
      if (failed) return true;
      const t0 = clock();
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node[UID] !== "string") { failed = true; return true; }
        const kids = Array.isArray(node[KIDS]) && node[KIDS].length ? node[KIDS] : null;
        const row = [0, kids ? kids.length : 0, node[UID]];
        let mask = 0;
        for (let i = 0; i < FIELDS.length; i += 1) {
          if (own(node, FIELDS[i])) { mask |= 1 << i; row.push(node[FIELDS[i]]); }
        }
        row[0] = mask;
        rows.push(row);
        n += 1;
        if (kids) for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
        if (rows.length >= partRows) {
          flush();
          if (stack.length && clock() - t0 >= ms) return false;
        }
      }
      flush();
      return true;
    },
    result() { return failed || stack.length ? null : { v: MODEL_VERSION, n, size, parts }; },
  };
}

export function encodeTree(tree, opts) {
  const enc = createTreeEncoder(tree, opts);
  enc.step();
  return enc.result();
}

// The tree back from its parts, one or more parts per step. result() is null unless every row landed where its
// parent's count says.
export function createTreeDecoder(model) {
  const parts = Array.isArray(model?.parts) ? model.parts : null;
  let failed = !parts || model.v !== MODEL_VERSION || !(model.n > 0);
  let pi = 0;
  let root = null;
  let count = 0;
  const stack = [];
  const add = (row) => {
    if (!Array.isArray(row) || typeof row[2] !== "string") return false;
    const node = { [UID]: row[2] };
    let at = 3;
    for (let i = 0; i < FIELDS.length; i += 1) if (row[0] & (1 << i)) node[FIELDS[i]] = row[at++];
    if (stack.length) {
      const top = stack[stack.length - 1];
      top.node[KIDS].push(node);
      top.left -= 1;
      while (stack.length && stack[stack.length - 1].left === 0) stack.pop();
    } else if (root) return false;
    else root = node;
    count += 1;
    if (row[1] > 0) {
      node[KIDS] = [];
      stack.push({ node, left: row[1] });
    }
    return true;
  };
  return {
    step(ms = Infinity, clock = perfNow) {
      if (failed) return true;
      const t0 = clock();
      while (pi < parts.length) {
        let rows = null;
        try { rows = JSON.parse(parts[pi]); } catch { rows = null; }
        pi += 1;
        if (!Array.isArray(rows)) { failed = true; return true; }
        for (const row of rows) if (!add(row)) { failed = true; return true; }
        if (pi < parts.length && clock() - t0 >= ms) return false;
      }
      if (count !== model.n || stack.length) failed = true;
      return true;
    },
    result() { return failed || pi < (parts?.length ?? 0) ? null : root; },
  };
}

export function decodeTree(model) {
  const dec = createTreeDecoder(model);
  dec.step();
  return dec.result();
}

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

export function createModelStore({ indexedDB = globalThis.indexedDB, graph = "", now = Date.now, enabled = () => true, keep = MODEL_KEEP, budget = MODEL_BUDGET } = {}) {
  const graphOf = typeof graph === "function" ? graph : () => graph;
  const modelKey = (uid) => `model\u0000${graphOf()}\u0000${uid}`;
  const metaKey = () => `models\u0000${graphOf()}`;
  let dbPromise = null;
  let list = null; // [{ uid, stamp, savedAt, size }], newest first
  let disposed = false;
  let writing = Promise.resolve();
  const allow = () => {
    if (disposed) return false;
    try { return enabled() !== false; } catch { return true; }
  };
  const db = () => {
    dbPromise ??= openDb(indexedDB, { name: SNAP_DB, version: SNAP_DB_VERSION, stores: [SNAP_STORE_BOARDS, SNAP_STORE_THUMBS, SNAP_STORE_META] }).catch(() => null);
    return dbPromise;
  };
  const readList = async () => {
    if (list) return list;
    const handle = await db();
    if (!handle) return [];
    let tx;
    try { tx = handle.transaction([SNAP_STORE_META], "readonly"); } catch { return []; }
    const got = await request(tx.objectStore(SNAP_STORE_META).get(metaKey()));
    list ??= Array.isArray(got) ? got.filter((row) => row && typeof row.uid === "string" && typeof row.stamp === "string") : [];
    return list;
  };
  const ready = allow() ? readList().catch(() => []) : Promise.resolve([]);

  return {
    ready,
    // Synchronous: the stamp the stored model was read at, or null (none, or the list is not loaded yet).
    stampOf(uid) {
      if (!allow() || !list) return null;
      return list.find((row) => row.uid === uid)?.stamp ?? null;
    },
    // { v, n, size, parts, stamp } or null. A model whose stamp is not the listed one is not returned.
    async load(uid) {
      if (!allow() || !uid) return null;
      const handle = await db();
      if (!handle || disposed) return null;
      const want = (await readList()).find((row) => row.uid === uid);
      if (!want) return null;
      let tx;
      try { tx = handle.transaction([SNAP_STORE_BOARDS], "readonly"); } catch { return null; }
      const got = await request(tx.objectStore(SNAP_STORE_BOARDS).get(modelKey(uid)));
      if (!got || got.v !== MODEL_VERSION || got.stamp !== want.stamp || !Array.isArray(got.parts)) return null;
      return got;
    },
    // model: an encoder result. Kept within `keep` boards and `budget` characters; a model over the budget alone is
    // not stored (and drops an older one of the same board).
    put(uid, stamp, model) {
      if (!allow() || !uid || typeof stamp !== "string" || !model?.parts) return Promise.resolve(false);
      // A write queued before dispose still lands.
      const job = async () => {
        const handle = await db();
        if (!handle) return false;
        const rows = (await readList()).filter((row) => row.uid !== uid);
        const fits = model.size <= budget;
        if (fits) rows.unshift({ uid, stamp, savedAt: now(), size: model.size });
        const dropped = [];
        let total = 0;
        const keepRows = [];
        for (const row of rows) {
          if (keepRows.length < keep && total + (row.size || 0) <= budget) {
            keepRows.push(row);
            total += row.size || 0;
          } else dropped.push(row);
        }
        let tx;
        try { tx = handle.transaction([SNAP_STORE_BOARDS, SNAP_STORE_META], "readwrite"); } catch { return false; }
        try {
          const boards = tx.objectStore(SNAP_STORE_BOARDS);
          if (fits) boards.put({ v: MODEL_VERSION, uid, stamp, n: model.n, size: model.size, parts: model.parts }, modelKey(uid));
          else boards.delete(modelKey(uid));
          for (const row of dropped) boards.delete(modelKey(row.uid));
          tx.objectStore(SNAP_STORE_META).put(keepRows, metaKey());
        } catch {
          try { tx.abort(); } catch { /* done */ }
          return false;
        }
        list = keepRows;
        return (await done(tx)) && fits;
      };
      writing = writing.then(job, job).catch(() => false);
      return writing;
    },
    forget(uid) {
      if (!list?.some((row) => row.uid === uid)) return Promise.resolve(true);
      const job = async () => {
        const handle = await db();
        if (!handle) return false;
        const rows = (await readList()).filter((row) => row.uid !== uid);
        let tx;
        try { tx = handle.transaction([SNAP_STORE_BOARDS, SNAP_STORE_META], "readwrite"); } catch { return false; }
        try {
          tx.objectStore(SNAP_STORE_BOARDS).delete(modelKey(uid));
          tx.objectStore(SNAP_STORE_META).put(rows, metaKey());
        } catch { return false; }
        list = rows;
        return done(tx);
      };
      writing = writing.then(job, job).catch(() => false);
      return writing;
    },
    list: () => (list ? list.map((row) => ({ ...row })) : []),
    dispose() {
      if (disposed) return writing;
      const tail = writing;
      disposed = true;
      const close = () => { void dbPromise?.then((handle) => { try { handle?.close?.(); } catch { /* closed */ } }); };
      return Promise.resolve(tail).then(close, close);
    },
  };
}
