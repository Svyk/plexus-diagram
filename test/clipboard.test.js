import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard, worldRects } from "../src/model/board.js";
import {
  PLEXUS_MIME, copyPayload, parseClipboard, parsePastedText, planEdgeClones, planSubtreeClone, refCardStrings,
} from "../src/model/clipboard.js";

const blk = (uid, order, string, plexus, extra = {}) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ...(plexus ? { ":block/props": { ":plexus": Object.fromEntries(Object.entries(plexus).map(([k, v]) => [`:${k}`, v])) } } : {}),
  ...extra,
});

function board() {
  return buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:B}}",
    ":block/children": [
      blk("c1", 0, "[[Page One]]", { x: 100, y: 100, w: 200, h: 100, color: "blue" }),
      blk("c2", 1, "((abcDEF123))", { x: 400, y: 150, w: 200, h: 100 }),
      blk("c3", 2, "plain note", { x: 0, y: 400, w: 200, h: 100 }),
      blk("s1", 3, "Sec", { type: "section", x: 700, y: 0, w: 400, h: 300 }, {
        ":block/children": [blk("m1", 0, "member", { x: 20, y: 40, w: 200, h: 100 })],
      }),
    ],
  });
}

const fakeData = (map, files) => ({ getData: (t) => map[t] ?? "", files });

test("copyPayload keeps top-level items with world rects and builds ref text", () => {
  const b = board();
  const rects = worldRects(b);
  const { mime, text } = copyPayload(b, ["c1", "c2", "c3", "s1", "m1"], rects);
  const data = JSON.parse(mime);
  assert.equal(data.v, 1);
  assert.equal(data.board, "board0001");
  assert.deepEqual(data.items.map((i) => i.uid), ["c1", "c2", "c3", "s1"]);
  assert.equal(text, "[[Page One]]\n((abcDEF123))\n((c3))\n((s1))");
  assert.deepEqual(data.bounds, { x: 0, y: 0, w: 1100, h: 500 });
  const s1 = data.items.find((i) => i.uid === "s1");
  assert.equal(s1.type, "section");
  assert.equal(data.items[0].color, "blue");
});

test("copyPayload of a section member uses world coordinates", () => {
  const b = board();
  const data = JSON.parse(copyPayload(b, ["m1"], worldRects(b)).mime);
  assert.equal(data.items[0].x, 720);
  assert.equal(data.items[0].y, 40);
});

test("clipboard round trip through parseClipboard and refCardStrings", () => {
  const b = board();
  const { mime } = copyPayload(b, ["c1", "c2"], worldRects(b));
  const parsed = parseClipboard(fakeData({ [PLEXUS_MIME]: mime, "text/plain": "ignored" }));
  assert.equal(parsed.kind, "plexus");
  const cards = refCardStrings(parsed.data, { x: 1000, y: 2000 });
  assert.deepEqual(cards, [
    { string: "[[Page One]]", x: 1000, y: 2000, w: 200, h: 100, color: "blue" },
    { string: "((abcDEF123))", x: 1300, y: 2050, w: 200, h: 100, color: undefined },
  ]);
});

test("parseClipboard order: plexus, then images, then text, else null", () => {
  const png = { type: "image/png", name: "a.png" };
  const txt = { type: "text/plain" };
  assert.equal(parseClipboard(fakeData({ "text/plain": "hi" }, [png, txt])).kind, "images");
  assert.deepEqual(parseClipboard(fakeData({ "text/plain": "hi" }, [png, txt])).files, [png]);
  assert.equal(parseClipboard(fakeData({ [PLEXUS_MIME]: JSON.stringify({ v: 1, items: [] }), "text/plain": "hi" }, [png])).kind, "plexus");
  assert.deepEqual(parseClipboard(fakeData({ "text/plain": "- a\n- b" })), { kind: "text", entries: [{ string: "a" }, { string: "b" }] });
  assert.equal(parseClipboard(fakeData({ [PLEXUS_MIME]: "{not json", "text/plain": "hi" })).kind, "text");
  assert.equal(parseClipboard(fakeData({})), null);
  assert.equal(parseClipboard(fakeData({ "text/plain": "  \n " })), null);
});

