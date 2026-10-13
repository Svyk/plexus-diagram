// Roam counts addPullWatch/removePullWatch toward its 1,500 per minute limiter, the same one that refuses openPage
// and block writes. On PhD MAIN every page return added ~124 watches and every nested enter or crumb removed and added
// ~240 (live, 2026-10-13); a 20-minute soak hit "maximum mutation rate limit exceeded" 9 times. A parked big board now
// keeps its split watch registered and quiet, so after the first visit a park and its return cost no watch calls.
import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { SPLIT_HOLD_MS, WATCH_ARM_LOW, WATCH_ARM_RETRY_MS, createHost, createWritePacer } from "../src/host/roam.js";
import { SPLIT_WATCH_MIN } from "../src/host/split-watch.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const SECTIONS = 20;
const CARDS = 60;
function seedBoard(fake, uid, prefix, nested) {
  const children = [];
  for (let s = 0; s < SECTIONS; s += 1) {
    const kids = [];
    for (let c = 0; c < CARDS; c += 1) kids.push({ uid: `${prefix}c${s}x${c}`, string: `card ${s}.${c}`, props: { plexus: { type: "card", x: c * 10, y: 0, w: 200, h: 100 } }, children: [{ uid: `${prefix}k${s}x${c}`, string: "kid" }] });
    children.push({ uid: `${prefix}s${s}`, string: `Section ${s}`, props: { plexus: { type: "section", x: 0, y: s * 1000, w: 900, h: 800 } }, children: kids });
  }
  const edges = Array.from({ length: 300 }, (_, i) => ({ uid: `${prefix}e${i}`, string: `((${prefix}c0x${i % CARDS})) → x → ((${prefix}c1x${i % CARDS}))`, props: { plexus: { type: "edge", from: `${prefix}c0x${i % CARDS}`, to: `${prefix}c1x${i % CARDS}` } } }));
  children.push({ uid: `${prefix}E`, string: "Connections", props: { plexus: { type: "edges" } }, children: edges });
  if (nested) children.push(nested);
  return { uid, props: { plexus: { v: 2 } }, children };
}

function setup() {
  const fake = createFakeRoam({ echoDelay: 1 });
  fake.roamWatch = true;
  const inner = seedBoard(fake, "nest", "n");
  const nestedCard = { uid: "nest", string: "{{[[diagram]]:Inner}}", props: { plexus: { type: "card", x: 0, y: -400, w: 300, h: 200, v: 2 } }, children: inner.children };
  fake.seedBoard(seedBoard(fake, "main", "m", nestedCard));
  let calls = 0;
  const add = fake.api.data.addPullWatch.bind(fake.api.data);
  const remove = fake.api.data.removePullWatch.bind(fake.api.data);
  fake.api.data.addPullWatch = (...a) => { calls += 1; return add(...a); };
  fake.api.data.removePullWatch = (...a) => { calls += 1; return remove(...a); };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host, calls: () => calls };
}

// The view's mounted cards hold content watches while it is parked (the DOM stays).
const mountCards = (host, prefix) => Array.from({ length: 40 }, (_, i) => host.watchContent(`${prefix}c${i % SECTIONS}x${i}`));

test("20 page-return and nested enter/crumb cycles stay under 300 watch calls after the first visit", async () => {
  const { fake, host, calls } = setup();
  const sizeOf = (n) => 1 + (n?.[":block/children"] || []).reduce((a, k) => a + sizeOf(k), 0);
  assert.ok(sizeOf(host.pullBoard("main")) >= SPLIT_WATCH_MIN);
  const main = acquireSession("main", { host, linkDelay: 0 });
  mountCards(host, "m");
  await fake.flush();
  let nested = null;
  const cycle = async () => {
    // Page leave and return: the keep-alive pool pauses MAIN; the crumb pool (the nested board) is dropped.
    main.pauseWatches();
    if (nested) { nested.release({ paused: true }); nested = null; }
    await fake.flush();
    main.resumeWatches();
    await fake.flush();
    // Nested enter: MAIN parks in the crumb pool, the nested board opens (once) or comes back from the pool.
    main.pauseWatches();
    assert.ok(sizeOf(host.pullBoard("nest")) >= SPLIT_WATCH_MIN);
    nested = acquireSession("nest", { host, linkDelay: 0 });
    mountCards(host, "n");
    await fake.flush();
    // Crumb back to MAIN.
    nested.pauseWatches();
    main.resumeWatches();
    await fake.flush();
  };
  await cycle();
  const first = calls();
  for (let i = 0; i < 20; i += 1) await cycle();
  const after = calls() - first;
  assert.ok(after <= 20, `20 cycles made ${after} watch calls`);
  console.log(`# watch calls: first cycle ${first}, next 20 cycles ${after}`);
});

test("a held board publishes once on resume when it changed while parked, and not at all when it did not", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  const trees = [];
  const off = host.watchBoard("main", (t) => trees.push(t));
  await fake.flush();
  off.pause();
  await fake.api.data.block.update({ block: { uid: "mc3x3", string: "edited while parked" } });
  await fake.api.data.block.update({ block: { uid: "ms2", string: "Renamed section" } });
  await fake.flush();
  assert.equal(trees.length, 0, "nothing publishes while parked");
  off.resume();
  await fake.flush();
  assert.equal(trees.length, 1, "one catch-up");
  const find = (n, uid) => (n?.[":block/uid"] === uid ? n : (n?.[":block/children"] || []).map((k) => find(k, uid)).find(Boolean) || null);
  assert.equal(find(trees[0], "ms2")[":block/string"], "Renamed section");
  assert.equal(find(trees[0], "mc3x3")[":block/string"], "edited while parked");
  off.pause();
  await fake.flush();
  off.resume();
  await fake.flush();
  assert.equal(trees.length, 1, "an unchanged board does not publish again");
  off();
});

