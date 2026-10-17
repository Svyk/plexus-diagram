// PERF5-P4: a settle slice frame that is long while Plexus spent almost nothing in it is the browser's fixed cost per
// mutating frame (live: Roam's :has() union restyles every inline-styled element on each frame that attaches shells).
// Halving then doubles the number of those frames. The budget grows instead (flag sliceGrow), and halves only when the
// frame grew with the slice.
import assert from "node:assert/strict";
import test from "node:test";
import { mountBig, settledIn } from "./fixtures/big-mount.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const builtAtFit = async (flags = {}) => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { fullscreen: true, flags: { overviewCanvas: false, ...flags } });
  await settledIn(m);
  for (let k = 0; k < 40 && m.view.stats().shells < 1570; k += 1) { await tick(100); await m.pump(50); }
  await tick(700);
  await m.pump(20);
  return m;
};
const steppedClock = async (fn) => {
  const real = globalThis.performance.now;
  const clock = { t: 5_000_000 };
  globalThis.performance.now = () => clock.t;
  try { return await fn(clock); } finally { globalThis.performance.now = real; }
};
const crumbBack = (m) => { m.view.suspend(); m.view.park(); m.view.unpark(); m.view.resume(); };

test("P4: long browser-bound slice frames grow the slice budget (24 -> 384), so fewer frames pay the fixed cost", async () => {
  const m = await builtAtFit({ sliceGrow: true });
  try {
    await steppedClock(async (clock) => {
      crumbBack(m);
      assert.equal(m.view.sliceStats().budgets.at(-1), 24);
      for (let i = 0; i < 5; i += 1) { clock.t += 120; m.stub.flushFrames(); }
      assert.deepEqual(m.view.sliceStats().budgets.slice(-5), [48, 96, 192, 384, 384], JSON.stringify(m.view.sliceStats()));
    });
  } finally { m.done(); }
});

test("P4: a frame that grew with the slice halves it back; short frames keep a grown budget", async () => {
  const m = await builtAtFit({ sliceGrow: true });
  try {
    await steppedClock(async (clock) => {
      crumbBack(m);
      // 120 ms at 24 shells, then 240 at 48: the frame scales with the slice, so the budget halves.
      clock.t += 120; m.stub.flushFrames();
      assert.equal(m.view.sliceStats().budgets.at(-1), 48);
      clock.t += 240; m.stub.flushFrames();
      assert.equal(m.view.sliceStats().budgets.at(-1), 24, JSON.stringify(m.view.sliceStats()));
    });
  } finally { m.done(); }
});

test("P4: sliceGrow off keeps the E3-5 halving after a long frame", async () => {
  const m = await builtAtFit({ sliceGrow: false });
  try {
    await steppedClock(async (clock) => {
      crumbBack(m);
      for (let i = 0; i < 2; i += 1) { clock.t += 120; m.stub.flushFrames(); }
      assert.deepEqual(m.view.sliceStats().budgets.slice(-2), [12, 12], JSON.stringify(m.view.sliceStats()));
    });
  } finally { m.done(); }
});
