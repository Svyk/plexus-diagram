import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangeLane,
  bandIndexAt,
  bandOfRow,
  bandRect,
  laneBands,
  laneFields,
  laneValueOf,
  planLaneDrop,
  readLaneBind,
  serializeBands,
  valueKey,
  valueTokens,
} from "../src/model/attr-lanes.js";

const row = (uid, ...attrs) => ({
  uid,
  attrs: attrs.map(([name, value, aUid]) => ({ name, value, uid: aUid ?? `${uid}-${name}` })),
});

test("laneFields offers attributes only: no marker, highlight or BT_attr", () => {
  const rows = [
    { ...row("a", ["Priority", "High"], ["Status", "Open"]), highlightColor: "red" },
    { uid: "b", attrs: [{ name: "BT_attrDue", value: "x" }] },
  ];
  assert.deepEqual(laneFields(rows), ["Priority", "Status"]);
});

test("binding reads back only a valid attribute name", () => {
  assert.deepEqual(readLaneBind({ attr: "Priority", bands: ["High", 3, "", "[[Low]]"] }), { name: "Priority", bands: ["High", "[[Low]]"] });
  assert.equal(readLaneBind({ attr: "BT_attrDue" }), null);
  assert.equal(readLaneBind({ attr: "  " }), null);
  assert.equal(readLaneBind({}), null);
});

test("values map to bands: stored order first, refs and plain text share a key, none last", () => {
  const rows = [
    row("a", ["Priority", "Low"]),
    row("b", ["Priority", "[[High]]"]),
    row("c"),
    row("d", ["Priority", "#Mid"]),
    row("e", ["Priority", "High"]),
  ];
  const bands = laneBands(rows, "Priority", ["High"]);
  assert.deepEqual(bands.map((b) => b.label), ["High", "Low", "Mid", "none"]);
  assert.equal(bands.at(-1).none, true);
  assert.equal(bandOfRow(bands, rows[1], "Priority"), 0);
  assert.equal(bandOfRow(bands, rows[4], "Priority"), 0);
  assert.equal(bandOfRow(bands, rows[0], "Priority"), 1);
  assert.equal(bandOfRow(bands, rows[2], "Priority"), 3, "no value sits in none");
  assert.deepEqual(serializeBands(bands), ["High", "Low", "#Mid"]);
  // A value cleared in Roam: the same card now maps to none (its mark), the bands keep their stored order.
  const cleared = laneBands([row("a", ["Priority", ""])], "Priority", serializeBands(bands));
  assert.equal(bandOfRow(cleared, row("a", ["Priority", ""]), "Priority"), cleared.length - 1);
  assert.deepEqual(cleared.map((b) => b.label), ["High", "Low", "Mid", "none"]);
});

test("value tokens: refs and tags split, prose stays whole", () => {
  assert.deepEqual(valueTokens("[[A]] [[B]]").map((t) => t.raw), ["[[A]]", "[[B]]"]);
  assert.deepEqual(valueTokens("#[[A b]], #c").map((t) => t.raw), ["#[[A b]]", "#c"]);
  assert.deepEqual(valueTokens("[[A]] later").map((t) => t.raw), ["[[A]] later"]);
  assert.deepEqual(valueTokens("  "), []);
  assert.equal(valueKey("#[[A b]]"), "A b");
});

test("band geometry: horizontal lanes split x, vertical lanes split y", () => {
  const rect = { x: 100, y: 0, w: 900, h: 180 };
  assert.deepEqual(bandRect(rect, "horizontal", 3, 1), { x: 400, y: 0, w: 300, h: 180 });
  assert.equal(bandIndexAt(rect, "horizontal", 3, { x: 399, y: 50 }), 0);
  assert.equal(bandIndexAt(rect, "horizontal", 3, { x: 401, y: 50 }), 1);
  assert.equal(bandIndexAt(rect, "horizontal", 3, { x: 5000, y: 50 }), 2);
  const v = { x: 0, y: 0, w: 240, h: 600 };
  assert.equal(bandIndexAt(v, "vertical", 3, { x: 10, y: 450 }), 2);
  assert.deepEqual(bandRect(v, "vertical", 3, 0), { x: 0, y: 0, w: 240, h: 200 });
});

