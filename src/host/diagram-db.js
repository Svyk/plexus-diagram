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

// Resolves the database, or null when IndexedDB is missing, times out, or errors.
export function openDiagramDb(factory, { capMs = 2000 } = {}) {
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
    timer = arm(capMs, () => done(null));
    try {
      if (!factory || typeof factory.open !== "function") { done(null); return; }
      const req = factory.open(DIAGRAM_DB, DIAGRAM_DB_VERSION);
      if (!req) { done(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) ensureStore(db, name);
      };
      req.onsuccess = () => done(req.result || null);
      req.onerror = (event) => {
        try { event?.preventDefault?.(); } catch { /* ignore */ }
        try { req.preventDefault?.(); } catch { /* ignore */ }
        done(null);
      };
      req.onblocked = () => done(null);
    } catch {
      done(null);
    }
  });
}
