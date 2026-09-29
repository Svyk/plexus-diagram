import assert from "node:assert/strict";
import test from "node:test";
import {
  boardPreview, boundsOf, buildBoard, containerAt, descendantsOf, diffBoards, edgesTouching, findEdge, hitTest,
  itemsInRect, membershipPlan, sectionAdoptPlan, toRelative, topLevelOf, worldRect, worldRects,
} from "../src/model/board.js";

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

test("boardPreview returns fractions of the child bounds, a count, an aspect and a cap", () => {
  const b = buildBoard({ ":block/uid": "r", ":block/string": "{{[[diagram]]}}", ":block/children": [boardCard()] });
  const pv = boardPreview(b.items.get("nb1"));
  assert.equal(pv.count, 3);
  assert.deepEqual(pv.bounds, { x: 0, y: 0, w: 700, h: 500 });
  assert.equal(pv.aspect, 700 / 500);
  assert.equal(pv.rects[0].type, "section", "sections draw first");
  assert.deepEqual([pv.rects[0].x, pv.rects[0].y, pv.rects[0].w, pv.rects[0].h], [0, 0, 1, 1]);
  const k1 = pv.rects.find((r) => r.color === "teal");
  assert.deepEqual([k1.x, k1.y, k1.w, k1.h], [100 / 700, 100 / 500, 200 / 700, 100 / 500]);
  assert.ok(pv.rects.every((r) => r.x >= 0 && r.x + r.w <= 1.000001 && r.y >= 0 && r.y + r.h <= 1.000001));
  assert.equal(boardPreview(b.items.get("nb1"), { max: 2 }).rects.length, 2);
  assert.equal(boardPreview(b.items.get("nb1"), { max: 2 }).count, 3);
});

test("boardPreview of an empty board card and an extreme aspect", () => {
  const empty = buildBoard({ ":block/uid": "r", ":block/string": "{{[[diagram]]}}", ":block/children": [{ ...boardCard(), ":block/children": [] }] });
  assert.deepEqual(boardPreview(empty.items.get("nb1")), { count: 0, aspect: 1.5, rects: [], bounds: null });
  const wide = buildBoard({ ":block/uid": "r", ":block/string": "{{[[diagram]]}}", ":block/children": [{ ...boardCard(), ":block/children": [blk("w1", 0, "a", { x: 0, y: 0, w: 1000, h: 10 })] }] });
  assert.equal(boardPreview(wide.items.get("nb1")).aspect, 4);
});
