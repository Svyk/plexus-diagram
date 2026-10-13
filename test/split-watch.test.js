import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { SPLIT_HOLD_MS, createHost } from "../src/host/roam.js";
import { ITEM_IDLE_MS, SPLIT_WATCH_MIN, sameKids } from "../src/host/split-watch.js";

const SECTIONS = 16;
const CARDS = 70;
// A board over SPLIT_WATCH_MIN blocks: sections of cards with one child each, a nested board with a deep subtree,
// and a Connections block.
function seedBig(fake) {
  const children = [];
  for (let s = 0; s < SECTIONS; s += 1) {
    const kids = [];
    for (let c = 0; c < CARDS; c += 1) {
      kids.push({ uid: `c${s}x${c}`, string: `card ${s}.${c}`, props: { plexus: { type: "card", x: c * 10, y: 0, w: 200, h: 100 } }, children: [{ uid: `k${s}x${c}`, string: `kid ${s}.${c}` }] });
    }
    children.push({ uid: `s${s}`, string: `Section ${s}`, props: { plexus: { type: "section", x: 0, y: s * 1000, w: 900, h: 800 } }, children: kids });
  }
  const deep = (d, i) => ({ uid: `n${d}x${i}`, string: `nested ${d}.${i}`, children: d < 4 ? [deep(d + 1, i)] : [] });
  children.push({ uid: "nest1", string: "{{[[diagram]]:Inner}}", props: { plexus: { type: "card", x: 0, y: -400, w: 300, h: 200, v: 2 } }, children: Array.from({ length: 40 }, (_, i) => deep(0, i)) });
  children.push({ uid: "edges1", string: "Connections", props: { plexus: { type: "edges" } }, children: Array.from({ length: 30 }, (_, i) => ({ uid: `e${i}`, string: "[[a]] → x → [[b]]", props: { plexus: { type: "edge", from: `c0x${i}`, to: `c1x${i}` } } })) });
  fake.seedBoard({ uid: "big1", props: { plexus: { v: 2 } }, children });
}

const size = (n) => 1 + (n?.[":block/children"] || []).reduce((a, k) => a + size(k), 0);
const find = (n, uid) => {
  if (!n) return null;
  if (n[":block/uid"] === uid) return n;
  for (const k of n[":block/children"] || []) { const hit = find(k, uid); if (hit) return hit; }
  return null;
};

function setup() {
  const fake = createFakeRoam({ echoDelay: 1 });
  fake.roamWatch = true;
  seedBig(fake);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const full = host.pullBoard("big1");
  const trees = [];
  const off = host.watchBoard("big1", (t) => trees.push(t));
  return { fake, host, full, trees, off };
}

test("a big board's watch re-pulls its structure, not every card's contents, on each write", async () => {
  const { fake, full, trees } = setup();
  const total = size(full);
  assert.ok(total >= SPLIT_WATCH_MIN, `fixture has ${total} blocks`);
  fake.pullCounter = { n: 0 };
  await fake.api.data.block.update({ block: { uid: "c3x5", string: "card edited" } });
  await fake.flush();
  assert.equal(fake.watchRuns, 1);
  assert.ok(fake.pullCounter.n < total * 0.5, `one write re-pulled ${fake.pullCounter.n} of ${total} blocks`);
  assert.equal(trees.length, 1);
  const tree = trees[0];
  assert.equal(find(tree, "c3x5")[":block/string"], "card edited");
  // The tree still carries every card's contents, the nested board's subtree and the connections.
  assert.equal(find(tree, "k7x9")[":block/string"], "kid 7.9");
  assert.equal(find(tree, "n4x39")[":block/string"], "nested 4.39");
  assert.equal(find(tree, "edges1")[":block/children"].length, 30);
  assert.equal(size(tree), total);
});

test("a mounted card's contents stay live; an unmounted card's contents refresh when it mounts", async () => {
  const { fake, host, trees } = setup();
  await fake.api.data.block.update({ block: { uid: "k2x2", string: "changed off screen" } });
  await fake.flush();
  assert.equal(trees.length, 0);
  const off = host.watchContent("c2x2");
  await fake.flush();
  assert.equal(trees.length, 1);
  assert.equal(find(trees.at(-1), "k2x2")[":block/string"], "changed off screen");
  await fake.api.data.block.update({ block: { uid: "k2x2", string: "changed on screen" } });
  await fake.flush();
  assert.equal(trees.length, 2);
  assert.equal(find(trees.at(-1), "k2x2")[":block/string"], "changed on screen");
  // Unmounted, the watch idles (a card that mounts again costs no watch calls), then goes.
  const watched = () => fake.watchList().some((w) => w.uid === "c2x2");
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  try {
    off();
    assert.equal(watched(), true, "idle");
    assert.equal(host.splitStats("big1").idleItemWatches, 1);
    mock.timers.tick(ITEM_IDLE_MS * 2);
    assert.equal(watched(), false, "dropped after ITEM_IDLE_MS");
  } finally {
    mock.timers.reset();
  }
  await fake.api.data.block.update({ block: { uid: "k2x2", string: "after unmount" } });
  await fake.flush();
  assert.equal(trees.length, 2);
});

