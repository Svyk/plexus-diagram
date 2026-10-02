import assert from "node:assert/strict";
import test from "node:test";
import { mindMapLayout, sameSize, spaceOut, tidyRects } from "../src/model/layout.js";

const R = (uid, x, y, w = 100, h = 50) => ({ uid, x, y, w, h });
const byUid = (list) => Object.fromEntries(list.map((p) => [p.uid, p]));

test("tidyRects row: sorted by x, tops aligned, anchored at union top-left", () => {
  const out = byUid(tidyRects([R("b", 300, 90), R("a", 40, 20, 60), R("c", 500, 200)], "row", { gap: 10 }));
  assert.deepEqual(out.a, { uid: "a", x: 40, y: 20 });
  assert.deepEqual(out.b, { uid: "b", x: 110, y: 20 });
  assert.deepEqual(out.c, { uid: "c", x: 220, y: 20 });
});

test("tidyRects column: sorted by y, lefts aligned", () => {
  const out = tidyRects([R("b", 50, 300), R("a", 10, 20, 100, 40)], "column", { gap: 8 });
  assert.deepEqual(out, [{ uid: "a", x: 10, y: 20 }, { uid: "b", x: 10, y: 68 }]);
});

test("tidyRects grid: sqrt columns, widest-in-column, tallest-in-row, reading order", () => {
  const list = [R("a", 0, 0, 100, 50), R("b", 200, 0, 60, 80), R("c", 0, 200, 40, 20), R("d", 200, 200, 90, 30), R("e", 0, 400)];
  const out = byUid(tidyRects(list, "grid", { gap: 10 }));
  // n=5 -> 3 columns
  assert.deepEqual([out.a.x, out.b.x, out.c.x], [0, 110, 220]);
  assert.equal(out.a.y, 0);
  assert.equal(out.d.x, 0);
  assert.equal(out.d.y, 90);
  assert.equal(out.e.x, 110);
  assert.equal(out.e.y, 90);
});

test("tidyRects grid honors explicit columns and the empty list", () => {
  const out = tidyRects([R("a", 5, 5), R("b", 6, 5), R("c", 7, 5)], "grid", { gap: 0, columns: 1 });
  assert.deepEqual(out.map((p) => [p.x, p.y]), [[5, 5], [5, 55], [5, 105]]);
  assert.deepEqual(tidyRects([], "grid"), []);
});

test("tidyRects outline follows the given order, appending unlisted rects", () => {
  const list = [R("a", 0, 0), R("b", 0, 100), R("c", 0, 200), R("d", 0, 300)];
  const out = tidyRects(list, "outline", { gap: 0, columns: 1, order: ["c", "a", "zzz"] });
  assert.deepEqual(out.map((p) => p.uid), ["c", "a", "b", "d"]);
  assert.deepEqual(out.map((p) => p.y), [0, 50, 100, 150]);
});

test("spaceOut pushes an overlapped rect along the axis of least penetration and keeps the gap", () => {
  const rects = new Map([["m", R("m", 0, 0)], ["n", R("n", 90, 10)], ["far", R("far", 1000, 1000)]]);
  const out = spaceOut(rects, new Set(["m"]), { gap: 16 });
  assert.deepEqual(out, [{ uid: "n", x: 116, y: 10 }]);
});

test("spaceOut: fixed rects are never displaced and never push", () => {
  const rects = new Map([["m", R("m", 0, 0)], ["p", R("p", 1000, 0)], ["c", R("c", 1050, 10)], ["n", R("n", 90, 10)]]);
  const out = byUid(spaceOut(rects, new Set(["m"]), { gap: 16, fixed: new Set(["p"]) }));
  assert.deepEqual(Object.keys(out).sort(), ["n"], "the pinned p neither moves nor pushes the overlapping c");
});

test("spaceOut pushes vertically when the y penetration is smaller, and left when below-left", () => {
  const rects = new Map([["m", R("m", 0, 0)], ["n", R("n", 10, 40)], ["l", R("l", -95, 0)]]);
  const out = byUid(spaceOut(rects, new Set(["m"]), { gap: 10 }));
  assert.deepEqual(out.n, { uid: "n", x: 10, y: 60 });
  assert.deepEqual(out.l, { uid: "l", x: -110, y: 0 });
});

test("spaceOut chains: a displaced rect displaces the next, moved rects never move", () => {
  const rects = new Map([["m", R("m", 0, 0)], ["a", R("a", 80, 0)], ["b", R("b", 200, 0)], ["c", R("c", 500, 0)]]);
  const out = byUid(spaceOut(rects, new Set(["m"]), { gap: 20 }));
  assert.equal(out.a.x, 120);
  assert.equal(out.b.x, 240);
  assert.equal(out.c, undefined);
  assert.equal(out.m, undefined);
});

