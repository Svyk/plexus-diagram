// B1. A trusted open seeds badges and derived links from the stored model and does not
// ask Roam for them. The background check recomputes both. A stamp miss and an older
// store (no derived field) still take today's reads.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createHost } from "../src/host/roam.js";
import { createModelStore } from "../src/host/model-store.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { noteSpeedFlags } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeIDB } from "./fixtures/fake-idb.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { resetSharedBgBudget } from "../src/bg-budget.js";

afterEach(() => {
  resetSessions();
  resetSharedBgBudget();
  noteSpeedFlags(null);
});

const tick = (ms = 20) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await tick(20);
  }
}

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
  await until(() => store.stampOf("sb1") != null, 8000);
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

function pump(stub, n = 4) {
  for (let i = 0; i < n; i += 1) {
    stub.flushFrames();
    stub.flushTimers();
    stub.flushIdle();
  }
}

async function openLive(fake, idb) {
  const stub = createDomStub({ width: 800, height: 600 });
  const restore = stub.install();
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  const calls = watchCalls(host);
  await preread(host);
  const session = acquireSession("sb1", { host, settings: { get: () => undefined } });
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "3.34.0" });
  const opened = Date.now();
  stub.flushFrames();
  view.showAt({ x: 0, y: 0, zoom: 1 });
  pump(stub, 3);
  // Badge and settle timers are real setTimeouts. The check and the link job wait 1.5s.
  await tick(400);
  pump(stub, 2);
  // The corner card is last in the shell queue. Build it the way a click would.
  view.centerCard("c0_0");
  stub.flushFrames();
  return { stub, restore, host, store, session, view, calls, opened };
}

test("trusted hit: the live open paints stored badges and links and does not ask for cardStats or link rows", { timeout: 30000 }, async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  plant(idb, GHOST);
  // The check waits 1.5 s of budget time. A frozen clock never reaches it, so the open checks cannot lose a race to it.
  const realNow = globalThis.performance.now;
  globalThis.performance.now = () => 1_000_000;
  resetSharedBgBudget();
  const live = await openLive(fake, idb);
  try {
    assert.equal(live.host.stats.trustedOpens, 1);
    assert.equal(live.host.boardUnverified("sb1"), true, "the check has not replaced the stored derived data yet");
    assert.equal(live.calls.stats.length, 0, "refreshBadges must not call cardStats");
    assert.equal(live.calls.links.length, 0, "the initial refreshLinks must not run");
    assert.ok(live.session.links.some((l) => l.key === "c0_0->c2_0"), "the ghost link is on the board");
    const chips = live.stub.document.body.querySelectorAll(".pxd-badge-chip--refs");
    assert.ok([...chips].some((el) => el.textContent === "4 refs"), "the stored ref count is on the card");
  } finally {
    live.view.dispose();
    live.session.release?.();
    live.host.dispose();
    await live.store.dispose();
    live.restore();
    globalThis.performance.now = realNow;
    resetSharedBgBudget();
  }
});

test("the check after a trusted hit recomputes badges and links and rewrites the store", { timeout: 40000 }, async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  plant(idb, GHOST);
  const { host, store } = hostOver(fake, idb);
  await store.ready;
  const calls = watchCalls(host);
  await preread(host);
  const session = acquireSession("sb1", { host, settings: { get: () => undefined } });
  assert.equal(host.boardUnverified("sb1"), true);
  assert.equal(calls.stats.length, 0);
  await until(() => host.boardUnverified("sb1") === false);
  await until(() => {
    const derived = rowOf(idb)?.derived;
    return derived && !JSON.stringify(derived).includes("srcGhost");
  });
  assert.ok(calls.stats.length > 0, "the check calls cardStats");
  assert.ok(calls.links.length > 0, "the check calls linkRows");
  assert.equal(session.links.some((l) => l.key === "c0_0->c2_0"), false, "the ghost link is gone after the check");
  const text = JSON.stringify(rowOf(idb).derived);
  assert.equal(text.includes("srcGhost"), false);
  assert.ok(text.length < 180_000);
  session.release?.();
  host.dispose();
  await store.dispose();
});