test("a nested board's thumbnail watch stops two levels below the card", async () => {
  const { fake, host, trees } = setup();
  host.watchContent("nest1");
  await fake.flush();
  const before = trees.length;
  await fake.api.data.block.update({ block: { uid: "n3x1", string: "deep edit" } });
  await fake.flush();
  assert.equal(trees.length, before);
  await fake.api.data.block.update({ block: { uid: "n1x1", string: "member edit" } });
  await fake.flush();
  assert.equal(trees.length, before + 1);
  assert.equal(find(trees.at(-1), "n1x1")[":block/string"], "member edit");
});

test("a new section and its cards join the watch; a deleted section leaves it", async () => {
  const { fake, trees } = setup();
  await fake.api.data.block.create({ location: { "parent-uid": "big1", order: "last" }, block: { uid: "sNew", string: "New", props: { plexus: { type: "section", x: 0, y: 0, w: 10, h: 10 } } } });
  await fake.api.data.block.create({ location: { "parent-uid": "sNew", order: "last" }, block: { uid: "cNew", string: "fresh", props: { plexus: { type: "card", x: 0, y: 0, w: 10, h: 10 } } } });
  await fake.flush();
  assert.equal(find(trees.at(-1), "cNew")[":block/string"], "fresh");
  await fake.api.data.block.update({ block: { uid: "cNew", string: "fresh edit" } });
  await fake.flush();
  assert.equal(find(trees.at(-1), "cNew")[":block/string"], "fresh edit");
  const watches = fake.watchCount();
  await fake.api.data.block.delete({ block: { uid: "s4" } });
  await fake.flush();
  assert.equal(find(trees.at(-1), "s4"), null);
  assert.equal(fake.watchCount(), watches - 1);
});

test("moving a card between sections keeps its contents", async () => {
  const { fake, trees } = setup();
  await fake.api.data.block.move({ location: { "parent-uid": "s1", order: 0 }, block: { uid: "c0x3" } });
  await fake.flush();
  const tree = trees.at(-1);
  assert.equal(find(find(tree, "s1"), "c0x3")?.[":block/uid"], "c0x3");
  assert.equal(find(find(tree, "s0"), "c0x3"), null);
  assert.equal(find(tree, "k0x3")[":block/string"], "kid 0.3");
});

test("releasing the last board watch removes every Roam watch it added", async () => {
  const { fake, host, off } = setup();
  host.watchContent("c1x1");
  assert.ok(fake.watchCount() > SECTIONS);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    off();
    assert.ok(fake.watchCount() > SECTIONS, "the split lingers, held");
    mock.timers.tick(SPLIT_HOLD_MS);
    assert.equal(fake.watchCount(), 0);
  } finally {
    mock.timers.reset();
  }
});

test("a small board keeps its one recursive watch", () => {
  const fake = createFakeRoam({ echoDelay: 1 });
  fake.roamWatch = true;
  fake.seedBoard({ uid: "small1", props: { plexus: { v: 2 } }, children: [{ uid: "a1", string: "a", props: { plexus: { type: "card", x: 0, y: 0, w: 1, h: 1 } } }] });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.pullBoard("small1");
  host.watchBoard("small1", () => {});
  assert.equal(fake.watchCount(), 1);
  assert.equal(host.splitStats("small1"), null);
});

test("sameKids compares text, order and props to the given depth", () => {
  const a = [{ ":block/uid": "x", ":block/string": "1", ":block/children": [{ ":block/uid": "y", ":block/string": "2" }] }];
  const b = [{ ":block/uid": "x", ":block/string": "1", ":block/children": [{ ":block/uid": "y", ":block/string": "3" }] }];
  assert.equal(sameKids(a, b, 1), true);
  assert.equal(sameKids(a, b), false);
});

test("an undo's repull of a big board reads its containers, not the whole tree", async () => {
  const { fake, host, full } = setup();
  const total = size(full);
  await fake.api.data.block.update({ block: { uid: "c5x5", string: "after undo" } });
  fake.pullCounter = { n: 0 };
  const tree = host.pullBoard("big1", { light: true });
  assert.equal(find(tree, "c5x5")[":block/string"], "after undo");
  assert.equal(find(tree, "k5x5")[":block/string"], "kid 5.5");
  assert.ok(fake.pullCounter.n < total * 0.5, `repull read ${fake.pullCounter.n} of ${total} blocks`);
});
