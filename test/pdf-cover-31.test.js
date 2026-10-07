// PDF-U1 cover plan and cache. Live: a fit page canvas is 512×688, a 320px
// JPEG is the cover, and IndexedDB may be missing. No graph write.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCoverStore, COVER_DB, COVER_DB_VERSION, COVER_LS_CAP, COVER_LS_KEY, COVER_STORE } from "../src/host/cover-store.js";
import {
  COVER_MAX_W,
  SHARP_CAP,
  WARM_AFTER_MS,
  WARM_MAX,
  coverKey,
  coverState,
  coverValid,
  densityTicks,
  scaleBox,
  sharpBox,
  sharpCoverPlan,
  warmPlan,
} from "../src/model/pdf-cover.js";

const PDF_URL = "https://example.test/papers/Risk%20model.pdf.enc?alt=media&token=abc";

function blob(bytes = [1, 2, 3, 255]) {
  return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
}

async function bytesOf(value) {
  return [...new Uint8Array(await value.arrayBuffer())];
}

function memoryStorage() {
  const map = new Map();
  return {
    map,
    writes: 0,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { this.writes += 1; map.set(key, String(value)); },
    removeItem(key) { this.writes += 1; map.delete(key); },
  };
}

function card(uid, extra) {
  return { uid, blockUid: `b-${uid}`, kind: "pdf", ...extra };
}

function plan(over) {
  return warmPlan({
    cards: [card("a"), card("b")],
    visible: ["a", "b"],
    hasLive: false,
    hasPane: false,
    sinceOpenMs: WARM_AFTER_MS,
    done: 0,
    inFlight: false,
    saveData: false,
    ...over,
  });
}

test("constants match the cover budget", () => {
  assert.equal(WARM_AFTER_MS, 1500);
  assert.equal(WARM_MAX, 3);
  assert.equal(COVER_MAX_W, 320);
  assert.equal(COVER_DB, "plexus-diagram");
  assert.equal(COVER_STORE, "covers");
  assert.equal(COVER_DB_VERSION, 2);
  assert.equal(COVER_LS_KEY, "plexus-diagram:covers");
  assert.equal(COVER_LS_CAP, 8);
});

test("warmPlan returns one on-screen pdf, and each gate refuses", () => {
  assert.deepEqual(plan(), { uid: "a", blockUid: "b-a" });
  assert.equal(plan({ sinceOpenMs: 1499 }), null, "before 1500ms");
  assert.equal(plan({ sinceOpenMs: 1000 }), null, "no warm at 1000ms, board open stays clear");
  assert.equal(plan({ sinceOpenMs: 360 }), null, "open window");
  assert.equal(plan({ sinceOpenMs: 0 }), null, "at open");
  assert.equal(plan({ hasLive: true }), null, "live embed");
  assert.equal(plan({ hasPane: true }), null, "open pane");
  assert.equal(plan({ saveData: true }), null, "save-data");
  assert.equal(plan({ inFlight: true }), null, "one at a time");
  assert.equal(plan({ done: 3 }), null, "budget spent");
  assert.deepEqual(plan({ done: 2 }), { uid: "a", blockUid: "b-a" }, "one slot left");
  assert.equal(plan({ moving: true }), null, "pan or zoom");
  assert.equal(plan({ done: -1 }), null);
  assert.equal(plan({ sinceOpenMs: undefined, done: 0 }), null);
  assert.equal(warmPlan({}), null);

  assert.deepEqual(plan({
    cards: [card("a", { hasCover: true }), card("b")],
  }), { uid: "b", blockUid: "b-b" }, "a cover already stored");
  assert.deepEqual(plan({ visible: ["b"] }), { uid: "b", blockUid: "b-b" }, "off screen");
  assert.deepEqual(plan({ visible: new Set(["b"]) }), { uid: "b", blockUid: "b-b" });
  assert.equal(plan({
    cards: [card("a", { kind: "highlight" }), { uid: "b", kind: "pdf" }],
  }), null, "pdf only, and a block uid is required");
  assert.deepEqual(plan({
    cards: [{ uid: "a", kind: "note" }, card("c")],
    visible: (uid) => uid === "c",
  }), { uid: "c", blockUid: "b-c" });
});

