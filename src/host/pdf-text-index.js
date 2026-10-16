// PDF full text, cached by hash. Pages are read in background-budget slices (one page, then the next
// quiet slice). search() only looks up the in-memory index. It never opens a PDF.

import { openDb } from "./diagram-db.js";
import { docsFromPartRows, editDistance1, searchPdfText } from "../model/pdf-text-search.js";
import { queryTerms } from "../model/library.js";

export const PDF_TEXT_DB = "plexus-diagram-pdf-text";
export const PDF_TEXT_DB_VERSION = 1;
export const STORE_PDF_TEXT = "pages";
export const PDF_TEXT_V = 1;
const PAGE_CAP = 80;
const JOB_CAP = 40;

const wordsOf = (lower) => String(lower || "").match(/[a-z0-9]+/g) || [];

function requestResult(req) {
  return new Promise((resolve) => {
    try {
      req.onsuccess = () => resolve({ ok: true, result: req.result });
      req.onerror = (event) => {
        try { event?.preventDefault?.(); } catch { /* ignore */ }
        resolve({ ok: false, result: null });
      };
    } catch {
      resolve({ ok: false, result: null });
    }
  });
}

export function createPdfTextIndex({
  budget = null,
  openPdf = null,
  indexedDB: factory = null,
  now = () => Date.now(),
  later = (fn) => { fn(); },
  onReady = null,
} = {}) {
  const docs = [];
  const byKey = new Map();
  const postings = new Map();
  const buckets = new Map();
  const queue = [];
  const queued = new Set();
  let pausedUntil = 0;
  let pumping = false;
  let dbPromise = null;
  let loaded = null;

  const openDbOnce = () => {
    if (!factory) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = openDb(factory, {
        name: PDF_TEXT_DB,
        version: PDF_TEXT_DB_VERSION,
        stores: [STORE_PDF_TEXT],
      }).then((db) => db || null);
    }
    return dbPromise;
  };

  function addPostings(doc) {
    if (!doc?.hash || byKey.has(doc.hash)) return false;
    const words = new Set();
    const pages = [];
    for (const page of Array.isArray(doc.pages) ? doc.pages : []) {
      const text = String(page?.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const lower = page.lower || text.toLowerCase();
      pages.push({ n: Number(page.n) || 0, text, lower, spans: Array.isArray(page.spans) ? page.spans : [] });
      for (const word of wordsOf(lower)) words.add(word);
    }
    if (!pages.length) return false;
    const stored = {
      hash: doc.hash,
      url: doc.url || "",
      pdfUid: doc.pdfUid || "",
      title: doc.title || "",
      pages,
    };
    byKey.set(stored.hash, stored);
    docs.push(stored);
    for (const word of words) {
      let list = postings.get(word);
      if (!list) postings.set(word, list = []);
      list.push(stored);
      const bucket = `${word[0]}:${word.length}`;
      let set = buckets.get(bucket);
      if (!set) buckets.set(bucket, set = new Set());
      set.add(word);
    }
    return true;
  }

  async function withStore(mode, fn) {
    try {
      const db = await openDbOnce();
      if (!db || typeof db.transaction !== "function") return { ok: false };
      const store = db.transaction(STORE_PDF_TEXT, mode).objectStore(STORE_PDF_TEXT);
      return await fn(store);
    } catch {
      return { ok: false };
    }
  }

  async function save(doc) {
    await withStore("readwrite", (store) => requestResult(store.put({
      url: doc.url,
      pdfUid: doc.pdfUid,
      title: doc.title,
      pages: doc.pages.map((page) => ({ n: page.n, text: page.text, spans: page.spans })),
      at: now(),
      v: PDF_TEXT_V,
    }, doc.hash)));
  }

  function whenLoaded() {
    if (!loaded) {
      loaded = (async () => {
        const keys = await withStore("readonly", (store) => requestResult(store.getAllKeys()));
        if (keys?.ok && Array.isArray(keys.result)) {
          for (const key of keys.result) {
            const got = await withStore("readonly", (store) => requestResult(store.get(key)));
            const rec = got?.ok ? got.result : null;
            if (rec && rec.v === PDF_TEXT_V) addPostings({ hash: key, ...rec });
          }
        }
        return true;
      })();
    }
    return loaded;
  }
  if (factory) void whenLoaded();

  function docsFor(text) {
    const terms = queryTerms(text);
    const needles = [];
    for (const term of terms) {
      if (term.includes(" ")) needles.push(...term.split(/\s+/).filter((w) => w.length >= 2));
      else needles.push(term);
    }
    if (!needles.length) return [];
    let chosen = null;
    for (const needle of needles) {
      const found = new Set(postings.get(needle) || []);
      if (!found.size && needle.length >= 4) {
        for (const len of [needle.length - 1, needle.length, needle.length + 1]) {
          const set = buckets.get(`${needle[0]}:${len}`);
          if (!set) continue;
          for (const known of set) {
            if (!editDistance1(known, needle)) continue;
            for (const doc of postings.get(known) || []) found.add(doc);
          }
        }
      }
      if (!found.size) return [];
      chosen = chosen ? new Set([...chosen].filter((doc) => found.has(doc))) : found;
      if (!chosen.size) return [];
    }
    return [...chosen];
  }

  function search(query, limit) {
    const text = query?.text ?? "";
    if (!String(text).trim()) return [];
    return searchPdfText(docsFor(text), query || {}, limit);
  }

  function noteParsed(rows) {
    let added = 0;
    for (const doc of docsFromPartRows(rows)) if (addPostings(doc)) added += 1;
    return added;
  }

  function pause(ms = 600) {
    pausedUntil = now() + ms;
  }

  function arm() {
    if (pumping || !queue.length || typeof budget?.idle !== "function") return;
    pumping = true;
    budget.idle(() => {
      if (pausedUntil > now()) {
        pumping = false;
        const wait = Math.max(0, pausedUntil - now());
        later(() => arm(), wait);
        return;
      }
      const job = queue[0];
      void step(job).then((done) => {
        pumping = false;
        if (done) {
          queue.shift();
          if (job?.url) queued.delete(job.url);
        }
        arm();
      }, () => {
        pumping = false;
        queue.shift();
        if (job?.url) queued.delete(job.url);
        arm();
      });
    }, { label: "pdf-text" });
  }

  async function step(job) {
    if (!job.handle) {
      if (job.hash && byKey.has(job.hash)) return true;
      if (typeof openPdf !== "function") return true;
      let handle = null;
      try { handle = await openPdf(job.url); } catch { handle = null; }
      if (!handle || !(handle.pageCount > 0) || typeof handle.readPage !== "function") return true;
      const hash = job.hash || handle.hash || "";
      if (!hash || byKey.has(hash)) return true;
      job.handle = handle;
      job.hash = hash;
      job.pages = [];
      job.n = 0;
      return false;
    }
    job.n += 1;
    if (job.n > Math.min(job.handle.pageCount, PAGE_CAP)) {
      const doc = {
        hash: job.hash,
        url: job.url,
        pdfUid: job.pdfUid || "",
        title: job.title || "",
        pages: job.pages,
      };
      if (addPostings(doc)) {
        try { await save(doc); } catch { /* cache is optional */ }
        try { onReady?.(doc.hash); } catch { /* listener */ }
      }
      return true;
    }
    let page = null;
    try { page = await job.handle.readPage(job.n); } catch { page = null; }
    if (page?.text) job.pages.push(page);
    return false;
  }

  function enqueue(jobs) {
    for (const job of Array.isArray(jobs) ? jobs : []) {
      const url = String(job?.url || "");
      if (!url || queued.has(url) || queue.length >= JOB_CAP) continue;
      if (job.hash && byKey.has(job.hash)) continue;
      queued.add(url);
      queue.push({ url, hash: job.hash || "", pdfUid: job.pdfUid || "", title: job.title || "" });
    }
    arm();
  }

  return { search, noteParsed, enqueue, pause, whenLoaded, docs, version: PDF_TEXT_DB_VERSION };
}
