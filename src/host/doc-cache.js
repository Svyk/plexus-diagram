// A small LRU of opened pdf.js documents. The oldest is destroyed when the cap is passed and all are on clear,
// so a long session does not keep a live document per PDF it ever cropped.
// A document in use is never destroyed under its user: acquire() hands out a lease, the in-flight open is cached so
// concurrent callers of one url share one document, and an evicted or replaced document is destroyed when its last
// lease is released.
export function createDocCache({ cap = 4 } = {}) {
  const entries = new Map();
  const destroy = (doc) => { try { doc?.destroy?.(); } catch { /* already destroyed */ } };
  // Out of the map: destroyed now when nobody holds it, otherwise by its last release.
  const discard = (entry) => {
    entry.out = true;
    if (entry.users > 0) return;
    if (entry.doc) destroy(entry.doc);
    else entry.promise.then(destroy, () => {});
  };
  const trim = () => {
    while (entries.size > cap) {
      const [oldest] = entries.keys();
      const entry = entries.get(oldest);
      entries.delete(oldest);
      discard(entry);
    }
  };
  const touch = (key, entry) => {
    entries.delete(key);
    entries.set(key, entry);
  };
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined || !entry.doc) return undefined;
      touch(key, entry);
      return entry.doc;
    },
    set(key, doc) {
      const old = entries.get(key);
      if (old && old.doc === doc) { touch(key, old); return; }
      if (old) { entries.delete(key); discard(old); }
      entries.set(key, { promise: Promise.resolve(doc), doc, users: 0, out: false });
      trim();
    },
    // load() opens the document (a promise of it, or null). Returns { doc, release() }, or null when it could not open.
    async acquire(key, load) {
      let entry = entries.get(key);
      if (entry) touch(key, entry);
      else {
        entry = { promise: null, doc: null, users: 0, out: false };
        const mine = entry;
        mine.promise = (async () => load())().then((doc) => {
          mine.doc = doc || null;
          if (!doc && entries.get(key) === mine) entries.delete(key);
          return mine.doc;
        }, () => {
          if (entries.get(key) === mine) entries.delete(key);
          return null;
        });
        entries.set(key, mine);
        trim();
      }
      entry.users += 1;
      const held = entry;
      const doc = await held.promise;
      if (!doc) { held.users -= 1; return null; }
      let released = false;
      return {
        doc,
        release() {
          if (released) return;
          released = true;
          held.users -= 1;
          if (held.out && held.users === 0) destroy(held.doc);
        },
      };
    },
    clear() {
      for (const entry of entries.values()) {
        entry.out = true;
        if (entry.doc) destroy(entry.doc);
        else entry.promise.then(destroy, () => {});
      }
      entries.clear();
    },
    size: () => entries.size,
  };
}
