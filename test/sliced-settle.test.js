import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// C1 (perf2): the settle after a fit or a zoom out attached every near shell and every near edge in one task
// (PhD MAIN at fit: ~1,500 shells + ~2,114 edges, a 60-120 ms settle). It now attaches a slice per frame, nearest
// the view centre first, with the underlay boxes up until both queues are empty.
const COLS = 40;

function bigBoard(n, hops = 1) {
  const cards = Array.from({ length: n }, (_, i) => ({
    ":block/uid": `card${String(i).padStart(5, "0")}`,
    ":block/string": `Card ${i}`,
    ":block/order": i,
    ":block/props": { ":plexus": { ":x": (i % COLS) * 260, ":y": Math.floor(i / COLS) * 200, ":w": 240, ":h": 180 } },
    ":block/children": [],
  }));
  const edges = [];
  for (let k = 1; k <= hops; k += 1) {
    for (let i = 0; i < Math.min(900 * k, n - k); i += 1) {
      const j = edges.length;
      edges.push({
        ":block/uid": `edge${String(j).padStart(5, "0")}`,
        ":block/string": "→",
        ":block/order": j,
        ":block/props": { ":plexus": { ":type": "edge", ":from": cards[i][":block/uid"], ":to": cards[i + k][":block/uid"] } },
      });
    }
  }
  const conn = { ":block/uid": "connections1", ":block/string": "Connections", ":block/order": n, ":block/props": { ":plexus": { ":type": "edges" } }, ":block/children": edges };
  return { ":block/uid": "bigboard01", ":block/string": "{{[[diagram]]:Big}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [...cards, conn] };
}

function mount(n, vp, hops = 1) {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:bigboard01", JSON.stringify(vp));
  const board = buildBoard(bigBoard(n, hops));
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
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
  const shellsIn = () => view.root.querySelectorAll(".pxd-item[data-uid]").length;
  const edgesIn = () => view.root.querySelectorAll(".pxd-edge").length;
  const has = (uid) => [...view.root.querySelectorAll(".pxd-item[data-uid]")].some((el) => el.getAttribute("data-uid") === uid);
  // Frozen clock: a slice ends on its count, never on time.
  const flush = (k = 1) => { for (let i = 0; i < k; i += 1) { stub.flushFrames(); stub.flushIdle(); stub.flushTimers(); } };
  return { stub, restore, view, shellsIn, edgesIn, has, flush };
}

const withFrozenClock = async (fn) => {
  const realNow = globalThis.performance.now;
  globalThis.performance.now = () => 1_000_000;
  try { await fn(); } finally { globalThis.performance.now = realNow; }
};

// The settle is a real 120 ms timer (createTimers uses the global setTimeout). Bounded by time, not count.
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
// Build every shell at detail, far from (0, 0), then move the camera to a fit of the whole board.
const toFit = async (m) => {
  m.flush(40);
  // The mount's own content pass is a real 0 ms timer.
  await tick(5);
  m.flush(5);
  m.view.restoreViewport({ x: 50, y: 50, zoom: 0.12 });
  // The camera frame (a revealNear slice), then the settle timer.
  m.stub.flushFrames();
};
const waitSettle = async (m, done) => {
  const until = Date.now() + 3000;
  do { await tick(40); } while (!done() && Date.now() < until);
};

const underlayShown = (m) => {
  const u = m.view.root.querySelector(".pxd-underlay");
  return Boolean(u && u.style.display !== "none");
};

test("a fit settle on a 1,500-card board attaches a slice per frame and finishes over several frames", async () => {
  await withFrozenClock(async () => {
    noteSpeedFlags({ overviewCanvas: false });
    const m = mount(1500, { x: -200000, y: -200000, zoom: 1 });
    try {
      await toFit(m);
      const before = m.shellsIn();
      await waitSettle(m, () => m.shellsIn() > before);
      const afterSettle = m.shellsIn();
      assert.ok(afterSettle - before <= 48, `the settle task attaches one slice (${before} → ${afterSettle})`);
      assert.ok(m.edgesIn() <= 200, `the settle task builds one edge slice (${m.edgesIn()})`);
      assert.ok(underlayShown(m), "the boxes stay up while shells are queued");
      let frames = 0;
      let prev = afterSettle;
      let worst = 0;
      while (m.stub.flushFrames() && frames < 200) {
        frames += 1;
        const now = m.shellsIn();
        worst = Math.max(worst, now - prev);
        prev = now;
        if (now >= 1500 && !underlayShown(m)) break;
      }
      assert.ok(worst <= 48, `at most one slice per frame (worst ${worst})`);
      assert.ok(frames >= 10, `the attach spreads over frames (${frames})`);
      assert.equal(m.shellsIn(), 1500, "every near shell is attached in the end");
      assert.ok(m.edgesIn() >= 850, `the near edges are back (${m.edgesIn()})`);
      assert.equal(underlayShown(m), false, "the underlay hides once both queues are empty");
    } finally {
      m.view.dispose();
      m.restore();
      noteSpeedFlags(null);
    }
  });
});

test("the underlay hides only once both the shell and the edge queues are empty", async () => {
  await withFrozenClock(async () => {
    noteSpeedFlags({ overviewCanvas: false });
    const m = mount(1500, { x: -200000, y: -200000, zoom: 1 }, 3);
    const total = 900 + 1498 + 1497;
    try {
      await toFit(m);
      const b0 = m.shellsIn();
      await waitSettle(m, () => m.shellsIn() > b0);
      assert.ok(m.edgesIn() <= 200, `the camera frame and the settle task build one edge slice each (${m.edgesIn()})`);
      for (let i = 0; i < 400; i += 1) {
        m.stub.flushFrames();
        const edgesDone = m.edgesIn() >= total;
        if (!underlayShown(m)) {
          assert.ok(edgesDone, `underlay hid with ${m.edgesIn()} of ${total} edges`);
          assert.equal(m.shellsIn(), 1500, "underlay hid with shells still detached");
          break;
        }
      }
      assert.equal(underlayShown(m), false);
      assert.equal(m.edgesIn(), total);
    } finally {
      m.view.dispose();
      m.restore();
      noteSpeedFlags(null);
    }
  });
});

test("a click on a box that is not attached yet selects that card", async () => {
  await withFrozenClock(async () => {
    noteSpeedFlags({ overviewCanvas: false });
    const m = mount(1500, { x: -200000, y: -200000, zoom: 1 });
    try {
      await toFit(m);
      const b0 = m.shellsIn();
      await waitSettle(m, () => m.shellsIn() > b0);
      // The far corner card attaches last (nearest the centre first).
      const uid = "card01480"; // column 0, row 37: the bottom-left corner
      assert.equal(m.has(uid), false, "the far card is still a box");
      const rect = m.view.root.getBoundingClientRect?.() || { left: 0, top: 0 };
      const x = (rect.left || 0) + 50 + 120 * 0.12;
      const y = (rect.top || 0) + 50 + (37 * 200 + 90) * 0.12;
      m.stub.dispatch(m.view.root, "pointerdown", { button: 0, buttons: 1, clientX: x, clientY: y, pointerId: 7 });
      m.stub.dispatch(m.view.root, "pointerup", { button: 0, buttons: 0, clientX: x, clientY: y, pointerId: 7 });
      assert.deepEqual(m.view.state().selection, [uid]);
      assert.equal(m.has(uid), true, "the clicked card is a real shell now");
    } finally {
      m.view.dispose();
      m.restore();
      noteSpeedFlags(null);
    }
  });
});

test("slicedSettle off attaches everything in the settle task, as 3.34.0 did", async () => {
  await withFrozenClock(async () => {
    noteSpeedFlags({ slicedSettle: false, overviewCanvas: false });
    const m = mount(1500, { x: -200000, y: -200000, zoom: 1 });
    try {
      await toFit(m);
      await waitSettle(m, () => m.shellsIn() >= 1500);
      assert.equal(m.shellsIn(), 1500, "one task attaches every shell");
      assert.equal(underlayShown(m), false);
    } finally {
      m.view.dispose();
      m.restore();
      noteSpeedFlags(null);
    }
  });
});

test("a board under the virtual threshold settles exactly as before", async () => {
  await withFrozenClock(async () => {
    for (const flags of [{}, { slicedSettle: false }]) {
      noteSpeedFlags({ overviewCanvas: false, ...flags });
      const m = mount(300, { x: -200000, y: -200000, zoom: 1 });
      try {
        await toFit(m);
        await tick(300);
        assert.equal(m.shellsIn(), 300, `all shells (${JSON.stringify(flags)})`);
        assert.equal(underlayShown(m), false);
      } finally {
        m.view.dispose();
        m.restore();
        noteSpeedFlags(null);
      }
    }
  });
});
