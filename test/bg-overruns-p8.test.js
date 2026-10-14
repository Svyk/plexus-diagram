// P8 U2: the shared budget keeps a ledger of slices that ran past twice the slice budget, by job label.
import assert from "node:assert/strict";
import test from "node:test";
import { createBgBudget } from "../src/bg-budget.js";

test("budget: an overrunning slice is logged with its job label, a short one is not", () => {
  let t = 0;
  const q = [];
  const b = createBgBudget({ win: {}, now: () => t, ric: (fn) => { q.push(fn); return q.length; }, cic: () => {}, setTimer: (fn) => { q.push(() => fn()); return 0; }, clearTimer: () => {}, quietMs: 0, duty: 1 });
  b.idle(() => { t += 75; }, { label: "snap" });
  b.idle(() => { t += 10; }, { label: "short" });
  while (q.length) q.shift()({ timeRemaining: () => 50, didTimeout: false });
  assert.deepEqual(b.overruns, [{ label: "snap", ms: 75 }]);
});
