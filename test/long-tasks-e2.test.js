import assert from "node:assert/strict";
import test from "node:test";
import { createTaskProbe, resetSharedTaskProbe } from "../src/long-tasks.js";
import { resetSharedBgBudget, sharedBgBudget, bindBgBudgetFlag } from "../src/bg-budget.js";
import { mountBig } from "./fixtures/big-mount.js";

// E2-5 (perf2): QA saw 514-595 ms crumb-back tasks and a 4.4 s task at detail pan with no way to name them.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const busy = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* spin */ } };

test("E2-5: a browser long task is attributed to the Plexus spans inside it, by job name, with the board phase", () => {
  let t = 0;
  let push = null;
  class FakeObserver { constructor(cb) { push = (entries) => cb({ getEntries: () => entries }); } observe() {} disconnect() {} }
  const probe = createTaskProbe({ now: () => t, win: { PerformanceObserver: FakeObserver } });
  assert.deepEqual(probe.longTasks(), [], "the first read arms the observer");
  probe.span("settle", () => { t += 40; probe.span("inner", () => { t += 30; }); }, "settling");
  probe.span("bg:shells", () => { t += 20; }, "bg");
  t += 300;
  probe.span("render", () => { t += 5; }, "idle");
  push([{ startTime: 0, duration: 150 }, { startTime: 380, duration: 60 }]);
  const got = probe.longTasks();
  assert.equal(got.length, 1, "only tasks of 100 ms or more");
  assert.deepEqual(got[0].jobs, [{ name: "settle", ms: 70 }, { name: "bg:shells", ms: 20 }], "nested spans count under the outer job");
  assert.equal(got[0].phase, "settling");
  assert.equal(got[0].plexusMs, 90);
});

test("E2-5: with no long-task observer a long Plexus span stands in for its task", () => {
  let t = 0;
  const probe = createTaskProbe({ now: () => t, win: {} });
  probe.observe();
  probe.span("resume", () => { t += 120; }, "resume");
  probe.span("render", () => { t += 30; }, "idle");
  assert.deepEqual(probe.longTasks().map((x) => [x.ms, x.jobs[0].name, x.phase]), [[120, "resume", "resume"]]);
});

test("E2-5: view.longTasks() names a slow background job on the real board view", async () => {
  resetSharedTaskProbe();
  resetSharedBgBudget();
  bindBgBudgetFlag(() => true);
  const m = mountBig({ x: 0, y: 0, zoom: 0.3 });
  const realRic = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => setTimeout(() => fn({ timeRemaining: () => 20, didTimeout: false }), 0);
  try {
    await m.pump(10);
    await tick(400);
    let ran = false;
    sharedBgBudget().idle(() => { ran = true; busy(110); }, { label: "test-slow", quiet: 0 });
    for (let i = 0; i < 60 && !ran; i += 1) await tick(20);
    assert.ok(ran, "the job ran");
    const tasks = m.view.longTasks();
    const bg = tasks.find((x) => x.jobs[0]?.name === "bg:test-slow");
    assert.ok(bg, `a long task named by its job: ${JSON.stringify(tasks)}`);
    assert.equal(bg.phase, "bg");
  } finally {
    globalThis.requestIdleCallback = realRic;
    m.done();
    resetSharedBgBudget();
    resetSharedTaskProbe();
  }
});

test("E2-5: view.slowMounts() names a card body whose mount took 50 ms or more", async () => {
  const m = mountBig({ x: -2000, y: -1500, zoom: 1 }, { renderMs: 60 });
  try {
    for (let i = 0; i < 20 && !m.view.slowMounts().length; i += 1) { await m.pump(5); await tick(20); }
    const got = m.view.slowMounts();
    assert.ok(got.length > 0, "a slow mount is logged");
    assert.ok(got[0].uid && got[0].ms >= 50, JSON.stringify(got[0]));
  } finally { m.done(); }
});
