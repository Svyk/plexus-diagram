import assert from "node:assert/strict";
import test from "node:test";
import {
  boardPreview, boundsOf, buildBoard, containerAt, descendantsOf, diffBoards, edgesTouching, findEdge, hitTest,
  itemsInRect, membershipPlan, outlineOrder, sectionAdoptPlan, sectionFitPlan, sidebarOutlineUids, toRelative, topLevelOf, worldRect, worldRects,
} from "../src/model/board.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const blk = (uid, order, string, plexus, extra = {}) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ...(plexus ? { ":block/props": { ":plexus": Object.fromEntries(Object.entries(plexus).map(([k, v]) => [`:${k}`, v])) } } : {}),
  ...extra,
});

function fixture() {
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test board}}",
    ":block/props": { ":rf-diagram": { ":viewport": { ":x": 1 } }, ":plexus": { ":v": 2 } },
    ":block/children": [
      blk("c1", 0, "[[Page One]]", { x: 0, y: 0, w: 280, h: 160, color: "blue" }),
      blk("c2", 1, "note text\nline two", { x: 400, y: 0 }, {
        ":block/children": [blk("cc1", 1, "inner b"), blk("cc0", 0, "inner a")],
      }),
      blk("c3", 2, "((abcDEF123))", null),
      blk("s1", 3, "Evidence", { type: "section", x: 0, y: 300, w: 500, h: 400 }, {
        ":block/children": [
          blk("m1", 0, "member one", { x: 20, y: 50 }),
          blk("m2", 1, "member two", { x: 300, y: 50 }),
          blk("s2", 2, "Inner", { type: "section", x: 20, y: 200, w: 300, h: 160 }, {
            ":block/children": [blk("m3", 0, "member three", { x: 10, y: 40, w: 200, h: 80 })],
          }),
        ],
      }),
      blk("t1", 4, "Hello", { type: "text", x: 600, y: 300, fontSize: 32 }),
      blk("h1", 5, "Heading section", null, {
        ":block/heading": 2,
        ":block/children": [blk("hc1", 0, "x")],
      }),
      blk("nb", 6, "{{[[diagram]]:Sub}}", { x: 400, y: 200, w: 200, h: 100 }),
      blk("ex", 7, "Connections", { type: "edges" }, {
        ":block/children": [
          blk("e1", 0, "[[Page One]] → causes → ((c2))", { type: "edge", from: "c1", to: "c2" }),
          blk("e2", 1, "[[Page One]] → ((gone))", { type: "edge", from: "c1", to: "gone" }),
          blk("e3", 2, "((m1)) ↔ ((c2))", { type: "edge", from: "m1", to: "c2", dir: "two", color: "red" }),
          blk("noise", 3, "not an edge", null),
        ],
      }),
    ],
  };
}
const build = () => buildBoard(fixture());

test("buildBoard: null in, null out", () => {
  assert.equal(buildBoard(null), null);
});

test("buildBoard: board fields, roots, order, container", () => {
  const b = build();
  assert.equal(b.uid, "board0001");
  assert.equal(b.title, "Test board");
  assert.equal(b.enhanced, true);
  assert.deepEqual(b.plexus, { v: 2 });
  assert.deepEqual(b.roots, ["c1", "c2", "c3", "s1", "t1", "h1", "nb"]);
  assert.deepEqual(b.order, ["s1", "h1", "s2", "c1", "c2", "c3", "m1", "m2", "m3", "t1", "hc1", "nb"]);
  assert.equal(b.containerUid, "ex");
  assert.equal(b.containerIndex, 7);
  assert.equal(b.childCount, 8);
  assert.equal(b.items.has("ex"), false);
  assert.equal(b.items.has("cc1"), false);
});

test("buildBoard: not enhanced without plexus v2", () => {
  const p = fixture();
  p[":block/props"] = { ":rf-diagram": {} };
  const b = buildBoard(p);
  assert.equal(b.enhanced, false);
  assert.equal(b.plexus, null);
  const bare = buildBoard({ ":block/uid": "x", ":block/string": "{{diagram}}" });
  assert.equal(bare.containerUid, null);
  assert.equal(bare.containerIndex, -1);
  assert.equal(bare.childCount, 0);
  assert.equal(bare.title, "");
});

