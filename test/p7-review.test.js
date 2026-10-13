import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { SPLIT_HOLD_MS, WRITE_BURST, createHost, createWritePacer } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const SECTIONS = 20, CARDS = 60;
function seedBoard(uid, prefix) {
  const children = [];
  for (let s = 0; s < SECTIONS; s += 1) {
    const kids = [];
    for (let c = 0; c < CARDS; c += 1) kids.push({ uid: `${prefix}c${s}x${c}`, string: `card ${s}.${c}`, props: { plexus: { type: "card", x: c * 10, y: 0, w: 200, h: 100 } }, children: [{ uid: `${prefix}k${s}x${c}`, string: "kid" }] });
    children.push({ uid: `${prefix}s${s}`, string: `Section ${s}`, props: { plexus: { type: "section", x: 0, y: s * 1000, w: 900, h: 800 } }, children: kids });
  }
  return { uid, props: { plexus: { v: 2 } }, children };
}
function setup() {
  const fake = createFakeRoam({ echoDelay: 1 });
  fake.roamWatch = true;
  fake.seedBoard(seedBoard("main", "m"));
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host };
}

test("P7-1: watch calls count toward the cap, never toward the write burst gap", async () => {
  let t = 0;
  const waits = [];
  const pacer = createWritePacer({ now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, burst: 5, gapMs: 100, cap: 10 });
  for (let i = 0; i < 6; i += 1) pacer.note();
  for (let i = 0; i < 4; i += 1) await pacer.pace();
  assert.deepEqual(waits, [], "4 writes after 6 watch calls go at once");
  assert.equal(pacer.recent, 10);
  await pacer.pace();
  assert.equal(waits[0], 60000, "the cap still counts watch calls");
});

test("P7-1: 30 writes right after 200+ watch calls on a big board resolve without sleeping", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  host.watchBoard("main", () => {});
  for (let i = 0; i < WRITE_BURST; i += 1) host.watchContent(`mc${i % SECTIONS}x${Math.floor(i / SECTIONS)}`);
  await fake.flush();
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 30 }, (_, i) => host.updateString(`mc${i % SECTIONS}x59`, `moved ${i}`)));
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `30 writes took ${ms} ms`);
});

test("P7-2: a tree delivered in the frame before a park is applied on a held resume", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  const frames = [];
  const s = acquireSession("main", { host, linkDelay: 0, raf: (fn) => frames.push(fn) });
  await fake.flush();
  while (frames.length) frames.shift()();
  await fake.api.data.block.update({ block: { uid: "ms4", string: "Foreign rename" } });
  await fake.flush();
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(frames.length > 0, "a flush is scheduled");
  s.pauseWatches();
  while (frames.length) frames.shift()();
  s.resumeWatches();
  await fake.flush();
  await new Promise((r) => setTimeout(r, 5));
  while (frames.length) frames.shift()();
  assert.equal(s.board.items.get("ms4")?.string, "Foreign rename");
});

const find = (n, uid) => (n?.[":block/uid"] === uid ? n : (n?.[":block/children"] || []).map((k) => find(k, uid)).find(Boolean) || null);
function nestedSetup() {
  const fake = createFakeRoam({ echoDelay: 1 });
  fake.roamWatch = true;
  const inner = seedBoard("nest", "n");
  const nestedCard = { uid: "nest", string: "{{[[diagram]]:Inner}}", props: { plexus: { type: "card", x: 0, y: -400, w: 300, h: 200, v: 2 } }, children: inner.children };
  const outer = seedBoard("main", "m");
  outer.children.push(nestedCard);
  fake.seedBoard(outer);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host };
}
for (const held of [true, false]) {
  test(`P7-3: a warm-cache pullBoard never reseeds a ${held ? "held" : "live"} split with a stale tree`, async () => {
    const { fake, host } = nestedSetup();
    host.pullBoard("main");
    host.watchBoard("main", () => {});
    host.pullBoard("nest");
    const trees = [];
    const off = host.watchBoard("nest", (t) => trees.push(t));
    await fake.flush();
    if (held) off.pause();
    await fake.api.data.block.update({ block: { uid: "ns3", string: "edited elsewhere" } });
    await fake.flush();
    await fake.api.data.block.update({ block: { uid: "mc0x0", string: "main edit" } });
    await fake.flush();
    host.pullBoard("nest", { prime: false });
    if (held) off.resume();
    else await fake.api.data.block.update({ block: { uid: "ns9", string: "second edit" } });
    await fake.flush();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(find(trees.at(-1), "ns3")?.[":block/string"], "edited elsewhere");
  });
}

