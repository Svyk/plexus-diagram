import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { rectsIntersect } from "../src/model/geometry.js";
import {
  canExpandCard,
  compassArrow,
  compassCardString,
  compassExpandTarget,
  placeCompassSlots,
  planCompassExpand,
  selectCompassNodes,
  writeCompassExpand,
} from "../src/model/compass-expand.js";
import { buildBoard } from "../src/model/board.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

const page = (uid, title, zone, label = "", indexTitle = title) => ({ uid, kind: "page", title: indexTitle, zone, label });
const block = (uid, zone, label = "") => ({ uid, kind: "block", zone, label });

test("Expand with Compass is the menu row after Open in Compass", () => {
  const ids = (ctx) => buildMenu("card", ctx).map((row) => row.id);
  const openOnly = ids({ compass: true });
  assert.equal(openOnly.includes("expand-compass"), false);
  assert.equal(openOnly[openOnly.indexOf("open-sidebar") + 1], "open-compass");
  const both = ids({ compass: true, compassExpand: true });
  assert.equal(both[both.indexOf("open-compass") + 1], "expand-compass");
  assert.equal(buildMenu("card", { compass: true, compassExpand: true, interop: false }).some((row) => row.id === "expand-compass"), false);
  assert.equal(buildMenu("card", { compassExpand: true }).some((row) => row.id === "expand-compass"), false);
  assert.equal(buildMenu("card", { compass: true, compassExpand: true }).find((row) => row.id === "expand-compass").label, "Expand with Compass");
});

test("only a page or block card can expand", () => {
  assert.equal(canExpandCard({ type: "card", kind: "page", title: "Notes", target: { kind: "page", title: "Notes" } }), true);
  assert.equal(canExpandCard({ type: "card", kind: "page", target: { kind: "page", title: "Notes" } }), true);
  assert.equal(canExpandCard({ type: "card", kind: "block", target: { kind: "block", uid: "blk1" } }), true);
  assert.equal(canExpandCard({ type: "card", kind: "note", title: "Hello", target: { kind: "self", uid: "n1" } }), false);
  assert.equal(canExpandCard({ type: "card", kind: "highlight" }), false);
  assert.equal(canExpandCard({ type: "section" }), false);
  assert.equal(canExpandCard(null), false);
  assert.deepEqual(compassExpandTarget({ kind: "page", title: "Notes", target: { kind: "page", title: "Notes" } }), { kind: "page", uid: "", title: "Notes" });
  assert.deepEqual(compassExpandTarget({ kind: "block", target: { kind: "block", uid: "blk1" } }), { kind: "block", uid: "blk1" });
  assert.equal(compassExpandTarget({ kind: "note", title: "Hello" }), null);
});

test("neighbors drop siblings and cards already on the board, then keep 12 in zone order", () => {
  const nodes = [
    page("s1", "South", "south"),
    page("n2", "North 2", "north"),
    page("sib", "Sibling", "siblings"),
    page("n1", "North 1", "north"),
    block("e1", "east"),
    page("gone", "Nope", "up"),
    page("on", "On board", "east"),
    block("w1", "west", "left"),
  ];
  const picked = selectCompassNodes(nodes, [{ target: { uid: "on" } }, { uid: "card-itself", target: { kind: "self", uid: "card-itself" } }]);
  assert.deepEqual(picked.map((node) => node.uid), ["n2", "n1", "s1", "w1", "e1"]);

  const norths = Array.from({ length: 13 }, (_, i) => page(`n${i}`, `N${i}`, "north"));
  const capped = selectCompassNodes([...norths, page("late", "Late", "south")]);
  assert.equal(capped.length, 12);
  assert.deepEqual(capped.map((node) => node.uid), norths.slice(0, 12).map((node) => node.uid));
});

test("card text is a page link or a block ref, and a bracket title is skipped after the cap", () => {
  assert.equal(compassCardString({ kind: "page", title: "Notes" }), "[[Notes]]");
  assert.equal(compassCardString({ kind: "page", title: "A [draft]" }), null);
  assert.equal(compassCardString({ kind: "page", title: "A]B" }), null);
  assert.equal(compassCardString({ kind: "block", uid: "abc-1" }), "((abc-1))");
  assert.equal(compassCardString({ kind: "block", uid: "bad uid" }), null);
  assert.equal(compassCardString(null), null);

  const nodes = [
    ...Array.from({ length: 11 }, (_, i) => page(`n${i}`, `N${i}`, "north")),
    page("bad", "Bad", "north", "", "See [this]"),
    page("late", "Late", "south"),
  ];
  const cards = planCompassExpand({ anchor: { x: 0, y: 0, w: 280, h: 160 }, nodes, items: [], occupied: [] });
  assert.equal(cards.length, 11);
  assert.equal(cards.some((card) => card.nodeUid === "late"), false);
  assert.equal(cards.some((card) => card.nodeUid === "bad"), false);
});