test("buildBoard: items, kinds, targets, titles", () => {
  const b = build();
  const c1 = b.items.get("c1");
  assert.deepEqual([c1.type, c1.kind, c1.title, c1.color, c1.hasLayout], ["card", "page", "Page One", "blue", true]);
  assert.deepEqual(c1.target, { kind: "page", title: "Page One" });
  assert.deepEqual([c1.parentUid, c1.depth, c1.w, c1.h], ["board0001", 0, 280, 160]);
  const c2 = b.items.get("c2");
  assert.equal(c2.kind, "note");
  assert.equal(c2.look, "block");
  assert.equal(c2.open, true);
  assert.equal(c1.look, "card");
  assert.equal(c1.open, true);
  assert.equal(c2.title, "note text");
  assert.deepEqual(c2.target, { kind: "self", uid: "c2" });
  assert.deepEqual(c2.content.map((c) => c[":block/uid"]), ["cc0", "cc1"]);
  assert.deepEqual([c2.w, c2.h], [280, 160]);
  const c3 = b.items.get("c3");
  assert.equal(c3.kind, "block");
  assert.deepEqual(c3.target, { kind: "block", uid: "abcDEF123" });
  const nb = b.items.get("nb");
  assert.deepEqual([nb.kind, nb.title], ["board", "Sub"]);
  const t1 = b.items.get("t1");
  assert.deepEqual([t1.type, t1.kind, t1.fontSize, t1.w, t1.h], ["text", "text", 32, 240, 48]);
  assert.deepEqual(t1.content, []);
  assert.equal(b.items.get("s1").content.length, 0);
});

test("buildBoard: card size default override", () => {
  const b = buildBoard(fixture(), { defaults: { card: { w: 300, h: 200 } } });
  assert.deepEqual([b.items.get("c2").w, b.items.get("c2").h], [300, 200]);
  assert.equal(b.items.get("s1").w, 500);
});

test("buildBoard: sections, members, relative coords, nesting", () => {
  const b = build();
  const s1 = b.items.get("s1");
  assert.deepEqual(s1.members, ["m1", "m2", "s2"]);
  assert.deepEqual([s1.type, s1.kind, s1.depth], ["section", "section", 0]);
  const s2 = b.items.get("s2");
  assert.deepEqual([s2.parentUid, s2.depth, s2.x, s2.y, s2.members], ["s1", 1, 20, 200, ["m3"]]);
  const m3 = b.items.get("m3");
  assert.deepEqual([m3.parentUid, m3.depth, m3.x, m3.y], ["s2", 2, 10, 40]);
});

test("buildBoard: heading with children and no props becomes a section", () => {
  const b = build();
  const h1 = b.items.get("h1");
  assert.deepEqual([h1.type, h1.kind, h1.hasLayout, h1.heading, h1.members], ["section", "section", false, 2, ["hc1"]]);
  assert.deepEqual([h1.w, h1.h], [480, 320]);
  assert.equal(b.items.get("hc1").parentUid, "h1");
});

test("buildBoard: items without props are auto-placed right of laid-out siblings", () => {
  const b = build();
  const c3 = b.items.get("c3");
  const h1 = b.items.get("h1");
  assert.equal(c3.hasLayout, false);
  // rightmost laid-out sibling is t1 (600 + 240)
  assert.deepEqual([c3.x, c3.y], [888, 0]);
  assert.deepEqual([h1.x, h1.y], [888, 200]);
  const hc1 = b.items.get("hc1");
  assert.deepEqual([hc1.x, hc1.y, hc1.hasLayout], [0, 0, false]);
});

test("buildBoard: auto-place fills columns of four", () => {
  const kids = [];
  for (let i = 0; i < 6; i++) kids.push(blk(`n${i}`, i, `n ${i}`, null));
  const b = buildBoard({ ":block/uid": "b", ":block/string": "{{diagram}}", ":block/children": kids });
  const pos = kids.map((_, i) => [b.items.get(`n${i}`).x, b.items.get(`n${i}`).y]);
  assert.deepEqual(pos, [[0, 0], [0, 200], [0, 400], [0, 600], [320, 0], [320, 200]]);
  const half = buildBoard({
    ":block/uid": "b", ":block/string": "{{diagram}}",
    ":block/children": [blk("p", 0, "p", { x: 10, y: 20, w: 100, h: 50 }), blk("q", 1, "q", null)],
  });
  assert.deepEqual([half.items.get("q").x, half.items.get("q").y], [158, 20]);
});

test("buildBoard: edges, labels, validity", () => {
  const b = build();
  assert.deepEqual([...b.edges.keys()], ["e1", "e2", "e3"]);
  const e1 = b.edges.get("e1");
  assert.deepEqual([e1.from, e1.to, e1.label, e1.valid, e1.dir, e1.route], ["c1", "c2", "causes", true, "one", "curve"]);
  const e2 = b.edges.get("e2");
  assert.equal(e2.valid, false);
  const e3 = b.edges.get("e3");
  assert.deepEqual([e3.dir, e3.color, e3.label, e3.valid], ["two", "red", "", true]);
});

