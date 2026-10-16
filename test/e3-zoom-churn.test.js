import assert from "node:assert/strict";
import test from "node:test";
import { missingFrames, mountBig, settledIn, taskLedger, zoomBurst } from "./fixtures/big-mount.js";
import budgets from "../tools/live/big-board-budgets.json" with { type: "json" };

// perf2 lane E fix round 3: the browser work a zoom-in leaves to the page (QA4 B zoom-in: 65 long tasks / 7.5 s against
// 26 / 2.5 s in 3.34.0, ~95% of it browser raster and layout).
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const builtAtFit = async (flags = {}) => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { fullscreen: true, flags: { overviewCanvas: false, ...flags }, renderMs: 1 });
  await settledIn(m);
  for (let k = 0; k < 40 && m.view.stats().shells < 1570; k += 1) { await tick(100); await m.pump(50); }
  await tick(700);
  await m.pump(20);
  return m;
};
// The QA bench: "Fit view", then 30 Ctrl-wheel ticks of -20 toward detail. Its runs 1-2 started while the fit's slices
// were still attaching the shells the zoom before had detached (a 483 ms slice task right before the first tick).
const ctrlZoom = async (m, ticks, dy = -20) => {
  const frames = [];
  for (let i = 0; i < ticks; i += 1) {
    m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: dy, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
    await tick(16);
    m.stub.flushFrames();
    await null; await null;
    frames.push(m.view.paintAudit());
  }
  return frames;
};

test("E3-1: a zoom-in burst that starts while the fit's slices are attaching redraws the underlay only at the zoom's 1.35x steps, not every frame", async () => {
  const m = await builtAtFit();
  try {
    await zoomBurst(m, -1, 20);
    assert.equal(m.view.state().lod, "detail");
    m.view.fit();
    for (let i = 0; i < 3; i += 1) m.stub.flushFrames();
    await tick(200); m.stub.flushTimers(); m.stub.flushFrames(); m.stub.flushFrames();
    assert.ok(m.view.paintAudit().attached < 1400, `slices still attaching: ${m.view.paintAudit().attached}`);
    const d0 = m.view.underlayStats();
    const frames = await ctrlZoom(m, 30);
    const d1 = m.view.underlayStats();
    const draws = d1.draws - d0.draws;
    // 0.1 -> 4 is 40x: ln 40 / ln 1.35 = 12.3 sharp steps; each tick is ~1.22x (the bench's -20 Ctrl ticks).
    assert.ok(draws <= budgets.zoomInUnderlayDraws, `underlay redraws in a 30-tick zoom-in burst: ${draws} (resizes ${d1.resizes - d0.resizes})`);
    assert.ok(d1.resizes - d0.resizes <= 3, `bitmap reallocations: ${d1.resizes - d0.resizes}`);
    assert.deepEqual(missingFrames(frames), []);
  } finally { m.done(); }
});

test("E3-1: the gap cover after a zoom into unbuilt cards is redrawn at most once a frame, not once per pump chunk", async () => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { fullscreen: true, renderMs: 1 });
  try {
    await settledIn(m);
    const S = m.stub;
    let frames = 0;
    const flushFrames = S.flushFrames;
    S.flushFrames = () => { const n = flushFrames(); if (n) frames += 1; return n; };
    const d0 = m.view.underlayStats().draws;
    const f0 = frames;
    const audit = [];
    for (let i = 0; i < 9; i += 1) {
      S.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: -20, ctrlKey: true, deltaMode: 0, clientX: 1100, clientY: 120 });
      await tick(16);
      S.flushFrames();
      await null; await null; audit.push(m.view.paintAudit());
    }
    const burstDraws = m.view.underlayStats().draws - d0;
    const d1 = m.view.underlayStats().draws;
    const f1 = frames;
    // Pump chunks run on timers and idle callbacks, several between two frames.
    for (let i = 0; i < 40; i += 1) { await tick(16); S.flushTimers(); S.flushIdle(); S.flushTimers(); S.flushIdle(); S.flushFrames(); await null; await null; audit.push(m.view.paintAudit()); }
    const settleDraws = m.view.underlayStats().draws - d1;
    assert.equal(m.view.state().lod, "detail");
    assert.deepEqual(missingFrames(audit), []);
    assert.ok(settleDraws <= frames - f1, `cover redraws after the burst: ${settleDraws} in ${frames - f1} frames (burst ${burstDraws} in ${f1 - f0})`);
  } finally { m.done(); }
});

