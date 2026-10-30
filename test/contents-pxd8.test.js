import assert from "node:assert/strict";
import test from "node:test";

import { boardContents } from "../src/model/contents.js";

const sec = (uid, depth, members, extra = {}) => ({ uid, type: "section", title: uid, string: uid, depth, members, order: 0, ...extra });
const card = (uid, depth, extra = {}) => ({ uid, type: "card", string: uid, depth, members: [], order: 0, ...extra });

function board(list, roots, extra = {}) {
  const items = new Map();
  list.forEach((it, i) => items.set(it.uid, { order: i, ...it }));
  return { uid: "b", items, roots, order: list.map((i) => i.uid), trails: [], views: [], ...extra };
}

test("rows follow outline order: nested sections, landmark cards and landmark sections", () => {
  const b = board([
    sec("s1", 0, ["c1", "s2", "c2"], { color: "teal" }),
    card("c1", 1, { landmark: true, glyph: "*" }),
    sec("s2", 1, [], { landmark: true, glyph: "!" }),
    card("c2", 1),
    card("root", 0, { landmark: true }),
  ], ["s1", "root"]);
  const { rows } = boardContents(b);
  assert.deepEqual(rows.map((r) => [r.kind, r.uid, r.depth]), [["section", "s1", 0], ["landmark", "c1", 1], ["section", "s2", 1], ["landmark", "root", 0]]);
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].color, "teal");
  assert.equal(rows[0].glyph, undefined);
  assert.equal(rows[1].glyph, "*");
  assert.equal(rows[2].glyph, "!");
  assert.equal(rows[3].glyph, "");
});

test("trails count only on-board stops; views follow trails", () => {
  const b = board([sec("s1", 0, ["c1"]), card("c1", 1)], ["s1"], {
    trails: [{ uid: "t1", name: "Tour", stops: [{ ref: "c1" }, { ref: "gone" }, { ref: "s1" }] }, { uid: "t2", name: "", stops: [] }],
    views: [{ uid: "v1", caption: "Corner", v: [0, 0, 1, 1], ids: [] }, { uid: "v2", caption: "", v: [0, 0, 1, 1], ids: [] }],
  });
  const { rows } = boardContents(b);
  assert.deepEqual(rows.slice(1).map((r) => [r.kind, r.uid, r.title, r.count]), [["trail", "t1", "Tour", 2], ["trail", "t2", "Trail", 0], ["view", "v1", "Corner", undefined], ["view", "v2", "View", undefined]]);
});

test("sig moves with a shown field and holds when nothing changed", () => {
  const make = (title) => board([sec("s1", 0, [], { title })], ["s1"]);
  assert.equal(boardContents(make("A")).sig, boardContents(make("A")).sig);
  assert.notEqual(boardContents(make("A")).sig, boardContents(make("B")).sig);
});

test("a 3,000-item board builds in one pass with every section and landmark listed", () => {
  const list = [];
  const roots = [];
  for (let i = 0; i < 300; i += 1) {
    const members = [];
    for (let j = 0; j < 9; j += 1) members.push(`c${i}_${j}`);
    list.push(sec(`s${i}`, 0, members));
    roots.push(`s${i}`);
    for (let j = 0; j < 9; j += 1) list.push(card(`c${i}_${j}`, 1, j === 0 ? { landmark: true } : {}));
  }
  const b = board(list, roots);
  assert.equal(b.items.size, 3000);
  const { rows } = boardContents(b);
  assert.equal(rows.length, 600);
  assert.equal(rows.filter((r) => r.kind === "section").length, 300);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.uid), ["s0", "c0_0", "s1"]);
});
