// PXD-12: apply the board's reading order to a source block's children, and keep a section in outline order.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { byReadingPosition, readingOrder } from "../src/model/board.js";
import { buildMenu } from "../src/view/menu-model.js";
import "../src/session-source-order.js";
import {
  SOURCE_ORDER_CHUNK,
  chunkMoves,
  chunkStates,
  isDueChild,
  orderChanged,
  outlineOrderByTarget,
  pickSourceParent,
  planSourceOrder,
} from "../src/model/source-order.js";

afterEach(() => resetSessions());

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const card = (uid, string, x, y, extra = {}) => ({ uid, string, props: { plexus: { x, y, w: 200, h: 100, ...extra } } });
const kid = (uid, string = uid) => ({ uid, string });
const ref = (uid) => `((${uid}))`;

function setup({ kids, cards, extraPages = [], trackUndo = false }) {
  const fake = createFakeRoam();
  fake.trackUndo = trackUndo;
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({ title: "Src page", uid: "SRCPAGE", children: [{ uid: "SRC", string: "Source block", children: kids }] });
  for (const p of extraPages) fake.seedPage(p);
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: cards });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}
const outline = (fake, parent = "SRC") => fake.children(parent).filter((u) => fake.has(u));
const cardOf = (uid) => `c_${uid}`;
const column = (uids, x = 0) => uids.map((u, i) => card(cardOf(u), ref(u), x, i * 150));

// ---------------------------------------------------------------- pure

test("PXD-12 reading order: y, then x, then uid, on absolute rects; readingOrder uses the same comparator", () => {
  const items = new Map([["a", { x: 0, y: 0 }], ["b", { x: 0, y: 0 }], ["c", { x: 0, y: 0 }], ["d", { x: 0, y: 0 }]]);
  const board = { uid: "B", roots: ["a", "b", "c", "d"], items: new Map([...items].map(([k, v]) => [k, { ...v, type: "card", members: [] }])) };
  const rects = new Map([["a", { x: 50, y: 10 }], ["b", { x: 10, y: 10 }], ["c", { x: 10, y: 10 }], ["d", { x: 99, y: 0 }]]);
  assert.deepEqual(byReadingPosition(["a", "b", "c", "d"], board, rects), ["d", "b", "c", "a"]);
  assert.deepEqual(readingOrder(board, rects)[0].uids, ["d", "b", "c", "a"]);
  assert.deepEqual(byReadingPosition(["b", "a"], board, null), ["a", "b"], "falls back to item x/y, then uid");
});

test("PXD-12 parent pick: most cards wins, a tie goes to the first card's parent, duplicates count once", () => {
  const rows = [{ target: "a", parent: "P2" }, { target: "b", parent: "P1" }, { target: "c", parent: "P1" }, { target: "d", parent: "P2" }, { target: "d", parent: "P2" }, { target: "e", parent: "" }];
  assert.deepEqual(pickSourceParent(rows.slice(0, 3)), { parentUid: "P1", skipped: 1 });
  assert.deepEqual(pickSourceParent(rows.slice(0, 4)), { parentUid: "P2", skipped: 2 }, "tie: the first card's parent");
  assert.deepEqual(pickSourceParent(rows), { parentUid: "P2", skipped: 3 });
  assert.deepEqual(pickSourceParent([{ target: "x", parent: "" }]), { parentUid: "", skipped: 1 });
});

// Live Roam (2026-10-27, Readwisenotes): a numeric order inside the same parent is read before removal (0..4, move 0 to
// 2 gives 1 0 2 3 4). The fixture reads it after removal. A plan must land the same under both.
function replay(current, moves, beforeRemoval) {
  const sim = current.slice();
  for (const m of moves) {
    const from = sim.indexOf(m.uid);
    sim.splice(from, 1);
    if (m.order === "last") sim.push(m.uid);
    else sim.splice(beforeRemoval && m.order > from ? m.order - 1 : m.order, 0, m.uid);
  }
  return sim;
}