test("worldRects accumulates nested section offsets", () => {
  const b = build();
  const r = worldRects(b);
  assert.deepEqual(r.get("s1"), { x: 0, y: 300, w: 500, h: 400 });
  assert.deepEqual(r.get("m1"), { x: 20, y: 350, w: 280, h: 160 });
  assert.deepEqual(r.get("s2"), { x: 20, y: 500, w: 300, h: 160 });
  assert.deepEqual(r.get("m3"), { x: 30, y: 540, w: 200, h: 80 });
  assert.deepEqual(worldRect(b, "m3"), r.get("m3"));
  assert.deepEqual(worldRect(b, "m3", r), r.get("m3"));
  assert.equal(worldRect(b, "nope"), null);
  assert.equal(r.size, b.items.size);
});

test("descendantsOf, topLevelOf, boundsOf", () => {
  const b = build();
  assert.deepEqual([...descendantsOf(b, "s1")].sort(), ["m1", "m2", "m3", "s2"]);
  assert.equal(descendantsOf(b, "c1").size, 0);
  assert.deepEqual(topLevelOf(b, ["s1", "m1", "m3", "c1", "zzz"]), ["s1", "c1"]);
  assert.deepEqual(topLevelOf(b, new Set(["m1", "s2", "m3"])), ["m1", "s2"]);
  assert.equal(boundsOf([]), null);
  assert.deepEqual(boundsOf([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }]), { x: 0, y: -5, w: 25, h: 15 });
});

test("containerAt picks deepest section and honors exclude", () => {
  const b = build();
  const rects = worldRects(b);
  assert.equal(containerAt(b, { x: 40, y: 560 }, { rects }), "s2");
  assert.equal(containerAt(b, { x: 40, y: 560 }), "s2");
  assert.equal(containerAt(b, { x: 40, y: 560 }, { rects, exclude: new Set(["s2"]) }), "s1");
  assert.equal(containerAt(b, { x: 40, y: 560 }, { rects, exclude: new Set(["s1"]) }), "board0001");
  assert.equal(containerAt(b, { x: 100, y: 100 }, { rects }), "board0001");
  assert.equal(containerAt(b, { x: 1000, y: 300 }, { rects }), "h1");
});

test("toRelative", () => {
  const b = build();
  const rects = worldRects(b);
  assert.deepEqual(toRelative(b, "board0001", { x: 5, y: 6 }, rects), { x: 5, y: 6 });
  assert.deepEqual(toRelative(b, "s2", { x: 30, y: 540 }, rects), { x: 10, y: 40 });
});

test("hitTest parts", () => {
  const b = build();
  const rects = worldRects(b);
  assert.deepEqual(hitTest(b, { x: 100, y: 400 }, rects), { uid: "m1", part: "body" });
  assert.deepEqual(hitTest(b, { x: 100, y: 100 }, rects), { uid: "c1", part: "body" });
  assert.deepEqual(hitTest(b, { x: 10, y: 310 }, rects), { uid: "s1", part: "title" });
  assert.deepEqual(hitTest(b, { x: 100, y: 515 }, rects), { uid: "s2", part: "title" });
  assert.deepEqual(hitTest(b, { x: 2, y: 600 }, rects), { uid: "s1", part: "border" });
  assert.equal(hitTest(b, { x: 250, y: 680 }, rects), null);
  assert.deepEqual(hitTest(b, { x: 250, y: 680 }, rects, { sectionInterior: true }), { uid: "s1", part: "interior" });
  assert.equal(hitTest(b, { x: 290, y: 650 }, rects), null);
  assert.deepEqual(hitTest(b, { x: 290, y: 650 }, rects, { sectionInterior: true }), { uid: "s2", part: "interior" });
  assert.equal(hitTest(b, { x: -500, y: -500 }, rects), null);
});

test("itemsInRect contain vs intersect applies topLevelOf", () => {
  const b = build();
  const rects = worldRects(b);
  const contain = itemsInRect(b, { x: 0, y: 340, w: 700, h: 400 }, rects);
  assert.deepEqual(contain.slice().sort(), ["m1", "m2", "s2"]);
  assert.deepEqual(itemsInRect(b, { x: 0, y: 340, w: 700, h: 400 }, rects, { mode: "contain" }).slice().sort(), ["m1", "m2", "s2"]);
  assert.deepEqual(itemsInRect(b, { x: 0, y: 0, w: 100, h: 100 }, rects, { mode: "intersect" }), ["c1"]);
  assert.deepEqual(itemsInRect(b, { x: 450, y: 280, w: 100, h: 100 }, rects, { mode: "intersect" }), ["s1", "nb"]);
  assert.deepEqual(itemsInRect(b, { x: 0, y: 0, w: 100, h: 100 }, rects), []);
});

