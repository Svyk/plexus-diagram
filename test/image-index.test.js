import assert from "node:assert/strict";
import test from "node:test";

import { DIAGRAM_DB, DIAGRAM_DB_VERSION, IMAGE_DB, STORE_IMAGE_INDEX, openDiagramDb, openImageDb } from "../src/host/diagram-db.js";
import { OCR_MIN_H, OCR_MIN_W, RETRY_MS, createImageIndex, localImagePath } from "../src/host/image-index.js";
import { colorQuery, colorScore } from "../src/model/color.js";

function makeDb() {
  const db = {
    version: 0,
    stores: new Map(),
    objectStoreNames: { contains: (name) => db.stores.has(name) },
    createObjectStore(name) {
      if (db.stores.has(name)) throw new Error(`exists ${name}`);
      db.stores.set(name, new Map());
    },
    transaction(name) {
      const map = db.stores.get(name);
      if (!map) throw new Error(`missing ${name}`);
      const ask = (fn) => {
        const request = {};
        queueMicrotask(() => { request.result = fn(); request.onsuccess?.(); });
        return request;
      };
      return {
        objectStore: () => ({
          get: (key) => ask(() => (map.has(key) ? map.get(key) : undefined)),
          put: (value, key) => ask(() => { map.set(key, value); return key; }),
          delete: (key) => ask(() => { map.delete(key); }),
          getAllKeys: () => ask(() => [...map.keys()]),
        }),
      };
    },
    closed: false,
    close() { db.closed = true; },
  };
  return db;
}