test("P7-3: hold expiry rebuilds from a fresh read, not the open-time seed", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  const trees = [];
  const off = host.watchBoard("main", (t) => trees.push(t));
  const offContent = host.watchContent("mc1x1");
  await fake.flush();
  await fake.api.data.block.update({ block: { uid: "mk1x1", string: "edited while mounted" } });
  await fake.flush();
  offContent();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    off.pause();
    mock.timers.tick(SPLIT_HOLD_MS);
    assert.equal(fake.watchList().length, 0, "hold expired");
  } finally { mock.timers.reset(); }
  await fake.api.data.block.update({ block: { uid: "mk2x2", string: "edited after the hold" } });
  await fake.api.data.block.update({ block: { uid: "ms7", string: "Renamed after the hold" } });
  await fake.flush();
  const n = trees.length;
  off.resume();
  await fake.flush();
  const after = trees.slice(n);
  assert.equal(after.length, 1, "one publish on resume");
  assert.equal(find(after[0], "mk1x1")?.[":block/string"], "edited while mounted");
  assert.equal(find(after[0], "mk2x2")?.[":block/string"], "edited after the hold");
  assert.equal(find(after[0], "ms7")?.[":block/string"], "Renamed after the hold");
  off();
});

for (const held of [true, false]) {
  test(`P7-3: a full pullBoard reseed does not hide a foreign edit from the mount compare (${held ? "held" : "live"})`, async () => {
    const { fake, host } = setup();
    host.pullBoard("main");
    const trees = [];
    const off = host.watchBoard("main", (t) => trees.push(t));
    await fake.flush();
    if (held) off.pause();
    await fake.api.data.block.update({ block: { uid: "mk5x5", string: "edited elsewhere" } });
    await fake.flush();
    host.pullBoard("main", { prime: false });
    if (held) off.resume();
    await fake.flush();
    host.watchContent("mc5x5");
    await fake.flush();
    assert.equal(find(trees.at(-1), "mk5x5")?.[":block/string"], "edited elsewhere");
    off();
  });
}

test("P7-3: a session sees an unmounted card's foreign edit after a refreshCardCache pull and a mount", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  const s = acquireSession("main", { host, linkDelay: 0 });
  await fake.flush();
  await fake.api.data.block.update({ block: { uid: "mk5x5", string: "edited elsewhere" } });
  await fake.flush();
  host.pullBoard("main", { prime: false });
  const off = host.watchContent("mc5x5");
  await fake.flush();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual((s.board.items.get("mc5x5")?.content || []).map((k) => k[":block/string"]), ["edited elsewhere"]);
  off();
});

test("P7-3: a full pullBoard of an unchanged big board publishes nothing", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  const trees = [];
  const off = host.watchBoard("main", (t) => trees.push(t));
  host.watchContent("mc1x1");
  await fake.flush();
  const n = trees.length;
  host.pullBoard("main", { prime: false });
  await fake.flush();
  assert.equal(trees.length, n);
  off();
});

test("P7-4: a parked big board stops priming card stats", async () => {
  const queued = [];
  const prev = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); return queued.length; };
  try {
    const { host } = setup();
    host.pullBoard("main");
    const w = host.watchBoard("main", () => {});
    let n = 0;
    const real = host.cardStats.bind(host);
    host.cardStats = (t, o) => { n += 1; return real(t, o); };
    w.pause();
    let guard = 0;
    while (queued.length && guard++ < 200) queued.shift()({ didTimeout: true, timeRemaining: () => 0 });
    assert.equal(n, 0, "no cardStats after the park");
    w.resume();
    w();
  } finally { globalThis.requestIdleCallback = prev; }
});
