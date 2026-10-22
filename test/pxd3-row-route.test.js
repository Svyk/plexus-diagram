// PXD-3: an arrow with an end (or both) on a row (a page card's row or a note card's child row) keeps clear of the
// row's card body, on every route.
// The row end sits on the side edge at the row's y; a source card below or above leaving from the port that faces
// the card used to run behind it and curl round into the row.
import test from "node:test";
import assert from "node:assert/strict";
import { blockAnchor, center, edgePath, rowEndPath } from "../src/model/geometry.js";
import { routeAround } from "../src/model/section6.js";
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

test("PXD-3: a corner clip between two samples still counts as crossing the card", () => {
  const left = { x: -325, y: 300, w: 300, h: 170 };
  const an = rowEnd(left, 40);
  assert.equal(an.side, "left");
  const args = { a: left, b: target, fromSide: "right", toSide: an.side, route: "curve", toPoint: an.point };
  assert.ok(inside(edgePath(args), target, 256) > 0, "the plain curve clips the card's bottom-left corner");
  const geo = rowEndPath(args, "to");
  assert.notEqual(geo.fromSide, "right");
  assert.equal(inside(geo, target, 256), 0);
});

test("PXD-3: elbow stubs that face the same way meet on the outer lane; a plain elbow keeps the halfway lane", () => {
  const narrow = { x: 75, y: 300, w: 160, h: 100 };
  const an = rowEnd(narrow, 40);
  const args = { a: narrow, b: target, fromSide: "top", toSide: an.side, route: "elbow", toPoint: an.point };
  const geo = rowEndPath(args, "to");
  assert.equal(geo.fromSide, "right");
  assert.equal(inside(geo, target), 0);
  assert.ok(geo.points.every((p) => p.x <= target.x || p.x >= target.x + target.w || p.y <= target.y || p.y >= target.y + target.h), `no corner inside the card: ${geo.d}`);
  const plain = edgePath({ ...args, fromSide: "right" });
  assert.ok(inside(plain, target) > 0, "without wrap the same-facing lane sits halfway, inside the card");
});

test("PXD-3: curve and elbow arrows from a card to a row never cross the row's card, wherever the card is", () => {
  for (const route of ["curve", "elbow"]) for (const [w, h] of [[300, 170], [160, 100], [500, 200]]) for (const rowTop of [-60, 40, 240]) {
    for (let x = -700; x <= 700; x += 50) for (let y = -600; y <= 600; y += 50) {
      const src = { x, y, w, h };
      if (src.x < target.x + target.w + 10 && target.x < src.x + src.w + 10 && src.y < target.y + target.h + 10 && target.y < src.y + src.h + 10) continue;
      for (const fromSide of ["top", "right", "bottom", "left", "auto"]) {
        const an = rowEnd(src, rowTop);
        const geo = rowEndPath({ a: src, b: target, fromSide, toSide: an.side, route, toPoint: an.point }, "to");
        if (inside(geo, target, 128)) assert.fail(`${route} from ${JSON.stringify(src)} side ${fromSide} row ${rowTop}: ${geo.d}`);
      }
    }
  }
});

test("PXD-3: a straight line from a narrower card below bends just outside the row card's corner and enters the row level", () => {
  const small = { x: 50, y: 325, w: 200, h: 80 };
  const an = rowEnd(small);
  assert.equal(an.side, "right");
  const args = { a: small, b: target, fromSide: "top", toSide: an.side, route: "straight", toPoint: an.point };
  for (const fromSide of ["top", "right", "bottom", "left"]) {
    assert.ok(inside(edgePath({ ...args, fromSide }), target) > 0, `no straight line from the ${fromSide} port reaches the row's edge`);
  }
  const geo = rowEndPath(args, "to");
  assert.equal(inside(geo, target, 256), 0, geo.d);
  assert.equal(inside(geo, small, 256), 0, geo.d);
  assert.deepEqual(geo.end, an.point, "the row end stays on the side edge at the row's y");
  assert.ok(geo.d.indexOf("C") < 0, "still straight legs");
  assert.ok(Math.abs(geo.endAngle - Math.PI) < 1e-9, "the last leg enters the row level, heading into the card");
});

test("PXD-3: a minimum-size text card just above the card swings its curve wide enough to clear the corner", () => {
  const text = { x: 110, y: -40, w: 60, h: 24 };
  const an = rowEnd(text);
  const args = { a: text, b: target, fromSide: "auto", toSide: an.side, route: "curve", toPoint: an.point };
  assert.ok(inside(edgePath(args), target, 256) > 0);
  const geo = rowEndPath(args, "to");
  assert.equal(inside(geo, target, 256), 0, geo.d);
  assert.deepEqual(geo.end, an.point);
});

