// PDF full text, cached by hash. Pages are read in background-budget slices (one page, then the next
// quiet slice). search() only looks up the in-memory index. It never opens a PDF.

import { openDb } from "./diagram-db.js";
import { docsFromPartRows, editDistance1, rankPostingHits } from "../model/pdf-text-search.js";
import { queryTerms } from "../model/library.js";

export const PDF_TEXT_DB = "plexus-diagram-pdf-text";
export const PDF_TEXT_DB_VERSION = 1;
export const STORE_PDF_TEXT = "pages";
export const PDF_TEXT_V = 1;
const PAGE_CAP = 80;
const JOB_CAP = 40;

const wordsOf = (lower) => String(lower || "").match(/[a-z0-9]+/g) || [];

// The pause between slices has to wait out its delay. Calling the function now ignores the wait and queues the next slice immediately.
function timerLater(fn, ms) {
  const id = setTimeout(fn, ms);
  try { id?.unref?.(); } catch { /* a browser timer has no unref */ }
  return () => { try { clearTimeout(id); } catch { /* gone */ } };
}

// One connection per IndexedDB factory. The last index to stop closes it. A later save opens it again.
const sharedTextDb = new WeakMap();

function holdPdfTextDb(factory) {
  const usable = Boolean(factory) && (typeof factory === "object" || typeof factory === "function");
  if (!usable) return { hold() {}, release() {}, open: () => Promise.resolve(null) };
  let slot = sharedTextDb.get(factory);
  if (!slot) {
    slot = { refs: 0, promise: null, db: null };
    sharedTextDb.set(factory, slot);
  }
  let held = false;
  return {
    hold() {
      if (held) return;
      held = true;
      slot.refs += 1;
    },
    release() {
      if (!held) return;
      held = false;
      slot.refs -= 1;
      if (slot.refs > 0) return;
      const db = slot.db;
      slot.db = null;
      slot.promise = null;
      if (sharedTextDb.get(factory) === slot) sharedTextDb.delete(factory);
      try { db?.close(); } catch { /* gone */ }
    },
    open() {
      if (slot.promise) return slot.promise;
      const pending = openDb(factory, {
        name: PDF_TEXT_DB,
        version: PDF_TEXT_DB_VERSION,
        stores: [STORE_PDF_TEXT],
      }).then((db) => {
        if (slot.promise !== pending || !db || slot.refs <= 0) {
          slot.promise = null;
          slot.db = null;
          try { db?.close(); } catch { /* gone */ }
          return null;
        }
        slot.db = db;
        const evict = () => {
          if (slot.db !== db) return;
          slot.db = null;
          slot.promise = null;
        };
        try {
          const prev = db.onversionchange;
          db.onversionchange = (event) => {
            evict();
            if (typeof prev === "function") prev(event);
          };
          db.onclose = evict;
        } catch { /* a frozen handle */ }
        return db;
      });
      slot.promise = pending;
      return pending;
    },
  };
}

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
  later = timerLater,
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
  let generation = 0;
  let stopIdle = null;
  let cancelLater = null;
  let loaded = null;
  let loadToken = 0;
  let loadDone = false;
  let cancelPostings = null;
  let finishSlices = null;
  const share = holdPdfTextDb(factory);
  const byUrl = new Map();
  let seq = 0;

  const openDbOnce = () => {
    if (!factory) return Promise.resolve(null);
    share.hold();
    return share.open();
  };

  // Glyph boxes are not stored. A hit open reads them again from the pdf.js page.
  function addPostings(doc) {
    if (!doc?.hash || byKey.has(doc.hash)) return false;
    const pages = [];
    for (const page of Array.isArray(doc.pages) ? doc.pages : []) {
      const text = String(page?.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const lower = page.lower || text.toLowerCase();
      pages.push({ n: Number(page.n) || 0, text, lower });
    }
    const stored = {
      hash: doc.hash,
      url: doc.url || "",
      pdfUid: doc.pdfUid || "",
      title: doc.title || "",
      pages,
      empty: pages.length === 0,
    };
    byKey.set(stored.hash, stored);
    if (stored.url) byUrl.set(stored.url, stored);
    docs.push(stored);
    if (stored.empty) return false;
    for (const page of pages) {
      seq += 1;
      const pageSeq = seq;
      for (const word of new Set(wordsOf(page.lower))) {
        let list = postings.get(word);
        if (!list) postings.set(word, list = []);
        list.push({ doc: stored, n: page.n, seq: pageSeq });
        const bucket = `${word[0]}:${word.length}`;
        let set = buckets.get(bucket);
        if (!set) buckets.set(bucket, set = new Set());
        set.add(word);
      }
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
      empty: Boolean(doc.empty),
      pages: (doc.pages || []).map((page) => ({ n: page.n, text: page.text })),
      at: now(),
      v: PDF_TEXT_V,
    }, doc.hash)));
  }

  function whenLoaded() {
    if (loaded) return loaded;
    const token = loadToken;
    loaded = (async () => {
      const keys = await withStore("readonly", (store) => requestResult(store.getAllKeys()));
      const pendingDocs = [];
      if (token === loadToken && keys?.ok && Array.isArray(keys.result)) {
        for (const key of keys.result) {
          if (token !== loadToken) return false;
          const got = await withStore("readonly", (store) => requestResult(store.get(key)));
          const rec = got?.ok ? got.result : null;
          if (!rec || rec.v !== PDF_TEXT_V) continue;
          const doc = { hash: key, url: rec.url || "", pdfUid: rec.pdfUid || "", title: rec.title || "", pages: rec.pages };
          const text = (doc.pages || []).some((page) => String(page?.text || "").trim());
          if (text) pendingDocs.push(doc);
          else addPostings(doc);
        }
      }
      if (token !== loadToken) return false;
      if (!pendingDocs.length || typeof budget?.idle !== "function") {
        for (const doc of pendingDocs) addPostings(doc);
        if (token === loadToken) loadDone = true;
        return true;
      }
      await new Promise((resolve) => {
        finishSlices = resolve;
        let i = 0;
        const slice = () => {
          cancelPostings = null;
          if (token !== loadToken) { resolve(); return; }
          addPostings(pendingDocs[i]);
          i += 1;
          if (i >= pendingDocs.length) { resolve(); return; }
          const cancel = budget.idle(slice, { label: "pdf-text-postings" });
          cancelPostings = () => { try { cancel?.(); } catch { /* gone */ } };
        };
        const cancel = budget.idle(slice, { label: "pdf-text-postings" });
        cancelPostings = () => { try { cancel?.(); } catch { /* gone */ } };
      });
      finishSlices = null;
      if (token !== loadToken) return false;
      loadDone = true;
      return true;
    })();
    return loaded;
  }
  if (factory) void whenLoaded();

  function hitsFor(needle) {
    const exact = postings.get(needle) || [];
    if (exact.length || needle.length < 4) return { list: exact, fuzzy: false };
    const list = [];
    for (const len of [needle.length - 1, needle.length, needle.length + 1]) {
      const set = buckets.get(`${needle[0]}:${len}`);
      if (!set) continue;
      for (const known of set) {
        if (!editDistance1(known, needle)) continue;
        list.push(...(postings.get(known) || []));
      }
    }
    return { list, fuzzy: true };
  }

  // Pages that contain every term. Ranking stops at the limit instead of reading every page of those files.
  function pagesFor(text) {
    const terms = queryTerms(text);
    const needles = [];
    for (const term of terms) {
      if (term.includes(" ")) needles.push(...term.split(/\s+/).filter((word) => word.length >= 2));
      else needles.push(term);
    }
    if (!needles.length) return [];
    let chosen = null;
    for (const needle of needles) {
      const { list, fuzzy } = hitsFor(needle);
      if (!list.length) return [];
      const mine = new Map();
      for (const hit of list) {
        const key = `${hit.doc.hash}\n${hit.n}`;
        const prev = mine.get(key);
        if (prev) {
          if (hit.seq < prev.seq) prev.seq = hit.seq;
          continue;
        }
        mine.set(key, { doc: hit.doc, n: hit.n, seq: hit.seq, fuzzy, count: 1 });
      }
      if (!chosen) chosen = mine;
      else {
        const next = new Map();
        for (const [key, hit] of chosen) {
          const other = mine.get(key);
          if (!other) continue;
          next.set(key, { doc: hit.doc, n: hit.n, seq: Math.min(hit.seq, other.seq), fuzzy: hit.fuzzy || other.fuzzy, count: hit.count + other.count });
        }
        chosen = next;
      }
      if (!chosen.size) return [];
    }
    const out = [];
    for (const hit of chosen.values()) {
      const page = hit.doc.pages.find((item) => item.n === hit.n) || { n: hit.n, text: "", lower: "" };
      out.push({ doc: hit.doc, page, n: hit.n, seq: hit.seq, fuzzy: hit.fuzzy, count: hit.count });
    }
    return out;
  }

  function search(query, limit) {
    const text = query?.text ?? "";
    if (!String(text).trim()) return [];
    return rankPostingHits(pagesFor(text), query || {}, limit);
  }

  function noteParsed(rows) {
    let added = 0;
    for (const doc of docsFromPartRows(rows)) if (addPostings(doc)) added += 1;
    return added;
  }

  function pause(ms = 600) {
    pausedUntil = now() + ms;
  }

  function takeHandle(job) {
    const handle = job?.handle || null;
    if (job) job.handle = null;
    return handle;
  }

  function arm() {
    if (pumping || !queue.length || typeof budget?.idle !== "function") return;
    pumping = true;
    const gen = generation;
    stopIdle = budget.idle(() => {
      stopIdle = null;
      if (gen !== generation) { pumping = false; return; }
      if (pausedUntil > now()) {
        pumping = false;
        const wait = Math.max(0, pausedUntil - now());
        try { cancelLater?.(); } catch { /* gone */ }
        const cancel = later(() => { cancelLater = null; if (gen === generation) arm(); }, wait);
        cancelLater = typeof cancel === "function" ? cancel : null;
        return;
      }
      const job = queue[0];
      if (!job) { pumping = false; return; }
      void step(job, gen).then((done) => {
        if (gen !== generation) return;
        pumping = false;
        if (done) {
          if (queue[0] === job) queue.shift();
          if (job?.url) queued.delete(job.url);
        }
        arm();
      }, () => {
        if (gen !== generation) return;
        pumping = false;
        if (queue[0] === job) queue.shift();
        void dropHandle(takeHandle(job));
        if (job?.url) queued.delete(job.url);
        arm();
      });
    }, { label: "pdf-text" });
  }

  async function dropHandle(handle) {
    try { await handle?.close?.(); } catch { /* gone */ }
  }

  // `gen` is the pump that started this step. stop() moves the generation, and a step from the old one
  // closes whatever it opened and does not touch the queue the new pump is using.
  async function step(job, gen) {
    if (gen !== generation) {
      await dropHandle(takeHandle(job));
      return false;
    }
    if (!job.handle) {
      if (job.hash && byKey.has(job.hash)) return true;
      if (typeof openPdf !== "function") return true;
      let handle = null;
      try { handle = await openPdf(job.url); } catch { handle = null; }
      if (gen !== generation) {
        await dropHandle(handle);
        return false;
      }
      if (!handle || !(handle.pageCount > 0) || typeof handle.readPage !== "function") {
        await dropHandle(handle);
        return true;
      }
      const hash = job.hash || handle.hash || "";
      if (!hash || byKey.has(hash)) {
        await dropHandle(handle);
        return true;
      }
      if (gen !== generation) {
        await dropHandle(handle);
        return false;
      }
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
      if (gen !== generation) {
        await dropHandle(takeHandle(job));
        return false;
      }
      const known = byKey.has(doc.hash);
      const added = addPostings(doc);
      if (!known && byKey.has(doc.hash)) {
        try { await save(byKey.get(doc.hash)); } catch { /* cache is optional */ }
        if (added) { try { onReady?.(doc.hash); } catch { /* listener */ } }
      }
      await dropHandle(takeHandle(job));
      return true;
    }
    let page = null;
    try { page = await job.handle.readPage(job.n); } catch { page = null; }
    if (gen !== generation) {
      await dropHandle(takeHandle(job));
      return false;
    }
    if (page?.text && String(page.text).trim()) job.pages.push({ n: page.n, text: String(page.text).replace(/\s+/g, " ").trim(), lower: page.lower || String(page.text).toLowerCase() });
    return false;
  }

  function stop() {
    generation += 1;
    try { stopIdle?.(); } catch { /* gone */ }
    stopIdle = null;
    try { cancelLater?.(); } catch { /* gone */ }
    cancelLater = null;
    const pending = queue.splice(0);
    queued.clear();
    pumping = false;
    for (const job of pending) void dropHandle(takeHandle(job));
    // A load still walking the cache retries next time. Postings already built stay, so search still works.
    if (!loadDone) {
      loadToken += 1;
      loaded = null;
      try { cancelPostings?.(); } catch { /* gone */ }
      cancelPostings = null;
      try { finishSlices?.(); } catch { /* gone */ }
      finishSlices = null;
    }
    share.release();
  }

  function enqueue(jobs) {
    for (const job of Array.isArray(jobs) ? jobs : []) {
      const url = String(job?.url || "");
      if (!url || queued.has(url) || queue.length >= JOB_CAP) continue;
      if (byUrl.has(url) || (job.hash && byKey.has(job.hash))) continue;
      queued.add(url);
      queue.push({ url, hash: job.hash || "", pdfUid: job.pdfUid || "", title: job.title || "" });
    }
    arm();
  }

  return { search, noteParsed, enqueue, pause, stop, whenLoaded, docs, version: PDF_TEXT_DB_VERSION };
}
