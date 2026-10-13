import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { SPLIT_WATCH_MIN } from "../src/host/split-watch.js";

// Two ways a nested board lost blocks under the split watch (found by the Grok verifiers, 2026-10-12):
// 1. watchItem stored a board card's THUMB-depth children as its whole subtree, so the assembled tree (and the warm
//    cache that pullBoard(nestedUid) serves) shrank from 201 to 81 blocks after one edit inside it. A later cut or
//    duplicate of that nested board would have lost the deep blocks.
// 2. pullBoard served a warm nested board from the cache before the size check, so a 2,000+ block nested board
//    absorbed from its parent got one recursive watch instead of the split.

const SECTIONS = 16;
const CARDS = 70;
const size = (n) => 1 + (n?.[":block/children"] || []).reduce((a, k) => a + size(k), 0);
const find = (n, uid) => {
  if (!n) return null;
  if (n[":block/uid"] === uid) return n;
  for (const k of n[":block/children"] || []) { const hit = find(k, uid); if (hit) return hit; }
  return null;
};

function seedBig(fake) {
  const children = [];
  for (let s = 0; s < SECTIONS; s += 1) {
    const kids = [];
    for (let c = 0; c < CARDS; c += 1) kids.push({ uid: `c${s}x${c}`, string: `card ${s}.${c}`, props: { plexus: { type: "card", x: c * 10, y: 0, w: 200, h: 100 } }, children: [{ uid: `k${s}x${c}`, string: `kid ${s}.${c}` }] });
    children.push({ uid: `s${s}`, string: `Section ${s}`, props: { plexus: { type: "section", x: 0, y: s * 1000, w: 900, h: 800 } }, children: kids });
  }
  const deep = (d, i) => ({ uid: `n${d}x${i}`, string: `nested ${d}.${i}`, children: d < 4 ? [deep(d + 1, i)] : [] });
  children.push({ uid: "nest1", string: "{{[[diagram]]:Inner}}", props: { plexus: { type: "card", x: 0, y: -400, w: 300, h: 200, v: 2 } }, children: Array.from({ length: 40 }, (_, i) => deep(0, i)) });
  fake.seedBoard({ uid: "big1", props: { plexus: { v: 2 } }, children });
}

test("a nested board keeps its deep blocks after an edit at thumbnail depth while its card is mounted", async () => {
  const fake = createFakeRoam({ echoDelay: 1 });
  fake.roamWatch = true;
  seedBig(fake);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const full = host.pullBoard("big1");
  assert.equal(size(find(full, "nest1")), 201);
  const trees = [];
  host.watchBoard("big1", (t) => trees.push(t));
  host.watchContent("nest1");
  await fake.flush();
  await fake.api.data.block.update({ block: { uid: "n1x1", string: "member edit" } });
  await fake.flush();
  const tree = trees.at(-1);
  assert.equal(find(tree, "n1x1")[":block/string"], "member edit");
  assert.equal(size(find(tree, "nest1")), 201, "the assembled tree keeps the nested board whole");
  assert.ok(find(tree, "n4x39"), "the deepest block is still there");
  const served = host.pullBoard("nest1", { light: true });
  assert.equal(size(served), 201, "the warm read of the nested board is whole");
  // A nested board card that joins the board later is read whole too.
  await fake.api.data.block.create({ location: { "parent-uid": "big1", order: "last" }, block: { uid: "nest2", string: "{{[[diagram]]:Late}}", props: { plexus: { type: "card", x: 0, y: -800, w: 300, h: 200, v: 2 } } } });
  await fake.api.data.block.create({ location: { "parent-uid": "nest2", order: "last" }, block: { uid: "late0", string: "l0" } });
  await fake.api.data.block.create({ location: { "parent-uid": "late0", order: "last" }, block: { uid: "late1", string: "l1" } });
  await fake.api.data.block.create({ location: { "parent-uid": "late1", order: "last" }, block: { uid: "late2", string: "l2" } });
  await fake.api.data.block.create({ location: { "parent-uid": "late2", order: "last" }, block: { uid: "late3", string: "l3" } });
  await fake.flush();
  assert.ok(find(trees.at(-1), "late3"), "a late nested board is read to its full depth");
});

test("a warm nested board over SPLIT_WATCH_MIN blocks gets the split watch, not a recursive one", () => {
  const fake = createFakeRoam();
  const card = (id, i) => ({ uid: id, string: `c${i}`, props: { plexus: { x: i, y: 0, w: 100, h: 50 } } });
  const nestedKids = Array.from({ length: SPLIT_WATCH_MIN + 200 }, (_, i) => card(`n${i}`, i));
  fake.seedBoard({ uid: "parent01", props: { plexus: { v: 2 } }, children: [{ uid: "nested01", string: "{{[[diagram]]}}", props: { plexus: { v: 2, x: 0, y: 0, w: 300, h: 200 } }, children: nestedKids }] });
  const patterns = [];
  const add = fake.api.data.addPullWatch.bind(fake.api.data);
  fake.api.data.addPullWatch = (pattern, entity, cb) => { patterns.push({ entity: String(entity), rec: String(pattern).includes("...") }); return add(pattern, entity, cb); };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.pullBoard("parent01", { light: true });
  const t = host.pullBoard("nested01", { light: true });
  assert.equal(t[":block/children"].length, SPLIT_WATCH_MIN + 200);
  const off = host.watchBoard("nested01", () => {});
  const own = patterns.filter((p) => p.entity.includes("nested01"));
  assert.equal(own.length, 1);
  assert.equal(own[0].rec, false, "no recursive watch on a big nested board");
  assert.ok(host.splitStats("nested01"), "the nested board has a split watch");
  off();
});