test("parsePastedText strips bullets, skips blanks, keeps refs, caps at 50", () => {
  assert.deepEqual(parsePastedText("- one\n\n* two\n[[Page]]\n((abc123def))\n  - [[Nested]]\nplain - dash"), [
    { string: "one" }, { string: "two" }, { string: "[[Page]]" }, { string: "((abc123def))" }, { string: "[[Nested]]" }, { string: "plain - dash" },
  ]);
  const many = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(parsePastedText(many).length, 50);
});

const pulled = {
  ":block/uid": "old1",
  ":block/string": "Root ((old2)) and ((keep))",
  ":block/open": true,
  ":block/props": { ":plexus": { ":x": 1, ":y": 2 }, ":other": { ":k": "v" } },
  ":block/children": [
    { ":block/uid": "old3", ":block/string": "later", ":block/order": 1, ":block/open": false, ":block/props": { ":plexus": { ":x": 9 } } },
    { ":block/uid": "old2", ":block/string": "first ((old1))", ":block/order": 0, ":block/children": [{ ":block/uid": "old4", ":block/string": "deep", ":block/order": 0 }] },
  ],
};

test("planSubtreeClone assigns fresh uids, emits pre-order creates, rewrites refs, preserves props", () => {
  let n = 0;
  const { creates, uidMap } = planSubtreeClone(pulled, {
    genUid: () => `new${++n}`,
    parentUid: "boardX",
    order: 5,
    plexusPatch: { x: 500, y: 600 },
  });
  assert.deepEqual(creates.map((c) => c.uid), ["new1", "new2", "new3", "new4"]);
  assert.deepEqual(creates.map((c) => c.parent), ["boardX", "new1", "new2", "new1"]);
  assert.deepEqual(creates.map((c) => c.order), [5, 0, 0, 1]);
  assert.equal(creates[0].string, "Root ((new2)) and ((keep))");
  assert.equal(creates[1].string, "first ((new1))");
  assert.deepEqual(creates[0].props, { plexus: { x: 500, y: 600 }, other: { k: "v" } });
  assert.deepEqual(creates[3].props, { plexus: { x: 9 } });
  assert.equal(creates[3].open, false);
  assert.equal(creates[2].props, null);
  assert.equal(creates[2].open, true);
  assert.equal(uidMap.get("old4"), "new3");
  // the source is not mutated
  assert.deepEqual(pulled[":block/props"][":plexus"], { ":x": 1, ":y": 2 });
});

test("planSubtreeClone defaults: order 'last', no patch, external uidMap is filled", () => {
  const map = new Map();
  const { creates, uidMap } = planSubtreeClone(pulled, { genUid: (() => { let i = 0; return () => `u${++i}`; })(), parentUid: "p", uidMap: map });
  assert.equal(uidMap, map);
  assert.equal(creates[0].order, "last");
  assert.deepEqual(creates[0].props, { plexus: { x: 1, y: 2 }, other: { k: "v" } });
});

test("planEdgeClones clones only edges whose both ends were cloned", () => {
  const uidMap = new Map([["a", "A2"], ["b", "B2"]]);
  const edges = new Map([
    ["e1", { uid: "e1", from: "a", to: "b", dir: "two", label: "causes", route: "elbow", color: "red", dash: "solid", weight: 1, fromSide: "auto", toSide: "auto" }],
    ["e2", { uid: "e2", from: "a", to: "outside", dir: "one", label: "", route: "curve" }],
  ]);
  let n = 0;
  const creates = planEdgeClones(edges, uidMap, { genUid: () => `E${++n}`, containerUid: "cont", refOfNew: (u) => `((${u}))` });
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0], {
    uid: "E1",
    parent: "cont",
    order: "last",
    string: "((A2)) ↔ causes ↔ ((B2))",
    props: { plexus: { type: "edge", from: "A2", to: "B2", dir: "two", route: "elbow", color: "red" } },
    open: true,
  });
});
