// The parts gram index is built when search opens, in background-budget slices, never on a key.
// A keystroke searches what is already indexed, or the cheap scan, and does not call addPosting.
import assert from "node:assert/strict";
import test from "node:test";

import { BG_QUIET_MS, createBgBudget } from "../src/bg-budget.js";
import {
  PARTS_SLICE_MS,
  buildPartsIndex,
  finishPartsIndex,
  partsIndexReady,
  partsLastSliceMs,
  partsPostingAdds,
  partsSliceCalls,
  schedulePartsIndex,
  searchParts,
} from "../src/model/parts-search.js";

function bigRows() {
  const blocks = {};
  const order = [];
  for (let page = 1; page <= 40; page += 1) {
    for (let i = 0; i < 20; i += 1) {
      const id = `b${page}-${i}`;
      blocks[id] = {
        id,
        type: "para",
        page,
        text: `Page ${page} paragraph ${i} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt`,
      };
      order.push(id);
    }
  }
  blocks["b30-4"].text += " drains seasonal peak flow";
  const rows = buildPartsIndex({ sha256: "slice", blocks, order }, { docTitle: "Report" });
  assert.ok(rows.length > 700);
  return rows;
}

function harness() {
  let t = 10000;
  const idleQ = [];
  const timers = [];
  const listeners = new Map();
  const win = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  // Each read moves the frozen clock by 1 ms, so a slice that polls it cannot walk the whole corpus.
  const now = () => {
    t += 1;
    return t;
  };
  const budget = createBgBudget({
    win,
    now,
    ric: (fn) => { idleQ.push(fn); return idleQ.length; },
    cic: () => {},
    setTimer: (fn, ms) => { const e = { at: t + ms, fn }; timers.push(e); return e; },
    clearTimer: (e) => { const i = timers.indexOf(e); if (i >= 0) timers.splice(i, 1); },
  });
  return {
    budget,
    now,
    idle() {
      const start = t;
      const list = idleQ.splice(0);
      for (const fn of list) fn({ didTimeout: false, timeRemaining: () => Math.max(0, 50 - (t - start)) });
      return list.length;
    },
    wait(ms) {
      t += ms;
      const due = timers.splice(0);
      for (const e of due) { if (e.at <= t) e.fn(); else timers.push(e); }
    },
    input(type = "keydown") { listeners.get(type)?.({ type }); },
    queued: () => idleQ.length,
  };
}

test("the first search after open does not build the parts index, and slices stay within 8 ms", () => {
  assert.equal(PARTS_SLICE_MS, 8);
  const rows = bigRows();
  const h = harness();
  const beforeOpen = partsPostingAdds();
  const stop = schedulePartsIndex(rows, { budget: h.budget, now: h.now });
  assert.equal(typeof stop, "function");
  assert.equal(partsPostingAdds(), beforeOpen, "opening queues slices and does not index yet");
  assert.equal(partsIndexReady(rows), false);

  const beforeSearch = partsPostingAdds();
  const early = searchParts(rows, { text: "drains seasonal peak", kinds: ["paragraph"] });
  assert.equal(partsPostingAdds(), beforeSearch, "the first search calls addPosting");
  assert.equal(early.length, 1);
  assert.equal(early[0].page, 30);

  const slices = [];
  let guard = 0;
  while (!partsIndexReady(rows) && guard < 4000) {
    guard += 1;
    const calls = partsSliceCalls();
    const adds = partsPostingAdds();
    const ran = h.idle();
    if (!ran) {
      h.wait(BG_QUIET_MS + 80);
      continue;
    }
    const steps = partsSliceCalls() - calls;
    const posted = partsPostingAdds() - adds;
    if (posted > 0) {
      slices.push({ steps, ms: partsLastSliceMs(), posted });
      assert.equal(steps, 1, "one budget slice indexes once");
      assert.ok(partsLastSliceMs() <= PARTS_SLICE_MS, `slice took ${partsLastSliceMs()} ms`);
    }
    if (!partsIndexReady(rows)) h.wait(80);
  }
  assert.ok(slices.length >= 3, `expected several slices, saw ${slices.length}`);
  const total = slices.reduce((sum, s) => sum + s.posted, 0);
  assert.ok(slices.every((s) => s.posted < total), "one slice indexed every row");
  assert.equal(partsIndexReady(rows), true);

  const beforeLate = partsPostingAdds();
  const late = searchParts(rows, { text: "drains seasonal peak", kinds: ["paragraph"], pages: "p. 30-50" });
  assert.equal(partsPostingAdds(), beforeLate, "a search after the index is built still calls addPosting");
  assert.equal(late.length, 1);
  assert.equal(late[0].page, 30);

  // A key pauses the shared budget, so a slice does not keep indexing.
  const more = bigRows();
  schedulePartsIndex(more, { budget: h.budget, now: h.now });
  h.input("keydown");
  const paused = partsPostingAdds();
  h.idle();
  assert.equal(partsPostingAdds(), paused, "a keydown slice still indexed");
  stop();
});

test("an indexed search does not read each row's text again", () => {
  const blocks = {};
  const order = [];
  for (let page = 1; page <= 10; page += 1) {
    const id = `p${page}`;
    blocks[id] = { id, type: "para", page, text: `Page ${page} lorem ipsum dolor sit amet` };
    order.push(id);
  }
  blocks.p4.text += " drains seasonal peak";
  const rows = buildPartsIndex({ sha256: "s", blocks, order }, { docTitle: "Report" });
  finishPartsIndex(rows);
  let reads = 0;
  for (const row of rows) {
    const lower = row.lower;
    Object.defineProperty(row, "lower", { get() { reads += 1; return lower; } });
  }
  const before = partsPostingAdds();
  const hit = searchParts(rows, { text: "drains seasonal peak" });
  assert.equal(hit.length, 1);
  assert.equal(partsPostingAdds(), before);
  assert.equal(reads, 0, "the keystroke read part text");
});
