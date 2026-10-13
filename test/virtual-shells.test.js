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
