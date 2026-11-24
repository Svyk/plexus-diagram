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
// performance.now under the test's control; `frame` ms pass between two flushed frames.
const steppedClock = async (fn) => {
  const real = globalThis.performance.now;
  const clock = { t: 5_000_000 };
  globalThis.performance.now = () => clock.t;
  try { return await fn(clock); } finally { globalThis.performance.now = real; }
};

// E3-5 (perf2): QA4 crumb back to PhD MAIN: the `resume` task 416 ms (403 Plexus) against a 320 ms target, then 12 slice
// tasks of 120-374 ms with ~4 ms of Plexus each (the browser attaching 48 shells and 120 edges a frame).
test("E3-5: crumb back trims the kept board to 48 shells while it is still parked, then slices the rest in from 24 a frame", async () => {
  const m = await builtAtFit();
  try {
    assert.ok(m.view.paintAudit().attached > 1400);
    m.view.suspend();
    m.view.park();
    const root = m.view.root;
    const remove = root.removeAttribute.bind(root);
    let atUnhide = null;
    root.removeAttribute = (name) => { if (name === "data-pxd-parked") atUnhide = m.view.paintAudit().attached; return remove(name); };
    const n0 = m.view.sliceStats().budgets.length;
    m.view.unpark();
    root.removeAttribute = remove;
    assert.ok(atUnhide !== null && atUnhide <= 60, `shells attached when the root shows again: ${atUnhide}`);
    m.view.resume();
    assert.ok(m.view.paintAudit().attached <= 60, `after the resume task: ${m.view.paintAudit().attached}`);
    assert.equal(m.view.sliceStats().budgets[n0], 24, `the resume's slice starts at 24: ${JSON.stringify(m.view.sliceStats())}`);
    let worst = 0;
    for (let i = 0; i < 120; i += 1) { m.stub.flushFrames(); worst = Math.max(worst, m.view.paintAudit().missing); }
    assert.equal(worst, 0);
    assert.ok(m.view.paintAudit().attached > 1400, "every shell back in the end");
  } finally { m.done(); }
});

test("E3-5: the slice budget halves after a long frame (down to 12) and doubles back after short ones (up to 48)", async () => {
  const m = await builtAtFit();
  try {
    await steppedClock(async (clock) => {
      m.view.suspend();
      m.view.park();
      m.view.unpark();
      m.view.resume();
      assert.equal(m.view.sliceStats().budgets.at(-1), 24);
      for (let i = 0; i < 4; i += 1) { clock.t += 120; m.stub.flushFrames(); }
      const long = m.view.sliceStats().budgets.slice(-4);
      assert.deepEqual(long, [12, 12, 12, 12], `after 120 ms frames: ${JSON.stringify(m.view.sliceStats())}`);
      for (let i = 0; i < 3; i += 1) { clock.t += 16; m.stub.flushFrames(); }
      assert.deepEqual(m.view.sliceStats().budgets.slice(-3), [24, 48, 48], `after 16 ms frames: ${JSON.stringify(m.view.sliceStats())}`);
    });
  } finally { m.done(); }
});

test("E3-5: adaptiveSlices off keeps 48 a slice whatever the frames cost", async () => {
  const m = await builtAtFit({ adaptiveSlices: false });
  try {
    await steppedClock(async (clock) => {
      m.view.suspend();
      m.view.park();
      m.view.unpark();
      m.view.resume();
      const n0 = m.view.sliceStats().budgets.length;
      for (let i = 0; i < 3; i += 1) { clock.t += 120; m.stub.flushFrames(); }
      const budgets = m.view.sliceStats().budgets.slice(n0 - 1);
      assert.ok(budgets.length >= 3 && budgets.every((b) => b === 48), JSON.stringify(m.view.sliceStats()));
    });
  } finally { m.done(); }
});