test("PXD-12 plan: only card targets move, never down by index; BT_attrDue children and other siblings stay", () => {
  const kids = [kid("due", "BT_attrDue:: [[October 1st, 2026]]"), kid("A"), kid("n1"), kid("B"), kid("C"), kid("n2")];
  const plan = planSourceOrder(kids, ["C", "A", "B", "due", "A"]);
  assert.deepEqual(plan.desired, ["due", "C", "n1", "A", "B", "n2"]);
  const sim = plan.current.slice();
  for (const m of plan.moves) {
    assert.ok(plan.targets.includes(m.uid), `only targets move (${m.uid})`);
    assert.ok(m.order === "last" || sim.indexOf(m.uid) >= m.order, "up or to the end");
    sim.splice(sim.indexOf(m.uid), 1);
    if (m.order === "last") sim.push(m.uid);
    else sim.splice(m.order, 0, m.uid);
  }
  assert.deepEqual(sim, plan.desired);
  assert.deepEqual(replay(plan.current, plan.moves, true), plan.desired, "Roam's rule");
  // A card has to pass a due child that stays: it goes to the end, the next card comes up.
  const due = planSourceOrder([kid("A"), kid("D", "BT_attrDue:: [[x]]"), kid("B")], ["B", "A"]);
  assert.deepEqual(due.desired, ["B", "D", "A"]);
  assert.deepEqual(due.moves, [{ uid: "B", order: 0 }, { uid: "A", order: "last" }]);
  assert.deepEqual(replay(due.current, due.moves, true), due.desired);
  assert.deepEqual(replay(due.current, due.moves, false), due.desired);
  // Random shuffles: same result under both rules, no sibling ever written.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 200; round++) {
    const n = 2 + Math.floor(rnd() * 12);
    const list = Array.from({ length: n }, (_, i) => (rnd() < 0.3 ? kid(`d${i}`, "BT_attrDue:: x") : kid(`k${i}`)));
    const targets = list.map((k) => k.uid).filter(() => rnd() < 0.7).sort(() => rnd() - 0.5);
    const p = planSourceOrder(list, targets);
    assert.ok(p.moves.every((m) => p.targets.includes(m.uid)));
    assert.deepEqual(replay(p.current, p.moves, true), p.desired);
    assert.deepEqual(replay(p.current, p.moves, false), p.desired);
  }
  assert.equal(isDueChild("  BT_attrDue:: x"), true);
  assert.equal(isDueChild("BT_attrDue"), false);
  assert.deepEqual(planSourceOrder([kid("A"), kid("B")], ["A", "B"]).moves, []);
});

test("PXD-12 chunks: 45 per chunk, the states walk to the final order", () => {
  const current = Array.from({ length: 100 }, (_, i) => `k${i}`);
  const plan = planSourceOrder(current.map((u) => kid(u)), current.slice().reverse());
  const chunks = chunkMoves(plan.moves);
  assert.equal(SOURCE_ORDER_CHUNK, 45);
  assert.ok(chunks.length >= 3 && chunks.every((c) => c.length <= 45));
  assert.equal(chunks.flat().length, plan.moves.length);
  const states = chunkStates(plan.current, chunks);
  assert.deepEqual(states.at(-1), plan.desired);
});

test("PXD-12 orderChanged: a reorder of shared uids, not adds or deletes", () => {
  assert.equal(orderChanged(["a", "b", "c"], ["a", "b", "c"]), false);
  assert.equal(orderChanged(["a", "b", "c"], ["a", "x", "b", "c"]), false, "add");
  assert.equal(orderChanged(["a", "b", "c"], ["a", "c"]), false, "delete");
  assert.equal(orderChanged(["a", "b", "c"], ["a", "c", "b"]), true);
  assert.equal(orderChanged(["a", "b", "c"], ["c", "x"]), false, "one shared uid cannot be out of order");
  assert.deepEqual(outlineOrderByTarget(["k3", "k1", "k2"], [{ card: "c1", target: "k1" }, { card: "c2", target: "k2" }, { card: "c3", target: "k3" }, { card: "cx", target: "zz" }]), ["c3", "c1", "c2"]);
});

