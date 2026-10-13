// F3: the Connections watch reads a fingerprint (uids, order, :edit/time, why notes). A change that is not
// order-only reads the Connections block whole; an order-only change re-sorts without a read. The fake models Roam's
// stamp rules (fake-roam-stamps.test.js).
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { EDGES_PATTERN, FINGERPRINT_PATTERN, SPLIT_WATCH_MIN, diffFingerprints, fingerprintOf } from "../src/host/split-watch.js";
import { noteSpeedFlags } from "../src/settings.js";

afterEach(() => noteSpeedFlags(null));

const EDGES = 2114;
function seed(fake) {
  const cards = Array.from({ length: 40 }, (_, i) => ({ uid: `c${i}`, string: `card ${i}`, props: { plexus: { type: "card", x: i * 10, y: 0, w: 200, h: 100 } } }));
  const edges = Array.from({ length: EDGES }, (_, i) => {
    const edge = { uid: `e${i}`, string: "[[a]] → x → [[b]]", props: { plexus: { type: "edge", from: `c${i % 40}`, to: `c${(i + 1) % 40}` } } };
    if (i === 5) edge.children = [{ uid: "w5", string: "why five", children: [{ uid: "g5a", string: "deeper" }] }];
    return edge;
  });
  fake.seedBoard({ uid: "fp1", props: { plexus: { v: 2 } }, children: [...cards, { uid: "edges1", string: "Connections", props: { plexus: { type: "edges" } }, children: edges }] });
}

// The fingerprint is off by default (see the reference-stamp test below); these tests turn it on.
function setup({ flags = null, seedWith = seed } = {}) {
  noteSpeedFlags({ edgeFingerprint: true, ...flags });
  const fake = createFakeRoam({ echoDelay: 1, stamps: true, pullMany: true });
  fake.roamWatch = true;
  seedWith(fake);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const full = host.pullBoard("fp1");
  const trees = [];
  const off = host.watchBoard("fp1", (t) => trees.push(t));
  return { fake, host, full, trees, off };
}

const find = (n, uid) => {
  if (!n) return null;
  if (n[":block/uid"] === uid) return n;
  for (const k of n[":block/children"] || []) { const hit = find(k, uid); if (hit) return hit; }
  return null;
};
const edgesOf = (tree) => find(tree, "edges1")[":block/children"];

// Whole reads of the Connections block in a log of pulls.
function wholeReads(log) {
  return log.filter((entry) => entry.pattern === EDGES_PATTERN).length;
}
const settle = async (fake) => { await fake.flush(); await fake.flush(); };

async function warmed() {
  const f = setup();
  await settle(f.fake);
  // The first change after the watch exists reads the block whole; the tests measure the ones after it.
  await f.fake.api.data.block.update({ block: { uid: "e1", string: "warm" } });
  await settle(f.fake);
  f.trees.length = 0;
  f.fake.pullLog = [];
  return f;
}

test("the Connections watch registers the fingerprint pattern, not EDGES_PATTERN", async () => {
  const { fake, full } = setup();
  assert.ok(find(full, "edges1")[":block/children"].length === EDGES && EDGES + 40 >= SPLIT_WATCH_MIN);
  await settle(fake);
  const onEdges = fake.watchList().filter((w) => w.uid === "edges1").map((w) => w.pattern);
  assert.deepEqual(onEdges, [FINGERPRINT_PATTERN]);
  assert.ok(FINGERPRINT_PATTERN.split("(limit :block/children nil)").length - 1 === 3, "every children join is unlimited");
});

test("the fingerprint sees all 2,114 edges, not the first 1,000", () => {
  const fake = createFakeRoam({ stamps: true });
  seed(fake);
  const print = fingerprintOf(fake.api.data.pull(FINGERPRINT_PATTERN, [":block/uid", "edges1"]));
  assert.equal(print.size, EDGES);
  assert.equal(fingerprintOf(fake.api.data.pull("[:block/uid :block/order :edit/time {:block/children [:block/uid :block/order :edit/time]}]", [":block/uid", "edges1"])).size, 1000, "without the limit form Roam stops at 1,000");
});

test("a string-only edit reads the block whole once", async () => {
  const { fake, trees } = await warmed();
  await fake.api.data.block.update({ block: { uid: "e1500", string: "[[a]] → edited → [[b]]" } });
  await settle(fake);
  assert.equal(trees.length, 1);
  assert.equal(find(trees[0], "e1500")[":block/string"], "[[a]] → edited → [[b]]");
  assert.equal(edgesOf(trees[0]).length, EDGES, "no cap at 1,000");
  assert.equal(wholeReads(fake.pullLog), 1);
});