// Placements around the target: a grid, plus cards close to each side (touching included).
function* around(w, h, step) {
  for (let x = -w - 260; x <= 560; x += step) for (let y = -h - 260; y <= 540; y += step) yield { x, y, w, h };
  for (const g of [0, 6, 20]) {
    for (let t = -w - 40; t <= target.w + 40; t += 40) { yield { x: t, y: -h - g, w, h }; yield { x: t, y: target.h + g, w, h }; }
    for (let t = -h - 40; t <= target.h + 40; t += 40) { yield { x: -w - g, y: t, w, h }; yield { x: target.w + g, y: t, w, h }; }
  }
}
const apart = (r) => !(r.x < target.x + target.w && target.x < r.x + r.w && r.y < target.y + target.h && target.y < r.y + r.h);
const gapOf = (r) => Math.max(r.x - (target.x + target.w), target.x - (r.x + r.w), r.y - (target.y + target.h), target.y - (r.y + r.h));

test("PXD-3: text cards and minimum cards, near or far, on every route: the arrow to the row never crosses the row's card", () => {
  for (const route of ["curve", "elbow", "straight"]) for (const [w, h] of [[60, 24], [200, 80], [240, 48]]) for (const rowTop of [40, 250]) {
    for (const src of around(w, h, 80)) {
      if (!apart(src)) continue;
      for (const fromSide of ["top", "right", "bottom", "left", "auto"]) {
        const an = rowEnd(src, rowTop);
        const args = { a: src, b: target, fromSide, toSide: an.side, route, toPoint: an.point, offset: route === "curve" ? 18 : 0 };
        const geo = rowEndPath(args, "to");
        const at = `${route} from ${JSON.stringify(src)} side ${fromSide} row ${rowTop}: ${geo.d}`;
        if (inside(geo, target, 256)) assert.fail(at);
        assert.deepEqual(geo.end, an.point, `the row end stays on its nearer side: ${at}`);
        // With room between the cards, a re-routed path never runs behind the source either.
        if (gapOf(src) >= 24 && geo.d !== edgePath(args).d && inside(geo, src, 256)) assert.fail(`behind the source: ${at}`);
      }
    }
  }
});

test("PXD-3: a straight line already clear of both cards stays; one that crossed the row card does not move behind the source", () => {
  const above = { x: -160, y: -200, w: 280, h: 160 };
  const an = rowEnd(above);
  const clear = { a: above, b: target, fromSide: "auto", toSide: an.side, route: "straight", toPoint: an.point };
  assert.equal(edgePath(clear).d, "M-20 -40L0 90");
  assert.deepEqual(rowEndPath(clear, "to"), edgePath(clear), "a line meeting the edge at a slant is not running along it");
  const low = { x: -80, y: 320, w: 260, h: 160 };
  const an2 = rowEnd(low);
  const crossing = { a: low, b: target, fromSide: "auto", toSide: an2.side, route: "straight", toPoint: an2.point };
  assert.ok(inside(edgePath(crossing), target) > 0);
  for (const route of ["straight", "curve", "elbow"]) {
    const geo = rowEndPath({ ...crossing, route }, "to");
    assert.equal(inside(geo, target, 256) + inside(geo, low, 256), 0, `${route}: ${geo.d}`);
    assert.deepEqual(geo.end, an2.point);
  }
});

test("PXD-3: an Around route with a card between goes round both that card and the row's card", () => {
  const mid = { x: 40, y: 290, w: 220, h: 30 };
  const an = rowEnd(below);
  const via = routeAround(center(below), center(target), [mid]);
  assert.ok(via.length, "the plain route bends over the card between");
  const args = { a: below, b: target, fromSide: "auto", toSide: an.side, route: "around", via, around: [mid], toPoint: an.point };
  assert.ok(inside(edgePath(args), target) > 0, "the plain bend lands inside the row's card");
  const geo = rowEndPath(args, "to");
  assert.equal(inside(geo, target, 256) + inside(geo, below, 256) + inside(geo, mid, 256), 0, geo.d);
  assert.deepEqual(geo.end, an.point);
  assert.deepEqual(rowEndPath({ ...args, around: undefined }, "to"), edgePath(args), "without `around` the bends are the user's and stay");
});

test("PXD-3: both ends on rows: the path keeps clear of both cards, a row end moving to its card's far side when it must", () => {
  const lower = { x: 0, y: 330, w: 260, h: 180 };
  const up = blockAnchor({ rect: target, rowTop: 80, rowHeight: 20, bodyTop: 30, bodyBottom: 280, other: center(lower) });
  const low = blockAnchor({ rect: lower, rowTop: 30, rowHeight: 20, bodyTop: 30, bodyBottom: 180, other: center(target) });
  assert.equal(low.side, "right");
  assert.equal(up.side, "left");
  const args = { a: lower, b: target, fromSide: low.side, toSide: up.side, route: "curve", fromPoint: low.point, toPoint: up.point };
  assert.ok(inside(edgePath(args), target) > 10, "the nearer sides face opposite ways and the curve runs through the upper card");
  const geo = rowEndPath(args, "both");
  assert.equal(inside(geo, target, 256) + inside(geo, lower, 256), 0, geo.d);
  assert.equal(geo.fromSide, geo.toSide, "both ends on the same side: the arrow runs up the outside");
  for (const [box, end] of [[lower, geo.start], [target, geo.end]]) {
    assert.ok(end.x === box.x || end.x === box.x + box.w, "each end on a side edge");
  }
  assert.equal(geo.start.y, low.point.y);
  assert.equal(geo.end.y, up.point.y);
  for (const route of ["elbow", "straight"]) {
    const g = rowEndPath({ ...args, route }, "both");
    assert.equal(inside(g, target, 256) + inside(g, lower, 256), 0, `${route}: ${g.d}`);
    assert.ok(g.points.every((p) => p.x <= 0) || g.points.every((p) => p.x >= 260), `${route} runs up one outer side: ${g.d}`);
  }
});

