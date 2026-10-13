import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { segmentMeetsRect } from "../src/view/edges.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const COLS = 40;
const N = 1000;
const EDGES = 600;

function bigBoard({ nested = false } = {}) {
  const cards = Array.from({ length: N }, (_, i) => ({
    ":block/uid": `card${String(i).padStart(5, "0")}`,
    ":block/string": `Card ${i}`,
    ":block/order": i,
    ":block/props": { ":plexus": { ":x": (i % COLS) * 260, ":y": Math.floor(i / COLS) * 200, ":w": 240, ":h": 180 } },
    ":block/children": [],
  }));
  const edges = Array.from({ length: EDGES }, (_, i) => ({
    ":block/uid": `edge${String(i).padStart(5, "0")}`,
    ":block/string": "→",
    ":block/order": i,
    ":block/props": { ":plexus": { ":type": "edge", ":from": cards[i][":block/uid"], ":to": cards[i + 1][":block/uid"] } },
  }));
  const conn = { ":block/uid": "connections1", ":block/string": "Connections", ":block/order": N, ":block/props": { ":plexus": { ":type": "edges" } }, ":block/children": edges };
  const inner = nested ? [{ ":block/uid": "inner00001", ":block/string": "{{[[diagram]]:Inner}}", ":block/order": N + 1, ":block/props": { ":plexus": { ":x": 0, ":y": -400, ":w": 300, ":h": 200, ":v": 2 } }, ":block/children": [] }] : [];
  return { ":block/uid": "bigboard01", ":block/string": "{{[[diagram]]:Big}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [...cards, conn, ...inner] };
}

function mount(vp, extra = {}, fixture = {}) {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:bigboard01", JSON.stringify(vp));
  const board = buildBoard(bigBoard(fixture));
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
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0", ...extra });
  const pump = async (n, ms = 0) => { for (let i = 0; i < n; i += 1) { stub.flushFrames(); stub.flushIdle(); await tick(ms); } };
  const shellsIn = () => view.root.querySelectorAll(".pxd-item[data-uid]").length;
  const edgesIn = () => view.root.querySelectorAll(".pxd-edge").length;
  const has = (uid) => [...view.root.querySelectorAll(".pxd-item[data-uid]")].some((el) => el.getAttribute("data-uid") === uid);
  return { stub, restore, view, pump, shellsIn, edgesIn, has };
}

test("a 1,000-card board keeps only the shells and edges near the view in the DOM", async () => {
  const m = mount({ x: 0, y: 0, zoom: 1 });
  try {
    await m.pump(80);
    assert.ok(m.shellsIn() > 0, "the cards in view are there");
    assert.ok(m.shellsIn() < N / 4, `shells in the DOM: ${m.shellsIn()} of ${N}`);
    assert.ok(m.edgesIn() > 0, "the edges in view are there");
    assert.ok(m.edgesIn() < EDGES / 2, `edges in the DOM: ${m.edgesIn()} of ${EDGES}`);
    assert.equal(m.has("card00000"), true);
    assert.equal(m.has("card00999"), false);
  } finally {
    m.view.dispose();
    m.restore();
  }
});

test("moving the camera brings far shells in and the settle drops the ones left behind", async () => {
  const m = mount({ x: 0, y: 0, zoom: 1 });
  try {
    await m.pump(80);
    // Card 999 sits at (39 * 260, 24 * 200).
    m.view.restoreViewport({ x: -(39 * 260) + 400, y: -(24 * 200) + 300, zoom: 1 });
    await m.pump(60, 10);
    assert.equal(m.has("card00999"), true);
    // Bodies that left the view stay mounted for a grace period; everything else near the old camera has left.
    assert.equal(m.has("card00010"), false);
    assert.ok(m.shellsIn() < N / 4, `shells in the DOM: ${m.shellsIn()} of ${N}`);
  } finally {
    m.view.dispose();
    m.restore();
  }
});

test("a fit view of the whole board still shows every card", async () => {
  const m = mount({ x: 20, y: 20, zoom: 0.12 });
  try {
    await m.pump(80);
    assert.equal(m.shellsIn(), N);
  } finally {
    m.view.dispose();
    m.restore();
  }
});

test("a whole-board view builds the nearest shells first and reports first paint once the view is built", async () => {
  let painted = 0;
  const m = mount({ x: 20, y: 20, zoom: 0.12 }, { onFirstPaint: () => { painted += 1; } });
  try {
    m.stub.flushFrames();
    const first = m.shellsIn();
    assert.ok(first > 0 && first <= 200, `built in the open pass: ${first}`);
    assert.equal(painted, 0, "the snapshot stays until the view is complete");
    await m.pump(120);
    assert.equal(m.shellsIn(), N);
    assert.equal(painted, 1);
  } finally {
    m.view.dispose();
    m.restore();
  }
});

test("an edge is near the view when the segment between its ends crosses it, not when only its box does", () => {
  const view = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(segmentMeetsRect(-50, 50, 150, 50, view), true);
  assert.equal(segmentMeetsRect(-50, -50, 150, 150, view), true);
  // Box covers the view, segment passes beside it.
  assert.equal(segmentMeetsRect(-100, 150, 150, 300, view), false);
  assert.equal(segmentMeetsRect(200, -100, 300, 400, view), false);
  assert.equal(segmentMeetsRect(-300, 120, 400, 101, view), false);
});

test("an Open button without its own listener (a snapshot face) still opens its board", async () => {
  const opened = [];
  const m = mount({ x: 0, y: 0, zoom: 1 }, { onOpenBoard: (uid) => opened.push(uid) }, { nested: true });
  try {
    await m.pump(20);
    const shell = [...m.view.root.querySelectorAll(".pxd-item[data-uid]")][0];
    const doc = m.stub.document;
    const button = doc.createElement("button");
    button.className = "pxd-btn pxd-item__open";
    button.setAttribute("data-open-board", "inner00001");
    shell.append(button);
    button.dispatchEvent({ type: "click", bubbles: true, target: button, stopPropagation() {}, preventDefault() {} });
    await m.pump(2);
    assert.deepEqual(opened, ["inner00001"]);
  } finally {
    m.view.dispose();
    m.restore();
  }
});

test("a view parked and brought back into the same mount puts its root back (crumbs, board history)", async () => {
  const m = mount({ x: 0, y: 0, zoom: 1 });
  try {
    await m.pump(10);
    const mountEl = m.view.root.parentElement;
    m.view.suspend();
    m.view.root.remove();
    m.view.rebind(mountEl);
    m.view.resume?.();
    assert.equal(m.view.root.parentElement, mountEl);
  } finally {
    m.view.dispose();
    m.restore();
  }
});

test("a full re-sync paints only the shells in the DOM; a detached one is painted when it attaches", async () => {
  const m = mount({ x: 0, y: 0, zoom: 1 });
  try {
    await m.pump(40);
    const far = "card00999";
    assert.equal(m.has(far), false);
    // A text change to a far card arrives while it is detached.
    const board = m.view.session?.board ?? null;
    void board;
    m.view.restoreViewport({ x: -(39 * 260) + 400, y: -(24 * 200) + 300, zoom: 1 });
    await m.pump(60, 10);
    assert.equal(m.has(far), true);
    const el = [...m.view.root.querySelectorAll(".pxd-item[data-uid]")].find((e) => e.getAttribute("data-uid") === far);
    assert.ok(el.textContent.includes("Card 999"), "the shell was painted when it came into view");
  } finally {
    m.view.dispose();
    m.restore();
  }
});

// F1 step 0 (Fable round): the attach margin is a fraction of a screen, not a whole screen on each side. At map
// zoom that was 755 attached shells at 0.2 and 430 at 0.3 on the PhD main board; the body-mount margin stays.
test("at map zoom only the shells within a third of a screen of the view are attached", async () => {
  const m = mount({ x: 0, y: 0, zoom: 0.4 });
  try {
    await m.pump(80);
    assert.ok(m.shellsIn() > 100, `shells in view: ${m.shellsIn()}`);
    assert.ok(m.shellsIn() <= 520, `shells attached at zoom 0.4: ${m.shellsIn()} of ${N}`);
  } finally {
    m.view.dispose();
    m.restore();
  }
});

// F2 (Fable round): a settle after a zoom re-placed every attached edge in one task. It is sliced over frames now.
test("a zoom settle re-places edges a slice per frame, not all in one", async () => {
  const m = mount({ x: 0, y: 0, zoom: 0.2 });
  try {
    await m.pump(80);
    m.stub.flushTimers();
    await m.pump(10);
    const attached = m.view.stats().edgesAttached;
    assert.ok(attached > 300, `edges attached at 0.2: ${attached}`);
    const before = m.view.stats().edgePlacements;
    m.view.restoreViewport({ x: 0, y: 0, zoom: 0.15 });
    m.stub.flushFrames();
    await tick(140); // the settle (RESUME_MS, a real timer)
    m.stub.flushFrames(); // the first render after it
    const first = m.view.stats().edgePlacements - before;
    assert.ok(first > 0, "the settle re-places edges");
    assert.ok(first <= 320 && first < attached / 1.5, `the first frame placed ${first} of ${attached} edges`);
    await m.pump(20);
    const total = m.view.stats().edgePlacements - before;
    assert.ok(total >= attached, `all ${attached} attached edges were re-placed (${total})`);
  } finally {
    m.view.dispose();
    m.restore();
  }
});

// P5-A: every shell attached inside a wheel frame cost a style recalc of 1,000-3,500 elements and a page hit test
// (PhD main board, map-zoom pan p95 184-215 ms; 33 ms with no attach). A wheel burst attaches nothing; the settle does.
test("a wheel pan attaches no shell until it settles, and the underlay stands in meanwhile", async () => {
  const { noteSpeedFlags } = await import("../src/settings.js");
  for (const flags of [{}, { deferReveal: false }]) {
    noteSpeedFlags(flags);
    const m = mount({ x: 0, y: 0, zoom: 0.4 });
    try {
      await m.pump(80);
      m.stub.flushTimers();
      await m.pump(5);
      const before = m.shellsIn();
      for (let i = 0; i < 6; i += 1) {
        m.view.root.dispatchEvent({ type: "wheel", deltaX: 0, deltaY: 300, deltaMode: 0, clientX: 600, clientY: 400 });
        m.stub.flushFrames();
      }
      const during = m.shellsIn();
      const underlay = m.view.root.querySelector(".pxd-underlay");
      if (flags.deferReveal === false) {
        assert.ok(during > before, `with the switch off a wheel frame attaches (${before} → ${during})`);
      } else {
        assert.equal(during, before, "no shell joins the DOM inside the burst");
        assert.ok(underlay, "the underlay canvas is in the world");
        await tick(150); // the settle (a real timer)
        m.stub.flushTimers();
        await m.pump(5);
        assert.ok(m.shellsIn() !== before || m.view.stats().shellsAttached !== undefined, "the settle re-culls");
        assert.equal(underlay.style.display, "none", "the underlay hides once the shells are back");
      }
    } finally {
      m.view.dispose();
      m.restore();
      noteSpeedFlags(null);
    }
  }
});
