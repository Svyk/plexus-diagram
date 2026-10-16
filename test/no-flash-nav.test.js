import assert from "node:assert/strict";
import test from "node:test";
import { bigBoardTree } from "../src/model/stress-board.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// perf2 lane E: no-flash navigation and tier flips on the 1,560-card fixture, through the view's real entry points.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export function mountBig(vp, { flags = {}, fullscreen = false, theme = null, prep = null } = {}) {
  noteSpeedFlags(flags);
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  if (theme) Object.assign(stub.theme, theme);
  stub.localStorage.setItem("plexus-diagram:vp:Svy:bigroot", JSON.stringify(vp));
  const board = buildBoard(bigBoardTree());
  prep?.(board);
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

// The cover (queued cards of an overview-fast open) and the burst underlay drew every card as a plain --pxd-card box.
// On a coloured board that reads as the cards vanishing (QA1 Part C #1, C-crumb-044: grey boxes after the snapshot).
const VARS = {
  "--pxd-card": "#26333f", "--pxd-border-strong": "#6b7f91",
  "--pxd-red-line": "#f87171", "--pxd-red-fill": "transparent",
  "--pxd-teal-line": "#2dd4bf", "--pxd-teal-fill": "#f0fdfa",
};
const colourCards = (board) => {
  let i = 0;
  for (const item of board.items.values()) {
    if (item.type === "section") continue;
    item.color = i % 3 === 0 ? "red" : i % 3 === 1 ? "teal" : "";
    i += 1;
  }
};

test("styledUnderlay: the open cover draws queued cards the way the cards look (card fill, palette fill, palette border)", async () => {
  await withFrozenClock(async () => {
    const m = mountBig({ x: 0, y: 0, zoom: 0.3 }, { theme: VARS, prep: colourCards });
    try {
      m.stub.flushFrames();
      const canvas = m.view.root.querySelector(".pxd-underlay");
      assert.ok(canvas && canvas.style.display !== "none", "queued cards are covered");
      const ops = canvas.__ctx.ops.map((op) => op.join(" "));
      assert.ok(ops.includes("fill #26333f"), `card fill: ${ops.slice(0, 8)}`);
      assert.ok(ops.includes("fill #f0fdfa"), "teal palette fill over it");
      assert.ok(ops.includes("stroke #f87171") && ops.includes("stroke #2dd4bf") && ops.includes("stroke #6b7f91"), "borders in the card's line colour");
    } finally { m.done(); }
  });
});

test("styledUnderlay: at overview the cover fills a coloured card with its line colour, as the overview CSS does", async () => {
  await withFrozenClock(async () => {
    const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { theme: VARS, prep: colourCards });
    try {
      m.stub.flushFrames();
      assert.equal(m.view.state().lod, "overview");
      const canvas = m.view.root.querySelector(".pxd-underlay");
      assert.ok(canvas && canvas.style.display !== "none", "queued cards are covered");
      const ops = canvas.__ctx.ops.map((op) => op.join(" "));
      assert.ok(ops.includes("fillRect #f87171") && ops.includes("fillRect #2dd4bf"), `line-colour boxes: ${ops.slice(0, 6)}`);
      assert.ok(ops.includes("fillRect #26333f"), "an uncoloured card is the card colour");
    } finally { m.done(); }
  });
});

test("styledUnderlay off draws the 3.34.0 plain boxes", async () => {
  await withFrozenClock(async () => {
    const m = mountBig({ x: 0, y: 0, zoom: 0.3 }, { flags: { styledUnderlay: false }, theme: VARS, prep: colourCards });
    try {
      m.stub.flushFrames();
      const ops = m.view.root.querySelector(".pxd-underlay").__ctx.ops.map((op) => op.join(" "));
      assert.ok(ops.length > 0 && ops.every((op) => op === "fillRect #26333f"), `plain: ${ops.slice(0, 4)}`);
    } finally { m.done(); }
  });
});

// A Ctrl-wheel zoom burst on the fixture, then every frame until the settle's slices are done. Real clock: the wheel
// zoom gesture ends on a real 160 ms timer (interactions.js) and the settle is a real 120 ms timer.
async function zoomBurst(m, dir, ticks) {
  const frames = [];
  const audit = async () => { await null; await null; frames.push(m.view.paintAudit()); };
  await audit();
  for (let i = 0; i < ticks; i += 1) {
    m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: 60 * dir, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
    m.stub.flushFrames();
    await audit();
  }
  for (let i = 0; i < 30; i += 1) { await tick(30); m.stub.flushTimers(); m.stub.flushFrames(); await audit(); m.stub.flushIdle(); }
  for (let i = 0; i < 80; i += 1) { m.stub.flushFrames(); await audit(); m.stub.flushIdle(); m.stub.flushTimers(); }
  return frames;
}
const settledIn = async (m) => { await m.pump(300); await m.settle(); await tick(200); await m.pump(100); };
const missingFrames = (frames) => frames.filter((f) => f.missing > 0).map((f) => `${f.lod}:${f.attached}+${f.covered}/${f.inView}`);

test("E2: a zoom-out from detail to overview shows every in-view card in every frame, and the burst closes", async () => {
  for (const flags of [{}, { overviewCanvas: true }]) {
    const m = mountBig({ x: -2000, y: -1500, zoom: 1 }, { flags });
    try {
      await settledIn(m);
      const frames = await zoomBurst(m, 1, 14);
      assert.equal(m.view.state().lod, "overview");
      assert.deepEqual(missingFrames(frames), [], `frames with cards in neither a shell nor a box (${JSON.stringify(flags)})`);
      assert.equal(m.view.root.querySelector(".pxd-world").style.willChange, "", "the wheel burst closed after the zoom gesture");
      if (flags.overviewCanvas) assert.ok(m.view.overviewCanvasStats().shown, "the overview canvas shows the cards");
      else assert.equal(frames.at(-1).attached, frames.at(-1).inView, "every in-view shell is attached in the end");
    } finally { m.done(); }
  }
});

test("E3: a zoom-in from overview to detail shows every in-view card in every frame, and the flip restyles only near shells", async () => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 });
  try {
    await settledIn(m);
    const frames = await zoomBurst(m, -1, 16);
    assert.equal(m.view.state().lod, "detail");
    assert.deepEqual(missingFrames(frames), []);
    const at = m.view.flipStats().attachedAtFlip.at(-1);
    assert.ok(at <= 120, `attached shells when the tier flipped: ${at}`);
  } finally { m.done(); }
});
