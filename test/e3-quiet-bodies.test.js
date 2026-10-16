import assert from "node:assert/strict";
import test from "node:test";
import { createTimers } from "../src/view/board-view.js";
import { createTaskProbe, sharedTaskProbe } from "../src/long-tasks.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const spin = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* work */ } };

// E3-3 (perf2): QA4 saw a 3-4 s Plexus task ~4 s after a detail pan named only `timer`. A deferred job with no label
// is named after the function that scheduled it.
test("E3-3: an unlabelled later/frame/idle job is named after the function that scheduled it in longTasks()", async () => {
  const probe = sharedTaskProbe();
  probe.clear();
  const timers = createTimers();
  function scheduleSlowThing() { timers.later(() => spin(110), 0); }
  scheduleSlowThing();
  await tick(20);
  const names = probe.longTasks().flatMap((t) => t.jobs.map((j) => j.name));
  assert.ok(names.includes("timer@scheduleSlowThing"), `job names: ${JSON.stringify(names)}`);
  timers.cancelAll();
});
test("E3-3: a span name given as a function is read only for a kept span", () => {
  const probe = createTaskProbe();
  let reads = 0;
  probe.span(() => { reads += 1; return "cheap"; }, () => {});
  probe.span(() => { reads += 1; return "slow"; }, () => spin(110));
  assert.equal(reads, 1);
  assert.deepEqual(probe.longTasks().map((t) => t.jobs[0].name), ["slow"]);
});

import { buildBoard, worldRects } from "../src/model/board.js";
import { UNMOUNT_GRACE_MS } from "../src/view/offscreen.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { noteSpeedFlags } from "../src/settings.js";

// The card renderer with view-like timers: later (recorded), idle (queued), bgRun (parts run by the test).
function renderer({ flags = {}, slow = new Set(), unmountMs = 0 } = {}) {
  noteSpeedFlags(flags);
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const laters = [];
  const jobs = [];
  let unmounts = 0;
  let renders = 0;
  const host = {
    renderString(node, string) { renders += 1; if (slow.has(string)) spin(60); node.textContent = string; },
    renderBlock(node) { renders += 1; node.textContent = "x"; },
    unmount() { unmounts += 1; spin(unmountMs); },
    blockString: () => "",
    pullTree: () => [],
  };
  const r = createItemRenderer({
    doc, host, session: {}, itemsLayer, sectionsLayer,
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later(fn, ms) { const rec = { fn, ms, off: false }; laters.push(rec); return () => { rec.off = true; }; },
      bgRun(part, opts) { const job = { part, opts, done: false }; jobs.push(job); return () => { job.done = true; }; },
    },
  });
  const flush = () => { let guard = 0; while (idleQueue.length && guard++ < 50) idleQueue.shift()({ timeRemaining: () => 10 }); };
  // One background slice: a part, then more while the 30 ms slice has partMs left (as bg-budget.js runs them).
  const slice = () => {
    for (const job of jobs.filter((j) => !j.done)) {
      const t0 = performance.now();
      do { if (job.part({ timeRemaining: () => 30 - (performance.now() - t0) }) === true) { job.done = true; break; } } while (30 - (performance.now() - t0) >= (job.opts?.partMs || 0));
    }
  };
  const done = () => { restore(); noteSpeedFlags(null); };
  return { r, laters, jobs, flush, slice, done, unmounts: () => unmounts, renders: () => renders };
}
const cards = (n) => {
  const kids = [];
  for (let i = 0; i < n; i += 1) {
    kids.push({ ":block/uid": `card${String(i).padStart(5, "0")}`, ":block/string": `Card ${i}`, ":block/order": i, ":block/props": { ":plexus": { ":x": (i % 5) * 260, ":y": Math.floor(i / 5) * 160, ":w": 240, ":h": 140 } }, ":block/children": [] });
  }
  return buildBoard({ ":block/uid": "boardq0001", ":block/string": "{{[[diagram]]:Q}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": kids });
};
const wide = { x: -100, y: -100, w: 4000, h: 3000 };
const away = { x: 90000, y: 90000, w: 10, h: 10 };
const withClock = (fn) => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "performance");
  const clock = { t: 1000 };
  const base = globalThis.performance;
  const t0 = base.now();
  Object.defineProperty(globalThis, "performance", { value: { now: () => clock.t + (base.now() - t0) }, configurable: true, writable: true });
  try { return fn(clock); } finally { Object.defineProperty(globalThis, "performance", real); }
};
const graceUnmounts = (flags) => withClock((clock) => {
  const t = renderer({ flags, unmountMs: 6 });
  try {
    const board = cards(20);
    t.r.sync({ board, rects: worldRects(board), structural: true });
    t.r.setLod("detail", 1);
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    const mounted = t.r.mountedUids().length;
    t.r.scheduleContent({ visibleRect: away, zoom: 1, tier: "detail" });
    clock.t += UNMOUNT_GRACE_MS + 100;
    const timer = t.laters.filter((rec) => rec.ms === UNMOUNT_GRACE_MS && !rec.off).pop();
    const u0 = t.unmounts();
    timer.fn();
    const inTimer = t.unmounts() - u0;
    const perSlice = [];
    for (let i = 0; i < 40 && t.jobs.some((j) => !j.done); i += 1) { const u = t.unmounts(); t.slice(); perSlice.push(t.unmounts() - u); }
    return { mounted, inTimer, perSlice, left: t.r.mountedUids().length };
  } finally { t.done(); }
});