test("PXD-12 menu: Apply order to source in the multi and section menus, Keep outline order checked", () => {
  const find = (items, id) => items.find((i) => i.id === id);
  assert.ok(!find(buildMenu("multi", { count: 3, refCards: 3 }), "apply-source-order").disabled);
  assert.ok(find(buildMenu("multi", { count: 3, refCards: 1 }), "apply-source-order").disabled);
  const section = buildMenu("section", { count: 3, refCards: 3, keepOrder: true });
  assert.ok(!find(section, "apply-source-order").disabled);
  assert.equal(find(section, "keep-order").checked, true);
  assert.ok(!find(buildMenu("section", { count: 3 }), "keep-order").checked);
});

// ---------------------------------------------------------------- session

test("PXD-12 apply: the real blocks follow the board's reading order; no plexus props are written", async () => {
  const ks = ["k1", "k2", "k3", "k4"];
  const { fake, session } = setup({
    kids: ks.map((u) => kid(u)),
    // reading order top to bottom: k3, k1, k4, k2
    cards: [card("c1", ref("k1"), 0, 150), card("c2", ref("k2"), 0, 450), card("c3", ref("k3"), 0, 0), card("c4", ref("k4"), 0, 300)],
  });
  const plan = session.sourceOrderPlan(["c1", "c2", "c3", "c4"]);
  assert.deepEqual([plan.parentUid, plan.parentLabel, plan.count, plan.skippedCards], ["SRC", "Source block", 4, 0]);
  const res = await session.applySourceOrder(["c1", "c2", "c3", "c4"]);
  await fake.flush();
  assert.deepEqual(outline(fake), ["k3", "k1", "k4", "k2"]);
  assert.equal(res.parentUid, "SRC");
  assert.equal(res.chunks, 1);
  assert.deepEqual(fake.writesLog().filter((w) => w[0] !== "move"), [], "moves only");
  assert.deepEqual(session.board.items.get("c3").y, 0, "cards stay put");
  assert.ok(session.sourceOrderPlan(["c1", "c2", "c3", "c4"]).reason, "now in order");
});

test("PXD-12 apply: cards of several parents use the majority parent; others are untouched and never reparented", async () => {
  const { fake, session } = setup({
    kids: [kid("a1"), kid("a2"), kid("a3")],
    extraPages: [{ title: "Other", uid: "OTHERPG", children: [{ uid: "OTH", string: "Other source", children: [kid("o1"), kid("o2")] }] }],
    cards: [card("c3", ref("a3"), 0, 0), card("co", ref("o2"), 0, 150), card("c1", ref("a1"), 0, 300), card("c2", ref("a2"), 0, 450)],
  });
  const ids = ["c3", "co", "c1", "c2"];
  const plan = session.sourceOrderPlan(ids);
  assert.deepEqual([plan.parentUid, plan.skippedCards], ["SRC", 1]);
  await session.applySourceOrder(ids);
  await fake.flush();
  assert.deepEqual(outline(fake), ["a3", "a1", "a2"]);
  assert.deepEqual(outline(fake, "OTH"), ["o1", "o2"]);
  assert.equal(fake.block("o2").parent, "OTH");
});

test("PXD-12 apply: a due child and plain siblings stay; a section applies its direct members", async () => {
  const { fake, session } = setup({
    kids: [kid("due", "BT_attrDue:: [[October 1st, 2026]]"), kid("a1"), kid("n1"), kid("a2"), kid("a3")],
    cards: [
      { uid: "S", string: "Section", props: { plexus: { type: "section", x: 0, y: 0, w: 400, h: 600 } }, children: [card("c3", ref("a3"), 20, 40), card("c1", ref("a1"), 20, 200), card("c2", ref("a2"), 20, 360)] },
    ],
  });
  await session.applySourceOrder(["S"]);
  await fake.flush();
  assert.deepEqual(outline(fake), ["due", "a3", "n1", "a1", "a2"]);
  assert.deepEqual(fake.writesLog().filter((w) => w[1] === "due" || w[1] === "n1"), [], "the due child and n1 get no write");
});