test("a props-only edit reads the block whole once", async () => {
  const { fake, trees } = await warmed();
  await fake.api.data.block.update({ block: { uid: "e77", props: { plexus: { type: "edge", from: "c1", to: "c9", color: "red" } } } });
  await settle(fake);
  assert.equal(find(trees.at(-1), "e77")[":block/props"][":plexus"][":color"], "red");
  assert.equal(wholeReads(fake.pullLog), 1);
});

test("a why note created, edited and deleted each reach the tree", async () => {
  const { fake, trees } = await warmed();
  await fake.api.data.block.create({ location: { "parent-uid": "e20", order: "last" }, block: { uid: "w20", string: "because" } });
  await settle(fake);
  assert.equal(find(trees.at(-1), "e20")[":block/children"].length, 1);
  assert.equal(wholeReads(fake.pullLog), 1, "create: one whole read");
  fake.pullLog = [];
  await fake.api.data.block.update({ block: { uid: "w20", string: "because, in full" } });
  await settle(fake);
  assert.equal(find(trees.at(-1), "w20")[":block/string"], "because, in full");
  assert.equal(wholeReads(fake.pullLog), 1, "edit: one whole read");
  fake.pullLog = [];
  await fake.api.data.block.delete({ block: { uid: "w20" } });
  await settle(fake);
  assert.equal(find(trees.at(-1), "w20"), null);
  assert.equal(wholeReads(fake.pullLog), 1, "delete: one whole read");
});

test("a grandchild added to and removed from a why note reaches the tree", async () => {
  const { fake, trees } = await warmed();
  await fake.api.data.block.create({ location: { "parent-uid": "w5", order: "last" }, block: { uid: "g5b", string: "more" } });
  await settle(fake);
  assert.equal(find(trees.at(-1), "w5")[":block/children"].length, 2);
  assert.equal(wholeReads(fake.pullLog), 1);
  fake.pullLog = [];
  await fake.api.data.block.delete({ block: { uid: "g5a" } });
  await settle(fake);
  assert.equal(find(trees.at(-1), "w5")[":block/children"].length, 1);
  assert.equal(wholeReads(fake.pullLog), 1);
});

test("deleting an edge renumbers its siblings and reads the block whole", async () => {
  const { fake, trees } = await warmed();
  await fake.api.data.block.delete({ block: { uid: "e100" } });
  await settle(fake);
  const edges = edgesOf(trees.at(-1));
  assert.equal(edges.length, EDGES - 1);
  assert.equal(find(trees.at(-1), "e100"), null);
  assert.equal(edges[100][":block/uid"], "e101");
  assert.equal(edges[100][":block/order"], 100, "the renumbered order is in the tree");
  assert.equal(wholeReads(fake.pullLog), 1);
});

test("moving an edge only re-sorts", async () => {
  const { fake, trees } = await warmed();
  await fake.api.data.block.move({ location: { "parent-uid": "edges1", order: 0 }, block: { uid: "e50" } });
  await settle(fake);
  const edges = edgesOf(trees.at(-1));
  assert.equal(edges[0][":block/uid"], "e50");
  assert.equal(edges.length, EDGES);
  assert.equal(wholeReads(fake.pullLog), 0, "an order-only change reads nothing");
});

test("a new edge is read, an unrelated write reads nothing", async () => {
  const { fake, trees } = await warmed();
  await fake.api.data.block.update({ block: { uid: "c3", string: "card three" } });
  await settle(fake);
  assert.equal(wholeReads(fake.pullLog), 0, "a card edit does not touch the Connections reads");
  await fake.api.data.block.create({ location: { "parent-uid": "edges1", order: "last" }, block: { uid: "enew", string: "[[a]] → new → [[b]]", props: { plexus: { type: "edge", from: "c1", to: "c2" } } } });
  await settle(fake);
  assert.equal(edgesOf(trees.at(-1)).length, EDGES + 1);
  assert.equal(edgesOf(trees.at(-1)).at(-1)[":block/uid"], "enew");
});

test("undo of an edge edit comes back (the stamp changes again)", async () => {
  const { fake, trees } = await warmed();
  fake.trackUndo = true;
  await fake.api.data.block.update({ block: { uid: "e9", string: "changed" } });
  await settle(fake);
  assert.equal(find(trees.at(-1), "e9")[":block/string"], "changed");
  await fake.api.data.undo();
  await settle(fake);
  assert.equal(find(trees.at(-1), "e9")[":block/string"], "[[a]] → x → [[b]]");
});