function fakeIDB() {
  const dbs = new Map();
  return {
    dbs,
    seed(name, version, stores) {
      const db = makeDb();
      db.version = version;
      for (const [store, entries] of Object.entries(stores)) {
        db.createObjectStore(store);
        for (const [key, value] of entries) db.stores.get(store).set(key, value);
      }
      dbs.set(name, db);
      return db;
    },
    opens: [],
    open(name, version) {
      const req = {};
      this.opens.push([name, version]);
      queueMicrotask(() => {
        let db = dbs.get(name);
        if (!db) { db = makeDb(); dbs.set(name, db); }
        req.result = db;
        if (version < db.version) {
          req.error = { name: "VersionError" };
          req.onerror?.({ preventDefault() {} });
          return;
        }
        if (version > db.version) {
          db.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
}

const solid = (r, g, b) => {
  const px = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < px.length; i += 4) px.set([r, g, b, 255], i);
  return px;
};
const colors = { "https://x.test/red.png": [224, 32, 32], "https://x.test/blue.png": [32, 96, 224] };
const settle = async (index) => {
  for (let i = 0; i < 200; i += 1) {
    await new Promise((r) => setTimeout(r, 2));
    if (!index.status().busy) return;
  }
  throw new Error("index never settled");
};

function rig({ idb = fakeIDB(), sizes = {}, ocr = null, readText = false, now = () => Date.now(), failUrls = [], ocrCap, helperText = null } = {}) {
  const log = { fetches: [], live: 0, peak: 0 };
  const index = createImageIndex({
    indexedDB: idb,
    now,
    idle: (fn) => setImmediate(fn),
    later: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
    fetch: async (url, opts) => {
      log.fetches.push([url, opts?.mode]);
      log.live += 1;
      log.peak = Math.max(log.peak, log.live);
      await new Promise((r) => setTimeout(r, 3));
      log.live -= 1;
      if (failUrls.includes(url)) throw new TypeError("CORS");
      return { ok: true, blob: async () => ({ url }) };
    },
    decode: async (blob) => ({ rgba: solid(...(colors[blob.url] || [0, 200, 0])), ...(sizes[blob.url] || { w: 640, h: 480 }) }),
    decodeFull: async (blob) => ({ rgb: new Uint8Array(12), width: 2, height: 2, ...(sizes[blob.url] || { w: 640, h: 480 }) }),
    ocr,
    helperText,
    settings: { colors: () => true, readText: () => readText },
    ocrCap,
  });
  return { index, log, idb };
}

test("the shared DB stays at version 2 and the image index has its own database", async () => {
  assert.equal(DIAGRAM_DB_VERSION, 2);
  const idb = fakeIDB();
  const old = idb.seed(DIAGRAM_DB, 2, { covers: [["c", { hash: "h" }]], parse: [["p", { sha256: "s" }]], "parse-images": [], "parse-index": [] });
  const db = await openDiagramDb(idb);
  assert.equal(db, old);
  assert.equal(db.version, 2);
  assert.ok(!db.stores.has(STORE_IMAGE_INDEX));
  const fresh = fakeIDB();
  const made = await openDiagramDb(fresh);
  assert.deepEqual([...made.stores.keys()].sort(), ["covers", "parse", "parse-images", "parse-index"]);
  const images = await openImageDb(fresh);
  assert.deepEqual([...images.stores.keys()], [STORE_IMAGE_INDEX]);
});

test("image-index uses its own database and never opens plexus-diagram above version 2", async () => {
  const idb = fakeIDB();
  const shared = idb.seed(DIAGRAM_DB, 2, { covers: [], parse: [], "parse-images": [], "parse-index": [] });
  const r = rig({ idb });
  await r.index.enqueue([{ key: "https://x.test/red.png", url: "https://x.test/red.png" }]);
  await settle(r.index);
  assert.ok(idb.dbs.get(IMAGE_DB).stores.get(STORE_IMAGE_INDEX).size >= 1);
  assert.equal(shared.version, 2);
  assert.ok(!shared.stores.has(STORE_IMAGE_INDEX));
  assert.ok(idb.opens.every(([name, version]) => name === IMAGE_DB && version === 1));
  r.index.dispose();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(idb.dbs.get(IMAGE_DB).closed, true);
});

test("a connection closes itself on versionchange", async () => {
  const idb = fakeIDB();
  const db = await openDiagramDb(idb);
  assert.equal(typeof db.onversionchange, "function");
  assert.equal(db.closed, false);
  db.onversionchange();
  assert.equal(db.closed, true);
  const images = await openImageDb(idb);
  images.onversionchange();
  assert.equal(images.closed, true);
});

test("a VersionError reopens the database without a version when it has the stores", async () => {
  const idb = fakeIDB();
  const ahead = idb.seed(DIAGRAM_DB, 3, { covers: [], parse: [], "parse-images": [], "parse-index": [], "image-index": [] });
  const db = await openDiagramDb(idb);
  assert.equal(db, ahead);
  assert.deepEqual(idb.opens, [[DIAGRAM_DB, 2], [DIAGRAM_DB, undefined]]);
  const bare = fakeIDB();
  bare.seed(DIAGRAM_DB, 3, { covers: [] });
  assert.equal(await openDiagramDb(bare), null);
});

test("indexes colours, persists, and does not fetch twice", async () => {
  const idb = fakeIDB();
  const a = rig({ idb });
  await a.index.enqueue([{ key: "https://x.test/red.png", url: "https://x.test/red.png" }, { key: "https://x.test/blue.png", url: "https://x.test/blue.png" }]);
  await settle(a.index);
  const red = a.index.records.get("https://x.test/red.png");
  assert.ok(colorScore(red.palette, colorQuery("red")) > 0.5);
  assert.equal(red.w, 640);
  assert.equal(red.text, undefined);
  assert.deepEqual(a.log.fetches.map((f) => f[1]), ["cors", "cors"]);
  const b = rig({ idb });
  await b.index.enqueue([{ key: "https://x.test/red.png", url: "https://x.test/red.png" }]);
  await settle(b.index);
  assert.equal(b.log.fetches.length, 0);
  assert.ok(colorScore(b.index.records.get("https://x.test/red.png").palette, colorQuery("red")) > 0.5);
  assert.equal(idb.dbs.get(IMAGE_DB).stores.get(STORE_IMAGE_INDEX).size, 2);
});

test("at most two fetches at once", async () => {
  const r = rig();
  const items = Array.from({ length: 9 }, (_, i) => ({ key: `u${i}`, url: `u${i}` }));
  await r.index.enqueue(items);
  await settle(r.index);
  assert.equal(r.index.records.size, 9);
  assert.ok(r.log.peak <= 2, `peak ${r.log.peak}`);
});

test("a failed fetch is recorded and skipped for 7 days", async () => {
  let t = 1000;
  const r = rig({ failUrls: ["bad"], now: () => t });
  const item = { key: "bad", url: "bad" };
  await r.index.enqueue([item]);
  await settle(r.index);
  assert.equal(r.index.records.get("bad").failed, true);
  assert.equal(r.log.fetches.length, 1);
  t += RETRY_MS - 10;
  await r.index.enqueue([item]);
  await settle(r.index);
  assert.equal(r.log.fetches.length, 1);
  t += 20;
  await r.index.enqueue([item]);
  await settle(r.index);
  assert.equal(r.log.fetches.length, 2);
});

test("figure bytes index without a fetch", async () => {
  const r = rig();
  await r.index.enqueue([{ key: "sha/f1", bytes: async () => new Uint8Array([1, 2, 3]) }]);
  await settle(r.index);
  assert.equal(r.log.fetches.length, 0);
  assert.ok(r.index.records.get("sha/f1").palette.length >= 1);
});

test("typing pauses indexing until 600 ms of quiet", async () => {
  let t = 0;
  const r = rig({ now: () => t });
  r.index.pause();
  await r.index.enqueue([{ key: "u1", url: "u1" }]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(r.log.fetches.length, 0);
  assert.equal(r.index.status().pending, 1);
  t += 700;
  await settle(r.index);
  assert.equal(r.log.fetches.length, 1);
});

test("enqueue does no work synchronously", async () => {
  const r = rig();
  const p = r.index.enqueue([{ key: "u1", url: "u1" }]);
  assert.equal(r.log.fetches.length, 0);
  await p;
  assert.equal(r.log.fetches.length, 0);
  await settle(r.index);
});

test("text reading is off by default and never starts without cached models", async () => {
  const reads = [];
  const ready = { readImageText: async (img) => { reads.push(img); return "Revenue 2026"; } };
  const off = rig({ ocr: ready, readText: false });
  await off.index.enqueue([{ key: "a", url: "a" }]);
  await settle(off.index);
  assert.equal(reads.length, 0);
  assert.equal(off.index.records.get("a").text, undefined);

  const cold = rig({ ocr: { readImageText: async () => null }, readText: true });
  await cold.index.enqueue([{ key: "a", url: "a" }, { key: "b", url: "b" }]);
  await settle(cold.index);
  assert.equal(cold.index.records.get("a").text, undefined);
  assert.ok(cold.index.records.get("a").palette);
});

test("text reading: one at a time, large images only, capped per session, resumable", async () => {
  let live = 0;
  let peak = 0;
  const reads = [];
  const ocr = {
    readImageText: async () => {
      live += 1; peak = Math.max(peak, live);
      reads.push(1);
      await new Promise((r) => setTimeout(r, 3));
      live -= 1;
      return "Revenue 2026";
    },
  };
  const sizes = { small: { w: OCR_MIN_W - 1, h: 400 }, flat: { w: 900, h: OCR_MIN_H - 1 } };
  const idb = fakeIDB();
  const keys = ["small", "flat", ...Array.from({ length: 5 }, (_, i) => `big${i}`)];
  const r = rig({ idb, sizes, ocr, readText: true, ocrCap: 3 });
  await r.index.enqueue(keys.map((k) => ({ key: k, url: k })));
  await settle(r.index);
  assert.equal(peak, 1);
  assert.equal(reads.length, 3);
  assert.equal(r.index.records.get("small").text, "");
  const done = keys.filter((k) => r.index.records.get(k).text === "Revenue 2026");
  assert.equal(done.length, 3);
  const next = rig({ idb, sizes, ocr, readText: true, ocrCap: 3 });
  await next.index.enqueue(keys.map((k) => ({ key: k, url: k })));
  await settle(next.index);
  assert.equal(reads.length, 5);
  assert.equal(keys.filter((k) => next.index.records.get(k).text === "Revenue 2026").length, 5);
  assert.equal(next.log.fetches.filter((f) => f[0] === "big0").length, 0);
});

test("localImagePath keeps a file path and skips web urls", () => {
  assert.equal(localImagePath("file:///Users/me/lab%20note.png"), "/Users/me/lab note.png");
  assert.equal(localImagePath("/Users/me/scan.png"), "/Users/me/scan.png");
  assert.equal(localImagePath("https://x.test/a.png"), "");
  assert.equal(localImagePath("blob:https://roamresearch.com/abc"), "");
});

test("a local path is read by the helper even when in-browser text is off", async () => {
  const reads = [];
  const asked = [];
  const r = rig({
    readText: false,
    ocr: { readImageText: async () => { reads.push(1); return "browser"; } },
    helperText: async (path) => { asked.push(path); return "lab notebook"; },
  });
  await r.index.enqueue([{ key: "file:///Users/me/a.png", url: "file:///Users/me/a.png", path: "/Users/me/a.png" }]);
  await settle(r.index);
  const rec = r.index.records.get("file:///Users/me/a.png");
  assert.deepEqual(asked, ["/Users/me/a.png"]);
  assert.equal(reads.length, 0);
  assert.equal(rec.text, "lab notebook");
  assert.equal(rec.failed, undefined);
  assert.ok(rec.palette);
  await r.index.enqueue([{ key: "file:///Users/me/a.png", url: "file:///Users/me/a.png", path: "/Users/me/a.png" }]);
  await settle(r.index);
  assert.equal(asked.length, 1);
});

test("a helper that has no image route stores empty text and leaves colour searchable", async () => {
  const r = rig({
    readText: true,
    ocr: { readImageText: async () => "browser" },
    helperText: async () => null,
  });
  await r.index.enqueue([{ key: "p", url: "https://x.test/red.png", path: "/tmp/red.png" }]);
  await settle(r.index);
  const rec = r.index.records.get("p");
  assert.equal(rec.text, "");
  assert.equal(rec.failed, undefined);
  assert.ok(rec.palette);
  const thrown = rig({ helperText: async () => { throw new Error("down"); } });
  await thrown.index.enqueue([{ key: "q", url: "https://x.test/blue.png", path: "/tmp/blue.png" }]);
  await settle(thrown.index);
  assert.equal(thrown.index.records.get("q").text, "");
  assert.equal(thrown.index.records.get("q").failed, undefined);
  const web = rig({ helperText: async () => { throw new Error("should not run"); } });
  await web.index.enqueue([{ key: "https://x.test/red.png", url: "https://x.test/red.png" }]);
  await settle(web.index);
  assert.equal(web.index.records.get("https://x.test/red.png").text, undefined);
});