test("coverKey is the trimmed pdf url, including an .enc query", () => {
  assert.equal(coverKey(`  ${PDF_URL}  `), PDF_URL);
  assert.equal(coverKey(PDF_URL), PDF_URL);
  assert.equal(coverKey(""), "");
  assert.equal(coverKey("   "), "");
  assert.equal(coverKey(null), "");
  assert.equal(coverKey(9), "");
  assert.equal(coverKey("{{[[pdf]]: https://example.test/a.pdf}}"), "{{[[pdf]]: https://example.test/a.pdf}}");
});

test("coverValid rejects a hash mismatch and a record with no image", () => {
  const first = blob();
  const record = { url: PDF_URL, hash: "aaa", first };
  assert.equal(coverValid(record, "aaa"), true);
  assert.equal(coverValid(record, "  aaa  "), true);
  assert.equal(coverValid(record, "bbb"), false);
  assert.equal(coverValid(record, ""), true, "hash not known yet");
  assert.equal(coverValid({ url: PDF_URL, first }, "bbb"), true, "old record without a hash");
  assert.equal(coverValid({ url: PDF_URL, last: first, hash: "aaa" }, "aaa"), true);
  assert.equal(coverValid({ url: PDF_URL, hash: "aaa" }, "aaa"), false);
  assert.equal(coverValid({ url: PDF_URL, first: new Blob([]) }, "aaa"), false);
  assert.equal(coverValid(null, "aaa"), false);
  assert.equal(coverValid(undefined, ""), false);
});

test("sharpBox scales a PDF-point page up to the card and never past 1600", () => {
  assert.deepEqual(sharpBox(595, 791, 1600), { w: 1600, h: 2127 });
  assert.deepEqual(sharpBox(2000, 1000, 2400), { w: 1600, h: 800 });
  assert.equal(sharpBox(0, 791, 1600), null);
});

test("scaleBox fits the measured 512×688 page into 320px and does not scale up", () => {
  assert.deepEqual(scaleBox(512, 688), { w: 320, h: 430 });
  assert.deepEqual(scaleBox(400, 600), { w: 320, h: 480 });
  assert.deepEqual(scaleBox(200, 300), { w: 200, h: 300 });
  assert.deepEqual(scaleBox(320, 430), { w: 320, h: 430 });
  assert.deepEqual(scaleBox(640, 480, 160), { w: 160, h: 120 });
  assert.equal(scaleBox(0, 688), null);
  assert.equal(scaleBox(512, 0), null);
  assert.equal(scaleBox(-1, 10), null);
  assert.equal(scaleBox(Number.NaN, 10), null);
  assert.deepEqual(scaleBox(640, 480, 0), scaleBox(640, 480));
});

test("sharpCoverPlan renders a wider page only when the card outgrows the stored cover", () => {
  assert.equal(SHARP_CAP, 1600);
  assert.equal(sharpCoverPlan({}), null);
  assert.equal(sharpCoverPlan({ cardW: 200, zoom: 1, dpr: 1, coverW: 320 }), null);
  assert.equal(sharpCoverPlan({ cardW: 321, zoom: 1, dpr: 1, coverW: 320 }), null);
  assert.deepEqual(sharpCoverPlan({ cardW: 322, zoom: 1, dpr: 1, coverW: 320 }), { maxW: 322 });
  assert.deepEqual(sharpCoverPlan({ cardW: 400, zoom: 2, dpr: 2, coverW: 320 }), { maxW: 1600 });
  assert.deepEqual(sharpCoverPlan({ cardW: 2000, zoom: 2, dpr: 2, coverW: 320 }), { maxW: 1600 });
  assert.equal(sharpCoverPlan({ zoom: 2, dpr: 2, coverW: 100 }), null);
});