test("a drop rewrites the first Name:: child, creates one when missing, and skips the same band", () => {
  const bands = laneBands([row("a", ["Priority", "Low"]), row("b", ["Priority", "[[High]]"])], "Priority");
  const high = bands[1];
  assert.deepEqual(planLaneDrop({ name: "Priority", row: row("a", ["Priority", "Low", "k1"]), band: high }), { op: "string", uid: "k1", string: "Priority:: [[High]]" });
  assert.deepEqual(planLaneDrop({ name: "Priority", row: row("c"), band: high }), { op: "create", parent: "c", string: "Priority:: [[High]]" });
  assert.deepEqual(planLaneDrop({ name: "Priority", row: { ...row("r"), writeUid: "target" }, band: high }), { op: "create", parent: "target", string: "Priority:: [[High]]" });
  assert.equal(planLaneDrop({ name: "Priority", row: row("b", ["Priority", "High"]), band: high }), null);
  assert.deepEqual(planLaneDrop({ name: "Priority", row: row("a", ["Priority", "Low", "k1"]), band: bands.at(-1) }), { op: "string", uid: "k1", string: "Priority::" });
  assert.equal(planLaneDrop({ name: "Priority", row: row("c"), band: bands.at(-1) }), null);
  assert.equal(planLaneDrop({ name: "BT_attrDue", row: row("a"), band: high }), null);
});

test("two values: the card shows the first and is marked; a drop never drops the second", () => {
  const twoKids = row("a", ["Priority", "Low", "k1"], ["Priority", "High", "k2"]);
  const v = laneValueOf(twoKids, "Priority");
  assert.equal(v.key, "Low");
  assert.equal(v.two, true);
  const bands = laneBands([twoKids], "Priority");
  assert.deepEqual(bands.map((b) => b.label), ["Low", "none"], "the second child does not make a band");
  const mid = { key: "Mid", raw: "Mid", label: "Mid" };
  assert.deepEqual(planLaneDrop({ name: "Priority", row: twoKids, band: mid }), { op: "string", uid: "k1", string: "Priority:: Mid" });
  assert.equal(planLaneDrop({ name: "Priority", row: twoKids, band: bands.at(-1) }), null, "none would lose a value");

  const multi = row("m", ["Priority", "[[Low]] [[High]]", "k3"]);
  assert.equal(laneValueOf(multi, "Priority").two, true);
  assert.equal(laneValueOf(multi, "Priority").key, "Low");
  assert.deepEqual(planLaneDrop({ name: "Priority", row: multi, band: { key: "High", raw: "[[High]]" } }), { op: "string", uid: "k3", string: "Priority:: [[High]] [[Low]]" });
  assert.deepEqual(planLaneDrop({ name: "Priority", row: multi, band: { key: "Mid", raw: "[[Mid]]" } }), { op: "string", uid: "k3", string: "Priority:: [[Mid]] [[High]]" });
  assert.equal(planLaneDrop({ name: "Priority", row: multi, band: { key: "", none: true } }), null);
});

test("arrange centers each card in its band and grows the lane to fit", () => {
  const out = arrangeLane({
    w: 300,
    h: 100,
    axis: "horizontal",
    bands: [{}, {}, {}],
    cards: [{ uid: "a", w: 200, h: 60, band: 0 }, { uid: "b", w: 200, h: 60, band: 0 }, { uid: "c", w: 100, h: 40, band: 2 }],
  });
  assert.equal(out.w, 3 * 232);
  assert.deepEqual(out.cards[0], { uid: "a", x: 16, y: 16 });
  assert.deepEqual(out.cards[1], { uid: "b", x: 16, y: 88 });
  assert.equal(out.cards[2].x, 464 + 66);
  assert.equal(out.h, 16 + 60 + 12 + 60 + 16);
  for (const c of out.cards) {
    const card = { a: { w: 200 }, b: { w: 200 }, c: { w: 100 } }[c.uid];
    const band = bandIndexAt({ x: 0, y: 0, w: out.w, h: out.h }, "horizontal", 3, { x: c.x + card.w / 2, y: c.y });
    assert.equal(band, { a: 0, b: 0, c: 2 }[c.uid]);
  }
  const v = arrangeLane({ w: 240, h: 600, axis: "vertical", bands: [{}, {}], cards: [{ uid: "a", w: 200, h: 60, band: 1 }] });
  assert.deepEqual(v.cards[0], { uid: "a", x: 16, y: 300 + 120 });
  assert.equal(v.h, 600);
});
