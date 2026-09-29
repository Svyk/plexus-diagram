import test from "node:test";
import assert from "node:assert/strict";
import {
  screenToWorld, worldToScreen, clampZoom, zoomAt, fitViewport, visibleWorldRect, lodForZoom,
  center, inflate, unionRect, rectsIntersect, rectContains, pointInRect,
  sidePoint, nearestSide, autoSides, edgePath, arrowHeadPath, arrowSize,
  snapMove, alignRects, distributeRects, gridBackground,
} from "../src/model/geometry.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const nums = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);

test("screenToWorld / worldToScreen are inverses", () => {
  const vp = { x: 120, y: -40, zoom: 1.7 };
  const p = { x: 33, y: 250 };
  const r = worldToScreen(vp, screenToWorld(vp, p));
  near(r.x, p.x);
  near(r.y, p.y);
  const w = screenToWorld(vp, worldToScreen(vp, { x: -9, y: 4 }));
  near(w.x, -9);
  near(w.y, 4);
});

test("zoomAt keeps the world point under the cursor fixed and clamps", () => {
  const vp = { x: 50, y: 20, zoom: 1 };
  const sp = { x: 300, y: 200 };
  const before = screenToWorld(vp, sp);
  for (const f of [0.5, 1.3, 2]) {
    const next = zoomAt(vp, sp, f);
    const after = screenToWorld(next, sp);
    near(after.x, before.x);
    near(after.y, before.y);
    near(next.zoom, f);
  }
  assert.equal(zoomAt(vp, sp, 100).zoom, 4);
  assert.equal(zoomAt(vp, sp, 0.001).zoom, 0.1);
  assert.equal(zoomAt(vp, sp, 100, { max: 2 }).zoom, 2);
  assert.equal(clampZoom(9), 4);
});

test("fitViewport centers bounds with padding, respects limits, null bounds", () => {
  const size = { width: 1000, height: 600 };
  const b = { x: 100, y: 100, w: 400, h: 200 };
  const vp = fitViewport(b, size);
  near(vp.zoom, Math.min(872 / 400, 472 / 200, 1.5));
  const c = worldToScreen(vp, center(b));
  near(c.x, 500);
  near(c.y, 300);
  assert.equal(fitViewport({ x: 0, y: 0, w: 10, h: 10 }, size).zoom, 1.5);
  assert.equal(fitViewport({ x: 0, y: 0, w: 10, h: 10 }, size, { maxZoom: 3 }).zoom, 3);
  assert.equal(fitViewport({ x: 0, y: 0, w: 1e6, h: 1e6 }, size).zoom, 0.1);
  assert.equal(fitViewport({ x: 0, y: 0, w: 1e6, h: 1e6 }, size, { minZoom: 0.05 }).zoom, 0.05);
  assert.deepEqual(fitViewport(null, size), { x: 500, y: 300, zoom: 1 });
});

test("visibleWorldRect with margin", () => {
  const vp = { x: -200, y: -100, zoom: 2 };
  const size = { width: 800, height: 400 };
  assert.deepEqual(visibleWorldRect(vp, size), { x: 100, y: 50, w: 400, h: 200 });
  const m = visibleWorldRect(vp, size, 0.5);
  assert.deepEqual(m, { x: 100 - 200, y: 50 - 100, w: 800, h: 400 });
});

test("lodForZoom thresholds", () => {
  assert.equal(lodForZoom(0.44), "map");
  assert.equal(lodForZoom(0.45), "detail");
  assert.equal(lodForZoom(2), "detail");
});

test("rect helpers", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 5, y: 5, w: 10, h: 10 };
  assert.deepEqual(center(a), { x: 5, y: 5 });
  assert.deepEqual(inflate(a, 2), { x: -2, y: -2, w: 14, h: 14 });
  assert.deepEqual(unionRect(a, b), { x: 0, y: 0, w: 15, h: 15 });
  assert.ok(rectsIntersect(a, b));
  assert.ok(!rectsIntersect(a, { x: 10, y: 0, w: 5, h: 5 }));
  assert.ok(rectContains({ x: 0, y: 0, w: 20, h: 20 }, b));
  assert.ok(!rectContains(a, b));
  assert.ok(pointInRect({ x: 10, y: 10 }, a));
  assert.ok(!pointInRect({ x: 11, y: 5 }, a));
});

