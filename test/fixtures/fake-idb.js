// Minimal IndexedDB for the snapshot store tests: open/upgrade, out-of-line keys,
// get/put/delete, transaction oncomplete. Every open is recorded.
export function createFakeIDB() {
  const dbs = new Map();
  const opens = [];
  const later = (fn) => setTimeout(fn, 0);
  const copy = (v) => (v === undefined ? undefined : structuredClone(v));
  function makeDb(name, rec) {
    const db = {
      name,
      version: rec.version,
      closed: false,
      onversionchange: null,
      objectStoreNames: { contains: (n) => rec.stores.has(n) },
      createObjectStore(n) { rec.stores.set(n, new Map()); return {}; },
      transaction(names, _mode) {
        const list = Array.isArray(names) ? names : [names];
        let pending = 0;
        let aborted = false;
        let completed = false;
        const tx = { oncomplete: null, onerror: null, onabort: null };
        tx.abort = () => { aborted = true; later(() => tx.onabort?.()); };
        const finish = () => later(() => {
          if (aborted || completed || pending) return;
          completed = true;
          tx.oncomplete?.();
        });
        const req = (fn) => {
          const r = { result: undefined, error: null, onsuccess: null, onerror: null };
          pending += 1;
          later(() => {
            try {
              r.result = fn();
              r.onsuccess?.({ target: r });
            } catch (error) {
              r.error = error;
              r.onerror?.({ preventDefault() {} });
            }
            pending -= 1;
            if (!pending) finish();
          });
          return r;
        };
        tx.objectStore = (n) => {
          if (!list.includes(n) || !rec.stores.has(n)) throw new Error(`NotFoundError: ${n}`);
          const store = rec.stores.get(n);
          return {
            get: (k) => req(() => copy(store.get(k))),
            put: (v, k) => req(() => { store.set(k, copy(v)); return k; }),
            delete: (k) => req(() => { store.delete(k); }),
          };
        };
        finish();
        return tx;
      },
      close() { db.closed = true; },
    };
    return db;
  }
  return {
    opens,
    dbs,
    open(name, version) {
      opens.push([name, version]);
      const r = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        let rec = dbs.get(name);
        if (rec && version != null && version < rec.version) {
          r.error = { name: "VersionError" };
          r.onerror?.({ preventDefault() {} });
          return;
        }
        const upgrade = !rec || (version != null && version > rec.version);
        if (!rec) {
          rec = { version: version ?? 1, stores: new Map() };
          dbs.set(name, rec);
        }
        if (upgrade && version != null) rec.version = version;
        r.result = makeDb(name, rec);
        if (upgrade) r.onupgradeneeded?.({ target: r });
        r.onsuccess?.({ target: r });
      });
      return r;
    },
  };
}
