import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const COLS = 40;
const N = 1000;
const EDGES = 600;

function bigBoard() {
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
  return { ":block/uid": "bigboard01", ":block/string": "{{[[diagram]]:Big}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [...cards, conn] };
}

function mount(vp) {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:bigboard01", JSON.stringify(vp));
  const board = buildBoard(bigBoard());
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
