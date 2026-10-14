// P9 units 2-3: a cold open of a big board mounts from its stored model when the page stamp is the stored one, and a
// background read verifies it; until then nothing destructive acts on the board.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createHost, BOARD_PATTERN } from "../src/host/roam.js";
import { createModelStore } from "../src/host/model-store.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeIDB } from "./fixtures/fake-idb.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

const tick = (ms = 5) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await tick(20);
  }
}

// 3 sections x 230 cards x (card, kid, grandchild) = 2,000+ blocks: a big board.
function seed(fake, n = 230) {
  const sections = [];
  for (let s = 0; s < 3; s += 1) {
    const cards = [];
    for (let i = 0; i < n; i += 1) {
      cards.push({ uid: `c${s}_${i}`, string: `card ${s}.${i}`, props: { plexus: { x: i * 10, y: s * 10, w: 100, h: 50 } }, children: [
        { uid: `k${s}_${i}`, string: `kid ${i}`, children: [{ uid: `g${s}_${i}`, string: `grand ${i}` }] },
      ] });
    }
    sections.push({ uid: `sec${s}`, string: `Section ${s}`, open: true, props: { plexus: { type: "section", x: 0, y: s * 500, w: 2000, h: 400 } }, children: cards });
  }
  fake.seedPage({ title: "Board page", uid: "bpage", children: [] });
  fake.seedBoard({ uid: "sb1", parent: "bpage", props: { plexus: { v: 2 } }, children: [
    ...sections,
    { uid: "conns", string: "Connections", props: { plexus: { type: "edges" } }, open: false, children: [{ uid: "e1", string: "((c0_0)) → ((c1_0))" }] },
  ] });
}

function hostOver(fake, idb) {
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.blockPageUid = (u) => (String(u).length ? "bpage" : "");
  const store = createModelStore({ indexedDB: idb, graph: "g" });
  host.useModelStore(store);
  return { host, store };
}

async function preread(host, uid = "sb1", opts = {}) {
  const reader = host.prereadBoard(uid, { sliceMs: 5, batch: 100, ...opts });
  assert.ok(reader);
  let steps = 0;
  for (;;) {
    if (reader.step()) break;
    if (reader.waiting) await reader.waiting;
    steps += 1;
    assert.ok(steps < 5000);
  }
  return reader;
}

const cardOf = (tree, uid) => tree[":block/children"].flatMap((s) => s[":block/children"] || []).find((c) => c[":block/uid"] === uid);

// A first open (sliced read) stores the model; returns the idb that holds it.
async function storedBoard(fake) {
  const idb = createFakeIDB();
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  await preread(host);
  host.pullBoard("sb1", { light: true });
  assert.equal(host.stats.slicedReads, 1);
  await until(() => store.stampOf("sb1") != null);
  host.dispose();
  await store.dispose();
  return idb;
}

test("trusted open: an unchanged page mounts from the stored model with no board read, then is verified", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  fake.pullLog = [];
  const reader = await preread(host);
  assert.equal(reader.trusted, true);
  const node = host.pullBoard("sb1", { light: true });
  assert.equal(node[":block/uid"], "sb1");
  assert.equal(host.stats.trustedOpens, 1);
  assert.ok(!host.stats.slicedReads);
  const boardReads = fake.pullLog.filter((p) => p.pattern === BOARD_PATTERN || /\{\(limit :block\/children nil\) \[:db\/id\]\}/.test(p.pattern));
  assert.equal(boardReads.length, 0, "no board read before live");
  assert.equal(host.boardUnverified("sb1"), true);
  const whole = fake.api.data.pull(BOARD_PATTERN, [":block/uid", "sb1"]);
  assert.equal(cardOf(node, "c2_5")[":block/string"], cardOf(whole, "c2_5")[":block/string"]);
  let verified = 0;
  host.onBoardVerified("sb1", () => { verified += 1; });
  const trees = [];
  const off = host.watchBoard("sb1", (tree) => trees.push(tree));
  await until(() => !host.boardUnverified("sb1"));
  assert.equal(verified, 1);
  assert.equal(host.stats.checks, 1);
  assert.ok(!host.stats.checkChanges, "nothing changed, nothing published");
  assert.equal(trees.length, 0);
  off();
  host.dispose();
  await store.dispose();
});

test("trusted open: a moved page stamp reads the board (sliced read), and the result is stored again", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  await fake.api.data.block.update({ block: { uid: "c1_7", string: "edited while away" } });
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  const before = store.stampOf("sb1");
  const reader = await preread(host);
  assert.notEqual(reader.trusted, true);
  const node = host.pullBoard("sb1", { light: true });
  assert.equal(host.stats.slicedReads, 1);
  assert.ok(!host.stats.trustedOpens);
  assert.equal(host.boardUnverified("sb1"), false);
  assert.equal(cardOf(node, "c1_7")[":block/string"], "edited while away");
  await until(() => store.stampOf("sb1") !== before);
  host.dispose();
  await store.dispose();
});

