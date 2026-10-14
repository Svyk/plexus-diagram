// P9 unit 1: stored board models (preorder rows in JSON parts) in the snapshot database, bounded by count and size.
import assert from "node:assert/strict";
import test from "node:test";

import { createModelStore, createTreeDecoder, createTreeEncoder, decodeTree, encodeTree, MODEL_VERSION } from "../src/host/model-store.js";
import { SNAP_DB, SNAP_DB_VERSION } from "../src/host/boardsnap-store.js";
import { DIAGRAM_DB } from "../src/host/diagram-db.js";
import { createFakeIDB } from "./fixtures/fake-idb.js";

const tick = (ms = 5) => new Promise((resolve) => { setTimeout(resolve, ms); });

function treeOf(sections = 3, cards = 40) {
  const kids = [];
  for (let s = 0; s < sections; s += 1) {
    const cs = [];
    for (let i = 0; i < cards; i += 1) {
      cs.push({ ":block/uid": `c${s}_${i}`, ":block/string": `card ${s}.${i} "quoted" →`, ":block/order": i, ":block/open": i % 2 === 0,
        ":block/props": { ":plexus": { ":x": i, ":y": s, ":tags": ["a", null] } },
        ...(i % 3 === 0 ? { ":block/children": [{ ":block/uid": `k${s}_${i}`, ":block/string": "", ":block/order": 0, ":block/heading": 2 }] } : {}) });
    }
    kids.push({ ":block/uid": `s${s}`, ":block/string": `Section ${s}`, ":block/order": s, ":block/open": false, ":block/children": cs });
  }
  return { ":block/uid": "root", ":block/string": "{{[[diagram]]}}", ":block/order": 3, ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": kids };
}

test("model codec: a tree round-trips exactly (absent keys stay absent, child order kept)", () => {
  const tree = treeOf();
  const model = encodeTree(tree, { partRows: 17 });
  assert.equal(model.v, MODEL_VERSION);
  assert.equal(model.n, 1 + 3 + 120 + 42);
  assert.ok(model.parts.length > 5);
  assert.equal(model.size, model.parts.reduce((a, p) => a + p.length, 0));
  assert.deepEqual(decodeTree(model), tree);
  assert.ok(!(":block/heading" in decodeTree(model)), "absent stays absent");
});

test("model codec: encode and decode run in bounded parts", () => {
  const tree = treeOf(5, 200);
  let t = 0;
  const clock = () => (t += 1);
  const enc = createTreeEncoder(tree, { partRows: 50 });
  let steps = 0;
  while (!enc.step(3, clock)) steps += 1;
  assert.ok(steps > 3, `encoder steps ${steps}`);
  const dec = createTreeDecoder(enc.result());
  steps = 0;
  while (!dec.step(3, clock)) steps += 1;
  assert.ok(steps > 3, `decoder steps ${steps}`);
  assert.deepEqual(dec.result(), tree);
});

test("model codec: a damaged model decodes to null", () => {
  const model = encodeTree(treeOf(), { partRows: 10 });
  assert.equal(decodeTree({ ...model, n: model.n + 1 }), null, "count mismatch");
  assert.equal(decodeTree({ ...model, parts: model.parts.slice(0, -1) }), null, "a part missing");
  assert.equal(decodeTree({ ...model, parts: ["[[0,0", ...model.parts.slice(1)] }), null, "bad JSON");
  assert.equal(decodeTree({ ...model, v: 99 }), null, "other version");
  assert.equal(encodeTree(null), null);
});

test("model store: put, stampOf, load; own keys in the snapshot database, never the shared one", async () => {
  const idb = createFakeIDB();
  const store = createModelStore({ indexedDB: idb, graph: "g" });
  await store.ready;
  assert.equal(store.stampOf("root"), null);
  const model = encodeTree(treeOf());
  assert.equal(await store.put("root", "10|20", model), true);
  assert.equal(store.stampOf("root"), "10|20");
  const got = await store.load("root");
  assert.equal(got.stamp, "10|20");
  assert.deepEqual(decodeTree(got), treeOf());
  assert.ok(idb.opens.every(([name, version]) => name === SNAP_DB && (version == null || version === SNAP_DB_VERSION)), JSON.stringify(idb.opens));
  assert.ok(!idb.opens.some(([name]) => name === DIAGRAM_DB));
  // A fresh store (a reload) sees the list.
  const again = createModelStore({ indexedDB: idb, graph: "g" });
  await again.ready;
  assert.equal(again.stampOf("root"), "10|20");
  assert.equal(createModelStore({ indexedDB: idb, graph: "other" }).stampOf("root"), null);
  await store.dispose();
  await again.dispose();
});

test("model store: bounded by count and by size, oldest dropped first; an oversized model is not kept", async () => {
  const idb = createFakeIDB();
  let t = 0;
  const model = encodeTree(treeOf(1, 10));
  const store = createModelStore({ indexedDB: idb, graph: "g", keep: 3, budget: model.size * 3 + 1, now: () => (t += 1) });
  await store.ready;
  for (const uid of ["a", "b", "c", "d"]) await store.put(uid, `s-${uid}`, model);
  assert.deepEqual(store.list().map((r) => r.uid), ["d", "c", "b"]);
  assert.equal(await store.load("a"), null, "dropped from the database too");
  const big = encodeTree(treeOf(3, 40));
  assert.equal(await store.put("b", "s-b2", big), false, "over the budget alone");
  assert.equal(store.stampOf("b"), null, "its older model is gone as well");
  assert.equal(await store.load("b"), null);
  const small = createModelStore({ indexedDB: idb, graph: "g", keep: 3, budget: model.size * 2 });
  await small.ready;
  await small.put("e", "s-e", model);
  assert.deepEqual(small.list().map((r) => r.uid), ["e", "d"], "size budget");
});

test("model store: a load whose stored stamp is not the listed one is refused; the kill switch reads nothing", async () => {
  const idb = createFakeIDB();
  const store = createModelStore({ indexedDB: idb, graph: "g" });
  await store.ready;
  await store.put("root", "1|1", encodeTree(treeOf()));
  // The list moved on (another tab stored a newer model) but this row is the old one.
  const other = createModelStore({ indexedDB: idb, graph: "g" });
  await other.ready;
  await other.put("root", "2|2", encodeTree(treeOf()));
  assert.equal((await store.load("root"))?.stamp, undefined, "store's list says 1|1, the row says 2|2");
  let on = false;
  const off = createModelStore({ indexedDB: idb, graph: "g", enabled: () => on });
  await off.ready;
  assert.equal(off.stampOf("root"), null);
  assert.equal(await off.load("root"), null);
  await tick();
});
