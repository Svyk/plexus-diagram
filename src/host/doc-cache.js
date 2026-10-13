// A small LRU of opened pdf.js documents. The oldest is destroyed when the cap is passed and all are on clear,
// so a long session does not keep a live document per PDF it ever cropped.
export function createDocCache({ cap = 4 } = {}) {
  const docs = new Map();
  const drop = (doc) => { try { doc?.destroy?.(); } catch { /* already destroyed */ } };
  return {
    get(key) {
      const doc = docs.get(key);
      if (doc === undefined) return undefined;
      docs.delete(key);
      docs.set(key, doc);
      return doc;
    },
    set(key, doc) {
      const old = docs.get(key);
      if (old && old !== doc) drop(old);
      docs.delete(key);
      docs.set(key, doc);
      while (docs.size > cap) {
        const [oldest] = docs.keys();
        drop(docs.get(oldest));
        docs.delete(oldest);
      }
    },
    clear() {
      for (const doc of docs.values()) drop(doc);
      docs.clear();
    },
    size: () => docs.size,
  };
}