test("trusted open: a fold and an unstamped edit made while away are published by the check", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  // A fold does not move the stamp; an edit synced in from another device may not either.
  fake.quiet("sec1", { open: false });
  fake.quiet("k0_3", { string: "synced from elsewhere" });
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  const stamp0 = store.stampOf("sb1");
  await preread(host);
  const node = host.pullBoard("sb1", { light: true });
  assert.equal(host.stats.trustedOpens, 1);
  assert.equal(node[":block/children"].find((s) => s[":block/uid"] === "sec1")[":block/open"], true, "the stored fold until the check");
  const trees = [];
  const off = host.watchBoard("sb1", (tree) => trees.push(tree));
  await until(() => !host.boardUnverified("sb1"));
  await until(() => trees.length > 0);
  const last = trees[trees.length - 1];
  assert.equal(last[":block/children"].find((s) => s[":block/uid"] === "sec1")[":block/open"], false);
  assert.equal(cardOf(last, "c0_3")[":block/children"][0][":block/string"], "synced from elsewhere");
  assert.equal(host.stats.checkChanges, 1);
  // The corrected model is stored (same stamp, new tree).
  await until(() => (host.stats.modelsKept || 0) >= 1);
  await tick(50);
  const again = createModelStore({ indexedDB: idb, graph: "g" });
  await again.ready;
  assert.equal(again.stampOf("sb1"), stamp0);
  const { decodeTree } = await import("../src/host/model-store.js");
  const stored = decodeTree(await again.load("sb1"));
  assert.equal(stored[":block/children"].find((s) => s[":block/uid"] === "sec1")[":block/open"], false);
  off();
  host.dispose();
  await store.dispose();
  await again.dispose();
});

test("trusted open: a model that fails to load falls back to the sliced read; trust off never loads it", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  store.load = async () => null;
  const reader = await preread(host);
  assert.notEqual(reader.trusted, true);
  host.pullBoard("sb1", { light: true });
  assert.equal(host.stats.trustMisses, 1);
  assert.equal(host.stats.slicedReads, 1);
  host.dispose();
  const b = hostOver(fake, idb);
  await b.store.ready;
  let loads = 0;
  const realLoad = b.store.load;
  b.store.load = (...a) => { loads += 1; return realLoad(...a); };
  const r2 = await preread(b.host, "sb1", { trust: false });
  assert.notEqual(r2.trusted, true);
  b.host.pullBoard("sb1", { light: true });
  assert.equal(loads, 0);
  assert.ok(!b.host.stats.trustedOpens);
  b.host.dispose();
  await store.dispose();
  await b.store.dispose();
});

test("trusted open: a parked board's check waits for its resume", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  await preread(host);
  host.pullBoard("sb1", { light: true });
  const off = host.watchBoard("sb1", () => {});
  off.pause();
  await tick(2500);
  assert.equal(host.boardUnverified("sb1"), true, "no check while parked");
  off.resume();
  await until(() => !host.boardUnverified("sb1"));
  off();
  host.dispose();
  await store.dispose();
});

// The unverified window: an edge that vanished from what the board shows takes no dependent with it until the
// background read lands, and then only when Roam really lost it.
function openSession(unverified) {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c0", string: "c0", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } },
      { uid: "c1", string: "c1", props: { plexus: { x: 300, y: 0, w: 200, h: 100 } } },
      { uid: "E", string: "Connections", props: { plexus: { type: "edges" } }, children: [
        { uid: "e1", string: "[[c0]] → x → [[c1]]", props: { plexus: { type: "edge", from: "c0", to: "c1" } } },
        { uid: "e2", string: "[[e1]] → y → [[c1]]", props: { plexus: { type: "edge", from: "e1", to: "c1" } } },
      ] },
    ],
  });
  const real = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  const watchers = [];
  const listeners = [];
  const host = Object.create(real);
  host.watchBoard = (id, cb) => { watchers.push(cb); return real.watchBoard(id, cb); };
  host.boardUnverified = () => unverified.on;
  host.onBoardVerified = (_id, fn) => { listeners.push(fn); return () => {}; };
  const session = acquireSession("b1", { host, raf: (fn) => fn() });
  const verify = () => { unverified.on = false; for (const fn of listeners.splice(0)) fn(); };
  return { fake, real, session, watchers, restore, verify };
}
const deletes = (fake) => fake.log.filter((l) => l[0] === "delete");