test("slots sit 40 out and 24 apart, and a collision moves further out", () => {
  const anchor = { x: 0, y: 0, w: 280, h: 160 };
  const size = { w: 280, h: 160 };
  const one = placeCompassSlots(anchor, [
    { zone: "north", string: "[[N]]" },
    { zone: "south", string: "[[S]]" },
    { zone: "west", string: "[[W]]" },
    { zone: "east", string: "[[E]]" },
  ], [], size);
  assert.deepEqual(one.map((card) => ({ zone: card.zone, x: card.x, y: card.y })), [
    { zone: "north", x: 0, y: -200 },
    { zone: "south", x: 0, y: 200 },
    { zone: "west", x: -320, y: 0 },
    { zone: "east", x: 320, y: 0 },
  ]);

  const row = placeCompassSlots(anchor, [
    { zone: "north", string: "[[A]]" },
    { zone: "north", string: "[[B]]" },
  ], [], size);
  assert.deepEqual(row.map((card) => card.x), [-152, 152]);
  assert.ok(row.every((card) => card.y === -200));

  const column = placeCompassSlots(anchor, [
    { zone: "west", string: "[[A]]" },
    { zone: "west", string: "[[B]]" },
  ], [], size);
  assert.ok(column.every((card) => card.x === -320));
  assert.deepEqual(column.map((card) => card.y), [-92, 92]);

  const blocked = placeCompassSlots(anchor, [{ zone: "north", string: "[[N]]" }], [{ x: 0, y: -200, w: 280, h: 160 }], size);
  assert.equal(blocked[0].x, 0);
  assert.equal(blocked[0].y, -384);
  const occupied = [{ x: 0, y: -200, w: 280, h: 160 }, blocked[0]];
  assert.equal(occupied.some((rect) => rectsIntersect(blocked[0], rect) && rect !== blocked[0]), false);

  const clearOfSection = placeCompassSlots(anchor, [{ zone: "north", string: "[[N]]" }], [], size);
  assert.equal(clearOfSection[0].y, -200);
});

test("arrows point out to the south and east and back from the north and west", () => {
  assert.deepEqual(compassArrow("card", { zone: "south", label: " because " }, "n1"), { from: "card", to: "n1", label: "because", dir: "one" });
  assert.deepEqual(compassArrow("card", { zone: "east", label: "" }, "n1"), { from: "card", to: "n1", label: "", dir: "one" });
  assert.deepEqual(compassArrow("card", { zone: "north", label: "  " }, "n1"), { from: "n1", to: "card", label: "", dir: "one" });
  assert.deepEqual(compassArrow("card", { zone: "west", label: "left" }, "n1"), { from: "n1", to: "card", label: "left", dir: "one" });
});

test("writing the expansion is one undo step when the host groups", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [{ uid: "c1", string: "[[Center]]", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } }],
  });
  fake.trackUndo = true;
  const session = acquireSession("b1", { host, linkDelay: 0 });
  const cards = planCompassExpand({
    anchor: { x: 0, y: 0, w: 280, h: 160, uid: "c1" },
    nodes: [
      page("north1", "North", "north", "parent"),
      block("south1", "south", "child"),
    ],
    items: [{ target: { uid: "center-page" } }],
    occupied: [{ x: 0, y: 0, w: 280, h: 160 }],
  });
  const ids = await writeCompassExpand(session, "c1", cards);
  assert.equal(ids.length, 2);
  const board = buildBoard(host.pullBoard("b1"));
  const edges = [...board.edges.values()].filter((edge) => edge.valid);
  assert.equal(edges.length, 2);
  const north = edges.find((edge) => edge.label === "parent");
  assert.equal(north.to, "c1");
  assert.notEqual(north.from, "c1");
  assert.ok(edges.some((edge) => edge.from === "c1" && edge.label === "child"));
  await session.undo();
  const after = buildBoard(host.pullBoard("b1"));
  assert.equal([...after.items.values()].filter((item) => item.type === "card").length, 1);
  assert.equal([...after.edges.values()].filter((edge) => edge.valid).length, 0);
  session.release();
});
