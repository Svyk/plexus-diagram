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

test("P7-5: unload leaves 0 registered watches and 0 pending host timers", async () => {
  const pending = new Set();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => {
    const id = realSet(() => { pending.delete(id); fn(...a); }, ms); id.stack = new Error().stack;
    pending.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => { pending.delete(id); realClear(id); };
  let fake;
  let host;
  try {
    ({ fake, host } = setup());
    host.pullBoard("main");
    acquireSession("main", { host, linkDelay: 0 });
    const offs = Array.from({ length: 30 }, (_, i) => host.watchContent(`mc${i % SECTIONS}x${i % 7}`));
    await fake.flush();
    for (const off of offs.slice(0, 20)) off();
    host.watchBlock("blkA", () => {});
    resetSessions();
    host.dispose();
    assert.equal(fake.watchList().length, 0, "every pull watch removed");
    assert.equal(host.splitStats?.("main") ?? null, null);
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
  for (const id of pending) { if (process.env.P7DBG) console.log(id.stack); realClear(id); }
  assert.equal(pending.size, 0, "no host timer left");
});

test("P7-5: a destroy during a park does not restart the hold", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { fake, host } = setup();
    host.pullBoard("main");
    const off = host.watchBoard("main", () => {});
    off.pause();
    mock.timers.tick(SPLIT_HOLD_MS - 1000);
    off();
    mock.timers.tick(1000);
    assert.equal(fake.watchList().length, 0, "the hold ends when it was due");
  } finally { mock.timers.reset(); }
});

test("P7-5: the feature lifecycle disposes the host at unload", async () => {
  const { createDomStub } = await import("./fixtures/dom-stub.js");
  const { createLifecycle } = await import("../src/lifecycle.js");
  const { installPlexusDiagram } = await import("../src/feature.js");
  const dom = createDomStub();
  dom.document.head = dom.document.createElement("head");
  const restoreDom = dom.install();
  const lifecycle = createLifecycle();
  let disposed = 0;
  const host = { listBoards: () => [], dispose: () => { disposed += 1; } };
  const extensionAPI = {
    settings: { get: () => null },
    ui: {
      commandPalette: { addCommand: async () => {}, removeCommand: async () => {} },
      slashCommand: { addCommand: async () => {}, removeCommand: async () => {} },
      blockContextMenu: { addCommand: async () => {}, removeCommand: async () => {} },
    },
    platform: { isMobile: () => false },
  };
  try {
    await installPlexusDiagram({ extensionAPI, lifecycle, host, acquireSession: () => ({ release() {} }), mountView: () => ({ dispose() {} }) });
    assert.equal(disposed, 0);
    await lifecycle.dispose();
    assert.equal(disposed, 1);
  } finally {
    await lifecycle.dispose().catch(() => {});
    restoreDom();
  }
});

test("P7-6: a refused rebuild on resume leaves no orphan watch, stays held, and retries", async () => {
  const { RESUME_RETRY_MS } = await import("../src/session.js");
  const { fake, host } = setup();
  host.pullBoard("main");
  const main = acquireSession("main", { host, linkDelay: 0 });
  await fake.flush();
  mock.timers.enable({ apis: ["setTimeout"] });
  try { main.pauseWatches(); mock.timers.tick(SPLIT_HOLD_MS); } finally { mock.timers.reset(); }
  assert.equal(fake.watchList().length, 0);
  const add = fake.api.data.addPullWatch.bind(fake.api.data);
  let n = 0;
  fake.api.data.addPullWatch = (...a) => { n += 1; if (n === 5) throw new Error("maximum mutation rate limit exceeded"); return add(...a); };
  main.resumeWatches();
  fake.api.data.addPullWatch = add;
  assert.equal(fake.watchList().length, 0, "no orphan watch after the refused rebuild");
  await fake.api.data.block.update({ block: { uid: "ms4", string: "edit after failed resume" } });
  await fake.flush();
  await new Promise((r) => setTimeout(r, RESUME_RETRY_MS + 50));
  await fake.flush();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(main.board.items.get("ms4")?.string, "edit after failed resume");
  assert.ok(fake.watchList().length > 0, "watches back after the retry");
});