test("spaceOut is deterministic, terminates within maxPasses, and returns nothing when clear", () => {
  const rects = new Map([["m", R("m", 0, 0)], ["a", R("a", 60, 0)], ["b", R("b", 170, 0)]]);
  assert.deepEqual(spaceOut(rects, new Set(["m"])), spaceOut(rects, new Set(["m"])));
  assert.equal(spaceOut(rects, new Set(["m"]), { gap: 16, maxPasses: 1 }).length >= 1, true);
  assert.deepEqual(spaceOut(new Map([["m", R("m", 0, 0)], ["a", R("a", 500, 0)]]), new Set(["m"])), []);
});

test("sameSize modes report only changed non-primary rects", () => {
  const list = [R("p", 0, 0, 300, 120), R("a", 0, 0, 100, 50), R("b", 0, 0, 300, 50), R("c", 0, 0, 300, 120)];
  assert.deepEqual(sameSize(list, "p", "width"), [{ uid: "a", w: 300, h: 50 }]);
  assert.deepEqual(sameSize(list, "p", "height"), [{ uid: "a", w: 100, h: 120 }, { uid: "b", w: 300, h: 120 }]);
  assert.deepEqual(sameSize(list, "p", "both"), [{ uid: "a", w: 300, h: 120 }, { uid: "b", w: 300, h: 120 }]);
  assert.deepEqual(sameSize(list, "missing", "both"), []);
});

const node = (uid, children = [], w = 100, h = 50) => ({ uid, w, h, children });

test("mindMapLayout right: root at origin, parent centered on children, unbalanced subtrees do not overlap", () => {
  const tree = node("r", [node("a", [node("a1"), node("a2"), node("a3")]), node("b")]);
  const m = mindMapLayout(tree, { direction: "right", hGap: 80, vGap: 24 });
  assert.deepEqual(m.get("r"), { x: 0, y: 0 });
  assert.equal(m.get("a").x, 180);
  assert.equal(m.get("a1").x, 360);
  const center = (u) => m.get(u).y + 25;
  assert.equal(center("a"), center("a2"));
  assert.equal(center("r"), (center("a") + center("b")) / 2);
  // a's subtree (a1..a3) stays above b
  assert.ok(m.get("a3").y + 50 + 24 <= m.get("b").y);
});

test("mindMapLayout right with a leaf root and a single child", () => {
  assert.deepEqual([...mindMapLayout(node("r"), {})], [["r", { x: 0, y: 0 }]]);
  const m = mindMapLayout(node("r", [node("a")]), {});
  assert.deepEqual(m.get("a"), { x: 180, y: 0 });
});

test("mindMapLayout down is the transpose", () => {
  const tree = node("r", [node("a"), node("b")]);
  const m = mindMapLayout(tree, { direction: "down", hGap: 80, vGap: 24 });
  assert.deepEqual(m.get("r"), { x: 0, y: 0 });
  assert.equal(m.get("a").y, 130);
  assert.equal(m.get("b").y, 130);
  assert.equal(m.get("a").x + 100 + 24, m.get("b").x);
  assert.equal((m.get("a").x + m.get("b").x) / 2, 0);
});

test("mindMapLayout balanced alternates children right and left with mirrored depth", () => {
  const tree = node("r", [node("a", [node("a1")]), node("b", [node("b1")]), node("c")]);
  const m = mindMapLayout(tree, { direction: "balanced", hGap: 80, vGap: 24 });
  assert.deepEqual(m.get("r"), { x: 0, y: 0 });
  assert.equal(m.get("a").x, 180);
  assert.equal(m.get("c").x, 180);
  assert.equal(m.get("b").x, -180);
  assert.equal(m.get("b1").x, -360);
  assert.equal(m.get("a1").x, 360);
  assert.equal(m.get("b").y, 0);
});

test("mindMapLayout spacing changes the column gap and the default stays the normal gap", () => {
  const tree = node("r", [node("a")]);
  assert.equal(mindMapLayout(tree, { hGap: 40 }).get("a").x, 140);
  assert.equal(mindMapLayout(tree, { hGap: 140 }).get("a").x, 240);
  assert.equal(mindMapLayout(tree, {}).get("a").x, 180);
});

test("mindMapLayout radial keeps the root at the origin and places a grandchild further out", () => {
  const tree = node("r", [node("a", [node("a1")]), node("b"), node("c"), node("d")]);
  const m = mindMapLayout(tree, { direction: "radial", hGap: 80, vGap: 24 });
  assert.deepEqual(m.get("r"), { x: 0, y: 0 });
  const centerDist = (u) => {
    const p = m.get(u);
    return Math.hypot(p.x + 50 - 50, p.y + 25 - 25);
  };
  for (const u of ["a", "b", "c", "d"]) assert.ok(centerDist(u) > 80, `${u} leaves the root`);
  assert.ok(centerDist("a1") > centerDist("a"), "a grandchild sits further from the root than its parent");
  const xs = ["a", "b", "c", "d"].map((u) => m.get(u).x);
  const ys = ["a", "b", "c", "d"].map((u) => m.get(u).y);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 40, "children are not stacked on one vertical line");
  assert.ok(Math.max(...ys) - Math.min(...ys) > 40, "children are not stacked on one horizontal line");
  const right = mindMapLayout(tree, { direction: "right", hGap: 80, vGap: 24 });
  assert.notEqual(m.get("b").x, right.get("b").x);
});