test("PXD-12 apply: 100 reversed children go in chunks of 45 and end in board order; one Cmd+Z restores the original", async () => {
  const ks = Array.from({ length: 100 }, (_, i) => `k${String(i).padStart(3, "0")}`);
  const { fake, session } = setup({
    kids: ks.map((u) => kid(u)),
    cards: column(ks.slice().reverse()),
    trackUndo: true,
  });
  const ids = ks.map(cardOf);
  const res = await session.applySourceOrder(ids);
  await fake.flush();
  assert.deepEqual(outline(fake), ks.slice().reverse());
  assert.equal(res.moved, 99);
  assert.equal(res.chunks, 3);
  const moves = fake.writesLog().filter((w) => w[0] === "move").length;
  assert.equal(moves, 99);
  assert.deepEqual(fake.writesLog().filter((w) => w[0] !== "move"), []);
  // Roam's native undo holds 50 entries, fewer than the 99 moves: undo must not walk data.undo() back through them.
  const nativeUndo = fake.api.data.undo;
  let nativeSteps = 0;
  fake.api.data.undo = (...args) => { nativeSteps += 1; return nativeUndo.apply(fake.api.data, args); };
  await session.undo();
  await fake.flush();
  assert.deepEqual(outline(fake), ks, "back to the original order in one step");
  assert.equal(nativeSteps, 0, "a custom step, not Roam's native stack");
  await session.redo();
  await fake.flush();
  assert.deepEqual(outline(fake), ks.slice().reverse(), "redo applies it again");
  await session.undo();
  await fake.flush();
  assert.deepEqual(outline(fake), ks);
});

test("PXD-12 apply: a one-chunk apply stays on Roam's native undo", async () => {
  const ks = ["k1", "k2", "k3", "k4"];
  const { fake, session } = setup({ kids: ks.map((u) => kid(u)), cards: column(ks.slice().reverse()), trackUndo: true });
  await session.applySourceOrder(ks.map(cardOf));
  await fake.flush();
  assert.deepEqual(outline(fake), ks.slice().reverse());
  const nativeUndo = fake.api.data.undo;
  let nativeSteps = 0;
  fake.api.data.undo = (...args) => { nativeSteps += 1; return nativeUndo.apply(fake.api.data, args); };
  await session.undo();
  await fake.flush();
  assert.deepEqual(outline(fake), ks);
  assert.ok(nativeSteps > 0);
});

// ---------------------------------------------------------------- keep outline order

function keepSetup(marked) {
  const ks = ["k1", "k2", "k3"];
  const s = setup({
    kids: ks.map((u) => kid(u)),
    cards: [
      { uid: "S", string: "Section", props: { plexus: { type: "section", x: 0, y: 0, w: 400, h: 600, ...(marked ? { keepOrder: true } : {}) } }, children: [card("m1", ref("k1"), 20, 40), card("m2", ref("k2"), 20, 200), card("m3", ref("k3"), 20, 360)] },
    ],
  });
  return s;
}
const sourceWatches = (fake) => fake.watchList().filter((w) => w.uid === "SRC" && w.pattern.includes("[:block/uid :block/order]"));
const membersInReading = (session) => {
  const board = session.board;
  return byReadingPosition(board.items.get("S").members, board, null).map((m) => board.items.get(m).target.uid);
};

