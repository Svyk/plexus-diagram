// Shared IndexedDB open for the cover cache and the parse cache.
// Database "plexus-diagram", version 2. One onupgradeneeded keeps "covers"
// (version 1) and adds "parse", "parse-images", and "parse-index".

export const DIAGRAM_DB = "plexus-diagram";
export const DIAGRAM_DB_VERSION = 2;
export const STORE_COVERS = "covers";
export const STORE_PARSE = "parse";
export const STORE_PARSE_IMAGES = "parse-images";
export const STORE_PARSE_INDEX = "parse-index";

const STORES = [STORE_COVERS, STORE_PARSE, STORE_PARSE_IMAGES, STORE_PARSE_INDEX];

function arm(ms, fn) {
  try {
    const id = setTimeout(fn, ms);
    try { id?.unref?.(); } catch { /* a browser timer id is a number */ }
    return id;
  } catch {
    return null;
  }
}

function ensureStore(db, name) {
  try {
    if (db && !db.objectStoreNames?.contains?.(name)) db.createObjectStore(name);
  } catch { /* the request's error path reports a failed upgrade */ }
}

export const IMAGE_DB = "plexus-diagram-images";
export const IMAGE_DB_VERSION = 1;
export const STORE_IMAGE_INDEX = "image-index";

function hasStores(db, stores) {
  try {
    return stores.every((name) => db.objectStoreNames?.contains?.(name));
  } catch {
    return false;
  }
}

// A connection that closes itself when another tab or a newer Plexus wants to upgrade the database.
function arrange(db) {
  try { db.onversionchange = () => { try { db.close(); } catch { /* gone */ } }; } catch { /* ignore */ }
  return db;
}

// Resolves the database, or null when IndexedDB is missing, times out, or errors.
// A database already at a higher version (VersionError) is reopened without a version and used when it has the stores.
export function openDb(factory, { name, version, stores, capMs = 2000 }) {
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
    const attempt = (withVersion) => {
      try {
        const req = withVersion ? factory.open(name, version) : factory.open(name);
        if (!req) { done(null); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const store of stores) ensureStore(db, store);
        };
        req.onsuccess = () => {
          const db = req.result || null;
          if (!db) { done(null); return; }
          if (settled) { try { db.close(); } catch { /* ignore */ } return; }
          if (!withVersion && !hasStores(db, stores)) {
            try { db.close(); } catch { /* ignore */ }
            done(null);
            return;
          }
          done(arrange(db));
        };
        req.onerror = (event) => {
          try { event?.preventDefault?.(); } catch { /* ignore */ }
          try { req.preventDefault?.(); } catch { /* ignore */ }
          const failure = req.error;
          if (withVersion && !settled && failure && failure.name === "VersionError") { attempt(false); return; }
          done(null);
        };
        req.onblocked = () => done(null);
      } catch {
        done(null);
      }
    };
    timer = arm(capMs, () => done(null));
    if (!factory || typeof factory.open !== "function") { done(null); return; }
    attempt(true);
  });
}

// Every board view makes its own cover and parse stores. They share one connection per factory instead of
// holding a connection each for the life of the tab. A failed open is not cached, and a connection that closes
// itself (a newer Plexus upgrading) drops out so the next store opens a fresh one.
const sharedDiagramDb = new WeakMap();

export function openDiagramDb(factory, { capMs = 2000 } = {}) {
  const open = () => openDb(factory, { name: DIAGRAM_DB, version: DIAGRAM_DB_VERSION, stores: STORES, capMs });
  if (!factory || (typeof factory !== "object" && typeof factory !== "function")) return open();
  const have = sharedDiagramDb.get(factory);
  if (have) return have;
  const pending = open().then((db) => {
    if (!db) {
      if (sharedDiagramDb.get(factory) === pending) sharedDiagramDb.delete(factory);
      return db;
    }
    const evict = () => { if (sharedDiagramDb.get(factory) === pending) sharedDiagramDb.delete(factory); };
    const onVersion = db.onversionchange;
    try {
      db.onversionchange = (event) => { evict(); if (typeof onVersion === "function") onVersion(event); };
      db.onclose = evict;
    } catch { /* a frozen handle */ }
    return db;
  });
  sharedDiagramDb.set(factory, pending);
  return pending;
}

export function openImageDb(factory, { capMs = 2000 } = {}) {
  return openDb(factory, { name: IMAGE_DB, version: IMAGE_DB_VERSION, stores: [STORE_IMAGE_INDEX], capMs });
}