test("densityTicks places one tick per highlight at (page - 1) / pageCount", () => {
  const rows = [
    { page: 1, color: "yellow" },
    { page: 1, color: "blue" },
    { page: 2, color: "green" },
    { highlight: { page: 3, color: "pink" } },
    { page: 4, color: "red" },
    { page: 0, color: "red" },
    null,
  ];
  assert.deepEqual(densityTicks(rows, 3), [
    { y01: 0, color: "yellow" },
    { y01: 0, color: "blue" },
    { y01: 1 / 3, color: "green" },
    { y01: 2 / 3, color: "pink" },
  ]);
  assert.deepEqual(densityTicks([{ page: 9, color: "yellow" }], 9), [{ y01: 8 / 9, color: "yellow" }]);
  assert.deepEqual(densityTicks([{ page: "2", color: "" }], 9), [{ y01: 1 / 9, color: "" }]);
  assert.deepEqual(densityTicks(rows, 0), []);
  assert.deepEqual(densityTicks(null, 3), []);
  assert.deepEqual(densityTicks([], 3), []);
});

test("coverState is ready when an image is stored, else the warm face", () => {
  const record = { first: blob() };
  assert.equal(coverState(record, "loading"), "ready");
  assert.equal(coverState(record, "error"), "ready");
  assert.equal(coverState({ last: blob() }, null), "ready");
  assert.equal(coverState(null, "loading"), "loading");
  assert.equal(coverState(null, true), "loading");
  assert.equal(coverState(null, { status: "loading" }), "loading");
  assert.equal(coverState(null, "error"), "error");
  assert.equal(coverState({}, { error: true }), "error");
  assert.equal(coverState(null, "none"), "none");
  assert.equal(coverState(null, "skipped"), "none");
  assert.equal(coverState(null, "idle"), "none");
  assert.equal(coverState(null, null), "none");
  assert.equal(coverState({}, undefined), "none");
});

test("a throwing indexedDB falls back to an 8-entry localStorage LRU and never throws", async () => {
  const storage = memoryStorage();
  const indexedDB = { open() { throw new Error("SecurityError"); } };
  const store = createCoverStore({ indexedDB, storage });
  const first = blob([9, 8, 7]);
  const saved = await store.put({
    url: PDF_URL,
    hash: "aaa",
    first,
    last: null,
    lastPage: null,
    pageCount: 9,
    w: 320,
    h: 430,
    ts: 50,
  });
  assert.equal(saved.url, PDF_URL);
  assert.equal(saved.hash, "aaa");
  assert.equal(saved.pageCount, 9);
  assert.deepEqual(await bytesOf(saved.first), [9, 8, 7]);
  const got = await store.get(PDF_URL);
  assert.deepEqual(await bytesOf(got.first), [9, 8, 7]);
  assert.equal(got.w, 320);
  assert.equal(got.h, 430);
  assert.equal(coverValid(got, "bbb"), false);
  assert.ok(storage.map.has(COVER_LS_KEY));

  const writes = storage.writes;
  const afterRead = await store.get(PDF_URL);
  assert.deepEqual(await bytesOf(afterRead.first), [9, 8, 7]);
  assert.equal(storage.writes, writes, "get does not write");

  const urls = [];
  for (let i = 1; i <= 8; i += 1) {
    const url = `https://example.test/p${i}.pdf`;
    urls.push(url);
    const row = await store.put({ url, hash: "h", first: blob([i]), ts: i });
    assert.equal(row.url, url);
  }
  const touched = storage.writes;
  const still = await store.get(urls[0]);
  assert.deepEqual(await bytesOf(still.first), [1]);
  assert.equal(storage.writes, touched, "a read does not persist the LRU touch");
  const ninth = "https://example.test/p9.pdf";
  await store.put({ url: ninth, hash: "h", first: blob([9]), ts: 9 });
  assert.equal(await store.get(urls[1]), null, "the oldest untouched cover drops");
  assert.deepEqual(await bytesOf((await store.get(urls[0])).first), [1], "a read keeps that cover");
  assert.deepEqual(await bytesOf((await store.get(ninth)).first), [9]);
  assert.equal(await store.get("https://example.test/missing.pdf"), null);

  assert.equal(await store.remove(urls[0]), true);
  assert.equal(await store.get(urls[0]), null);
  assert.equal(await store.remove("https://example.test/missing.pdf"), true);
  assert.equal(await store.put({ hash: "h", first: blob() }), null);
  assert.equal(await store.get(""), null);
});