test("E3-3: bodies past the unmount grace leave in background slices, not all in the grace timer's task", () => {
  const { mounted, inTimer, perSlice, left } = graceUnmounts({});
  assert.equal(mounted, 20);
  assert.equal(inTimer, 0, "the grace timer only queues them");
  assert.equal(left, 0, "every due body is unmounted in the end");
  // 6 ms a Roam unmount: a 30 ms slice takes about four, then the duty-cycle gap and the next quiet slice.
  assert.ok(perSlice.length >= 4 && Math.max(...perSlice) <= 5, `unmounts per slice: ${JSON.stringify(perSlice)}`);
});
test("E3-3: quietBodies off unmounts every due body in the grace timer's task (3.34.0)", () => {
  const { inTimer, left } = graceUnmounts({ quietBodies: false });
  assert.ok(inTimer >= 20, `unmounts in the timer task: ${inTimer}`);
  assert.equal(left, 0);
});
test("E3-3: a body that was slow to mount mounts again only in a background slice, one a slice", () => withClock((clock) => {
  const t = renderer({ slow: new Set(["Card 3", "Card 7"]) });
  try {
    const board = cards(20);
    t.r.sync({ board, rects: worldRects(board), structural: true });
    t.r.setLod("detail", 1);
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    // Away and back (the bodies were unmounted meanwhile): the slow ones wait for a quiet slice.
    t.r.scheduleContent({ visibleRect: away, zoom: 1, tier: "detail" });
    clock.t += UNMOUNT_GRACE_MS + 100;
    t.laters.filter((rec) => rec.ms === UNMOUNT_GRACE_MS && !rec.off).pop().fn();
    for (let i = 0; i < 40 && t.jobs.some((j) => !j.done); i += 1) t.slice();
    assert.equal(t.r.mountedUids().length, 0);
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    const mounted = new Set(t.r.mountedUids());
    assert.equal(mounted.size, 18, "the content pass mounts the light bodies");
    assert.ok(!mounted.has("card00003") && !mounted.has("card00007"), "the slow ones wait");
    t.slice();
    assert.equal(t.r.mountedUids().length, 19, "one slow body a slice");
    t.slice();
    assert.equal(t.r.mountedUids().length, 20);
  } finally { t.done(); }
}));