// Ratchet: foreground tasks that add or remove 50+ nodes during a zoom-in and its settle. 3.34.0 (acda396) on the same
// fixture and the same steps: 0 from a fully built fit, 4 for the bench's second run (the fit's slices still going).
const zoomInAndSettle = async (m) => {
  await ctrlZoom(m, 30);
  for (let i = 0; i < 60; i += 1) { await tick(30); m.stub.flushTimers(); m.stub.flushFrames(); m.stub.flushIdle(); }
};
test("E3-1 ratchet: a zoom-in changes the DOM in no more foreground tasks than 3.34.0 did; far edges are parked in background slices", async () => {
  const m = await builtAtFit({ idlePark: true });
  try {
    const ledger = await taskLedger(m);
    await zoomInAndSettle(m);
    assert.equal(m.view.state().lod, "detail");
    const fg = ledger.churn();
    assert.ok(fg.length <= budgets.zoomInChurnTasks, `foreground churn tasks, fully built fit: ${fg.length} ${JSON.stringify(fg)}`);
    const parks = ledger.tasks.filter((t) => t.name === "bg:edge-park");
    assert.ok(parks.length >= 1 && parks.every((t) => t.nodes <= 2 * 110), `edge parks in background slices of ~100: ${JSON.stringify(parks.map((t) => t.nodes))}`);
    for (let k = 0; k < 20 && m.view.stats().edgesAttached > budgets.attachedEdgesAtDetail; k += 1) { await tick(120); m.stub.flushTimers(); m.stub.flushIdle(); }
    assert.ok(m.view.stats().edgesAttached <= budgets.attachedEdgesAtDetail, `far edges parked in the end: ${m.view.stats().edgesAttached}`);
    ledger.stop();
  } finally { m.done(); }
});
test("E3-1 ratchet: the bench's second zoom-in (the fit's slices still attaching) changes the DOM in no more foreground tasks than 3.34.0", async () => {
  const m = await builtAtFit();
  try {
    await zoomBurst(m, -1, 20);
    m.view.fit();
    for (let i = 0; i < 3; i += 1) m.stub.flushFrames();
    await tick(200); m.stub.flushTimers(); m.stub.flushFrames(); m.stub.flushFrames();
    const ledger = await taskLedger(m);
    await zoomInAndSettle(m);
    const fg = ledger.churn();
    assert.ok(fg.length <= budgets.zoomInChurnTasksSecondRun, `foreground churn tasks: ${fg.length} ${JSON.stringify(fg)}`);
    ledger.stop();
  } finally { m.done(); }
});

// E3-2: the open at overview (QA4 B: first paint 1.4-1.6 s, max task 1.2-1.4 s against 1.1 s / 0.97 s in 3.34.0). Every
// overview-fast pump chunk drew the cover again: 44 full bitmaps (46 megapixels) in the open of the fixture, styled
// since round 1 (palette fill, border stroke per card), each one a raster and an upload in the browser.
test("E3-2: the open of a big board at overview draws the cover a couple of times, not once per pump chunk", async () => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { fullscreen: true, flags: { overviewCanvas: false } });
  try {
    // Wait by condition, bounded by time (slow runners build the board later).
    const end = Date.now() + 15_000;
    while (Date.now() < end && m.view.stats().shells < 1570) { await tick(20); m.stub.flushFrames(); m.stub.flushTimers(); m.stub.flushIdle(); }
    assert.ok(m.view.stats().shells >= 1500, `the open built the board: ${m.view.stats().shells}`);
    const { draws, resizes } = m.view.underlayStats();
    assert.ok(draws <= 3, `cover draws in the open: ${draws} (resizes ${resizes})`);
  } finally { m.done(); }
});