test("unverified window: no dependent drop runs before the check; afterwards a real loss drops, a short read does not", async () => {
  const state = { on: true };
  const { fake, real, session, watchers, restore, verify } = openSession(state);
  try {
    await fake.api.data.block.delete({ block: { uid: "e1" } });
    const tree = real.pullBoard("b1", { light: true });
    for (const cb of watchers) cb(tree);
    await tick(20); await tick(20);
    assert.deepEqual(deletes(fake).filter((l) => l[1] === "e2"), [], "nothing deleted while unverified");
    assert.ok(fake.block("e2"));
    assert.ok(session.board.edges.has("e2"));
    verify();
    await tick(20); await tick(20);
    assert.deepEqual(deletes(fake).map((l) => l[1]).filter((u) => u === "e2"), ["e2"], "judged again on the fresh board");
  } finally { restore(); }
  resetSessions();
  const state2 = { on: true };
  const s2 = openSession(state2);
  try {
    const full = s2.real.pullBoard("b1", { light: true });
    const short = JSON.parse(JSON.stringify(full));
    for (const kid of short[":block/children"]) if (kid[":block/uid"] === "E") kid[":block/children"] = kid[":block/children"].filter((e) => e[":block/uid"] !== "e1");
    for (const cb of s2.watchers) cb(short);
    await tick(20);
    s2.verify();
    await tick(20); await tick(20);
    assert.deepEqual(deletes(s2.fake), [], "e1 is still in Roam: nothing deleted");
    assert.ok(s2.fake.block("e2"));
  } finally { s2.restore(); }
});

test("adopt step: a big board's preread takes its tree in (split held) so the acquire reads nothing; a change in between publishes on attach", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const { host, store } = hostOver(fake, createFakeIDB());
  await store.ready;
  const reader = host.prereadBoard("sb1", { sliceMs: 5, batch: 100 });
  const phases = new Set();
  while (!reader.step()) phases.add(reader.phase);
  assert.ok(phases.has("adopt"), [...phases].join(","));
  assert.ok(fake.watchCount() > 0, "the split watches from the adopt step on");
  await fake.api.data.block.update({ block: { uid: "sec2", string: "Section 2 renamed in between" } });
  await tick(150);
  fake.pullLog = [];
  const node = host.pullBoard("sb1", { light: true });
  assert.equal(node[":block/uid"], "sb1");
  assert.equal(host.stats.slicedReads, 1);
  assert.equal(fake.pullLog.length, 0, `no read in the acquire: ${JSON.stringify(fake.pullLog.slice(0, 3))}`);
  const trees = [];
  const off = host.watchBoard("sb1", (tree) => trees.push(tree));
  await until(() => trees.length > 0);
  assert.equal(trees[0][":block/children"].find((s) => s[":block/uid"] === "sec2")[":block/string"], "Section 2 renamed in between");
  off();
  host.dispose();
  await store.dispose();
});

test("cover warm: a preread for a board whose snapshot shows many PDF covers reads the cover index in two tasks before live", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake, 10);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.blockPageUid = () => "bpage";
  const route = fake.onQuery(/:pdf\/url/, () => []);
  const pdfQueries = route.calls;
  const reader = host.prereadBoard("sb1", { sliceMs: 1000, batch: 1000, covers: 20 });
  const counts = [];
  while (!reader.step()) counts.push(pdfQueries.length);
  assert.ok(reader.phase === "covers");
  assert.ok(pdfQueries.length >= 2, `index read: ${pdfQueries.length}`);
  // One query per task.
  for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i] - counts[i - 1] <= 1);
  const plain = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  plain.blockPageUid = () => "bpage";
  pdfQueries.length = 0;
  const r2 = plain.prereadBoard("sb1", { sliceMs: 1000, batch: 1000, covers: 3 });
  while (!r2.step()) { /* finish */ }
  assert.equal(pdfQueries.length, 0, "few covers: no index read");
});

test("cover warm: a big board that needed the cover index in a first frame warms it on its next cold open (kept across reloads)", async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const route = fake.onQuery(/:pdf\/url/, () => []);
  const a = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  a.blockPageUid = () => "bpage";
  await preread(a);
  a.pullBoard("sb1", { light: true });
  const off = a.watchBoard("sb1", () => {});
  for (let i = 0; i < 16; i += 1) a.pdfCover(`{{[[pdf]]: https://example.com/f${i}.pdf}}`);
  assert.ok(route.calls.length >= 2, "first frame read the index");
  off();
  a.dispose();
  const b = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  b.blockPageUid = () => "bpage";
  route.calls.length = 0;
  await preread(b);
  assert.equal(route.calls.length, 2, "read before live");
  b.dispose();
});