test("sidePoint, nearestSide", () => {
  const r = { x: 100, y: 200, w: 80, h: 40 };
  assert.deepEqual(sidePoint(r, "top"), { x: 140, y: 200 });
  assert.deepEqual(sidePoint(r, "right"), { x: 180, y: 220 });
  assert.deepEqual(sidePoint(r, "bottom"), { x: 140, y: 240 });
  assert.deepEqual(sidePoint(r, "left"), { x: 100, y: 220 });
  assert.equal(nearestSide(r, { x: 300, y: 220 }), "right");
  assert.equal(nearestSide(r, { x: 0, y: 220 }), "left");
  assert.equal(nearestSide(r, { x: 140, y: 0 }), "top");
  assert.equal(nearestSide(r, { x: 140, y: 500 }), "bottom");
});

test("autoSides", () => {
  const a = { x: 0, y: 0, w: 100, h: 50 };
  assert.deepEqual(autoSides(a, { x: 300, y: 0, w: 100, h: 50 }), { fromSide: "right", toSide: "left" });
  assert.deepEqual(autoSides(a, { x: -300, y: 0, w: 100, h: 50 }), { fromSide: "left", toSide: "right" });
  assert.deepEqual(autoSides(a, { x: 0, y: 300, w: 100, h: 50 }), { fromSide: "bottom", toSide: "top" });
  assert.deepEqual(autoSides(a, { x: 0, y: -300, w: 100, h: 50 }), { fromSide: "top", toSide: "bottom" });
});

const A = { x: 0, y: 0, w: 100, h: 50 };
const B = { x: 300, y: 120, w: 100, h: 50 };

for (const route of ["straight", "curve", "elbow"]) {
  test(`edgePath ${route}: d starts at start, ends at end, mid between`, () => {
    const p = edgePath({ a: A, b: B, route });
    assert.equal(p.fromSide, "right");
    assert.equal(p.toSide, "left");
    assert.deepEqual(p.start, { x: 100, y: 25 });
    assert.deepEqual(p.end, { x: 300, y: 145 });
    const n = nums(p.d);
    assert.deepEqual([n[0], n[1]], [100, 25]);
    assert.deepEqual([n[n.length - 2], n[n.length - 1]], [300, 145]);
    assert.ok(p.mid.x > 100 && p.mid.x < 300);
    assert.ok(p.mid.y > 25 && p.mid.y < 145);
  });
}

test("edgePath endAngle points into b", () => {
  const a = { x: 0, y: 0, w: 100, h: 50 };
  const b = { x: 300, y: 0, w: 100, h: 50 };
  for (const route of ["straight", "curve", "elbow"]) {
    const p = edgePath({ a, b, fromSide: "right", toSide: "left", route });
    near(p.endAngle, 0, 1e-9);
    near(p.startAngle, 0, 1e-9);
  }
  const below = edgePath({ a, b: { x: 0, y: 300, w: 100, h: 50 }, route: "curve" });
  near(below.endAngle, Math.PI / 2);
});

test("edgePath elbow uses only horizontal/vertical segments", () => {
  for (const [fs, ts] of [["right", "left"], ["bottom", "top"], ["right", "top"], ["bottom", "left"], ["right", "right"], ["top", "top"]]) {
    const p = edgePath({ a: A, b: B, fromSide: fs, toSide: ts, route: "elbow" });
    const n = nums(p.d);
    for (let i = 2; i < n.length; i += 2) {
      const dx = n[i] - n[i - 2];
      const dy = n[i + 1] - n[i - 1];
      assert.ok(dx === 0 || dy === 0, `${fs}/${ts}: ${p.d}`);
    }
    assert.match(p.d, /^M/);
    assert.ok(!p.d.includes("C"));
  }
});

test("edgePath offset shifts curve control points", () => {
  const a = { x: 0, y: 0, w: 100, h: 50 };
  const b = { x: 300, y: 0, w: 100, h: 50 };
  const plain = nums(edgePath({ a, b, route: "curve" }).d);
  const shifted = nums(edgePath({ a, b, route: "curve", offset: 20 }).d);
  assert.notEqual(plain[3], shifted[3]);
  near(Math.abs(shifted[3] - plain[3]), 20);
  assert.deepEqual([plain[0], plain[1]], [shifted[0], shifted[1]]);
  assert.deepEqual(plain.slice(-2), shifted.slice(-2));
  const pa = edgePath({ a, b, route: "curve", offset: 20 });
  const pb = edgePath({ a, b, route: "curve", offset: -20 });
  assert.ok(pa.mid.y !== pb.mid.y);
});

test("arrowHeadPath tip equals point; arrowSize clamps at low zoom", () => {
  const d = arrowHeadPath({ x: 50, y: 60 }, 0, 10);
  assert.match(d, /^M50 60L.*L.*Z$/);
  const n = nums(d);
  assert.deepEqual([n[0], n[1]], [50, 60]);
  near(n[2], 40);
  near(n[4], 40);
  near(n[3] + n[5], 120);
  assert.equal(arrowSize(1), 10);
  assert.equal(arrowSize(1, 3), 14);
  assert.equal(arrowSize(0.2), 30);
  assert.equal(arrowSize(4), 10);
});

