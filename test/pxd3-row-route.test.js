// PXD-3: an arrow that ends on a row (a page card's row or a note card's child row) keeps clear of that card's body.
// The row end sits on the side edge at the row's y; a source card below or above leaving from the port that faces
// the card used to run behind it and curl round into the row.
import test from "node:test";
import assert from "node:assert/strict";
import { blockAnchor, center, edgePath, rowEndPath } from "../src/model/geometry.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { createEdgeLayer } from "../src/view/edges.js";
import { mountBoardView } from "../src/view/board-view.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { blk, show, testTree } from "./fixtures/ux4-b.js";

// Samples of the drawn path strictly inside `box` (a little inset: points on the border do not count).
function inside(geo, box, steps = 64) {
  const [p0, p1, p2, p3] = geo.points;
  const cubic = geo.points.length === 4 && geo.d.includes("C");
  let n = 0;
  const hit = (x, y) => { if (x > box.x + 1 && x < box.x + box.w - 1 && y > box.y + 1 && y < box.y + box.h - 1) n += 1; };
  if (cubic) {
    for (let i = 1; i < steps; i++) {
      const t = i / steps, u = 1 - t;
      hit(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y);
    }
    return n;
  }
  for (let s = 1; s < geo.points.length; s++) {
    const a = geo.points[s - 1], b = geo.points[s];
    for (let i = 1; i < steps; i++) hit(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  }
  return n;
}

const target = { x: 0, y: 0, w: 300, h: 280 };
const below = { x: 0, y: 325, w: 300, h: 170 };
const rowEnd = (other, rowTop = 80) => blockAnchor({ rect: target, rowTop, rowHeight: 20, bodyTop: 30, bodyBottom: 280, other: center(other) });

test("PXD-3: a source below the card, leaving from its top port, wraps round the row's side instead of crossing the card", () => {
  const an = rowEnd(below);
  assert.equal(an.side, "right");
  const args = { a: below, b: target, fromSide: "top", toSide: an.side, route: "curve", toPoint: an.point };
  const old = edgePath(args);
  assert.ok(inside(old, target) > 10, "the plain curve runs behind the target card");
  const geo = rowEndPath(args, "to");
  assert.equal(geo.fromSide, "right", "the source leaves from the side the row faces");
  assert.deepEqual(geo.start, { x: 300, y: 410 });
  assert.deepEqual(geo.end, an.point, "the row end stays on the side edge at the row's y");
  assert.equal(geo.toSide, "right");
  assert.equal(inside(geo, target), 0, "nothing inside the target card");
  assert.equal(inside(geo, below), 0, "nothing inside the source card");
  assert.ok(Math.abs(geo.endAngle - Math.PI) < 0.05, "it enters the row from outside, heading into the card");
});

test("PXD-3: the same holds mirrored (source above, bottom port, row on the left) and for the elbow and straight routes", () => {
  const above = { x: -40, y: -260, w: 200, h: 200 };
  const an = rowEnd(above, 160);
  assert.equal(an.side, "left");
  const up = rowEndPath({ a: above, b: target, fromSide: "bottom", toSide: an.side, route: "curve", toPoint: an.point }, "to");
  assert.equal(up.fromSide, "left");
  assert.equal(inside(up, target), 0);
  assert.equal(inside(up, above), 0);
  const an2 = rowEnd(below);
  const elbow = rowEndPath({ a: below, b: target, fromSide: "top", toSide: an2.side, route: "elbow", toPoint: an2.point }, "to");
  assert.ok(inside(edgePath({ a: below, b: target, fromSide: "top", toSide: an2.side, route: "elbow", toPoint: an2.point }), target) > 0);
  assert.equal(inside(elbow, target), 0, "the elbow goes round the outside");
  const straight = rowEndPath({ a: below, b: target, fromSide: "top", toSide: an2.side, route: "straight", toPoint: an2.point }, "to");
  assert.equal(inside(straight, target), 0, "a straight line from the source's facing side clears the card");
});

test("PXD-3: a row on the source card, the target below arriving at its top port, wraps the same way", () => {
  const an = blockAnchor({ rect: target, rowTop: 80, rowHeight: 20, bodyTop: 30, bodyBottom: 280, other: center(below) });
  const args = { a: target, b: below, fromSide: an.side, toSide: "top", route: "curve", fromPoint: an.point };
  assert.ok(inside(edgePath(args), target) > 0);
  const geo = rowEndPath(args, "from");
  assert.equal(geo.toSide, "right");
  assert.deepEqual(geo.start, an.point);
  assert.equal(inside(geo, target), 0);
  assert.equal(inside(geo, below), 0);
});

test("PXD-3: a path that already clears the card, bends, a fixed far end, overlapping cards and no row end are left alone", () => {
  const right = { x: 600, y: 0, w: 260, h: 200 };
  const an = rowEnd(right);
  const clear = { a: right, b: target, fromSide: "left", toSide: an.side, route: "curve", toPoint: an.point };
  assert.deepEqual(rowEndPath(clear, "to"), edgePath(clear), "the stored side stays when the path is clear");
  const an2 = rowEnd(below);
  const crossing = { a: below, b: target, fromSide: "top", toSide: an2.side, route: "curve", toPoint: an2.point };
  assert.deepEqual(rowEndPath(crossing, null), edgePath(crossing), "no row end: plain edgePath");
  const via = { ...crossing, via: [{ x: 500, y: 300 }] };
  assert.deepEqual(rowEndPath(via, "to"), edgePath(via), "manual bends are the user's route");
  const fixed = { ...crossing, fromPoint: { x: 150, y: 330 } };
  assert.deepEqual(rowEndPath(fixed, "to"), edgePath(fixed), "an end on another arrow keeps its normal");
  const overlap = { ...crossing, a: { x: 100, y: 200, w: 300, h: 170 } };
  assert.deepEqual(rowEndPath(overlap, "to"), edgePath(overlap), "overlapping cards: nothing to keep clear");
});

// ------------------------------------------------------------------ edge layer: a page card's row
const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": props, ":block/children": kids });

test("PXD-3: edge layer: an arrow from a note below a page card to one of its rows wraps round the card's side", () => {
  const stub = createDomStub();
  const doc = stub.document;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const over = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const labels = doc.createElement("div");
  doc.body.append(svg, over, labels);
  const layer = createEdgeLayer({ doc, svg, labelsLayer: labels, overlaySvg: over, blockText: () => "row" });
  const restore = stub.install();
  try {
    const board = buildBoard(raw("b1", "{{[[diagram]]:B}}", plx({ v: 2 }), [
      raw("c2", "[[Page]]", plx({ x: 0, y: 0, w: 300, h: 280 }), [], 0),
      raw("c1", "a note", plx({ x: 0, y: 325, w: 300, h: 170 }), [], 1),
      raw("ec", "Connections", plx({ type: "edges" }), [
        raw("e12", "((c1)) → ((row1))", plx({ type: "edge", from: "c1", to: "c2", toBlock: "row1", fromSide: "top" })),
      ], 2),
    ]));
    const rects = worldRects(board);
    layer.render({ board, rects, zoom: 1 });
    layer.setMeasures(new Map([["e12", { to: { rowTop: 80, rowHeight: 20, bodyTop: 30, bodyBottom: 280, rowLeft: 20, rowRight: 260 } }]]));
    layer.update({ board, edgeUids: new Set(["e12"]), rects, zoom: 1 });
    const geo = layer.geometryOf("e12");
    assert.deepEqual(geo.end, { x: 300, y: 90 });
    assert.deepEqual(geo.start, { x: 300, y: 410 }, "the note leaves from its right side");
    assert.equal(inside(geo, rects.get("c2")), 0);
    assert.equal(inside(geo, rects.get("c1")), 0);
    assert.ok(geo.toInner, "the inner segment into the row is still drawn");
    layer.setMeasures(new Map());
    layer.update({ board, edgeUids: new Set(["e12"]), rects, zoom: 1 });
    assert.deepEqual(layer.geometryOf("e12").start, { x: 150, y: 325 }, "no row end: the stored top port again");
  } finally { restore(); }
});

// ------------------------------------------------------------------ board view: a note card's child row (UX4 C1)
const STRINGS = { kidT00001: "test", kidZ00001: "[[Todd Zenger]]", cardHE001: "This is a test", cardSR001: "src" };

function mountBelow() {
  noteSpeedFlags({});
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  const create = stub.document.createElement.bind(stub.document);
  stub.document.createElement = (tag, ...rest) => {
    const el = create(tag, ...rest);
    Object.defineProperty(el, "_rect", {
      configurable: true,
      get() {
        const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
        if (el.classList.contains("pxd-item") && el.getAttribute("data-uid") === "cardHE001") return box(0, 0, 260, 200);
        if (el.classList.contains("pxd-item__body") && el.closest?.('.pxd-item[data-uid="cardHE001"]')) return box(0, 30, 260, 170);
        if (el.classList.contains("pxd-outline__line") && el.parentElement?.getAttribute?.("data-pxd-row") === "kidT00001") return box(20, 60, 180, 20);
        return undefined;
      },
    });
    return el;
  };
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const card = (uid, y, extra = {}, children = []) => ({
    ":block/uid": uid, ":block/string": STRINGS[uid], ":block/order": 0, ":block/children": children,
    ":block/props": { ":plexus": { ":type": "card", ":x": 0, ":y": y, ":w": 260, ":h": 200, ...extra } },
  });
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      card("cardHE001", 0, { ":kids": true }, testTree()),
      card("cardSR001", 300),
      blk("conn00001", "Connections", [
        { ...blk("edge00001", "((cardSR001)) → ((kidT00001))"), ":block/props": { ":plexus": { ":type": "edge", ":from": "cardSR001", ":to": "cardHE001", ":toBlock": "kidT00001", ":fromSide": "top" } } },
      ], { ":block/props": { ":plexus": { ":type": "edges" } } }),
    ],
  });
  const noop = () => Promise.resolve("ok");
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), mutations: [],
    on() { return () => {}; }, release() {}, setLinkMode() {},
    commitMove: noop, commitRects: noop, setKids: noop, setBlockOpen: noop, growToFit: noop, undo: noop, redo: noop, updateEdge: noop, addEdge: noop, setString: noop,
  };
  const host = {
    graph: "Svy",
    renderString(el, string) { el.replaceChildren((el.ownerDocument || globalThis.document).createTextNode(string)); },
    renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }), pullTree: () => [],
    blockString: (uid) => STRINGS[uid] ?? null,
    openInSidebar: noop,
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "3.37.0" });
  const done = () => { try { view.dispose(); } catch { /* gone */ } restore(); noteSpeedFlags(null); };
  return { stub, view, root: view.root, done };
}

test("PXD-3: board view: an unfolded note card's child row, the source card below on its top port: the arrow wraps round the right side", async () => {
  const f = mountBelow();
  try {
    await show(f);
    await show(f);
    const d = f.root.querySelector('.pxd-edge[data-uid="edge00001"] .pxd-edge__line').getAttribute("d");
    const n = String(d).match(/-?\d+(\.\d+)?/g).map(Number);
    assert.deepEqual(n.slice(0, 2), [260, 400], `the source leaves from its right side: ${d}`);
    assert.deepEqual(n.slice(-2), [260, 70], `the arrow ends on the card's right edge at the row's middle: ${d}`);
    const geo = { d, points: [{ x: n[0], y: n[1] }, { x: n[2], y: n[3] }, { x: n[4], y: n[5] }, { x: n[6], y: n[7] }] };
    assert.equal(inside(geo, { x: 0, y: 0, w: 260, h: 200 }), 0, "nothing behind the card");
  } finally { f.done(); }
});