test("PXD-12 keep order: schema round trip, toggle is one props write, the watch follows the mark", async () => {
  const { fake, session } = keepSetup(false);
  assert.equal(session.board.items.get("S").keepOrder, false);
  assert.equal(sourceWatches(fake).length, 0, "an unmarked section has no watch");
  await session.setKeepOrder("S", true);
  await fake.flush();
  assert.deepEqual(fake.writesLog().map((w) => w[0]), ["update"]);
  assert.equal(fake.props("S").plexus.keepOrder, true);
  assert.equal(session.board.items.get("S").keepOrder, true);
  assert.equal(sourceWatches(fake).length, 1);
  await session.setKeepOrder("S", false);
  await fake.flush();
  assert.equal(fake.props("S").plexus.keepOrder, undefined);
  assert.equal(sourceWatches(fake).length, 0);
});

test("PXD-12 keep order: an outside reorder re-tidies a marked section's members in source order", async () => {
  const { fake, session } = keepSetup(true);
  await wait(20);
  assert.equal(sourceWatches(fake).length, 1);
  assert.deepEqual(membersInReading(session), ["k1", "k2", "k3"]);
  fake.clearLog();
  await fake.api.data.block.move({ location: { "parent-uid": "SRC", order: 0 }, block: { uid: "k3" } });
  await wait(500);
  await fake.flush();
  assert.deepEqual(outline(fake), ["k3", "k1", "k2"]);
  assert.deepEqual(membersInReading(session), ["k3", "k1", "k2"]);
  assert.ok(fake.writesLog().filter((w) => w[0] === "update").every((w) => ["m1", "m2", "m3", "S"].includes(w[1]) && w[2].props.plexus.keepOrder !== false), "only member positions (and the section fit) are written");
});

test("PXD-12 keep order: the same outside reorder on an unmarked section moves nothing", async () => {
  const { fake, session } = keepSetup(false);
  await wait(20);
  fake.clearLog();
  await fake.api.data.block.move({ location: { "parent-uid": "SRC", order: 0 }, block: { uid: "k3" } });
  await wait(500);
  await fake.flush();
  assert.deepEqual(membersInReading(session), ["k1", "k2", "k3"]);
  assert.deepEqual(fake.writesLog().filter((w) => w[0] === "update"), []);
});

test("PXD-12 keep order: Plexus's own apply, its undo and an add or delete do not re-tidy", async () => {
  const { fake, session } = keepSetup(true);
  await wait(20);
  // Arrange the cards k2, k3, k1 on the board, then apply.
  await session.tidyItems(["S"], "outline", { order: ["m2", "m3", "m1"] });
  await fake.flush();
  assert.deepEqual(membersInReading(session), ["k2", "k3", "k1"]);
  fake.trackUndo = true;
  fake.clearLog();
  await session.applySourceOrder(["S"]);
  await wait(500);
  await fake.flush();
  assert.deepEqual(outline(fake), ["k2", "k3", "k1"]);
  assert.deepEqual(fake.writesLog().filter((w) => w[0] !== "move"), [], "the apply is followed by no re-tidy");
  await session.undo();
  await wait(500);
  await fake.flush();
  assert.deepEqual(outline(fake), ["k1", "k2", "k3"]);
  assert.deepEqual(membersInReading(session), ["k2", "k3", "k1"], "undo does not move the cards either");
  // A pure add is not a reorder.
  await fake.api.data.block.create({ location: { "parent-uid": "SRC", order: 1 }, block: { uid: "kNew", string: "new" } });
  await wait(500);
  await fake.flush();
  assert.deepEqual(membersInReading(session), ["k2", "k3", "k1"]);
});

test("PXD-12 apply: a nested section's cards are not the outer section's; the parent comes from direct members", async () => {
  const { fake, session } = setup({
    kids: [kid("a1"), kid("a2")],
    extraPages: [{ title: "Other", uid: "OTHERPG", children: [{ uid: "OTH", string: "Other source", children: [kid("o1"), kid("o2"), kid("o3")] }] }],
    cards: [
      { uid: "S", string: "Outer", props: { plexus: { type: "section", x: 0, y: 0, w: 900, h: 900 } }, children: [
        card("c2", ref("a2"), 20, 40), card("c1", ref("a1"), 20, 200),
        { uid: "N", string: "Inner", props: { plexus: { type: "section", x: 300, y: 40, w: 500, h: 700 } }, children: [card("n3", ref("o3"), 20, 40), card("n2", ref("o2"), 20, 200), card("n1", ref("o1"), 20, 360)] },
      ] },
    ],
  });
  const plan = session.sourceOrderPlan(["S"]);
  assert.deepEqual([plan.parentUid, plan.count, plan.skippedCards], ["SRC", 2, 0]);
  await session.applySourceOrder(["S"]);
  await fake.flush();
  assert.deepEqual(outline(fake), ["a2", "a1"]);
  assert.deepEqual(outline(fake, "OTH"), ["o1", "o2", "o3"], "the inner section's source is untouched");
});

