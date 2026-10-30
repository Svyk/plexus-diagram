// PXD-1: the check after a trusted hit refreshes the stored derived data in background parts (speed flag slicedDerived).
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createHost } from "../src/host/roam.js";
import { createModelStore } from "../src/host/model-store.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { noteSpeedFlags } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeIDB } from "./fixtures/fake-idb.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { resetSharedBgBudget } from "../src/bg-budget.js";
import { installOwnClock, tick, untilTurns } from "./fixtures/own-clock.js";

// Every test runs on the owned clock: the background check waits for virtual time, which each wait turn supplies.
let own = null;
beforeEach(() => {
  own = installOwnClock();
  resetSharedBgBudget();
});
afterEach(() => {
  resetSessions();
  resetSharedBgBudget();
  noteSpeedFlags(null);
  own?.restore();
  own = null;
});

const until = (fn, turns) => untilTurns(own, fn, turns);

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

async function preread(host) {
  const reader = host.prereadBoard("sb1", { sliceMs: 8, batch: 200 });
  assert.ok(reader);
  let steps = 0;
  for (;;) {
    if (reader.waiting) await reader.waiting;
    if (reader.step()) break;
    steps += 1;
    assert.ok(steps < 8000);
  }
  return reader;
}

async function storedBoard(fake) {
  const idb = createFakeIDB();
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  await preread(host);
  host.pullBoard("sb1", { light: true });
  await until(() => store.stampOf("sb1") != null);
  host.dispose();
  await store.dispose();
  return idb;
}

const MODEL_KEY = "model\u0000g\u0000sb1";
function rowOf(idb) {
  const rec = idb.dbs.get("plexus-diagram-snapshots");
  const boards = rec?.stores?.get("boards");
  return boards?.get(MODEL_KEY) || null;
}

// Counts and uid lists only. A page badge is ["p", title, ...]; a block badge is ["u", uid, ...].
const GHOST = {
  v: 1,
  b: [["u", "c0_0", 4, 0, 0, 0]],
  l: [["c0_0", "c2_0", 0, ["srcGhost"]]],
};

function plant(idb, derived) {
  const row = rowOf(idb);
  assert.ok(row && row.parts, "stored model row");
  if (derived === undefined) delete row.derived;
  else row.derived = derived;
}

function watchCalls(host) {
  const stats = [];
  const links = [];
  const cardStatsJob = host.cardStatsJob.bind(host);
  const linkRows = host.linkRows.bind(host);
  // The board view's refreshBadges calls cardStatsJob. cardStats() uses the same job.
  host.cardStatsJob = (...args) => { stats.push(args); return cardStatsJob(...args); };
  host.linkRows = (...args) => { links.push(args); return linkRows(...args); };
  return { stats, links };
}




function watchStats(host) {
  const calls = [];
  const cardStats = host.cardStats.bind(host);
  host.cardStats = (targets, ...rest) => {
    calls.push({ n: Array.isArray(targets) ? targets.length : -1, unverified: host.boardUnverified("sb1") });
    return cardStats(targets, ...rest);
  };
  return calls;
}

async function checked(flags) {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  plant(idb, GHOST);
  if (flags) noteSpeedFlags(flags);
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  const calls = watchStats(host);
  await preread(host);
  const session = acquireSession("sb1", { host, settings: { get: () => undefined } });
  assert.equal(host.boardUnverified("sb1"), true);
  await until(() => host.boardUnverified("sb1") === false);
  await until(() => {
    const derived = rowOf(idb)?.derived;
    return derived && !JSON.stringify(derived).includes("srcGhost");
  });
  return { host, store, idb, session, calls };
}

test("slicedDerived on: an unchanged board's check refreshes badges in parts of at most 20 and verifies at the end", { timeout: 60000 }, async () => {
  const { host, store, idb, session, calls } = await checked(null);
  assert.ok(calls.length > 3, `cardStats ran in several parts, got ${calls.length}`);
  for (const c of calls) assert.ok(c.n >= 1 && c.n <= 20, `part of ${c.n} targets`);
  assert.ok(calls.every((c) => c.unverified === true), "the board stays unverified until the last part ran");
  assert.equal(host.boardUnverified("sb1"), false);
  assert.equal(session.links.some((l) => l.key === "c0_0->c2_0"), false, "the ghost link is gone");
  assert.equal(JSON.stringify(rowOf(idb).derived).includes("srcGhost"), false);
  session.release?.();
  host.dispose();
  await store.dispose();
});

test("slicedDerived off: the check recomputes in the check callback and still verifies", { timeout: 60000 }, async () => {
  const { host, store, idb, session, calls } = await checked({ slicedDerived: false });
  assert.ok(calls.length > 0, "the old path still reads card stats");
  assert.equal(host.boardUnverified("sb1"), false);
  assert.equal(session.links.some((l) => l.key === "c0_0->c2_0"), false, "the ghost link is gone");
  assert.equal(JSON.stringify(rowOf(idb).derived).includes("srcGhost"), false);
  session.release?.();
  host.dispose();
  await store.dispose();
});

test("dispose during the sliced refresh cancels it: the board is never verified", { timeout: 60000 }, async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  plant(idb, GHOST);
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  const calls = watchStats(host);
  await preread(host);
  const session = acquireSession("sb1", { host, settings: { get: () => undefined } });
  await until(() => calls.length > 0);
  host.dispose();
  const seen = calls.length;
  await tick(300);
  assert.equal(calls.length, seen, "no part runs after dispose");
  assert.equal(host.boardUnverified("sb1"), true);
  session.release?.();
  await store.dispose();
});
