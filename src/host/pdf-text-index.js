// PDF full text, cached by hash. Pages are read in background-budget slices (one page, then the next
// quiet slice). search() only looks up the in-memory index. It never opens a PDF.

import { openDb } from "./diagram-db.js";
import { editDistance1, rankPostingHits } from "../model/pdf-text-search.js";
import { queryTerms } from "../model/library.js";

export const PDF_TEXT_DB = "plexus-diagram-pdf-text";
export const PDF_TEXT_DB_VERSION = 1;
export const STORE_PDF_TEXT = "pages";
export const PDF_TEXT_V = 1;
const PAGE_CAP = 80;
const JOB_CAP = 40;
// Same wait pdf-names uses when Roam has not loaded a pdf.js lib yet.
export const PDF_TEXT_NO_LIB_MS = 60000;
export const PDF_TEXT_SLICE_MS = 16;
const WORD_CHUNK = 80;
const ROW_CHUNK = 24;
const ITEM_CHUNK = 120;

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
  const postingQueue = [];
  const postingLive = new Set();
  let postingPumping = false;
  let postingLater = null;
  let pendingRows = null;
  let rowSource = null;
  let rowCursor = 0;
  let rowFoldDone = true;
  let rowStamp = "";
  let foldDocs = new Map();

  const openDbOnce = () => {
    if (!factory) return Promise.resolve(null);
    share.hold();
    return share.open();
  };

  function paused() {
    return pausedUntil > now();
  }

  function rowsStamp(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let h = list.length;
    for (let i = 0; i < list.length; i += 17) {
      const row = list[i] || {};
      h = Math.imul(h, 33) + String(row.text || "").length + (Number(row.page) || 0) + String(row.sha256 || row.url || "").length;
    }
    return String(h);
  }

  function pageList(doc) {
    const pages = [];
    for (const page of Array.isArray(doc?.pages) ? doc.pages : []) {
      const text = String(page?.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      pages.push({ n: Number(page.n) || 0, text, lower: page.lower || text.toLowerCase() });
    }
    return pages;
  }

  // Pages land before their words. A later fold only queues pages this doc did not have yet.
  function rememberDoc(doc) {
    if (!doc?.hash) return false;
    const pages = pageList(doc);
    let stored = byKey.get(doc.hash);
    if (!pages.length) {
      if (stored) return false;
      stored = { hash: doc.hash, url: doc.url || "", pdfUid: doc.pdfUid || "", title: doc.title || "", pages: [], empty: true };
      byKey.set(stored.hash, stored);
      if (stored.url) byUrl.set(stored.url, stored);
      docs.push(stored);
      return false;
    }
    if (!stored) {
      stored = { hash: doc.hash, url: doc.url || "", pdfUid: doc.pdfUid || "", title: doc.title || "", pages: [], empty: false };
      byKey.set(stored.hash, stored);
      if (stored.url) byUrl.set(stored.url, stored);
      docs.push(stored);
    }
    const have = new Set(stored.pages.map((page) => page.n));
    const start = stored.pages.length;
    for (const page of pages) {
      if (have.has(page.n)) continue;
      have.add(page.n);
      stored.pages.push(page);
    }
    if (stored.pages.length) stored.empty = false;
    if (stored.pages.length === start) return false;
    if (postingLive.has(stored.hash)) return true;
    postingLive.add(stored.hash);
    postingQueue.push({ hash: stored.hash, pageI: start, wordI: 0, words: null, pageSeq: 0 });
    return true;
  }

  function postWord(stored, page, word, pageSeq) {
    if (!word) return;
    let list = postings.get(word);
    if (!list) postings.set(word, list = []);
    list.push({ doc: stored, n: page.n, seq: pageSeq });
    const bucket = `${word[0]}:${word.length}`;
    let set = buckets.get(bucket);
    if (!set) buckets.set(bucket, set = new Set());
    set.add(word);
  }

  function finishJob(job, notify) {
    postingLive.delete(job.hash);
    const at = postingQueue.indexOf(job);
    if (at >= 0) postingQueue.splice(at, 1);
    if (notify) { try { onReady?.(job.hash); } catch { /* listener */ } }
  }

  function forgetDoc(hash) {
    const stored = byKey.get(hash);
    if (!stored) return;
    byKey.delete(hash);
    if (stored.url && byUrl.get(stored.url) === stored) byUrl.delete(stored.url);
    const at = docs.indexOf(stored);
    if (at >= 0) docs.splice(at, 1);
    for (const [word, list] of postings) {
      const next = list.filter((hit) => hit.doc !== stored);
      if (next.length) postings.set(word, next);
      else {
        postings.delete(word);
        const bucket = `${word[0]}:${word.length}`;
        const set = buckets.get(bucket);
        if (set) { set.delete(word); if (!set.size) buckets.delete(bucket); }
      }
    }
  }

  function foldOneRow(row) {
    if (!row || row.kind === "figure") return;
    const text = String(row.text || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const hash = String(row.sha256 || row.url || "");
    if (!hash) return;
    let doc = foldDocs.get(hash);
    if (!doc) {
      doc = { hash, url: row.url || "", pdfUid: row.pdfUid || "", title: row.docTitle || "", pages: new Map() };
      foldDocs.set(hash, doc);
    }
    const n = Number(row.page) || 0;
    const page = doc.pages.get(n) || { n, bits: [] };
    page.bits.push(text);
    doc.pages.set(n, page);
  }

  function beginRows(list) {
    const stamp = rowsStamp(list);
    if (stamp === rowStamp && (rowFoldDone || rowSource)) return;
    rowStamp = stamp;
    rowSource = Array.isArray(list) ? list : [];
    rowCursor = 0;
    rowFoldDone = rowSource.length === 0;
    foldDocs = new Map();
  }

  // One row chunk, then one word chunk. A frozen clock still stops at the chunk size.
  // Finishing a document stops the slice so the next document waits for the next slice.
  function runOneChunk({ notify }) {
    const started = now();
    let done = 0;
    if (!rowFoldDone && rowSource) {
      while (done < ROW_CHUNK && rowCursor < rowSource.length) {
        if (done > 0 && now() - started >= PDF_TEXT_SLICE_MS) break;
        foldOneRow(rowSource[rowCursor]);
        rowCursor += 1;
        done += 1;
      }
      if (rowCursor >= rowSource.length) {
        rowFoldDone = true;
        for (const doc of foldDocs.values()) {
          const pages = [...doc.pages.values()].map((page) => {
            const text = page.bits.join(" ").replace(/\s+/g, " ").trim();
            return { n: page.n, text, lower: text.toLowerCase() };
          });
          rememberDoc({ hash: doc.hash, url: doc.url, pdfUid: doc.pdfUid, title: doc.title, pages });
        }
        foldDocs = new Map();
      }
    }
    if (done > 0 && now() - started >= PDF_TEXT_SLICE_MS) return;
    let wordsDone = 0;
    let hops = 0;
    while (wordsDone < WORD_CHUNK && hops < WORD_CHUNK && postingQueue.length) {
      if (wordsDone > 0 && now() - started >= PDF_TEXT_SLICE_MS) break;
      const job = postingQueue[0];
      const stored = byKey.get(job.hash);
      if (!stored) { finishJob(job, false); continue; }
      if (job.pageI >= stored.pages.length) { finishJob(job, notify); break; }
      const page = stored.pages[job.pageI];
      if (job.words == null || job.wordPage !== job.pageI) {
        job.words = [...new Set(wordsOf(page.lower || page.text || ""))];
        job.wordI = 0;
        job.wordPage = job.pageI;
        seq += 1;
        job.pageSeq = seq;
      }
      if (job.wordI >= job.words.length) {
        job.pageI += 1;
        job.words = null;
        hops += 1;
        if (job.pageI >= stored.pages.length) { finishJob(job, notify); break; }
        continue;
      }
      postWord(stored, page, job.words[job.wordI], job.pageSeq);
      job.wordI += 1;
      wordsDone += 1;
      hops += 1;
    }
  }

  function scheduleAfterPause() {
    if (postingLater) return;
    const gen = generation;
    const wait = Math.max(0, pausedUntil - now());
    let cancel = null;
    try {
      cancel = later(() => {
        postingLater = null;
        if (gen !== generation) return;
        if (pausedUntil > now()) { scheduleAfterPause(); return; }
        armPostings();
      }, wait);
    } catch { cancel = null; }
    postingLater = typeof cancel === "function" ? cancel : (() => {});
  }

  function postingWork() {
    return postingQueue.length > 0 || !rowFoldDone || pendingRows != null;
  }

  function armPostings() {
    if (postingPumping || typeof budget?.idle !== "function") return;
    if (!postingWork()) {
      if (finishSlices) {
        const done = finishSlices;
        finishSlices = null;
        try { done(); } catch { /* settled */ }
      }
      return;
    }
    if (paused()) { scheduleAfterPause(); return; }
    postingPumping = true;
    const gen = generation;
    const cancel = budget.idle(() => {
      cancelPostings = null;
      postingPumping = false;
      if (gen !== generation) return;
      if (paused()) { scheduleAfterPause(); return; }
      if (pendingRows) {
        const rows = pendingRows;
        pendingRows = null;
        beginRows(rows);
      }
      runOneChunk({ notify: true });
      if (gen !== generation) return;
      armPostings();
    }, { label: "pdf-text-postings" });
    cancelPostings = typeof cancel === "function" ? cancel : null;
  }

  function chewItems(job) {
    const started = now();
    const items = job.items || [];
    let done = 0;
    while ((job.itemI || 0) < items.length && done < ITEM_CHUNK) {
      if (done > 0 && now() - started >= PDF_TEXT_SLICE_MS) break;
      const item = items[job.itemI];
      job.itemI += 1;
      done += 1;
      if (item?.str) job.bits.push(String(item.str));
    }
    if (job.itemI < items.length) return;
    const text = (job.bits || []).join(" ").replace(/\s+/g, " ").trim();
    if (text) job.pages.push({ n: job.pageN || job.n, text, lower: text.toLowerCase() });
    job.items = null;
    job.bits = null;
    job.itemI = 0;
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
          else rememberDoc(doc);
        }
      }
      if (token !== loadToken) return false;
      for (const doc of pendingDocs) rememberDoc(doc);
      if (token !== loadToken) return false;
      if (!postingQueue.length || typeof budget?.idle !== "function") {
        let guard = 0;
        while (postingQueue.length && guard < 100000) {
          runOneChunk({ notify: false });
          guard += 1;
        }
        if (token === loadToken) loadDone = true;
        return true;
      }
      await new Promise((resolve) => {
        finishSlices = resolve;
        armPostings();
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
    const list = Array.isArray(rows) ? rows : [];
    if (paused()) {
      pendingRows = list;
      scheduleAfterPause();
      return 0;
    }
    const stamp = rowsStamp(list);
    if (stamp === rowStamp && rowFoldDone) return 0;
    beginRows(list);
    runOneChunk({ notify: false });
    if (postingQueue.length || !rowFoldDone) armPostings();
    return 1;
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
      // No lib yet (or getDocument failed before a worker exists). Keep the job and try again.
      if (handle?.retry === true && typeof handle.readPage !== "function") {
        pausedUntil = now() + PDF_TEXT_NO_LIB_MS;
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
    if (job.items) {
      chewItems(job);
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
      rememberDoc(doc);
      if (!known && byKey.has(doc.hash)) {
        try { await save(byKey.get(doc.hash)); } catch { /* cache is optional */ }
      }
      armPostings();
      await dropHandle(takeHandle(job));
      return true;
    }
    if (typeof job.handle.readItems === "function") {
      let raw = null;
      try { raw = await job.handle.readItems(job.n); } catch { raw = null; }
      if (gen !== generation) {
        await dropHandle(takeHandle(job));
        return false;
      }
      job.items = Array.isArray(raw?.items) ? raw.items : [];
      job.itemI = 0;
      job.bits = [];
      job.pageN = Number(raw?.n) || job.n;
      return false;
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
    try { cancelPostings?.(); } catch { /* gone */ }
    cancelPostings = null;
    postingPumping = false;
    try { postingLater?.(); } catch { /* gone */ }
    postingLater = null;
    for (const job of postingQueue) forgetDoc(job.hash);
    postingQueue.splice(0);
    postingLive.clear();
    pendingRows = null;
    rowSource = null;
    rowCursor = 0;
    rowFoldDone = true;
    foldDocs = new Map();
    rowStamp = "";
    const pending = queue.splice(0);
    queued.clear();
    pumping = false;
    for (const job of pending) void dropHandle(takeHandle(job));
    // A load still walking the cache retries next time. Postings already built stay, so search still works.
    if (!loadDone) {
      loadToken += 1;
      loaded = null;
      try { finishSlices?.(); } catch { /* gone */ }
      finishSlices = null;
    }
    share.release();
  }

  function counts() {
    let pages = 0;
    for (const doc of docs) pages += Array.isArray(doc.pages) ? doc.pages.length : 0;
    return { docs: docs.length, pages, queue: queue.length };
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

  return { search, noteParsed, enqueue, pause, paused, stop, whenLoaded, counts, docs, version: PDF_TEXT_DB_VERSION };
}