test("PXD-12 apply: a chunk whose writes fail stops the rest and says so", async () => {
  const ks = Array.from({ length: 100 }, (_, i) => `k${String(i).padStart(3, "0")}`);
  const { fake, session } = setup({ kids: ks.map((u) => kid(u)), cards: column(ks.slice().reverse()) });
  const move = fake.api.data.block.move;
  let calls = 0;
  fake.api.data.block.move = (arg) => {
    calls += 1;
    if (calls === SOURCE_ORDER_CHUNK + 1) fake.failNext = 50;
    return move.call(fake.api.data.block, arg);
  };
  const res = await session.applySourceOrder(ks.map(cardOf));
  await fake.flush();
  fake.failNext = 0;
  assert.equal(res.moved, SOURCE_ORDER_CHUNK, "only the first chunk counts");
  assert.ok(res.reason, "the caller hears why");
  const landed = fake.writesLog().filter((w) => w[0] === "move").length;
  assert.ok(landed < 2 * SOURCE_ORDER_CHUNK, `the third chunk never runs (${landed} moves landed)`);
});

test("PXD-12 keep order: an own order seen again long after Plexus wrote is an outside change", async () => {
  const { fake, host, session } = keepSetup(true);
  await wait(20);
  await session.tidyItems(["S"], "outline", { order: ["m2", "m3", "m1"] });
  await session.applySourceOrder(["S"]);
  await wait(500);
  await fake.flush();
  assert.deepEqual(outline(fake), ["k2", "k3", "k1"]);
  // Much later, someone puts the old order back in Roam. It matches a remembered state but Plexus wrote nothing lately.
  host.lastWriteAt = () => -Infinity;
  await fake.api.data.block.move({ location: { "parent-uid": "SRC", order: 0 }, block: { uid: "k1" } });
  await wait(500);
  await fake.flush();
  assert.deepEqual(outline(fake), ["k1", "k2", "k3"]);
  assert.deepEqual(membersInReading(session), ["k1", "k2", "k3"], "re-tidied");
});

test("PXD-12 apply: a sibling added between chunks stops the apply before the next chunk runs on shifted indexes", async () => {
  const ks = Array.from({ length: 100 }, (_, i) => `k${String(i).padStart(3, "0")}`);
  const { fake, session } = setup({ kids: ks.map((u) => kid(u)), cards: column(ks.slice().reverse()) });
  const move = fake.api.data.block.move;
  let calls = 0;
  fake.api.data.block.move = (arg) => {
    calls += 1;
    const out = move.call(fake.api.data.block, arg);
    if (calls !== SOURCE_ORDER_CHUNK) return out;
    return out.then(() => fake.api.data.block.create({ location: { "parent-uid": "SRC", order: 0 }, block: { uid: "NEWKID", string: "inserted" } }));
  };
  const res = await session.applySourceOrder(ks.map(cardOf));
  await fake.flush();
  assert.ok(res.reason, "the caller hears why");
  assert.equal(calls, SOURCE_ORDER_CHUNK, "the second chunk never ran");
  assert.equal(outline(fake)[0], "NEWKID", "the added block is left where it was put");
  // "Undo to go back": one Cmd+Z puts the original order back around the block someone else added.
  await session.undo();
  await fake.flush();
  assert.deepEqual(outline(fake), ["NEWKID", ...ks]);
});
