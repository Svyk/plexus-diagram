import assert from "node:assert/strict";
import test from "node:test";

import { createCoverStore } from "../src/host/cover-store.js";
import { DIAGRAM_DB, DIAGRAM_DB_VERSION } from "../src/host/diagram-db.js";
import { PARSE_DOC_CAP, PARSE_IMAGE_CAP, createParseStore, imageKey, parseKey } from "../src/host/parse-store.js";
import { optionsHash } from "../src/model/parse-hash.js";

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
                request.onsuccess?.();
              });
              return request;
            },
            getAllKeys() {
              const request = {};
              queueMicrotask(() => {
                request.result = [...map.keys()];
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
  return db;
}

function fakeIDB() {
  const dbs = new Map();
  const opens = [];
  return {
    opens,
    seed(name, version, stores) {
      const db = makeDb();
      db.version = version;
      for (const [store, entries] of Object.entries(stores)) {
        db.createObjectStore(store);
        const map = db.stores.get(store);
        for (const [key, value] of entries) map.set(key, value);
      }
      dbs.set(name, db);
      return db;
    },
    open(name, version) {
      opens.push([name, version]);
      const req = {};
      queueMicrotask(() => {
        let db = dbs.get(name);
        if (!db) {
          db = makeDb();
          dbs.set(name, db);
        }
        req.result = db;
        if (version > db.version) {
          db.version = version;
          try { req.onupgradeneeded?.(); }
          catch (error) {
            req.error = error;
            req.onerror?.({ preventDefault() {} });
            return;
          }
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function doc(sha, engine = "builtin") {
  return {
    schema: "pxd-parse/1",
    sha256: sha,
    engine,
    options: { ocr: "auto", formula: false },
    order: [],
    blocks: {},
    pageCount: 1,
  };
}

test("memory fallback stores, finds by url, evicts, and clears", async () => {
  let t = 10;
  const store = createParseStore({ now: () => { t += 1; return t; }, docCap: 2, imageCap: 100 });
  const hash = await optionsHash({ ocr: "auto", formula: false });
  const saved = await store.putParse(doc("a"));
  assert.equal(saved.optsHash, hash);
  assert.equal((await store.getParse("a", "builtin", hash)).sha256, "a");
  assert.equal(await store.getParse("missing", "builtin", hash), null);
  const indexed = await store.indexUrl("https://example.test/a.pdf", { sha256: "a", pageCount: 3 });
  assert.equal(indexed.pageCount, 3);
  assert.deepEqual(await store.findByUrl("https://example.test/a.pdf"), { sha256: "a", pageCount: 3, at: indexed.at });

  const key = imageKey("a", "f1");
  assert.equal(key, "a/f1");
  assert.equal(parseKey("a", "builtin", hash), `a|builtin|${hash}`);
  const bytes = new Uint8Array([1, 2, 3, 4]);
  assert.ok(await store.putImage(key, bytes));
  assert.deepEqual(await store.getImage(key), bytes);
  assert.equal(await store.putImage("big", new Uint8Array(101)), null);

  await store.putImage("b/1", new Uint8Array(60));
  await store.putImage("b/2", new Uint8Array(60));
  assert.equal(await store.getImage("b/1"), null);
  assert.equal((await store.getImage("b/2")).byteLength, 60);

  await store.putParse(doc("b"));
  await store.putParse(doc("c"));
  assert.equal(await store.getParse("a", "builtin", hash), null);
  assert.equal((await store.getParse("c", "builtin", hash)).sha256, "c");

  assert.equal(await store.clear(), true);
  assert.equal(await store.getParse("c", "builtin", hash), null);
  assert.equal(await store.findByUrl("https://example.test/a.pdf"), null);
  assert.equal(await store.getImage(key), null);
  assert.equal(PARSE_DOC_CAP, 50);
  assert.equal(PARSE_IMAGE_CAP, 200 * 1024 * 1024);
});

test("IndexedDB keeps an existing covers store and serves parse records", async () => {
  const indexedDB = fakeIDB();
  indexedDB.seed(DIAGRAM_DB, 1, { covers: [["https://example.test/old.pdf", { url: "https://example.test/old.pdf", hash: "h" }]] });
  const parse = createParseStore({ indexedDB, now: () => 5 });
  const hash = await optionsHash({ ocr: "auto", formula: false });
  await parse.putParse(doc("s"));
  assert.equal((await parse.getParse("s", "builtin", hash)).engine, "builtin");
  assert.deepEqual(indexedDB.opens[0], [DIAGRAM_DB, DIAGRAM_DB_VERSION]);
  assert.equal(DIAGRAM_DB_VERSION, 2);

  const covers = createCoverStore({ indexedDB });
  const got = await covers.get("https://example.test/old.pdf");
  assert.equal(got.hash, "h");
  await covers.put({ url: "https://example.test/new.pdf", hash: "n", first: null, ts: 1 });
  assert.equal((await covers.get("https://example.test/new.pdf")).hash, "n");
  assert.equal((await parse.getParse("s", "builtin", hash)).sha256, "s");
});

test("a dead IndexedDB open falls back to memory", async () => {
  const indexedDB = {
    open() {
      const req = {};
      queueMicrotask(() => req.onerror?.({ preventDefault() {} }));
      return req;
    },
  };
  const store = createParseStore({ indexedDB, now: () => 1 });
  const saved = await store.putParse(doc("m"));
  const hash = saved.optsHash;
  assert.equal((await store.getParse("m", "builtin", hash)).sha256, "m");
});