test("snapMove snaps within threshold, not beyond, and emits guides", () => {
  const others = [{ x: 200, y: 200, w: 100, h: 50 }];
  const inside = snapMove({ x: 204, y: 100, w: 80, h: 40 }, others, 6);
  assert.equal(inside.dx, -4);
  assert.equal(inside.dy, 0);
  assert.ok(inside.guides.some((g) => g.x1 === 200 && g.x2 === 200 && g.y1 === 100 && g.y2 === 250));
  const outside = snapMove({ x: 212, y: 100, w: 70, h: 40 }, others, 2);
  assert.equal(outside.dx, 0);
  assert.equal(outside.guides.length, 0);
  const center = snapMove({ x: 0, y: 203, w: 100, h: 44 }, others, 6);
  assert.equal(center.dy, 0);
  const mid = snapMove({ x: 0, y: 210, w: 100, h: 30 }, others, 6);
  assert.equal(mid.dy, 0);
  const mid2 = snapMove({ x: 0, y: 212, w: 100, h: 30 }, others, 6);
  assert.equal(mid2.dy, -2);
  assert.ok(mid2.guides.some((g) => g.y1 === 225 && g.y2 === 225));
  const none = snapMove({ x: 0, y: 0, w: 10, h: 10 }, [], 6);
  assert.deepEqual(none, { dx: 0, dy: 0, guides: [] });
});

test("alignRects each mode", () => {
  const list = [
    { uid: "a", x: 0, y: 0, w: 100, h: 40 },
    { uid: "b", x: 50, y: 100, w: 60, h: 20 },
    { uid: "c", x: 200, y: 300, w: 40, h: 60 },
  ];
  const by = (m) => Object.fromEntries(alignRects(list, m).map((r) => [r.uid, r]));
  assert.deepEqual(by("left"), { a: { uid: "a", x: 0, y: 0 }, b: { uid: "b", x: 0, y: 100 }, c: { uid: "c", x: 0, y: 300 } });
  assert.deepEqual(by("right").b, { uid: "b", x: 180, y: 100 });
  assert.deepEqual(by("right").c, { uid: "c", x: 200, y: 300 });
  assert.deepEqual(by("center").a, { uid: "a", x: 70, y: 0 });
  assert.deepEqual(by("center").c, { uid: "c", x: 100, y: 300 });
  assert.deepEqual(by("top").c, { uid: "c", x: 200, y: 0 });
  assert.deepEqual(by("bottom").a, { uid: "a", x: 0, y: 320 });
  assert.deepEqual(by("middle").a, { uid: "a", x: 0, y: 160 });
  assert.deepEqual(alignRects([], "left"), []);
});

test("distributeRects equal gaps with unsorted input", () => {
  const list = [
    { uid: "c", x: 400, y: 5, w: 50, h: 10 },
    { uid: "a", x: 0, y: 0, w: 100, h: 10 },
    { uid: "b", x: 120, y: 7, w: 30, h: 10 },
    { uid: "d", x: 250, y: 9, w: 20, h: 10 },
  ];
  const out = distributeRects(list, "h");
  assert.deepEqual(out.map((r) => r.uid), ["a", "b", "d", "c"]);
  assert.equal(out[0].x, 0);
  assert.equal(out[3].x, 400);
  const w = { a: 100, b: 30, d: 20, c: 50 };
  const gaps = [];
  for (let i = 1; i < out.length; i++) gaps.push(out[i].x - (out[i - 1].x + w[out[i - 1].uid]));
  near(gaps[0], gaps[1]);
  near(gaps[1], gaps[2]);
  assert.equal(out[1].y, 7);
  const v = distributeRects(
    [
      { uid: "a", x: 0, y: 0, w: 10, h: 10 },
      { uid: "b", x: 3, y: 15, w: 10, h: 10 },
      { uid: "c", x: 9, y: 100, w: 10, h: 10 },
    ],
    "v",
  );
  assert.deepEqual(v.map((r) => r.y), [0, 50, 100]);
  assert.equal(v[1].x, 3);
});

test("gridBackground", () => {
  assert.equal(gridBackground({ x: 5, y: 5, zoom: 1 }, "plain"), null);
  for (const style of ["dots", "lines"]) {
    const g = gridBackground({ x: 50, y: -10, zoom: 2 }, style);
    near(g.size, 48);
    near(g.x, 2);
    near(g.y, 38);
  }
  assert.equal(gridBackground({ x: 0, y: 0, zoom: 1 }, "dots", 10).size, 10);
});