test("membershipPlan moves a card into a section and out of one", () => {
  const b = build();
  const rects = worldRects(b);
  const into = new Map(rects);
  into.set("c1", { x: 100, y: 400, w: 280, h: 160 });
  assert.deepEqual(membershipPlan(b, ["c1"], into), [{ uid: "c1", fromParent: "board0001", toParent: "s1", x: 100, y: 100 }]);
  const intoInner = new Map(rects);
  intoInner.set("c1", { x: 40, y: 520, w: 100, h: 60 });
  assert.deepEqual(membershipPlan(b, ["c1"], intoInner), [{ uid: "c1", fromParent: "board0001", toParent: "s2", x: 20, y: 20 }]);
  const out = new Map(rects);
  out.set("m2", { x: 900, y: 900, w: 280, h: 160 });
  assert.deepEqual(membershipPlan(b, ["m2"], out), [{ uid: "m2", fromParent: "s1", toParent: "board0001", x: 900, y: 900 }]);
  assert.deepEqual(membershipPlan(b, ["m3", "c1"], rects), []);
  const nest = new Map(rects);
  nest.set("s1", { x: 900, y: 220, w: 500, h: 400 });
  assert.deepEqual(membershipPlan(b, ["s1", "m1"], nest), [{ uid: "s1", fromParent: "board0001", toParent: "h1", x: 12, y: 20 }]);
});

test("sectionAdoptPlan adopts siblings and releases members", () => {
  const b = build();
  const rects = worldRects(b);
  const adopt = new Map(rects);
  adopt.set("c3", { x: 900, y: 300, w: 280, h: 160 });
  assert.deepEqual(sectionAdoptPlan(b, "h1", adopt), [{ uid: "c3", toParent: "h1", x: 12, y: 100 }]);
  const shrink = new Map(rects);
  shrink.set("h1", { x: 888, y: 200, w: 100, h: 100 });
  assert.deepEqual(sectionAdoptPlan(b, "h1", shrink), [{ uid: "hc1", toParent: "board0001", x: 888, y: 200 }]);
  assert.deepEqual(sectionAdoptPlan(b, "h1", rects), []);
  assert.deepEqual(sectionAdoptPlan(b, "nope", rects), []);
});

test("edgesTouching includes edges on members of a moved section", () => {
  const b = build();
  assert.deepEqual([...edgesTouching(b, new Set(["c2"]))].sort(), ["e1", "e3"]);
  assert.deepEqual([...edgesTouching(b, new Set(["s1"]))], ["e3"]);
  assert.deepEqual([...edgesTouching(b, new Set(["t1"]))], []);
});

test("findEdge is directed", () => {
  const b = build();
  assert.equal(findEdge(b, "c1", "c2").uid, "e1");
  assert.equal(findEdge(b, "c2", "c1"), null);
});

test("diffBoards structural vs dirty-only", () => {
  const prev = build();
  const same = diffBoards(prev, build());
  assert.equal(same.structural, false);
  assert.equal(same.dirty.size, 0);

  const moved = fixture();
  moved[":block/children"][3][":block/children"][0][":block/props"][":plexus"][":x"] = 55;
  const d1 = diffBoards(prev, buildBoard(moved));
  assert.equal(d1.structural, false);
  assert.deepEqual([...d1.dirty], ["m1"]);

  const relabel = fixture();
  relabel[":block/children"][7][":block/children"][0][":block/string"] = "[[Page One]] → blocks → ((c2))";
  const d2 = diffBoards(prev, buildBoard(relabel));
  assert.equal(d2.structural, false);
  assert.deepEqual([...d2.dirty], ["e1"]);

  const added = fixture();
  added[":block/children"].push(blk("new1", 8, "fresh", { x: 0, y: 900 }));
  const d3 = diffBoards(prev, buildBoard(added));
  assert.equal(d3.structural, true);
  assert.ok(d3.dirty.has("new1"));

  const reparent = fixture();
  const [m2] = reparent[":block/children"][3][":block/children"].splice(1, 1);
  reparent[":block/children"].push({ ...m2, ":block/order": 9 });
  assert.equal(diffBoards(prev, buildBoard(reparent)).structural, true);

  const reorder = fixture();
  reorder[":block/children"][0][":block/order"] = 5;
  assert.equal(diffBoards(prev, buildBoard(reorder)).structural, true);

  assert.equal(diffBoards(null, prev).structural, true);
  assert.equal(diffBoards(null, prev).dirty.size, prev.items.size + prev.edges.size);
});

