// Reopen: the parse a PDF restores is the OCR-read one, and every title lookup agrees with it.
import assert from "node:assert/strict";
import test from "node:test";

import { DIAGRAM_DB } from "../src/host/diagram-db.js";
import { createParseStore, restorableByUrl } from "../src/host/parse-store.js";
import { optionsHash } from "../src/model/parse-hash.js";
import { parsedDocTitle } from "../src/model/pdf.js";
import { BUILTIN_OPTIONS } from "../src/view/parse-view.js";
import { createPageChips } from "../src/view/page-chips.js";
import { createDomStub } from "./fixtures/dom-stub.js";

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


const SHA = "b4d2".padEnd(64, "0");
const URL = "https://example.test/scan.pdf?alt=media&token=t";

const scanOnly = () => ({
  schema: "pxd-parse/1", sha256: SHA, engine: "builtin", parseRev: 99, title: "", pageCount: 1,
  options: { ...BUILTIN_OPTIONS }, pages: [{ n: 1, w: 600, h: 400, scanLayer: true }],
  order: ["s1"], blocks: { s1: { id: "s1", type: "scan", page: 1, bbox: [0, 0, 600, 400] } },
});
const readDoc = () => ({
  schema: "pxd-parse/1", sha256: SHA, engine: "builtin", title: "NOTIFIABL", pageCount: 1,
  options: { ...BUILTIN_OPTIONS, ocr: "vision" }, pages: [{ n: 1, w: 600, h: 400, ocr: true }],
  order: ["p1", "t1"],
  blocks: {
    p1: { id: "p1", type: "para", page: 1, text: "Notifiable diseases summary of reported cases", bbox: [10, 10, 500, 20] },
    t1: { id: "t1", type: "table", page: 1, bbox: [10, 30, 500, 300], grid: { xs: [10, 500], ys: [30, 300] }, cells: [] },
  },
});

// Records exactly as the store writes them in IndexedDB: { doc, optsHash, at } under `sha|engine|optsHash`.
async function seeded({ read = true } = {}) {
  const plainHash = await optionsHash(BUILTIN_OPTIONS);
  const readHash = await optionsHash({ ...BUILTIN_OPTIONS, ocr: "vision" });
  const idb = fakeIDB();
  const rows = [[`${SHA}|builtin|${plainHash}`, { doc: scanOnly(), optsHash: plainHash, at: 100 }]];
  if (read) rows.push([`${SHA}|builtin|${readHash}`, { doc: readDoc(), optsHash: readHash, at: 200 }]);
  idb.seed(DIAGRAM_DB, 2, {
    covers: [],
    parse: rows,
    "parse-images": [],
    "parse-index": [[URL, { sha256: SHA, pageCount: 1, at: 50 }]],
  });
  return createParseStore({ indexedDB: idb, now: () => 300 });
}

test("restorableByUrl returns the OCR-read parse over the scan-only one", async () => {
  const store = await seeded();
  const found = await restorableByUrl(store, URL, { plainOptions: BUILTIN_OPTIONS });
  assert.equal(found.options.ocr, "vision");
  assert.equal(Object.keys(found.blocks).length, 2);
  assert.equal(parsedDocTitle(found), "Notifiable diseases summary of reported cases");
});

test("restorableByUrl falls back to the plain parse, and to null for an unknown url", async () => {
  const store = await seeded({ read: false });
  const found = await restorableByUrl(store, URL, { plainOptions: BUILTIN_OPTIONS });
  assert.equal(found.blocks.s1.type, "scan");
  assert.equal(parsedDocTitle(found), "");
  assert.equal(await restorableByUrl(store, "https://example.test/other.pdf", { plainOptions: BUILTIN_OPTIONS }), null);
  assert.equal(await restorableByUrl(null, URL, { plainOptions: BUILTIN_OPTIONS }), null);
});

test("a title lookup never names a read PDF from its scan-only parse", async () => {
  // noteCached used to read the plain hash only: "" for a scan, which blanked the title the restore had set.
  const store = await seeded();
  const plainHash = await optionsHash(BUILTIN_OPTIONS);
  const hit = await store.findByUrl(URL);
  const plain = await store.getParse(hit.sha256, "builtin", plainHash);
  assert.equal(parsedDocTitle(plain), "");
  const viaUrl = await restorableByUrl(store, URL, { plainOptions: BUILTIN_OPTIONS });
  assert.notEqual(parsedDocTitle(viaUrl), "");
});

test("page chips keep looking until the reader has drawn the page", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const page = doc.createElement("div");
    page.className = "page";
    page.setAttribute("data-page-number", "1");
    page._rect = { left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 };
    doc.body.append(page);
    let drawn = false;
    const chips = createPageChips({
      doc,
      getParsed: () => readDoc(),
      pageEl: (n) => (n === 1 && drawn ? page : null),
      pageOf: () => ({ w: 600, h: 400, rotation: 0 }),
      run() {},
    });
    chips.refresh();
    assert.equal(chips.boxCount(), 0);
    assert.ok(stub.timers.size > 0, "a retry is scheduled");
    drawn = true;
    stub.flushTimers();
    stub.flushFrames();
    assert.equal(chips.boxCount(), 2);
    chips.dispose();
  } finally {
    restore();
  }
});