test("the first change after arming reads the block whole and arms the fingerprint", async () => {
  const { fake, trees } = setup();
  await settle(fake);
  fake.pullLog = [];
  await fake.api.data.block.update({ block: { uid: "e7", string: "first" } });
  await settle(fake);
  assert.equal(find(trees.at(-1), "e7")[":block/string"], "first");
  assert.equal(wholeReads(fake.pullLog), 1);
  fake.pullLog = [];
  await fake.api.data.block.move({ location: { "parent-uid": "edges1", order: 0 }, block: { uid: "e8" } });
  await settle(fake);
  assert.equal(wholeReads(fake.pullLog), 0, "after the first whole read an order-only change needs none");
  assert.equal(edgesOf(trees.at(-1))[0][":block/uid"], "e8");
});

test("a why-note grandchild swapped for another one (same count) counts as a change", () => {
  const w = (g) => [["w1", 1, 0, g]];
  const prev = new Map([["e1", { order: 0, time: 1, whys: w("a") }]]);
  const next = new Map([["e1", { order: 0, time: 1, whys: w("b") }]]);
  assert.deepEqual(diffFingerprints(prev, next).changed, ["e1"]);
});

test("the edgeFingerprint switch restores the EDGES_PATTERN watch", async () => {
  const { fake, trees } = setup({ flags: { edgeFingerprint: false } });
  await settle(fake);
  assert.deepEqual(fake.watchList().filter((w) => w.uid === "edges1").map((w) => w.pattern), [EDGES_PATTERN]);
  await fake.api.data.block.update({ block: { uid: "e3", string: "off" } });
  await settle(fake);
  assert.equal(find(trees.at(-1), "e3")[":block/string"], "off");
});

// Live edges are `((A)) → label → ((B))`, and Roam re-stamps every block that references an edited block: one card
// write changes the fingerprint of all that card's edges and the watch reads Connections whole on every card edit and
// drag (+100 ms per write on PhD MAIN). So edgeFingerprint is off by default.
function seedRefs(fake) {
  const cards = Array.from({ length: 40 }, (_, i) => ({ uid: `c${i}`, string: `card ${i}`, props: { plexus: { type: "card", x: i * 10, y: 0, w: 200, h: 100 } } }));
  const edges = Array.from({ length: EDGES }, (_, i) => ({ uid: `e${i}`, string: `((c${i % 40})) → x → ((c${(i + 1) % 40}))`, props: { plexus: { type: "edge", from: `c${i % 40}`, to: `c${(i + 1) % 40}` } } }));
  fake.seedBoard({ uid: "fp1", props: { plexus: { v: 2 } }, children: [...cards, { uid: "edges1", string: "Connections", props: { plexus: { type: "edges" } }, children: edges }] });
}

// Whether one card write made the board read its Connections again: the published Connections node is a new object.
async function cardWriteRereadsEdges(flags) {
  const f = setup({ flags, seedWith: seedRefs });
  await settle(f.fake);
  await f.fake.api.data.block.update({ block: { uid: "e1", string: "((c1)) → warm → ((c2))" } });
  await settle(f.fake);
  const before = find(f.trees.at(-1), "edges1");
  await f.fake.api.data.block.update({ block: { uid: "c3", props: { plexus: { type: "card", x: 999, y: 0, w: 200, h: 100 } } } });
  await settle(f.fake);
  const after = f.trees.at(-1);
  assert.equal(find(after, "c3")[":block/props"][":plexus"][":x"], 999, "the card write reached the board");
  return find(after, "edges1") !== before;
}

test("with the fingerprint on, a card write reads Connections again (Roam stamps the edges that cite the card)", async () => {
  assert.equal(await cardWriteRereadsEdges({ edgeFingerprint: true }), true);
});

test("edgeFingerprint is off by default: the Connections watch is EDGES_PATTERN and a card write leaves the edges alone", async () => {
  noteSpeedFlags(null);
  const fake = createFakeRoam({ echoDelay: 1, stamps: true, pullMany: true });
  fake.roamWatch = true;
  seedRefs(fake);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.pullBoard("fp1");
  host.watchBoard("fp1", () => {});
  await settle(fake);
  assert.deepEqual(fake.watchList().filter((w) => w.uid === "edges1").map((w) => w.pattern), [EDGES_PATTERN]);
  assert.equal(await cardWriteRereadsEdges({ edgeFingerprint: false }), false);
});