test("a held card content change is read on resume", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  const trees = [];
  const off = host.watchBoard("main", (t) => trees.push(t));
  host.watchContent("mc1x1");
  await fake.flush();
  off.pause();
  await fake.api.data.block.update({ block: { uid: "mk1x1", string: "kid edited while parked" } });
  await fake.flush();
  off.resume();
  await fake.flush();
  const find = (n, uid) => (n?.[":block/uid"] === uid ? n : (n?.[":block/children"] || []).map((k) => find(k, uid)).find(Boolean) || null);
  assert.equal(find(trees.at(-1), "mk1x1")[":block/string"], "kid edited while parked");
  off();
});

test("a session that parks a big board and comes back sees an edit made meanwhile", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  const main = acquireSession("main", { host, linkDelay: 0 });
  await fake.flush();
  main.pauseWatches();
  await fake.api.data.block.update({ block: { uid: "ms4", string: "Section renamed elsewhere" } });
  await fake.flush();
  main.resumeWatches();
  await fake.flush();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(main.board.items.get("ms4")?.string, "Section renamed elsewhere");
});

test("the final release of a parked board removes its watches after the linger", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { host, fake } = setup();
    host.pullBoard("main");
    const main = acquireSession("main", { host, linkDelay: 0 });
    assert.ok(fake.watchList().length > 20);
    main.pauseWatches();
    assert.ok(fake.watchList().length > 20, "parked: still registered");
    main.release({ paused: true });
    assert.ok(fake.watchList().length > 20, "lingering");
    mock.timers.tick(SPLIT_HOLD_MS);
    assert.equal(fake.watchList().length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("a board opened again inside the linger reuses its watches and sees an edit made meanwhile", async () => {
  const { fake, host, calls } = setup();
  host.pullBoard("nest");
  let s = acquireSession("nest", { host, linkDelay: 0 });
  await fake.flush();
  s.release();
  const before = calls();
  await fake.api.data.block.update({ block: { uid: "ns3", string: "Renamed while closed" } });
  await fake.flush();
  host.pullBoard("nest");
  s = acquireSession("nest", { host, linkDelay: 0 });
  await fake.flush();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls(), before, "no watch calls");
  assert.equal(s.board.items.get("ns3")?.string, "Renamed while closed");
  s.release();
});

test("watch calls spend the write pacer's budget", async () => {
  let t = 0;
  const waits = [];
  const pacer = createWritePacer({ now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, burst: 5, cap: 10 });
  for (let i = 0; i < 10; i += 1) pacer.note();
  assert.equal(pacer.recent, 10);
  await pacer.pace();
  assert.equal(waits[0], 60000, "a full window makes the next write wait");
});

test("with the minute budget low a card's content watch waits, and arms once the budget recovers", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    const { fake, host, calls } = setup();
    host.pullBoard("main");
    host.watchBoard("main", () => {});
    for (let i = 0; i < WATCH_ARM_LOW; i += 1) host.watchBlock(`blk${i}`, () => {});
    const before = calls();
    host.watchContent("mc1x1");
    assert.equal(calls(), before, "no watch while the budget is low");
    assert.equal(fake.watchList().some((w) => w.uid === "mc1x1"), false);
    mock.timers.tick(WATCH_ARM_RETRY_MS);
    assert.equal(fake.watchList().some((w) => w.uid === "mc1x1"), false, "still low after 5 s");
    mock.timers.tick(60000);
    assert.equal(fake.watchList().some((w) => w.uid === "mc1x1"), true, "armed once the minute passed");
  } finally {
    mock.timers.reset();
  }
});

test("a board parked past SPLIT_HOLD_MS drops its watches; resume builds the split again and reads it once", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  const trees = [];
  const off = host.watchBoard("main", (t) => trees.push(t));
  await fake.flush();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    off.pause();
    assert.ok(fake.watchList().length > 20, "held");
    mock.timers.tick(SPLIT_HOLD_MS);
    assert.equal(fake.watchList().length, 0, "the hold expired");
  } finally {
    mock.timers.reset();
  }
  await fake.api.data.block.update({ block: { uid: "ms7", string: "Renamed after the hold" } });
  await fake.flush();
  off.resume();
  await fake.flush();
  assert.ok(fake.watchList().length > 20, "watched again");
  const find = (n, uid) => (n?.[":block/uid"] === uid ? n : (n?.[":block/children"] || []).map((k) => find(k, uid)).find(Boolean) || null);
  assert.equal(find(trees.at(-1), "ms7")[":block/string"], "Renamed after the hold");
  off();
});

test("a card that unmounts and mounts again reuses its content watch", async () => {
  const { fake, host, calls } = setup();
  host.pullBoard("main");
  const off = host.watchBoard("main", () => {});
  let offs = mountCards(host, "m");
  await fake.flush();
  const before = calls();
  for (let i = 0; i < 5; i += 1) {
    offs.forEach((f) => f());
    offs = mountCards(host, "m");
  }
  assert.equal(calls(), before);
  off();
});