test("stamp miss: today's badge and link reads still run", { timeout: 30000 }, async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  plant(idb, GHOST);
  await fake.api.data.block.update({ block: { uid: "c1_7", string: "edited while away" } });
  const live = await openLive(fake, idb);
  try {
    assert.notEqual(live.host.stats.trustedOpens, 1);
    await until(() => {
      live.stub.flushFrames();
      live.stub.flushIdle();
      return live.calls.stats.length > 0 && live.calls.links.length > 0;
    }, 8000);
    assert.ok(live.calls.stats.length > 0, "a miss still reads card stats");
    assert.ok(live.calls.links.length > 0, "a miss still reads links");
  } finally {
    live.view.dispose();
    live.session.release?.();
    live.host.dispose();
    await live.store.dispose();
    live.restore();
  }
});

test("an older store with no derived field falls back to cardStats and links and does not throw", { timeout: 30000 }, async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  plant(idb, undefined);
  assert.equal(rowOf(idb).derived, undefined);
  const live = await openLive(fake, idb);
  try {
    assert.equal(live.host.stats.trustedOpens, 1);
    await until(() => {
      live.stub.flushFrames();
      live.stub.flushIdle();
      return live.calls.stats.length > 0 && live.calls.links.length > 0;
    }, 8000);
    assert.ok(live.calls.stats.length > 0);
    assert.ok(live.calls.links.length > 0);
    assert.equal(live.session.links.some((l) => l.key === "c0_0->c2_0"), false);
  } finally {
    live.view.dispose();
    live.session.release?.();
    live.host.dispose();
    await live.store.dispose();
    live.restore();
  }
});

test("storedDerived off keeps today's reads even when the store has derived data", { timeout: 30000 }, async () => {
  const fake = createFakeRoam({ pullMany: true, stamps: true, echoDelay: 0 });
  seed(fake);
  const idb = await storedBoard(fake);
  plant(idb, GHOST);
  noteSpeedFlags({ storedDerived: false });
  const live = await openLive(fake, idb);
  try {
    assert.equal(live.host.stats.trustedOpens, 1);
    await until(() => {
      live.stub.flushFrames();
      live.stub.flushIdle();
      return live.calls.stats.length > 0 && live.calls.links.length > 0;
    }, 8000);
    assert.ok(live.calls.stats.length > 0);
    assert.ok(live.calls.links.length > 0);
  } finally {
    live.view.dispose();
    live.session.release?.();
    live.host.dispose();
    await live.store.dispose();
    live.restore();
  }
});

test("derived data stores counts and uid lists, not source strings, and stays under the cap", async () => {
  const { packDerived } = await import("../src/host/model-store.js");
  assert.equal(typeof packDerived, "function");
  const one = packDerived(
    new Map([["uid:c0_0", { refs: 4, boards: 1, open: 2, done: 3 }]]),
    [{ from: "c0_0", to: "c2_0", kind: "ref", labels: ["mentions"], sources: [{ uid: "ghost", string: "x".repeat(1_000_000) }], color: "gray" }],
  );
  const text = JSON.stringify(one);
  assert.ok(one);
  assert.ok(text.length < 180_000);
  assert.equal(text.includes("ghost"), true);
  assert.equal(text.includes("xxxx"), false);
  const badges = new Map();
  const links = [];
  for (let i = 0; i < 6000; i += 1) {
    badges.set(`uid:${"u".repeat(40)}${i}`, { refs: i, boards: 0, open: 0, done: 0 });
    links.push({
      from: `a${"b".repeat(40)}${i}`,
      to: `c${"d".repeat(40)}${i}`,
      kind: "ref",
      labels: ["mentions"],
      sources: [{ uid: `s${i}`, string: "y".repeat(5000) }],
    });
  }
  const huge = packDerived(badges, links);
  if (huge) assert.ok(JSON.stringify(huge).length <= 180_000);
  else assert.equal(huge, null);
  assert.equal(JSON.stringify(huge ?? {}).includes("yyyy"), false);
});