test("PXD-3: both ends on rows, wherever the second card is: no route crosses either card", () => {
  for (const route of ["curve", "elbow", "straight"]) for (const [w, h] of [[260, 180], [200, 80]]) for (const rowTop of [40, 250]) {
    for (const src of around(w, h, 80)) {
      if (!apart(src)) continue;
      const a1 = blockAnchor({ rect: src, rowTop: 10, rowHeight: 20, bodyTop: 0, bodyBottom: h, other: center(target) });
      const a2 = rowEnd(src, rowTop);
      const geo = rowEndPath({ a: src, b: target, fromSide: a1.side, toSide: a2.side, route, fromPoint: a1.point, toPoint: a2.point }, "both");
      const n = inside(geo, target, 256) + inside(geo, src, 256);
      if (n) assert.fail(`${route} from ${JSON.stringify(src)} row ${rowTop}: ${geo.d}`);
    }
  }
});

test("PXD-3: a path that already clears the card, the user's bends, a fixed far end and no row end are left alone; overlapping cards are routed", () => {
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
  for (const a of [{ x: 20, y: 279, w: 260, h: 140 }, { x: 100, y: 200, w: 300, h: 170 }]) {
    const an3 = rowEnd(a);
    const overlap = { a, b: target, fromSide: "top", toSide: an3.side, route: "curve", toPoint: an3.point };
    assert.ok(inside(edgePath(overlap), target) > 0);
    assert.equal(inside(rowEndPath(overlap, "to"), target, 256), 0, `overlapping ${JSON.stringify(a)}: kept clear of the row's card`);
  }
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

test("PXD-3: edge layer: an Around arrow to a row, with a card between, keeps clear of every card", () => {
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
      raw("c3", "between", plx({ x: 40, y: 290, w: 220, h: 30 }), [], 2),
      raw("ec", "Connections", plx({ type: "edges" }), [
        raw("e12", "((c1)) → ((row1))", plx({ type: "edge", from: "c1", to: "c2", toBlock: "row1", route: "around" })),
      ], 3),
    ]));
    const rects = worldRects(board);
    layer.render({ board, rects, zoom: 1 });
    layer.setMeasures(new Map([["e12", { to: { rowTop: 80, rowHeight: 20, bodyTop: 30, bodyBottom: 280, rowLeft: 20, rowRight: 260 } }]]));
    layer.update({ board, edgeUids: new Set(["e12"]), rects, zoom: 1 });
    const geo = layer.geometryOf("e12");
    assert.deepEqual(geo.end, { x: 300, y: 90 });
    for (const uid of ["c1", "c2", "c3"]) assert.equal(inside(geo, rects.get(uid), 256), 0, `${uid}: ${geo.d}`);
  } finally { restore(); }
});

test("PXD-3: edge layer: a row-to-row arrow between stacked cards runs up the outside, and the moved end's inner segment follows it", () => {
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
      raw("c2", "[[Upper]]", plx({ x: 0, y: 0, w: 300, h: 280 }), [], 0),
      raw("c3", "[[Lower]]", plx({ x: 0, y: 330, w: 260, h: 180 }), [], 1),
      raw("ec", "Connections", plx({ type: "edges" }), [
        raw("e32", "((rowL)) → ((rowU))", plx({ type: "edge", from: "c3", to: "c2", fromBlock: "rowL", toBlock: "rowU" })),
      ], 2),
    ]));
    const rects = worldRects(board);
    layer.render({ board, rects, zoom: 1 });
    layer.setMeasures(new Map([["e32", {
      from: { rowTop: 30, rowHeight: 20, bodyTop: 30, bodyBottom: 180, rowLeft: 20, rowRight: 240 },
      to: { rowTop: 80, rowHeight: 20, bodyTop: 30, bodyBottom: 280, rowLeft: 20, rowRight: 260 },
    }]]));
    layer.update({ board, edgeUids: new Set(["e32"]), rects, zoom: 1 });
    const geo = layer.geometryOf("e32");
    assert.equal(inside(geo, rects.get("c2"), 256) + inside(geo, rects.get("c3"), 256), 0, geo.d);
    assert.deepEqual(geo.start, { x: 260, y: 370 }, "the lower row leaves from its nearer (right) side");
    assert.deepEqual(geo.end, { x: 300, y: 90 }, "the upper row's end moved to the right edge, at the row's y");
    assert.ok(geo.toInner && geo.toInner.tip.x < 300 && geo.toInner.from.x < 300, "the inner segment runs in from the right edge");
    assert.ok(geo.fromInner && geo.fromInner.tip.x < 260, "the lower row's inner segment is unchanged");
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
