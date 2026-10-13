// 3.27.0 read a normal board's card stats in one call during the open. The PhD round split them into idle chunks
// of 80 targets; each chunk pays the fixed cost of four datalog queries (~40-55 ms each in Readwisenotes), so the
// first pans and zooms after opening Parse Lab ran into 50-134 ms idle tasks. Only a big board reads in chunks.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { SPLIT_WATCH_MIN } from "../src/host/split-watch.js";

function seed(fake, uid, n) {
  const cards = Array.from({ length: n }, (_, i) => ({ uid: `${uid}c${i}`, string: `card ${i}`, props: { plexus: { type: "card", x: i * 10, y: 0, w: 200, h: 100 } } }));
  fake.seedBoard({ uid, props: { plexus: { v: 2 } }, children: cards });
}

function spy(host) {
  const calls = [];
  const real = host.cardStats.bind(host);
  host.cardStats = (targets, opts) => { calls.push(targets.length); return real(targets, opts); };
  return calls;
}

test("a normal board reads its card stats in one call on open", () => {
  const fake = createFakeRoam();
  seed(fake, "norm", 300);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const calls = spy(host);
  host.pullBoard("norm");
  assert.deepEqual(calls, [300]);
});

test("a big board reads the first chunk on open and the rest later", () => {
  const fake = createFakeRoam();
  seed(fake, "huge", SPLIT_WATCH_MIN + 10);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const calls = spy(host);
  host.pullBoard("huge");
  assert.equal(calls.length, 1);
  assert.ok(calls[0] < SPLIT_WATCH_MIN, `first chunk ${calls[0]}`);
});

test("a light read of a normal board (keep-alive catch-up) reads its card stats in one idle call", async () => {
  const fake = createFakeRoam();
  seed(fake, "norm", 300);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.watchBoard("norm", () => {});
  const calls = spy(host);
  host.pullBoard("norm", { light: true });
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(calls, [300]);
});

test("a board past SPLIT_WATCH_MIN blocks with few items (Parse Lab: parsed PDFs) reads its stats in one call", () => {
  const fake = createFakeRoam();
  const cards = Array.from({ length: 50 }, (_, i) => ({ uid: `pc${i}`, string: `pdf ${i}`, props: { plexus: { type: "card", x: i * 10, y: 0, w: 200, h: 100 } }, children: Array.from({ length: 50 }, (_, j) => ({ uid: `pc${i}r${j}`, string: `row ${j}` })) }));
  fake.seedBoard({ uid: "lab", props: { plexus: { v: 2 } }, children: cards });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const calls = spy(host);
  host.pullBoard("lab");
  assert.equal(calls.length, 1);
  assert.ok(calls[0] >= SPLIT_WATCH_MIN, `${calls[0]} targets in one call`);
});

test("a big board's idle stat reads stop at the slice deadline and run one part when the callback timed out", () => {
  const queued = [];
  const previous = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); return queued.length; };
  try {
    const fake = createFakeRoam();
    seed(fake, "huge", SPLIT_WATCH_MIN + 10);
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    host.watchBoard("huge", () => {});
    const calls = spy(host);
    host.pullBoard("huge");
    const first = calls.length;
    queued.shift()({ didTimeout: true, timeRemaining: () => 0 });
    assert.equal(calls.length - first, 1, "a timed-out callback runs one part");
    assert.ok(calls.at(-1) <= 20);
    queued.shift()({ didTimeout: false, timeRemaining: () => 0 });
    assert.equal(calls.length - first, 2, "a spent slice still runs one part");
  } finally {
    globalThis.requestIdleCallback = previous;
  }
});

test("a structure-only read (the card-chip cache) primes no card stats", () => {
  const fake = createFakeRoam();
  seed(fake, "norm", 300);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const calls = spy(host);
  const queued = [];
  const previous = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); return queued.length; };
  try {
    const node = host.pullBoard("norm", { prime: false });
    assert.equal(node[":block/children"].length, 300);
    assert.deepEqual(calls, []);
    assert.equal(queued.length, 0, "no idle reads either");
  } finally {
    globalThis.requestIdleCallback = previous;
  }
});
