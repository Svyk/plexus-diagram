// The Connections fingerprint watch never trusts a seed it did not verify, never publishes a list shorter than
// Roam's, and heals after a failed read.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { BOARD_PATTERN } from "../src/host/roam.js";
import { FINGERPRINT_PATTERN, createSplitWatch } from "../src/host/split-watch.js";

function mk() {
  const fake = createFakeRoam({ echoDelay: 1, stamps: true });
  const edges = Array.from({ length: 10 }, (_, i) => ({ uid: `e${i}`, string: `edge ${i}`, props: { plexus: { type: "edge", from: "c0", to: "c1" } } }));
  fake.seedBoard({ uid: "b", props: { plexus: { v: 2 } }, children: [{ uid: "c0", string: "c0" }, { uid: "c1", string: "c1" }, { uid: "E", string: "Connections", props: { plexus: { type: "edges" } }, children: edges }] });
  return fake;
}
const edgesOf = (t) => t[":block/children"].find((k) => k[":block/uid"] === "E")[":block/children"];
const settle = async (fake) => { await fake.flush(); await fake.flush(); };
const split = (fake, seed, trees, pull = fake.api.data.pull) => createSplitWatch({ uid: "b", seed, data: fake.api.data, pull, deepPattern: BOARD_PATTERN, fingerprint: true, onTree: (t) => trees.push(t), schedule: (fn) => fn() });

test("a stale seed with the same uid set heals on the first Connections change", async () => {
  const fake = mk();
  const stale = fake.api.data.pull(BOARD_PATTERN, [":block/uid", "b"]);
  await fake.api.data.block.update({ block: { uid: "e3", string: "edited while no watch" } });
  await settle(fake);
  const trees = [];
  const w = split(fake, stale, trees);
  await fake.api.data.block.update({ block: { uid: "e7", string: "later edit" } });
  await settle(fake);
  const edges = edgesOf(trees.at(-1));
  assert.equal(edges.find((e) => e[":block/uid"] === "e3")[":block/string"], "edited while no watch");
  assert.equal(edges.find((e) => e[":block/uid"] === "e7")[":block/string"], "later edit");
  w.dispose();
});

test("reseed with an older tree does not lose an edge created since", async () => {
  const fake = mk();
  const old = fake.api.data.pull(BOARD_PATTERN, [":block/uid", "b"]);
  const trees = [];
  const w = split(fake, old, trees);
  await fake.api.data.block.update({ block: { uid: "e1", string: "warm" } });
  await settle(fake);
  await fake.api.data.block.create({ location: { "parent-uid": "E", order: "last" }, block: { uid: "eNEW", string: "new edge", props: { plexus: { type: "edge", from: "e0", to: "c1" } } } });
  await settle(fake);
  assert.equal(edgesOf(trees.at(-1)).length, 11);
  w.reseed(old);
  await fake.api.data.block.update({ block: { uid: "e2", string: "another" } });
  await settle(fake);
  const edges = edgesOf(trees.at(-1));
  assert.equal(edges.length, 11);
  assert.ok(edges.some((e) => e[":block/uid"] === "eNEW"));
  w.dispose();
});

test("a failed whole read publishes nothing short and the next change reads again", async () => {
  const fake = mk();
  const full = fake.api.data.pull(BOARD_PATTERN, [":block/uid", "b"]);
  const trees = [];
  let failing = false;
  const pull = (pattern, entity) => {
    if (failing && pattern !== FINGERPRINT_PATTERN && String(entity).match(/"(E|e\d+)"/)) throw new Error("transient");
    return fake.api.data.pull(pattern, entity);
  };
  const w = split(fake, full, trees, pull);
  await fake.api.data.block.update({ block: { uid: "e9", string: "warm" } });
  await settle(fake);
  trees.length = 0;
  failing = true;
  await fake.api.data.block.update({ block: { uid: "e1", string: "edited under a failing read" } });
  await settle(fake);
  failing = false;
  for (const t of trees) assert.equal(edgesOf(t).length, 10, "no short list was published");
  await fake.api.data.block.update({ block: { uid: "e2", string: "after" } });
  await settle(fake);
  const edges = edgesOf(trees.at(-1));
  assert.equal(edges.length, 10);
  assert.equal(edges.find((e) => e[":block/uid"] === "e1")[":block/string"], "edited under a failing read");
  assert.equal(edges.find((e) => e[":block/uid"] === "e2")[":block/string"], "after");
  w.dispose();
});
