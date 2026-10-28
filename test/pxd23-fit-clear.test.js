// PXD-23: an auto-fit section that grows never ends up over a neighbour. What stands in the way moves as a whole
// unit (a section with its cards, or a loose card), in the same txn and undo step as the growth.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { FIT_PUSH_CAP, buildBoard, sectionFitClearPlan, worldRects } from "../src/model/board.js";
import { SECTION_TITLE } from "../src/model/linked-cards.js";
import { FIT_PAD } from "../src/model/schema.js";

afterEach(() => resetSessions());

const card = (uid, x, y, w = 200, h = 100, extra = {}) => ({ uid, string: `[[${uid}]]`, props: { plexus: { x, y, w, h, ...extra } } });
const section = (uid, x, y, w, h, children = [], extra = {}) => ({
  uid, string: uid, props: { plexus: { type: "section", x, y, w, h, ...extra } }, children,
});

function setup(children, { trackUndo = false } = {}) {
  const fake = createFakeRoam();
  fake.trackUndo = trackUndo;
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { "rf-diagram": { keep: 1 }, plexus: { v: 2 } }, children });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}

function world(fake, uid) {
  let x = 0;
  let y = 0;
  for (let cur = uid; cur && cur !== "b1"; cur = fake.block(cur).parent) {
    x += fake.block(cur).props.plexus?.x ?? 0;
    y += fake.block(cur).props.plexus?.y ?? 0;
  }
  return { x, y };
}

const plexus = (fake, uid) => fake.props(uid).plexus;
const updated = (fake) => fake.writesLog().filter((e) => e[0] === "update").map((e) => e[1]);
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// A section's title sits above its frame.
const occ = (s, uid) => {
  const r = s.rects.get(uid);
  return s.board.items.get(uid).type === "section" ? { ...r, y: r.y - (SECTION_TITLE - FIT_PAD), h: r.h + SECTION_TITLE - FIT_PAD } : r;
};
function assertApart(session, uids) {
  for (const a of uids) for (const b of uids) {
    if (a < b) assert.ok(!overlap(occ(session, a), occ(session, b)), `${a} and ${b} overlap`);
  }
}

test("grow right into a neighbour: the neighbour section moves right as a unit, its cards with it", async () => {
  const { fake, session } = setup([
    section("A", 0, 0, 400, 300, [card("a", 40, 60)]),
    section("B", 440, 0, 300, 300, [card("b", 24, 40)]),
  ]);
  const bCard = world(fake, "b");
  await session.commitMove(["a"], 250, 0);
  const A = plexus(fake, "A");
  assert.equal(A.w, 514);
  assert.deepEqual([plexus(fake, "B").x, plexus(fake, "B").y], [A.x + A.w + FIT_PAD, 0]);
  assert.deepEqual(plexus(fake, "b"), { x: 24, y: 40, w: 200, h: 100 }, "B's cards keep their place inside B");
  assert.deepEqual(world(fake, "b"), { x: bCard.x + 98, y: bCard.y });
  assert.deepEqual(updated(fake).sort(), ["A", "B", "a"], "one write for the whole unit");
  assertApart(session, ["A", "B"]);
});

test("grow down into a neighbour: the section below moves down and keeps room for its title", async () => {
  const { fake, session } = setup([
    section("A", 0, 0, 400, 300, [card("a", 40, 60)]),
    section("B", 0, 350, 400, 200, [card("b", 24, 40)]),
    card("free", 600, 350),
  ]);
  await session.commitRects([{ uid: "a", x: 40, y: 60, w: 200, h: 400 }]);
  const A = plexus(fake, "A");
  assert.equal(A.h, 484);
  assert.equal(plexus(fake, "B").y, A.h + SECTION_TITLE, "a gap above B's title pill");
  assert.equal(plexus(fake, "B").x, 0);
  assert.deepEqual(plexus(fake, "free"), { x: 600, y: 350, w: 200, h: 100 }, "an item off to the side stays put");
  assertApart(session, ["A", "B", "free"]);
});

test("a section flush below, or with its title pill already in the gap, still moves down", async () => {
  for (const by of [300, 304]) {
    const { fake, session } = setup([
      section("A", 0, 0, 400, 300, [card("a", 40, 40)]),
      section("B", 0, by, 400, 200, [card("b", 24, 40)]),
    ]);
    await session.commitRects([{ uid: "a", x: 40, y: 40, w: 200, h: 400 }]);
    const A = plexus(fake, "A");
    assert.equal(plexus(fake, "B").y, A.h + SECTION_TITLE, `B at ${by}`);
    assertApart(session, ["A", "B"]);
  }
});

test("a loose card in the way moves as itself; a pinned item and one that already overlapped stay put", async () => {
  const { fake, session } = setup([
    section("A", 0, 0, 400, 300, [card("a", 40, 60)]),
    card("loose", 430, 20),
    card("pin", 430, 200, 200, 60, { pinned: true }),
    card("under", 300, 100),
  ]);
  await session.commitMove(["a"], 250, 0);
  const A = plexus(fake, "A");
  assert.equal(plexus(fake, "loose").x, A.x + A.w + FIT_PAD);
  assert.equal(plexus(fake, "pin").x, 430);
  assert.equal(plexus(fake, "under").x, 300);
});

