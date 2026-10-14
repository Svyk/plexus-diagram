// P8 U2: the background budget after an open. Fake clock and idle queue: a job yields at its deadline, pauses while
// input is active and for 300 ms after it, waits for its first quiet window, and the flag off is plain idle callbacks.
import assert from "node:assert/strict";
import test from "node:test";
import { BG_QUIET_MS, BG_SLICE_MS, createBgBudget } from "../src/bg-budget.js";

function harness({ idleMs = 50, enabled = true } = {}) {
  let t = 10000;
  const idleQ = [];
  const timers = [];
  const listeners = new Map();
  const win = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const budget = createBgBudget({
    win,
    now: () => t,
    ric: (fn) => { idleQ.push(fn); return idleQ.length; },
    cic: () => {},
    setTimer: (fn, ms) => { const e = { at: t + ms, fn }; timers.push(e); return e; },
    clearTimer: (e) => { const i = timers.indexOf(e); if (i >= 0) timers.splice(i, 1); },
    enabled: () => enabled,
  });
  const h = {
    budget,
    advance(ms) { t += ms; },
    now: () => t,
    // One idle period of idleMs: run the queued callbacks with a deadline from the browser.
    idle() {
      const start = t;
      const list = idleQ.splice(0);
      for (const fn of list) fn({ didTimeout: false, timeRemaining: () => Math.max(0, idleMs - (t - start)) });
      return list.length;
    },
    // Let `ms` pass with no idle period, firing due timers.
    wait(ms) {
      t += ms;
      for (const e of timers.splice(0)) { if (e.at <= t) e.fn(); else timers.push(e); }
    },
    input(type = "wheel", extra = {}) { listeners.get(type)?.({ type, ...extra }); },
    queued: () => idleQ.length,
    timers: () => timers.length,
  };
  return h;
}

test("a job in parts stops at its slice budget (BG_SLICE_MS) even when the idle period is longer", () => {
  const h = harness({ idleMs: 50 });
  const spent = [];
  let parts = 0;
  let sliceStart = null;
  h.budget.run(() => {
    if (sliceStart == null) sliceStart = h.now();
    h.advance(8); // one part = 8 ms of work
    parts += 1;
    return parts >= 20;
  });
  while (parts < 20) {
    sliceStart = null;
    assert.ok(h.idle() >= 1, "a slice was queued");
    spent.push(h.now() - sliceStart);
    h.advance(100);
  }
  assert.ok(spent.every((ms) => ms <= BG_SLICE_MS + 8), JSON.stringify(spent));
  assert.ok(spent.length >= 5, "spread over several slices");
  assert.equal(h.queued(), 0, "finished jobs queue nothing");
});

test("one part runs even when the idle period is already spent; the next part waits for the next slice", () => {
  const h = harness({ idleMs: 0 });
  let parts = 0;
  h.budget.run(() => { parts += 1; h.advance(5); return parts >= 3; });
  h.idle();
  assert.equal(parts, 1);
  h.idle();
  assert.equal(parts, 2);
});

test("input pauses background work while it lasts and for BG_QUIET_MS after it; a hover does not", () => {
  const h = harness();
  let ran = 0;
  h.budget.run(() => { ran += 1; h.advance(5); return ran >= 100; });
  h.input("wheel");
  h.idle();
  assert.equal(ran, 0, "no work right after a wheel");
  assert.equal(h.timers(), 1, "it waits for the quiet window");
  h.wait(BG_QUIET_MS - 50);
  assert.equal(h.queued(), 0);
  h.wait(60);
  assert.equal(h.queued(), 1, "back in the idle queue after the quiet window");
  // Input in the middle of a slice ends the slice at once.
  let inSlice = 0;
  const h2 = harness();
  h2.budget.run(() => { inSlice += 1; h2.advance(2); if (inSlice === 2) h2.input("keydown"); return inSlice >= 50; });
  h2.idle();
  assert.equal(inSlice, 2, "the slice stops at the keydown");
  // A pointer move without a button is a hover.
  const h3 = harness();
  let hover = 0;
  h3.budget.run(() => { hover += 1; h3.advance(5); return true; });
  h3.input("pointermove", { buttons: 0 });
  h3.idle();
  assert.equal(hover, 1);
});

test("firstQuiet: a job that waits for the board to sit still starts only after that long without input", () => {
  const h = harness();
  let ran = 0;
  h.input("pointerdown");
  h.budget.run(() => { ran += 1; return true; }, { firstQuiet: 1500 });
  h.idle();
  assert.equal(ran, 0);
  h.wait(1000);
  h.idle();
  assert.equal(ran, 0);
  h.wait(600);
  h.idle();
  assert.equal(ran, 1);
  // No input at all: still 1.5 s after it was scheduled.
  const h2 = harness();
  let ran2 = 0;
  h2.budget.run(() => { ran2 += 1; return true; }, { firstQuiet: 1500 });
  h2.idle();
  assert.equal(ran2, 0);
  h2.wait(1500);
  h2.idle();
  assert.equal(ran2, 1);
});

test("cancel drops a waiting job; the flag off is one plain idle callback with the browser's deadline", () => {
  const h = harness();
  let ran = 0;
  const cancel = h.budget.run(() => { ran += 1; return false; });
  cancel();
  h.idle();
  assert.equal(ran, 0);
  const off = harness({ enabled: false, idleMs: 50 });
  let seen = null;
  off.input("wheel");
  off.budget.idle((d) => { seen = d.timeRemaining(); });
  off.idle();
  assert.equal(seen, 50, "no quiet wait and no slice cap with the flag off");
});