const boardCard = (extra = {}) => ({
  ...blk("nb1", 0, "{{[[diagram]]:Inner}}", { x: 40, y: 50, w: 320, h: 220, v: 2 }),
  ":block/children": [
    blk("k1", 0, "kid one", { x: 100, y: 100, w: 200, h: 100, color: "teal" }),
    blk("k2", 1, "kid two", { x: 500, y: 300, w: 100, h: 100 }),
    blk("ks", 2, "Frame", { type: "section", x: 0, y: 0, w: 700, h: 500 }),
    blk("ke", 3, "Connections", { type: "edges" }, { ":block/children": [blk("kx", 0, "((k1)) → ((k2))", { type: "edge", from: "k1", to: "k2" })] }),
  ],
  ...extra,
});

test("a nested board card is a board-kind item with its layout, and the child board is enhanced", () => {
  const parent = buildBoard({
    ":block/uid": "root0001",
    ":block/string": "{{[[diagram]]:Root}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [boardCard()],
  });
  const card = parent.items.get("nb1");
  assert.equal(card.kind, "board");
  assert.equal(card.type, "card");
  assert.equal(card.hasLayout, true);
  assert.deepEqual([card.x, card.y, card.w, card.h], [40, 50, 320, 220]);
  assert.equal(card.title, "Inner");
  const child = buildBoard({ ":block/uid": card.uid, ":block/string": card.string, ":block/props": boardCard()[":block/props"], ":block/children": card.content });
  assert.equal(child.enhanced, true);
  assert.equal(child.items.size, 3);
  assert.equal(child.edges.size, 1);
});

test("hitTest exclude skips the given uids in both passes", () => {
  const b = buildBoard(fixture());
  const rects = worldRects(b);
  const at = { x: 10, y: 10 };
  assert.equal(hitTest(b, at, rects)?.uid, "c1");
  assert.equal(hitTest(b, at, rects, { exclude: new Set(["c1"]) }), null);
  const title = { x: 10, y: 305 };
  assert.equal(hitTest(b, title, rects)?.uid, "s1");
  assert.equal(hitTest(b, title, rects, { exclude: new Set(["s1"]) }), null);
});

const previewOf = (kids, opts) => {
  const b = buildBoard({ ":block/uid": "r", ":block/string": "{{[[diagram]]}}", ":block/children": [{ ...boardCard(), ":block/children": kids }] });
  return boardPreview(b.items.get("nb1"), opts);
};

test("boardPreview returns fractions of a padded frame, a count, an aspect and a cap", () => {
  const b = buildBoard({ ":block/uid": "r", ":block/string": "{{[[diagram]]}}", ":block/children": [boardCard()] });
  const pv = boardPreview(b.items.get("nb1"));
  assert.equal(pv.count, 3);
  assert.equal(pv.empty, false);
  assert.deepEqual(pv.bounds, { x: 0, y: 0, w: 700, h: 500 });
  // pad = max(24, 0.12 * 700) = 84, so the frame is 868 x 668 centered on the bounds
  const fw = 868;
  const fh = 668;
  near(pv.aspect, fw / fh);
  assert.equal(pv.rects[0].type, "section", "sections draw first");
  assert.equal(pv.rects[0].title, "Frame");
  near(pv.rects[0].x, 84 / fw);
  near(pv.rects[0].y, 84 / fh);
  near(pv.rects[0].w, 700 / fw);
  near(pv.rects[0].h, 500 / fh);
  const k1 = pv.rects.find((r) => r.color === "teal");
  near(k1.x, 184 / fw);
  near(k1.y, 184 / fh);
  near(k1.w, 200 / fw);
  near(k1.h, 100 / fh);
  assert.equal(k1.title, "kid one");
  assert.equal(k1.type, "card");
  assert.equal(k1.kind, "note");
  assert.ok(pv.rects.every((r) => r.x >= 0 && r.x + r.w <= 1.000001 && r.y >= 0 && r.y + r.h <= 1.000001));
  assert.equal(boardPreview(b.items.get("nb1"), { max: 2 }).rects.length, 2);
  assert.equal(boardPreview(b.items.get("nb1"), { max: 2 }).count, 3);
});

