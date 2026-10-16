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

test("the default pause timer does not re-arm the feed in the same turn", async (t) => {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const queued = [];
  let seq = 1;
  globalThis.setTimeout = (fn, ms) => {
    const id = seq;
    seq += 1;
    queued.push({ id, fn, ms: Number(ms) || 0 });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    const i = queued.findIndex((job) => job.id === id);
    if (i >= 0) queued.splice(i, 1);
  };
  t.after(() => {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  });
  let now = 1000;
  const budget = budgetOf();
  const index = createPdfTextIndex({
    budget,
    now: () => now,
    openPdf: async () => ({ hash: "h", pageCount: 1, readPage: async () => null, close: async () => {} }),
  });
  index.enqueue([{ url: "https://x.test/wait.pdf" }]);
  index.pause(600);
  budget.flush();
  assert.equal(budget.pending(), 0, "a pause does not queue another idle slice immediately");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].ms, 600);
  index.stop();
  assert.equal(queued.length, 0, "stop cancels the pause timer");
  queued.splice(0).forEach((job) => job.fn());
  assert.equal(budget.pending(), 0);
});

function memoryIdb() {
  const databases = new Map();
  const written = [];
  let opens = 0;
  let closes = 0;
  return {
    written,
    opens: () => opens,
    closes: () => closes,
    open(name) {
      opens += 1;
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
                    const copy = structuredClone(value);
                    data.set(key, copy);
                    written.push(copy);
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
          close() { closes += 1; },
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
  const firstReady = first.whenLoaded();
  for (let i = 0; i < 8; i += 1) {
    budget.flush();
    await tick();
  }
  await firstReady;
  await tick();
  const secondPdf = pdfOf();
  const secondBudget = budgetOf();
  const second = createPdfTextIndex({ budget: secondBudget, openPdf: secondPdf.open, indexedDB: idb });
  const ready = second.whenLoaded();
  for (let i = 0; i < 12; i += 1) {
    secondBudget.flush();
    await tick();
  }
  await ready;
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
  await drain(again, 4);
  assert.equal(readsAgain, 0);
  assert.equal(closedAgain, 0);
  cached.enqueue([{ url: "https://x.test/other.pdf" }]);
  await drain(again, 6);
  assert.equal(readsAgain, 0);
  assert.equal(closedAgain, 1);
});

test("stop closes the open document after openPdf resolves and before the last page", async () => {
  const budget = budgetOf();
  let closed = 0;
  let reads = 0;
  let releaseOpen;
  const opened = new Promise((resolve) => { releaseOpen = resolve; });
  const index = createPdfTextIndex({
    budget,
    openPdf: () => new Promise((resolve) => {
      releaseOpen();
      resolve({
        hash: "h",
        pageCount: 3,
        readPage: async (n) => { reads += 1; return { n, text: "brain age", lower: "brain age", spans: [] }; },
        close: async () => { closed += 1; },
      });
    }),
  });
  index.enqueue([{ url: "https://x.test/a.pdf" }]);
  budget.flush();
  await opened;
  await tick();
  assert.equal(reads, 0);
  assert.equal(closed, 0);
  index.stop();
  await tick();
  await tick();
  assert.equal(closed, 1);
  await drain(budget, 8);
  assert.equal(reads, 0);
  assert.equal(closed, 1);
});

test("a cached page keeps the text and drops the glyph boxes", async () => {
  const idb = memoryIdb();
  const budget = budgetOf();
  const index = createPdfTextIndex({ budget, openPdf: pdfOf().open, indexedDB: idb });
  index.enqueue([{ url: "https://x.test/a.pdf", title: "Cohort" }]);
  await drain(budget, 12);
  await tick();
  const page = idb.written.at(-1)?.pages?.[0];
  assert.equal(page?.text, "Brain age cohort");
  assert.equal(page?.spans, undefined);
});

test("a PDF with no text is remembered and the next index does not open it", async () => {
  const idb = memoryIdb();
  let opens = 0;
  const openPdf = async () => {
    opens += 1;
    return {
      hash: "blank",
      pageCount: 1,
      readPage: async () => ({ n: 1, text: "   ", lower: "", spans: [{ str: "", frac: [0, 0, 1, 1] }] }),
      close: async () => {},
    };
  };
  const budget = budgetOf();
  const reading = createPdfTextIndex({ budget, openPdf, indexedDB: idb });
  reading.enqueue([{ url: "https://x.test/blank.pdf" }]);
  await drain(budget, 8);
  assert.equal(opens, 1);
  const againBudget = budgetOf();
  const again = createPdfTextIndex({ budget: againBudget, openPdf, indexedDB: idb });
  const ready = again.whenLoaded();
  for (let i = 0; i < 12; i += 1) {
    againBudget.flush();
    await tick();
  }
  await ready;
  again.enqueue([{ url: "https://x.test/blank.pdf" }]);
  await drain(againBudget, 6);
  assert.equal(opens, 1);
});

test("two indexes share one database and the last stop closes it", async () => {
  const idb = memoryIdb();
  const a = createPdfTextIndex({ budget: budgetOf(), indexedDB: idb, openPdf: async () => null });
  const b = createPdfTextIndex({ budget: budgetOf(), indexedDB: idb, openPdf: async () => null });
  await a.whenLoaded();
  await b.whenLoaded();
  await tick();
  assert.equal(idb.opens(), 1);
  a.noteParsed([{ sha256: "mem", url: "https://x.test/m.pdf", pdfUid: "p", docTitle: "M", page: 2, kind: "paragraph", text: "brain age" }]);
  a.stop();
  assert.equal(idb.closes(), 0);
  assert.equal(a.search({ text: "brain" })[0]?.page, 2);
  b.stop();
  assert.equal(idb.closes(), 1);
  assert.equal(a.search({ text: "brain" })[0]?.page, 2);
});

test("loaded postings are built one document per idle slice", async () => {
  const idb = memoryIdb();
  const budget = budgetOf();
  const openPdf = async (url) => ({
    hash: url.endsWith("b.pdf") ? "hb" : "ha",
    pageCount: 1,
    readPage: async () => ({
      n: 1,
      text: url.endsWith("b.pdf") ? "beta particle" : "alpha particle",
      lower: url.endsWith("b.pdf") ? "beta particle" : "alpha particle",
      spans: [{ str: "box", frac: [0, 0, 1, 1] }],
    }),
    close: async () => {},
  });
  const first = createPdfTextIndex({ budget, openPdf, indexedDB: idb });
  first.enqueue([{ url: "https://x.test/a.pdf" }, { url: "https://x.test/b.pdf" }]);
  await drain(budget, 16);
  const secondBudget = budgetOf();
  const second = createPdfTextIndex({ budget: secondBudget, openPdf: async () => { throw new Error("cached"); }, indexedDB: idb });
  let settled = false;
  const ready = second.whenLoaded().then(() => { settled = true; });
  for (let i = 0; i < 20 && secondBudget.pending() === 0 && !settled; i += 1) await tick();
  assert.equal(settled, false, "postings wait for an idle slice");
  secondBudget.flush();
  await tick();
  assert.equal(second.search({ text: "alpha" }).length, 1);
  assert.equal(second.search({ text: "beta" }).length, 0);
  assert.equal(settled, false);
  secondBudget.flush();
  await tick();
  await ready;
  assert.equal(second.search({ text: "beta" }).length, 1);
});

test("counts reports indexed docs, pages, and the queue", () => {
  const index = createPdfTextIndex({ budget: budgetOf(), openPdf: async () => null });
  assert.deepEqual(index.counts(), { docs: 0, pages: 0, queue: 0 });
  index.noteParsed([
    { sha256: "s", url: "https://x.test/b.pdf", pdfUid: "p2", docTitle: "Report", page: 3, kind: "paragraph", text: "Zone 3 floor drains" },
    { sha256: "s", url: "https://x.test/b.pdf", pdfUid: "p2", docTitle: "Report", page: 4, kind: "paragraph", text: "Move drains to weekly" },
  ]);
  index.enqueue([{ url: "https://x.test/c.pdf" }]);
  assert.deepEqual(index.counts(), { docs: 1, pages: 2, queue: 1 });
});

test("a missing pdf.js retries after 60s and a null open still finishes the job", async () => {
  let now = 1000;
  const later = [];
  const budget = budgetOf();
  const opens = [];
  let mode = "retry";
  const index = createPdfTextIndex({
    budget,
    now: () => now,
    later: (fn, ms) => { later.push({ fn, at: now + ms }); return () => {}; },
    openPdf: async () => {
      opens.push(mode);
      if (mode === "retry") return { retry: true };
      if (mode === "null") return null;
      return {
        hash: "cureus",
        pageCount: 1,
        readPage: async (n) => ({ n, text: "unrestricted access", lower: "unrestricted access" }),
        close: async () => {},
      };
    },
  });
  index.enqueue([{ url: "https://x.test/cureus.pdf" }]);
  budget.flush();
  await tick();
  assert.equal(opens.length, 1);
  assert.equal(index.counts().queue, 1, "no lib keeps the job");
  now = 1000 + 59999;
  later.splice(0).forEach((job) => { if (job.at <= now) job.fn(); });
  budget.flush();
  await tick();
  assert.equal(opens.length, 1, "the retry waits 60s");
  now = 1000 + 60000;
  mode = "ok";
  later.splice(0).forEach((job) => { if (job.at <= now) job.fn(); });
  await drain(budget, 8);
  assert.ok(opens.includes("ok"));
  assert.equal(index.search({ text: "unrestricted" })[0]?.page, 1);
  assert.equal(index.counts().queue, 0);
});

function mixedPage() {
  const words = [];
  for (let i = 0; i < 160; i += 1) {
    if (i === 10) words.push("mmmmmm10");
    else if (i >= 80) words.push(`zz${String(i).padStart(3, "0")}`);
    else words.push(`aa${String(i).padStart(3, "0")}`);
  }
  return words.join(" ");
}

const LONG_ROW = {
  sha256: "long", url: "https://x.test/long.pdf", pdfUid: "pl", docTitle: "Long", page: 1, kind: "paragraph", text: mixedPage(),
};

test("a long page indexes one word chunk and waits out a keystroke", async () => {
  let now = 0;
  const later = [];
  const budget = budgetOf();
  const index = createPdfTextIndex({
    budget,
    now: () => now,
    later: (fn, ms) => { later.push({ fn, at: now + ms }); return () => {}; },
    openPdf: async () => { throw new Error("no file"); },
  });
  index.noteParsed([LONG_ROW]);
  assert.equal(index.search({ text: "aa000" }).length, 1);
  assert.equal(index.search({ text: "mmmmmm10" }).length, 1);
  assert.equal(index.search({ text: "zz080" }).length, 0);
  index.pause(300);
  budget.flush();
  await tick();
  assert.equal(index.search({ text: "zz080" }).length, 0);
  now = 300;
  later.splice(0).forEach((job) => { if (job.at <= now) job.fn(); });
  budget.flush();
  await tick();
  assert.equal(index.search({ text: "zz080" }).length, 1);
});

test("a posting slice stops once the clock passes 16 ms", async () => {
  let step = 0;
  const index = createPdfTextIndex({
    budget: budgetOf(),
    now: () => { step += 1; return step * 10; },
    openPdf: async () => null,
  });
  index.noteParsed([LONG_ROW]);
  assert.equal(index.search({ text: "aa000" }).length, 1);
  assert.equal(index.search({ text: "mmmmmm10" }).length, 0);
});

test("noteParsed while paused does not index until the pause ends", async () => {
  let now = 0;
  const later = [];
  const budget = budgetOf();
  const index = createPdfTextIndex({
    budget,
    now: () => now,
    later: (fn, ms) => { later.push({ fn, at: now + ms }); return () => {}; },
    openPdf: async () => null,
  });
  index.pause(300);
  index.noteParsed([LONG_ROW]);
  budget.flush();
  await tick();
  assert.equal(index.search({ text: "aa000" }).length, 0);
  now = 300;
  later.splice(0).forEach((job) => { if (job.at <= now) job.fn(); });
  budget.flush();
  await tick();
  assert.equal(index.search({ text: "aa000" }).length, 1);
});

test("a null open still finishes the job", async () => {
  const budget = budgetOf();
  let opens = 0;
  const index = createPdfTextIndex({
    budget,
    now: () => 0,
    later: () => () => {},
    openPdf: async () => { opens += 1; return null; },
  });
  index.enqueue([{ url: "https://x.test/bad.pdf" }]);
  await drain(budget, 6);
  assert.equal(opens, 1);
  assert.equal(index.counts().queue, 0);
});