test("IndexedDB plexus-diagram/covers stores the blob and skips localStorage", async () => {
  const created = [];
  const opens = [];
  const dbs = new Map();
  const indexedDB = {
    open(name, version) {
      opens.push([name, version]);
      const req = {};
      queueMicrotask(() => {
        let db = dbs.get(name);
        if (!db) {
          db = {
            stores: new Map(),
            objectStoreNames: { contains: (store) => db.stores.has(store) },
            createObjectStore(store) {
              created.push(store);
              const map = new Map();
              db.stores.set(store, map);
              return map;
            },
            transaction(storeName) {
              const map = db.stores.get(storeName);
              if (!map) throw new Error(`missing ${storeName}`);
              return {
                objectStore() {
                  return {
                    get(key) {
                      const request = {};
                      queueMicrotask(() => {
                        request.result = map.has(key) ? map.get(key) : undefined;
                        request.onsuccess?.();
                      });
                      return request;
                    },
                    put(value, key) {
                      const request = {};
                      queueMicrotask(() => {
                        map.set(key, value);
                        request.result = key;
                        request.onsuccess?.();
                      });
                      return request;
                    },
                    delete(key) {
                      const request = {};
                      queueMicrotask(() => {
                        map.delete(key);
                        request.result = undefined;
                        request.onsuccess?.();
                      });
                      return request;
                    },
                  };
                },
              };
            },
            close() {},
          };
          dbs.set(name, db);
          req.result = db;
          try { req.onupgradeneeded?.(); } catch (error) {
            req.error = error;
            req.onerror?.({ preventDefault() {} });
            return;
          }
        }
        req.result = db;
        req.onsuccess?.();
      });
      return req;
    },
  };
  const storage = memoryStorage();
  const store = createCoverStore({ indexedDB, storage });
  const first = blob([4, 5, 6]);
  const saved = await store.put({ url: PDF_URL, hash: "live", first, last: null, lastPage: 3, pageCount: 9, w: 320, h: 430, ts: 7 });
  assert.equal(saved.first, first);
  assert.deepEqual(opens, [[COVER_DB, COVER_DB_VERSION]]);
  assert.deepEqual(created, [COVER_STORE, "parse", "parse-images", "parse-index"]);
  assert.equal(storage.writes, 0);
  const got = await store.get(PDF_URL);
  assert.equal(got.first, first);
  assert.equal(got.lastPage, 3);
  assert.equal(got.hash, "live");
  assert.equal(opens.length, 1, "one database connection");
  assert.equal(await store.remove(PDF_URL), true);
  assert.equal(await store.get(PDF_URL), null);
  assert.equal(storage.writes, 0);
});

test("an IndexedDB quota failure falls back to localStorage", async () => {
  const storage = memoryStorage();
  const indexedDB = {
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = {
          objectStoreNames: { contains: () => false },
          createObjectStore() {},
          transaction() { throw new Error("QuotaExceededError"); },
          close() {},
        };
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  const store = createCoverStore({ indexedDB, storage });
  const saved = await store.put({ url: PDF_URL, hash: "q", first: blob([7]), ts: 1 });
  assert.deepEqual(await bytesOf(saved.first), [7]);
  assert.ok(storage.writes > 0);
  assert.deepEqual(await bytesOf((await store.get(PDF_URL)).first), [7]);
});

test("a store with no working backend resolves null", async () => {
  const store = createCoverStore({
    indexedDB: new Proxy({}, { get() { throw new Error("denied"); } }),
    storage: {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    },
  });
  const first = blob();
  await assert.doesNotReject(async () => {
    assert.equal(await store.get(PDF_URL), null);
    assert.equal(await store.put({ url: PDF_URL, first }), null);
    assert.equal(await store.remove(PDF_URL), null);
  });
});

test("cover modules do not touch the graph or log", () => {
  for (const rel of ["../src/model/pdf-cover.js", "../src/host/cover-store.js"]) {
    const text = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.equal(text.includes("roamAlphaAPI"), false, rel);
    assert.equal(text.includes(":diagram"), false, rel);
    assert.equal(text.includes("console."), false, rel);
  }
});
