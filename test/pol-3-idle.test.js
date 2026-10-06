import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";

function withIdleHost(host, fn) {
  const previous = {
    requestIdleCallback: globalThis.requestIdleCallback,
    cancelIdleCallback: globalThis.cancelIdleCallback,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.requestIdleCallback = host.requestIdleCallback;
  globalThis.cancelIdleCallback = host.cancelIdleCallback;
  if (host.setTimeout) globalThis.setTimeout = host.setTimeout;
  if (host.clearTimeout) globalThis.clearTimeout = host.clearTimeout;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.requestIdleCallback = previous.requestIdleCallback;
      globalThis.cancelIdleCallback = previous.cancelIdleCallback;
      globalThis.setTimeout = previous.setTimeout;
      globalThis.clearTimeout = previous.clearTimeout;
    });
}

test("idle runs once", async () => {
  const queued = [];
  await withIdleHost({
    requestIdleCallback: (fn, options) => {
      queued.push({ fn, options });
      return 1;
    },
    cancelIdleCallback: () => {},
  }, () => {
    const lifecycle = createLifecycle();
    let ran = 0;
    lifecycle.idle(() => { ran += 1; });
    assert.equal(lifecycle.pending(), 1);
    assert.deepEqual(queued[0].options, { timeout: 1000 });
    const deadline = { didTimeout: false, timeRemaining: () => 40 };
    queued[0].fn(deadline);
    queued[0].fn(deadline);
    assert.equal(ran, 1);
    assert.equal(lifecycle.pending(), 0);
  });
});

test("dispose before idle fires leaves no pending callback", async () => {
  const queued = [];
  let cancelled = 0;
  await withIdleHost({
    requestIdleCallback: (fn) => {
      queued.push(fn);
      return 4;
    },
    cancelIdleCallback: () => { cancelled += 1; },
  }, async () => {
    const lifecycle = createLifecycle();
    let ran = 0;
    lifecycle.idle(() => { ran += 1; });
    assert.equal(lifecycle.pending(), 1);
    await lifecycle.dispose();
    assert.equal(lifecycle.pending(), 0);
    assert.equal(cancelled, 1);
    queued[0]({ didTimeout: false, timeRemaining: () => 10 });
    assert.equal(ran, 0);
  });
});

test("idle falls back to setTimeout without requestIdleCallback", async () => {
  const timeouts = [];
  const cleared = [];
  await withIdleHost({
    requestIdleCallback: undefined,
    cancelIdleCallback: undefined,
    setTimeout: (fn, delay) => {
      timeouts.push({ fn, delay });
      return 9;
    },
    clearTimeout: (id) => { cleared.push(id); },
  }, () => {
    const lifecycle = createLifecycle();
    let ran = 0;
    const id = lifecycle.idle(() => { ran += 1; }, { timeout: 250 });
    assert.equal(id, 9);
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0].delay, 250);
    assert.equal(lifecycle.pending(), 1);
    timeouts[0].fn();
    assert.equal(ran, 1);
    assert.equal(lifecycle.pending(), 0);
    timeouts[0].fn();
    assert.equal(ran, 1);

    const cancelled = createLifecycle();
    let skipped = 0;
    cancelled.idle(() => { skipped += 1; });
    return cancelled.dispose().then(() => {
      assert.equal(cancelled.pending(), 0);
      assert.deepEqual(cleared, [9]);
      timeouts[1].fn();
      assert.equal(skipped, 0);
    });
  });
});