test("a pushed section goes on past a pinned card instead of landing on it", async () => {
  const { fake, session } = setup([
    section("A", 0, 0, 400, 300, [card("a", 40, 60)]),
    section("B", 440, 0, 300, 300, [card("b", 24, 40)]),
    card("pin", 760, 20, 200, 100, { pinned: true }),
  ]);
  await session.commitMove(["a"], 250, 0);
  assert.equal(plexus(fake, "pin").x, 760, "the pinned card stays");
  assert.equal(plexus(fake, "B").x, 760 + 200 + FIT_PAD, "B lands past the pinned card");
  assertApart(session, ["A", "B", "pin"]);
});

test("a chain of three: A grows into B, B is pushed into C, C moves on", async () => {
  const { fake, session } = setup([
    section("A", 0, 0, 400, 300, [card("a", 40, 60)]),
    section("B", 440, 0, 300, 300, [card("b", 24, 40)]),
    section("C", 780, 0, 300, 300, [card("c", 24, 40)]),
  ]);
  await session.commitMove(["a"], 250, 0);
  const A = plexus(fake, "A");
  const B = plexus(fake, "B");
  const C = plexus(fake, "C");
  assert.equal(B.x, A.x + A.w + FIT_PAD);
  assert.equal(C.x, B.x + B.w + FIT_PAD);
  assert.deepEqual([B.y, C.y], [0, 0]);
  assertApart(session, ["A", "B", "C"]);
});

test("nested: a child grows inside its parent, pushes the parent's card, the parent grows and pushes its own neighbour", async () => {
  const { fake, session } = setup([
    section("O", 0, 0, 700, 400, [
      section("I", 24, 40, 300, 300, [card("i", 24, 40)]),
      card("k", 360, 40, 200, 100),
    ]),
    section("N", 740, 0, 300, 300, [card("n", 24, 40)]),
  ]);
  await session.commitRects([{ uid: "i", x: 48, y: 80, w: 500, h: 100 }]);
  const inner = ["I", "k"];
  assertApart(session, inner);
  assertApart(session, ["O", "N"]);
  assert.equal(fake.block("k").parent, "O", "k stays a member of O");
  assert.equal(session.rects.get("k").x, session.rects.get("I").x + session.rects.get("I").w + FIT_PAD);
  const O = session.rects.get("O");
  const k = session.rects.get("k");
  assert.ok(k.x + k.w + FIT_PAD <= O.x + O.w + 0.01, "O grew around k");
  assert.equal(plexus(fake, "N").x, O.x + O.w + FIT_PAD);
  assert.deepEqual(plexus(fake, "n"), { x: 24, y: 40, w: 200, h: 100 });
});

test("growth and its pushes are one undo step", async () => {
  const { fake, session } = setup([
    section("A", 0, 0, 400, 300, [card("a", 40, 60)]),
    section("B", 440, 0, 300, 300, [card("b", 24, 40)]),
  ]);
  await session.commitMove(["a"], 250, 0);
  assert.equal(updated(fake).length, 3);
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((c) => c[0] === "undo").length, 3, "card, section and pushed neighbour undone by one Cmd+Z");
});

test("a tidy past the native chunk size: one undo takes back the growth and the push together", async () => {
  const members = [];
  for (let i = 0; i < 45; i++) members.push(card(`m${i}`, 80, 30 + (i % 5) * 10, 100, 36));
  const { fake, session } = setup([
    section("A", 0, 0, 260, 200, members),
    section("B", 300, 0, 180, 160, [card("b", 16, 16)]),
  ], { trackUndo: true });
  await session.tidyItems(["A"], "row");
  assert.ok(updated(fake).length > 45, "the tidy alone passes one native chunk");
  assert.ok(plexus(fake, "B").x > 300, "B was pushed");
  await session.undo();
  assert.deepEqual([plexus(fake, "A").w, plexus(fake, "B").x], [260, 300]);
});

test("model: a growth that comes over nothing moves nothing; the push count is capped", () => {
  const kids = [section("A", 0, 0, 400, 300, [card("a", 380, 60)])];
  for (let i = 0; i < FIT_PUSH_CAP + 5; i++) kids.push(card(`c${i}`, 440 + i * 210, 0));
  const board = buildBoard({ ":block/uid": "b1", ":block/string": "b", ":block/props": { ":plexus": { v: 2 } }, ":block/children": kids.map(toNode) });
  const rects = worldRects(board);
  const plan = sectionFitClearPlan(board, rects, ["a"]);
  assert.deepEqual(plan.grown.map((g) => g.uid), ["A"]);
  assert.equal(plan.moved.length, FIT_PUSH_CAP);
  const quiet = sectionFitClearPlan(board, rects, ["A"]);
  assert.deepEqual([quiet.grown, quiet.moved], [[], []]);
});

function toNode(spec, i = 0) {
  return {
    ":block/uid": spec.uid,
    ":block/string": spec.string,
    ":block/order": i,
    ":block/props": { ":plexus": spec.props.plexus },
    ":block/children": (spec.children || []).map(toNode),
  };
}
