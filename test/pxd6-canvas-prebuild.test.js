import assert from "node:assert/strict";
import test from "node:test";
import { missingFrames, mountBig, settledIn, withFrozenClock } from "./fixtures/big-mount.js";

// PXD-6 (canvasPrebuild): on the overview canvas tier no card shell was built, so the first zoom into the map band
// built the in-view cards in 12 ms frame chunks (PhD main board live: 62 of 137 after 6 s) and the next map visits
// built the other ~1,450 in the background. The queue now builds on the canvas tier too: background budget, detached.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const OVERVIEW = { x: 300, y: 20, zoom: 0.075 };
const cardsInDom = (m) => m.view.root.querySelectorAll(".pxd-item--card[data-uid]").filter((el) => !el.classList.contains("pxd-item--board")).length;
const total = (m) => m.board.items.size;
// Real clock: the background budget builds a slice per idle turn.
const buildAll = async (m) => {
  for (let i = 0; i < 400 && m.view.stats().shells < total(m); i += 1) { m.stub.flushIdle(); m.stub.flushFrames(); m.stub.flushTimers(); await tick(5); }
};

test("canvasPrebuild: on the overview canvas every queued shell is built in the background, none joins the DOM, and the canvas is not redrawn for them", async () => {
  await withFrozenClock(async () => {
    const m = mountBig(OVERVIEW, { flags: { overviewCanvas: true } });
    try {
      await m.pump(4);
      const draws = m.view.overviewCanvasStats().draws;
      await m.pump(200);
      await m.settle();
      assert.equal(m.view.state().lod, "overview");
      assert.equal(m.view.stats().shells, total(m), "every shell is built");
      assert.equal(cardsInDom(m), 0, "no card shell in the DOM");
      assert.equal(m.view.root.querySelectorAll(".pxd-edge").length, 0, "edges stay hairlines on the canvas");
      assert.ok(m.view.overviewCanvasStats().draws - draws <= 2, `the build redrew the canvas ${m.view.overviewCanvasStats().draws - draws} times`);
      assert.equal(m.view.paintAudit().missing, 0);
    } finally { m.done(); }
  });
});

test("canvasPrebuild: no shell is built inside a wheel burst on the canvas; the build goes on after the settle", async () => {
  const m = mountBig(OVERVIEW, { flags: { overviewCanvas: true } });
  try {
    m.stub.flushFrames();
    const before = m.view.stats().shells;
    assert.ok(before < total(m), `still queued at open (${before} of ${total(m)})`);
    for (let i = 0; i < 6; i += 1) {
      m.stub.dispatch(m.view.root, "wheel", { deltaX: 40, deltaY: 60, deltaMode: 0, clientX: 600, clientY: 400 });
      m.stub.flushFrames();
      m.stub.flushIdle();
    }
    assert.equal(m.view.stats().shells, before, "the burst built nothing");
    await settledIn(m);
    await buildAll(m);
    assert.equal(m.view.stats().shells, total(m), "built after the settle");
    assert.equal(cardsInDom(m), 0);
  } finally { m.done(); }
});

// The R4 hand-back (r4-handback.test.js), after the background build: the zoom attaches shells and builds none.
async function handBack(flags) {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { flags: { overviewCanvas: true, ...flags }, fullscreen: true });
  await settledIn(m);
  if (flags.canvasPrebuild !== false) await buildAll(m);
  const built = m.view.stats().shells;
  const frames = [];
  for (let i = 0; i < 7; i += 1) {
    m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: -20, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
    await tick(16);
    m.stub.flushFrames();
    frames.push(m.view.paintAudit());
  }
  for (let i = 0; i < 40; i += 1) {
    await tick(16);
    m.stub.flushTimers();
    m.stub.flushFrames();
    frames.push(m.view.paintAudit());
  }
  await settledIn(m);
  return { m, built, frames };
}

test("canvasPrebuild: the zoom from the canvas into the map band builds no shell, attaches the in-view cards and never misses one", async () => {
  const { m, built, frames } = await handBack({});
  try {
    assert.equal(built, total(m), "built on the canvas tier");
    assert.equal(m.view.state().lod, "map");
    assert.equal(m.view.stats().shells, built, "the hand-back built nothing");
    assert.deepEqual(missingFrames(frames), []);
    const a = m.view.paintAudit();
    assert.ok(a.inView > 20 && a.attached === a.inView, `in-view cards are shells: ${a.attached} of ${a.inView}`);
  } finally { m.done(); }
});

test("canvasPrebuild off keeps 3.37.0: the queue waits on the canvas tier and the hand-back builds the map shells", async () => {
  const { m, built } = await handBack({ canvasPrebuild: false });
  try {
    const sections = [...m.board.items.values()].filter((item) => item.type === "section" || item.kind === "board").length;
    assert.ok(built <= sections + 1, `only sections and board cards on the canvas tier (${built})`);
    assert.ok(m.view.stats().shells > built, "the hand-back built the map shells");
  } finally { m.done(); }
});
