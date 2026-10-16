import assert from "node:assert/strict";
import test from "node:test";

import { PDF_TEXT_DB, STORE_PDF_TEXT, createPdfTextIndex } from "../src/host/pdf-text-index.js";

function budgetOf() {
  const q = [];
  return {
    idle(fn) { q.push(fn); return () => {}; },
    flush() { const fn = q.shift(); if (fn) fn(); },
    pending: () => q.length,
  };
}

function pdfOf() {
  const opens = [];
  return {
    opens,
    async open(url) {
      opens.push(url);
      return {
        hash: "filehash",
        pageCount: 2,
        async readPage(n) {
          return {
            n,
            text: n === 1 ? "Brain age cohort" : "Methods and materials",
            lower: n === 1 ? "brain age cohort" : "methods and materials",
            spans: [{ str: n === 1 ? "Brain age" : "Methods", frac: [0.1, 0.2, 0.3, 0.04] }],
          };
        },
      };
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function drain(budget, n = 8) {
  for (let i = 0; i < n; i += 1) {
    budget.flush();
    await tick();
  }
}

test("search is an index lookup and pdf.js runs only in budget slices", async () => {
  const budget = budgetOf();
  const pdf = pdfOf();
  const index = createPdfTextIndex({ budget, openPdf: pdf.open });
  assert.deepEqual(index.search({ text: "brain" }), []);
  index.enqueue([{ url: "https://x.test/a.pdf", pdfUid: "p1", title: "Cohort" }]);
  assert.equal(pdf.opens.length, 0);
  index.search({ text: "brain" });
  assert.equal(pdf.opens.length, 0);
  await drain(budget);
  const hits = index.search({ text: "brain age" });
  assert.equal(hits[0].page, 1);
  assert.equal(hits[0].hash, "filehash");
  assert.equal(hits[0].exact, true);
  assert.equal(pdf.opens.length, 1);
  index.search({ text: "materials" });
  assert.equal(pdf.opens.length, 1);
  index.enqueue([{ url: "https://x.test/a.pdf", hash: "filehash" }]);
  await drain(budget);
  assert.equal(pdf.opens.length, 1);
});

test("parsed rows are searchable without opening the file, and typing pauses the next slice", async () => {
  let now = 0;
  const later = [];
  const budget = budgetOf();
  const pdf = pdfOf();
  const index = createPdfTextIndex({
    budget,
    openPdf: pdf.open,
    now: () => now,
    later: (fn, ms) => { later.push({ fn, at: now + ms }); },
  });
  index.noteParsed([
    { sha256: "s", url: "https://x.test/b.pdf", pdfUid: "p2", docTitle: "Report", page: 3, kind: "paragraph", text: "Brain age model" },
  ]);
  assert.equal(index.search({ text: "\"brain age\"" })[0].page, 3);
  assert.equal(pdf.opens.length, 0);
  index.enqueue([{ url: "https://x.test/c.pdf" }]);
  index.pause(600);
  budget.flush();
  await tick();
  assert.equal(pdf.opens.length, 0);
  now = 600;
  later.splice(0).forEach((job) => { if (job.at <= now) job.fn(); });
  await drain(budget);
  assert.equal(pdf.opens.length, 1);
});

function memoryIdb() {
  const databases = new Map();
  return {
    open(name) {
      const req = {};
      let db = databases.get(name);
      const fresh = !db;
      if (!db) {
        const stores = new Map();
        db = {
          objectStoreNames: { contains: (store) => stores.has(store) },
          createObjectStore(store) { stores.set(store, new Map()); },
          transaction(store) {
            const data = stores.get(store);
            return {
              objectStore() {
                return {
                  put(value, key) {
                    data.set(key, structuredClone(value));
                    const out = {};
                    queueMicrotask(() => out.onsuccess?.());
                    return out;
                  },
                  get(key) {
                    const out = {};
                    queueMicrotask(() => { out.result = data.has(key) ? structuredClone(data.get(key)) : undefined; out.onsuccess?.(); });
                    return out;
                  },
                  getAllKeys() {
                    const out = {};
                    queueMicrotask(() => { out.result = [...data.keys()]; out.onsuccess?.(); });
                    return out;
                  },
                };
              },
            };
          },
          close() {},
        };
        databases.set(name, db);
      }
      queueMicrotask(() => {
        req.result = db;
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

test("a finished read is cached by hash and the next index does not open the file", async () => {
  const idb = memoryIdb();
  const budget = budgetOf();
  const pdf = pdfOf();
  const first = createPdfTextIndex({ budget, openPdf: pdf.open, indexedDB: idb });
  first.enqueue([{ url: "https://x.test/a.pdf", title: "Cohort" }]);
  await drain(budget, 12);
  await first.whenLoaded();
  await tick();
  const secondPdf = pdfOf();
  const second = createPdfTextIndex({ budget: budgetOf(), openPdf: secondPdf.open, indexedDB: idb });
  await second.whenLoaded();
  const hits = second.search({ text: "brain" });
  assert.equal(hits[0]?.page, 1);
  assert.equal(hits[0]?.hash, "filehash");
  assert.equal(secondPdf.opens.length, 0);
  assert.equal(PDF_TEXT_DB, "plexus-diagram-pdf-text");
  assert.equal(STORE_PDF_TEXT, "pages");
});

test("a finished read closes the document, and an already cached file is closed without reading", async () => {
  const budget = budgetOf();
  let closed = 0;
  let reads = 0;
  const index = createPdfTextIndex({
    budget,
    openPdf: async () => ({
      hash: "h1",
      pageCount: 1,
      readPage: async (n) => { reads += 1; return { n, text: "brain age", lower: "brain age", spans: [] }; },
      close: async () => { closed += 1; },
    }),
  });
  index.enqueue([{ url: "https://x.test/a.pdf" }]);
  await drain(budget, 8);
  assert.equal(reads, 1);
  assert.equal(closed, 1);

  const again = budgetOf();
  let closedAgain = 0;
  let readsAgain = 0;
  const cached = createPdfTextIndex({
    budget: again,
    openPdf: async () => ({
      hash: "known",
      pageCount: 1,
      readPage: async () => { readsAgain += 1; return { n: 1, text: "nope", lower: "nope", spans: [] }; },
      close: async () => { closedAgain += 1; },
    }),
  });
  cached.noteParsed([{ kind: "paragraph", text: "brain age", sha256: "known", url: "https://x.test/old.pdf", page: 2, pdfUid: "u", docTitle: "Old" }]);
  cached.enqueue([{ url: "https://x.test/old.pdf" }]);
  await drain(again, 6);
  assert.equal(readsAgain, 0);
  assert.equal(closedAgain, 1);
});
