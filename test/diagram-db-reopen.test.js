// The stores share one connection through openDiagramDb. When it closes (a newer Plexus upgrading) or is closed on
// unload, the next call opens a fresh one instead of the store giving up on IndexedDB for the session.
import assert from "node:assert/strict";
import test from "node:test";
import { closeDiagramDb, openDiagramDb } from "../src/host/diagram-db.js";
import { createParseStore } from "../src/host/parse-store.js";
import { createCoverStore } from "../src/host/cover-store.js";
import { createFakeIDB } from "./fixtures/fake-idb.js";

// A closed connection throws on transaction(), as a real one does.
async function sharedDb(idb) {
  const db = await openDiagramDb(idb);
  if (!db.__strict) {
    const tx = db.transaction.bind(db);
    db.transaction = (...a) => {
      if (db.closed) throw Object.assign(new Error("InvalidStateError"), { name: "InvalidStateError" });
      return tx(...a);
    };
    db.__strict = true;
  }
  return db;
}
const opensOf = (idb) => idb.opens.filter((o) => o[0] === "plexus-diagram").length;

test("after a versionchange closes the shared connection a parse-store read and write still reach IndexedDB", async () => {
  const idb = createFakeIDB();
  const parse = createParseStore({ indexedDB: idb });
  await parse.putMeta("k", { v: 1 });
  const db = await sharedDb(idb);
  db.onversionchange({});
  assert.equal(db.closed, true);
  assert.deepEqual(await parse.getMeta("k"), { v: 1 }, "the value written before the close is read from the database");
  await parse.putMeta("k2", { v: 2 });
  assert.deepEqual(await parse.getMeta("k2"), { v: 2 });
  assert.equal(opensOf(idb), 2, "one reopen");
  const rec = idb.dbs.get("plexus-diagram");
  assert.ok([...rec.stores.values()].some((m) => m.size > 0), "the writes are in the database, not only in memory");
});

test("a store that last used a closed connection reopens through openDiagramDb on its next call", async () => {
  const idb = createFakeIDB();
  const parse = createParseStore({ indexedDB: idb });
  await parse.putMeta("a", 1);
  const db = await sharedDb(idb);
  // Closed without the eviction events: the first transaction throws, the store opens afresh once.
  db.close();
  assert.equal(await parse.getMeta("a"), 1);
  assert.equal(opensOf(idb), 2);
});

test("the cover store reopens too", async () => {
  const idb = createFakeIDB();
  const cover = createCoverStore({ indexedDB: idb, storage: null });
  const url = "https://example.test/a.pdf";
  await cover.get(url);
  const db = await sharedDb(idb);
  db.onversionchange({});
  await cover.get(url);
  assert.equal(opensOf(idb), 2);
});

test("closeDiagramDb closes the shared connection and the next open is fresh", async () => {
  const idb = createFakeIDB();
  const first = await openDiagramDb(idb);
  closeDiagramDb(idb);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(first.closed, true);
  const second = await openDiagramDb(idb);
  assert.notEqual(second, first);
  assert.equal(second.closed, false);
  closeDiagramDb(undefined);
  closeDiagramDb(null);
});