test("boardPreview edges are child-edge center fractions", () => {
  const pv = previewOf(boardCard()[":block/children"]);
  assert.equal(pv.edges.length, 1);
  // k1 center (200,150) -> k2 center (550,350) in a frame starting at (-84,-84), 868 x 668
  near(pv.edges[0].x1, 284 / 868);
  near(pv.edges[0].y1, 234 / 668);
  near(pv.edges[0].x2, 634 / 868);
  near(pv.edges[0].y2, 434 / 668);
  const dangling = previewOf([
    blk("k1", 0, "one", { x: 0, y: 0 }),
    blk("ke", 1, "Connections", { type: "edges" }, { ":block/children": [blk("kx", 0, "x", { type: "edge", from: "k1", to: "gone" })] }),
  ]);
  assert.deepEqual(dangling.edges, []);
});

test("boardPreview of a single card is a small tile inside a padded frame, not 100% of it", () => {
  const pv = previewOf([blk("only", 0, "Solo card\nsecond line", { x: 1000, y: 2000 })]);
  assert.equal(pv.count, 1);
  assert.deepEqual(pv.bounds, { x: 1000, y: 2000, w: 280, h: 160 });
  const r = pv.rects[0];
  assert.ok(r.w < 0.5 && r.h < 0.5, `single tile is ${r.w} x ${r.h}`);
  assert.equal(r.title, "Solo card");
  // frame grows to 560 x 320 plus pad max(24, 0.12 * 280) = 33.6 per side, centered on the card
  near(r.w, 280 / (560 + 67.2));
  near(r.x + r.w / 2, 0.5);
  near(r.y + r.h / 2, 0.5);
});

test("boardPreview truncates titles to 40 characters and uses the board title for board cards", () => {
  const long = "x".repeat(80);
  const pv = previewOf([
    blk("a", 0, long, { x: 0, y: 0 }),
    blk("t", 1, "Plain text", { type: "text", x: 300, y: 0 }),
    blk("nb", 2, "{{[[diagram]]:Deep}}", { x: 600, y: 0, v: 2 }),
  ]);
  assert.equal(pv.rects.find((r) => r.type === "text").title, "Plain text");
  assert.equal(pv.rects.filter((r) => r.type === "card").map((r) => r.title).sort()[1].length, 40);
  assert.equal(pv.rects.find((r) => r.kind === "board").title, "Deep");
});

test("boardPreview of an empty board card", () => {
  assert.deepEqual(previewOf([]), { count: 0, aspect: 1.6, rects: [], edges: [], bounds: null, empty: true });
});

test("boardPreview clamps a wide aspect and expands (never shrinks) to a target aspect", () => {
  const wide = previewOf([blk("w1", 0, "a", { x: 0, y: 0, w: 8000, h: 10 })]);
  near(wide.aspect, 4);
  assert.ok(wide.rects[0].w <= 1 && wide.rects[0].h > 0);
  const tall = previewOf([blk("w1", 0, "a", { x: 0, y: 0, w: 10, h: 8000 })]);
  near(tall.aspect, 0.25);
  const target = previewOf(boardCard()[":block/children"], { aspect: 2 });
  near(target.aspect, 2);
  assert.deepEqual(target.bounds, { x: 0, y: 0, w: 700, h: 500 });
  // frame expanded to 2:1 around the same center: height stays 668, width becomes 1336
  const sec = target.rects[0];
  near(sec.w, 700 / 1336);
  near(sec.h, 500 / 668);
  near(sec.x + sec.w / 2, 0.5);
  const tallTarget = previewOf(boardCard()[":block/children"], { aspect: 0.5 });
  near(tallTarget.rects[0].w, 700 / 868);
  near(tallTarget.rects[0].h, 500 / 1736);
});

test("boardPreview pad option widens the frame", () => {
  const a = previewOf(boardCard()[":block/children"], { pad: 0.12 });
  const b = previewOf(boardCard()[":block/children"], { pad: 0.3 });
  assert.ok(b.rects[0].w < a.rects[0].w);
});

