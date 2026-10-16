import assert from "node:assert/strict";
import test from "node:test";
import { bigBoardTree } from "../src/model/stress-board.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// perf2 lane E: no-flash navigation and tier flips on the 1,560-card fixture, through the view's real entry points.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export function mountBig(vp, { flags = {}, fullscreen = false } = {}) {
  noteSpeedFlags(flags);
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:bigroot", JSON.stringify(vp));
  const board = buildBoard(bigBoardTree());
  const host = {
    stats: {}, graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid) { el.textContent = uid; },
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }), pullTree: () => [], blockString: () => null,
    openBlock() {}, openInSidebar() {}, searchPages: () => [], searchBlocks: () => [], related: () => [],
  };
  const session = { uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), on() { return () => {}; }, release() {}, setLinkMode() {} };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0", fullscreen });
  const pump = async (n) => {
    for (let i = 0; i < n; i += 1) { stub.flushFrames(); stub.flushIdle(); stub.flushTimers(); }
    await tick(0);
    for (let i = 0; i < 4; i += 1) { stub.flushFrames(); stub.flushIdle(); stub.flushTimers(); }
  };
  const settle = async () => { await tick(160); await pump(4); };
  const done = () => { try { view.dispose(); } catch { /* gone */ } restore(); noteSpeedFlags(null); };
  return { stub, view, mountEl, pump, settle, done, board, session };
}

export const withFrozenClock = async (fn) => {
  const realNow = globalThis.performance.now;
  globalThis.performance.now = () => 1_000_000;
  try { await fn(); } finally { globalThis.performance.now = realNow; }
};

test("E1: a parked fullscreen board lets go of the mount's chrome observers, takes them back on unpark, and its dispose leaves the mount fullscreen", async () => {
  const m = mountBig({ x: 0, y: 0, zoom: 1 }, { fullscreen: true });
  try {
    await m.pump(4);
    assert.ok(m.mountEl.classList.contains("pxd-mount--fullscreen"));
    m.view.suspend();
    assert.equal(m.view.park(), true);
    m.view.unpark();
    m.view.resume();
    assert.ok(m.mountEl.classList.contains("pxd-mount--fullscreen"), "still fullscreen after the way back");
    m.view.suspend();
    m.view.park();
    // Another board shows fullscreen in this mount now; the parked one is dropped from the pool.
    m.view.dispose();
    assert.ok(m.mountEl.classList.contains("pxd-mount--fullscreen"), "disposing a parked board does not undo the mount's fullscreen");
  } finally { m.done(); }
});