test("buildBoard exposes pinned, autofit and the board background", () => {
  const b = buildBoard({
    ":block/uid": "r",
    ":block/string": "{{[[diagram]]}}",
    ":block/props": { ":plexus": { ":v": 2, ":bg": "grid", ":bgColor": "indigo" } },
    ":block/children": [
      blk("p", 0, "pinned card", { x: 0, y: 0, pinned: true }),
      blk("q", 1, "plain card", { x: 0, y: 0, pinned: false }),
      blk("s", 2, "Locked", { type: "section", x: 0, y: 0, fit: false }),
      blk("s2", 3, "Auto", { type: "section", x: 0, y: 0 }),
      blk("c", 4, "card with fit false", { x: 0, y: 0, fit: false }),
    ],
  });
  assert.deepEqual(b.background, { pattern: "grid", tone: "indigo" });
  assert.equal(b.items.get("p").pinned, true);
  assert.equal(b.items.get("q").pinned, false);
  assert.equal(b.items.get("s").autofit, false);
  assert.equal(b.items.get("s2").autofit, true);
  assert.equal(b.items.get("c").autofit, true);
  assert.deepEqual(buildBoard(fixture()).background, { pattern: null, tone: null });
  const bad = buildBoard({ ":block/uid": "r", ":block/string": "", ":block/props": { ":plexus": { ":bg": "neon", ":bgColor": "puce" } } });
  assert.deepEqual(bad.background, { pattern: null, tone: null });
});

function fitBoard() {
  return buildBoard({
    ":block/uid": "fitboard",
    ":block/string": "{{[[diagram]]}}",
    ":block/children": [
      blk("outer", 0, "Outer", { type: "section", x: 0, y: 0, w: 1000, h: 800 }, {
        ":block/children": [
          blk("mid", 0, "Mid", { type: "section", x: 100, y: 100, w: 600, h: 400 }, {
            ":block/children": [
              blk("k1", 0, "one", { x: 50, y: 50, w: 200, h: 100 }),
              blk("k2", 1, "two", { x: 300, y: 50, w: 200, h: 100 }),
            ],
          }),
          blk("free", 1, "free", { x: 40, y: 600, w: 100, h: 100 }),
        ],
      }),
      blk("locked", 1, "Locked", { type: "section", x: 2000, y: 0, w: 300, h: 300, fit: false }, {
        ":block/children": [blk("lk", 0, "in locked", { x: 10, y: 10, w: 100, h: 100 })],
      }),
      blk("top", 2, "Top", { x: 3000, y: 0, w: 100, h: 100 }),
    ],
  });
}

const planOf = (plan) => Object.fromEntries(plan.map((p) => [p.uid, p.rect]));

test("sectionFitPlan is a no-op for a member inside its section", () => {
  const b = fitBoard();
  const rects = worldRects(b);
  assert.deepEqual(sectionFitPlan(b, rects, ["k1", "free", "top", "outer"]), []);
});

test("sectionFitPlan stops at a pinned section: it never grows, and neither does anything above it", () => {
  const b = fitBoard();
  b.items.get("mid").pinned = true;
  const base = worldRects(b);
  const plan = sectionFitPlan(b, new Map([...base, ["k1", { x: 60, y: 200, w: 300, h: 100 }]]), ["k1"]);
  assert.deepEqual(plan, [], "the pinned section stays put and the card overhangs it");
  b.items.get("mid").pinned = false;
  b.items.get("outer").pinned = true;
  const inner = planOf(sectionFitPlan(b, new Map([...base, ["k1", { x: 500, y: 200, w: 400, h: 100 }]]), ["k1"]));
  assert.ok(inner.mid, "an unpinned section still grows");
  assert.equal(inner.outer, undefined, "a pinned ancestor is not grown by the chain");
});

test("sectionFitPlan grows a section to the right, bottom, left and top with padding", () => {
  const b = fitBoard();
  const base = worldRects(b);
  const midRect = base.get("mid"); // world 100,100 600x400
  const grow = (r) => planOf(sectionFitPlan(b, new Map([...base, ["k1", r]]), ["k1"]));

  const right = grow({ x: 500, y: 200, w: 300, h: 100 }); // right edge 800 > 700
  assert.deepEqual(right.mid, { x: 100, y: 100, w: 724, h: 400 });
  assert.equal(right.outer, undefined, "outer still contains mid");

  const bottom = grow({ x: 200, y: 450, w: 100, h: 200 }); // bottom 650 > 500
  assert.deepEqual(bottom.mid, { x: 100, y: 100, w: 600, h: 574 });

  const left = grow({ x: 60, y: 200, w: 100, h: 100 }); // left 60 < 100
  assert.deepEqual(left.mid, { x: 36, y: 100, w: 664, h: 400 });

  const top = grow({ x: 200, y: 40, w: 100, h: 100 });
  assert.deepEqual(top.mid, { x: 100, y: 16, w: 600, h: 484 });
  assert.deepEqual(midRect, { x: 100, y: 100, w: 600, h: 400 });
});

test("sectionFitPlan cascades through two nested sections, deepest first", () => {
  const b = fitBoard();
  const rects = new Map(worldRects(b));
  rects.set("k2", { x: 900, y: 200, w: 200, h: 100 }); // right edge 1100 > mid 700 and outer 1000
  const plan = sectionFitPlan(b, rects, ["k2"]);
  assert.deepEqual(plan.map((p) => p.uid), ["mid", "outer"]);
  const by = planOf(plan);
  assert.deepEqual(by.mid, { x: 100, y: 100, w: 1024, h: 400 });
  assert.deepEqual(by.outer, { x: 0, y: 0, w: 1148, h: 800 });
});

test("sectionFitPlan stops at autofit=false, skip, the board and non-sections", () => {
  const b = fitBoard();
  const rects = new Map(worldRects(b));
  rects.set("lk", { x: 2500, y: 10, w: 100, h: 100 });
  assert.deepEqual(sectionFitPlan(b, rects, ["lk"]), []);

  const r2 = new Map(worldRects(b));
  r2.set("k2", { x: 900, y: 200, w: 200, h: 100 });
  assert.deepEqual(planOf(sectionFitPlan(b, r2, ["k2"], { skip: new Set(["mid"]) })), {});
  assert.deepEqual(sectionFitPlan(b, r2, ["k2"], { skip: new Set(["outer"]) }).map((p) => p.uid), ["mid"]);

  const r3 = new Map(worldRects(b));
  r3.set("top", { x: -500, y: -500, w: 100, h: 100 });
  assert.deepEqual(sectionFitPlan(b, r3, ["top"]), [], "a root item has no section to grow");
  assert.deepEqual(sectionFitPlan(b, r3, ["nope"]), []);
});

test("sectionFitPlan parentOf override lets a live drag target a different section", () => {
  const b = fitBoard();
  const rects = new Map(worldRects(b));
  rects.set("top", { x: 1200, y: 100, w: 100, h: 100 });
  assert.deepEqual(sectionFitPlan(b, rects, ["top"]), []);
  const plan = sectionFitPlan(b, rects, ["top"], { parentOf: (u) => (u === "top" ? "outer" : b.items.get(u)?.parentUid) });
  assert.deepEqual(planOf(plan), { outer: { x: 0, y: 0, w: 1324, h: 800 } });
});

test("sectionFitPlan: two touched siblings share one grown rect and it never shrinks", () => {
  const b = fitBoard();
  const rects = new Map(worldRects(b));
  rects.set("k1", { x: 500, y: 200, w: 300, h: 100 }); // right 800
  rects.set("k2", { x: 200, y: 450, w: 100, h: 200 }); // bottom 650
  const plan = sectionFitPlan(b, rects, ["k1", "k2"]);
  assert.equal(plan.filter((p) => p.uid === "mid").length, 1);
  assert.deepEqual(planOf(plan).mid, { x: 100, y: 100, w: 724, h: 574 });
  const shrunk = new Map(worldRects(b));
  shrunk.set("k1", { x: 150, y: 150, w: 10, h: 10 });
  shrunk.set("k2", { x: 160, y: 160, w: 10, h: 10 });
  assert.deepEqual(sectionFitPlan(b, shrunk, ["k1", "k2"]), []);
});

test("sectionFitPlan honors a custom pad", () => {
  const b = fitBoard();
  const rects = new Map(worldRects(b));
  rects.set("k1", { x: 500, y: 200, w: 300, h: 100 });
  assert.deepEqual(planOf(sectionFitPlan(b, rects, ["k1"], { pad: 0 })).mid, { x: 100, y: 100, w: 700, h: 400 });
});

test("outlineOrder is depth first by block order", () => {
  const b = buildBoard(fixture());
  const order = outlineOrder(b);
  assert.deepEqual(order, ["c1", "c2", "c3", "s1", "m1", "m2", "s2", "m3", "t1", "h1", "hc1", "nb"]);
  assert.equal(new Set(order).size, b.items.size);
  const shuffled = buildBoard({
    ":block/uid": "r",
    ":block/string": "",
    ":block/children": [blk("b", 1, "b", { x: 0, y: 0 }), blk("a", 0, "a", { x: 0, y: 0 })],
  });
  assert.deepEqual(outlineOrder(shuffled), ["a", "b"]);
});

test("sidebarOutlineUids lists roots then the Connections block", () => {
  assert.deepEqual(sidebarOutlineUids(build()), ["c1", "c2", "c3", "s1", "t1", "h1", "nb", "ex"]);
  assert.deepEqual(sidebarOutlineUids(null), []);
});
